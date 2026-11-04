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
import { imagePixelDigests } from './flowPixelIdentity.js';
import { openFlowTiffSave, type CreatedOutputBinding } from './flowTiffSave.js';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate.js';
import { convertImageSource, readImageSource, scanImageSources, SOURCE_PIXEL_LIMIT, SOURCE_PNG_LIMIT, type ImageSourceIssue, type ScannedSource } from './imageSourceConversion.js';
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
  onProgress?: (progress: { done: number; total: number }) => void;
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
  if (input.source.kind === 'folder' && inside(input.source.folder, target))
    throw Error('The new project folder must be created outside the source folder');
  await assertPhysicalWorkspaceWriterTargets([target]);

  const rawCodec: TiffCodec = createTiffCodec(flowCodecOptions());
  const codec: TiffCodec = createPresentationCodec(rawCodec);
  const store = createProjectStore();
  let stage: string | undefined, identity: { dev: bigint; ino: bigint } | undefined, published = false;
  try {
    stage = await fs.mkdtemp(path.join(path.dirname(target), STAGE_PREFIX));
    const stageEntry = await fs.lstat(stage, { bigint: true });
    identity = { dev: stageEntry.dev, ino: stageEntry.ino };
    const depot = get(await openFlowAssetDepot({ root: stage, sessionId: randomUUID(), maxPixels: SOURCE_PIXEL_LIMIT, maxPngBytes: SOURCE_PNG_LIMIT }));
    const readAsset: AssetReaderV1 = async id => get(await depot.read(id));
    const project: ProjectV1 = { schema: 'storyboard-flow.project', version: 1, id: randomUUID(), name,
      naming, revision: 0, shots: [], parkedShots: [], dialogues: [], images: {} };
    const prepared: Prepared[] = [];
    const issues: ImageSourceIssue[] = [];
    let preparedBytes = 0;

    for (const source of sources) {
      if (options.signal.aborted) throw cancelled('创建已取消');
      const read = await readImageSource(source);
      const conversion = await convertImageSource(source, read, codec);
      if (!conversion.ok) {
        issues.push({ file: source.file, reason: conversion.reason, action: 'skip' });
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
      const presentation = converted.text?.presentation?.settings;
      project.images[image.id] = image;
      project.shots.push({ id: shotId, imageId: image.id, ...(presentation ? { presentation } : {}),
        name: converted.text?.shotName ?? path.parse(source.name).name, scriptText: converted.text?.scriptText ?? '' });
      project.dialogues.push(...dialogues);
      prepared.push({ source, digest: read.digest, kind: converted.kind, image, shotId });
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
    const bindings: CreatedOutputBinding[] = [];
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
      options.onProgress?.({ done: index + 1, total: prepared.length });
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
    await publishDirectoryExclusive(stage, target);
    published = true;

    const loaded = get(await store.loadCheckpoint(target));
    if (loaded.project.id !== project.id) throw Error('Published project identity mismatch');
    const verifier = await openFlowTiffSave(target, project.id, rawCodec);
    const status = await verifier.folderStatus({ project: loaded.project, inspectDisk: true });
    if (status !== 'current') throw Error(`Created project failed verification: ${status}`);
    const outputs = await fs.readdir(target);
    const expected = new Set(bindings.map(binding => binding.name));
    if (![...expected].every(entry => outputs.includes(entry))) throw Error('Created project is missing a working TIFF');
    return { root: target };
  } catch (error) {
    // Only this call's own stage/output is removable, and only while its identity
    // is the one created above. Anything else is retained and reported.
    const owned = published ? target : stage;
    let retained = owned;
    if (identity && owned) {
      try {
        const current = await fs.lstat(owned, { bigint: true }).catch(error => { if (isMissing(error)) return undefined; throw error; });
        if (!current) retained = undefined;
        else if (current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino) {
          await fs.rm(owned, { recursive: true });
          retained = undefined;
        }
      } catch (cleanupError) {
        throw Error(`${published ? 'Project published but verification failed' : 'Project creation failed'}: ${message(error)}; cleanup could not be confirmed: ${message(cleanupError)}${retained ? `; retained: ${retained}` : ''}`);
      }
    }
    throw Object.assign(new Error(`${published ? 'Project published but verification failed' : 'Project creation failed'}: ${message(error)}${retained ? `; retained output: ${retained}` : ''}`),
      { name: (error as { name?: string })?.name === 'AbortError' ? 'AbortError' : 'Error' });
  }
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
