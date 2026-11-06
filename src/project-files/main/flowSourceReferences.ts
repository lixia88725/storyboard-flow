import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import type { AssetReaderV1, ProjectV1 } from '../../platform/contracts/refactorV1.js';
import { validReferenceLayer } from '../../platform/contracts/flowSourceReference.js';
import { pixelDigest } from './flowPixelIdentity.js';

/** No new originals or copies. Reuses the first, ledger-bound retained snapshot.
 * Missing/tampered/aliased references stop open/Save; they never trigger a decode
 * of the display projection as a substitute for the original's complex layers. */
export async function verifySourceReferences(root: string, project: ProjectV1, readAsset: AssetReaderV1) {
  const layers = Object.values(project.images).flatMap(image => image.layers.filter(layer => layer.sourceReference));
  if (!layers.length) return;
  const metadata = path.join(root, '.storyboard-flow'), originals = path.join(metadata, 'originals');
  for (const directory of [root, metadata, originals]) {
    const stat = await fs.lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) throw Error('Protected source directory is aliased or missing');
  }
  const ledgerFile = path.join(metadata, 'tiff-output.json');
  const ledgerHandle = await fs.open(ledgerFile, constants.O_RDONLY | constants.O_NOFOLLOW);
  let ledger;
  try {
    const st = await ledgerHandle.stat();
    if (!st.isFile() || st.size > 8 * 1024 * 1024) throw Error('Protected source ledger is unavailable');
    ledger = JSON.parse(await ledgerHandle.readFile('utf8'));
  } finally { await ledgerHandle.close(); }
  if (ledger.projectId !== project.id || !Array.isArray(ledger.entries)) throw Error('Protected source ledger identity mismatch');
  const verified = new Set<string>(), pixels = new Map<string, string>();
  for (const layer of layers) {
    if (!validReferenceLayer(layer)) throw Error('Invalid protected source layer');
    const ref = layer.sourceReference!;
    const entry = ledger.entries.find((e: { shotId: string }) => e.shotId === ref.originalId);
    if (!entry || entry.original !== ref.digest) throw Error('Protected source is not bound to its retained original');
    const key = `${ref.originalId}:${ref.digest}:${ref.format}`;
    if (!verified.has(key)) {
      const file = path.join(originals, ref.originalId + '.tif');
      if (await fs.realpath(file) !== file) throw Error('Protected source path is aliased');
      const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.size < 4n || before.size > 128n * 1024n * 1024n) throw Error('Protected source exceeds limits or is missing');
        const bytes = await handle.readFile(), after = await handle.stat({ bigint: true });
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
          createHash('sha256').update(bytes).digest('hex') !== ref.digest) throw Error('Protected source bytes changed');
        const isPsd = bytes.subarray(0, 4).equals(Buffer.from('8BPS'));
        const isTiff = bytes.subarray(0, 4).equals(Buffer.from([0x49,0x49,0x2a,0])) || bytes.subarray(0, 4).equals(Buffer.from([0x4d,0x4d,0,0x2a]));
        if (ref.format === 'psd' ? !isPsd : !isTiff) throw Error('Protected source format signature mismatch');
      } finally { await handle.close(); }
      verified.add(key);
    }
    let actual = pixels.get(layer.assetId);
    if (!actual) { actual = await pixelDigest(await readAsset(layer.assetId)); pixels.set(layer.assetId, actual); }
    if (actual !== ref.previewPixels) throw Error('Protected source display pixels changed; original retained');
  }
}
