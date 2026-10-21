import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave.js';
import { createOriginWorkspaceAccounting, originWorkspaceKey } from './originWorkspaceAccounting.js';
import { createRecoveryClaimRecords } from './recoveryClaimRecords.js';
import { serializeStoryboardScriptMarkdown } from './storyboardScript.js';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession.js';

type Restrictions = ReturnType<NonNullable<Parameters<typeof createRecoveryClaimRecords>[0]['restrictions']>>;

// Actual Main/Store/allocator/native adapters. Caller objects, the no-output
// Save callback and exact JSON/MD persistence are declared fixture ports, not
// renderer/preload/GUI or real-process Close coverage. No direct codec writes.
test('real PreparedSave retains only after durable admission and closes its original scope before fresh admission', async () => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'resource-lifecycle-root-')),userData=await fs.mkdtemp(path.join(os.tmpdir(),'resource-lifecycle-data-'));
  const python='python3',budget={bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80};
  const metadataPath=path.join(root,'.storyboard-workbench/storyboard.project.json'),bitmapPath='.storyboard-workbench/layers/s/a.png',imagePath=path.join(root,'s.tiff');
  await fs.mkdir(path.dirname(path.join(root,bitmapPath)),{recursive:true,mode:0o700});
  const png=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();
  const project={id:'p',name:'resource lifecycle',shots:[{id:'s',imagePath,fileName:'s.tiff',swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'a',kind:'paint',bitmapPath,width:2,height:2}]}],dialogues:[]};
  const persist=async()=>{await fs.writeFile(metadataPath,JSON.stringify(project,null,2)+'\n',{mode:0o600});await fs.writeFile(path.join(root,'storyboard-script.md'),serializeStoryboardScriptMarkdown(project as any),{mode:0o600});return {};};
  await fs.writeFile(path.join(root,bitmapPath),png,{mode:0o600});await fs.writeFile(imagePath,await sharp(png).tiff().toBuffer(),{mode:0o600});await persist();
  const config={userData:()=>userData,python,script:path.resolve('scripts/recovery-origin-permissions.py'),
    claimRecords:(_root:string)=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py')}),
    claimWriter:(_root:string,restrictions:Restrictions)=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py'),restrictions:()=>restrictions})};
  const reader=()=>config.claimRecords(root),workspaceKey=await originWorkspaceKey(root);
  const read=()=>reader().read({workspaceKey,scopeId:'resource-census',claimId:'resource-census',plan:{effectPeak:1,claimPeak:65536,closePeak:65536},allowance:budget});
  const accounting=createOriginWorkspaceAccounting(config),reserve=accounting.reserve;let checked=false;
  accounting.reserve=(root,budget,bytes,records,operation,...rest)=>reserve(root,budget,bytes,records,async()=>{
    if(!checked){
      const rows=await read();expect(rows).toHaveLength(1);expect((rows[0].claim as any).version).toBe(3);expect(rows[0].claim.effectPeak).toBe(bytes);expect(rows[0].closed).toBeNull();expect(rows[0].scopeComplete).toBe(false);
      // Original warm owner can continue; a fresh observer cannot acquire it.
      await accounting(root,budget);await expect(createOriginWorkspaceAccounting(config)(root,budget)).rejects.toThrow(/Persistent resource scope/);
      checked=true;
    }
    return operation();
  },...rest);
  const frame={},event:any={sender:{mainFrame:frame},senderFrame:frame};
  const options={accounting,budget,python,script:path.resolve('scripts/recovery-content-permissions.py')};
  const service=createPreparedWorkspaceSave(options),payload={folderPath:root,metadataPath,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  const saved=await service.run(event,payload,async()=>({project,normalSaveOutputs:[]}));expect(checked).toBe(true);
  const first=await read();expect(first).toHaveLength(1);expect(first.every(row=>row.scopeComplete===true)).toBe(true);
  await service.persist(event,{...payload,recoverySaveNonce:saved.recoverySaveNonce},persist);await service.acknowledge(event,{folderPath:root,nonce:saved.recoverySaveNonce,project});
  // Discard all live accounting/quote/admission handles for this next producer.
  const freshAccounting=createOriginWorkspaceAccounting(config),fresh=createPreparedWorkspaceSave({...options,accounting:freshAccounting});
  const next=await fresh.run(event,{...payload,recoveryContent:{...payload.recoveryContent,sequence:2}},async()=>({project,normalSaveOutputs:[]}));expect(next.recoverySaveNonce).toBeTypeOf('string');
  const final=await read();expect(final.length).toBeGreaterThan(first.length);expect(final.every(row=>row.scopeComplete===true)).toBe(true);
  for(const original of first)expect(final.some(row=>row.claim.scopeId===original.claim.scopeId&&row.claim.claimId===original.claim.claimId)).toBe(true);
  expect((await freshAccounting(root,budget)).records).toBeGreaterThan(0);expect(await fs.readFile(path.join(root,bitmapPath))).toEqual(png);
}, 120000);

// Additional guards for the implemented public seam. First-green protection,
// not a claim of additional RED-before-GREEN implementation cycles.
test.each(['copy','plan','foreign-scope','source-change','control-funding'] as const)('durable reservation rejects %s before control or business effects',async mode=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'resource-binding-root-')),userData=await fs.mkdtemp(path.join(os.tmpdir(),'resource-binding-data-'));
  await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
  const source=path.join(root,'contributor.png'),bytes=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();await fs.writeFile(source,bytes,{mode:0o600});
  const python='python3',budget={bytes:mode==='control-funding'?65536:4*1024*1024,records:1000,assets:16,jsonDepth:80};
  const policy=(await createNativeAuthorizationSession(python,path.resolve('scripts/recovery-content-permissions.py'),()=>65536).request({phase:'capturePolicy',sources:[source],sourceByteLimit:budget.bytes})).sourcePolicy;
  const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python,script:path.resolve('scripts/recovery-origin-permissions.py'),
    claimRecords:()=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py')}),
    claimWriter:(_root,restrictions)=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py'),restrictions:()=>restrictions})});
  let effects=0;
  if(mode==='foreign-scope'){
    const quote=await accounting.run(()=>accounting.quote(root,budget,32768,1,policy));
    await expect(accounting.run(()=>accounting.reserve(root,budget,32768,1,async()=>{effects++;},undefined,quote))).rejects.toThrow(/Original Main producer quote/);
  }else await expect(accounting.run(async()=>{
    const quote=await accounting.quote(root,budget,32768,1,policy);
    if(mode==='source-change')await fs.chmod(source,0o400); // Owned synthetic actor, not product repair.
    return accounting.reserve(root,budget,mode==='plan'?32769:32768,1,async()=>{effects++;},undefined,mode==='copy'?{...quote}:quote);
  })).rejects.toThrow(mode==='source-change'?/observations changed/:mode==='control-funding'?/reservation peak budget/:/Original Main producer quote/);
  expect(effects).toBe(0);expect(await fs.readdir(userData)).toEqual([]);expect(await fs.readFile(source)).toEqual(bytes);
},120000);

test('an exceeded Root cannot prevent a separately settled Root from receiving its complete resource proof',async()=>{
  const userData=await fs.mkdtemp(path.join(os.tmpdir(),'resource-two-roots-data-')),python='python3';
  const budget={bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80};
  const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python,script:path.resolve('scripts/recovery-origin-permissions.py'),
    claimRecords:()=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py')}),
    claimWriter:(_root,restrictions)=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py'),restrictions:()=>restrictions})});
  const roots=[];
  for(let index=0;index<2;index++){
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'resource-independent-root-'));await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
    const source=path.join(root,'source.json');await fs.writeFile(source,'{}',{mode:0o600});
    const policy=(await createNativeAuthorizationSession(python,path.resolve('scripts/recovery-content-permissions.py'),()=>65536).request({phase:'capturePolicy',sources:[source],sourceByteLimit:budget.bytes})).sourcePolicy;
    roots.push({root,policy,file:path.join(root,'.storyboard-workbench/pending-file-transaction.json')});
  }
  await expect(accounting.run(async()=>{
    const a=roots[0],qa=await accounting.quote(a.root,budget,1,1,a.policy);
    await expect(accounting.reserve(a.root,budget,1,1,async()=>{await fs.writeFile(a.file,'{"failed":true}',{mode:0o600});},async error=>{expect(String(error)).toMatch(/exceeded peak/);},qa)).rejects.toThrow(/exceeded peak/);
    const b=roots[1],qb=await accounting.quote(b.root,budget,32768,1,b.policy);
    await accounting.reserve(b.root,budget,32768,1,async()=>{await fs.writeFile(b.file,'{}',{mode:0o600});},undefined,qb);
  })).rejects.toThrow(/unknown or exceeded/);
  const read=async(root:string)=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py')}).read({workspaceKey:await originWorkspaceKey(root),scopeId:'resource-census',claimId:'resource-census',plan:{effectPeak:1,claimPeak:65536,closePeak:65536},allowance:budget});
  const a=await read(roots[0].root),b=await read(roots[1].root);expect(a).toHaveLength(1);expect(a[0].scopeComplete).toBe(false);expect(b).toHaveLength(1);expect(b[0].scopeComplete).toBe(true);
  expect(a[0].closed?.state).toBe('exceeded');
  expect(await fs.readFile(roots[0].file,'utf8')).toBe('{"failed":true}');expect(await fs.readFile(roots[1].file,'utf8')).toBe('{}');
},120000);
