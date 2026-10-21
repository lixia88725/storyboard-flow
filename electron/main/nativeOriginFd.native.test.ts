import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';

test('native origin metadata is inspected on the held descriptor, not a replaced pathname', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-held-fd-'));
  const file = path.join(root, 'record.json'), replacement = path.join(root, 'replacement.json');
  await fs.writeFile(file, '{}\n', { mode: 0o600 });
  await fs.writeFile(replacement, '{}\n', { mode: 0o400 });
  const held = await fs.lstat(file, { bigint: true });
  const helper = path.resolve('scripts/layer-file-permissions.py');
  const adapter = path.join(root, 'fd-inspection-adapter.py');
  await fs.writeFile(adapter, `import os,importlib.util,base64,subprocess\ns=importlib.util.spec_from_file_location('layer',${JSON.stringify(helper)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndef authorize(r):\n fd=os.open(r['file'],os.O_RDONLY|os.O_NOFOLLOW)\n try:\n  names=subprocess.check_output(['/usr/bin/xattr','-s',r['file']]).decode().splitlines()\n  expected={base64.b64encode(os.fsencode(n)).decode():base64.b64encode(bytes.fromhex(subprocess.check_output(['/usr/bin/xattr','-p','-s','-x',n,r['file']]).decode())).decode() for n in names}\n  os.rename(r['file'],r['file']+'.old')\n  os.rename(r['replacement'],r['file'])\n  observed=m.inspect_mac_fd(fd,include_acl=True,attribute_budget=32768)\n  os.fstat(fd)\n  current=m.inspect_mac(r['file'],include_acl=True,attribute_budget=32768)\n  return {'authorized':True,'sourceXattrs':expected,'held':{'dev':str(observed['dev']),'ino':str(observed['ino']),'mode':observed['mode'],'acl':observed['acl'],'xattrs':observed['xattrs'],'flags':observed['flags']},'current':{'dev':str(current['dev']),'ino':str(current['ino']),'mode':current['mode']}}\n finally:os.close(fd)\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', adapter, () => 65536);
  const result = await native.request({ file, replacement });
  expect(result.held).toEqual({ dev: String(held.dev), ino: String(held.ino), mode: 0o600, acl: null, xattrs: result.sourceXattrs, flags: 0 });
  const current = await fs.lstat(file, { bigint: true });
  expect(result.current).toEqual({ dev: String(current.dev), ino: String(current.ino), mode: 0o400 });
  expect(result.current.ino).not.toBe(result.held.ino);
  expect((await fs.lstat(file + '.old')).mode & 0o777).toBe(0o600);
  // Synthetic rename only; neither old record nor replacement is deleted.
}, 120000);

test('native descriptor inspection refuses exact ns changes hidden by numeric stat equality', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-fd-ns-'));
  const file = path.join(root, 'record.json');
  await fs.writeFile(file, '{}\n', { mode: 0o600 });
  const helper = path.resolve('scripts/layer-file-permissions.py');
  const adapter = path.join(root, 'ns-observation-adapter.py');
  // Virtual stat port deliberately preserves Python tuple/float equality while
  // changing the exact ns field. Real native ACL/xattr calls still use this FD.
  await fs.writeFile(adapter, `import os,importlib.util\ns=importlib.util.spec_from_file_location('layer',${JSON.stringify(helper)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nreal=os.fstat\nclass Observation:\n def __init__(self,base,delta):self.base=base;self.delta=delta\n def __getattr__(self,n):return getattr(self.base,n)+(self.delta if n=='st_mtime_ns' else 0)\n def __eq__(self,other):return self.base==other.base\ndef authorize(r):\n fd=os.open(r['file'],os.O_RDONLY|os.O_NOFOLLOW)\n calls=[0]\n def observe(v):\n  calls[0]+=1\n  return Observation(real(v),1 if calls[0]>1 else 0)\n m.os.fstat=observe\n try:\n  m.inspect_mac_fd(fd,include_acl=True,attribute_budget=32768)\n  return {'authorized':True}\n finally:m.os.fstat=real;os.close(fd)\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', adapter, () => 65536);
  await expect(native.request({ file })).rejects.toThrow('changed during inspection');
}, 120000);
