import fs from 'node:fs/promises';
import sharp from 'sharp';
import { withRootLock } from './lock.js';
import type { AssetReaderV1, ProjectV1 } from '../../../platform/contracts/refactorV1.js';
import * as platform from '../../../platform/main/platform/index.js';
import { sha256Hex } from './canonicalJson.js';
import { errnoCode, errorMessage, ProjectStoreError } from './errors.js';
import { failAfterCleanup, readBoundFile, releaseTemporary, writeTemporaryFile } from './fileOps.js';
import { assetPath, ensureAssetDirectories, requireRealDirectory, type StoreLayout } from './layout.js';
import { LIMITS } from './limits.js';
import { ASSET_ID } from './validate.js';

/** One immutable PNG the project depends on, with every place that names it. */
export type AssetClaim = {
  assetId: string;
  references: { imageId: string; layerId: string; width: number; height: number }[];
};

const conflict = (message: string): never => {
  throw new ProjectStoreError('conflict', message);
};
const invalid = (message: string): never => {
  throw new ProjectStoreError('invalid-input', message);
};

/** All images in the snapshot, including retained images no shot points at. */
export const requiredAssets = (project: ProjectV1): AssetClaim[] => {
  const claims = new Map<string, AssetClaim>();
  for (const image of Object.values(project.images)) {
    for (const layer of image.layers) {
      let claim = claims.get(layer.assetId);
      if (!claim) {
        claim = { assetId: layer.assetId, references: [] };
        claims.set(layer.assetId, claim);
      }
      claim.references.push({ imageId: image.id, layerId: layer.id, width: layer.width, height: layer.height });
    }
  }
  return [...claims.values()].sort((left, right) => (left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0));
};

export const assetIds = (project: ProjectV1): Set<string> => new Set(requiredAssets(project).map((claim) => claim.assetId));

/** Copy the bytes the caller supplies for one asset. The copy is taken in the
 * same turn the promise settles, so a reader that keeps handing out a shared
 * buffer cannot change what this save stores. */
const providedBytes = async (readAsset: AssetReaderV1, claim: AssetClaim): Promise<Buffer> => {
  let value: unknown;
  try {
    value = await readAsset(claim.assetId);
  } catch (error) {
    throw new ProjectStoreError('missing-asset', `Asset ${claim.assetId} could not be provided: ${errorMessage(error)}`);
  }
  if (!(value instanceof Uint8Array)) invalid(`readAsset(${claim.assetId}) did not return bytes`);
  const bytes = value as Uint8Array;
  if (bytes.length === 0) conflict(`readAsset(${claim.assetId}) returned no bytes`);
  if (bytes.length > LIMITS.assetBytes) invalid(`Asset ${claim.assetId} exceeds the ${LIMITS.assetBytes}-byte limit`);
  return Buffer.from(bytes);
};

const verifyExistingBlob = (bytes: Buffer, claim: AssetClaim, filePath: string): void => {
  const actual = sha256Hex(bytes);
  if (actual !== claim.assetId) {
    conflict(
      `Existing asset ${claim.assetId} does not match its content address (found ${actual} at ${filePath}); the file was left untouched and is not repaired`
    );
  }
};

const pngMetadata = async (bytes: Buffer, claim: AssetClaim): Promise<sharp.Metadata> => {
  try {
    return await sharp(bytes, { failOn: 'error' }).metadata();
  } catch (error) {
    return invalid(`Asset ${claim.assetId} is not a readable PNG: ${errorMessage(error)}`);
  }
};

/** Decode the PNG header for dimensions and force a full decode so truncated or
 * corrupt pixel data is refused at admission. sharp's default input-pixel limit
 * bounds the decode, so a small file cannot expand into an unbounded raster. */
const decodedDimensions = new Map<string, { width: number; height: number }>();
const verifyDecodablePng = async (bytes: Buffer, claim: AssetClaim): Promise<void> => {
  const cached = decodedDimensions.get(claim.assetId);
  const metadata = cached ? { ...cached, format: "png" } : await pngMetadata(bytes, claim);
  if (metadata.format !== 'png') invalid(`Asset ${claim.assetId} is ${metadata.format ?? 'not an image'}, not PNG`);
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    invalid(`Asset ${claim.assetId} has no usable pixel dimensions`);
  }
  for (const reference of claim.references) {
    if (reference.width !== width || reference.height !== height) {
      invalid(
        `Asset ${claim.assetId} is ${width}x${height} but ${reference.imageId}/${reference.layerId} declares ${reference.width}x${reference.height}`
      );
    }
  }
  if (cached) return;
  try {
    await sharp(bytes, { failOn: 'error' }).raw().toBuffer();
    if (decodedDimensions.size >= 4096) decodedDimensions.delete(decodedDimensions.keys().next().value!);
    decodedDimensions.set(claim.assetId, { width, height });
  } catch (error) {
    invalid(`Asset ${claim.assetId} could not be decoded: ${errorMessage(error)}`);
  }
};

export type AssetOutcome = { assetId: string; created: boolean; directorySync: 'synced' | 'skipped' };

/** Internal typed effect evidence; the old store still exposes only ResultV1.
 * No caller has to interpret an error message to discover a write stage. */
export class AssetStoreError extends ProjectStoreError {
  constructor(error: unknown, readonly effect: 'none' | 'retained' | 'unknown') {
    super(error instanceof ProjectStoreError ? error.code : 'io-failure', errorMessage(error));
    this.name = 'AssetStoreError';
  }
}

/**
 * Admit one asset: verify the supplied bytes, verify or create the immutable
 * blob, and never overwrite an existing blob.
 *
 * An asset already stored is verified by digest rather than trusted by name; its
 * existing bytes are compared, so a corrupt blob is reported as a conflict and
 * never repaired by overwriting it.
 */
export const storeAsset = async (layout: StoreLayout, claim: AssetClaim, readAsset: AssetReaderV1): Promise<AssetOutcome> => {
  let effect: 'none' | 'retained' | 'unknown' = 'none';
  try {
    const bytes = await providedBytes(readAsset, claim);
    const providedDigest = sha256Hex(bytes);
    if (providedDigest !== claim.assetId) {
      conflict(`Bytes supplied for asset ${claim.assetId} hash to ${providedDigest}; the reference and the bytes disagree`);
    }

    // A verified digest can reuse its decoded dimensions; every reference is still checked.
    await verifyDecodablePng(bytes, claim);

    // Direct depot admission has no checkpoint to create these directories for it.
    // Validate/decode first so invalid input cannot start filesystem effects.
    effect = 'unknown';
    await ensureAssetDirectories(layout);
    const filePath = assetPath(layout, claim.assetId);
    const existing = await readBoundFile(filePath, LIMITS.assetBytes);
    if (existing) {
      verifyExistingBlob(existing, claim, filePath);
      effect = 'none';
      const directorySync = await platform.syncDirectory(layout.assets);
      return { assetId: claim.assetId, created: false, directorySync };
    }

    // Publish through a temporary file and a hard link, so a partially written file
    // never appears under the asset's final name and an existing blob is never
    // replaced. A crash can leave only an inert `<purpose>.<random>.tmp` behind.
    const temporary = await writeTemporaryFile(layout.assets, 'asset', bytes);
    try {
      await platform.linkExclusive(temporary.path, filePath);
    } catch (error) {
      if (errnoCode(error) === 'EEXIST') {
        const raced = await readBoundFile(filePath, LIMITS.assetBytes);
        await releaseTemporary(temporary);
        if (!raced) conflict(`Asset ${claim.assetId} disappeared while it was being created`);
        verifyExistingBlob(raced as Buffer, claim, filePath);
        effect = 'none';
        const directorySync = await platform.syncDirectory(layout.assets);
        return { assetId: claim.assetId, created: false, directorySync };
      }
      if (error instanceof ProjectStoreError) throw error;
      await failAfterCleanup(
        temporary,
        error,
        `Asset ${claim.assetId} could not be stored at ${filePath}; existing assets and the previous checkpoint are retained`
      );
    }
    await releaseTemporary(temporary);
    effect = 'retained';
    // Flush on every path, including reuse: an earlier flush may have failed after
    // linking this immutable blob. An existence check cannot repair that receipt.
    const directorySync = await platform.syncDirectory(layout.assets);
    return { assetId: claim.assetId, created: true, directorySync };
  } catch (error) {
    throw new AssetStoreError(error, effect);
  }
};

/** Store every asset the snapshot needs, one at a time and in a stable order. */
export const storeRequiredAssets = async (layout: StoreLayout, project: ProjectV1, readAsset: AssetReaderV1): Promise<AssetOutcome[]> => {
  const outcomes: AssetOutcome[] = [];
  for (const claim of requiredAssets(project)) {
    outcomes.push(await withRootLock(layout.root, () => storeAsset(layout, claim, readAsset)));
  }
  return outcomes;
};

/** Load-side check that every required asset exists as a plain, nonempty regular
 * file. Bytes are not read here; integrity is verified by the returned reader. */
export const assertAssetsPresent = async (layout: StoreLayout, project: ProjectV1): Promise<void> => {
  const claims = requiredAssets(project);
  if (claims.length === 0) return;
  // The directory itself must still be the real one, otherwise these entries
  // would be read from somewhere else through a planted link.
  await requireRealDirectory(layout.assets, 'missing-asset');
  for (const claim of claims) {
    const filePath = assetPath(layout, claim.assetId);
    let entry;
    try {
      entry = await fs.lstat(filePath, { bigint: true });
    } catch (error) {
      if (errnoCode(error) === 'ENOENT') {
        throw new ProjectStoreError(
          'missing-asset',
          `Checkpoint requires asset ${claim.assetId} (${claim.references.map((r) => `${r.imageId}/${r.layerId}`).join(', ')}) but ${filePath} does not exist`
        );
      }
      throw error;
    }
    if (entry.isSymbolicLink()) conflict(`Unsafe pre-existing entry; asset is a symbolic link: ${filePath}`);
    if (!entry.isFile()) conflict(`Unsafe pre-existing entry; asset is not a regular file: ${filePath}`);
    if (entry.size === 0n) conflict(`Asset file is empty: ${filePath}`);
    if (entry.size > BigInt(LIMITS.assetBytes)) conflict(`Asset file exceeds the ${LIMITS.assetBytes}-byte limit: ${filePath}`);
  }
};

/**
 * Reader bound to the checkpoint that was loaded: only ids the loaded project
 * references, with the root binding re-checked and the content address verified
 * on every read. Bytes are read through a no-follow descriptor and returned as a
 * private copy, so an externally modified blob is reported instead of silently
 * handed to the caller.
 */
export const createAssetReader = (layout: StoreLayout, allowed: Set<string>): AssetReaderV1 => async (id) => {
  if (typeof id !== 'string' || !ASSET_ID.test(id)) invalid('Asset id must be a lowercase 64-character SHA-256 hex string');
  if (!allowed.has(id)) throw new ProjectStoreError('not-found', `Asset ${id} is not part of the loaded checkpoint`);

  const canonicalRoot = await fs.realpath(layout.root).catch((error: unknown) => {
    throw new ProjectStoreError('conflict', `Project root can no longer be resolved: ${errorMessage(error)}`);
  });
  if (canonicalRoot !== layout.root) conflict(`Project root was replaced during the session: ${layout.root} -> ${canonicalRoot}`);
  const canonicalAssets = await fs.realpath(layout.assets).catch((error: unknown) => {
    throw new ProjectStoreError('missing-asset', `Asset directory can no longer be resolved: ${errorMessage(error)}`);
  });
  if (canonicalAssets !== layout.assets) conflict(`Asset directory was replaced during the session: ${layout.assets} -> ${canonicalAssets}`);

  const filePath = assetPath(layout, id);
  const bytes = await readBoundFile(filePath, LIMITS.assetBytes);
  if (!bytes) throw new ProjectStoreError('missing-asset', `Asset ${id} is no longer present: ${filePath}`);
  const actual = sha256Hex(bytes);
  if (actual !== id) conflict(`Asset ${id} no longer matches its content address (found ${actual}); read refused`);
  return bytes;
};
