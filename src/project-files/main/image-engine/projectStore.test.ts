import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { temporaryWorkspace } from '../../../../test/temporaryWorkspace';
import type { HydrationRecord, NativeImageRef, ProjectCommitV2, ProjectV2 } from '../../../platform/contracts/imageProject';
import { openImageProjectStore, type ImageProjectStoreOptions } from './projectStore';
import { canonicalJson } from '../persistence/canonicalJson';

const project=():ProjectV2=>({schema:'storyboard-flow.project',version:2,id:'project',revision:0,name:'Synthetic',shots:[{id:'a',imageId:'ia',name:'A',scriptText:''}],parkedShots:[],dialogues:[],images:{ia:{id:'ia',content:{kind:'source',source:{importId:'batch',itemId:'a',interpretationId:'reader1'}}}}});
const authority={assertHeld:async()=>{}}; // Explicit process-local harness authority, not a cross-process lease.
const ref:NativeImageRef={storeId:'native',documentId:'doc',versionId:'a'.repeat(64),manifestSha256:'b'.repeat(64),width:64,height:64};
const genesis=():ProjectCommitV2=>({schema:'flow.project-commit',version:1,commitId:'initial',previousCommitHash:null,beforeRevision:null,after:project()});
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function fixture(extra:Partial<ImageProjectStoreOptions>={}){const root=await temporaryWorkspace('image-project-');return{root,store:await openImageProjectStore({root,writerAuthority:authority,verifySource:async()=>{},verifyNative:async()=>{},...extra})};}
const location=(root:string)=>path.join(root,'.storyboard-flow','image-project-v2');

it('publishes durable genesis/metadata CAS, reopens it, and keeps prior commits',async()=>{
  const {root,store}=await fixture();expect(await store.load()).toBeNull();const first=await store.commit(null,genesis());
  const next:ProjectCommitV2={...genesis(),commitId:'text',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,dialogues:[{id:'line',shotId:'a',text:'hello'}]}};
  const second=await store.commit(first.commitHash,next);expect((await store.committed()).length).toBe(2);
  expect((await store.commit(first.commitHash,next)).commitHash).toBe(second.commitHash);
  await expect(store.commit(first.commitHash,{...next,commitId:'stale'})).rejects.toMatchObject({code:'conflict'});
  await store.close();const opened=await openImageProjectStore({root,writerAuthority:authority,verifySource:async()=>{},verifyNative:async()=>{}});
  expect((await opened.load())?.commit.after.dialogues[0].text).toBe('hello');expect(await opened.unsettled()).toEqual([]);await opened.close();
});

it('does not adopt a complete orphan commit or repair a damaged reachable commit',async()=>{
  const {root,store}=await fixture();const first=await store.commit(null,genesis());await store.close();
  const orphan={...genesis(),commitId:'orphan',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,name:'orphan'}};
  const raw=Buffer.from(canonicalJson(orphan)+'\n');await fs.writeFile(path.join(location(root),'commits',sha(raw)+'.json'),raw);
  const reopened=await openImageProjectStore({root,writerAuthority:authority,verifySource:async()=>{},verifyNative:async()=>{}});expect((await reopened.load())?.commit.after.revision).toBe(0);await reopened.close();
  const record=path.join(location(root),'commits',first.commitHash+'.json');await fs.writeFile(record,'corrupt');
  await expect(openImageProjectStore({root,writerAuthority:authority,verifySource:async()=>{},verifyNative:async()=>{}})).rejects.toMatchObject({code:'conflict'});expect(await fs.readFile(record,'utf8')).toBe('corrupt');
});

it('records native settlement only for the exact reachable project decision',async()=>{
  const {store}=await fixture();const first=await store.commit(null,genesis());
  await store.publishHydration({schema:'flow.image-hydration',version:1,source:{importId:'batch',itemId:'a',interpretationId:'reader1',digest:'c'.repeat(64),byteLength:10},hostBuildDigest:'d'.repeat(64),optionsHash:'e'.repeat(64),native:ref,operationId:'hydrate'});
  const record:ProjectCommitV2={schema:'flow.project-commit',version:1,commitId:'paint',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,images:{ia:{id:'ia',content:{kind:'native',native:ref}}}},nativeDecision:{kind:'image',operationId:'paint',candidateId:'paint',imageId:'ia',expected:project().images.ia.content,baseNative:ref,prepared:ref}};
  await store.beginOperation({schema:'flow.image-edit-intent',version:1,operationId:'paint',sessionId:'session',incarnation:'one',imageId:'ia',expected:project().images.ia.content,baseNative:ref,stroke:{tool:'brush',color:'#ff0000',size:10,opacity:0.5,softness:0,points:[1,1,2,2]}});
  const committed=await store.commit(first.commitHash,record);expect((await store.unsettled()).length).toBe(1);
  await expect(store.settle(committed.commitHash,'wrong',ref)).rejects.toMatchObject({code:'conflict'});
  await store.settle(committed.commitHash,'paint',ref);await store.settle(committed.commitHash,'paint',ref);expect(await store.unsettled()).toEqual([]);await store.close();
});

it('persists hydration without changing project head or claiming native acceptance',async()=>{
  const {root,store}=await fixture();const first=await store.commit(null,genesis());
  const source=(project().images.ia.content as {kind:'source';source:HydrationRecord['source']}).source;
  const record:HydrationRecord={schema:'flow.image-hydration',version:1,source:{...source,digest:'c'.repeat(64),byteLength:10},hostBuildDigest:'d'.repeat(64),optionsHash:'e'.repeat(64),native:ref,operationId:'hydrate'};
  await store.publishHydration(record);expect((await store.load())?.commitHash).toBe(first.commitHash);expect((await store.pendingHydrations()).length).toBe(1);
  await store.close();const opened=await openImageProjectStore({root,writerAuthority:authority,verifySource:async()=>{},verifyNative:async()=>{}});
  expect(await opened.hydration(source)).toEqual(record);await opened.settleHydration(source,'hydrate',ref);expect(await opened.pendingHydrations()).toEqual([]);await opened.close();
});

it('refuses foreign writer, alias, recovery inventory, unsafe paths, and malformed references',async()=>{
  const {root,store}=await fixture();await expect(openImageProjectStore({root,writerAuthority:authority,verifyNative:async()=>{},verifySource:async()=>{}})).rejects.toMatchObject({code:'busy'});await store.close();
  const alias=path.join(root,'alias');await fs.symlink(root,alias);await expect(openImageProjectStore({root:alias,writerAuthority:authority,verifyNative:async()=>{},verifySource:async()=>{}})).rejects.toMatchObject({code:'conflict'});
  await fs.mkdir(path.join(root,'.storyboard-flow','workspace-recovery-v2'));await expect(openImageProjectStore({root,writerAuthority:authority,verifyNative:async()=>{},verifySource:async()=>{}})).rejects.toThrow('protected by a recovery inventory');
});

it('accounts prior retained recovery bytes and reservations before publishing',async()=>{
  const {root,store}=await fixture({maxRecoveryBytes:5000,reservedRecoveryBytes:async()=>4500});
  await expect(store.commit(null,genesis())).rejects.toMatchObject({code:'resource-limit'});expect(await store.load()).toBeNull();expect(await fs.readdir(path.join(location(root),'commits'))).toEqual([]);await store.close();
});

it('waits for injected reference verification and leaves head unchanged when it refuses',async()=>{
  const {store}=await fixture({verifySource:async()=>{throw Error('retained original unavailable');}});
  await expect(store.commit(null,genesis())).rejects.toThrow('retained original unavailable');expect(await store.load()).toBeNull();await store.close();
});

it('retries the head directory sync before acknowledging an idempotent CAS after unknown publication',async()=>{
  const {root,store}=await fixture();const first=await store.commit(null,genesis());
  const next={...genesis(),commitId:'text',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,name:'committed'}};
  const original=fs.open.bind(fs);let attempts=0;
  const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{
    const handle=await original(...args);
    if(args[0]===location(root)&&args[1]==='r'){
      const sync=handle.sync.bind(handle);handle.sync=async()=>{attempts++;if(attempts===1)throw Error('synthetic head directory sync failure');await sync();};
    }
    return handle;
  });
  try{
    await expect(store.commit(first.commitHash,next)).rejects.toMatchObject({effect:'unknown'});
    expect((await store.load())?.commit.after.revision).toBe(1);
    const result=await store.commit(first.commitHash,next);expect(result.commit.after.revision).toBe(1);expect(attempts).toBe(2);expect((await store.committed()).length).toBe(2);
  }finally{spy.mockRestore();await store.close();}
});

it('keeps verified history and recovery inventory off the normal metadata commit path',async()=>{
  let sourceChecks=0;const {store}=await fixture({verifySource:async()=>{sourceChecks++;}});
  let current=await store.commit(null,genesis());expect(sourceChecks).toBe(1);
  const readdir=vi.spyOn(fs,'readdir');
  try{
    for(let n=1;n<=8;n++)current=await store.commit(current.commitHash,{...genesis(),commitId:`edit${n}`,previousCommitHash:current.commitHash,beforeRevision:n-1,after:{...project(),revision:n,name:`name ${n}`}});
    expect(sourceChecks).toBe(1);expect(readdir).not.toHaveBeenCalled();expect((await store.load())?.commit.after.revision).toBe(8);
  }finally{readdir.mockRestore();await store.close();}
});

it('retains original submitted input with a checksum and rejects a forged resolution',async()=>{
  const {root,store}=await fixture();await store.commit(null,genesis());
  const intent={schema:'flow.image-edit-intent' as const,version:1 as const,operationId:'paint',sessionId:'session',incarnation:'one',imageId:'ia',expected:project().images.ia.content,baseNative:ref,stroke:{tool:'brush' as const,color:'#ff0000',size:10,opacity:0.5,softness:0,points:[1,1,2,2]}};
  const recording=store.beginOperation(intent);intent.stroke.points[0]=999;await recording;
  expect((await store.pendingOperations())[0].stroke.points[0]).toBe(1);
  await expect(store.resolveOperation('paint','committed','a'.repeat(64))).rejects.toMatchObject({code:'conflict'});
  const file=path.join(location(root),'settlements','paint.intent.json'),raw=JSON.parse(await fs.readFile(file,'utf8'));raw.intent.stroke.points[0]=77;await fs.writeFile(file,JSON.stringify(raw));
  await expect(store.pendingOperations()).rejects.toThrow('checksum');await store.close();
});
