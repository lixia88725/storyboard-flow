import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DialogueV1, ImageDocumentV1, ProjectV1, ShotV1 } from '../../platform/contracts/refactorV1.js';
import type { FlowAssetDepot } from '../../platform/contracts/flowWave2.js';
import { admitTiffCandidate, type TiffCodec } from './formats/index.js';
import { createPresentationCodec } from './formats/presentation.js';
import {
  convertImageSource, ImageSourceTooLargeError, readImageSource, scanImageSources,
  type ImageSourceIssue, type ReadSource, type ScannedSource
} from './imageSourceConversion.js';

/** Main-owned absolute paths only; the renderer never supplies a writable path. */
export type PendingAppendInput = {
  source: { kind: 'files'; files: string[] } | { kind: 'folder'; folder: string };
};
export type PendingAppendOptions = {
  signal: AbortSignal;
  onProgress?: (progress: { done: number; total: number; phase?: 'read' | 'write' }) => void;
  decideIssues?: (issues: ImageSourceIssue[]) => Promise<'continue' | 'cancel'>;
};

/** One image to append. `original` keeps the imported TIFF bytes for a TIFF source;
 * a raster source has no TIFF original, so the written TIFF becomes the original. */
export type PendingAddition = {
  shot: ShotV1;
  image: ImageDocumentV1;
  dialogues: DialogueV1[];
  /** Sanitized source stem; the transaction uniquifies the final `basis.tif`. */
  basis: string;
  original: { kind: 'source'; source: ScannedSource; digest: string } | { kind: 'output' };
};
export type PendingAppendPlan = { project: ProjectV1; additions: PendingAddition[] };

const MAX_PREPARED_BYTES = 512 * 1024 * 1024;
const get = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!result.ok) throw Error(result.error.message);
  return result.value;
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const cancelled = (text: string) => Object.assign(new Error(text), { name: 'AbortError' });
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Filesystem-safe stem, shared by every added Pending leaf. Empty stems fall back
 * to `image`; the transaction appends `-2`, `-3`, … when the leaf is taken. */
export function pendingNameBasis(fileName: string): string {
  const stem = path.parse(fileName).name
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._]+|[._ ]+$/g, '')
    .slice(0, 200);
  return stem || 'image';
}

/**
 * Read, convert and admit images for an append into the current project's Pending.
 *
 * No user-visible file is written here: imagery only reaches the content-addressed
 * asset store. The returned project appends every accepted shot to the end of
 * `parkedShots`; the caller owns the transaction that materialises the TIFFs.
 * Defects and accepted degradations are reported once through `decideIssues`;
 * a refusal is never flattened silently.
 */
export async function preparePendingAdd(
  project: ProjectV1,
  source: PendingAppendInput['source'],
  options: PendingAppendOptions,
  dependencies: { codec: TiffCodec; depot: FlowAssetDepot }
): Promise<PendingAppendPlan> {
  if (!project || project.schema !== 'storyboard-flow.project' || project.version !== 1) throw Error('A valid current project is required');
  if (!options || typeof options !== 'object' || !options.signal || typeof options.signal.aborted !== 'boolean') throw Error('An AbortSignal is required');
  if (options.signal.aborted) throw cancelled('添加已取消');
  const codec = createPresentationCodec(dependencies.codec);
  const sources = await scanImageSources(source);
  const report = (progress: { done: number; total: number; phase?: 'read' | 'write' }) => {
    try { options.onProgress?.(progress); } catch { /* progress is advisory */ }
  };

  const after = structuredClone(project);
  const additions: PendingAddition[] = [];
  const issues: ImageSourceIssue[] = [];
  const prepared: { addition: PendingAddition; read: ReadSource; source: ScannedSource }[] = [];
  let preparedBytes = 0;

  for (const [index, source] of sources.entries()) {
    if (options.signal.aborted) throw cancelled('添加已取消');
    let read: ReadSource;
    try { read = await readImageSource(source); }
    catch (error) {
      if (!(error instanceof ImageSourceTooLargeError)) throw error;
      issues.push({ file: source.file, reason: error.message, action: 'skip' });
      report({ done: index + 1, total: sources.length, phase: 'read' });
      continue;
    }
    const conversion = await convertImageSource(source, read, codec);
    if (!conversion.ok) {
      issues.push({ file: source.file, reason: conversion.reason, action: 'skip' });
      report({ done: index + 1, total: sources.length, phase: 'read' });
      continue;
    }
    const converted = conversion.value;
    if (conversion.degradations.length) issues.push({ file: source.file, reason: conversion.degradations.join('; '), action: 'flatten' });
    preparedBytes += read.bytes.byteLength;
    for (const layer of converted.layers) preparedBytes += layer.png.byteLength;
    if (preparedBytes > MAX_PREPARED_BYTES) throw Error(`Adding images exceeds the ${MAX_PREPARED_BYTES}-byte prepared budget`);

    const shotId = randomUUID();
    const dialogues: DialogueV1[] = (converted.text?.dialogues ?? []).map(dialogue => ({ id: randomUUID(), shotId, text: dialogue.text }));
    const candidate = {
      identity: 'unverified' as const,
      kind: converted.kind === 'tiff' ? 'layered' as const : 'plain' as const,
      image: { id: randomUUID(), revision: 0, width: converted.width, height: converted.height, layers: converted.layers },
      text: converted.text ? {
        projectId: after.id, projectName: after.name, shotId,
        shotName: converted.text.shotName, scriptText: converted.text.scriptText, dialogues,
        ...(converted.text.presentation ? { presentation: converted.text.presentation } : {})
      } : null
    };
    const image = get(await admitTiffCandidate(candidate, dependencies.depot, `pending_add_${shotId}`));
    const presentation = converted.text?.presentation?.settings;
    const addition: PendingAddition = {
      shot: { id: shotId, imageId: image.id, ...(presentation ? { presentation } : {}),
        name: converted.text?.shotName ?? path.parse(source.name).name, scriptText: converted.text?.scriptText ?? '' },
      image, dialogues, basis: pendingNameBasis(source.name),
      original: converted.kind === 'tiff' ? { kind: 'source', source, digest: read.digest } : { kind: 'output' }
    };
    additions.push(addition);
    prepared.push({ addition, read, source });
    report({ done: index + 1, total: sources.length, phase: 'read' });
  }

  if (issues.length) {
    if (!options.decideIssues) throw Error(`Some images need confirmation before they can be added: ${issues.map(issue => `${path.basename(issue.file)} (${issue.action}): ${issue.reason}`).join('; ')}`);
    if (await options.decideIssues(issues) !== 'continue') throw cancelled('添加已取消');
  }
  if (!additions.length) throw Error('No usable images remain after the confirmed issues; nothing was added');
  if (options.signal.aborted) throw cancelled('添加已取消');

  // The folder must still hold the same direct children, and every converted
  // source must still be exactly the bytes that were read. A change is refused
  // before the transaction can write anything.
  if (source.kind === 'folder') {
    const again = await scanImageSources({ kind: 'folder', folder: source.folder });
    if (again.length !== sources.length || again.some((entry, index) => entry.file !== sources[index].file))
      throw Error('Image source folder changed while images were added');
  }
  for (const { read, source } of prepared) {
    const now = await readImageSource(source).catch(error => { throw Error(`Image source changed while images were added: ${message(error)}`); });
    if (now.digest !== read.digest) throw Error(`Image source changed while images were added: ${source.name}`);
  }

  for (const addition of additions) {
    after.images[addition.image.id] = addition.image;
    after.parkedShots.push(addition.shot);
    after.dialogues.push(...addition.dialogues);
  }
  return { project: after, additions };
}
