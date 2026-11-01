import type {
  AssetReaderV1,
  CheckpointReceiptV1,
  LoadedCheckpointV1,
  ProjectV1,
  ResultV1
} from '../../shared/refactorV1.js';
import * as platform from '../platform/index.js';
import { assetIds, assertAssetsPresent, createAssetReader, storeRequiredAssets } from './assets.js';
import { canonicalJson } from './canonicalJson.js';
import { errnoCode, errorMessage, ProjectStoreError, storeFailureOf } from './errors.js';
import { triggerFault } from './faults.js';
import { failAfterCleanup, readBoundFile, releaseTemporary, writeTemporaryFile } from './fileOps.js';
import { assertStoreDirectory, bindRoot, ensureStoreDirectories, versionPath, type StoreLayout } from './layout.js';
import { LIMITS } from './limits.js';
import { withCheckpointLock, withRootLock } from './lock.js';
import { snapshotProject, validateProject } from './validate.js';

type Head = { project: ProjectV1; canonical: string };

const conflict = (message: string): never => {
  throw new ProjectStoreError('conflict', message);
};

const decodeManifest = (bytes: Buffer, label: string): unknown => {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ProjectStoreError('invalid-input', `${label} is not valid UTF-8`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProjectStoreError('invalid-input', `${label} is not valid JSON: ${errorMessage(error)}`);
  }
};

/** Read and fully validate the published manifest, if there is one. */
const readHead = async (layout: StoreLayout): Promise<Head | undefined> => {
  const bytes = await readBoundFile(layout.manifest, LIMITS.manifestBytes);
  if (!bytes) return undefined;
  const project = validateProject(decodeManifest(bytes, layout.manifest));
  // Compare logical content, not the exact bytes on disk, so reformatting by hand
  // does not turn an identical checkpoint into a conflict.
  return { project, canonical: canonicalJson(project) };
};

/** A previous head that cannot be read or validated is never overwritten. */
const readHeadForSave = async (layout: StoreLayout): Promise<Head | undefined> => {
  try {
    return await readHead(layout);
  } catch (error) {
    if (error instanceof ProjectStoreError) {
      throw new ProjectStoreError('conflict', `Existing head is not a usable checkpoint (${error.code}): ${error.message}`);
    }
    throw error;
  }
};

/**
 * Publish the head manifest as the last step: write and flush a uniquely named
 * temporary file in the store directory, then atomically replace `project.json`.
 * Before the rename the previous checkpoint is still exactly what is published;
 * after it, the new head is. Nothing in between is visible to a reader.
 */
const publishHead = async (layout: StoreLayout, bytes: Buffer): Promise<void> => {
  triggerFault('beforeHeadWrite');
  const temporary = await writeTemporaryFile(layout.store, 'project', bytes);
  try {
    triggerFault('beforeHeadReplace');
  } catch (error) {
    await failAfterCleanup(temporary, error, 'Checkpoint head publication was stopped before replacement; the previous checkpoint is unchanged');
  }
  try {
    await platform.replaceFile(temporary.path, layout.manifest);
  } catch (error) {
    await failAfterCleanup(temporary, error, 'Checkpoint head could not be published; the previous checkpoint is unchanged');
  }
  try {
    await platform.syncDirectory(layout.store);
  } catch (error) {
    throw new ProjectStoreError(
      'io-failure',
      `Checkpoint head was replaced but the store directory could not be flushed; durability of the new head is not confirmed: ${errorMessage(error)}`
    );
  }
};

/**
 * Retain the immutable version record for this revision before the head moves.
 * The record of a revision is written once and never rewritten: re-recording the
 * same revision with different bytes is a conflict, not an update.
 */
const writeVersionRecord = async (layout: StoreLayout, revision: number, bytes: Buffer): Promise<void> => {
  const target = versionPath(layout, revision);
  const existing = await readBoundFile(target, LIMITS.manifestBytes);
  if (existing) {
    if (!existing.equals(bytes)) conflict(`Revision ${revision} is already recorded with different content at ${target}`);
    return;
  }

  const temporary = await writeTemporaryFile(layout.versions, 'version', bytes);
  try {
    await platform.linkExclusive(temporary.path, target);
  } catch (error) {
    if (errnoCode(error) === 'EEXIST') {
      const raced = await readBoundFile(target, LIMITS.manifestBytes);
      await releaseTemporary(temporary);
      if (!raced || !raced.equals(bytes)) conflict(`Revision ${revision} was recorded concurrently with different content at ${target}`);
      return;
    }
    await failAfterCleanup(
      temporary,
      error,
      `Version record for revision ${revision} could not be written; stored assets and the previous checkpoint are retained`
    );
  }
  await releaseTemporary(temporary);
  await platform.syncDirectory(layout.versions);
};

const publishCheckpoint = async (
  layout: StoreLayout,
  snapshot: ProjectV1,
  canonical: string,
  manifestBytes: Buffer,
  readAsset: AssetReaderV1
): Promise<CheckpointReceiptV1> => {
  const head = await withRootLock(layout.root, async () => {
    await ensureStoreDirectories(layout);
    return readHeadForSave(layout);
  });
  const revision = snapshot.revision;

  let idempotent = false;
  if (head) {
    if (head.project.id !== snapshot.id) {
      conflict(`Root already holds project ${head.project.id}; refusing to publish project ${snapshot.id}`);
    }
    if (revision < head.project.revision) {
      conflict(`Revision ${revision} is stale; the published checkpoint is revision ${head.project.revision}`);
    }
    if (revision === head.project.revision) {
      if (head.canonical !== canonical) conflict(`Revision ${revision} is already published with different content`);
      idempotent = true;
    }
  }

  // Immutable assets first: a checkpoint that names an asset never does so before
  // the asset exists and has been verified.
  await storeRequiredAssets(layout, snapshot, readAsset);
  await writeVersionRecord(layout, revision, manifestBytes);
  if (!idempotent) await publishHead(layout, manifestBytes);

  return { projectId: snapshot.id, revision, manifestPath: layout.manifest };
};

/**
 * Publish `project` as the checkpoint of `root`.
 *
 * The submitted project is copied and validated before the first await, so a
 * caller that keeps editing its object cannot change what this call
 * acknowledges. Assets are verified or created first, the immutable version
 * record second, and `project.json` last; the receipt is returned only after
 * publication succeeded.
 */
export const saveCheckpoint = async (
  root: string,
  project: ProjectV1,
  readAsset: AssetReaderV1
): Promise<ResultV1<CheckpointReceiptV1>> => {
  let snapshot: ProjectV1;
  let canonical: string;
  let manifestBytes: Buffer;
  try {
    if (typeof readAsset !== 'function') throw new ProjectStoreError('invalid-input', 'readAsset must be a function');
    snapshot = snapshotProject(project);
    canonical = canonicalJson(snapshot);
    manifestBytes = Buffer.from(`${canonical}\n`, 'utf8');
    if (manifestBytes.length > LIMITS.manifestBytes) {
      throw new ProjectStoreError('invalid-input', `Manifest exceeds the ${LIMITS.manifestBytes}-byte limit`);
    }
  } catch (error) {
    return storeFailureOf(error, 'invalid-input');
  }

  try {
    const layout = await bindRoot(root, 'save');
    const receipt = await withCheckpointLock(layout.root, () => publishCheckpoint(layout, snapshot, canonical, manifestBytes, readAsset));
    return { ok: true, value: receipt };
  } catch (error) {
    return storeFailureOf(error);
  }
};

/**
 * Load the checkpoint published at `root`.
 *
 * Strict on purpose: the manifest must validate completely and every asset the
 * snapshot names (including retained, unreferenced images) must exist. Bytes are
 * verified by the returned reader at read time, not mutated or repaired here.
 */
export const loadCheckpoint = async (root: string): Promise<ResultV1<LoadedCheckpointV1>> => {
  try {
    const layout = await bindRoot(root, 'load');
    await assertStoreDirectory(layout);
    const head = await readHead(layout);
    if (!head) throw new ProjectStoreError('not-found', `No checkpoint manifest at ${layout.manifest}`);
    await assertAssetsPresent(layout, head.project);
    return {
      ok: true,
      value: { project: head.project, readAsset: createAssetReader(layout, assetIds(head.project)) }
    };
  } catch (error) {
    return storeFailureOf(error);
  }
};
