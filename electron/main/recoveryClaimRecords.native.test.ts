import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRecoveryClaimRecords } from './recoveryClaimRecords.js';
import { createNativeAuthorizationSession, NATIVE_AUTHORIZATION_TRANSPORT_BYTES } from './nativeAuthorizationSession.js';
import { createOriginWorkspaceAccounting, originWorkspaceKey } from './originWorkspaceAccounting.js';

// Real native claim records in isolated synthetic userData. The owner-only
// restriction set is observed from a real synthetic source, never invented.
const workspaceKey = 'a'.repeat(64);
const budget = { bytes: 4 * 1024 * 1024, records: 1000 };

const fixture = async () => {
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'claim-records-data-'));
  const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'claim-records-source-'));
  const source = path.join(sourceRoot, 'synthetic.png');
  await fs.writeFile(source, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('minimal synthetic PNG header')]), { mode: 0o600 });
  await fs.chmod(source, 0o400);
  const python = 'python3';
  const policy = await createNativeAuthorizationSession(python, path.resolve('scripts/recovery-content-permissions.py'), () => 65536)
    .request({ phase: 'capturePolicy', sources: [source], sourceByteLimit: 1024 });
  const restrictions = () => ({ ...policy.sourcePolicy.expected, acl: null });
  const records = (script = 'scripts/recovery-claim-records.py') => createRecoveryClaimRecords({ userData: () => userData, python, script: path.resolve(script), restrictions });
  return { userData, sourceRoot, source, restrictions, records };
};

const plan = { effectPeak: 40000, claimPeak: 32768, closePeak: 32768 };

test('a predeclared failure handler runs without turning the original failed request into success', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}), fullBudget={...budget,assets:100000,jsonDepth:80}, failure=new Error('original declared failure');let handled=0;
  expect(await accounting.run(async()=>{
    await expect(accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{throw failure;},async error=>{expect(error).toBe(failure);handled++;})).rejects.toBe(failure);
    return 'failed-operation-was-handled';
  })).toBe('failed-operation-was-handled');expect(handled).toBe(1);
});

test('scope drains the predeclared async handler with native census sessions still alive', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}), fullBudget={...budget,assets:100000,jsonDepth:80}, failure=new Error('handled with a final native read');
  let release!:()=>void,signal!:()=>void,finished=false,checked=false;
  const held=new Promise<void>(resolve=>{release=resolve;}),entered=new Promise<void>(resolve=>{signal=resolve;});
  const outer=accounting.run(async()=>{
    await expect(accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{throw failure;},async error=>{
      // The original unused one-record reservation stays charged until this
      // very handler and the scope settle; no physical file was written.
      expect(error).toBe(failure);signal();await held;expect((await accounting(f.sourceRoot,fullBudget)).records).toBe(1);checked=true;
    })).rejects.toBe(failure);return 'handled';
  }).then(value=>{finished=true;return value;});
  void outer.catch(()=>{});
  try{await entered;await new Promise<void>(resolve=>setImmediate(resolve));expect(finished).toBe(false);}
  finally{release();await Promise.allSettled([outer]);}
  expect(await outer).toBe('handled');expect(checked).toBe(true);
});

test.each([false,true])('a rejected failure handler stays failed and body original error wins (%s)', async bodyFailure => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}),fullBudget={...budget,assets:100000,jsonDepth:80};
  const effectError=new Error('effect original'),handlerError=new Error('handler failed'),bodyError=new Error('body original');
  const outer=accounting.run(async()=>{
    await expect(accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{throw effectError;},async()=>{throw handlerError;})).rejects.toBe(effectError);
    if(bodyFailure)throw bodyError;return 'must-not-accept-failed-handler';
  });
  await expect(outer).rejects.toBe(bodyFailure?bodyError:handlerError);
});

test('ordinary catch without a predeclared handler cannot confirm failed task settlement', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}),fullBudget={...budget,assets:100000,jsonDepth:80},failure=new Error('no disposition was registered');
  await expect(accounting.run(async()=>{
    await accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{throw failure;}).catch(error=>{expect(error).toBe(failure);});
    return 'must-not-ack-by-catching';
  })).rejects.toBe(failure);
});

test('accounting run retains an unobserved failure that settled before its body returns', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}), fullBudget={...budget,assets:100000,jsonDepth:80};
  const failure=new Error('synthetic early unobserved effect failure'),file=path.join(f.sourceRoot,'.storyboard-workbench','pending-file-transaction.json');
  let request!:Promise<void>;
  const outer=accounting.run(async()=>{
    request=accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{await fs.writeFile(file,'{}',{mode:0o600});throw failure;});
    // The real shared queue orders this native census after the entire reserve
    // (including its failed result). Do not observe that result in the body.
    await accounting(f.sourceRoot,fullBudget);return 'must-not-report-success';
  });
  await expect(outer).rejects.toBe(failure);await expect(request).rejects.toBe(failure);
  expect(await fs.readFile(file,'utf8')).toBe('{}');
});

test('accounting run retains an abandoned async rethrow rather than mistaking catch registration for recovery', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}), fullBudget={...budget,assets:100000,jsonDepth:80};
  const failure=new Error('synthetic rethrown effect failure');let chain!:Promise<void>,ready!:()=>void;
  const assigned=new Promise<void>(resolve=>{ready=resolve;});
  const outer=accounting.run(async()=>{
    chain=accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{throw failure;}).catch(async error=>{throw error;});
    ready();
    await accounting(f.sourceRoot,fullBudget);return 'must-not-report-recovery';
  });
  await assigned;void chain.catch(()=>{});
  await expect(outer).rejects.toBe(failure);await expect(chain).rejects.toBe(failure);
});

test('accounting run does not lose an abandoned failure through native Promise assimilation', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}), fullBudget={...budget,assets:100000,jsonDepth:80};
  const failure=new Error('synthetic native promise transfer failure');let bridge!:Promise<void>,ready!:()=>void;
  const assigned=new Promise<void>(resolve=>{ready=resolve;});
  const outer=accounting.run(async()=>{
    const request=accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{throw failure;});
    bridge=Promise.resolve(request).catch(async error=>{throw error;});ready();
    await accounting(f.sourceRoot,fullBudget);return 'must-not-report-native-transfer-success';
  });
  await assigned;
  // Test cleanup observes the native chain OUTSIDE the run body, so Vitest
  // receives no stray rejection. The body itself still abandons that chain.
  void bridge.catch(()=>{});
  await expect(outer).rejects.toBe(failure);await expect(bridge).rejects.toBe(failure);
});

test.each(['await-catch','catch-recover','finally-catch','all-settled'] as const)('explicitly handled reservation failure keeps normal Promise behavior (%s)', async mode => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}), fullBudget={...budget,assets:100000,jsonDepth:80}, failure=new Error('explicitly handled synthetic effect');
  expect(await accounting.run(async()=>{
    const request=accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{throw failure;},async error=>{expect(error).toBe(failure);});expect(request).toBeInstanceOf(Promise);
    if(mode==='await-catch'){try{await request;}catch(error){expect(error).toBe(failure);}}
    if(mode==='catch-recover')expect(await request.catch(error=>{expect(error).toBe(failure);return 'recovered';})).toBe('recovered');
    if(mode==='finally-catch'){let finalized=false;try{await request.finally(()=>{finalized=true;});}catch(error){expect(error).toBe(failure);}expect(finalized).toBe(true);}
    if(mode==='all-settled')expect(await Promise.allSettled([request])).toEqual([{status:'rejected',reason:failure}]);
    return 'handled-not-a-producer-ack';
  })).toBe('handled-not-a-producer-ack');
});

test('actual accounting run drains an admitted unawaited effect before closing its native census sessions', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}), fullBudget={...budget,assets:100000,jsonDepth:80};
  let release!:()=>void, signal!:()=>void, finished=false;
  const held=new Promise<void>(resolve=>{release=resolve;}), started=new Promise<void>(resolve=>{signal=resolve;});
  const file=path.join(f.sourceRoot,'.storyboard-workbench','pending-file-transaction.json');
  let effect!:Promise<string>;const outer=accounting.run(async()=>{
    effect=accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{signal();await held;await fs.writeFile(file,'{}',{mode:0o600});return 'settled';});
    void effect.catch(()=>{});await started;return 'outer-body-returned';
  }).then(result=>{finished=true;return result;});
  try{
    await started;await new Promise<void>(resolve=>setImmediate(resolve));
    expect(finished).toBe(false);
  }finally{release();await Promise.allSettled([outer,effect]);}
  expect(await outer).toBe('outer-body-returned');expect(await effect).toBe('settled');
  expect(await fs.readFile(file,'utf8')).toBe('{}');expect((await accounting(f.sourceRoot,fullBudget)).records).toBe(1);
});

test('closing accounting scope refuses a registered but not admitted request before its effect', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
  let request!:Promise<void>,effects=0;
  const outer=accounting.run(async()=>{request=accounting.reserve(f.sourceRoot,{...budget,assets:100000,jsonDepth:80},32768,1,async()=>{effects++;});return 'not-a-grant';});
  await expect(outer).rejects.toThrow(/scope closing/);await expect(request).rejects.toThrow(/scope closing/);expect(effects).toBe(0);
});

test.each([false,true])('drain preserves effects and chooses the original error without early success (outerFailure=%s)', async outerFailure => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}), fullBudget={...budget,assets:100000,jsonDepth:80};
  let release!:()=>void, signal!:()=>void,lateEffects=0;
  const held=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{signal=resolve;});
  const effectError=new Error('synthetic original effect failure'),outerError=new Error('synthetic original outer failure'),file=path.join(f.sourceRoot,'.storyboard-workbench','pending-file-transaction.json');
  let request!:Promise<void>;const outer=accounting.run(async()=>{
    request=accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{
      signal();await held;await expect(accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{lateEffects++;})).rejects.toThrow(/scope closing/);
      await fs.writeFile(file,'{}',{mode:0o600});throw effectError;
    });
    await started;if(outerFailure)throw outerError;return 'must-not-succeed';
  });
  void outer.catch(()=>{});await started;await new Promise<void>(resolve=>setImmediate(resolve));release();
  await expect(outer).rejects.toBe(outerFailure?outerError:effectError);await expect(request).rejects.toBe(effectError);
  expect(lateEffects).toBe(0);expect(await fs.readFile(file,'utf8')).toBe('{}');expect((await accounting(f.sourceRoot,fullBudget)).records).toBe(1);
});

const lifecycleGroup = async (f: Awaited<ReturnType<typeof fixture>>, script?: string) => {
  await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}), fullBudget={...budget,assets:100000,jsonDepth:80};
  const before=await accounting(f.sourceRoot,fullBudget), key=await originWorkspaceKey(f.sourceRoot), records=f.records(script);
  const input={workspaceKey:key,scopeId:'guarded-scope',claimId:'first',plan,allowance:budget,reservation:{records:1,before},lifecycle:true};
  const a=await records.admit(input), b=await records.admit({...input,claimId:'second'}), census=await accounting(f.sourceRoot,fullBudget);
  return {records,input,a,b,census,dir:path.join(f.userData,'workspace-origin-v1',key)};
};

test('v3 independent cold reader needs no new producer source and cannot invent producer restrictions', async () => {
  const f=await fixture(), g=await lifecycleGroup(f);await g.records.closeScope({members:[g.a,g.b],census:g.census,allowance:budget});
  const reader=(createRecoveryClaimRecords as any)({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-claim-records.py')});
  const rows=await reader.read(g.input);expect(rows).toHaveLength(2);expect(rows.every((row:any)=>row.scopeComplete===true)).toBe(true);
  await expect(reader.admit({...g.input,scopeId:'cannot-invent-policy'})).rejects.toThrow(/producer.*restrictions/);
});

test('native lifecycle admission cannot append a late member after any scope terminal exists', async () => {
  const f=await fixture(), g=await lifecycleGroup(f);await g.records.closeScope({members:[g.a,g.b],census:g.census,allowance:budget});
  const names=await fs.readdir(g.dir);
  await expect(f.records().admit({...g.input,claimId:'late-member'})).rejects.toThrow(/scope.*clos|terminal/i);
  expect(await fs.readdir(g.dir)).toEqual(names);expect((await f.records().read(g.input)).every(row=>row.scopeComplete)).toBe(true);
});

test('fresh actual accountant grants the next finite write only after a complete native scope proof', async () => {
  const f=await fixture(), g=await lifecycleGroup(f);await g.records.closeScope({members:[g.a,g.b],census:g.census,allowance:budget});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py'),claimRecords:()=>f.records()}), fullBudget={...budget,assets:100000,jsonDepth:80};
  const file=path.join(f.sourceRoot,'.storyboard-workbench','pending-file-transaction.json');
  expect(await accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{await fs.writeFile(file,'{}',{mode:0o600});return 'next-finite-write';})).toBe('next-finite-write');
  expect(await fs.readFile(file,'utf8')).toBe('{}');expect((await accounting(f.sourceRoot,fullBudget)).records).toBeGreaterThan(1);
  expect((await f.records().read(g.input)).every(row=>row.scopeComplete)).toBe(true);
});

test('native scope end rejects a boolean census even when Python equality matches the numeric counterpart', async () => {
  const f=await fixture(), g=await lifecycleGroup(f);
  const aBytes=await fs.readFile(path.join(g.dir,g.a.recordName)), bBytes=await fs.readFile(path.join(g.dir,g.b.recordName));
  const payload=JSON.parse(aBytes.toString('utf8')), census={...g.census,records:0};
  const members=[['first',createHash('sha256').update(aBytes).digest('hex')],['second',createHash('sha256').update(bBytes).digest('hex')]];
  payload.state='closed';payload.census=census;payload.scopeEnd={memberCount:2,membersDigest:createHash('sha256').update(JSON.stringify(members)).digest('hex'),census:{...census,records:false},outcome:'closed'};
  const native=createNativeAuthorizationSession('python3',path.resolve('scripts/recovery-claim-records.py'),()=>NATIVE_AUTHORIZATION_TRANSPORT_BYTES);
  await expect(native.request({phase:'close',userData:f.userData,workspaceKey:g.input.workspaceKey,claimName:g.a.recordName.replace(/\.reserve$/,''),sourceMode:0o400,sourceRestrictions:f.restrictions(),payload,byteLimit:budget.bytes,recordLimit:budget.records})).rejects.toThrow(/census|certification/);
  expect((await fs.readdir(g.dir)).filter(name=>name.endsWith('.closed'))).toEqual([]);
});

test('cold scope membership detects a complete reserve/terminal pair moved away without deleting evidence', async () => {
  const f=await fixture(), g=await lifecycleGroup(f);await g.records.closeScope({members:[g.a,g.b],census:g.census,allowance:budget});
  const terminal=g.b.recordName.replace(/\.reserve$/,'.closed'), reserveBytes=await fs.readFile(path.join(g.dir,g.b.recordName)), terminalBytes=await fs.readFile(path.join(g.dir,terminal));
  const saved=path.join(f.sourceRoot,'preserved-member');await fs.mkdir(saved,{mode:0o700});
  await fs.rename(path.join(g.dir,g.b.recordName),path.join(saved,g.b.recordName));await fs.rename(path.join(g.dir,terminal),path.join(saved,terminal));
  await expect(f.records().read(g.input)).rejects.toThrow(/member set/);
  expect(await fs.readFile(path.join(saved,g.b.recordName))).toEqual(reserveBytes);expect(await fs.readFile(path.join(saved,terminal))).toEqual(terminalBytes);
});

test('partial scope terminal failure leaves every cold member uncertified and cannot be retried with the old handles', async () => {
  const f=await fixture(), wrapper=path.join(f.userData,'partial-scope-end.py');
  await fs.writeFile(wrapper,`import importlib.util\nspec=importlib.util.spec_from_file_location('claims_actual',${JSON.stringify(path.resolve('scripts/recovery-claim-records.py'))})\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\ndef authorize(request):\n if request['phase']=='close' and request['payload']['claimId']=='second': raise ValueError('synthetic second terminal refusal')\n return m.authorize(request)\n`,{mode:0o600});
  const g=await lifecycleGroup(f,wrapper);await expect(g.records.closeScope({members:[g.a,g.b],census:g.census,allowance:budget})).rejects.toThrow(/second terminal refusal/);
  const rows=await f.records().read(g.input);expect(rows).toHaveLength(2);expect(rows.filter(row=>row.closed)).toHaveLength(1);expect(rows.every(row=>row.scopeComplete===false)).toBe(true);
  const cold=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py'),claimRecords:()=>f.records()});
  let effects=0;await expect(cold.reserve(f.sourceRoot,{...budget,assets:100000,jsonDepth:80},32768,1,async()=>{effects++;})).rejects.toThrow(/Persistent resource scope/);expect(effects).toBe(0);
  await expect(g.records.closeScope({members:[g.a,g.b],census:g.census,allowance:budget})).rejects.toThrow(/Original Main/);
  expect((await fs.readdir(g.dir)).filter(name=>name.endsWith('.closed'))).toHaveLength(1);
});

test('v3 cold read authenticates mixed readonly/writable record policies and different raw attributes independently', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const python='python3', other=path.join(f.sourceRoot,'second.png');
  await fs.writeFile(other,await fs.readFile(f.source),{mode:0o600});
  execFileSync('/usr/bin/xattr',['-w','org.storyboard.claim-mixed','second-source',other]);
  const observed=await createNativeAuthorizationSession(python,path.resolve('scripts/recovery-content-permissions.py'),()=>NATIVE_AUTHORIZATION_TRANSPORT_BYTES).request({phase:'capturePolicy',sources:[other],sourceByteLimit:1024});
  const second=()=>createRecoveryClaimRecords({userData:()=>f.userData,python,script:path.resolve('scripts/recovery-claim-records.py'),restrictions:()=>({...observed.sourcePolicy.expected,acl:null})});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python,script:path.resolve('scripts/recovery-origin-permissions.py')});
  const before=await accounting(f.sourceRoot,{...budget,assets:100000,jsonDepth:80}), key=await originWorkspaceKey(f.sourceRoot);
  const input={workspaceKey:key,scopeId:'mixed-scope',claimId:'first',plan,allowance:budget,reservation:{records:1,before},lifecycle:true};
  const a=await f.records().admit(input), b=await second().admit({...input,claimId:'second'});
  const rows=await second().read(input);expect(rows).toHaveLength(2);
  for(const row of rows){expect((row.claim as any).schema).toBe('swb.workspace-claim.v3');expect((row.claim as any).recordPolicyFingerprint).toMatch(/^[a-f0-9]{64}$/);}
  expect((rows[0].claim as any).recordPolicyFingerprint).not.toBe((rows[1].claim as any).recordPolicyFingerprint);
  const dir=path.join(f.userData,'workspace-origin-v1',key);
  expect((await fs.stat(path.join(dir,a.recordName))).mode&0o777).toBe(0o400);expect((await fs.stat(path.join(dir,b.recordName))).mode&0o777).toBe(0o600);
  expect((await fs.stat(f.source)).mode&0o777).toBe(0o400);expect((await fs.stat(other)).mode&0o777).toBe(0o600);
  expect((await f.records().read(input)).map(row=>row.claim.claimId).sort()).toEqual(['first','second']);
  await f.records().closeScope({members:[a,b],census:await accounting(f.sourceRoot,{...budget,assets:100000,jsonDepth:80}),allowance:budget});
  expect((await second().read(input)).every(row=>row.scopeComplete===true)).toBe(true);
});

test('native closeScope binds both original reserves and cold authenticates their shared complete end', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')}), fullBudget={...budget,assets:100000,jsonDepth:80};
  const before=await accounting(f.sourceRoot,fullBudget), key=await originWorkspaceKey(f.sourceRoot), records=f.records();
  const input={workspaceKey:key,scopeId:'complete-scope',claimId:'first',plan,allowance:budget,reservation:{records:1,before},lifecycle:true};
  const a=await records.admit(input), b=await records.admit({...input,claimId:'second'});
  const census=await accounting(f.sourceRoot,fullBudget);
  await (records as any).closeScope({members:[a,b],census,allowance:budget});
  const rows=await f.records().read(input);expect(rows).toHaveLength(2);
  for(const row of rows){expect((row as any).scopeComplete).toBe(true);expect((row.closed as any).scopeEnd.memberCount).toBe(2);expect((row.closed as any).scopeEnd.census).toEqual(census);}
  expect((rows[0].closed as any).scopeEnd).toEqual((rows[1].closed as any).scopeEnd);
});

test('v2 claim cold-read preserves the actual joint baseline and effect record plan', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
  const before=await accounting(f.sourceRoot,{...budget,assets:100000,jsonDepth:80});
  const key=await originWorkspaceKey(f.sourceRoot), reservation={records:7,before};
  const input={workspaceKey:key,scopeId:'baseline-scope',claimId:'baseline-claim',plan,allowance:budget,reservation};
  await f.records().admit(input);
  const fresh=await f.records().read(input);
  expect(fresh).toHaveLength(1);
  expect((fresh[0].claim as any).reservation).toEqual(reservation);
  expect((fresh[0].claim as any).schema).toBe('swb.workspace-claim.v2');
  expect((fresh[0].claim as any).version).toBe(2);
  expect(fresh[0].closed).toBeNull();
});

test.each([9,10])('v2 admission funds seven effect records plus its directory and two credentials (limit=%s)', async limit => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
  const before=await accounting(f.sourceRoot,{...budget,assets:100000,jsonDepth:80});
  const key=await originWorkspaceKey(f.sourceRoot), input={workspaceKey:key,scopeId:'records-scope',claimId:'records-claim',plan,allowance:{...budget,records:limit},reservation:{records:7,before}};
  if(limit===9){
    await expect(f.records().admit(input)).rejects.toThrow(/admission/);
    await expect(fs.stat(path.join(f.userData,'workspace-origin-v1'))).rejects.toMatchObject({code:'ENOENT'});
  }else{
    await f.records().admit(input);
    expect((await f.records().read(input))[0].claim.reservation?.records).toBe(7);
  }
});

test('v2 terminal cannot change its baseline or record plan and consumes only the original close slot', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
  const before=await accounting(f.sourceRoot,{...budget,assets:100000,jsonDepth:80}), key=await originWorkspaceKey(f.sourceRoot);
  const reservation={records:7,before}, input={workspaceKey:key,scopeId:'v2-close-scope',claimId:'v2-close-claim',plan,allowance:budget,reservation};
  const admitted=await f.records().admit(input), dir=path.join(f.userData,'workspace-origin-v1',key), file=path.join(dir,admitted.recordName);
  const original=await fs.readFile(file), census=await accounting(f.sourceRoot,{...budget,assets:100000,jsonDepth:80});
  for(const changed of [{...reservation,records:6},{...reservation,before:{...before,bytes:before.bytes+1}},{...reservation,before:{...before,fingerprint:'0'.repeat(64)}}]){
    await expect(f.records().close({...input,reservation:changed,census})).rejects.toThrow();
    expect(await fs.readFile(file)).toEqual(original);expect((await fs.readdir(dir)).filter(name=>name.endsWith('.closed'))).toEqual([]);
  }
  await f.records().close({...input,census,allowance:{...budget,records:3}});
  const fresh=await f.records().read(input);expect(fresh[0].claim.reservation).toEqual(reservation);expect(fresh[0].closed?.reservation).toEqual(reservation);
  expect(await fs.readFile(file)).toEqual(original);
});

test('fresh actual accountant refuses an unclosed native claim before any new effect', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const options={userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py'),claimRecords:()=>f.records()};
  const accounting=createOriginWorkspaceAccounting(options), fullBudget={...budget,assets:100000,jsonDepth:80};
  const before=await accounting(f.sourceRoot,fullBudget), key=await originWorkspaceKey(f.sourceRoot);
  const admitted=await f.records().admit({workspaceKey:key,scopeId:'unclosed-scope',claimId:'unclosed-claim',plan,allowance:budget,reservation:{records:1,before}});
  const file=path.join(f.userData,'workspace-origin-v1',key,admitted.recordName), original=await fs.readFile(file);
  let effects=0;
  await expect(createOriginWorkspaceAccounting(options).reserve(f.sourceRoot,fullBudget,32768,1,async()=>{effects++;})).rejects.toThrow(/persistent.*scope/i);
  expect(effects).toBe(0);expect(await fs.readFile(file)).toEqual(original);
});

test('native empty-claim read permits the actual accountant effect without creating private directories', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py'),claimRecords:()=>f.records()});
  const fullBudget={...budget,assets:100000,jsonDepth:80}, file=path.join(f.sourceRoot,'.storyboard-workbench','pending-file-transaction.json');
  expect(await accounting.reserve(f.sourceRoot,fullBudget,32768,1,async()=>{await fs.writeFile(file,'{}',{mode:0o600});return 'written';})).toBe('written');
  expect(await fs.readFile(file,'utf8')).toBe('{}');expect((await accounting(f.sourceRoot,fullBudget)).records).toBe(1);
  await expect(fs.stat(path.join(f.userData,'workspace-origin-v1'))).rejects.toMatchObject({code:'ENOENT'});
});

test('actual accountant rejects a Root changed after the real native private read', async () => {
  const f=await fixture();await fs.mkdir(path.join(f.sourceRoot,'.storyboard-workbench'),{mode:0o700});
  const wrapper=path.join(f.userData,'root-window-observer.py'), preserved=f.sourceRoot+'-preserved';
  await fs.writeFile(wrapper,`import importlib.util, os\nspec=importlib.util.spec_from_file_location('claims_actual',${JSON.stringify(path.resolve('scripts/recovery-claim-records.py'))})\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\ndef authorize(request):\n result=m.authorize(request)\n os.rename(${JSON.stringify(f.sourceRoot)},${JSON.stringify(preserved)})\n os.mkdir(${JSON.stringify(f.sourceRoot)},0o700)\n os.mkdir(${JSON.stringify(path.join(f.sourceRoot,'.storyboard-workbench'))},0o700)\n return result\n`,{mode:0o600});
  const accounting=createOriginWorkspaceAccounting({userData:()=>f.userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py'),claimRecords:()=>f.records(wrapper)});
  let effects=0;await expect(accounting.reserve(f.sourceRoot,{...budget,assets:100000,jsonDepth:80},32768,1,async()=>{effects++;})).rejects.toThrow(/incarnation changed/);
  expect(effects).toBe(0);expect((await fs.stat(path.join(preserved,'synthetic.png'))).mode&0o777).toBe(0o400);
});

test('real native claim admission persists, refuses a repeat byte-for-byte, and cold-reads after a fresh factory', async () => {
  const f = await fixture();
  const admitted = await f.records().admit({ workspaceKey, scopeId: 'scope-synthetic', claimId: 'claim-1', plan, allowance: budget });
  expect(admitted.census.bytes).toBeGreaterThan(0);
  const dir = path.join(f.userData, 'workspace-origin-v1', workspaceKey);
  const name = createHash('sha256').update(JSON.stringify(['swb.workspace-claim-name.v1', workspaceKey, 'scope-synthetic', 'claim-1'])).digest('hex') + '.reserve';
  const first = await fs.readFile(path.join(dir, name));
  expect(JSON.parse(first.toString('utf8')).state).toBe('reserved');
  expect((await fs.stat(path.join(dir, name))).mode & 0o777).toBe(0o400);
  // A repeated admission must never rewrite, replace or truncate the first record.
  await expect(f.records().admit({ workspaceKey, scopeId: 'scope-synthetic', claimId: 'claim-1', plan, allowance: budget })).rejects.toThrow();
  expect(await fs.readFile(path.join(dir, name))).toEqual(first);
  // A fresh factory (empty in-memory state) still sees the unresolved claim.
  const cold = await f.records().read({ workspaceKey, scopeId: 'scope-synthetic', claimId: 'claim-1', plan, allowance: budget });
  expect(cold).toHaveLength(1);
  expect(cold[0].closed).toBeNull();
  expect(cold[0].claim.effectPeak).toBe(plan.effectPeak);
  expect(cold[0].claim.claimPeak).toBe(plan.claimPeak);
  expect(cold[0].claim.closePeak).toBe(plan.closePeak);
  // The record is charged in the same origin census, not a second quota.
  const census = await createNativeAuthorizationSession('python3', path.resolve('scripts/recovery-origin-permissions.py'), () => 65536)
    .request({ phase: 'inventory', userData: f.userData, workspaceKey, byteLimit: budget.bytes, recordLimit: budget.records });
  expect(census.bytes).toBeGreaterThanOrEqual(first.length);
  expect(census.records).toBeGreaterThanOrEqual(1);
});

test('claim close requires a complete census and its credential survives a fresh factory', async () => {
  const f = await fixture();
  await f.records().admit({ workspaceKey, scopeId: 'scope-close', claimId: 'claim-2', plan, allowance: budget });
  // A terminal claim cannot be recorded without a complete, stable census.
  for (const census of [{ bytes: 1, records: 1, fingerprint: 'not-hex' }, { bytes: -1, records: 0, fingerprint: 'b'.repeat(64) }]) {
    await expect(f.records().close({ workspaceKey, scopeId: 'scope-close', claimId: 'claim-2', plan, census: census as any, allowance: budget })).rejects.toThrow();
  }
  const complete = { bytes: 120000, records: 7, fingerprint: 'c'.repeat(64) };
  await f.records().close({ workspaceKey, scopeId: 'scope-close', claimId: 'claim-2', plan, census: complete, allowance: budget });
  const cold = await f.records().read({ workspaceKey, scopeId: 'scope-close', claimId: 'claim-2', plan, allowance: budget });
  expect(cold[0].closed?.state).toBe('closed');
  expect(cold[0].closed?.census).toEqual(complete);
  // An observed overrun is a terminal fact too and is preserved verbatim.
  await f.records().admit({ workspaceKey, scopeId: 'scope-close', claimId: 'claim-3', plan, allowance: budget });
  await f.records().close({ workspaceKey, scopeId: 'scope-close', claimId: 'claim-3', plan, census: complete, exceeded: true, allowance: budget });
  const over = await f.records().read({ workspaceKey, scopeId: 'scope-close', claimId: 'claim-3', plan, allowance: budget });
  // Read returns every claim in the workspace directory; select by claim id.
  expect(over.find(entry => entry.claim.claimId === 'claim-3')?.closed?.state).toBe('exceeded');
  expect(over.find(entry => entry.claim.claimId === 'claim-2')?.closed?.state).toBe('closed');
});

test('claim admission refuses before any effect when the joint allowance cannot fund the plan and its close credential', async () => {
  const f = await fixture();
  // plan peak + close credential slot must both fit, or nothing is created.
  await expect(f.records().admit({ workspaceKey, scopeId: 'scope-small', claimId: 'claim-4', plan, allowance: { bytes: plan.effectPeak + plan.claimPeak, records: 1000 } })).rejects.toThrow('admission/refusal');
  await expect(f.records().admit({ workspaceKey, scopeId: 'scope-small', claimId: 'claim-4', plan, allowance: { bytes: budget.bytes, records: 1 } })).rejects.toThrow('admission/refusal');
  const dir = path.join(f.userData, 'workspace-origin-v1', workspaceKey);
  await expect(fs.readdir(dir)).rejects.toThrow();
});

test('cold claim read is strictly read-only when private directories do not exist', async () => {
  const f = await fixture();
  expect(await f.records().read({workspaceKey,scopeId:'cold-empty',claimId:'none',plan,allowance:{bytes:1,records:1}})).toEqual([]);
  expect(await fs.readdir(f.userData)).toEqual([]);
});

test.each([false,true])('claim admission funds the missing workspace directory record before creating it (registry=%s)', async registryPresent => {
  const f=await fixture(), registry=path.join(f.userData,'workspace-origin-v1');
  if(registryPresent)await fs.mkdir(registry,{mode:0o700});
  await expect(f.records().admit({workspaceKey,scopeId:'directory-plan',claimId:'directory-record',plan,allowance:{bytes:budget.bytes,records:2}})).rejects.toThrow('admission/refusal');
  expect(await fs.readdir(f.userData)).toEqual(registryPresent?['workspace-origin-v1']:[]);
  if(registryPresent)expect(await fs.readdir(registry)).toEqual([]);
});

test('cold claim read refuses an orphan terminal and preserves both synthetic records', async () => {
  const f = await fixture(), scopeId = 'orphan-scope', claimId = 'orphan-claim';
  const input = {workspaceKey,scopeId,claimId,plan,allowance:budget};
  const admitted = await f.records().admit(input);
  await f.records().close({...input,census:admitted.census});
  const dir = path.join(f.userData,'workspace-origin-v1',workspaceKey);
  const base = admitted.recordName.slice(0,-'.reserve'.length), reserve = path.join(dir,admitted.recordName), closed = path.join(dir,base+'.closed');
  const original = await fs.readFile(reserve), terminal = await fs.readFile(closed);
  // Self-owned test actor moves, never deletes, this run's newly created file.
  const detached = path.join(f.userData,'synthetic-detached-reserve');await fs.rename(reserve,detached);
  await expect(f.records().read(input)).rejects.toThrow('terminal without reserve');
  expect(await fs.readFile(detached)).toEqual(original);expect(await fs.readFile(closed)).toEqual(terminal);
});

test('claim close consumes only its funded terminal slot and never recreates missing claim directories', async () => {
  const f=await fixture(), input={workspaceKey,scopeId:'close-slot',claimId:'funded-slot',plan,allowance:budget};
  const admitted=await f.records().admit(input);
  const allowance={bytes:admitted.census.bytes+plan.closePeak,records:admitted.census.records+1};
  const after=await f.records().close({...input,census:admitted.census,allowance});
  expect(after.bytes).toBeLessThanOrEqual(allowance.bytes);expect(after.records).toBe(allowance.records);
  const cold=await f.records().read({...input,allowance});expect(cold[0].closed?.state).toBe('closed');
  const absent=await fixture();
  // The supplied census is an actual observation from the earlier isolated
  // namespace, not permission to fabricate an original claim in this new one.
  await expect(absent.records().close({...input,census:admitted.census})).rejects.toThrow();
  expect(await fs.readdir(absent.userData)).toEqual([]);
});

test.each(['claimPeak','closePeak'] as const)('native claim admission checks actual raw attribute and record-body funding for %s', async slot => {
  const f=await fixture(), python='python3';
  // Self-owned fixture construction, before any product request: establish a
  // genuine large attribute set within the existing native observation bound.
  await fs.chmod(f.source,0o600);
  execFileSync('/usr/bin/xattr',['-w','org.storyboard.claim-size','q'.repeat(32600),f.source]);
  await fs.chmod(f.source,0o400);
  const observed=await createNativeAuthorizationSession(python,path.resolve('scripts/recovery-content-permissions.py'),()=>NATIVE_AUTHORIZATION_TRANSPORT_BYTES).request({phase:'capturePolicy',sources:[f.source],sourceByteLimit:1024});
  const records=createRecoveryClaimRecords({userData:()=>f.userData,python,script:path.resolve('scripts/recovery-claim-records.py'),restrictions:()=>({...observed.sourcePolicy.expected,acl:null})});
  const undersized={...plan,claimPeak:65536,closePeak:65536,[slot]:32768};
  await expect(records.admit({workspaceKey,scopeId:'attribute-funding',claimId:'raw-material',plan:undersized,allowance:budget})).rejects.toThrow('record peak');
  expect(await fs.readdir(f.userData)).toEqual([]);
  const funded={...plan,claimPeak:65536,closePeak:65536}, input={workspaceKey,scopeId:'attribute-funding',claimId:'raw-material',plan:funded,allowance:budget};
  const admitted=await records.admit(input);await records.close({...input,census:admitted.census});
  const read=await records.read(input);expect(read[0].closed?.state).toBe('closed');
  expect((await fs.stat(f.source)).mode&0o777).toBe(0o400);
  expect(execFileSync('/usr/bin/xattr',['-p','org.storyboard.claim-size',f.source],{encoding:'utf8'}).trim()).toBe('q'.repeat(32600));
});

test('native cold claim read refuses when its workspace inventory changes during observation', async () => {
  const f = await fixture(), scopeId = 'window-scope', claimId = 'window-claim';
  const input = {workspaceKey,scopeId,claimId,plan,allowance:budget};
  const admitted = await f.records().admit(input), base = admitted.recordName.slice(0,-'.reserve'.length);
  const wrapper = path.join(f.sourceRoot,'claim-window-actor.py');
  const synthetic = path.join(f.userData,'workspace-origin-v1',workspaceKey,'f'.repeat(64)+'.closed');
  // Invoke the actual helper. Only the explicit self-owned actor appends a new
  // synthetic entry after discovery, before the original read returns.
  await fs.writeFile(wrapper,`import importlib.util, os\nspec=importlib.util.spec_from_file_location('claims_actual',${JSON.stringify(path.resolve('scripts/recovery-claim-records.py'))})\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\ndef authorize(request):\n original=m.read_claim\n changed=False\n def observed(*args,**kwargs):\n  nonlocal changed\n  value=original(*args,**kwargs)\n  if not changed:\n   changed=True\n   fd=os.open(${JSON.stringify(synthetic)},os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)\n   try: os.write(fd,b'{}')\n   finally: os.close(fd)\n  return value\n m.read_claim=observed\n return m.authorize(request)\n`,{mode:0o600});
  const payload=JSON.parse(await fs.readFile(path.join(f.userData,'workspace-origin-v1',workspaceKey,admitted.recordName),'utf8'));
  const native=createNativeAuthorizationSession('python3',wrapper,()=>65536);
  await expect(native.request({phase:'read',userData:f.userData,workspaceKey,claimName:base,sourceMode:0o400,sourceRestrictions:f.restrictions(),payload,byteLimit:budget.bytes,recordLimit:budget.records})).rejects.toThrow('read inventory changed');
  expect(await fs.readFile(synthetic,'utf8')).toBe('{}');
});

test.each([false,true])('fresh record setup tightens before every body write and preserves failed empty staging (failure=%s)', async failSetup => {
  const f=await fixture(), wrapper=path.join(f.sourceRoot,'record-setup-observer.py');
  await fs.writeFile(wrapper,`import importlib.util, os\nspec=importlib.util.spec_from_file_location('claims_actual',${JSON.stringify(path.resolve('scripts/recovery-claim-records.py'))})\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\ndef authorize(request):\n writes=[]\n real_write=os.write\n real_setup=m.enrollment.add_source_attributes\n def write(fd,data):\n  info=os.fstat(fd)\n  writes.append({'mode':info.st_mode & 0o777,'size':info.st_size})\n  return real_write(fd,data)\n def setup(fd,expected):\n  real_setup(fd,expected)\n  if ${failSetup?'True':'False'}: raise ValueError('synthetic setup refusal')\n os.write=write\n m.enrollment.add_source_attributes=setup\n result=m.authorize(request)\n result['bodyWrites']=writes\n return result\n`,{mode:0o600});
  const payload={schema:'swb.workspace-claim.v1',version:1,workspaceKey,scopeId:'setup-scope',claimId:'setup-claim',...plan,state:'reserved',census:null};
  const base=createHash('sha256').update(JSON.stringify(['swb.workspace-claim-name.v1',workspaceKey,payload.scopeId,payload.claimId])).digest('hex');
  const native=createNativeAuthorizationSession('python3',wrapper,()=>NATIVE_AUTHORIZATION_TRANSPORT_BYTES);
  const request={phase:'admit',userData:f.userData,workspaceKey,claimName:base,sourceMode:0o400,sourceRestrictions:f.restrictions(),payload,byteLimit:budget.bytes,recordLimit:budget.records};
  const file=path.join(f.userData,'workspace-origin-v1',workspaceKey,base+'.reserve');
  if(failSetup){
    await expect(native.request(request)).rejects.toThrow('synthetic setup refusal');
    expect((await fs.stat(file)).size).toBe(0);expect((await fs.stat(file)).mode&0o777).toBe(0o600);
  }else{
    const result=await native.request(request);expect(result.bodyWrites).toEqual([{mode:0o400,size:0}]);
    expect((await fs.stat(file)).mode&0o777).toBe(0o400);expect((await fs.stat(file)).size).toBeGreaterThan(0);
  }
  expect((await fs.stat(f.source)).mode&0o777).toBe(0o400);
});

test.each(['reserve-terminal','terminal-reserved','plan-mismatch','zero-peak','undersized-peak','boolean-census'])('native cold claim validation rejects canonical %s records without modifying them', async kind => {
  const f = await fixture(), scopeId = 'validation-scope', claimId = 'validation-claim';
  const input = {workspaceKey,scopeId,claimId,plan,allowance:budget};
  const admitted = await f.records().admit(input);await f.records().close({...input,census:admitted.census});
  const dir = path.join(f.userData,'workspace-origin-v1',workspaceKey), base = admitted.recordName.slice(0,-'.reserve'.length);
  const reserveFile = path.join(dir,base+'.reserve'), terminalFile = path.join(dir,base+'.closed');
  const original = JSON.parse(await fs.readFile(reserveFile,'utf8')), terminal = JSON.parse(await fs.readFile(terminalFile,'utf8'));
  const file = ['reserve-terminal','zero-peak','undersized-peak'].includes(kind)?reserveFile:terminalFile;
  const value = file===reserveFile?{...original}:{...terminal};
  if(kind==='reserve-terminal'){value.state='closed';value.census=admitted.census;}
  if(kind==='terminal-reserved'){value.state='reserved';value.census=null;}
  if(kind==='plan-mismatch')value.effectPeak++;
  if(kind==='zero-peak')value.effectPeak=0;
  if(kind==='undersized-peak')value.claimPeak=1;
  if(kind==='boolean-census')value.census={...value.census,bytes:true};
  const ordered = (v:any):any => v && typeof v==='object' ? Array.isArray(v)?v.map(ordered):Object.fromEntries(Object.keys(v).sort().map(key=>[key,ordered(v[key])])):v;
  const changed = JSON.stringify(ordered(value));
  // Only this run's synthetic record is changed by the explicit test actor.
  await fs.chmod(file,0o600);await fs.writeFile(file,changed);await fs.chmod(file,0o400);
  const native = createNativeAuthorizationSession('python3',path.resolve('scripts/recovery-claim-records.py'),()=>65536);
  await expect(native.request({phase:'read',userData:f.userData,workspaceKey,claimName:base,sourceMode:0o400,sourceRestrictions:f.restrictions(),payload:original,byteLimit:budget.bytes,recordLimit:budget.records})).rejects.toThrow();
  expect(await fs.readFile(file,'utf8')).toBe(changed);expect((await fs.stat(file)).mode&0o777).toBe(0o400);
});

test('claim records refuse unsupported requests and never accept a foreign source restriction policy', async () => {
  const f = await fixture();
  const records = f.records();
  await expect(records.admit({ workspaceKey: 'not-hex', scopeId: 's', claimId: 'c', plan, allowance: budget })).rejects.toThrow();
  await expect(records.admit({ workspaceKey, scopeId: 'bad scope', claimId: 'c', plan, allowance: budget })).rejects.toThrow();
  await expect(records.admit({ workspaceKey, scopeId: 's', claimId: 'c', plan: { ...plan, claimPeak: 10 }, allowance: budget })).rejects.toThrow();
  await expect(records.admit({ workspaceKey, scopeId: 's', claimId: 'c', plan, allowance: { bytes: NaN, records: 10 } })).rejects.toThrow();
  // A writable (0o600/0o644-style) source policy cannot mint a claim record.
  const wide = createRecoveryClaimRecords({ userData: () => f.userData, python: 'python3',
    script: path.resolve('scripts/recovery-claim-records.py'),
    restrictions: () => ({ ...f.restrictions(), mode: 0o644 }) });
  await expect(wide.admit({ workspaceKey, scopeId: 's', claimId: 'c', plan, allowance: budget })).rejects.toThrow();
});
