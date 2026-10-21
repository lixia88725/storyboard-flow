import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRecoveryClaimRecords } from './recoveryClaimRecords.js';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession.js';

// Public Main adapter and real Native helper; only a self-owned synthetic actor
// replaces files. No production cleanup, permission repair or fake admission.
const fixture = async () => {
  const userData=await fs.mkdtemp(path.join(os.tmpdir(),'claim-identity-data-')),actors=await fs.mkdtemp(path.join(os.tmpdir(),'claim-identity-actor-'));
  const source=path.join(actors,'source.png'),python='python3',workspaceKey='b'.repeat(64);
  await fs.writeFile(source,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.from('synthetic native PNG header')]),{mode:0o400});
  const policy=(await createNativeAuthorizationSession(python,path.resolve('scripts/recovery-content-permissions.py'),()=>65536).request({phase:'capturePolicy',sources:[source],sourceByteLimit:1024})).sourcePolicy;
  const script=path.resolve('scripts/recovery-claim-records.py'),budget={bytes:4*1024*1024,records:1000},plan={effectPeak:32768,claimPeak:32768,closePeak:32768};
  const records=(helper=script)=>createRecoveryClaimRecords({userData:()=>userData,python,script:helper,restrictions:()=>({...policy.expected,acl:null})});
  const input={workspaceKey,scopeId:'original-scope',claimId:'original-member',plan,allowance:budget,reservation:{records:1,before:{bytes:0,records:0,fingerprint:'c'.repeat(64)}},lifecycle:true};
  const admission=await records().admit(input),folder=path.join(userData,'workspace-origin-v1',workspaceKey),reserve=path.join(folder,admission.recordName);
  const census=async()=>{const value=await createNativeAuthorizationSession(python,path.resolve('scripts/recovery-origin-permissions.py'),()=>65536).request({phase:'inventory',userData,workspaceKey,byteLimit:budget.bytes,recordLimit:budget.records});return {bytes:value.bytes,records:value.records,fingerprint:value.fingerprint};};
  return {userData,actors,python,script,budget,input,admission,folder,reserve,records,census};
};

test.each(['warm','close'] as const)('identical rebuilt reserve cannot inherit original admission (%s)',async mode=>{
  const f=await fixture(),original=await fs.readFile(f.reserve),detached=path.join(f.actors,'preserved-original-reserve');
  const before=await fs.stat(f.reserve,{bigint:true});await fs.rename(f.reserve,detached);await fs.writeFile(f.reserve,original,{mode:0o400,flag:'wx'});
  expect((await fs.stat(f.reserve,{bigint:true})).ino).not.toBe(before.ino);
  if(mode==='warm')expect(f.records().ownsScopeRows([f.admission],await f.records().read(f.input))).toBe(false);
  else await expect(f.records().closeScope({members:[f.admission],census:await f.census(),allowance:f.budget})).rejects.toThrow();
  expect(await fs.readFile(detached)).toEqual(original);expect(await fs.readFile(f.reserve)).toEqual(original);
},120000);

test.each(['reserve','other'] as const)('terminal append cannot certify an existing %s file replaced inside Native close',async mode=>{
  const f=await fixture(),target=mode==='reserve'?f.reserve:path.join(f.folder,'synthetic-other-record');
  if(mode==='other')await fs.writeFile(target,'preserved unrelated private record',{mode:0o400,flag:'wx'});
  const original=await fs.readFile(target),detached=path.join(f.actors,'preserved-before-close'),wrapper=path.join(f.actors,'replace-before-terminal.py');
  await fs.writeFile(wrapper,`import importlib.util, os\nspec=importlib.util.spec_from_file_location('actual_claims',${JSON.stringify(f.script)})\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\ndef authorize(request):\n original=m.create_record\n def create(*args,**kwargs):\n  if args[1].endswith('.closed'):\n   target=${JSON.stringify(target)}\n   with open(target,'rb') as stream: data=stream.read()\n   os.rename(target,${JSON.stringify(detached)})\n   fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)\n   try: os.write(fd,data)\n   finally: os.close(fd)\n  return original(*args,**kwargs)\n m.create_record=create\n return m.authorize(request)\n`,{mode:0o600});
  await expect(f.records(wrapper).closeScope({members:[f.admission],census:await f.census(),allowance:f.budget})).rejects.toThrow();
  expect(await fs.readFile(detached)).toEqual(original);expect(await fs.readFile(target)).toEqual(original);
  // Failed pre-body proof leaves the empty partial terminal charged, not a
  // valid completion that a fresh reader could use to unlock the workspace.
  await expect(f.records().read(f.input)).rejects.toThrow();
},120000);

test('the caller pre-close census cannot silently adopt an intervening namespace addition',async()=>{
  const f=await fixture(),before=await f.census();
  const extra=path.join(f.folder,'synthetic-intervening-record');await fs.writeFile(extra,'preserved',{mode:0o400,flag:'wx'});
  await expect(f.records().closeScope({members:[f.admission],census:before,originBefore:before,allowance:f.budget})).rejects.toThrow(/inventory changed before append/);
  expect((await fs.readdir(f.folder)).some(name=>name.endsWith('.closed'))).toBe(false);expect(await fs.readFile(extra,'utf8')).toBe('preserved');
},120000);
