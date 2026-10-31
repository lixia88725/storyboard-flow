import { canonicalJson } from '../core/persistence/canonicalJson.js';
import { isDeepStrictEqual } from 'node:util';
import { validRefreshTransition } from '../shared/flowRefresh.js';
import { pixelDigest, imagePixelDigests, reconcileTiffPixels } from './flowPixelIdentity.js';
import { admitTiffCandidate } from '../core/formats/index.js';
import type { FlowAssetDepot } from '../shared/flowWave2.js';
import { createOutputObservation } from './flowOutputObservation.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { OUTPUT_LEDGER_LIMIT, assertOutputLedgerBudget, orderedOutputNames, preflightOutputNames, prepareOutputRename, settleOutputRename, validOutputRename, type OutputRename } from './flowOutputRename.js';
import { createOutputTrash, validOutputDeletion, type OutputDeletion, type TrashItem } from './flowOutputTrash.js';
import { outputPath, settleOutputMove, type OutputMove } from './flowOutputMove.js';
import { snapshotProject } from '../core/persistence/validate.js';
import type { AssetReaderV1, ProjectV1, ImageDocumentV1 } from '../shared/refactorV1.js';
import type { TiffCodec } from '../core/formats/index.js';
import { writeManagedSourceFile } from './managedSourceSave.js';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate.js';

const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const digest = (s: unknown): s is string => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);
const leaf = (s: unknown): s is string => typeof s === 'string' && /^[^\\/\0]+\.tiff?$/i.test(s) && !s.startsWith('.');
const id = (s: unknown): s is string => typeof s === 'string' && /^[\w-]{1,80}$/.test(s);
export type ExternalTiffObservation = { shotId: string; name: string; location: 'active' | 'parked'; status: 'changed' | 'missing'; digest: string | null; localOutputChanges: boolean };
const contentDigest = (project: ProjectV1, shot: ProjectV1['shots'][number]) => hash(Buffer.from(JSON.stringify({
  image: project.images[shot.imageId], text: { projectId: project.id, projectName: project.name, shotId: shot.id,
    shotName: shot.name, scriptText: shot.scriptText, dialogues: project.dialogues.filter(d => d.shotId === shot.id) }
})));
type Entry = { baseline?: ImageDocumentV1; pixelHashes?: Record<string,string>; published?: boolean; shotId: string; name: string; original: string | null; current: string | null; pending?: string; location?: 'active' | 'parked'; move?: OutputMove; content?: string; deletion?: OutputDeletion; retired?: 'trashed' | 'absent-unpublished' };
export type TiffSourceBinding = { pixelHashes?:Record<string,string>; shotId: string; name: string; digest: string; location?: 'active' | 'parked' };
type RefreshJournal = { beforeHash: string; after: ProjectV1; updates: { shotId: string; digest: string; baseline: ImageDocumentV1; pixelHashes: Record<string,string> }[]; complete: boolean };
type Ledger = { refresh?: RefreshJournal; version: 1; projectId: string; entries: Entry[]; rename?: OutputRename; saved?: { revision: number; projectHash: string } };
export type TiffSaveReceipt = { projectId: string; revision: number; projectHash: string; files: { shotId: string; name: string; digest: string }[] };
const read = async (file: string, limit = 128 * 1024 * 1024): Promise<Buffer> => {
  if (await fs.realpath(file) !== file) throw Error('Aliased output path refused');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink !== 1 || st.size > limit) throw Error('Unsupported output file');
    const bytes = await handle.readFile(); if (bytes.length > limit) throw Error('Output too large'); return bytes;
  } finally { await handle.close(); }
};
const optionalRead = async (file: string, limit?: number) => {
  try { return await read(file, limit); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
};

/** Explicit output only. Native policy/CAS writes, immutable originals and durable
 * per-file pending hashes. A partial failure never returns a Save receipt.
 * Caller serializes one writable project owner; roots/filenames never come from IPC. */
export async function openFlowTiffSave(root: string, projectId: string, codec: TiffCodec, trashItem?: TrashItem) {
  const canonical = await fs.realpath(root), identity = await fs.lstat(root);
  if (canonical !== root || !identity.isDirectory() || identity.isSymbolicLink() || !id(projectId)) throw Error('Invalid output root/project');
  const ledgerPath = path.join(root, '.storyboard-flow', 'tiff-output.json');
  let queue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(work: () => Promise<T>): Promise<T> => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const bind = async () => {
    const now = await fs.lstat(root);
    if (await fs.realpath(root) !== root || now.dev !== identity.dev || now.ino !== identity.ino || !now.isDirectory() || now.isSymbolicLink()) throw Error('Output root changed');
    await assertPhysicalWorkspaceWriterTargets([root]);
  };
  const observe = createOutputObservation(bind);
  const trash = createOutputTrash(root, projectId, identity, bind, trashItem);
  const validateImage = (image: ImageDocumentV1) => snapshotProject({schema:'storyboard-flow.project',version:1,id:projectId,name:'',revision:0,
    shots:[],parkedShots:[],dialogues:[],images:{[image.id]:image}});
  const projectHash = (project: ProjectV1) => hash(Buffer.from(canonicalJson(snapshotProject(project))));
  const load = async (): Promise<{ ledger: Ledger; bytes: Buffer | null }> => {
    await bind(); const bytes = await optionalRead(ledgerPath, OUTPUT_LEDGER_LIMIT);
    if (!bytes) return { ledger: { version: 1, projectId, entries: [] }, bytes };
    const ledger: Ledger = JSON.parse(bytes.toString());
    if (ledger.version !== 1 || ledger.projectId !== projectId || !Array.isArray(ledger.entries) || ledger.entries.length > 10000 ||
        ledger.entries.some(e => !e || !id(e.shotId) || !leaf(e.name) ||
          e.original !== null && !digest(e.original) || e.current !== null && !digest(e.current) ||
          e.pending !== undefined && !digest(e.pending) || e.content !== undefined && !digest(e.content) ||
          e.location !== undefined && !['active', 'parked'].includes(e.location) ||
          e.retired !== undefined && !['trashed', 'absent-unpublished'].includes(e.retired) ||
          e.retired !== undefined && (e.current !== null || e.pending !== undefined || e.content !== undefined || e.move !== undefined || e.deletion !== undefined) ||
          e.deletion !== undefined && (!validOutputDeletion(e.deletion) || e.deletion.digest !== e.current || e.deletion.from !== (e.location ?? 'active') || e.pending !== undefined || e.move !== undefined) ||
          e.move !== undefined && (!e.move || !['active', 'parked'].includes(e.move.from) ||
            !['active', 'parked'].includes(e.move.to) || e.move.from === e.move.to ||
            e.move.from !== (e.location ?? 'active') || !digest(e.move.digest) || e.move.digest !== e.current ||
            !/^\d+$/.test(e.move.dev) || !/^\d+$/.test(e.move.ino))) ||
        new Set(ledger.entries.map(e => e.shotId)).size !== ledger.entries.length || new Set(ledger.entries.filter(e => !e.retired).map(e => e.name.toLowerCase())).size !== ledger.entries.filter(e => !e.retired).length)
      throw Error('Invalid TIFF output ledger');
    if (ledger.rename !== undefined && (!validOutputRename(ledger.rename) || ledger.rename.files.some(f => !ledger.entries.some(e => e.shotId === f.shotId && !e.retired && !e.deletion && e.name === f.from && e.current === f.digest && (e.location ?? 'active') === 'active' && !e.move && !e.pending)))) throw Error('Invalid bound rename journal');
    for(const entry of ledger.entries){
      if(entry.baseline)validateImage(entry.baseline);
      if(entry.pixelHashes&&(!entry.baseline||Object.keys(entry.pixelHashes).length!==entry.baseline.layers.length||entry.baseline.layers.some(l=>!digest(entry.pixelHashes![l.id]))))throw Error('Invalid pixel baseline');
      if(entry.published!==undefined&&typeof entry.published!=='boolean')throw Error('Invalid source provenance');
    }
    if(ledger.refresh){
      const j=ledger.refresh;snapshotProject(j.after);
      if(!digest(j.beforeHash)||j.after.id!==projectId||typeof j.complete!=='boolean'||!Array.isArray(j.updates)||
        new Set(j.updates.map(u=>u.shotId)).size!==j.updates.length)throw Error('Invalid refresh journal');
      for(const u of j.updates){validateImage(u.baseline);if(!u.pixelHashes||Object.keys(u.pixelHashes).length!==u.baseline.layers.length||u.baseline.layers.some(l=>!digest(u.pixelHashes[l.id])))throw Error('Invalid refresh pixel baseline');if(!digest(u.digest)||!ledger.entries.some(e=>e.shotId===u.shotId&&!e.retired&&!e.deletion&&!e.move&&!e.pending))throw Error('Invalid bound refresh update');}
    }
    return { ledger, bytes };
  };
  const persist = async (ledger: Ledger, previous: Buffer | null) => {
    await bind(); const bytes = Buffer.from(JSON.stringify(ledger));
    if (bytes.length > OUTPUT_LEDGER_LIMIT) throw Error('TIFF output ledger exceeds the 8 MiB read/write limit');
    await writeManagedSourceFile(root, ledgerPath, bytes, previous ? { expectedDigest: hash(previous) } : { createOnly: true });
    return bytes;
  };
  const preserveOriginal = async (e: Entry, target: string) => {
    if (!e.original) return;
    const backup = path.join(root, '.storyboard-flow', 'originals', `${e.shotId}.tif`);
    const old = await optionalRead(backup);
    if (old) { if (hash(old) !== e.original) throw Error('Original backup mismatch'); }
    else {
      const original = await read(target);
      if (hash(original) !== e.original) throw Error('Missing original backup; refusing replacement');
      await bind(); await writeManagedSourceFile(root, backup, original, { createOnly: true, policySource: target });
    }
  };
  return {
    async hasPendingRefresh(){const j=(await load()).ledger.refresh;return !!j&&!j.complete;},
    refresh(project: ProjectV1, depot: FlowAssetDepot, checkpoint: {load():Promise<ProjectV1>; save(project:ProjectV1):Promise<void>}): Promise<ProjectV1> {
      const captured=snapshotProject(project);let publishing=false;
      return serialized(async()=>{
        if(captured.id!==projectId)throw Error('Different project');
        let {ledger,bytes}=await load();
        const resume=async(j:RefreshJournal)=>{
          publishing=true;
          // A prepared journal can outlive the depot incarnation. Re-admit its
          // bounded immutable bytes before checkpoint publication on recovery.
          for(const {baseline:image} of j.updates)for(const layer of image.layers){
            const png=await read(path.join(root,'.storyboard-flow/checkpoints/assets',layer.assetId+'.png'),64*1024*1024);
            if(hash(png)!==layer.assetId)throw Error('Retained refresh asset digest mismatch');
            const asset=await depot.put({operationId:'refresh_recover_'+randomUUID(),png,width:image.width,height:image.height});
            if(!asset.ok)throw Error(asset.error.message);
          }
          const disk=await checkpoint.load();
          if(!isDeepStrictEqual(disk,j.after)){
            if(projectHash(disk)!==j.beforeHash||!validRefreshTransition(disk,j.after))throw Error('Refresh checkpoint changed; retained');
            await checkpoint.save(j.after);
          }
          const verified=await checkpoint.load();
          if(!isDeepStrictEqual(verified,j.after))throw Error('Refresh checkpoint verification failed');
          for(const u of j.updates){const e=ledger.entries.find(e=>e.shotId===u.shotId)!;e.current=u.digest;e.baseline=u.baseline;e.pixelHashes=u.pixelHashes;delete e.content;}
          delete ledger.saved;j.complete=true;bytes=await persist(ledger,bytes);
          return structuredClone(j.after);
        };
        if(ledger.refresh&&!ledger.refresh.complete){
          if(projectHash(captured)!==ledger.refresh.beforeHash&&!isDeepStrictEqual(captured,ledger.refresh.after))throw Error('Retry the retained Refresh before editing');
          return resume(ledger.refresh);
        }
        const disk=await checkpoint.load();
        if(!isDeepStrictEqual(disk,captured)){
          if(ledger.refresh?.complete&&projectHash(captured)===ledger.refresh.beforeHash&&isDeepStrictEqual(disk,ledger.refresh.after))return structuredClone(disk);
          throw Error('Refresh requires the current durable checkpoint');
        }
        if(ledger.rename||ledger.entries.some(e=>e.pending||e.move||e.deletion))throw Error('Finish the pending Save transaction before Refresh');
        const after=structuredClone(captured),updates:RefreshJournal['updates']=[];
        let admittedBytes=0;
        for(const entry of ledger.entries){
          const shot=[...captured.shots,...captured.parkedShots].find(s=>s.id===entry.shotId);
          if(!shot||entry.retired||!entry.current)continue;
          const target=outputPath(root,entry.name,entry.location??'active');
          const observed=await observe(target);if(observed===entry.current)continue;
          if(!observed)throw Error('Source TIFF is missing: '+entry.name);
          if(!entry.baseline||!entry.pixelHashes)throw Error('Save this project before refreshing its sources');
          // Never bless a changed source while its first original is unavailable.
          const original=entry.original&&await optionalRead(path.join(root,'.storyboard-flow/originals',entry.shotId+'.tif'));
          if(entry.original&&(!original||hash(original)!==entry.original))throw Error('Original source snapshot is unavailable; retain both versions');
          const source=await read(target);if(hash(source)!==observed)throw Error('Source changed during Refresh');
          const decoded=await codec.decode(source);if(!decoded.ok)throw Error(decoded.error.message);
          const candidate=decoded.value;candidate.image.id=shot.imageId;
          const baseline=entry.baseline;
          let identified=candidate.identity==='portable';
          if(candidate.identity==='native'){
            const mapping=new Map(baseline.layers.map(l=>[entry.published?`native-${(createHash('sha256').update(l.id).digest().readUInt32BE(0)&0x7fffffff)||1}`:l.id,l]));
            identified=candidate.image.layers.every(l=>mapping.has(l.id));
            if(identified)for(const layer of candidate.image.layers){const known=mapping.get(layer.id)!;layer.id=known.id;layer.kind=known.kind;}
          }
          if(candidate.kind==='plain'&&!entry.published&&baseline.layers.length===1){candidate.image.layers[0].id=baseline.layers[0].id;candidate.image.layers[0].kind=baseline.layers[0].kind;identified=true;}
          if(identified&&candidate.identity==='portable'&&candidate.image.layers.some(l=>!baseline.layers.some(b=>b.id===l.id)))identified=false;
          for(const layer of candidate.image.layers)admittedBytes+=layer.png.byteLength;
          if(admittedBytes>512*1024*1024)throw Error('Refresh exceeds 512 MiB prepared asset budget');
          const admitted=await admitTiffCandidate(candidate,depot,'refresh_'+randomUUID());if(!admitted.ok)throw Error(admitted.error.message);
          const external=admitted.value;
          const {planned,externalPixels}=await reconcileTiffPixels(baseline,entry.pixelHashes,captured.images[shot.imageId],external,identified,async id=>{const r=await depot.read(id);if(!r.ok)throw Error(r.error.message);return r.value;});
          if(planned.kind==='replace')after.images[shot.imageId]=planned.image;
          if(planned.kind==='conflict'){
            const alternativeId=randomUUID(),imageId=randomUUID();
            after.images[imageId]={...external,id:imageId,revision:0};
            after.parkedShots.push({id:alternativeId,imageId,name:shot.name+' — External version',scriptText:shot.scriptText});
          }
          // Retain accepted external assets even where local edits won the merge.
          const retainedId=randomUUID();after.images[retainedId]={...external,id:retainedId};
          updates.push({shotId:shot.id,digest:observed,baseline:external,pixelHashes:externalPixels});
        }
        if(!updates.length)return captured;
        after.revision++;snapshotProject(after);if(!validRefreshTransition(captured,after))throw Error('Invalid prepared refresh transition');
        // Recheck all observed bytes before recording an acceptance intent.
        for(const u of updates){const e=ledger.entries.find(e=>e.shotId===u.shotId)!;if(hash(await read(outputPath(root,e.name,e.location??'active')))!==u.digest)throw Error('Source changed before refresh acceptance');}
        const j:RefreshJournal={beforeHash:projectHash(captured),after,updates,complete:false};
        ledger.refresh=j;delete ledger.saved;
        // Both durable states must fit before the first acceptance write. A larger
        // external baseline must not strand an already published checkpoint.
        const completed=structuredClone(ledger);completed.refresh!.complete=true;
        for(const u of updates){const e=completed.entries.find(e=>e.shotId===u.shotId)!;e.current=u.digest;e.baseline=u.baseline;e.pixelHashes=u.pixelHashes;delete e.content;}
        if(Math.max(Buffer.byteLength(JSON.stringify(ledger)),Buffer.byteLength(JSON.stringify(completed)))>OUTPUT_LEDGER_LIMIT)throw Error('TIFF refresh ledger exceeds the 8 MiB transaction budget');
        publishing=true;bytes=await persist(ledger,bytes);return resume(j);
      }).catch(error=>{if(publishing)throw Object.assign(new Error(error instanceof Error?error.message:String(error)),{refreshPending:true});throw error;});
    },
    hasPendingTrashAcknowledgements: trash.hasPendingAcknowledgements,
    /** Known outputs only: never resurrect locally removed shots or interpret new
     * root files as authority. Observation does not change ownership or project data. */
    inspectExternal(project: ProjectV1): Promise<ExternalTiffObservation[]> {
      const captured = snapshotProject(project);
      return serialized(async () => {
        if (captured.id !== projectId) throw Error('Different project');
        const { ledger } = await load();
        if (ledger.rename || ledger.entries.some(e => e.move || e.deletion || e.pending))
          throw Error('Finish the pending Save transaction before checking external edits');
        const observations: ExternalTiffObservation[] = [];
        const shots = new Map([...captured.shots, ...captured.parkedShots].map(s => [s.id, s]));
        for (const entry of ledger.entries) {
          const shot = shots.get(entry.shotId);
          if (entry.retired || !shot || !entry.current) continue;
          const actual = await observe(outputPath(root, entry.name, entry.location ?? 'active'));
          if (actual === entry.current) continue;
          observations.push({ shotId: entry.shotId, name: entry.name, location: entry.location ?? 'active',
            status: actual === null ? 'missing' : 'changed', digest: actual,
            localOutputChanges: entry.content !== contentDigest(captured, shot) });
        }
        return observations;
      });
    },
    /** Main/import-owned binding only. Never infer original ownership from a filename alone. */
    bindSources(project: ProjectV1, sources: readonly TiffSourceBinding[], readOriginal: (source: TiffSourceBinding) => Promise<Uint8Array> = source => read(outputPath(root, source.name, source.location ?? 'active'))) {
      const captured = snapshotProject(project), mappings = structuredClone(sources);
      return serialized(async () => {
        if (captured.id !== projectId) throw Error('Different project');
        const state = await load();
        if (state.bytes) throw Error('Source bindings already initialized');
        for (const source of mappings) {
          if (!id(source.shotId) || !leaf(source.name) || !digest(source.digest) || !['active', 'parked'].includes(source.location ?? 'active') ||
              !(source.location === 'parked' ? captured.parkedShots : captured.shots).some(s => s.id === source.shotId) ||
              state.ledger.entries.some(e => e.shotId === source.shotId || e.name.toLowerCase() === source.name.toLowerCase())) throw Error('Invalid source binding');
          const original=await readOriginal(source);if (hash(original) !== source.digest) throw Error('Source changed since import');
          let pixelHashes=source.pixelHashes;
          if(!pixelHashes){const decoded=await codec.decode(original);if(!decoded.ok)throw Error(decoded.error.message);pixelHashes={};for(const layer of decoded.value.image.layers)pixelHashes[layer.id]=await pixelDigest(layer.png);}
          const image=captured.images[[...captured.shots,...captured.parkedShots].find(s=>s.id===source.shotId)!.imageId];
          if(Object.keys(pixelHashes).length!==image.layers.length||image.layers.some(l=>!digest(pixelHashes![l.id])))throw Error('Invalid source pixel baseline');
          await writeManagedSourceFile(root,path.join(root,'.storyboard-flow/originals',source.shotId+'.tif'),Buffer.from(original),{createOnly:true});
          state.ledger.entries.push({ shotId: source.shotId, name: source.name, original: source.digest, current: source.digest, pixelHashes, baseline: captured.images[[...captured.shots,...captured.parkedShots].find(s=>s.id===source.shotId)!.imageId], published:false, location: source.location ?? 'active' });
        }
        await persist(state.ledger, null);
      });
    },
    save(project: ProjectV1, reader: AssetReaderV1): Promise<TiffSaveReceipt> {
      const captured = snapshotProject(project);
      return serialized(async () => {
        if (captured.id !== projectId) throw Error('Different project');
        let { ledger, bytes } = await load();
        if(ledger.refresh&&!ledger.refresh.complete)throw Error('Retry Refresh before Save');
        delete ledger.refresh;
        const recoverRename = async () => {
          if (!ledger.rename) return;
          await settleOutputRename(root, ledger.rename, async () => { bytes = await persist(ledger, bytes); }, bind);
          for (const file of ledger.rename.files) ledger.entries.find(e => e.shotId === file.shotId)!.name = file.to;
          delete ledger.rename;
          bytes = await persist(ledger, bytes);
        };
        await recoverRename();
        const retire = (entry: Entry, outcome: NonNullable<Entry['retired']>) => {
          entry.retired = outcome; entry.current = null;
          delete entry.content; delete entry.pending; delete entry.move; delete entry.deletion;
          delete ledger.saved;
        };
        // Finish only recorded effects, even when this Save follows an Undo.
        for (const entry of ledger.entries) if (entry.move) {
          await settleOutputMove(root, entry.name, entry.move, bind);
          entry.location = entry.move.to; delete entry.move;
          bytes = await persist(ledger, bytes);
        }
        for (const entry of ledger.entries) if (entry.deletion) {
          await trash.settle(entry.name, entry.deletion, async () => { bytes = await persist(ledger, bytes); });
          retire(entry, 'trashed'); bytes = await persist(ledger, bytes);
        }
        const allShots = [...captured.shots, ...captured.parkedShots];
        const wanted = new Set(allShots.map(s => s.id));
        for (const shot of allShots) {
          let entry = ledger.entries.find(e => e.shotId === shot.id);
          if (!entry || entry.retired) {
            const name = entry?.retired ? `${shot.id}-${randomUUID()}.tif` : `${shot.id}.tif`;
            if (ledger.entries.some(e => !e.retired && e.shotId !== shot.id && e.name.toLowerCase() === name.toLowerCase())) throw Error('Output name collision');
            if (!entry) { entry = { shotId: shot.id, name, original: null, current: null }; ledger.entries.push(entry); }
            entry.name = name; entry.current = null; delete entry.content; delete entry.pending; delete entry.retired;
            entry.location = captured.parkedShots.some(s => s.id === shot.id) ? 'parked' : 'active';
          }
        }
        if (ledger.entries.length > 10000) throw Error('TIFF output history exceeds 10000 entries; retained history is not automatically deleted');
        const live = () => ledger.entries.filter(e => !e.retired);
        const removed = live().filter(e => !wanted.has(e.shotId));
        const names = orderedOutputNames(captured, live().filter(e => wanted.has(e.shotId)));
        assertOutputLedgerBudget(ledger, names, removed.length * 1024);
        await preflightOutputNames(root, live(), names);
        const preflight = async () => {
          await bind();
          for (const entry of live()) {
            const content = await optionalRead(outputPath(root, entry.name, entry.location ?? 'active')); const actual = content && hash(content);
            if (actual !== entry.current && actual !== entry.pending) throw Error(`TIFF changed outside Flow: ${entry.name}`);
          }
        };
        await preflight();
        // Finish every codec/read failure before replacing any output file.
        const candidates: { entry: Entry; bytes?: Buffer; digest: string; content: string; pixelHashes?:Record<string,string> }[] = [];
        let total = 0;
        for (const shot of allShots) {
          const input = { image: captured.images[shot.imageId], text: { projectId, projectName: captured.name,
            shotId: shot.id, shotName: shot.name, scriptText: shot.scriptText, dialogues: captured.dialogues.filter(d => d.shotId === shot.id) } };
          const entry = ledger.entries.find(e => e.shotId === shot.id)!;
          const content = hash(Buffer.from(JSON.stringify(input)));
          if (entry.baseline && entry.pixelHashes && entry.published && entry.content === content && entry.current && !entry.pending) {
            candidates.push({ entry, digest: entry.current, content }); continue;
          }
          const pixelCache=new Map<string,Uint8Array>();
          const encoded = await codec.encode(input, async id=>{const bytes=await reader(id);pixelCache.set(id,bytes);return bytes;});
          if (!encoded.ok) throw Error(encoded.error.message);
          const output = Buffer.from(encoded.value); total += output.length;
          if (total > 512 * 1024 * 1024) throw Error('Prepared TIFF batch exceeds 512 MiB');
          candidates.push({ entry, bytes: output, digest: hash(output), content, pixelHashes:await imagePixelDigests(input.image,async id=>pixelCache.get(id)!) });
        }
        // Reserve all positive record growth, so every intermediate mixture of
        // old/new baselines plus pending/move/rename records fits before effects.
        let baselineGrowth=0;
        for(const candidate of candidates)if(candidate.bytes){
          const entry=candidate.entry,shot=allShots.find(s=>s.id===entry.shotId)!;
          const final={...entry,current:candidate.digest,baseline:captured.images[shot.imageId],pixelHashes:candidate.pixelHashes,published:true,content:candidate.content};
          baselineGrowth+=Math.max(0,Buffer.byteLength(JSON.stringify(final))-Buffer.byteLength(JSON.stringify(entry)));
        }
        assertOutputLedgerBudget(ledger,names,removed.length*1024+baselineGrowth);
        await preflight(); bytes = await persist(ledger, bytes);
        for (const entry of removed) {
          const target = outputPath(root, entry.name, entry.location ?? 'active');
          const present = await optionalRead(target), actual = present && hash(present);
          if (actual !== entry.current && actual !== entry.pending) throw Error('Deleted TIFF changed outside Flow');
          if (actual === null && entry.current === null && entry.original === null) {
            retire(entry, 'absent-unpublished'); bytes = await persist(ledger, bytes); continue;
          }
          if (!actual) throw Error('Deleted TIFF is missing; Trash not acknowledged');
          if (!trash.available()) throw Error('System Trash capability unavailable');
          await preserveOriginal(entry, target);
          entry.current = actual; delete entry.pending; delete ledger.saved;
          entry.deletion = await trash.prepare(entry.name, entry.location ?? 'active', actual);
          bytes = await persist(ledger, bytes);
          await trash.settle(entry.name, entry.deletion, async () => { bytes = await persist(ledger, bytes); });
          retire(entry, 'trashed'); bytes = await persist(ledger, bytes);
        }
        for (const candidate of candidates) {
          const e = candidate.entry, target = outputPath(root, e.name, e.location ?? 'active');
          await bind();
          await preserveOriginal(e, target);
          const current = await optionalRead(target), actual = current && hash(current);
          if (actual !== e.current && actual !== e.pending) throw Error('Output changed during Save');
          if (candidate.bytes) {
            e.pending = candidate.digest; delete ledger.saved; bytes = await persist(ledger, bytes);
            if (actual !== candidate.digest) { await bind(); await writeManagedSourceFile(root, target, candidate.bytes, actual === null ? { createOnly: true } : { expectedDigest: actual }); }
            if (hash(await read(target)) !== candidate.digest) throw Error('TIFF readback mismatch');
            e.current = candidate.digest; e.baseline=structuredClone(captured.images[allShots.find(s=>s.id===e.shotId)!.imageId]); e.published=true; e.pixelHashes=candidate.pixelHashes; e.content = candidate.content; delete e.pending; bytes = await persist(ledger, bytes);
          }
          const destination = captured.parkedShots.some(s => s.id === e.shotId) ? 'parked' : 'active';
          if (destination !== (e.location ?? 'active')) {
            const identity = await fs.lstat(target, { bigint: true });
            delete ledger.saved;
            e.move = { from: e.location ?? 'active', to: destination, digest: candidate.digest, dev: String(identity.dev), ino: String(identity.ino) };
            bytes = await persist(ledger, bytes);
            await settleOutputMove(root, e.name, e.move, bind);
            e.location = destination; delete e.move;
            bytes = await persist(ledger, bytes);
          }
        }
        await preflight();
        await preflightOutputNames(root, live(), names);
        const rename = await prepareOutputRename(root, live(), names);
        if (rename) {
          delete ledger.saved; ledger.rename = rename;
          bytes = await persist(ledger, bytes);
          await recoverRename();
        }
        await preflight();
        const projectHash = hash(Buffer.from(JSON.stringify(captured)));
        ledger.saved = { revision: captured.revision, projectHash }; await persist(ledger, bytes);
        return { projectId, revision: captured.revision, projectHash, files: candidates.map(c => ({ shotId: c.entry.shotId, name: path.relative(root, outputPath(root, c.entry.name, c.entry.location ?? 'active')), digest: c.digest })) };
      });
    }
  };
}
