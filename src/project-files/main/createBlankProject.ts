import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { publishDirectoryExclusive } from '../../platform/main/platform/index.js';
import { flowCodecOptions } from '../../platform/main/flowRuntimePaths.js';
import { createTiffCodec } from './formats/index.js';
import { createProjectStore } from './persistence/index.js';
import { openFlowTiffSave } from './flowTiffSave.js';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate.js';
import { bindDestination, bindInput } from './createImageProject.js';
import type { ProjectV1 } from '../../platform/contracts/refactorV1.js';
import type { CreateBlankProjectInput } from '../../platform/contracts/flowProjectCreation.js';

const STAGE_PREFIX = '.flow-blank-';
const get = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!result.ok) throw Error(result.error.message);
  return result.value;
};
const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';
const cancelled = (text: string) => Object.assign(new Error(text), { name: 'AbortError' });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Create a new, empty project folder.
 *
 * This is the same transaction as creation from images — private stage on the
 * destination's filesystem, checkpoint, exclusive publication, verification of
 * the published project — with no source to read and no working TIFF yet. The
 * first board is added in the workbench; nothing is invented here and no
 * placeholder image is written.
 */
export async function createBlankProject(input: CreateBlankProjectInput, options: { signal: AbortSignal; onProgress?: (progress: { done: number; total: number; phase?: 'read' | 'write' }) => void }): Promise<{ root: string }> {
  const { naming, name } = bindInput(input);
  if (!options || typeof options !== 'object' || !options.signal || typeof options.signal.aborted !== 'boolean')
    throw Error('An AbortSignal is required');
  if (options.signal.aborted) throw cancelled('创建已取消');
  const { target } = await bindDestination(input.destinationParent, input.folderName);
  await assertPhysicalWorkspaceWriterTargets([target]);

  const rawCodec = createTiffCodec(flowCodecOptions());
  const store = createProjectStore();
  let stage: string | undefined, identity: { dev: bigint; ino: bigint } | undefined, published = false;
  const report = (progress: { done: number; total: number; phase?: 'read' | 'write' }) => {
    try { options.onProgress?.(progress); } catch { /* progress is advisory */ }
  };
  try {
    stage = await fs.mkdtemp(path.join(path.dirname(target), STAGE_PREFIX));
    const stageEntry = await fs.lstat(stage, { bigint: true });
    identity = { dev: stageEntry.dev, ino: stageEntry.ino };
    const assertStageBinding = async () => {
      if (!stage || !identity) throw Error('Staging directory is unavailable');
      const current = await fs.lstat(stage, { bigint: true }).catch(error => {
        if (isMissing(error)) throw Error(`Staging directory disappeared: ${stage}`);
        throw error;
      });
      if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev ||
          current.ino !== identity.ino || await fs.realpath(stage) !== stage)
        throw Error(`Staging directory changed during creation: ${stage}`);
    };
    report({ done: 0, total: 1, phase: 'write' });
    const project: ProjectV1 = { schema: 'storyboard-flow.project', version: 1, id: randomUUID(), name,
      naming, revision: 0, shots: [], parkedShots: [], dialogues: [], images: {} };
    // A blank project owns no asset, so a reader is required but never called.
    get(await store.saveCheckpoint(stage, project, async id => { throw Error(`Blank project has no asset ${id}`); }));
    await assertStageBinding();
    if (options.signal.aborted) throw cancelled('创建已取消');
    if ((await fs.readdir(path.dirname(target))).some(entry => entry.toLowerCase() === path.basename(target).toLowerCase()))
      throw Error(`Destination appeared during creation; nothing was replaced: ${target}`);
    await assertPhysicalWorkspaceWriterTargets([target]);
    try {
      await publishDirectoryExclusive(stage, target, identity);
      published = true;
    } catch (error) {
      // The native publication may already have renamed the stage before a later
      // directory flush failed. Judge only by the destination's identity.
      const attached = identity ? await fs.lstat(target, { bigint: true }).catch(probe => { if (isMissing(probe)) return undefined; throw probe; }) : undefined;
      if (attached && attached.isDirectory() && !attached.isSymbolicLink() && attached.dev === identity.dev && attached.ino === identity.ino) {
        published = true;
        throw Error(`publication was renamed but its durability could not be confirmed: ${message(error)}`);
      }
      if (attached) throw Error(`the destination now exists and is not this creation; it was left untouched: ${target}; ${message(error)}`);
      throw error;
    }

    const loaded = get(await store.loadCheckpoint(target));
    if (loaded.project.id !== project.id) throw Error('Published project identity mismatch');
    if (loaded.project.shots.length || loaded.project.parkedShots.length) throw Error('Published blank project is not empty');
    const verifier = await openFlowTiffSave(target, project.id, rawCodec);
    const status = await verifier.folderStatus({ project: loaded.project, inspectDisk: true });
    if (status !== 'current') throw Error(`Created project failed verification: ${status}`);
    report({ done: 1, total: 1, phase: 'write' });
    return { root: target };
  } catch (error) {
    const cancelledError = (error as { name?: string })?.name === 'AbortError';
    if (published)
      throw Object.assign(new Error(`Project published but verification failed: ${message(error)}; the created project is retained at ${target}`),
        { name: cancelledError ? 'AbortError' : 'Error' });
    let note = '';
    if (stage) {
      const current = identity
        ? await fs.lstat(stage, { bigint: true }).catch(probe => { if (isMissing(probe)) return undefined; throw probe; })
        : undefined;
      if (!current) note = `; the private staging directory is no longer at ${stage} (this call deleted nothing)`;
      else if (!identity) note = `; the private staging directory was retained at ${stage}`;
      else if (current.isDirectory() && !current.isSymbolicLink() && current.dev === identity.dev && current.ino === identity.ino)
        note = `; the private staging directory was retained at ${stage}`;
      else note = `; the staging path no longer refers to this creation and was left untouched: ${stage}`;
    }
    throw Object.assign(new Error(`Project creation failed: ${message(error)}${note}`),
      { name: cancelledError ? 'AbortError' : 'Error' });
  }
}
