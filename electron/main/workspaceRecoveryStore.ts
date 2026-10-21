import fs from 'node:fs/promises';
import { readSnapshotFile } from './snapshotFileRead.js';
import { withControlledBufferOutput, copyControlledBuffer, parseControlledJSON, serializeControlledJSON } from './controlledMemory.js';
import type { OriginWorkspaceAccounting, ReservationFailureHandler } from './originWorkspaceAccounting.js';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { withLayerFileOperation } from './layerFileOperationQueue.js';
import { certifyRecoveryCaptureChain, type RecoveryCaptureReference } from './recoveryCaptureChain.js';
import { recoveryPolicyKey } from './recoveryPolicyPartition.js';
import { scanRecoveryWorkspace } from './recoveryWorkspaceAccounting.js';

// Content-only protocol candidate. No command replay or production permission policy.
// authorize is mandatory; an unavailable adapter cannot silently become chmod-only.
export type RecoveryBudget = { bytes: number; records: number; assets: number; jsonDepth: number };
export type RecoveryCaller = { sender: object; frame: object; window: object; document: object };
export type RecoveryOffer = {
  revision: string; projectRaw: unknown; viewState: unknown; scriptState: unknown;
  effectFacts: unknown; continuationState: unknown;
  assets: { assetId: string; bytes: Uint8Array; role: string; width: number; height: number; encoding: string }[];
  requiredAssetIds: string[];
};
type Identity = { dev: number; ino: number };
type Binding = { root: string; rootIdentity: Identity; metadataIdentity: Identity };
type Parent = { operationId: string; generationId: string; sealDigest: string };
type Asset = Omit<RecoveryOffer['assets'][number], 'bytes'> & { file: string; length: number; digest: string };
type Content = Omit<RecoveryOffer, 'assets'> & { schema: string; version: 1 | 2; binding: Binding; operationId: string; generationId: string; parent: Parent | null; globalPrevious?: RecoveryCaptureReference | null; sourcePolicy?: unknown; assets: Asset[] };
type Ack = Parent & { revision: string; contentDigest: string };
export type RecoveryInspection = { state: 'protocolAbsent' | 'protectedReadable' | 'protectedIncomplete' | 'protectedUninspectable' | 'protectedIdentityConflict'; issue?: string; content?: Content; ack?: Ack; captures?: { content: Content; ack: Ack }[]; storagePolicy?: unknown };
export type RecoveryAuthorization = (request: { path: string; root: string; phase: 'directory' | 'beforeBytes' | 'readback'; sources: readonly string[] }) => Promise<void>;
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

const safeId = (id: string) => /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const keys = (value: object, expected: string[]) => {
  if (!same(Object.keys(value).sort(), expected.sort())) throw new Error('Unknown or missing record fields');
};
const identity = async (file: string, directory = false): Promise<Identity> => {
  const stat = await fs.lstat(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw new Error('Link or unsupported item');
  return { dev: stat.dev, ino: stat.ino };
};
const boundedJSON = (value: unknown, maxDepth: number) => {
  const ancestors = new Set<object>();
  const visit = (v: unknown, depth: number): void => {
    if (depth > maxDepth) throw new Error('JSON depth budget exceeded');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return;
    if (typeof v === 'number' && Number.isFinite(v)) return;
    if (typeof v !== 'object' || !v || ancestors.has(v)) throw new Error('Not finite JSON data');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) throw new Error('Non-data JSON object');
    if (Object.getOwnPropertySymbols(v).length) throw new Error('Symbol data not retainable');
    ancestors.add(v);
    const names = Object.getOwnPropertyNames(v);
    for (const key of names) {
      const entry = Object.getOwnPropertyDescriptor(v, key)!;
      if (entry.get || entry.set) throw new Error('Accessor data not retainable');
    }
    for (const key of names) {
      const entry = Object.getOwnPropertyDescriptor(v, key)!;
      if (entry.enumerable) visit(entry.value, depth + 1);
    }
    ancestors.delete(v);
  };
  return serializeControlledJSON(value, () => visit(value, 0));
};

export const createWorkspaceRecoveryStore = ({ authorize, budget, fault, sources = [], sourcePolicy, allowUnsealedStart = false, partition, globalPrevious = null, capturePolicy = sourcePolicy, accounting = scanRecoveryWorkspace }: {
  // Main-private storage address, never a renderer destination or permission.
  partition?: string;
  globalPrevious?: RecoveryCaptureReference | null;
  capturePolicy?: unknown;
  // Main's live preparation inventory can append nonexecuting content after
  // first-generation partial failure. This never certifies unknown inventory.
  allowUnsealedStart?: boolean;
  sourcePolicy?: unknown;
  sources?: readonly string[];
  authorize?: RecoveryAuthorization;
  budget?: RecoveryBudget;
  accounting?: typeof scanRecoveryWorkspace;
  fault?: (phase: 'created' | 'written' | 'closed' | 'linked' | 'sourceReleased' | 'readback', file: string) => Promise<void>;
}) => {
  if (partition !== undefined && (!/^[a-f0-9]{64}$/.test(partition) || recoveryPolicyKey(sourcePolicy) !== partition)) throw new Error('Recovery partition key/policy mismatch');
  const version = partition === undefined ? 1 : 2;
  const namespace = partition === undefined ? 'workspace-recovery-v1' : `workspace-recovery-v2/policies/${partition}`;
  // Deliberately no default native policy: this port still needs contributor-
  // restriction and derived-content certification before production integration.
  const enabled = !!authorize && !!budget && same(Object.keys(budget).sort(), ['assets', 'bytes', 'jsonDepth', 'records']) && Object.values(budget).every(n => Number.isSafeInteger(n) && n > 0);
  const requireEnabled = () => { if (!enabled) throw new Error('Recovery unavailable: permission adapter and finite accepted budget required'); };
  const certify = async (file: string, root: string, phase: Parameters<RecoveryAuthorization>[0]['phase']) => {
    requireEnabled(); await authorize!({ path: file, root, phase, sources: [...sources] });
  };
  const bindingFor = async (requested: string): Promise<Binding> => {
    const root = await fs.realpath(requested);
    const metadata = path.join(root, '.storyboard-workbench');
    return { root, rootIdentity: await identity(root, true), metadataIdentity: await identity(metadata, true) };
  };
  const checkBinding = async (binding: Binding) => {
    if (!same(binding, await bindingFor(binding.root))) throw new Error('Physical workspace identity conflict');
  };
  const read = async (file: string, root: string): Promise<Buffer> => {
    await certify(file, root, 'readback');
    return readSnapshotFile(file, budget!.bytes);
  };
  const json = async (file: string, root: string) => {
    const bytes = await read(file, root);
    const value: any = parseControlledJSON(bytes);
    if (!boundedJSON(value, budget!.jsonDepth).equals(bytes)) throw new Error('Noncanonical/duplicate-key JSON');
    return { value, digest: digest(bytes) };
  };
  const validateRaster = async (bytes: Buffer, asset: Pick<Asset, 'encoding' | 'width' | 'height'>) => {
    if (!Number.isSafeInteger(asset.width) || asset.width <= 0 || !Number.isSafeInteger(asset.height) || asset.height <= 0 || asset.width * asset.height > Math.floor(budget!.bytes / 4)) throw new Error('Raster decode budget/dimensions');
    const isPNG = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const isTIFF = bytes.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) || bytes.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]));
    if (!((asset.encoding === 'png' && isPNG) || (asset.encoding === 'tiff' && isTIFF))) throw new Error('Only nonexecuting PNG/TIFF raster bytes are supported');
    const decoder = sharp(bytes, { limitInputPixels: Math.floor(budget!.bytes / 4), failOn: 'error' });
    const metadata = await decoder.metadata();
    if (metadata.format !== asset.encoding || metadata.width !== asset.width || metadata.height !== asset.height || (metadata.pages ?? 1) !== 1) throw new Error('Raster encoding/dimension/page mismatch');
    // Decode only in the controlled raster decoder; never LaunchServices, shell,
    // OS-open or execute any retained path/description. No preview file writes.
    // Sharp's default raw output is uchar, RGB/RGBA for non-greyscale; four
    // bytes/pixel bounds this output (not its native decoder working space).
    const outputBytes=BigInt(asset.width)*BigInt(asset.height)*4n;
    if(outputBytes>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Finite raw raster output required');
    await withControlledBufferOutput(Number(outputBytes),()=>decoder.ensureAlpha().raw().toBuffer());
  };
  const inventory = async (base: string, root: string): Promise<{ bytes: number; files: string[]; directories: string[] }> => {
    let bytes = 0, records = 0;
    const files: string[] = [], directories: string[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth > 7) throw new Error('Inventory nesting limit');
      await identity(dir, true); await certify(dir, root, 'directory');
      const directory = await fs.opendir(dir);
      for await (const entry of directory) {
        const name = entry.name;
        if (++records > budget!.records) throw new Error('Inventory record budget exceeded');
        const target = path.join(dir, name), stat = await fs.lstat(target);
        if (stat.isDirectory() && !stat.isSymbolicLink()) { directories.push(path.relative(base, target)); await walk(target, depth + 1); }
        else {
          await identity(target); bytes += stat.size;
          if (bytes > budget!.bytes) throw new Error('Inventory byte budget exceeded');
          files.push(path.relative(base, target));
        }
      }
    };
    await walk(base, 0); return { bytes, files, directories };
  };
  const inspectContent = async (requested: string): Promise<RecoveryInspection> => {
    requireEnabled();
    let binding: Binding;
    try { binding = await bindingFor(requested); } catch (error) { return { state: 'protectedIdentityConflict', issue: String(error) }; }
    const base = path.join(binding.root, '.storyboard-workbench', namespace);
    try {
      try { await fs.lstat(base); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        let existingParent = path.dirname(base);
        for (;;) {
          try { await identity(existingParent, true); break; }
          catch (parentError) { if ((parentError as NodeJS.ErrnoException).code !== 'ENOENT' || existingParent === path.join(binding.root, '.storyboard-workbench')) throw parentError; existingParent = path.dirname(existingParent); }
        }
        await certify(existingParent, binding.root, 'directory');
        const parentDirectory = await fs.opendir(existingParent);
        try { await parentDirectory.read(); } finally { await parentDirectory.close(); }
        await checkBinding(binding);
        return { state: 'protocolAbsent' };
      }
      const observed = await inventory(base, binding.root);
      let ns:any;
      try { await fs.lstat(path.join(base,'namespace.json')); ns = (await json(path.join(base, 'namespace.json'), binding.root)).value; }
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {state:'protectedIncomplete',issue:'Missing namespace record; no sealed content'};throw error;}
      keys(ns, [...(sourcePolicy === undefined ? ['schema', 'version', 'binding'] : ['schema', 'version', 'binding', 'sourcePolicy']), ...(partition === undefined ? [] : ['policyKey'])]);
      if (sourcePolicy !== undefined && (partition === undefined ? !same(ns.sourcePolicy, sourcePolicy) : recoveryPolicyKey(ns.sourcePolicy) !== partition)) throw new Error('Immutable source policy mismatch');
      if (ns.schema !== 'swb.workspace-recovery-namespace' || ns.version !== version || partition !== undefined && ns.policyKey !== partition) throw new Error('Unknown namespace schema');
      if (!same(ns.binding, binding)) return { state: 'protectedIdentityConflict', issue: 'Namespace physical binding mismatch' };
      const allowed = new Set(['namespace.json']); const dirs = new Set(['operations']);
      let pendingInventory = false;
      const generations = new Map<string, { content: Content; ack: Ack }>();
      let operations: Awaited<ReturnType<typeof fs.opendir>>;
      try { operations = await fs.opendir(path.join(base, 'operations')); }
      catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return {state:'protectedIncomplete',issue:'Missing operations inventory; no sealed content'};throw error;}
      for await (const operationEntry of operations) {
        const operationId = operationEntry.name;
        if (!safeId(operationId)) throw new Error('Unsafe operation id');
        const op = `operations/${operationId}`, opDir = path.join(base, op);
        dirs.add(op); dirs.add(`${op}/generations`); allowed.add(`${op}/operation.json`);
        let operation:any;
        try { await fs.lstat(path.join(opDir,'operation.json')); operation = (await json(path.join(opDir, 'operation.json'), binding.root)).value; }
        catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){pendingInventory=true;continue;}throw error;}
        keys(operation, ['schema', 'version', 'binding', 'operationId', 'producer']);
        if (operation.schema !== 'swb.workspace-recovery-operation' || operation.version !== version || operation.producer !== 'close-content-preservation' || operation.operationId !== operationId || !same(operation.binding, binding)) throw new Error('Unsupported operation record');
        let generationDirectory: Awaited<ReturnType<typeof fs.opendir>>;
        try { generationDirectory = await fs.opendir(path.join(opDir, 'generations')); }
        catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'){pendingInventory=true;continue;}throw error;}
        let generationCount = 0;
        for await (const generationEntry of generationDirectory) {
          const generationId = generationEntry.name;
          generationCount += 1;
          if (!safeId(generationId)) throw new Error('Unsafe generation id');
          const prefix = `${op}/generations/${generationId}`, dir = path.join(base, prefix);
          dirs.add(prefix); dirs.add(`${prefix}/assets`);
          allowed.add(`${prefix}/content.json`); allowed.add(`${prefix}/sealed.json`);
          let sealed = true;
          for (const fixed of ['content.json', 'sealed.json']) {
            try { await fs.lstat(path.join(dir, fixed)); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; sealed = false; }
          }
          if (!sealed) { pendingInventory = true; continue; }
          const retained = await json(path.join(dir, 'content.json'), binding.root);
          const content: Content = retained.value;
          keys(content, ['schema', 'version', 'binding', 'operationId', 'generationId', 'parent', 'revision', 'projectRaw', 'viewState', 'scriptState', 'effectFacts', 'continuationState', 'assets', 'requiredAssetIds', ...(partition === undefined ? [] : ['globalPrevious', 'sourcePolicy'])]);
          if (content.schema !== 'swb.workspace-recovery-content' || content.version !== version || content.operationId !== operationId || content.generationId !== generationId || !same(content.binding, binding)) throw new Error('Content association mismatch');
          if (partition !== undefined && recoveryPolicyKey(content.sourcePolicy) !== partition) throw new Error('Capture contributor policy/partition mismatch');
          if (content.parent !== null) {
            if (typeof content.parent !== 'object' || Array.isArray(content.parent)) throw new Error('Invalid recovery content parent');
            keys(content.parent, ['operationId', 'generationId', 'sealDigest']);
          }
          const sealedRecord = await json(path.join(dir, 'sealed.json'), binding.root);
          const seal = sealedRecord.value;
          keys(seal, ['schema', 'version', 'operationId', 'generationId', 'contentDigest']);
          if (seal.schema !== 'swb.workspace-recovery-seal' || seal.version !== version || seal.operationId !== operationId || seal.generationId !== generationId || seal.contentDigest !== retained.digest) throw new Error('Seal association mismatch');
          if (!Array.isArray(content.assets) || content.assets.length > budget!.assets || !Array.isArray(content.requiredAssetIds)) throw new Error('Asset budget/schema');
          const ids = new Set<string>();
          for (const asset of content.assets) {
            keys(asset, ['assetId', 'role', 'width', 'height', 'encoding', 'file', 'length', 'digest']);
            if (!safeId(asset.assetId) || ids.has(asset.assetId) || asset.file !== `${asset.assetId}.bin`) throw new Error('Asset identity mismatch');
            ids.add(asset.assetId); allowed.add(`${prefix}/assets/${asset.file}`);
            const bytes = await read(path.join(dir, 'assets', asset.file), binding.root);
            if (bytes.length !== asset.length || digest(bytes) !== asset.digest) throw new Error('Retained asset corrupt');
            await validateRaster(bytes, asset);
          }
          if (new Set(content.requiredAssetIds).size !== content.requiredAssetIds.length || content.requiredAssetIds.some(id => !ids.has(id))) throw new Error('Required asset missing');
          generations.set(`${operationId}/${generationId}`, { content, ack: { operationId, generationId, sealDigest: sealedRecord.digest, contentDigest: retained.digest, revision: content.revision } });
        }
        if (!generationCount) { pendingInventory = true; continue; }
      }
      const incompleteInventory = pendingInventory || observed.files.some(item => !allowed.has(item)) || observed.directories.some(item => !dirs.has(item)) || observed.files.length !== allowed.size || observed.directories.length !== dirs.size;
      if (!generations.size) return { state: 'protectedIncomplete', issue: 'No sealed content' };
      const reference = (parent: Parent): RecoveryCaptureReference => ({ format: 'v1', policyKey: null,
        operationId: parent.operationId, generationId: parent.generationId, sealDigest: parent.sealDigest });
      const tip = certifyRecoveryCaptureChain([...generations.values()].map(value => ({
        reference: reference(value.ack),
        globalPrevious: value.content.parent === null ? null : reference(value.content.parent),
        localParent: value.content.parent === null ? null : reference(value.content.parent),
        value
      }))).value;
      await checkBinding(binding);
      return { state: incompleteInventory ? 'protectedIncomplete' : 'protectedReadable', ...(incompleteInventory ? { issue: 'Unknown/orphan/partial inventory remains protected; certified content chain only, not an inventory winner' } : {}), ...tip, captures: [...generations.values()] };
    } catch (error) { return { state: 'protectedUninspectable', issue: String(error) }; }
  };
  const inspect = async (requested: string): Promise<RecoveryInspection> => {
    requireEnabled();
    let binding: Binding;
    try { binding = await bindingFor(requested); } catch (error) { return { state: 'protectedIdentityConflict', issue: String(error) }; }
    try {
      const before = await accounting(binding.root, budget!);
      const result = await inspectContent(binding.root);
      const after = await accounting(binding.root, budget!);
      await checkBinding(binding);
      if (before.fingerprint !== after.fingerprint || before.bytes !== after.bytes || before.records !== after.records) throw new Error('Joint recovery inventory changed during inspection');
      return result;
    } catch (error) { return { state: 'protectedUninspectable', issue: String(error) }; }
  };
  const mkdir = async (target: string, root: string) => {
    await fs.mkdir(target, { mode: 0o700 }); await identity(target, true); await certify(target, root, 'directory');
  };
  const publish = async (target: string, bytes: Buffer, root: string, binding: Binding) => {
    await checkBinding(binding);
    const source = `${target}.staging-${randomUUID()}`;
    const handle = await fs.open(source, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    const stat = await handle.stat(); const owned = { dev: stat.dev, ino: stat.ino };
    try {
      await fault?.('created', source); await certify(source, root, 'beforeBytes'); await checkBinding(binding);
      if (!same(owned, await identity(source))) throw new Error('Owned staging identity changed');
      const result = await handle.write(bytes, 0, bytes.length, 0);
      if (result.bytesWritten !== bytes.length) throw new Error('Short sidecar write');
      await fault?.('written', source);
    } finally { await handle.close(); }
    await fault?.('closed', source);
    if (!(await read(source, root)).equals(bytes)) throw new Error('Staging readback mismatch');
    await fs.link(source, target); await fault?.('linked', target);
    const published = await fs.lstat(target);
    if (published.dev !== owned.dev || published.ino !== owned.ino || published.nlink !== 2) throw new Error('Link publication receipt mismatch');
    await fs.unlink(source); // Only release this exact owned publication source; never GC or delete backup.
    await fault?.('sourceReleased', target);
    if (!same(owned, await identity(target)) || !(await read(target, root)).equals(bytes)) throw new Error('Published readback mismatch');
    await fault?.('readback', target); await checkBinding(binding);
  };
  const retainLocked = async (caller: RecoveryCaller, requested: string, offer: RecoveryOffer, onFailure?: ReservationFailureHandler): Promise<Ack> => {
    requireEnabled();
    if (!caller || ['sender', 'frame', 'window', 'document'].some(key => !(caller as any)[key] || typeof (caller as any)[key] !== 'object')) throw new Error('Actual caller objects required');
    // Caller objects are a port contract, not certified Electron event binding in this content-only slice.
    const detached = parseControlledJSON(boundedJSON({ ...offer, assets: [] }, budget!.jsonDepth));
    if (!offer.revision || offer.assets.length > budget!.assets || new Set(offer.assets.map(asset => asset.assetId)).size !== offer.assets.length) throw new Error('Capture asset/revision budget');
    if (new Set(offer.requiredAssetIds).size !== offer.requiredAssetIds.length || offer.requiredAssetIds.some(id => !offer.assets.some(asset => asset.assetId === id))) throw new Error('Missing required bytes');
    if (offer.assets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0) > budget!.bytes) throw new Error('Pinned asset byte budget exceeded');
    const pinned = offer.assets.map(asset => ({ ...asset, bytes: copyControlledBuffer(asset.bytes) }));
    if (pinned.some(asset => !safeId(asset.assetId) || !Number.isSafeInteger(asset.width) || asset.width <= 0 || !Number.isSafeInteger(asset.height) || asset.height <= 0)) throw new Error('Invalid asset descriptor');
    for (const asset of pinned) await validateRaster(asset.bytes, asset);
    const binding = await bindingFor(requested), root = binding.root;
    const before = await inspect(root);
    if (before.state !== 'protocolAbsent' && before.state !== 'protectedReadable' && !(before.state === 'protectedIncomplete' && (before.ack && before.content || allowUnsealedStart))) throw new Error(`Retention refused: ${before.state} ${before.issue ?? ''}`);
    const base = path.join(root, '.storyboard-workbench', namespace);
    const existing = before.state === 'protocolAbsent' ? { bytes: 0, files: [], directories: [] } : await inventory(base, root);
    const operationId = randomUUID(), generationId = randomUUID();
    const content: Content = { ...detached, schema: 'swb.workspace-recovery-content', version, binding, operationId, generationId, ...(partition === undefined ? {} : { globalPrevious, sourcePolicy: capturePolicy }), parent: before.ack ? { operationId: before.ack.operationId, generationId: before.ack.generationId, sealDigest: before.ack.sealDigest } : null,
      assets: pinned.map(({ bytes, ...asset }) => ({ ...asset, file: `${asset.assetId}.bin`, length: bytes.length, digest: digest(bytes) })) };
    const contentBytes = boundedJSON(content, budget!.jsonDepth);
    const seal = boundedJSON({ schema: 'swb.workspace-recovery-seal', version, operationId, generationId, contentDigest: digest(contentBytes) }, budget!.jsonDepth);
    const op = boundedJSON({ schema: 'swb.workspace-recovery-operation', version, binding, operationId, producer: 'close-content-preservation' }, budget!.jsonDepth);
    const ns = boundedJSON({ schema: 'swb.workspace-recovery-namespace', version, binding, ...(partition === undefined ? {} : {policyKey: partition}), ...(sourcePolicy === undefined ? {} : {sourcePolicy}) }, budget!.jsonDepth);
    const missing=(name:string)=>!existing.files.includes(name)&&!existing.directories.includes(name);
    const anchorBytes=before.state==='protocolAbsent'||missing('namespace.json')?ns.length:0;
    const anchorRecords=(before.state==='protocolAbsent'||missing('namespace.json')?1:0)+(before.state==='protocolAbsent'||missing('operations')?1:0);
    const addedBytes = pinned.reduce((sum, a) => sum + a.bytes.length, 0) + contentBytes.length + seal.length + op.length + anchorBytes;
    const addedRecords = pinned.length + 7 + anchorRecords + 1; // transient exact publication source alias
    const publicationOverlap = pinned.reduce((peak, asset) => Math.max(peak, asset.bytes.length), Math.max(anchorBytes, contentBytes.length, seal.length, op.length));
    const reserve = (accounting as Partial<OriginWorkspaceAccounting>).reserve;
    let peakBytes = addedBytes + publicationOverlap;
    let peakRecords = addedRecords + (partition === undefined ? 1 : 3);
    const plannedContainers = new Set<string>();
    if (reserve) {
      // The production joint allocator reserves creation metadata as well as
      // bodies. A generic content-only port without that allocator retains its
      // legacy encoded-content contract; it is not production quota evidence.
      let attributeBytes = 0;
      if (capturePolicy !== undefined) {
        // Native finite-source policy certifies ACL absence. Every xattr name
        // and value is copied raw; base64 text length is not its disk charge.
        // This sizes storage only and does not cache current authorization.
        recoveryPolicyKey(capturePolicy);
        for (const [name, value] of Object.entries((capturePolicy as any).expected.xattrs as Record<string, string>)) attributeBytes += Buffer.from(name, 'base64').length + Buffer.from(value, 'base64').length;
      }
      if (!Number.isSafeInteger(attributeBytes)) throw new Error('Unknown recovery creation attribute budget');
      const filePeaks = [...pinned.map(asset => asset.bytes.length), contentBytes.length, seal.length, op.length, ...(anchorBytes ? [anchorBytes] : [])].map(bytes => Math.max(32768, bytes + attributeBytes));
      let newDirectories = 4 + Number(before.state === 'protocolAbsent') + Number(before.state === 'protocolAbsent' || missing('operations'));
      if (partition !== undefined && before.state === 'protocolAbsent') for (const container of [path.join(root, '.storyboard-workbench/workspace-recovery-v2'), path.dirname(base)]) {
        try { await identity(container, true); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; newDirectories++; plannedContainers.add(container); }
      }
      peakBytes = filePeaks.reduce((sum, bytes) => sum + bytes, newDirectories * 32768) + filePeaks.reduce((peak, bytes) => Math.max(peak, bytes), 0);
      peakRecords = Math.max(peakRecords, filePeaks.length + newDirectories + 1);
    }
    const workspace = await accounting(root, budget!);
    if (!Number.isSafeInteger(workspace.bytes) || workspace.bytes < 0 || !Number.isSafeInteger(workspace.records) || workspace.records < 0 || !/^[a-f0-9]{64}$/.test(workspace.fingerprint)) throw new Error('Unknown joint recovery accounting budget');
    // Reserve all this generation before the first sidecar effect; no workspace effect here.
    // The operation's serialized lock retains this finite peak reservation until
    // all writes settle. Failed materialization remains charged on the next scan.
    if (!Number.isSafeInteger(peakBytes) || !Number.isSafeInteger(peakRecords) || workspace.bytes + peakBytes > budget!.bytes || workspace.records + peakRecords > budget!.records) throw new Error('Accumulated recovery workspace budget exceeded');
    const quote = await (accounting as Partial<OriginWorkspaceAccounting>).quote?.(root, budget!, peakBytes, peakRecords, capturePolicy);
    const materialize = async (): Promise<Ack> => {
    if (before.state === 'protocolAbsent') {
      if (partition !== undefined) {
        for (const container of [path.join(root, '.storyboard-workbench/workspace-recovery-v2'), path.dirname(base)]) {
          try { await identity(container, true); await certify(container, root, 'directory'); }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            if (reserve && !plannedContainers.has(container)) throw new Error('Recovery creation directory plan changed');
            await mkdir(container, root);
          }
        }
      }
      await mkdir(base, root); await publish(path.join(base, 'namespace.json'), ns, root, binding); await mkdir(path.join(base, 'operations'), root);
    }
    else if (allowUnsealedStart && before.state === 'protectedIncomplete' && !before.ack) {
      // Fill only absent protocol anchor names, never overwrite partial files,
      // remove aliases, elect an inventory winner, or relax native permissions.
      try { await fs.lstat(path.join(base,'namespace.json')); }
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(reserve&&!anchorBytes)throw new Error('Recovery creation file plan changed');await publish(path.join(base,'namespace.json'),ns,root,binding);}
      try { await fs.lstat(path.join(base,'operations')); }
      catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(reserve&&!missing('operations'))throw new Error('Recovery creation directory plan changed');await mkdir(path.join(base,'operations'),root);}
    }
    const opDir = path.join(base, 'operations', operationId);
    await mkdir(opDir, root); await publish(path.join(opDir, 'operation.json'), op, root, binding);
    await mkdir(path.join(opDir, 'generations'), root);
    const genDir = path.join(opDir, 'generations', generationId);
    await mkdir(genDir, root); await mkdir(path.join(genDir, 'assets'), root);
    for (const asset of pinned) await publish(path.join(genDir, 'assets', `${asset.assetId}.bin`), asset.bytes, root, binding);
    await publish(path.join(genDir, 'content.json'), contentBytes, root, binding);
    await publish(path.join(genDir, 'sealed.json'), seal, root, binding);
    const final = await inspect(root);
    if ((final.state !== 'protectedReadable' && final.state !== 'protectedIncomplete') || final.ack?.generationId !== generationId || final.ack.revision !== offer.revision) throw new Error('Latest retained generation not certified');
    return final.ack;
    };
    return reserve ? quote ? reserve(root, budget!, peakBytes, peakRecords, materialize, onFailure, quote) : onFailure ? reserve(root, budget!, peakBytes, peakRecords, materialize, onFailure) : reserve(root, budget!, peakBytes, peakRecords, materialize) : materialize();
  };
  const retain = (caller: RecoveryCaller, requested: string, offer: RecoveryOffer, onFailure?: ReservationFailureHandler): Promise<Ack> => withLayerFileOperation(() => {
    const run = (accounting as Partial<OriginWorkspaceAccounting>).run;
    return run ? run(() => retainLocked(caller, requested, offer, onFailure)) : retainLocked(caller, requested, offer, onFailure);
  });
  return {
    retain,
    inspectReadonly: (requested: string) => withLayerFileOperation(() => inspect(requested)),
    // Main-only historical reader. Selection is from the fully certified local
    // chain, never a supplied filesystem destination or a new inventory winner.
    readCapture: (requested: string, reference: RecoveryCaptureReference) => withLayerFileOperation(async () => {
      keys(reference, ['format', 'policyKey', 'operationId', 'generationId', 'sealDigest']);
      if (reference.format !== (version === 1 ? 'v1' : 'v2') || reference.policyKey !== (partition ?? null)) throw new Error('Historical capture partition mismatch');
      const binding = await bindingFor(requested), beforeInventory = await accounting(binding.root, budget!);
      const select = (state: RecoveryInspection) => {
        if (!['protectedReadable', 'protectedIncomplete'].includes(state.state)) throw new Error('Certified historical capture chain required');
        const matches = state.captures?.filter(c => c.ack.operationId === reference.operationId && c.ack.generationId === reference.generationId && c.ack.sealDigest === reference.sealDigest) ?? [];
        if (matches.length !== 1) throw new Error('Exact certified historical capture required');
        return matches[0];
      };
      const state = await inspect(requested), capture = select(state), assets = new Map<string, Buffer>();
      for (const asset of capture.content.assets) {
        const bytes = await read(path.join(binding.root, '.storyboard-workbench', namespace, 'operations', capture.ack.operationId, 'generations', capture.ack.generationId, 'assets', asset.file), binding.root);
        if (bytes.length !== asset.length || digest(bytes) !== asset.digest) throw new Error('Historical retained asset changed during full readback');
        assets.set(asset.assetId, bytes);
      }
      const after = await inspect(requested), reread = select(after);
      const afterInventory = await accounting(binding.root, budget!); await checkBinding(binding);
      if (!same(capture.ack, reread.ack) || !same(state.ack, after.ack) || beforeInventory.fingerprint !== afterInventory.fingerprint || beforeInventory.bytes !== afterInventory.bytes || beforeInventory.records !== afterInventory.records) throw new Error('Historical capture or joint inventory changed during readback');
      return { ...capture, assets };
    }),
    readAssets: (requested: string, generationId: string) => withLayerFileOperation(async () => {
      const binding = await bindingFor(requested), inventory = await accounting(binding.root, budget!);
      const state = await inspect(requested);
      if ((state.state !== 'protectedReadable' && state.state !== 'protectedIncomplete') || state.content?.generationId !== generationId || !state.ack) throw new Error('Exact latest readable generation required');
      const content = state.content, result = new Map<string, Buffer>();
      for (const asset of content.assets) {
        const bytes = await read(path.join(content.binding.root, '.storyboard-workbench', namespace, 'operations', content.operationId, 'generations', generationId, 'assets', asset.file), content.binding.root);
        if (bytes.length !== asset.length || digest(bytes) !== asset.digest) throw new Error('Retained asset changed during batch readback');
        result.set(asset.assetId, bytes);
      }
      const after = await inspect(requested);
      if (after.ack?.generationId !== generationId || after.ack.sealDigest !== state.ack.sealDigest) throw new Error('Retained generation changed during batch readback');
      const finalInventory = await accounting(binding.root, budget!); await checkBinding(binding);
      if (inventory.fingerprint !== finalInventory.fingerprint || inventory.bytes !== finalInventory.bytes || inventory.records !== finalInventory.records) throw new Error('Joint recovery inventory changed during asset readback');
      return result;
    }),
    readAsset: (requested: string, generationId: string, assetId: string) => withLayerFileOperation(async () => {
      const binding = await bindingFor(requested), inventory = await accounting(binding.root, budget!);
      const state = await inspect(requested);
      if ((state.state !== 'protectedReadable' && state.state !== 'protectedIncomplete') || state.content?.generationId !== generationId) throw new Error('Exact latest readable generation required');
      const asset = state.content.assets.find(item => item.assetId === assetId);
      if (!asset) throw new Error('Unknown retained asset');
      const bytes = await read(path.join(state.content.binding.root, '.storyboard-workbench', namespace, 'operations', state.content.operationId, 'generations', generationId, 'assets', asset.file), state.content.binding.root);
      if (bytes.length !== asset.length || digest(bytes) !== asset.digest) throw new Error('Retained asset changed during single readback');
      const finalInventory = await accounting(binding.root, budget!); await checkBinding(binding);
      if (inventory.fingerprint !== finalInventory.fingerprint || inventory.bytes !== finalInventory.bytes || inventory.records !== finalInventory.records) throw new Error('Joint recovery inventory changed during asset readback');
      return bytes;
    })
  };
};
