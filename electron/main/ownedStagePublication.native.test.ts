import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { copyLayerPng, mergeVisibleLayers, writeLayerPng } from './layerAssetService';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate';
import { createOriginEnrollment } from './originEnrollment';
import { createOriginWorkspaceAccounting, originWorkspaceKey } from './originWorkspaceAccounting';
import { createWorkspaceRecoveryPartitions } from './workspaceRecoveryPartitions';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';

const options = { budget: { bytes: 16 * 1024 * 1024, records: 2000, assets: 64, jsonDepth: 80 }, python: 'python3', script: path.resolve('scripts/recovery-content-permissions.py') };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

test.each(['complete', 'complete historical', 'complete copy', 'complete merge', 'complete origin refused', 'legacy request', 'wrong operation', 'third link', 'changed mode', 'changed parent', 'unknown metadata', 'bad digest', 'missing ACL'] as const)('new native publication %s preserves stage and failure without granting Retry', async mode => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-publication-'));
  const bitmapPath = '.storyboard-workbench/layers/s/a.png', targetPath = '.storyboard-workbench/layers/s/new.png';
  const secondBitmapPath = '.storyboard-workbench/layers/s/b.png';
  const target = path.join(root, targetPath), metadata = path.join(root, '.storyboard-workbench/storyboard.project.json'), md = path.join(root, 'storyboard-script.md');
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(root, bitmapPath), bytes, { mode: 0o600 });
  await fs.writeFile(path.join(root, secondBitmapPath), bytes, { mode: 0o600 });
  await fs.writeFile(path.join(root, 's.tiff'), await sharp(bytes).tiff().toBuffer(), { mode: 0o600 });
  const project = { id: 'p', name: 'owned publication', shots: [{ id: 's', imagePath: path.join(root, 's.tiff'), fileName: 's.tiff', swb: { status: 'owned', canvasWidth: 2, canvasHeight: 2 }, layers: [{ id: 'a', kind: 'paint', bitmapPath, width: 2, height: 2 }, { id: 'b', kind: 'paint', bitmapPath: secondBitmapPath, width: 2, height: 2 }] }], dialogues: [] };
  const persist = async () => { await fs.writeFile(metadata, JSON.stringify(project, null, 2) + '\n', { mode: 0o600 }); await fs.writeFile(md, serializeStoryboardScriptMarkdown(project as any), { mode: 0o600 }); return {}; };
  await persist();
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-publication-appdata-'));
  const accounting = createOriginWorkspaceAccounting({ userData: () => userData, python: options.python, script: path.resolve('scripts/recovery-origin-permissions.py') });
  let enrollmentScript = path.resolve('scripts/recovery-origin-enrollment.py');
  if (mode === 'complete origin refused') {
    const realScript = enrollmentScript;
    enrollmentScript = path.join(root, 'enrollment-group-fault.py');
    await fs.writeFile(enrollmentScript, `import importlib.util\ns=importlib.util.spec_from_file_location('original',${JSON.stringify(realScript)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndef authorize(r):\n r['sourceRestrictions']['gid']+=1\n return m.authorize(r)\n`, { mode: 0o600 });
  }
  const originEnrollment = createOriginEnrollment({ userData: () => userData, accounting, python: options.python, script: enrollmentScript, budget: () => options.budget });
  const configured = mode.startsWith('complete') ? { ...options, accounting, originEnrollment } : options;
  const frame = {}, event: any = { sender: { mainFrame: frame }, senderFrame: frame }, service = createPreparedWorkspaceSave(configured);
  const payload = { folderPath: root, metadataPath: metadata, normalSave: true, project, recoveryContent: { projectRaw: project, sequence: 1, assetRevision: 0, desiredAssets: [], retainedAssetIntents: [], effectFacts: { receipt: [], deletions: [], remainingScript: null, unsettled: false } } };
  // Real Main/native failed publication; Save is an admission-only no-source-effect callback.
  const saved = await service.run(event, payload, async () => ({ project, normalSaveOutputs: [] }));
  await service.persist(event, { ...payload, recoverySaveNonce: saved.recoverySaveNonce }, persist);
  await service.acknowledge(event, { folderPath: root, nonce: saved.recoverySaveNonce, project });
  const jsonBefore = await fs.readFile(metadata), mdBefore = await fs.readFile(md);
  const shim = path.join(root, 'owned-publication-adapter');
  await fs.writeFile(shim, `#!/usr/bin/env ${options.python}\nimport sys,importlib.util,json,base64,os\nspec=importlib.util.spec_from_file_location('writer',sys.argv[3]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\noriginal=m.os.unlink\ndef fault(p,*a,**k):\n if os.path.basename(p).startswith('.layer-staging-'): raise PermissionError('owned publication fixture final unlink denied')\n return original(p,*a,**k)\nm.os.unlink=fault\nr=json.load(sys.stdin)\na=[r['root'],r['filePath'],base64.b64decode(r['bytes']),r['mode']]\nif r.get('operation') is not None: a.append(r['operation'])\nprint(json.dumps(m.protected_write(*a)))\n`, { mode: 0o700 });
  // Faults preserve real native inspection, bytes and link publication. They
  // cannot manufacture a committed result or reconstruct a missing proof.
  const adapter = await fs.readFile(shim, 'utf8');
  const duringUnlink = mode === 'third link' ? "os.link(p,os.path.join(r['root'],'third-link'))" : mode === 'changed mode' ? 'os.chmod(p,0o400)' : mode === 'changed parent' ? 'os.chmod(os.path.dirname(p),0o500)' : 'pass';
  const afterPublication = mode === 'wrong operation' ? "v['ownedStageReceipt']['operation']='00000000-0000-4000-8000-000000000000'" : mode === 'bad digest' ? "v['ownedStageReceipt']['bytes']['digest']='0'*64" : mode === 'missing ACL' ? "del v['ownedStageReceipt']['targetAfterPublication']['acl']" : 'pass';
  await fs.writeFile(shim, adapter.replace("if os.path.basename(p).startswith('.layer-staging-'): raise PermissionError('owned publication fixture final unlink denied')", `if os.path.basename(p).startswith('.layer-staging-'):\n  ${duringUnlink}\n  raise PermissionError('owned publication fixture final unlink denied')`).replace("if r.get('operation') is not None: a.append(r['operation'])", mode === 'legacy request' ? 'pass' : "if r.get('operation') is not None: a.append(r['operation'])").replace('print(json.dumps(m.protected_write(*a)))', `${mode === 'unknown metadata' ? "def unavailable(p): raise PermissionError('fixture original metadata unavailable')\nm.owned_metadata=unavailable\n" : ''}v=m.protected_write(*a)\n${afterPublication}\nprint(json.dumps(v))`));
  const old = process.env.SWB_PYTHON_BIN;
  let failure: any;
  try {
    process.env.SWB_PYTHON_BIN = shim;
    const producer = mode === 'complete copy' ? 'copyPng' : mode === 'complete merge' ? 'mergeVisible' : 'writePng';
    const effect = () => mode === 'complete copy' ? copyLayerPng({ folderPath: root, sourceBitmapPath: bitmapPath, targetBitmapPath: targetPath }) : mode === 'complete merge' ? mergeVisibleLayers({ folderPath: root, targetBitmapPath: targetPath, width: 2, height: 2, layers: [bitmapPath, secondBitmapPath].map(bitmapPath => ({ bitmapPath, opacity: 1, blendMode: 'normal' as const })), deleteBitmapPaths: [] }) : writeLayerPng({ folderPath: root, bitmapPath: targetPath, dataUrl: 'data:image/png;base64,' + bytes.toString('base64') });
    failure = await service.ordinary(event, 'layers:' + producer, { folderPath: root }, [target], effect).catch(error => error);
  } finally { if (old === undefined) delete process.env.SWB_PYTHON_BIN; else process.env.SWB_PYTHON_BIN = old; }
  expect(failure).toMatchObject({ effect: 'committed', filePath: target });
  if (mode.startsWith('complete')) {
    const names = await fs.readdir(path.join(userData, 'workspace-origin-v1', await originWorkspaceKey(root)));
    if (mode === 'complete origin refused') {
      expect(names).toHaveLength(1);
      expect(names.some(name => name.endsWith('.sealed'))).toBe(false);
      expect(failure.receiptError).toBeDefined();
      expect((await fs.stat(path.join(userData, 'workspace-origin-v1', await originWorkspaceKey(root), names[0]))).size).toBe(0);
    } else {
      expect(names).toHaveLength(2);
      expect(names.filter(name => name.endsWith('.sealed'))).toHaveLength(1);
      expect(failure.receiptError).toBeUndefined();
    }
  }
  const actual = await fs.readFile(target);
  if (mode === 'complete merge') expect(await sharp(actual).raw().toBuffer()).toEqual(await sharp(bytes).raw().toBuffer());
  else expect(actual).toEqual(bytes);
  const cold = await createPreparedWorkspaceSave(options).readReadonly(root), facts: any = (cold.effectFacts as any).producerCommitFailure;
  if (mode === 'complete historical') {
    // Real second capture, not an actual Electron Close. It retains the original
    // failure inside an owner/main wrapper; no new origin issuance or reseal.
    const native = createNativeAuthorizationSession(options.python, options.script, () => 65536);
    const authorize = async (request: any) => { await native.request({ ...request, sourceByteLimit: options.budget.bytes }); };
    let store = createWorkspaceRecoveryPartitions({ budget: options.budget, accounting, authorize });
    const before = await store.inspectReadonly(root), content = before.content!;
    store = createWorkspaceRecoveryPartitions({ budget: options.budget, accounting, authorize, sourcePolicy: before.storagePolicy });
    const retained = await store.readAssets(root, before.ack!.generationId);
    await store.retain({ sender: event.sender, frame, window: {}, document: {} }, root, {
      revision: 'later-close-capture', projectRaw: content.projectRaw, viewState: content.viewState, scriptState: content.scriptState,
      effectFacts: { owner: content.effectFacts, main: { state: 'later-close' } }, continuationState: content.continuationState,
      assets: content.assets.map(({ assetId, role, width, height, encoding }) => ({ assetId, role, width, height, encoding, bytes: retained.get(assetId)! })), requiredAssetIds: content.requiredAssetIds
    });
    expect((await store.inspectReadonly(root)).ack!.generationId).not.toBe(before.ack!.generationId);
    expect((await fs.readdir(path.join(userData, 'workspace-origin-v1', await originWorkspaceKey(root)))).filter(name => name.endsWith('.sealed'))).toHaveLength(1);
  }
  if (mode === 'complete' || mode === 'complete historical') {
    const fresh = createPreparedWorkspaceSave(configured), observed = await fresh.observeWorkspace(event, root);
    await expect((fresh as any).verifyFailedOrigin(event, { binding: observed.binding, failedVersion: facts.version })).resolves.toEqual({ verified: true });
    await expect((fresh as any).verifyFailedOrigin(event, { binding: observed.binding, failedVersion: 'another-version' })).rejects.toThrow();
    const directory = path.join(userData, 'workspace-origin-v1', await originWorkspaceKey(root));
    const sealed = (await fs.readdir(directory)).find(name => name.endsWith('.sealed'))!;
    await fs.rename(path.join(directory, sealed), path.join(directory, sealed + '.preserved-missing-fixture'));
    await expect((fresh as any).verifyFailedOrigin(event, { binding: observed.binding, failedVersion: facts.version })).rejects.toThrow();
    // Moving only a synthetic anchor proves the public project receipt cannot
    // substitute for it. Restore the same fixture; never reconstruct contents.
    await fs.rename(path.join(directory, sealed + '.preserved-missing-fixture'), path.join(directory, sealed));
  }
  const proof = facts?.ownedStageReceipt;
  expect(facts).toMatchObject({ effect: 'committed', digest: hash(actual), retainedTemporary: failure.retainedTemporary, nativeCertification: 'refused' });
  if (mode.startsWith('complete')) {
  expect(proof).toMatchObject({ schema: 'swb.owned-stage-publication.v1', root, target, stage: failure.retainedTemporary, bytes: { length: actual.length, digest: hash(actual) }, publication: { method: 'link', targetWasAbsent: true } });
  expect(proof.operation).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(proof).toEqual(failure.ownedStageReceipt);
  expect(proof.creation).toEqual(failure.identity);
  expect(proof.stageBeforePublication).toMatchObject({ ...proof.creation, links: 1, size: actual.length, mode: 0o600, flags: 0, acl: null, xattrs: {} });
  expect(proof.targetAfterPublication).toEqual(proof.stageAfterPublication);
  expect(proof.targetAfterPublication).toMatchObject({ ...proof.creation, links: 2, size: actual.length, mode: 0o600, flags: 0, acl: null, xattrs: {} });
  expect(proof.parents.map((p: any) => p.path)).toEqual([root, path.join(root, '.storyboard-workbench'), path.join(root, '.storyboard-workbench/layers'), path.join(root, '.storyboard-workbench/layers/s')]);
  for (const parent of proof.parents) expect(parent.metadata).toMatchObject({ dev: expect.any(String), ino: expect.any(String), uid: expect.any(Number), gid: expect.any(Number), mode: expect.any(Number), flags: expect.any(Number), acl: null, xattrs: {} });
  } else {
    expect(proof).toBeUndefined();
    expect(failure.ownedStageReceipt).toBeUndefined();
  }
  expect(await fs.readFile(failure.retainedTemporary)).toEqual(actual);
  expect(await fs.readFile(target)).toEqual(actual);
  expect((await fs.stat(target)).nlink).toBe(mode === 'third link' ? 3 : 2);
  if (mode === 'changed mode') expect((await fs.stat(target)).mode & 0o777).toBe(0o400);
  if (mode === 'changed parent') expect((await fs.stat(path.dirname(target))).mode & 0o777).toBe(0o500);
  expect(await fs.readFile(metadata)).toEqual(jsonBefore); expect(await fs.readFile(md)).toEqual(mdBefore);
  expect((cold.continuationState as any).notExecutable).toBe(true);
  await expect(assertPhysicalWorkspaceWriterTargets([target])).rejects.toThrow('protected');
  await expect(service.acknowledge(event, { folderPath: root, nonce: saved.recoverySaveNonce, project })).rejects.toThrow();
  await fs.writeFile(path.join(root, 'PUBLICATION-OBSERVED.json'), JSON.stringify({ root, target, facts, proof, failure: String(failure) }, null, 2));
  // Preserve the actual failed publication and all its namespace/stage evidence.
}, 120000);
