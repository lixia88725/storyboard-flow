import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createOriginEnrollment } from './originEnrollment';
import { createOriginWorkspaceAccounting, originWorkspaceKey } from './originWorkspaceAccounting';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';
import { createWorkspaceRecoveryPartitions } from './workspaceRecoveryPartitions';
import { writeProtectedLayerFile } from './protectedLayerFileWriter';
import { withProducerPngEffects, type ProducerPngReceipt } from './producerPngEffects';

const python = 'python3';
const script = path.resolve('scripts/owned-stage-cleanup.py');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-cleanup-root-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'owned-cleanup-data-'));
  const target = path.join(root, '.storyboard-workbench/layers/s/new.png');
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const source = path.join(root, 'source.json'); await fs.writeFile(source, '{}', { mode: 0o600 });
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
  const shim = path.join(root, 'native-publication-fault');
  await fs.writeFile(shim, `#!/usr/bin/env ${python}\nimport sys,importlib.util,json,base64,os\ns=importlib.util.spec_from_file_location('writer',sys.argv[3]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.os.unlink\ndef fault(p,*a,**k):\n if os.path.basename(p).startswith('.layer-staging-'):raise PermissionError('owned cleanup original final unlink denied')\n return original(p,*a,**k)\nm.os.unlink=fault\nr=json.load(sys.stdin)\nprint(json.dumps(m.protected_write(r['root'],r['filePath'],base64.b64decode(r['bytes']),r['mode'],r['operation'])))\n`, { mode: 0o700 });
  let producer: ProducerPngReceipt | undefined;
  const previous = process.env.SWB_PYTHON_BIN;
  try {
    process.env.SWB_PYTHON_BIN = shim;
    await expect(withProducerPngEffects({ beforeWrite: async () => {}, written: async r => { producer = r; }, beforeDelete: async () => {}, deleted: async () => {} }, () => writeProtectedLayerFile(root, target, bytes, 'upsert'))).rejects.toMatchObject({ effect: 'committed' });
  } finally { if (previous === undefined) delete process.env.SWB_PYTHON_BIN; else process.env.SWB_PYTHON_BIN = previous; }
  const publication = producer!.commitFailure!.ownedStageReceipt!;
  const budget = { bytes: 1048576, records: 1000, assets: 16, jsonDepth: 80 };
  const native = createNativeAuthorizationSession(python, path.resolve('scripts/recovery-content-permissions.py'), () => 65536);
  const policy = (await native.request({ phase: 'capturePolicy', sources: [source], sourceByteLimit: budget.bytes })).sourcePolicy;
  const accounting = createOriginWorkspaceAccounting({ userData: () => userData, python, script: path.resolve('scripts/recovery-origin-permissions.py') });
  const enrollment = createOriginEnrollment({ userData: () => userData, python, script: path.resolve('scripts/recovery-origin-enrollment.py'), accounting, budget: () => budget });
  const store = createWorkspaceRecoveryPartitions({ sourcePolicy: policy, allowUnsealedStart: true, accounting, budget, authorize: async request => { await native.request({ ...request, sourceByteLimit: budget.bytes }); } });
  const caller = { sender: {}, frame: {}, window: {}, document: {} };
  await enrollment.capture(publication, policy, async () => {
    const ack = await store.retain(caller, root, { revision: 'failed-B', projectRaw: {}, viewState: {}, scriptState: {}, effectFacts: { publication }, continuationState: { notExecutable: true }, assets: [{ assetId: 'failed', role: 'failed', bytes, width: 2, height: 2, encoding: 'png' }], requiredAssetIds: ['failed'] });
    expect((await store.readAssets(root, ack.generationId)).get('failed')).toEqual(bytes);
    return { ...ack, format: 'v1', policyKey: null };
  });
  const workspaceKey = await originWorkspaceKey(root), recordName = hash(JSON.stringify(['swb.workspace-origin-operation.v1', workspaceKey, publication.operation]));
  const folder = path.join(userData, 'workspace-origin-v1', workspaceKey);
  const payload = JSON.parse(await fs.readFile(path.join(folder, recordName + '.sealed'), 'utf8'));
  const cleanup = async (adapter = script) => accounting.reserve(root, budget, 65536, 3, async () => {
    const allowance = await accounting.originAllowance(root, budget);
    return createNativeAuthorizationSession(python, adapter, () => 65536).request({ phase: 'cleanup', userData, workspaceKey, recordName, payload, sourceMode: payload.sourceMode, sourceRestrictions: { ...policy.expected, acl: null }, byteLimit: allowance.bytes, recordLimit: allowance.records, sourceByteLimit: budget.bytes, publication });
  });
  const observe = async () => {
    const allowance = await accounting.originAllowance(root, budget);
    return createNativeAuthorizationSession(python, script, () => 65536).request({ phase: 'observe', userData, workspaceKey, recordName, payload, sourceMode: payload.sourceMode, sourceRestrictions: { ...policy.expected, acl: null }, byteLimit: allowance.bytes, recordLimit: allowance.records, sourceByteLimit: budget.bytes, publication });
  };
  return { root, folder, recordName, target, stage: publication.stage, bytes, cleanup, observe };
};

test('native cleanup observation neither unlinks the live pair nor creates or completes audit records',async()=>{
  const f=await fixture(),before=(await fs.readdir(f.folder)).sort();
  const snapshots=await Promise.all(before.map(async name=>[name,await fs.readFile(path.join(f.folder,name))] as const));
  expect((await f.observe()).status).toBe('cleanup-needed');expect((await fs.stat(f.target)).nlink).toBe(2);expect((await fs.stat(f.stage)).nlink).toBe(2);
  expect(await fs.readFile(f.target)).toEqual(f.bytes);expect(await fs.readFile(f.stage)).toEqual(f.bytes);expect((await fs.readdir(f.folder)).sort()).toEqual(before);
  for(const [name,bytes] of snapshots)expect(await fs.readFile(path.join(f.folder,name))).toEqual(bytes);
  expect((await f.cleanup()).status).toBe('repaired');const after=(await fs.readdir(f.folder)).sort();
  expect((await f.observe()).status).toBe('already-repaired');expect((await fs.readdir(f.folder)).sort()).toEqual(after);
},120000);

test('authenticated explicit cleanup removes only its own stage and persists exact repair, repeated invocation is read-only', async () => {
  const f = await fixture(), before = await fs.readFile(path.join(f.root, 'source.json'));
  const result = await f.cleanup();
  expect(result.status).toBe('repaired'); expect(result.repair.stageAbsent).toBe(true);
  await expect(fs.lstat(f.stage)).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await fs.readFile(f.target)).toEqual(f.bytes); expect((await fs.stat(f.target)).nlink).toBe(1);
  expect(await fs.readFile(path.join(f.root, 'source.json'))).toEqual(before);
  const entries = (await fs.readdir(f.folder)).sort();
  expect((await f.cleanup()).status).toBe('already-repaired');
  expect((await fs.readdir(f.folder)).sort()).toEqual(entries);
}, 120000);

test('partial repair write after unlink stays unknown and explicit retry reconciles without replaying deletion', async () => {
  const f = await fixture(), fault = path.join(f.root, 'audit-fault.py');
  await fs.writeFile(fault, `import importlib.util\ns=importlib.util.spec_from_file_location('original',${JSON.stringify(script)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.write_repair\ndef fail(fd,value,expected):\n if value.get('schema')=='swb.owned-stage-repair.v1':\n  m.os.write(fd,b'{"schema":')\n  raise OSError('fixture partial audit write')\n return original(fd,value,expected)\nm.write_repair=fail\ndef authorize(r):return m.authorize(r)\n`, { mode: 0o600 });
  const first = await f.cleanup(fault);
  expect(first.status).toBe('unknown');
  expect(await fs.readFile(f.target)).toEqual(f.bytes);
  expect((await fs.stat(f.target)).nlink).toBe(1);
  await expect(fs.lstat(f.stage)).rejects.toMatchObject({ code: 'ENOENT' });
  const partial = (await fs.readdir(f.folder)).find(name => name.includes('.repair.'))!;
  const partialBytes = await fs.readFile(path.join(f.folder, partial));
  expect(partialBytes.toString()).toBe('{"schema":');
  expect((await f.cleanup()).status).toBe('reconciled');
  expect(await fs.readFile(path.join(f.folder, partial))).toEqual(partialBytes);
  expect((await f.cleanup()).status).toBe('already-repaired');
}, 120000);

test('reconciliation audit-create refusal preserves unknown after a prior actual unlink', async () => {
  const f = await fixture(), first = path.join(f.root, 'post-unlink-fault.py'), second = path.join(f.root, 'audit-create-fault.py');
  const load = `import importlib.util\ns=importlib.util.spec_from_file_location('original',${JSON.stringify(script)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n`;
  await fs.writeFile(first, load + `original=m.os.unlink\ndef fail(*a,**k):\n original(*a,**k)\n raise OSError('fixture interrupted after real unlink')\nm.os.unlink=fail\ndef authorize(r):return m.authorize(r)\n`, { mode: 0o600 });
  expect((await f.cleanup(first)).status).toBe('unknown');
  expect((await fs.stat(f.target)).nlink).toBe(1);
  await fs.writeFile(second, load + `def fail(*a,**k):raise PermissionError('fixture audit creation denied')\nm.new_audit=fail\ndef authorize(r):return m.authorize(r)\n`, { mode: 0o600 });
  expect(await f.cleanup(second)).toMatchObject({ status: 'unknown', cleanupOutcome: 'stage-absent', auditOutcome: 'unknown' });
  expect(await fs.readFile(f.target)).toEqual(f.bytes);
  await expect(fs.lstat(f.stage)).rejects.toMatchObject({ code: 'ENOENT' });
}, 120000);

test('partial intent before deletion preserves the pair and an explicit new attempt never overwrites that partial', async () => {
  const f = await fixture(), fault = path.join(f.root, 'intent-fault.py');
  await fs.writeFile(fault, `import importlib.util\ns=importlib.util.spec_from_file_location('original',${JSON.stringify(script)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.write_repair\ndef fail(fd,value,expected):\n if value.get('schema')=='swb.owned-stage-cleanup-intent.v1':\n  m.os.write(fd,b'{"schema":')\n  raise OSError('fixture partial intent write')\n return original(fd,value,expected)\nm.write_repair=fail\ndef authorize(r):return m.authorize(r)\n`, { mode: 0o600 });
  await expect(f.cleanup(fault)).rejects.toThrow('partial intent');
  expect((await fs.stat(f.target)).nlink).toBe(2);
  expect(await fs.readFile(f.stage)).toEqual(f.bytes);
  const partial = path.join(f.folder, f.recordName + '.cleanup-intent'), before = await fs.readFile(partial);
  expect(before.toString()).toBe('{"schema":');
  expect((await f.cleanup()).status).toBe('repaired');
  expect(await fs.readFile(partial)).toEqual(before);
  expect((await f.cleanup()).status).toBe('already-repaired');
}, 120000);

test('native held-directory creation-time mismatch refuses before audit/deletion despite matching dev/ino', async () => {
  const f = await fixture(), fault = path.join(f.root, 'birth-observation-fault.py');
  // Fault only the native creation-time observation seam, not a publication,
  // receipt, inode reuse or the policy result. Positive case uses the real OS.
  await fs.writeFile(fault, `import importlib.util\ns=importlib.util.spec_from_file_location('original',${JSON.stringify(script)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=getattr(m,'birthtime_ns',None)\ndef changed(fd):return original(fd)+1 if original else 0\nm.birthtime_ns=changed\ndef authorize(r):return m.authorize(r)\n`, { mode: 0o600 });
  const names = (await fs.readdir(f.folder)).sort();
  await expect(f.cleanup(fault)).rejects.toThrow(/incarnation/);
  expect(await fs.readFile(f.stage)).toEqual(f.bytes); expect((await fs.stat(f.target)).nlink).toBe(2);
  expect((await fs.readdir(f.folder)).sort()).toEqual(names);
}, 120000);

test('stage-present cleanup refuses complete conflicting repair before any new audit or unlink', async () => {
  const f = await fixture();
  const destination = path.join(f.folder, f.recordName + '.repair.' + 'f'.repeat(32));
  await fs.writeFile(destination, '[]', { mode: 0o600 });
  const entries = (await fs.readdir(f.folder)).sort();
  await expect(f.cleanup()).rejects.toThrow(/audit|conflict|schema/);
  expect((await fs.readdir(f.folder)).sort()).toEqual(entries);
  expect(await fs.readFile(f.stage)).toEqual(f.bytes); expect((await fs.stat(f.target)).nlink).toBe(2);
}, 120000);

test.each(['intent-conflict', 'repair-version', 'repair-array'] as const)('a valid repair never hides later complete %s audit evidence', async mode => {
  const f = await fixture(); await f.cleanup();
  const names = await fs.readdir(f.folder);
  const intentName = f.recordName + '.cleanup-intent';
  const repairName = names.find(name => name.includes('.repair.'))!;
  const original = JSON.parse(await fs.readFile(path.join(f.folder, mode === 'intent-conflict' ? intentName : repairName), 'utf8'));
  const changed = mode === 'intent-conflict' ? { ...original, operation: 'conflicting-operation' } : mode === 'repair-version' ? { ...original, version: 2 } : [];
  const destination = path.join(f.folder, mode === 'intent-conflict' ? intentName + '.conflict' : f.recordName + '.repair.' + '0'.repeat(32));
  await fs.writeFile(destination, JSON.stringify(changed), { mode: 0o600 });
  const bytes = await fs.readFile(destination), entries = (await fs.readdir(f.folder)).sort();
  await expect(f.cleanup()).rejects.toThrow(/conflict|schema|audit/);
  expect(await fs.readFile(destination)).toEqual(bytes);
  expect((await fs.readdir(f.folder)).sort()).toEqual(entries);
  expect(await fs.readFile(f.target)).toEqual(f.bytes);
}, 120000);

test.each(['third-link', 'mode', 'bytes', 'parent', 'missing-seal'] as const)('cleanup refuses %s and preserves both names and original failure', async mode => {
  const f = await fixture();
  if (mode === 'third-link') await fs.link(f.target, path.join(f.root, 'third-link'));
  if (mode === 'mode') await fs.chmod(f.target, 0o400);
  if (mode === 'bytes') await fs.writeFile(f.target, 'changed content');
  if (mode === 'parent') await fs.chmod(path.dirname(f.target), 0o500);
  if (mode === 'missing-seal') await fs.rename(path.join(f.folder, f.recordName + '.sealed'), path.join(f.folder, 'preserved-seal'));
  const before = await fs.readFile(f.target), entries = (await fs.readdir(f.folder)).sort();
  await expect(f.cleanup()).rejects.toThrow();
  expect(await fs.readFile(f.target)).toEqual(before); expect(await fs.readFile(f.stage)).toEqual(before);
  expect((await fs.readdir(f.folder)).sort()).toEqual(entries);
}, 120000);
