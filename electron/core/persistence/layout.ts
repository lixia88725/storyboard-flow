import fs from 'node:fs/promises';
import path from 'node:path';
import { errnoCode, ProjectStoreError, errorMessage } from './errors.js';

/** The new checkpoint core has a distinct role directory under the shared product
 * namespace; the existing runtime's metadata/layers remain separate. */
export const STORE_DIRECTORY = '.storyboard-flow/checkpoints';
export const MANIFEST_NAME = 'project.json';
export const ASSET_DIRECTORY = 'assets';
export const VERSION_DIRECTORY = 'versions';
export const ASSET_EXTENSION = '.png';

export type StoreLayout = Readonly<{
  /** Canonical project folder supplied by the caller. */
  root: string;
  store: string;
  assets: string;
  versions: string;
  manifest: string;
}>;

const invalidRoot = (message: string): never => {
  throw new ProjectStoreError('invalid-input', message);
};

/**
 * Bind a caller-supplied project folder to a store layout.
 *
 * The folder must exist, be a real directory and already be canonical: a
 * symlinked root, a non-canonical alias (for example macOS `/tmp` versus
 * `/private/tmp`) or a relative path is refused instead of being resolved,
 * because a later retarget of the alias could move the store somewhere else.
 */
export const bindRoot = async (root: unknown, purpose: 'save' | 'load'): Promise<StoreLayout> => {
  if (typeof root !== 'string' || root.length === 0) invalidRoot('Project root must be a nonempty path string');
  const candidate = root as string;
  if (candidate.includes('\0')) invalidRoot('Project root must not contain a null byte');
  if (!path.isAbsolute(candidate)) invalidRoot(`Project root must be an absolute path: ${candidate}`);
  const resolved = path.resolve(candidate);

  let entry;
  try {
    entry = await fs.lstat(resolved);
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      if (purpose === 'load') throw new ProjectStoreError('not-found', `Project root does not exist: ${resolved}`);
      return invalidRoot(`Project root does not exist: ${resolved}`);
    }
    throw error;
  }
  if (entry.isSymbolicLink()) invalidRoot(`Project root must not be a symbolic link: ${resolved}`);
  if (!entry.isDirectory()) invalidRoot(`Project root must be a directory: ${resolved}`);

  let canonical: string;
  try {
    canonical = await fs.realpath(resolved);
  } catch (error) {
    throw new ProjectStoreError('io-failure', `Project root could not be resolved: ${resolved}: ${errorMessage(error)}`);
  }
  if (canonical !== resolved) {
    invalidRoot(`Project root is a path alias; use its canonical path: ${resolved} -> ${canonical}`);
  }

  return {
    root: resolved,
    store: path.join(resolved, STORE_DIRECTORY),
    assets: path.join(resolved, STORE_DIRECTORY, ASSET_DIRECTORY),
    versions: path.join(resolved, STORE_DIRECTORY, VERSION_DIRECTORY),
    manifest: path.join(resolved, STORE_DIRECTORY, MANIFEST_NAME)
  };
};

/** A store directory must be a real directory, never a link or a plain file. */
const bindDirectory = async (directory: string, create: boolean): Promise<boolean> => {
  let entry;
  try {
    entry = await fs.lstat(directory);
  } catch (error) {
    if (errnoCode(error) !== 'ENOENT') throw error;
    if (!create) return false;
    try {
      await fs.mkdir(directory, { mode: 0o700 });
    } catch (mkdirError) {
      throw new ProjectStoreError('io-failure', `Store directory could not be created: ${directory}: ${errorMessage(mkdirError)}`);
    }
    entry = await fs.lstat(directory);
  }
  if (entry.isSymbolicLink()) {
    throw new ProjectStoreError('conflict', `Unsafe pre-existing store entry; a symbolic link is not accepted: ${directory}`);
  }
  if (!entry.isDirectory()) {
    throw new ProjectStoreError('conflict', `Unsafe pre-existing store entry; expected a directory: ${directory}`);
  }
  const canonical = await fs.realpath(directory);
  if (canonical !== path.resolve(directory)) {
    throw new ProjectStoreError('conflict', `Unsafe pre-existing store entry; directory is an alias: ${directory} -> ${canonical}`);
  }
  return true;
};

/** Asset admission alone must not create a manifest or a version namespace. */
export const ensureAssetDirectories = async (layout: StoreLayout): Promise<void> => {
  await bindDirectory(path.dirname(layout.store), true);
  await bindDirectory(layout.store, true);
  await bindDirectory(layout.assets, true);
};

/** Create (or verify) the store, asset and version directories before writing. */
export const ensureStoreDirectories = async (layout: StoreLayout): Promise<void> => {
  await ensureAssetDirectories(layout);
  await bindDirectory(layout.versions, true);
};

/** Load-side check: the store must already exist as a real directory. */
export const assertStoreDirectory = async (layout: StoreLayout): Promise<void> => {
  const parentPresent = await bindDirectory(path.dirname(layout.store), false);
  if (!parentPresent) throw new ProjectStoreError('not-found', `No checkpoint has been published in this folder: ${layout.root}`);
  const present = await bindDirectory(layout.store, false);
  if (!present) throw new ProjectStoreError('not-found', `No checkpoint has been published in this folder: ${layout.root}`);
};

/** Load-side check for a directory the checkpoint depends on. A link or a plain
 * file in its place is a conflict; an absent one is reported with `missingCode`. */
export const requireRealDirectory = async (
  directory: string,
  missingCode: 'missing-asset' | 'not-found'
): Promise<void> => {
  const present = await bindDirectory(directory, false);
  if (!present) throw new ProjectStoreError(missingCode, `Required store directory is missing: ${directory}`);
};

export const assetPath = (layout: StoreLayout, assetId: string): string =>
  path.join(layout.assets, `${assetId}${ASSET_EXTENSION}`);

export const versionPath = (layout: StoreLayout, revision: number): string =>
  path.join(layout.versions, `${revision}.json`);
