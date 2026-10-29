import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { temporaryWorkspace } from '../../test/temporaryWorkspace';
import { createNativeAuthorizationSession, NATIVE_AUTHORIZATION_TRANSPORT_BYTES } from './nativeAuthorizationSession';
import { createRecoveryClaimRecords } from './recoveryClaimRecords';
import { intersectRecoveryPolicies, recoveryPolicyKey } from './recoveryPolicyPartition';

const marker = Buffer.from('com.apple.provenance').toString('base64');
const budget = { bytes: 4 * 1024 * 1024, records: 1000 };
const plan = { effectPeak: 40000, claimPeak: 32768, closePeak: 32768 };
const key = 'a'.repeat(64);
const fixture = async () => {
  const root = await temporaryWorkspace('provenance-');
  const userData = path.join(root, 'userData'); await fs.mkdir(userData, { mode: 0o700 });
  const source = path.join(root, 'source.json'); await fs.writeFile(source, '{}', { mode: 0o600 });
  const native = (script: string) => createNativeAuthorizationSession('python3', path.resolve('scripts', script), () => NATIVE_AUTHORIZATION_TRANSPORT_BYTES);
  const policy = (await native('recovery-content-permissions.py').request({ phase: 'capturePolicy', sources: [source], sourceByteLimit: 1024 })).sourcePolicy;
  const observed = { ...policy.expected, acl: null };
  // Model a source created by a different responsible process. macOS does not
  // reliably allow tests to assign arbitrary provenance bytes. All file I/O,
  // native restrictions, record readback, hashes and identities below are real.
  const different = { ...observed, xattrs: { ...observed.xattrs, [marker]: Buffer.from('other-process').toString('base64') } };
  const records = (restrictions = different) => createRecoveryClaimRecords({ userData: () => userData, python: 'python3', script: path.resolve('scripts/recovery-claim-records.py'), restrictions: () => restrictions });
  const input = { workspaceKey: key, scopeId: 'different-context', claimId: 'first', plan, allowance: budget, lifecycle: true,
    reservation: { records: 1, before: { bytes: 0, records: 0, fingerprint: 'b'.repeat(64) } } };
  return { root, userData, source, policy, observed, different, records, input, native };
};

test('different source provenance permits real claim admission, close and fresh-reader verification', async () => {
  const f = await fixture(), records = f.records();
  const admitted = await records.admit(f.input);
  const filename = path.join(f.userData, 'workspace-origin-v1', key, admitted.recordName);
  const before = await fs.readFile(filename);
  await records.closeScope({ members: [admitted], census: admitted.census, allowance: budget });
  const rows = await f.records(f.observed).read(f.input);
  expect(rows).toHaveLength(1); expect(rows[0].scopeComplete).toBe(true);
  expect(await fs.readFile(filename)).toEqual(before);
  expect(await fs.readFile(f.source, 'utf8')).toBe('{}');
});

test.each([false,true])('legacy claim lifecycle retains cross-process source policy (v2=%s)', async v2 => {
  const f = await fixture(), records = f.records();
  const input = { ...f.input, lifecycle:false, reservation:v2 ? f.input.reservation : undefined };
  const admitted = await records.admit(input);
  await records.close({ ...input, census:admitted.census });
  expect((await f.records().read(input))[0].closed?.state).toBe('closed');
});

test.each(['com.apple.quarantine','org.storyboard.policy'])('cold claim read still refuses changed %s', async attribute => {
  const f = await fixture(), admitted = await f.records().admit(f.input);
  const file = path.join(f.userData,'workspace-origin-v1',key,admitted.recordName), before = await fs.readFile(file);
  execFileSync('/usr/bin/xattr',['-w',attribute,'changed',file]);
  await expect(f.records().read(f.input)).rejects.toThrow('policy fingerprint');
  expect(await fs.readFile(file)).toEqual(before);
});

test('recovery content inherits permissions and tags while preserving its own native provenance', async () => {
  const f = await fixture(), native = f.native('recovery-content-permissions.py');
  const policy = structuredClone(f.policy), tag = Buffer.from('org.storyboard.policy').toString('base64');
  // An immutable certificate captured under another creation context. Retaining
  // content must not require that historic source process to still be running.
  policy.expected.xattrs = { ...f.different.xattrs, [tag]:Buffer.from('retained').toString('base64') };
  policy.observed[0][1].xattrs = { ...policy.expected.xattrs };
  const dir = path.join(f.root,'.storyboard-workbench','workspace-recovery-v1'); await fs.mkdir(dir,{recursive:true,mode:0o700});
  const file = path.join(dir,'synthetic.json'); await fs.writeFile(file,'',{mode:0o600});
  const inspect = async () => (await native.request({phase:'captureMemoryPolicy',sources:[file],sourceByteLimit:1024})).sourcePolicy.observed[0][1];
  const before = await inspect();
  await native.request({phase:'beforeBytes',root:f.root,path:file,sourcePolicy:policy,sourceByteLimit:1024});
  await fs.writeFile(file,'{}');
  await native.request({phase:'read',root:f.root,path:file,sourcePolicy:policy,sourceByteLimit:1024});
  const after = await inspect();
  expect(after.xattrs[marker]).toBe(before.xattrs[marker]);
  expect(after.xattrs[tag]).toBe(policy.expected.xattrs[tag]);
  expect(after.mode).toBe(policy.expected.mode);
  const other = structuredClone(policy); other.expected.xattrs[marker] = Buffer.from('third-context').toString('base64');
  other.observed[0][1].xattrs[marker] = other.expected.xattrs[marker];
  expect(intersectRecoveryPolicies([policy,other]).observed).toHaveLength(2);
  // Existing immutable partition addresses must not be silently re-keyed.
  expect(recoveryPolicyKey(policy)).not.toBe(recoveryPolicyKey(other));
  other.expected.xattrs[tag] = Buffer.from('conflict').toString('base64');
  expect(() => intersectRecoveryPolicies([policy,other])).toThrow('Incompatible');
});

test('replacement staging keeps its own provenance and preserves the source unchanged', async () => {
  const f = await fixture(), stage = path.join(f.root,'staged.json'); await fs.writeFile(stage,'{"new":true}',{mode:0o600});
  const output = execFileSync('python3',['-B','-c',`
import importlib.util,json,sys,base64
spec=importlib.util.spec_from_file_location('permissions',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
real=m.inspect
marker=base64.b64encode(b'com.apple.provenance').decode()
def inspect(file,**kwargs):
 value=real(file,**kwargs)
 if file==sys.argv[2]:value['xattrs']={**value['xattrs'],marker:base64.b64encode(b'different-source-context').decode()}
 return value
m.inspect=inspect
before=real(sys.argv[2]);stage_before=real(sys.argv[3]);result=m.prepare_mac(sys.argv[2],sys.argv[3])
print(json.dumps({'result':result,'sourceUnchanged':before==real(sys.argv[2]),'ownMarkerRetained':stage_before['xattrs'].get(marker)==real(sys.argv[3])['xattrs'].get(marker)}))
`,path.resolve('scripts/layer-file-permissions.py'),f.source,stage],{encoding:'utf8'});
  const result=JSON.parse(output);expect(result.result.kind).toBe('ordinary');expect(result.sourceUnchanged).toBe(true);expect(result.ownMarkerRetained).toBe(true);
  expect(await fs.readFile(stage,'utf8')).toBe('{"new":true}');
});

test('legacy v3 policy fingerprints including provenance remain readable without rewriting records', async () => {
  const f = await fixture(), e = f.observed;
  const fingerprint = createHash('sha256').update(JSON.stringify([e.uid,e.gid,e.mode,e.flags,e.acl,Object.entries(e.xattrs).sort(([a],[b]) => a < b ? -1 : a > b ? 1 : 0)])).digest('hex');
  const payload = { schema: 'swb.workspace-claim.v3', version: 3, workspaceKey: key, scopeId: 'legacy', claimId: 'old', ...plan,
    state: 'reserved', census: null, reservation: f.input.reservation, recordPolicyFingerprint: fingerprint, scopeEnd: null };
  const name = createHash('sha256').update(JSON.stringify(['swb.workspace-claim-name.v1',key,'legacy','old'])).digest('hex');
  await f.native('recovery-claim-records.py').request({ phase:'admit', userData:f.userData, workspaceKey:key, claimName:name,
    sourceMode:e.mode, sourceRestrictions:e, payload, byteLimit:budget.bytes, recordLimit:budget.records });
  const file = path.join(f.userData,'workspace-origin-v1',key,name+'.reserve'), before = await fs.readFile(file);
  expect(await f.records().read(f.input)).toHaveLength(1);
  expect(await fs.readFile(file)).toEqual(before);
});

test.each([false,true])('an empty reserve is unknown even without a terminal (closed=%s)', async closed => {
  const f = await fixture(), records = f.records(f.observed);
  const admitted = await records.admit(f.input);
  if (closed) await records.closeScope({ members:[admitted], census:admitted.census, allowance:budget });
  const dir = path.join(f.userData,'workspace-origin-v1',key), file = path.join(dir,admitted.recordName);
  const terminal = file.replace(/\.reserve$/,'.closed'), original = closed ? await fs.readFile(terminal) : undefined;
  await fs.writeFile(path.join(f.root,'reserve-evidence'),await fs.readFile(file));
  await fs.truncate(file,0); // fault in this test-owned record only
  await expect(f.records(f.observed).read(f.input)).rejects.toThrow();
  if (closed) expect(await fs.readFile(terminal)).toEqual(original);
  expect((await fs.stat(file)).size).toBe(0);
});


test.each([0o600,0o400])('write authorization is read-only and still enforces target access (mode=%s)', async mode => {
  const root=await temporaryWorkspace('authority-probe-'),target=path.join(root,'layer.png');
  await fs.writeFile(target,'old bytes',{mode});
  const script=`import sys,json,os,importlib.util
spec=importlib.util.spec_from_file_location('helper',sys.argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
root,target=sys.argv[2:];original_open=os.open;original_access=os.access;probes=[];write_opens=[]
def tracked_open(file,flags,*args,**kwargs):
    if os.fspath(file)==target and flags & (os.O_WRONLY|os.O_RDWR):
        write_opens.append(flags)
        raise AssertionError('authority probe must not open the original for writing')
    return original_open(file,flags,*args,**kwargs)
def tracked_access(file,mode,**kwargs):
    before=h.inspect_mac(target);result=original_access(file,mode,**kwargs)
    probes.append({'unchanged':h.inspect_mac(target)==before,'effective':kwargs.get('effective_ids'),'nofollow':not kwargs.get('follow_symlinks',True)})
    return result
os.open=tracked_open;os.access=tracked_access
result=h.protected_write(root,target,b'new bytes')
print(json.dumps({'result':result,'probes':probes,'writeOpens':write_opens}))`;
  const outcome=JSON.parse(execFileSync('python3',['-I','-B','-c',script,path.resolve('scripts/layer-file-permissions.py'),root,target],{encoding:'utf8'}));
  expect(outcome.writeOpens).toEqual([]);
  expect(outcome.probes).toEqual([{unchanged:true,effective:true,nofollow:true}]);
  expect(outcome.result.effect).toBe(mode===0o600?'committed':'refused');
  expect(await fs.readFile(target,'utf8')).toBe(mode===0o600?'new bytes':'old bytes');
});


test.each(['owned','source','mode','attribute','continuous'])('only owned staging may reobserve bounded ctime-only churn (%s)', async scenario => {
  const root=await temporaryWorkspace('stage-observation-'),file=path.join(root,'stage.png');await fs.writeFile(file,'stable bytes',{mode:0o600});
  const script=`import importlib.util,json,os,sys,subprocess
spec=importlib.util.spec_from_file_location('p',sys.argv[1]);h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
file,scenario=sys.argv[2:];real=os.fstat;calls=0
original=os.stat(file)
def fstat(fd):
 global calls
 calls+=1
 if calls==2 or scenario=='continuous' and calls%2==0:
  if scenario=='mode':os.chmod(file,0o400)
  elif scenario=='attribute':subprocess.run(['/usr/bin/xattr','-w','org.storyboard.changed','changed',file],check=True)
  else:os.utime(file,ns=(original.st_atime_ns,original.st_mtime_ns))
 return real(fd)
os.fstat=fstat
try:result=h.inspect_mac(file,_created_file_retries=0 if scenario=='source' else 2);error=None
except ValueError as e:result=None;error=str(e)
os.fstat=real
print(json.dumps({'result':result,'error':error,'calls':calls,'final':h.inspect_mac(file)}))`;
  const observed=JSON.parse(execFileSync('python3',['-I','-B','-c',script,path.resolve('scripts/layer-file-permissions.py'),file,scenario],{encoding:'utf8'}));
  if(scenario==='owned') { expect(observed.error).toBeNull();expect(observed.result).toEqual(observed.final);expect(observed.calls).toBeGreaterThanOrEqual(4); }
  else { expect(observed.result).toBeNull();expect(observed.error).toMatch(/changed/); }
  expect(observed.calls).toBeLessThanOrEqual(6);
  expect(await fs.readFile(file,'utf8')).toBe('stable bytes');
});

test('first original backup clones source restrictions without creating an unrelated empty stage',async()=>{
  const f=await fixture(),backup=path.join(f.root,'backup.json');
  const output=execFileSync('python3',['-B','-c',`
import importlib.util,json,sys,tempfile
spec=importlib.util.spec_from_file_location('permissions',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def refused(*a,**k):raise RuntimeError('empty staging would introduce unrelated native attributes')
tempfile.mkstemp=refused
source=sys.argv[2];destination=sys.argv[3]
before=m.inspect(source);data=open(source,'rb').read()
result=m.protected_write(sys.argv[4],destination,data,mode='create-only',policy_source=source)
print(json.dumps({'result':result,'sourceUnchanged':before==m.inspect(source),'bytesEqual':open(destination,'rb').read()==data,'policyEqual':m.inherited_restrictions(m.inspect(destination))['xattrs']==m.inherited_restrictions(before)['xattrs']}))
`,path.resolve('scripts/layer-file-permissions.py'),f.source,backup,f.root],{encoding:'utf8'});
  expect(JSON.parse(output)).toMatchObject({result:{effect:'committed',retainedTemporary:null,warnings:[]},sourceUnchanged:true,bytesEqual:true,policyEqual:true});
});

test.each(['ENOTSUP','EACCES'] as const)('native clone %s only falls back for unsupported capability',async(code)=>{
  const f=await fixture();
  const output=execFileSync('python3',['-B','-c',`
import importlib.util,json,sys,ctypes,errno
spec=importlib.util.spec_from_file_location('permissions',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
real=m.ctypes.CDLL
class Clone:
 def __call__(self,*a):ctypes.set_errno(getattr(errno,sys.argv[4]));return -1
class Lib:
 def __init__(self,*a,**k):self.real=real(*a,**k);self.clonefile=Clone()
 def __getattr__(self,n):return getattr(self.real,n)
m.ctypes.CDLL=Lib
before=m.inspect(sys.argv[2]);result=m.protected_write(sys.argv[3],sys.argv[2],b'{"new":true}')
print(json.dumps({'result':result,'bytes':open(sys.argv[2],'rb').read().decode(),'sourceUnchanged':m.inspect(sys.argv[2])==before}))
`,path.resolve('scripts/layer-file-permissions.py'),f.source,f.root,code],{encoding:'utf8'});
  const observed=JSON.parse(output);
  if(code==='ENOTSUP')expect(observed).toMatchObject({result:{effect:'committed',warnings:[]},bytes:'{"new":true}'});
  else expect(observed).toMatchObject({result:{effect:'refused',retainedTemporary:null},bytes:'{}',sourceUnchanged:true});
});
