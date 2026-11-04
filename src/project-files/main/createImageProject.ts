import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { namingIssue, orderedOutputNames } from '../../platform/contracts/flowNaming.js';
import { publishDirectoryExclusive } from '../../platform/main/platform/index.js';
import { flowCodecOptions } from '../../platform/main/flowRuntimePaths.js';
import { admitTiffCandidate, createTiffCodec, type TiffCodec } from './formats/index.js';
import { createPresentationCodec } from './formats/presentation.js';
import { openFlowAssetDepot } from './persistence/depot.js';
import { createProjectStore } from './persistence/index.js';
import { canonicalJson } from './persistence/canonicalJson.js';
import { imagePixelDigests } from './flowPixelIdentity.js';
import { openFlowTiffSave, type CreatedOutputBinding } from './flowTiffSave.js';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate.js';
import { convertImageSource, ImageSourceTooLargeError, readImageSource, scanImageSources, SOURCE_PIXEL_LIMIT, SOURCE_PNG_LIMIT, type ImageSourceIssue, type ReadSource, type ScannedSource } from './imageSourceConversion.js';
import type { AssetReaderV1, DialogueV1, ImageDocumentV1, ProjectNamingV1, ProjectV1 } from '../../platform/contracts/refactorV1.js';

export type CreateImageProjectInput = {
  source: { kind: 'files'; files: string[] } | { kind: 'folder'; folder: string };
  destinationParent: string;
  folderName: string;
  name: string;
  naming: ProjectNamingV1;
};
export type CreateImageProjectOptions = {
  signal: AbortSignal;
  /** `phase` distinguishes the decode pass from the TIFF write pass. The final
   * write event is emitted only after the published project passed verification. */
  onProgress?: (progress: { done: number; total: number; phase?: 'read' | 'write' }) => void;
  decideIssues?: (issues: ImageSourceIssue[]) => Promise<'continue' | 'cancel'>;
};

const MAX_PREPARED_BYTES = 512 * 1024 * 1024;
const STAGE_PREFIX = '.flow-create-';
const get = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!result.ok) throw Error(result.error.message);
  return result.value;
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const cancelled = (message: string) => Object.assign(new Error(message), { name: 'AbortError' });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
};

/** Destination of a creation: an existing canonical parent plus a new leaf that
 * must not exist under any casing. Nothing is created here. */
async function bindDestination(destinationParent: string, folderName: string) {
  if (typeof destinationParent !== 'string' || !destinationParent || destinationParent.includes('\0') || !path.isAbsolute(destinationParent))
    throw Error('Destination parent must be an absolute path');
  const parent = path.resolve(destinationParent);
  const entry = await fs.lstat(parent).catch(error => {
    if (isMissing(error)) throw Error(`Destination parent does not exist: ${parent}`);
    throw error;
  });
  if (!entry.isDirectory() || entry.isSymbolicLink() || await fs.realpath(parent) !== parent)
    throw Error(`Destination parent must be a real canonical directory: ${parent}`);
  if (typeof folderName !== 'string' || !folderName || folderName.includes('\0') ||
      folderName.includes('/') || folderName.includes('\\') || folderName === '.' || folderName === '..' || folderName.startsWith('.'))
    throw Error('Project folder name must be one plain path segment');
  const target = path.join(parent, folderName);
  if (path.dirname(target) !== parent || path.basename(target) !== folderName) throw Error('Project folder name must be one plain path segment');
  // Case folding is checked explicitly: a case-insensitive volume reports some
  // collisions through lstat, a case-sensitive one through the listing only.
  if ((await fs.readdir(parent)).some(name => name.toLowerCase() === folderName.toLowerCase()))
    throw Error(`Destination already exists; choose a new folder name: ${target}`);
  return { parent, target };
}

function bindInput(input: CreateImageProjectInput): { naming: ProjectNamingV1; name: string } {
  if (!input || typeof input !== 'object') throw Error('Project creation input is required');
  if (!input.naming || typeof input.naming !== 'object') throw Error('Naming settings are required');
  const { sceneCode, artistName, version } = input.naming;
  if (typeof input.name !== 'string' || typeof sceneCode !== 'string' || typeof artistName !== 'string' || typeof version !== 'string')
    throw Error('Project name and naming fields must be strings');
  const naming = { sceneCode, artistName, version };
  // Shared with Save: creation never substitutes defaults for empty naming.
  const issue = namingIssue(input.name, naming);
  if (issue) throw Error(issue);
  return { naming, name: input.name };
}

type Prepared = {
  source: ScannedSource;
  /** Digest of the exact source bytes converted; PNG pixels stay only in the depot. */
  digest: string;
  kind: 'raster' | 'tiff';
  image: ImageDocumentV1;
  shotId: string;
};

/**
 * Create a new project folder from JPEG/PNG/reliable TIFF sources.
 *
 * Everything is derived inside a private stage on the destination's filesystem
 * and published as one exclusive directory rename. Sources are only ever read;
 * a cancel, collision or source change removes the stage after confirming its
 * identity and never touches the source. All working TIFFs are written at their
 * final project-rule names (…_0010 sequence) before publication, so the returned
 * project opens, saves and reopens without its sources. Problems and accepted
 * degradations are reported once through `decideIssues`; a refusal that cannot be
 * composed reliably is never flattened silently.
 */
export async function createImageProject(input: CreateImageProjectInput, options: CreateImageProjectOptions): Promise<{ root: string }> {
  const { naming, name } = bindInput(input);
  if (!options || typeof options !== 'object' || !options.signal || typeof options.signal.aborted !== 'boolean')
    throw Error('An AbortSignal is required');
  if (options.signal.aborted) throw cancelled('创建已取消');
  const { target } = await bindDestination(input.destinationParent, input.folderName);
  const sources = await scanImageSources(input.source);
  // A single-file selection must obey the same rule as a folder selection: the
  // new project may not be created inside the folder that holds a source image.
  const sourceFolders = input.source.kind === 'folder' ? [input.source.folder] : [...new Set(sources.map(entry => path.dirname(entry.file)))];
  for (const folder of sourceFolders) if (inside(folder, target))
    throw Error('The new project folder must be created outside the source folder');
  await assertPhysicalWorkspaceWriterTargets([target]);

  const rawCodec: TiffCodec = createTiffCodec(flowCodecOptions());
  const codec: TiffCodec = createPresentationCodec(rawCodec);
  const store = createProjectStore();
  let stage: string | undefined, identity: { dev: bigint; ino: bigint } | undefined, published = false;
  // Everything the private stage may legitimately contain; the failure cleanup
  // deletes only a stage whose entire content is accounted for here.
  let ownedProject: ProjectV1 | undefined;
  const prepared: Prepared[] = [], bindings: CreatedOutputBinding[] = [], ownedAssets = new Set<string>();
  try {
    stage = await fs.mkdtemp(path.join(path.dirname(target), STAGE_PREFIX));
    const stageEntry = await fs.lstat(stage, { bigint: true });
    identity = { dev: stageEntry.dev, ino: stageEntry.ino };
    const depot = get(await openFlowAssetDepot({ root: stage, sessionId: randomUUID(), maxPixels: SOURCE_PIXEL_LIMIT, maxPngBytes: SOURCE_PNG_LIMIT }));
    const readAsset: AssetReaderV1 = async id => get(await depot.read(id));
    const project: ProjectV1 = { schema: 'storyboard-flow.project', version: 1, id: randomUUID(), name,
      naming, revision: 0, shots: [], parkedShots: [], dialogues: [], images: {} };
    ownedProject = project;
    const issues: ImageSourceIssue[] = [];
    let preparedBytes = 0;

    for (const [index, source] of sources.entries()) {
      if (options.signal.aborted) throw cancelled('创建已取消');
      let read: ReadSource;
      try { read = await readImageSource(source); }
      catch (error) {
        // A single oversized file is a confirmable skip, not a batch failure.
        // Every other read refusal (alias, identity race) stays fatal.
        if (!(error instanceof ImageSourceTooLargeError)) throw error;
        issues.push({ file: source.file, reason: error.message, action: 'skip' });
        options.onProgress?.({ done: index + 1, total: sources.length, phase: 'read' });
        continue;
      }
      const conversion = await convertImageSource(source, read, codec);
      if (!conversion.ok) {
        issues.push({ file: source.file, reason: conversion.reason, action: 'skip' });
        options.onProgress?.({ done: index + 1, total: sources.length, phase: 'read' });
        continue;
      }
      const converted = conversion.value;
      if (conversion.degradations.length) issues.push({ file: source.file, reason: conversion.degradations.join('; '), action: 'flatten' });
      preparedBytes += read.bytes.byteLength;
      for (const layer of converted.layers) preparedBytes += layer.png.byteLength;
      if (preparedBytes > MAX_PREPARED_BYTES) throw Error(`Project creation exceeds the ${MAX_PREPARED_BYTES}-byte prepared budget`);
      const shotId = randomUUID();
      const dialogues: DialogueV1[] = (converted.text?.dialogues ?? []).map(dialogue => ({ id: randomUUID(), shotId, text: dialogue.text }));
      const candidate = {
        identity: 'unverified' as const,
        kind: converted.kind === 'tiff' ? 'layered' as const : 'plain' as const,
        image: { id: randomUUID(), revision: 0, width: converted.width, height: converted.height, layers: converted.layers },
        text: converted.text ? {
          projectId: project.id, projectName: project.name, shotId,
          shotName: converted.text.shotName, scriptText: converted.text.scriptText, dialogues,
          ...(converted.text.presentation ? { presentation: converted.text.presentation } : {})
        } : null
      };
      const image = get(await admitTiffCandidate(candidate, depot, `create_${shotId}`));
      for (const layer of image.layers) ownedAssets.add(layer.assetId);
      const presentation = converted.text?.presentation?.settings;
      project.images[image.id] = image;
      project.shots.push({ id: shotId, imageId: image.id, ...(presentation ? { presentation } : {}),
        name: converted.text?.shotName ?? path.parse(source.name).name, scriptText: converted.text?.scriptText ?? '' });
      project.dialogues.push(...dialogues);
      prepared.push({ source, digest: read.digest, kind: converted.kind, image, shotId });
      options.onProgress?.({ done: index + 1, total: sources.length, phase: 'read' });
    }

    // One central confirmation for defects and accepted degradations. Cancelling
    // here leaves the destination untouched and removes the private stage.
    if (issues.length) {
      if (!options.decideIssues) throw Error(`Some images need confirmation before a project can be created: ${issues.map(issue => `${path.basename(issue.file)} (${issue.action}): ${issue.reason}`).join('; ')}`);
      if (await options.decideIssues(issues) !== 'continue') throw cancelled('创建已取消');
    }
    if (!prepared.length) throw Error('No usable images remain after the confirmed issues; nothing was created');
    if (project.shots[0]?.presentation) project.presentation = structuredClone(project.shots[0].presentation);

    const names = orderedOutputNames(project, []);
    if (prepared.length !== project.shots.length || names.size !== prepared.length) throw Error('Created project naming is incomplete');
    for (const [index, item] of prepared.entries()) {
      if (options.signal.aborted) throw cancelled('创建已取消');
      const shot = project.shots.find(entry => entry.id === item.shotId)!;
      const outputName = names.get(item.shotId);
      if (!outputName) throw Error('Created project naming is incomplete');
      const text = { projectId: project.id, projectName: project.name, shotId: shot.id, shotName: shot.name,
        scriptText: shot.scriptText, dialogues: project.dialogues.filter(dialogue => dialogue.shotId === shot.id) };
      const encoded = await codec.encode({ image: item.image, text, ...(shot.presentation ? { presentation: shot.presentation } : {}) }, readAsset);
      if (!encoded.ok) throw Error(`${path.basename(item.source.file)}: ${encoded.error.message}`);
      const bytes = Buffer.from(encoded.value), outputDigest = digest(bytes);
      await fs.writeFile(path.join(stage, outputName), bytes, { flag: 'wx' });
      bindings.push({ shotId: item.shotId, name: outputName, digest: outputDigest,
        originalDigest: item.kind === 'tiff' ? item.digest : outputDigest,
        pixelHashes: await imagePixelDigests(item.image, readAsset),
        original: item.kind === 'tiff' ? 'source' : 'output' });
      if (index + 1 < prepared.length) options.onProgress?.({ done: index + 1, total: prepared.length, phase: 'write' });
    }

    const output = await openFlowTiffSave(stage, project.id, rawCodec);
    const sourceById = new Map(prepared.map(item => [item.shotId, item.source]));
    await output.bindCreatedOutputs(project, bindings, async shotId => (await readImageSource(sourceById.get(shotId)!)).bytes);
    get(await store.saveCheckpoint(stage, project, readAsset));

    // Sources must still be exactly what was converted; a folder must still hold
    // the same direct children. Requirements are checked before publication.
    await verifySources(input.source, sources, prepared);
    if (options.signal.aborted) throw cancelled('创建已取消');
    if ((await fs.readdir(path.dirname(target))).some(entry => entry.toLowerCase() === path.basename(target).toLowerCase()))
      throw Error(`Destination appeared during creation; nothing was replaced: ${target}`);
    await assertPhysicalWorkspaceWriterTargets([target]);
    try {
      await publishDirectoryExclusive(stage, target);
      published = true;
    } catch (error) {
      // The native publication may already have renamed the stage before a later
      // directory flush failed. Judge only by the destination's identity: treating
      // it as unpublished would hide a project that now exists.
      const attached = identity ? await fs.lstat(target, { bigint: true }).catch(probe => { if (isMissing(probe)) return undefined; throw probe; }) : undefined;
      if (attached && attached.isDirectory() && !attached.isSymbolicLink() && attached.dev === identity.dev && attached.ino === identity.ino) {
        published = true;
        throw Error(`publication was renamed but its durability could not be confirmed: ${message(error)}`);
      }
      throw error;
    }

    const loaded = get(await store.loadCheckpoint(target));
    if (loaded.project.id !== project.id) throw Error('Published project identity mismatch');
    const verifier = await openFlowTiffSave(target, project.id, rawCodec);
    const status = await verifier.folderStatus({ project: loaded.project, inspectDisk: true });
    if (status !== 'current') throw Error(`Created project failed verification: ${status}`);
    const outputs = await fs.readdir(target);
    const expected = new Set(bindings.map(binding => binding.name));
    if (![...expected].every(entry => outputs.includes(entry))) throw Error('Created project is missing a working TIFF');
    options.onProgress?.({ done: prepared.length, total: prepared.length, phase: 'write' });
    return { root: target };
  } catch (error) {
    const cancelledError = (error as { name?: string })?.name === 'AbortError';
    // A published project is never removed. Verification runs against the
    // destination itself, so anyone (the user, another tool) may already have
    // added files there; reporting the location is the only safe outcome.
    if (published) {
      throw Object.assign(new Error(`Project published but verification failed: ${message(error)}; the created project is retained at ${target}`),
        { name: cancelledError ? 'AbortError' : 'Error' });
    }
    // Before publication the stage is private. It is removed only when every
    // entry in it was created by this call; foreign content means retention.
    let retained = stage, note = '';
    if (stage && identity) {
      try {
        const current = await fs.lstat(stage, { bigint: true }).catch(error => { if (isMissing(error)) return undefined; throw error; });
        if (!current) retained = undefined;
        else if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino) {
          note = `; the staging directory changed identity and was retained: ${stage}`;
        } else {
          const foreign = await unownedStageEntries(stage, { project: ownedProject, bindings, assets: ownedAssets });
          if (foreign.length) note = `; content not created here was found and the staging directory was retained at ${stage}: ${foreign.slice(0, 5).join(', ')}${foreign.length > 5 ? ', …' : ''}`;
          else { await fs.rm(stage, { recursive: true }); retained = undefined; }
        }
      } catch (cleanupError) {
        note = `; staging cleanup could not be confirmed (${message(cleanupError)}); retained: ${stage}`;
      }
    }
    throw Object.assign(new Error(`Project creation failed: ${message(error)}${note}${!note && retained ? `; retained output: ${retained}` : ''}`),
      { name: cancelledError ? 'AbortError' : 'Error' });
  }
}

type StageOwnership = { project: ProjectV1 | undefined; bindings: readonly CreatedOutputBinding[]; assets: ReadonlySet<string> };

/** Every entry the private stage may contain. Anything else is foreign and makes
 * the whole stage ineligible for deletion; nothing is removed by name alone. */
async function unownedStageEntries(stage: string, owned: StageOwnership): Promise<string[]> {
  const directories = new Set(['.storyboard-flow',
    path.join('.storyboard-flow', 'checkpoints'), path.join('.storyboard-flow', 'checkpoints', 'assets'),
    path.join('.storyboard-flow', 'checkpoints', 'versions'), path.join('.storyboard-flow', 'originals')]);
  const outputs = new Map(owned.bindings.map(binding => [binding.name, binding.digest]));
  const originals = new Map(owned.bindings.map(binding => [path.join('.storyboard-flow', 'originals', binding.shotId + '.tif'), binding.originalDigest]));
  const manifest = path.join('.storyboard-flow', 'checkpoints', 'project.json');
  const version = path.join('.storyboard-flow', 'checkpoints', 'versions', '0.json');
  const ledger = path.join('.storyboard-flow', 'tiff-output.json');
  const hashFile = async (file: string) => digest(await fs.readFile(file));
  const ownedFile = async (file: string, relative: string): Promise<boolean> => {
    const output = outputs.get(relative);
    if (output) return await hashFile(file) === output;
    const original = originals.get(relative);
    if (original) return await hashFile(file) === original;
    const asset = /^([a-f0-9]{64})\.png$/.exec(path.basename(relative));
    if (relative === path.join('.storyboard-flow', 'checkpoints', 'assets', path.basename(relative)) && asset && owned.assets.has(asset[1]))
      return await hashFile(file) === asset[1];
    try {
      if (relative === ledger) {
        const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
        if (!owned.project || parsed?.projectId !== owned.project.id || !Array.isArray(parsed.entries) || parsed.entries.length !== owned.bindings.length) return false;
        const entries = new Map(parsed.entries.map((entry: { shotId: string }) => [entry.shotId, entry]));
        return owned.bindings.every(binding => {
          const entry = entries.get(binding.shotId) as { name?: string; current?: string; original?: string } | undefined;
          return !!entry && entry.name === binding.name && entry.current === binding.digest && entry.original === binding.originalDigest;
        });
      }
      if (relative === manifest) {
        if (!owned.project) return false;
        return canonicalJson(JSON.parse(await fs.readFile(file, 'utf8'))) === canonicalJson(owned.project);
      }
      if (relative === version) {
        const [record, head] = [await fs.readFile(file), await fs.readFile(path.join(stage, manifest))];
        return record.equals(head);
      }
    } catch { return false; }
    return false;
  };
  const unexpected: string[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name), relative = path.relative(stage, full);
      if (entry.isSymbolicLink()) { unexpected.push(relative); continue; }
      if (entry.isDirectory()) {
        if (!directories.has(relative)) { unexpected.push(relative); continue; }
        await visit(full); continue;
      }
      if (!entry.isFile() || !await ownedFile(full, relative)) unexpected.push(relative);
    }
  };
  await visit(stage);
  return unexpected;
}

/** Compare every source with the bytes converted earlier, and re-list a folder so
 * additions/removals are detected. Never repairs or re-reads into the project. */
async function verifySources(source: CreateImageProjectInput['source'], scanned: readonly ScannedSource[], prepared: readonly Prepared[]) {
  if (source.kind === 'folder') {
    const again = await scanImageSources({ kind: 'folder', folder: source.folder });
    if (again.length !== scanned.length || again.some((entry, index) => entry.file !== scanned[index].file))
      throw Error('Image source folder changed during creation');
  }
  for (const item of prepared) {
    const now = await readImageSource(item.source).catch(error => { throw Error(`Image source changed during creation: ${message(error)}`); });
    if (now.digest !== item.digest) throw Error(`Image source changed during creation: ${item.source.name}`);
  }
}
