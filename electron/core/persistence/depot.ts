import fs from 'node:fs/promises';
import type { FlowAssetDepot, FlowAssetDepotOptions, FlowAssetReceipt, FlowResult } from '../../shared/flowWave2.js';
import { assetIds, AssetStoreError, createAssetReader, storeAsset } from './assets.js';
import { sha256Hex } from './canonicalJson.js';
import { loadCheckpoint } from './checkpoint.js';
import { errorMessage, ProjectStoreError } from './errors.js';
import { bindRoot } from './layout.js';
import { LIMITS } from './limits.js';
import { withCheckpointLock, withRootLock } from './lock.js';

const positiveInteger = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !value.includes('\0');
const failure = <T>(code: 'invalid-input' | 'resource-limit' | 'conflict' | 'busy', message: string): FlowResult<T> =>
  ({ ok: false, error: { code, message, effect: 'none' } });
const failed = <T>(error: unknown): FlowResult<T> => ({ ok: false, error: {
  code: error instanceof ProjectStoreError ? error.code : 'io-failure',
  message: errorMessage(error), effect: error instanceof AssetStoreError ? error.effect : 'none'
} });

type Operation = { assetId: string; width: number; height: number; accepted: boolean };

/** New-format, process-local asset admission. Not an IPC permission boundary.
 * Keeps operation identities and read eligibility for its lifetime, never pixels.
 * At most eight accepted puts retain encoded input while waiting on the root lock;
 * excess work is refused rather than building an unbounded byte-buffer queue. */
export const openFlowAssetDepot = async (options: FlowAssetDepotOptions): Promise<FlowResult<FlowAssetDepot>> => {
  let root: string, sessionId: string, maxPixels: number, maxPngBytes: number;
  try {
    ({ root, sessionId, maxPixels, maxPngBytes } = options);
    if (!validId(sessionId) || !positiveInteger(maxPixels) || !positiveInteger(maxPngBytes)) {
      return failure('invalid-input', 'A session id and finite positive safe-integer PNG/pixel limits are required');
    }
  } catch (error) { return failure('invalid-input', errorMessage(error)); }

  try {
    const layout = await bindRoot(root, 'save');
    return await withCheckpointLock(layout.root, () => withRootLock(layout.root, async () => {
      const rootIdentity = await fs.lstat(layout.root, { bigint: true });
      const assertBinding = async () => {
        const current = await fs.lstat(layout.root, { bigint: true });
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== rootIdentity.dev || current.ino !== rootIdentity.ino ||
            await fs.realpath(layout.root) !== layout.root) {
          throw new ProjectStoreError('conflict', 'Asset depot root binding changed');
        }
      };
      await assertBinding();
      const loaded = await loadCheckpoint(layout.root);
      await assertBinding();
      if (!loaded.ok && loaded.error.code !== 'not-found') return { ok: false, error: { ...loaded.error, effect: 'none' } };
      const allowed = loaded.ok ? assetIds(loaded.value.project) : new Set<string>();
      const readAsset = createAssetReader(layout, allowed);
      const operations = new Map<string, Operation>();
      let pending = 0;

      const put: FlowAssetDepot['put'] = async (input) => {
        if (pending >= 8) return failure('busy', 'Asset depot admission queue is full');
        let operationId: string, width: number, height: number, png: Buffer;
        try {
          // Snapshot all caller-owned fields and bytes before the first await.
          const { png: provided, operationId: requestedId, width: requestedWidth, height: requestedHeight } = input;
          operationId = requestedId; width = requestedWidth; height = requestedHeight;
          if (!validId(operationId) || !positiveInteger(width) || !positiveInteger(height) || !(provided instanceof Uint8Array) || provided.byteLength === 0) {
            return failure('invalid-input', 'put requires operationId, positive safe dimensions and nonempty PNG bytes');
          }
          if (provided.byteLength > Math.min(maxPngBytes, LIMITS.assetBytes) || width > Math.floor(maxPixels / height)) {
            return failure('resource-limit', 'PNG exceeds encoded-byte or decoded-pixel admission limit');
          }
          png = Buffer.from(provided);
        } catch (error) { return failure('invalid-input', errorMessage(error)); }
        const assetId = sha256Hex(png);
        pending++;
        try {
          return await withRootLock(layout.root, async (): Promise<FlowResult<FlowAssetReceipt>> => {
            await assertBinding();
            const previous = operations.get(operationId);
            if (previous && (previous.assetId !== assetId || previous.width !== width || previous.height !== height)) {
              return failure('conflict', 'operationId is already bound to different bytes or dimensions');
            }
            if (previous?.accepted) {
              // Idempotence confirms the existing fact; it is not permission to
              // silently recreate a blob that disappeared after a success.
              await readAsset(assetId);
            }
            // Reserve identity even if a later write fails. A retry may finish the
            // exact effect, but cannot reuse the name for a different operation.
            operations.set(operationId, { assetId, width, height, accepted: previous?.accepted ?? false });
            const outcome = await storeAsset(layout, {
              assetId, references: [{ imageId: 'depot', layerId: 'asset', width, height }]
            }, async () => png);
            // Never trust a cached successful receipt: read back the actual blob
            // through the same binding/hash checks as future readers.
            try {
              const verified = await createAssetReader(layout, new Set([assetId]))(assetId);
              if (verified.byteLength !== png.byteLength) throw new ProjectStoreError('conflict', 'Admitted PNG length changed');
            } catch (error) { throw new AssetStoreError(error, 'unknown'); }
            allowed.add(assetId);
            operations.set(operationId, { assetId, width, height, accepted: true });
            return { ok: true, value: { sessionId, operationId, assetId, width, height,
              byteLength: png.byteLength, directorySync: outcome.directorySync } };
          });
        } catch (error) {
          // A readback failure after successful admission still follows a file
          // effect. Unknown is conservative; no failed put gains eligibility.
          return failed(error);
        } finally { pending--; }
      };
      const read: FlowAssetDepot['read'] = async (assetId) => {
        try {
          await assertBinding();
          return { ok: true, value: new Uint8Array(await readAsset(assetId)) };
        } catch (error) { return failed(error); }
      };
      return { ok: true, value: { put, read } };
    }));
  } catch (error) { return failed(error); }
};
