import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { writeProtectedLayerFile } from './protectedLayerFileWriter';
import { withProducerPngEffects, type ProducerPngReceipt } from './producerPngEffects';
import * as origin from './ownedStagePublication';

test('only original Main native producer receipts retain provenance; cold copies and mutations cannot enroll', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-origin-live-'));
  const target = path.join(root, '.storyboard-workbench/layers/s/new.png');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  const python = 'python3';
  const shim = path.join(root, 'original-native-unlink-fault');
  await fs.writeFile(shim, `#!/usr/bin/env ${python}\nimport sys,importlib.util,json,base64,os\nspec=importlib.util.spec_from_file_location('writer',sys.argv[3]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\noriginal=m.os.unlink\ndef fault(p,*a,**k):\n if os.path.basename(p).startswith('.layer-staging-'): raise PermissionError('origin fixture final unlink denied')\n return original(p,*a,**k)\nm.os.unlink=fault\nr=json.load(sys.stdin)\nprint(json.dumps(m.protected_write(r['root'],r['filePath'],base64.b64decode(r['bytes']),r['mode'],r['operation'])))\n`, { mode: 0o700 });
  const old = process.env.SWB_PYTHON_BIN;
  let producer: ProducerPngReceipt | undefined, committed: any, error: any;
  try {
    process.env.SWB_PYTHON_BIN = shim;
    error = await withProducerPngEffects({ beforeWrite: async () => {}, written: async r => { producer = r; }, beforeDelete: async () => {}, deleted: async () => {} }, () => writeProtectedLayerFile(root, target, bytes, 'upsert', r => { committed = r; })).catch(e => e);
  } finally { if (old === undefined) delete process.env.SWB_PYTHON_BIN; else process.env.SWB_PYTHON_BIN = old; }
  expect(error).toMatchObject({ effect: 'committed', filePath: target });
  const hot = producer?.commitFailure?.ownedStageReceipt;
  expect(hot).toMatchObject({ schema: 'swb.owned-stage-publication.v1', root, target });
  expect(origin.hasOriginalOwnedStageProvenance(hot)).toBe(true);
  expect(origin.hasOriginalOwnedStageProvenance(committed.ownedStageReceipt)).toBe(true);
  expect(origin.hasOriginalOwnedStageProvenance(error.ownedStageReceipt)).toBe(true);
  // Actual disk/IPC serialization loses the private Main mark, despite complete
  // identical public evidence. Neither public UUID nor hash mints provenance.
  const disk = path.join(root, 'public-receipt.json');
  await fs.writeFile(disk, JSON.stringify(hot), { mode: 0o600 });
  const cold = JSON.parse(await fs.readFile(disk, 'utf8'));
  expect(cold).toEqual(hot);
  expect(origin.hasOriginalOwnedStageProvenance(cold)).toBe(false);
  expect(origin.hasOriginalOwnedStageProvenance(structuredClone(hot))).toBe(false);
  expect(() => origin.copyOriginalOwnedStageReceipt(cold)).toThrow('original Main');
  const copy = origin.copyOriginalOwnedStageReceipt(hot!);
  expect(copy).toEqual(hot);
  expect(origin.hasOriginalOwnedStageProvenance(copy)).toBe(true);
  copy.stageAfterPublication.xattrs['eA=='] = 'eQ==';
  expect(origin.hasOriginalOwnedStageProvenance(copy)).toBe(false);
  expect(() => origin.copyOriginalOwnedStageReceipt(copy)).toThrow('original Main');
  expect(origin.hasOriginalOwnedStageProvenance(hot)).toBe(true);
  expect((await fs.stat(target)).nlink).toBe(2);
  expect(await fs.readFile(target)).toEqual(bytes);
  expect(await fs.readFile(error.retainedTemporary)).toEqual(bytes);
  // No registry enrollment/deletion here; preserve all original failed evidence.
}, 120000);
