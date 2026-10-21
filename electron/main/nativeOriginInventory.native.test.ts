import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';
import { fixtureAttributeBytes } from './nativeAttributeMeter.fixture';
import { execFileSync } from 'node:child_process';

test('origin accounting charges all private workspace residues through descriptor-bound directories', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-private-account-'));
  const key = 'a'.repeat(64), folder = path.join(userData, 'workspace-origin-v1', key);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(folder, 'issued.partial'), Buffer.from('abc'), { mode: 0o600 });
  await fs.writeFile(path.join(folder, 'unknown-orphan'), Buffer.from('12345'), { mode: 0o400 });
  await fs.link(path.join(folder, 'issued.partial'), path.join(folder, 'alias'));
  const native = createNativeAuthorizationSession('python3', path.resolve('scripts/recovery-origin-permissions.py'), () => 65536);
  // Preserve the exact original 11 body-byte assertion; additionally charge
  // actual OS attributes using an independent read-only system-tool oracle.
  const attributes = [path.dirname(folder), folder, ...['issued.partial', 'unknown-orphan', 'alias'].map(name => path.join(folder, name))].reduce((sum, file) => sum + fixtureAttributeBytes(file), 0);
  const usage = await native.request({ phase: 'inventory', userData, workspaceKey: key, byteLimit: 32 + attributes, recordLimit: 20 });
  expect(usage).toMatchObject({ bytes: 11 + attributes, records: 4 });
  expect(usage.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  await expect(native.request({ phase: 'inventory', userData, workspaceKey: key, byteLimit: 10 + attributes, recordLimit: 20 })).rejects.toThrow('byte budget');
  await fs.symlink(folder, path.join(userData, 'alias-data'));
  await expect(native.request({ phase: 'inventory', userData: path.join(userData, 'alias-data'), workspaceKey: key, byteLimit: 32, recordLimit: 20 })).rejects.toThrow();
  expect(await fs.readFile(path.join(folder, 'unknown-orphan'), 'utf8')).toBe('12345');
  expect((await fs.lstat(path.join(folder, 'issued.partial'))).nlink).toBe(2);
  // Accounting of a link is not authority to read it as a trusted origin record.
}, 120000);

test('each workspace conservatively charges all shared registry attribute material without charging another workspace payload', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-shared-registry-'));
  const registry = path.join(userData, 'workspace-origin-v1'), a = 'a'.repeat(64), b = 'b'.repeat(64);
  await fs.mkdir(path.join(registry, a), { recursive: true, mode: 0o700 }); await fs.mkdir(path.join(registry, b), { mode: 0o700 });
  execFileSync('/usr/bin/xattr', ['-w', 'com.storyboardflow.shared-registry', 'literal shared material', registry]);
  const file = path.join(registry, a, 'owned-partial'); await fs.writeFile(file, 'data', { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', path.resolve('scripts/recovery-origin-permissions.py'), () => 65536);
  const common = fixtureAttributeBytes(registry), aBytes = common + fixtureAttributeBytes(path.join(registry, a)) + fixtureAttributeBytes(file) + 4, bBytes = common + fixtureAttributeBytes(path.join(registry, b));
  expect(await native.request({ phase: 'inventory', userData, workspaceKey: a, byteLimit: aBytes, recordLimit: 20 })).toMatchObject({ bytes: aBytes });
  expect(await native.request({ phase: 'inventory', userData, workspaceKey: b, byteLimit: bBytes, recordLimit: 20 })).toMatchObject({ bytes: bBytes });
  await expect(native.request({ phase: 'inventory', userData, workspaceKey: b, byteLimit: bBytes - 1, recordLimit: 20 })).rejects.toThrow('byte budget');
  expect(await fs.readFile(file, 'utf8')).toBe('data');
}, 120000);

test('held private workspace directory cannot certify a substituted naming chain', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-private-swap-'));
  const key = 'b'.repeat(64), folder = path.join(userData, 'workspace-origin-v1', key);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(folder, 'issued.partial'), 'retain me', { mode: 0o600 });
  const adapter = path.join(userData, 'swap-adapter.py');
  await fs.writeFile(adapter, `import os,importlib.util\ns=importlib.util.spec_from_file_location('origin',${JSON.stringify(path.resolve('scripts/recovery-origin-permissions.py'))});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.inventory\ndef substitute(d,b,r):\n p=os.path.join(d.user_data,'workspace-origin-v1',d.workspace_key)\n os.rename(p,p+'.retained')\n os.mkdir(p,0o700)\n return original(d,b,r)\nm.inventory=substitute\nauthorize=m.authorize\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', adapter, () => 65536);
  await expect(native.request({ phase: 'inventory', userData, workspaceKey: key, byteLimit: 32, recordLimit: 20 })).rejects.toThrow('naming chain changed');
  expect(await fs.readFile(path.join(folder + '.retained', 'issued.partial'), 'utf8')).toBe('retain me');
  expect(await fs.readdir(folder)).toEqual([]);
}, 120000);

test('private inventory rejects unassigned residues, non-owner-only directories and bounded record overflow without repair', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-private-refusal-'));
  const key = 'c'.repeat(64), base = path.join(userData, 'workspace-origin-v1'), folder = path.join(base, key);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(folder, 'a'), '1', { mode: 0o600 });
  await fs.writeFile(path.join(folder, 'b'), '2', { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', path.resolve('scripts/recovery-origin-permissions.py'), () => 65536);
  const attributes = [base, folder, path.join(folder, 'a'), path.join(folder, 'b')].reduce((sum, file) => sum + fixtureAttributeBytes(file), 0);
  const request = { phase: 'inventory', userData, workspaceKey: key, byteLimit: 32 + attributes, recordLimit: 2 };
  await expect(native.request(request)).rejects.toThrow('record/depth budget');
  await fs.chmod(folder, 0o750);
  await expect(native.request({ ...request, recordLimit: 20 })).rejects.toThrow('private directory policy');
  expect((await fs.lstat(folder)).mode & 0o777).toBe(0o750);
  await fs.writeFile(path.join(base, 'unassigned-partial'), 'old', { mode: 0o600 });
  await expect(native.request({ ...request, recordLimit: 20 })).rejects.toThrow('Unassigned');
  expect(await fs.readFile(path.join(base, 'unassigned-partial'), 'utf8')).toBe('old');
}, 120000);

test('existing owner-controlled application data need not be chmodded; absent private origin is not authority', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-appdata-existing-'));
  await fs.chmod(userData, 0o755);
  const native = createNativeAuthorizationSession('python3', path.resolve('scripts/recovery-origin-permissions.py'), () => 65536);
  const request = { phase: 'inventory', userData, workspaceKey: 'd'.repeat(64), byteLimit: 32, recordLimit: 20 };
  expect(await native.request(request)).toMatchObject({ bytes: 0, records: 0, absent: true });
  expect((await fs.lstat(userData)).mode & 0o777).toBe(0o755);
  expect(await fs.readdir(userData)).toEqual([]);
  await fs.chmod(userData, 0o777);
  await expect(native.request(request)).rejects.toThrow('userData policy');
  expect((await fs.lstat(userData)).mode & 0o777).toBe(0o777);
}, 120000);

test('file-to-FIFO replacement is refused without waiting for a FIFO writer', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-fifo-swap-'));
  const key = 'e'.repeat(64), folder = path.join(userData, 'workspace-origin-v1', key);
  await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(folder, 'record'), 'original', { mode: 0o600 });
  const adapter = path.join(userData, 'fifo-swap-adapter.py');
  // Swap immediately after the original regular-file stat. Guard the old
  // blocking open in the fixture so RED cannot strand a native interpreter.
  // GREEN actually opens the new FIFO without a writer, then refuses its type.
  await fs.writeFile(adapter, `import os,importlib.util\ns=importlib.util.spec_from_file_location('origin',${JSON.stringify(path.resolve('scripts/recovery-origin-permissions.py'))});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=os.open\ndef substitute(name,flags,*a,**k):\n if name=='record':\n  parent=k['dir_fd']\n  os.rename(name,'record.retained',src_dir_fd=parent,dst_dir_fd=parent)\n  os.mkfifo(name,0o600,dir_fd=parent)\n  if not flags & os.O_NONBLOCK:raise RuntimeError('fixture prevented blocking FIFO open')\n return original(name,flags,*a,**k)\nm.os.open=substitute\nauthorize=m.authorize\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', adapter, () => 65536);
  const attributes = fixtureAttributeBytes(path.dirname(folder)) + fixtureAttributeBytes(folder) + fixtureAttributeBytes(path.join(folder, 'record'));
  await expect(native.request({ phase: 'inventory', userData, workspaceKey: key, byteLimit: 32 + attributes, recordLimit: 20 })).rejects.toThrow('naming identity');
  expect(await fs.readFile(path.join(folder, 'record.retained'), 'utf8')).toBe('original');
  expect((await fs.lstat(path.join(folder, 'record'))).isFIFO()).toBe(true);
}, 120000);

test('registry address observation has a separate ceiling and does not charge other workspaces', async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-address-bound-'));
  const base = path.join(userData, 'workspace-origin-v1'), key = '0'.repeat(64);
  for (const address of [key, '1'.repeat(64), '2'.repeat(64)]) await fs.mkdir(path.join(base, address), { recursive: true, mode: 0o700 });
  await fs.writeFile(path.join(base, '1'.repeat(64), 'other'), Buffer.alloc(64), { mode: 0o600 });
  const adapter = path.join(userData, 'address-ceiling-adapter.py');
  // Lower only the production observation ceiling at the native fixture port;
  // do not redefine the selected workspace's byte/record quota or create1m dirs.
  await fs.writeFile(adapter, `import importlib.util\ns=importlib.util.spec_from_file_location('origin',${JSON.stringify(path.resolve('scripts/recovery-origin-permissions.py'))});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nm.REGISTRY_ADDRESS_SCAN_LIMIT=2\nauthorize=m.authorize\n`, { mode: 0o600 });
  const limited = createNativeAuthorizationSession('python3', adapter, () => 65536);
  const attributes = fixtureAttributeBytes(base) + fixtureAttributeBytes(path.join(base, key));
  const request = { phase: 'inventory', userData, workspaceKey: key, byteLimit: Math.max(1, attributes), recordLimit: 1 };
  await expect(limited.request(request)).rejects.toThrow('address observation budget');
  const native = createNativeAuthorizationSession('python3', path.resolve('scripts/recovery-origin-permissions.py'), () => 65536);
  expect(await native.request(request)).toMatchObject({ bytes: attributes, records: 1 });
  expect((await fs.stat(path.join(base, '1'.repeat(64), 'other'))).size).toBe(64);
}, 120000);
