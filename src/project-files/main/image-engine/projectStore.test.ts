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

it('uses one atomic recovery budget for independent intent and CAS writers without rescanning',async()=>{
  let other=0;const {root,store}=await fixture({maxRecoveryBytes:100_000,reservedRecoveryBytes:async()=>other});
  const g=genesis();g.after.images.ia.content={kind:'native',native:ref};const first=await store.commit(null,g);
  const intent={schema:'flow.image-edit-intent' as const,version:2 as const,operationId:'second',sessionId:'session',incarnation:'one',imageId:'ia',pipelineId:'pipe',anchorCommitHash:first.commitHash,anchor:ref,expectedAtAnchor:g.after.images.ia.content,predecessorOperationId:null,inputThrough:2,stroke:{tool:'brush' as const,color:'#ff0000',size:10,opacity:0.5,softness:0,points:[1,1,2,2]}};
  const record={...g,commitId:'metadata',previousCommitHash:first.commitHash,beforeRevision:0,after:{...g.after,revision:1,name:'n'.repeat(2000)}};
  const data=Buffer.from(canonicalJson(record)+'\n'),headBytes=Buffer.from(canonicalJson({...first.head,commitHash:sha(data)})+'\n');
  const intentRaw=Buffer.from(canonicalJson(intent)+'\n'),intentSize=Buffer.byteLength(canonicalJson({schema:'flow.image-intent-envelope',version:1,sha256:sha(intentRaw),intent})+'\n');
  const used=Buffer.byteLength(canonicalJson(g)+'\n')+Buffer.byteLength(canonicalJson(first.head)+'\n');other=100_000-used-Math.max(data.length+headBytes.length,intentSize)-100;
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),blocked=new Promise<void>(r=>entered=r);const open=fs.open.bind(fs);
  const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const handle=await open(...args);if(args[0]===path.join(location(root),'commits')&&args[1]==='r'){const sync=handle.sync.bind(handle);handle.sync=async()=>{entered();await gate;await sync();};}return handle;});const scan=vi.spyOn(fs,'readdir');
  try{const cas=store.commit(first.commitHash,record);await blocked;await expect(store.beginOperation(intent)).rejects.toMatchObject({code:'resource-limit'});expect(scan).not.toHaveBeenCalled();release();await cas;expect(await store.pendingOperations()).toEqual([]);}finally{release();scan.mockRestore();spy.mockRestore();await store.close();}
});

it('retains unknown intent expenditure until a drained audit and closes both admission queues',async()=>{
  const {root,store}=await fixture();const g=genesis();g.after.images.ia.content={kind:'native',native:ref};const first=await store.commit(null,g);
  const intent={schema:'flow.image-edit-intent' as const,version:2 as const,operationId:'paint',sessionId:'session',incarnation:'one',imageId:'ia',pipelineId:'pipe',anchorCommitHash:first.commitHash,anchor:ref,expectedAtAnchor:g.after.images.ia.content,predecessorOperationId:null,inputThrough:2,stroke:{tool:'brush' as const,color:'#ff0000',size:10,opacity:0.5,softness:0,points:[1,1,2,2]}};
  const open=fs.open.bind(fs);let fail=true;const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const handle=await open(...args);if(args[0]===path.join(location(root),'settlements')&&args[1]==='r'){const sync=handle.sync.bind(handle);handle.sync=async()=>{if(fail){fail=false;throw Error('synthetic intent directory sync failure');}await sync();};}return handle;});
  try{await expect(store.beginOperation(intent)).rejects.toThrow('synthetic');await expect(store.beginOperation({...intent,operationId:'later'})).rejects.toMatchObject({code:'busy',effect:'retained'});expect((await store.pendingOperations())[0].operationId).toBe('paint');await store.validateRecovery();await store.beginOperation({...intent,operationId:'later'});}finally{spy.mockRestore();await store.close();}
  await expect(store.beginOperation(intent)).rejects.toMatchObject({code:'closed'});
});

it('binds no-op and following native decisions to durable input and reachable predecessors without user history',async()=>{
  const {root,store}=await fixture();const g=genesis();g.after.images.ia.content={kind:'native',native:ref};const first=await store.commit(null,g);
  const intent={schema:'flow.image-edit-intent' as const,version:2 as const,operationId:'noop',sessionId:'session',incarnation:'one',imageId:'ia',pipelineId:'pipe',anchorCommitHash:first.commitHash,anchor:ref,expectedAtAnchor:g.after.images.ia.content,predecessorOperationId:null,inputThrough:2,stroke:{tool:'brush' as const,color:'#ff0000',size:10,opacity:0,softness:0,points:[1,1,2,2]}};
  await store.beginOperation(intent);const pipeline={pipelineId:'pipe',anchorCommitHash:first.commitHash,predecessorOperationId:null};
  const decision={kind:'image' as const,operationId:'noop',candidateId:'noop',imageId:'ia',expected:g.after.images.ia.content,baseNative:ref,prepared:ref,pipeline};
  await store.decideUnchanged(first.commitHash,decision);expect((await store.load())?.commit.after.revision).toBe(0);expect(await store.unsettledDecisions()).toEqual([{commitHash:first.commitHash,decision,unchanged:true}]);
  await store.settle(first.commitHash,'noop',ref);await store.resolveOperation('noop','committed',first.commitHash);
  await store.beginOperation({...intent,operationId:'paint',predecessorOperationId:'noop',stroke:{...intent.stroke,opacity:0.5}});
  const next={...ref,versionId:'c'.repeat(64),manifestSha256:'d'.repeat(64)};
  const changed={...decision,operationId:'paint',candidateId:'paint',prepared:next,pipeline:{...pipeline,predecessorOperationId:'noop'}};
  const c=await store.commit(first.commitHash,{...g,commitId:'paint',previousCommitHash:first.commitHash,beforeRevision:0,after:{...g.after,revision:1,images:{ia:{id:'ia',content:{kind:'native',native:next}}}},nativeDecision:changed});
  expect((await store.operationDecision('noop'))?.unchanged).toBe(true);await store.settle(c.commitHash,'paint',next);await store.resolveOperation('paint','committed',c.commitHash);await store.close();
  const reopened=await openImageProjectStore({root,writerAuthority:authority,verifySource:async()=>{},verifyNative:async()=>{}});expect((await reopened.load())?.commit.after.revision).toBe(1);expect(await reopened.pendingOperations()).toEqual([]);expect(await reopened.unsettledDecisions()).toEqual([]);await reopened.close();
});

it('requires settled hydration for a source-backed no-op and preserves that source binding for its successor',async()=>{
  const {root,store}=await fixture();const g=genesis(),first=await store.commit(null,g),source=(g.after.images.ia.content as {kind:'source';source:HydrationRecord['source']}).source;
  const hydration:HydrationRecord={schema:'flow.image-hydration',version:1,source:{...source,digest:'c'.repeat(64),byteLength:10},hostBuildDigest:'d'.repeat(64),optionsHash:'e'.repeat(64),native:ref,operationId:'hydrate'};
  await store.publishHydration(hydration);
  const intent={schema:'flow.image-edit-intent' as const,version:2 as const,operationId:'noop',sessionId:'session',incarnation:'one',imageId:'ia',pipelineId:'pipe',anchorCommitHash:first.commitHash,anchor:ref,expectedAtAnchor:g.after.images.ia.content,predecessorOperationId:null,inputThrough:2,stroke:{tool:'brush' as const,color:'#ff0000',size:10,opacity:0,softness:0,points:[1,1,2,2]}};
  await store.beginOperation(intent);const pipeline={pipelineId:'pipe',anchorCommitHash:first.commitHash,predecessorOperationId:null};
  const d={kind:'image' as const,operationId:'noop',candidateId:'noop',imageId:'ia',expected:g.after.images.ia.content,baseNative:ref,prepared:ref,pipeline};
  await expect(store.decideUnchanged(first.commitHash,d)).rejects.toThrow('settled hydration');expect((await fs.readdir(path.join(location(root),'settlements'))).some(f=>f.endsWith('.unchanged.json'))).toBe(false);
  await store.settleHydration(source,'hydrate',ref);await store.decideUnchanged(first.commitHash,d);await store.settle(first.commitHash,'noop',ref);await store.resolveOperation('noop','committed',first.commitHash);
  await store.beginOperation({...intent,operationId:'paint',predecessorOperationId:'noop',stroke:{...intent.stroke,opacity:0.5}});const next={...ref,versionId:'c'.repeat(64),manifestSha256:'d'.repeat(64)};
  await store.commit(first.commitHash,{...g,commitId:'paint',previousCommitHash:first.commitHash,beforeRevision:0,after:{...g.after,revision:1,images:{ia:{id:'ia',content:{kind:'native',native:next}}}},nativeDecision:{...d,operationId:'paint',candidateId:'paint',prepared:next,pipeline:{...pipeline,predecessorOperationId:'noop'}}});await store.validateRecovery();await store.close();
});

it('enumerates complete immutable input and resolution in bounded pages',async()=>{
 const {store}=await fixture();await store.commit(null,genesis());
 for(const operationId of [...Array.from({length:18},(_,n)=>`op${String(n).padStart(2,'0')}`),'prefix','prefix-child']){await store.beginOperation({schema:'flow.image-edit-intent',version:1,operationId,sessionId:'session',incarnation:'one',imageId:'ia',expected:project().images.ia.content,baseNative:ref,stroke:{tool:'brush',color:'#ff0000',size:10,opacity:0.5,softness:0,points:[1,1,2,2]}});await store.resolveOperation(operationId,'discarded',null);}
 const first=await store.operationRecords();expect(first).toHaveLength(16);expect(first[0].intent.stroke.points).toEqual([1,1,2,2]);expect(first[0].resolution).toMatchObject({decision:'discarded',commitHash:null});
 const second=await store.operationRecords({afterOperationId:first.at(-1)!.intent.operationId});expect(second.map(r=>r.intent.operationId)).toEqual(['op16','op17','prefix','prefix-child']);expect((await store.operationRecords({afterOperationId:'op17',maxRecords:1}))[0].intent.operationId).toBe('prefix');expect((await store.operationRecords({afterOperationId:'prefix',maxRecords:1}))[0].intent.operationId).toBe('prefix-child');expect(await store.operationRecords({afterOperationId:'prefix-child'})).toEqual([]);await expect(store.operationRecords({maxRecords:17})).rejects.toMatchObject({code:'invalid-input'});expect(await store.pendingOperations()).toEqual([]);await store.close();
});

async function confirmations(extra:Partial<ImageProjectStoreOptions>={}){
 const f=await fixture(extra),g=genesis();g.after.images.ia.content={kind:'native',native:ref};const anchor=await f.store.commit(null,g);let head=anchor,base=ref;const records=[];
 for(const [index,operationId]of ['first','second'].entries()){
  const next={...ref,versionId:String(index+1).repeat(64),manifestSha256:String(index+1).repeat(64)},predecessorOperationId=index?'first':null;
  await f.store.beginOperation({schema:'flow.image-edit-intent',version:2,operationId,sessionId:'session',incarnation:'one',imageId:'ia',pipelineId:'pipe',anchorCommitHash:anchor.commitHash,anchor:ref,expectedAtAnchor:g.after.images.ia.content,predecessorOperationId,inputThrough:2,stroke:{tool:'brush',color:'#ff0000',size:10,opacity:0.5,softness:0,points:[1,1,2,2]}});
  head=await f.store.commit(head.commitHash,{schema:'flow.project-commit',version:1,commitId:operationId,previousCommitHash:head.commitHash,beforeRevision:index,after:{...g.after,revision:index+1,images:{ia:{id:'ia',content:{kind:'native',native:next}}}},nativeDecision:{kind:'image',operationId,candidateId:operationId,imageId:'ia',expected:{kind:'native',native:base},baseNative:base,prepared:next,pipeline:{pipelineId:'pipe',anchorCommitHash:anchor.commitHash,predecessorOperationId}}});records.push({operationId,commitHash:head.commitHash,native:next});base=next;
 }
 return{...f,head,records};
}
it('fsyncs every confirmation file and shares one directory sync without blocking a newer project CAS',async()=>{
 const {root,store,head,records}=await confirmations();let release!:()=>void,entered!:()=>void,count=0;const gate=new Promise<void>(r=>release=r),blocked=new Promise<void>(r=>entered=r),open=fs.open.bind(fs);
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(args[0]===path.join(location(root),'settlements')&&args[1]==='r'){const sync=h.sync.bind(h);h.sync=async()=>{count++;entered();await gate;await sync();};}return h;});
 try{
  const confirming=store.confirmOperations(records);await blocked;
  const commit=store.commit(head.commitHash,{schema:'flow.project-commit',version:1,commitId:'metadata',previousCommitHash:head.commitHash,beforeRevision:2,after:{...head.commit.after,revision:3,name:'parallel metadata'}});
  let timeout:ReturnType<typeof setTimeout>|undefined;try{const result=await Promise.race([commit,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('CAS blocked behind confirmation IO')),3000);})]);expect(result.commit.after.revision).toBe(3);}finally{clearTimeout(timeout);}
  release();await confirming;expect(count).toBe(1);expect(await store.pendingOperations()).toEqual([]);expect(await store.unsettledDecisions()).toEqual([]);
 }finally{release();spy.mockRestore();await store.close();}
});
for(const fault of ['partial-link','directory-sync'])it(`preserves a ${fault} confirmation batch and retries immutable evidence after a drained audit`,async()=>{
 const {root,store,records}=await confirmations();const open=fs.open.bind(fs),link=fs.link.bind(fs);let links=0,fail=true;
 const linkSpy=vi.spyOn(fs,'link').mockImplementation(async(...args)=>{if(fault==='partial-link'&&fail&&++links===3){fail=false;throw Error('synthetic partial batch publication');}return link(...args);});
 const openSpy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(args[0]===path.join(location(root),'settlements')&&args[1]==='r'){const sync=h.sync.bind(h);h.sync=async()=>{if(fault==='directory-sync'&&fail){fail=false;throw Error('synthetic confirmation directory sync');}await sync();};}return h;});
 try{
  await expect(store.confirmOperations(records)).rejects.toMatchObject({effect:'unknown'});expect((await store.load())?.commit.after.revision).toBe(2);const evidence=await store.operationRecords();expect(evidence).toHaveLength(2);expect(evidence[0].resolution?.decision).toBe('committed');if(fault==='partial-link')expect(evidence[1].resolution).toBeNull();
  await expect(store.confirmOperations(records)).rejects.toMatchObject({code:'busy'});await store.validateRecovery();await store.confirmOperations(records);expect(await store.pendingOperations()).toEqual([]);expect(await store.unsettledDecisions()).toEqual([]);expect((await store.committed()).length).toBe(3);
 }finally{linkSpy.mockRestore();openSpy.mockRestore();await store.close();}
});

it('flushes a newly created namespace bottom-up before returning its writer',async()=>{
 const root=await temporaryWorkspace('image-project-hierarchy-'),open=fs.open.bind(fs),synced:string[]=[];
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(args[1]==='r'){const sync=h.sync.bind(h);h.sync=async()=>{synced.push(String(args[0]));await sync();};}return h;});
 try{const store=await openImageProjectStore({root,writerAuthority:authority,verifyNative:async()=>{},verifySource:async()=>{}});const at=location(root);expect(synced.slice(-6)).toEqual(['commits','settlements','hydrations'].map(n=>path.join(at,n)).concat([at,path.dirname(at),root]));await store.close();}finally{spy.mockRestore();}
});

it('reserves confirmation and CAS expenditure from the same atomic budget',async()=>{
 let other=0;const {root,store,head,records}=await confirmations({maxRecoveryBytes:100_000,reservedRecoveryBytes:async()=>other}),at=location(root);
 let used=(await fs.stat(path.join(at,'head.json'))).size;for(const dir of ['commits','settlements','hydrations'])for(const leaf of await fs.readdir(path.join(at,dir)))used+=(await fs.stat(path.join(at,dir,leaf))).size;
 const metadata:ProjectCommitV2={schema:'flow.project-commit',version:1,commitId:'metadata',previousCommitHash:head.commitHash,beforeRevision:2,after:{...head.commit.after,revision:3,name:'x'.repeat(2000)}};
 const commitAdd=Buffer.byteLength(canonicalJson(metadata)+'\n')+Buffer.byteLength(canonicalJson(head.head)+'\n'),confirmationAdd=records.reduce((sum,r)=>sum+Buffer.byteLength(canonicalJson({schema:'flow.native-settlement',version:1,commitHash:r.commitHash,operationId:r.operationId,candidateId:r.operationId,native:r.native})+'\n')+Buffer.byteLength(canonicalJson({schema:'flow.image-edit-resolution',version:1,operationId:r.operationId,decision:'committed',commitHash:r.commitHash})+'\n'),0);
 other=100_000-used-Math.max(commitAdd,confirmationAdd)-100;
 let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),blocked=new Promise<void>(r=>entered=r),open=fs.open.bind(fs);
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(args[0]===path.join(at,'settlements')&&args[1]==='r'){const sync=h.sync.bind(h);h.sync=async()=>{entered();await gate;await sync();};}return h;});
 try{const confirmation=store.confirmOperations(records);await blocked;await expect(store.commit(head.commitHash,metadata)).rejects.toMatchObject({code:'resource-limit'});release();await confirmation;expect((await store.load())?.commit.after.revision).toBe(2);}finally{release();spy.mockRestore();await store.close();}
});
