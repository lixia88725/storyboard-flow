import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createOriginEnrollment } from './originEnrollment';
import { createOriginWorkspaceAccounting } from './originWorkspaceAccounting';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';
import { writeProtectedLayerFile } from './protectedLayerFileWriter';
import { withProducerPngEffects, type ProducerPngReceipt } from './producerPngEffects';
import { createWorkspaceRecoveryPartitions } from './workspaceRecoveryPartitions';

// Genuine original writer + real native enrollment + real capture/readback. The
// caller objects are synthetic; this is not Electron IPC/Close/cold GUI proof.
test('only original hot receipt can issue and a complete same-capture readback can seal for a fresh service', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-flow-root-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-flow-data-'));
  const target = path.join(root, '.storyboard-workbench/layers/s/new.png');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const source = path.join(root, 'source.json'); await fs.writeFile(source, '{}', { mode: 0o600 });
  const python = 'python3';
  const shim = path.join(root, 'native-fault');
  await fs.writeFile(shim, `#!/usr/bin/env ${python}\nimport sys,importlib.util,json,base64,os\ns=importlib.util.spec_from_file_location('writer',sys.argv[3]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.os.unlink\ndef fault(p,*a,**k):\n if os.path.basename(p).startswith('.layer-staging-'):raise PermissionError('flow final unlink denied')\n return original(p,*a,**k)\nm.os.unlink=fault\nr=json.load(sys.stdin)\nprint(json.dumps(m.protected_write(r['root'],r['filePath'],base64.b64decode(r['bytes']),r['mode'],r['operation'])))\n`, { mode: 0o700 });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  let producer: ProducerPngReceipt | undefined;
  const previous = process.env.SWB_PYTHON_BIN;
  try {
    process.env.SWB_PYTHON_BIN = shim;
    await expect(withProducerPngEffects({ beforeWrite: async () => {}, written: async r => { producer = r; }, beforeDelete: async () => {}, deleted: async () => {} }, () => writeProtectedLayerFile(root, target, bytes, 'upsert'))).rejects.toMatchObject({ effect: 'committed' });
  } finally { if (previous === undefined) delete process.env.SWB_PYTHON_BIN; else process.env.SWB_PYTHON_BIN = previous; }
  const receipt = producer!.commitFailure!.ownedStageReceipt!;
  const budget = { bytes: 1048576, records: 1000, assets: 16, jsonDepth: 80 };
  const native = createNativeAuthorizationSession(python, path.resolve('scripts/recovery-content-permissions.py'), () => 65536);
  const policy = (await native.request({ phase: 'capturePolicy', sources: [source], sourceByteLimit: budget.bytes })).sourcePolicy;
  const accounting = createOriginWorkspaceAccounting({ userData: () => userData, python, script: path.resolve('scripts/recovery-origin-permissions.py') });
  const options = { userData: () => userData, python, script: path.resolve('scripts/recovery-origin-enrollment.py'), accounting, budget: () => budget };
  const enrollment = createOriginEnrollment(options);
  let called = false;
  await expect(enrollment.capture(structuredClone(receipt), policy, async () => { called = true; throw new Error('not called'); })).rejects.toThrow('original Main');
  expect(called).toBe(false); expect(await fs.readdir(userData)).toEqual([]);
  const store = createWorkspaceRecoveryPartitions({ sourcePolicy: policy, allowUnsealedStart: true, accounting, budget,
    authorize: async request => { await native.request({ ...request, sourceByteLimit: budget.bytes }); } });
  const caller = { sender: {}, frame: {}, window: {}, document: {} };
  const offer = { revision: 'failed-B', projectRaw: {}, viewState: {}, scriptState: {}, continuationState: { notExecutable: true }, effectFacts: { ownedStageReceipt: receipt }, assets: [{ assetId: 'failed', role: 'failed', bytes, width: 2, height: 2, encoding: 'png' }], requiredAssetIds: ['failed'] };
  const capture = await accounting.run(() => enrollment.capture(receipt, policy, async () => {
    const ack = await store.retain(caller, root, offer);
    const read = await store.readAssets(root, ack.generationId); expect(read.get('failed')).toEqual(bytes);
    const after = await store.inspectReadonly(root); expect(after.ack?.sealDigest).toBe(ack.sealDigest);
    return { ...ack, format: 'v1' as const, policyKey: null };
  }));
  await expect(createOriginEnrollment(options).verifyCold(JSON.parse(JSON.stringify(receipt)), policy, capture)).resolves.toBe(true);
  await expect(createOriginEnrollment(options).verifyCold(JSON.parse(JSON.stringify(receipt)), policy, { ...capture, sealDigest: '0'.repeat(64) })).rejects.toThrow();
  expect((await fs.stat(target)).nlink).toBe(2); expect(await fs.readFile(target)).toEqual(bytes);
}, 120000);
