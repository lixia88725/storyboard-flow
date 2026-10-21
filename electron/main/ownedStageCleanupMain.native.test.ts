import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { createOriginEnrollment } from './originEnrollment';
import { createOriginWorkspaceAccounting, originWorkspaceKey } from './originWorkspaceAccounting';
import { createRecoveryClaimRecords } from './recoveryClaimRecords';
import { writeLayerPng } from './layerAssetService';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';

// Real Main/controller, origin registry, native writer, recovery capture and
// cleanup. Caller objects and no-source-effect Save are test boundary ports;
// NOT renderer/preload/actual Close, and NOT permission to use real userData.
test.each(['complete', 'reservation-refused', 'terminal-tail', 'content-terminal-tail', 'caller-invalid'] as const)('fresh Main %s accepts only its observed version selector and explicit cleanup retains the original failure without next-write permission', async mode => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'main-cleanup-root-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'main-cleanup-data-'));
  const python = 'python3';
  const bitmapPath = '.storyboard-workbench/layers/s/a.png', targetBitmapPath = '.storyboard-workbench/layers/s/new.png';
  const target = path.join(root, targetBitmapPath), metadataPath = path.join(root, '.storyboard-workbench/storyboard.project.json'), scriptPath = path.join(root, 'storyboard-script.md');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  await fs.writeFile(path.join(root, bitmapPath), bytes, { mode: 0o600 });
  await fs.writeFile(path.join(root, 's.tiff'), await sharp(bytes).tiff().toBuffer(), { mode: 0o600 });
  const project = { id: 'p', name: 'explicit owned cleanup', shots: [{ id: 's', imagePath: path.join(root, 's.tiff'), fileName: 's.tiff', swb: { status: 'owned', canvasWidth: 2, canvasHeight: 2 }, layers: [{ id: 'a', kind: 'paint', bitmapPath, width: 2, height: 2 }] }], dialogues: [] };
  const persist = async () => { await fs.writeFile(metadataPath, JSON.stringify(project, null, 2) + '\n', { mode: 0o600 }); await fs.writeFile(scriptPath, serializeStoryboardScriptMarkdown(project as any), { mode: 0o600 }); return {}; };
  await persist();
  const budget = { bytes: 16 * 1024 * 1024, records: 2000, assets: 64, jsonDepth: 80 };
  let enrollmentScript = path.resolve('scripts/recovery-origin-enrollment.py');
  let contentScript = path.resolve('scripts/recovery-content-permissions.py');
  if (mode === 'terminal-tail' || mode === 'content-terminal-tail') {
    const directory = path.join(root, 'isolated-native-adapters'); await fs.mkdir(directory, { mode: 0o700 });
    const load = (name: string) => `import importlib.util\ns=importlib.util.spec_from_file_location('original',${JSON.stringify(path.resolve('scripts', name))});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndef authorize(r):return m.authorize(r)\n`;
    enrollmentScript = path.join(directory, 'recovery-origin-enrollment.py');
    await fs.writeFile(enrollmentScript, load('recovery-origin-enrollment.py'), { mode: 0o600 });
    await fs.writeFile(path.join(directory, 'owned-stage-cleanup.py'), load('owned-stage-cleanup.py') + (mode === 'terminal-tail' ? `import atexit,sys\natexit.register(lambda:(sys.stdout.write('unexpected-tail'),sys.stdout.flush()))\n` : ''), { mode: 0o600 });
    if (mode === 'content-terminal-tail') {
      contentScript = path.join(directory, 'recovery-content-permissions.py');
      await fs.writeFile(contentScript, load('recovery-content-permissions.py') + `import atexit,sys,pathlib\ndef finish():\n if any(pathlib.Path(${JSON.stringify(userData)}).glob('workspace-origin-v1/*/*.repair.*')):\n  sys.stdout.write('outer-reader-terminal-tail');sys.stdout.flush()\natexit.register(finish)\n`, { mode: 0o600 });
    }
  }
  const configure = (acceptedBudget = budget) => {
    const accounting = createOriginWorkspaceAccounting({ userData: () => userData, python, script: path.resolve('scripts/recovery-origin-permissions.py'),
      claimRecords: () => createRecoveryClaimRecords({ userData: () => userData, python, script: path.resolve('scripts/recovery-claim-records.py') }),
      claimWriter: (_root, restrictions) => createRecoveryClaimRecords({ userData: () => userData, python, script: path.resolve('scripts/recovery-claim-records.py'), restrictions: () => restrictions }) });
    const originEnrollment = createOriginEnrollment({ userData: () => userData, accounting, python, script: enrollmentScript, budget: () => acceptedBudget });
    return { budget: acceptedBudget, python, accounting, originEnrollment, script: contentScript };
  };
  const frame = {}, event: any = { sender: { mainFrame: frame }, senderFrame: frame };
  const service = createPreparedWorkspaceSave(configure());
  const payload = { folderPath: root, metadataPath, normalSave: true, project, recoveryContent: { projectRaw: project, sequence: 1, assetRevision: 0, desiredAssets: [], retainedAssetIntents: [], effectFacts: { receipt: [], deletions: [], remainingScript: null, unsettled: false } } };
  const saved = await service.run(event, payload, async () => ({ project, normalSaveOutputs: [] }));
  await service.persist(event, { ...payload, recoverySaveNonce: saved.recoverySaveNonce }, persist);
  await service.acknowledge(event, { folderPath: root, nonce: saved.recoverySaveNonce, project });
  const beforeJSON = await fs.readFile(metadataPath), beforeScript = await fs.readFile(scriptPath);
  const shim = path.join(root, 'publication-fault');
  await fs.writeFile(shim, `#!/usr/bin/env ${python}\nimport sys,importlib.util,json,base64,os\ns=importlib.util.spec_from_file_location('writer',sys.argv[3]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.os.unlink\ndef fault(p,*a,**k):\n if os.path.basename(p).startswith('.layer-staging-'):raise PermissionError('fixture original final unlink denied')\n return original(p,*a,**k)\nm.os.unlink=fault\nr=json.load(sys.stdin)\nprint(json.dumps(m.protected_write(r['root'],r['filePath'],base64.b64decode(r['bytes']),r['mode'],r['operation'])))\n`, { mode: 0o700 });
  const previous = process.env.SWB_PYTHON_BIN;
  let failure: any;
  try {
    process.env.SWB_PYTHON_BIN = shim;
    failure = await service.ordinary(event, 'layers:writePng', { folderPath: root }, [target], () => writeLayerPng({ folderPath: root, bitmapPath: targetBitmapPath, dataUrl: 'data:image/png;base64,' + bytes.toString('base64') })).catch(e => e);
  } finally { if (previous === undefined) delete process.env.SWB_PYTHON_BIN; else process.env.SWB_PYTHON_BIN = previous; }
  expect(failure).toMatchObject({ effect: 'committed', filePath: target });
  expect(failure.receiptError).toBeUndefined();
  const configured = configure();
  const used = mode === 'reservation-refused' ? (await configured.accounting(root, budget)).bytes : budget.bytes;
  const fresh = createPreparedWorkspaceSave(mode === 'reservation-refused' ? configure({ ...budget, bytes: used }) : configured), observed = await fresh.observeWorkspace(event, root);
  const raw = await fresh.readReadonly(root), facts: any = (raw.effectFacts as any).producerCommitFailure;
  const selector = { binding: observed.binding, failedVersion: facts.version };
  await expect((fresh as any).retryFailedOrigin(event, { ...selector, stagePath: failure.retainedTemporary })).rejects.toThrow();
  await expect((fresh as any).retryFailedOrigin(event, { ...selector, failedVersion: 'wrong' })).rejects.toThrow();
  expect((await fs.stat(target)).nlink).toBe(2);
  if (mode === 'reservation-refused') {
    const folder = path.join(userData, 'workspace-origin-v1', await originWorkspaceKey(root)), before = (await fs.readdir(folder)).sort();
    let dispatched = 0;
    await expect((fresh as any).retryFailedOrigin(event, selector, () => { dispatched++; })).rejects.toThrow(/reservation.*budget/);
    expect(dispatched).toBe(0);
    expect(await fs.readFile(failure.retainedTemporary)).toEqual(bytes); expect((await fs.stat(target)).nlink).toBe(2);
    expect((await fs.readdir(folder)).sort()).toEqual(before);
    return;
  }
  if (mode === 'caller-invalid') {
    // Declared caller-port lifetime fault only after the REAL stage unlink;
    // no timer, forged native result or replaced storage implementation.
    Object.defineProperty(event.sender, 'mainFrame', { get: () => existsSync(failure.retainedTemporary) ? frame : {} });
  }
  let dispatched = 0;
  const result = await (fresh as any).retryFailedOrigin(event, selector, () => { dispatched++; });
  expect(dispatched).toBe(1);
  console.info('OWNED-CLEANUP-RESULT', JSON.stringify(result));
  if (mode === 'terminal-tail' || mode === 'content-terminal-tail') {
    expect(result).toMatchObject({ status: 'unknown', cleanupOutcome: 'unknown', auditOutcome: 'unknown', callerValidity: mode === 'terminal-tail' ? 'valid' : 'unknown', repair: { stageAbsent: true } });
    expect(await fs.readFile(target)).toEqual(bytes); expect((await fs.stat(target)).nlink).toBe(1);
    await expect(fs.lstat(failure.retainedTemporary)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(metadataPath)).toEqual(beforeJSON); expect(await fs.readFile(scriptPath)).toEqual(beforeScript);
    expect((await createPreparedWorkspaceSave({ ...configure(), script: path.resolve('scripts/recovery-content-permissions.py') }).readReadonly(root)).effectFacts).toEqual(raw.effectFacts);
    return;
  }
  if (mode === 'caller-invalid') {
    expect(result).toMatchObject({ status: 'caller-invalid', cleanupOutcome: 'stage-removed', auditOutcome: 'verified', callerValidity: 'invalid', repair: { stageAbsent: true } });
    expect(await fs.readFile(target)).toEqual(bytes); expect((await fs.stat(target)).nlink).toBe(1);
    expect(await fs.readFile(metadataPath)).toEqual(beforeJSON); expect(await fs.readFile(scriptPath)).toEqual(beforeScript);
    expect((await fresh.readReadonly(root)).effectFacts).toEqual(raw.effectFacts);
    return;
  }
  expect(result.status).toBe('repaired'); expect(result.repair.stageAbsent).toBe(true);
  expect(await fs.readFile(target)).toEqual(bytes); expect((await fs.stat(target)).nlink).toBe(1);
  await expect(fs.lstat(failure.retainedTemporary)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(metadataPath)).toEqual(beforeJSON); expect(await fs.readFile(scriptPath)).toEqual(beforeScript);
  const folder = path.join(userData, 'workspace-origin-v1', await originWorkspaceKey(root));
  const names = (await fs.readdir(folder)).sort();
  expect((await (fresh as any).retryFailedOrigin(event, selector)).status).toBe('already-repaired');
  expect((await fs.readdir(folder)).sort()).toEqual(names);
  expect((await fresh.readReadonly(root)).effectFacts).toEqual(raw.effectFacts);
  await expect(service.acknowledge(event, { folderPath: root, nonce: saved.recoverySaveNonce, project })).rejects.toThrow();
}, 120000);
