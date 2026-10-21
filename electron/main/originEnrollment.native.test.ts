import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';
import { originWorkspaceKey } from './originWorkspaceAccounting';
import { waitForNativeWorkersSettled } from './nativeWorkerSettlement';
import { fixtureAttributeBytes } from './nativeAttributeMeter.fixture';

const python = 'python3';
const script = path.resolve('scripts/recovery-origin-enrollment.py');
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

// Real native creation into isolated synthetic app-data only. No real userData.
const fixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-enroll-root-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-enroll-userdata-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const key = await originWorkspaceKey(root);
  const source = path.join(root, 'source.json');
  await fs.writeFile(source, '{"synthetic":true}', { mode: 0o400 });
  const policyNative = createNativeAuthorizationSession(python, path.resolve('scripts/recovery-content-permissions.py'), () => 65536);
  const policy = await policyNative.request({ phase: 'capturePolicy', sources: [source], sourceByteLimit: 65536 });
  const sourceRestrictions = { ...policy.sourcePolicy.expected, acl: null };
  const native = createNativeAuthorizationSession(python, script, () => 65536);
  const payload = (state: 'issued' | 'sealed', extra: Record<string, unknown> = {}) => ({
    schema: 'swb.workspace-origin-enrollment', version: 1, workspaceKey: key,
    operation: 'op-1', receiptFingerprint: hash('receipt'), targetDigest: hash('/target/a.png'),
    sourceMode: 0o400, state, capturedDigest: state === 'sealed' ? hash('captured') : null, ...extra
  });
  const issue = (body: Record<string, unknown>, extra: Record<string, unknown> = {}) => native.run(() => native.request({
    phase: 'issue', userData, workspaceKey: key, sourceMode: 0o400, sourceRestrictions, byteLimit: 131072, recordLimit: 1000, ...body, ...extra
  }));
  // One immutable issuance slot per physical workspace/original operation.
  const recordName = (body: Record<string, unknown>) => hash(JSON.stringify(['swb.workspace-origin-operation.v1', body.workspaceKey, body.operation]));
  const record = (name: string) => path.join(userData, 'workspace-origin-v1', key, name);
  return { root, userData, key, native, payload, issue, recordName, record, sourceRestrictions };
};

test('issuing an original receipt creates exactly one owner-only record charged to the same inventory', async () => {
  const f = await fixture();
  try {
    const body = f.payload('issued'), name = f.recordName(body);
    const result = await f.issue({ recordName: name, payload: body });
    expect(result.authorized).toBe(true);
    const stat = await fs.lstat(f.record(name), { bigint: true });
    expect(stat.mode & 0o777n).toBe(0o400n); // source policy mode, never widened
    expect(stat.nlink).toBe(1n);
    const stored = JSON.parse(await fs.readFile(f.record(name), 'utf8'));
    expect(Object.keys(stored).sort()).toEqual(['schema', 'version', 'workspaceKey', 'operation', 'receiptFingerprint', 'targetDigest', 'sourceMode', 'state', 'capturedDigest'].sort());
    expect(new Set([stored.operation, stored.receiptFingerprint, stored.targetDigest])).toEqual(new Set(['op-1', hash('receipt'), hash('/target/a.png')]));
    const root = path.join(f.userData, 'workspace-origin-v1', f.key);
    expect((await fs.lstat(root)).mode & 0o777).toBe(0o700);
    expect(result.bytes).toBeGreaterThanOrEqual(stat.size);
    expect(result.records).toBeGreaterThanOrEqual(1);
    // No image bytes, capability or secret material in the record.
    expect(await fs.readFile(f.record(name), 'utf8')).not.toContain('iVBORw0KGgo');
  } finally { await waitForNativeWorkersSettled(); }
}, 120000);

test('a repeated issuance refuses and preserves the first record byte for byte', async () => {
  const f = await fixture();
  try {
    const body = f.payload('issued'), name = f.recordName(body);
    await f.issue({ recordName: name, payload: body });
    const first = await fs.readFile(f.record(name));
    await expect(f.issue({ recordName: name, payload: body })).rejects.toThrow(/exists|present|refus/i);
    expect(await fs.readFile(f.record(name))).toEqual(first);
  } finally { await waitForNativeWorkersSettled(); }
}, 120000);

test('an existing registry directory with wider permissions is refused, never chmodded', async () => {
  const f = await fixture();
  try {
    const registry = path.join(f.userData, 'workspace-origin-v1');
    await fs.mkdir(registry, { mode: 0o755 });
    await fs.chmod(registry, 0o755);
    const body = f.payload('issued'), name = f.recordName(body);
    await expect(f.issue({ recordName: name, payload: body })).rejects.toThrow(/private|mode|policy/i);
    expect((await fs.lstat(registry)).mode & 0o777).toBe(0o755);
    expect(await fs.lstat(path.join(registry, f.key)).catch(() => null)).toBeNull();
  } finally { await waitForNativeWorkersSettled(); }
}, 120000);

test('attribute material is part of the exact origin allowance and is refused before any directory effect', async () => {
  const f = await fixture(), body = f.payload('issued', { sourceMode: 0o600 }), name = f.recordName(body);
  const attribute = 'com.storyboardflow.synthetic-origin', value = 'literal-fixture-value';
  const sourceRestrictions = { ...f.sourceRestrictions, mode: 0o600, xattrs: { ...f.sourceRestrictions.xattrs, [Buffer.from(attribute).toString('base64')]: Buffer.from(value).toString('base64') } };
  const length = Buffer.byteLength(JSON.stringify(Object.fromEntries(Object.keys(body).sort().map(key => [key, body[key]]))));
  const material = fixtureAttributeBytes(path.join(f.root, 'source.json')) + Buffer.byteLength(attribute) + Buffer.byteLength(value);
  await expect(f.issue({ recordName: name, payload: body }, { sourceRestrictions, sourceMode: 0o600, byteLimit: length + material - 1 })).rejects.toThrow(/budget/);
  expect(await fs.readdir(f.userData)).toEqual([]);
  await fs.mkdir(path.dirname(f.record(name)), { recursive: true, mode: 0o700 });
  const directoryBytes = fixtureAttributeBytes(path.dirname(f.record(name))) + fixtureAttributeBytes(path.dirname(path.dirname(f.record(name))));
  const peak = Math.max(32768, length + material);
  await expect(f.issue({ recordName: name, payload: body }, { sourceRestrictions, sourceMode: 0o600, byteLimit: directoryBytes + peak - 1 })).rejects.toThrow(/budget/);
  expect(await fs.readdir(path.dirname(f.record(name)))).toEqual([]);
  const result = await f.issue({ recordName: name, payload: body }, { sourceRestrictions, sourceMode: 0o600, byteLimit: directoryBytes + peak });
  expect(result.bytes).toBe(directoryBytes + length + material);
  expect((await fs.stat(f.record(name))).size).toBe(length);
}, 120000);

test('unknown OS-created file attributes require a finite creation peak before opening the new record', async () => {
  const f = await fixture(), body = f.payload('issued', { sourceMode: 0o600 }), name = f.recordName(body);
  await fs.mkdir(path.dirname(f.record(name)), { recursive: true, mode: 0o700 });
  const base = fixtureAttributeBytes(path.dirname(path.dirname(f.record(name)))) + fixtureAttributeBytes(path.dirname(f.record(name)));
  const adapter = path.join(f.root, 'unexpected-created-attribute.py');
  await fs.writeFile(adapter, `import importlib.util,ctypes,os\ns=importlib.util.spec_from_file_location('original',${JSON.stringify(script)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.os.open\ndef created(name,flags,*a,**k):\n fd=original(name,flags,*a,**k)\n if flags & os.O_CREAT:\n  put=ctypes.CDLL('/usr/lib/libSystem.B.dylib',use_errno=True).fsetxattr\n  put.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_void_p,ctypes.c_size_t,ctypes.c_uint32,ctypes.c_int]\n  put.restype=ctypes.c_int\n  data=b'x'*20000\n  if put(fd,b'com.storyboardflow.synthetic-unexpected',data,len(data),0,2)!=0:raise OSError(ctypes.get_errno(),'fixture attr set')\n return fd\nm.os.open=created\nauthorize=m.authorize\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession(python, adapter, () => 65536);
  await expect(native.request({ phase: 'issue', userData: f.userData, workspaceKey: f.key, recordName: name, sourceMode: 0o600, sourceRestrictions: { ...f.sourceRestrictions, mode: 0o600 }, payload: body, byteLimit: base + 2048, recordLimit: 1000 })).rejects.toThrow('budget');
  expect(await fs.readdir(path.dirname(f.record(name)))).toEqual([]);
}, 120000);

test('failed attribute-copy partial with zero body remains charged using actual observed attributes', async () => {
  const f = await fixture(), body = f.payload('issued', { sourceMode: 0o600 }), name = f.recordName(body);
  const key = Buffer.from('com.storyboardflow.partial-copy').toString('base64');
  const sourceRestrictions = { ...f.sourceRestrictions, mode: 0o600, xattrs: { ...f.sourceRestrictions.xattrs, [key]: Buffer.from('retained attribute data').toString('base64') } };
  const adapter = path.join(f.root, 'partial-attribute-fault.py');
  await fs.writeFile(adapter, `import importlib.util\ns=importlib.util.spec_from_file_location('original',${JSON.stringify(script)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.add_source_attributes\ndef fail(fd,expected):\n original(fd,expected)\n raise PermissionError('fixture failure after actual attribute copies')\nm.add_source_attributes=fail\nauthorize=m.authorize\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession(python, adapter, () => 65536);
  await expect(native.request({ phase: 'issue', userData: f.userData, workspaceKey: f.key, recordName: name, sourceMode: 0o600, sourceRestrictions, payload: body, byteLimit: 131072, recordLimit: 1000 })).rejects.toThrow('after actual attribute');
  expect((await fs.stat(f.record(name))).size).toBe(0);
  const attributes = fixtureAttributeBytes(path.dirname(path.dirname(f.record(name)))) + fixtureAttributeBytes(path.dirname(f.record(name))) + fixtureAttributeBytes(f.record(name));
  const inventory = createNativeAuthorizationSession(python, path.resolve('scripts/recovery-origin-permissions.py'), () => 65536);
  expect(await inventory.request({ phase: 'inventory', userData: f.userData, workspaceKey: f.key, byteLimit: attributes, recordLimit: 1000 })).toMatchObject({ bytes: attributes });
  await expect(inventory.request({ phase: 'inventory', userData: f.userData, workspaceKey: f.key, byteLimit: attributes - 1, recordLimit: 1000 })).rejects.toThrow('byte budget');
}, 120000);

test('new record copies complete permitted attributes and returns freshly observed native restrictions', async () => {
  const f = await fixture(), body = f.payload('issued', { sourceMode: 0o600 });
  const sourceRestrictions = { ...f.sourceRestrictions, mode: 0o600, xattrs: { ...f.sourceRestrictions.xattrs,
    [Buffer.from('com.storyboardflow.synthetic-origin').toString('base64')]: Buffer.from('literal-fixture-value').toString('base64') } };
  const result = await f.issue({ recordName: f.recordName(body), payload: body }, { sourceRestrictions, sourceMode: 0o600 });
  for (const key of ['uid', 'gid', 'mode', 'flags', 'acl', 'xattrs'] as const) expect(result.metadata?.[key]).toEqual(sourceRestrictions[key]);
  expect(result.metadata.links).toBe(1);
  expect(result.metadata.kind).toBe('ordinary');
}, 120000);

test('OS refusal to add an attribute on an initially 0400 record is preserved without chmod or writing payload', async () => {
  const f = await fixture(), body = f.payload('issued'), name = f.recordName(body);
  const sourceRestrictions = { ...f.sourceRestrictions, xattrs: { ...f.sourceRestrictions.xattrs,
    [Buffer.from('com.storyboardflow.synthetic-origin').toString('base64')]: Buffer.from('literal-fixture-value').toString('base64') } };
  await expect(f.issue({ recordName: name, payload: body }, { sourceRestrictions })).rejects.toThrow(/refused|restriction/i);
  const stat = await fs.lstat(f.record(name));
  expect(stat.mode & 0o777).toBe(0o400);
  expect(stat.size).toBe(0);
}, 120000);

test('unknown ACL or flags refuse before directory creation, and a gid mismatch never writes record content', async () => {
  const f = await fixture(), body = f.payload('issued'), name = f.recordName(body);
  for (const bad of [{ ...f.sourceRestrictions, acl: 'AAAA' }, { ...f.sourceRestrictions, flags: 1 }]) {
    await expect(f.issue({ recordName: name, payload: body }, { sourceRestrictions: bad })).rejects.toThrow(/restrictions/i);
    expect(await fs.readdir(f.userData)).toEqual([]);
  }
  await expect(f.issue({ recordName: name, payload: body }, { sourceRestrictions: { ...f.sourceRestrictions, gid: f.sourceRestrictions.gid + 1 } })).rejects.toThrow(/restriction/i);
  expect((await fs.lstat(f.record(name))).size).toBe(0);
}, 120000);

test('issue cannot mint a self-consistent sealed record without an issued/capture transition', async () => {
  const f = await fixture(), body = f.payload('sealed');
  await expect(f.issue({ recordName: f.recordName(body), payload: body })).rejects.toThrow(/state|sealed|issued/i);
  expect(await fs.readdir(f.userData)).toEqual([]);
}, 120000);

test('exact encoded-byte and two-record allowance is usable without an extra independent origin quota', async () => {
  const f = await fixture(), body = f.payload('issued'), name = f.recordName(body);
  const length = Buffer.byteLength(JSON.stringify(Object.fromEntries(Object.keys(body).sort().map(key => [key, body[key]]))));
  // Approved change: exact body-only capacity is NOT a safe creation allowance.
  // The final actual charge remains exact, including independent OS metadata;
  // the temporary creation peak is released only after real settlement.
  await fs.mkdir(path.dirname(f.record(name)), { recursive: true, mode: 0o700 });
  const attributes = fixtureAttributeBytes(path.dirname(path.dirname(f.record(name)))) + fixtureAttributeBytes(path.dirname(f.record(name))) + fixtureAttributeBytes(path.join(f.root, 'source.json'));
  await expect(f.issue({ recordName: name, payload: body }, { byteLimit: length + attributes, recordLimit: 2 })).rejects.toThrow('budget');
  expect(await fs.readdir(path.dirname(f.record(name)))).toEqual([]);
  const result = await f.issue({ recordName: name, payload: body }, { byteLimit: 32768 + attributes, recordLimit: 2 });
  expect(result.bytes).toBe(length + attributes); expect(result.records).toBe(2);
  expect((await fs.stat(f.record(name))).size).toBe(length);
}, 120000);

test('seal binds the exact previously issued record without changing it', async () => {
  const f = await fixture(), issued = f.payload('issued'), name = f.recordName(issued);
  await f.issue({ recordName: name, payload: issued });
  const before = await fs.readFile(f.record(name));
  const sealed = f.payload('sealed');
  await f.issue({ recordName: name, payload: sealed }, { phase: 'seal' });
  expect(await fs.readFile(f.record(name))).toEqual(before);
  expect(JSON.parse(await fs.readFile(f.record(name + '.sealed'), 'utf8'))).toEqual(sealed);
  await expect(f.issue({ recordName: name, payload: sealed }, { phase: 'seal' })).rejects.toThrow(/exists|present/i);
}, 120000);

test('seal without issued or with a different receipt is refused without any new entry', async () => {
  const f = await fixture(), issued = f.payload('issued'), name = f.recordName(issued);
  await expect(f.issue({ recordName: name, payload: f.payload('sealed') }, { phase: 'seal' })).rejects.toThrow();
  expect(await fs.readdir(f.userData)).toEqual([]);
  await f.issue({ recordName: name, payload: issued });
  const changed = f.payload('sealed', { receiptFingerprint: hash('different receipt') });
  await expect(f.issue({ recordName: name, payload: changed }, { phase: 'seal' })).rejects.toThrow(/issued|association|content/i);
  expect(await fs.readdir(path.dirname(f.record(name)))).toEqual([name]);
}, 120000);

test('changing receipt content cannot issue the same operation a second time', async () => {
  const f = await fixture(), body = f.payload('issued'), firstName = f.recordName(body);
  await f.issue({ recordName: firstName, payload: body });
  const before = await fs.readFile(f.record(firstName));
  const changed = f.payload('issued', { receiptFingerprint: hash('another receipt') });
  await expect(f.issue({ recordName: f.recordName(changed), payload: changed })).rejects.toThrow(/operation|exists|present/i);
  expect(await fs.readFile(f.record(firstName))).toEqual(before);
  expect(await fs.readdir(path.dirname(f.record(firstName)))).toEqual([firstName]);
}, 120000);

test('unknown fields, inconsistent state and an under-sized budget all refuse before creating any directory or record', async () => {
  const f = await fixture();
  try {
    const extra = f.payload('issued', { image: 'iVBORw0KGgo' }), extraName = f.recordName(extra);
    await expect(f.issue({ recordName: extraName, payload: extra })).rejects.toThrow(/field|schema|record/i);
    expect(await fs.readdir(f.userData)).toEqual([]);
    await expect(f.issue({ recordName: extraName, payload: f.payload('sealed', { capturedDigest: null }) })).rejects.toThrow(/digest|state|record/i);
    expect(await fs.readdir(f.userData)).toEqual([]);
    const issued = f.payload('issued'), issuedName = f.recordName(issued);
    await expect(f.issue({ recordName: issuedName, payload: issued }, { byteLimit: 4 })).rejects.toThrow(/budget/i);
    expect(await fs.readdir(f.userData)).toEqual([]);
  } finally { await waitForNativeWorkersSettled(); }
}, 120000);
