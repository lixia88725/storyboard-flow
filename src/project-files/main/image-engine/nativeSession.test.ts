import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import ts from 'typescript';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../../../test/temporaryWorkspace';

// Actual Main/guard/native processes and real project storage. The only fault
// Adapter pauses after a completed effect; it never supplies fake native pixels.
const modules=[
  'session/core/imageCreation','session/core/nativeSession','session/core/nativeSettlementQueue','session/core/nativePipeline','session/core/snapshotHistory','session/core/grouping','session/core/sourceProtection','session/core/imageProjectModel','session/core/imageProjectValues',
  'platform/contracts/flowPresentation','platform/contracts/imageEngine','platform/contracts/flowSelection','platform/main/imageEngineWorkerOwner','platform/main/imageEngineConnection','platform/main/imageEngineFraming','platform/main/imageProjectLease',
  'project-files/main/image-engine/projectStore','project-files/main/image-engine/legacyProjectStore','project-files/main/image-engine/journalProjectStore','project-files/main/image-engine/recoveryJournal','project-files/main/image-engine/projectStoreRecords','project-files/main/image-engine/workspaceColdCopyContract','project-files/main/image-engine/workspaceOutputContract','project-files/main/image-engine/workspaceRecords','project-files/main/image-engine/sourceStore','project-files/main/image-engine/nativeSessionAdapter','project-files/main/image-engine/nativeProductContext',
  'project-files/main/workspacePhysicalWriterGate','project-files/main/persistence/canonicalJson','project-files/main/persistence/fileOps','project-files/main/persistence/errors'
];
async function fixture(format:'legacy'|'journal'='legacy'){
  const binary=process.env.FLOW_IMAGE_HOST,leaseBinary=process.env.FLOW_PROJECT_LEASE_BIN;
  if(!binary||!leaseBinary)throw Error('Prepare fixed native host/lease and set FLOW_IMAGE_HOST and FLOW_PROJECT_LEASE_BIN; no fake worker fallback');
  const root=await temporaryWorkspace('native-project-'),runtime=path.join(root,'runtime');await fs.mkdir(runtime);
  await fs.writeFile(path.join(runtime,'package.json'),JSON.stringify({type:'module'}));await fs.mkdir(path.join(runtime,'node_modules'));await fs.symlink(path.resolve('node_modules/sharp'),path.join(runtime,'node_modules/sharp'),'dir');
  const src=fileURLToPath(new URL('../../../',import.meta.url));
  // This file lives in src/project-files/main/image-engine, so ../../../ is src.
  for(const name of modules){const code=await fs.readFile(path.join(src,name+'.ts'),'utf8'),out=path.join(runtime,name+'.js');await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
  const png=await sharp({create:{width:64,height:64,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  for(const id of ['a','b'])await fs.writeFile(path.join(root,id+'.png'),png);
  const script=path.join(runtime,'main.mjs');
  await fs.writeFile(script,`
import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {startImageEngine} from './platform/main/imageEngineConnection.js';
import {createImageEngineWorkerOwner} from './platform/main/imageEngineWorkerOwner.js';
import {acquireImageProjectLease} from './platform/main/imageProjectLease.js';
import {createSourceBackedImport,openSourceBackedImport} from './project-files/main/image-engine/sourceStore.js';
import {${format==='legacy'?'openLegacyImageProjectStore as openImageProjectStore':'openImageProjectStore'}} from './project-files/main/image-engine/${format==='legacy'?'legacyProjectStore':'projectStore'}.js';
import {createNativeSessionAdapter} from './project-files/main/image-engine/nativeSessionAdapter.js';
import {openNativeProjectSession} from './session/core/nativeSession.js';
setTimeout(()=>{console.error('Owned Main fixture timed out');process.exit(23);},45000).unref();
const root=${JSON.stringify(root)},binary=${JSON.stringify(binary)},leaseBinary=${JSON.stringify(leaseBinary)},mode=process.argv[2];
const source={importId:'batch',itemId:'a',interpretationId:'reader1'};
const initial={schema:'storyboard-flow.project',version:2,id:'project',revision:0,name:'Synthetic',shots:[{id:'a',imageId:'ia',name:'A',scriptText:''},{id:'b',imageId:'ib',name:'B',scriptText:''}],parkedShots:[],dialogues:[],images:{ia:{id:'ia',content:{kind:'source',source}},ib:{id:'ib',content:{kind:'source',source:{...source,itemId:'b'}}}}};
const stroke={tool:'brush',color:'#ff0000',size:10,opacity:0.5,softness:0,points:[12,20,44,20]};
const lease=await acquireImageProjectLease({root,binary:leaseBinary});
const hasHead=await fs.stat(path.join(root,'.storyboard-flow/image-project-v2/head.json')).then(()=>true,()=>false);
const sources=hasHead?await openSourceBackedImport({root,importId:'batch',limits:{maxStoredBytes:8<<20,maxSourceBytes:8<<20}}):await createSourceBackedImport({root,importId:'batch',limits:{maxStoredBytes:8<<20,maxSourceBytes:8<<20},sources:['a','b'].map(id=>({id,sourcePath:path.join(root,id+'.png'),formatHint:'png'}))});
if(!hasHead)await sources.retain('a');
await fs.mkdir(path.join(root,'.storyboard-flow/image-native'),{recursive:true,mode:0o700});
const workerConfig={binary,store:path.join(root,'.storyboard-flow/image-native/native'),sessionId:'session',incarnation:randomUUID(),budgetBytes:32<<20};const owned=mode.startsWith('owned-'),owner=owned?await createImageEngineWorkerOwner({...workerConfig,lease}):undefined;
const connection=owner?.current().connection??startImageEngine(workerConfig);await connection.ready.catch(e=>{console.error(connection.diagnostics());throw e;});
let failAppend=mode==='append-error',acceptIsBlocked=false,releaseOldAccept;const oldAcceptGate=new Promise(r=>releaseOldAccept=r);const request=connection.request.bind(connection);connection.request=async(...args)=>{if(failAppend&&args[1].kind==='strokeAppend'){failAppend=false;args[1]={...args[1],fromSeq:999};}return request(...args);};
const adapter=createNativeSessionAdapter({...(owner?{workerOwner:owner}:{connection}),storeId:'native',storeRoot:path.join(root,'.storyboard-flow/image-native/native')});
let armJournalTail=false;
if(mode==='journal-kill-tail'){const open=fs.open.bind(fs);fs.open=async(...args)=>{const h=await open(...args);if(String(args[0]).endsWith('/image-project-journal-v1/segment-0.log')&&typeof args[1]==='number'){const write=h.write.bind(h);h.write=async(...a)=>{if(armJournalTail){armJournalTail=false;await write(a[0],a[1],100,a[3]);await pause('journal-tail',{before:session.snapshot()});}return write(...a);};}return h;};}
const store=await openImageProjectStore({root,writerAuthority:lease,maxRecoveryBytes:64<<20,reservedRecoveryBytes:async()=>(32+8)<<20,verifyNative:adapter.verifyNative,verifySource:async(ref,retained)=>{
  if(ref.importId!=='batch'||ref.interpretationId!=='reader1'||!sources.snapshot().items.some(i=>i.id===ref.itemId))throw Error('Unknown source ref');
  if(retained){const object=await sources.object(ref.itemId);if(object.digest!==retained.digest||object.byteLength!==retained.byteLength)throw Error('Source digest mismatch');}
}});
if(!hasHead){
  await store.commit(null,{schema:'flow.project-commit',version:1,commitId:'initial',previousCommitHash:null,beforeRevision:null,after:initial});
  const object=await sources.object('a'),prepared=await adapter.openRetained('hydrate-a',object,'png');
  await store.publishHydration({schema:'flow.image-hydration',version:1,source:{...source,digest:object.digest,byteLength:object.byteLength},hostBuildDigest:createHash('sha256').update(await fs.readFile(binary)).digest('hex'),optionsHash:'0'.repeat(64),native:prepared.native,operationId:'hydrate-a'});
  await adapter.acceptOpened(prepared);await store.settleHydration(source,'hydrate-a',prepared.native);
}
const pause=async(stage,data={})=>{await fs.writeFile(path.join(root,'barrier.json'),JSON.stringify({stage,pid:process.pid,nativePid:connection.pid,guardPid:lease.guardPid,...data}));setInterval(()=>{},1000);await new Promise(()=>{});};
const realDriver=adapter.driver;let failInstall=false,failAudit=false;
const driver={...realDriver,
 install:async(ref)=>{if(failInstall){failInstall=false;throw Object.assign(Error('synthetic version install failure'),{effect:'none'});}return realDriver.install(ref);},
 preparePaint:async(...args)=>{const result=await realDriver.preparePaint(...args);if(mode==='prepared')await pause('prepared',{prepared:result});if(mode==='prepared-error')throw Object.assign(Error('synthetic prepared reply lost before project CAS'),{effect:'unknown'});return result;},
 accept:async(...args)=>{const result=await realDriver.accept(...args);if(mode==='accepted')await pause('accepted',{native:result});if(mode==='lost-ack')throw Object.assign(Error('synthetic reply lost after actual native accept'),{effect:'unknown'});return result;}
};
const actualAudit=store.validateRecovery.bind(store);store.validateRecovery=async()=>{if(failAudit){failAudit=false;throw Error('synthetic store audit failure after native Freeze');}return actualAudit();};
const actualCommit=store.commit.bind(store);store.commit=async(...args)=>{const result=await actualCommit(...args);if(mode==='cas'&&args[1].nativeDecision)await pause('cas',{commitHash:result.commitHash});return result;};
const isPipeline=mode.startsWith('pipeline')||owned;
let mintSequence=0;const session=await openNativeProjectSession({sessionId:'main',incarnation:randomUUID(),store,native:driver,mintId:()=>mode.startsWith('owned-multi')?(['z-first','a-second','m-third'][mintSequence++]??('later'+mintSequence)):randomUUID(),now:()=>performance.now(),...(isPipeline?{pipeline:{maxPendingStrokes:4,maxPendingPoints:65536,maxRetainedPixelBytes:16<<20}}:{})});
const progress=[];session.pipeline?.subscribe(event=>progress.push(event));
const until=async(test)=>{const deadline=performance.now()+15000;while(!test()){if(performance.now()>deadline)throw Error('Pipeline fixture condition timed out: '+JSON.stringify({progress,snapshot:session.snapshot()}));await new Promise(r=>setTimeout(r,2));}};
const submit=(y=20,opacity=0.5)=>{
 const begin=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,opacity,points:[12,y]}});if(begin.kind!=='admitted')throw Error(JSON.stringify(begin));
 const append=session.pipeline.input({kind:'append',operationId:begin.operationId,fromSeq:2,points:[44,y]});if(append.kind!=='admitted')throw Error(JSON.stringify(append));
 const end=session.pipeline.input({kind:'end',operationId:begin.operationId,throughSeq:2});if(end.kind!=='admitted')throw Error(JSON.stringify(end));return begin.operationId;
};
const capture=async()=>{const frame=await adapter.capture(),p=frame.payload;return {hash:createHash('sha256').update(p).digest('hex'),alpha:p[(20*64+24)*4+3],red:p[(20*64+24)*4]};};
const result={};
if(owned){
 const window=mode.slice('owned-'.length);result.mainPid=process.pid;result.oldWorker={pid:owner.current().connection.pid,generation:owner.current().generation};
 let fault=true,failRead=false,restoreConfirmationOpen;
 if(window==='confirmation-unknown'){const open=fs.open.bind(fs),at=path.join(root,'.storyboard-flow/image-project-v2/settlements');restoreConfirmationOpen=()=>fs.open=open;fs.open=async(...args)=>{const h=await open(...args);if(args[0]===at&&args[1]==='r'){const sync=h.sync.bind(h);h.sync=async()=>{const hasResolution=(await fs.readdir(at)).some(n=>n.endsWith('.resolution.json'));if(fault&&hasResolution){fault=false;throw Error('Actual confirmation directory sync outcome unknown');}return sync();};}return h;};}
 if(window==='prepared'){const poll=driver.pipeline.poll.bind(driver.pipeline);driver.pipeline.poll=async()=>{const r=await poll();if(fault&&r.events.some(e=>e.kind==='prepared')){fault=false;throw Object.assign(Error('prepared reply lost'),{effect:'unknown'});}return r;};}
 if(window==='cas'){const commit=store.commit.bind(store),committed=store.committed.bind(store);store.commit=async(...args)=>{const r=await commit(...args);if(fault&&args[1].nativeDecision){fault=false;failRead=true;throw Object.assign(Error('CAS acknowledgement unknown'),{effect:'unknown'});}return r;};store.committed=async()=>{if(failRead){failRead=false;throw Object.assign(Error('CAS readback unavailable'),{effect:'unknown'});}return committed();};}
 if(window==='accept'||window==='noop-accept'){const accept=driver.pipeline.accept.bind(driver.pipeline);driver.pipeline.accept=async(...args)=>{const r=await accept(...args);if(fault){fault=false;throw Object.assign(Error('acceptQueued reply lost'),{effect:'unknown'});}return r;};if(window==='noop-accept')fault=false;}
 if(window==='no-ready'){const start=driver.pipeline.start.bind(driver.pipeline);driver.pipeline.start=async(...args)=>{const r=await start(...args);if(fault){fault=false;throw Object.assign(Error('pipelineReady reply lost before any begin'),{effect:'unknown'});}return r;};}
 if(window==='noop-accept'){const warm=submit(20,0);await session.pipeline.waitOperation(warm);fault=true;}
 if(window.startsWith('multi')){
  const accept=driver.pipeline.accept.bind(driver.pipeline),generation=owner.current().generation;driver.pipeline.accept=async(...args)=>{if(args[0].candidateId==='z-first'){acceptIsBlocked=true;await oldAcceptGate;if(owner.current()?.generation!==generation)throw Object.assign(Error('Old paused accept submission fenced'),{effect:'unknown'});}return accept(...args);};
  let decided=0;const commit=store.commit.bind(store),unchanged=store.decideUnchanged.bind(store);store.commit=async(...args)=>{if(window==='multi-suffix'&&args[1].commitId==='m-third')throw Object.assign(Error('Uncommitted prepared suffix retained'),{effect:'unknown'});const r=await commit(...args);if(args[1].nativeDecision)decided++;return r;};store.decideUnchanged=async(...args)=>{const r=await unchanged(...args);decided++;return r;};
  const a=submit(20,window==='multi-noop'?0:0.5),b=submit(window==='multi-noop'?20:32,window==='multi-noop'?0:0.5),ops=[a,b];if(window==='multi-suffix')ops.push(submit(44));await until(()=>decided===2&&acceptIsBlocked&&(window!=='multi-suffix'||session.snapshot().phase==='recovering'));
  result.beforeReplacement=session.snapshot();connection.terminateOwnedProcess();await connection.exited;result.initial=await Promise.all(ops.map(op=>session.pipeline.waitOperation(op)));const recovering=session.request({kind:'recover'});await until(()=>owner.current()?.generation===2);
  if(window==='multi-contradiction'){const a=await driver.status('z-first'),b=await driver.status('a-second');await driver.recoverAccept('a-second',a.prepared.native,b.prepared.native);}
  releaseOldAccept();result.recover=await recovering;console.log('multi-recovery-proof '+JSON.stringify(result.recover));result.operationIds=ops;
  if(window==='multi-contradiction'){result.afterRecover=session.snapshot();result.parent=await driver.status('z-first');result.child=await driver.status('a-second');result.records=await session.operationRecords();await pause(mode,{result,newNativePid:owner.current().connection.pid});}
 }else if(window==='start-read-race'){
  const base=(await store.hydration(source)).native,versionFile=path.join(root,'.storyboard-flow/image-native/native/versions',base.versionId+'.json');
  let releaseRead,readBlocked=false,armed=true;const readGate=new Promise(r=>releaseRead=r),open=fs.open.bind(fs);
  fs.open=async(...args)=>{const h=await open(...args);if(armed&&args[0]===versionFile){armed=false;const read=h.read.bind(h);h.read=async(...r)=>{if(!readBlocked){readBlocked=true;await readGate;}return read(...r);};}return h;};
  const oldStart=driver.pipeline.start(base,{maxPendingStrokes:4,maxPendingPoints:65536,maxRetainedPixelBytes:16<<20}).then(value=>({kind:'resolved',value}),e=>({kind:'rejected',code:e.code,message:e.message}));await until(()=>readBlocked);
  let releaseAudit,auditBlocked=false;const auditGate=new Promise(r=>releaseAudit=r),audit=store.validateRecovery.bind(store);store.validateRecovery=async()=>{if(!auditBlocked){auditBlocked=true;await auditGate;}return audit();};
  connection.terminateOwnedProcess();await connection.exited;const recovering=session.request({kind:'recover'});await until(()=>owner.current()?.generation===2&&auditBlocked);
  const fresh=owner.current().connection,request=fresh.request.bind(fresh),calls=[];fresh.request=async(...args)=>{calls.push(args[1].kind);return request(...args);};
  releaseRead();result.oldStart=await oldStart;result.oldGenerationCalls=[...calls];console.log('generation-read-proof '+JSON.stringify({oldStart:result.oldStart,calls}));fs.open=open;releaseAudit();result.recover=await recovering;store.validateRecovery=audit;
 }else if(window==='inflight-intent'){
  let release,blocked=false,armed=true;const gate=new Promise(r=>release=r),open=fs.open.bind(fs),at=path.join(root,'.storyboard-flow/image-project-v2/settlements');
  fs.open=async(...args)=>{const h=await open(...args);if(armed&&args[0]===at&&args[1]==='r'){const sync=h.sync.bind(h);h.sync=async()=>{if(armed){armed=false;blocked=true;await gate;}return sync();};}return h;};
  const a=submit();await until(()=>blocked);const b=submit(32);connection.terminateOwnedProcess();await connection.exited;
  result.initial=await Promise.all([a,b].map(op=>session.pipeline.waitOperation(op)));let recovered=false;const recovering=session.request({kind:'recover'}).then(r=>{recovered=true;return r;});await until(()=>owner.current()?.generation===2);
  result.beforeRelease={recovered,phase:session.snapshot().phase,admission:session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[12,44]}})};release();result.recover=await recovering;fs.open=open;
 }else if(window==='active'){
  const begin=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[12,20]}});await until(()=>progress.some(e=>e.stage==='preview'));connection.terminateOwnedProcess();await connection.exited;result.operationId=begin.operationId;result.recover=await session.request({kind:'recover'});
 }else{
  const op=submit(20,window==='noop-accept'?0:0.5);result.operationId=op;result.initial=await session.pipeline.waitOperation(op);restoreConfirmationOpen?.();
  if(window==='undo-install'){failInstall=true;result.undo=await session.request({kind:'undo'});}
  if(window==='freeze-audit'){failAudit=true;result.firstFreeze=await session.request({kind:'freeze'});}
  result.whilePending=session.snapshot();result.recover=await session.request({kind:'recover'});
 }
 result.newWorker={pid:owner.current()?.connection.pid,generation:owner.current()?.generation};result.afterRecover=session.snapshot();result.retained=session.pipeline.recoveryInputs();result.records=await session.operationRecords();result.recoveredCapture=await capture();
 if(window==='no-ready'||window==='active'){result.blocked=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[12,44]}});await pause(mode,{result,newNativePid:owner.current().connection.pid});}
 if(window!=='freeze-audit'){const next=submit(20);result.next=await session.pipeline.waitOperation(next);result.nextCapture=await capture();}
 result.progress=progress;
}else if(mode==='pipeline-confirmation-credit'){
 let release;const gate=new Promise(r=>release=r),confirm=store.confirmOperations.bind(store),batches=[];let blocked=false;store.confirmOperations=async records=>{batches.push(records.map(r=>r.operationId));if(!blocked){blocked=true;await gate;}return confirm(records);};
 const ops=[20,32,44,56].map(y=>submit(y));let settled=0;const waiting=ops.map(op=>session.pipeline.waitOperation(op).then(r=>{settled++;return r;}));await until(()=>progress.filter(e=>e.stage==='nativeAccepted').length===4);
 result.beforeConfirmation={settled,project:session.snapshot().project,admission:session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[12,8]}})};release();result.outcomes=await Promise.all(waiting);result.batches=batches;
 const next=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[12,8]}});result.nextAdmission=next;session.pipeline.input({kind:'cancel',operationId:next.operationId});await session.pipeline.waitOperation(next.operationId);
}else if(mode==='pipeline-split-accept'){
 let held=true,target,delayed=[],commits=0,secondAccept=0;const poll=driver.pipeline.poll.bind(driver.pipeline),accept=driver.pipeline.accept.bind(driver.pipeline),commit=store.commit.bind(store);
 driver.pipeline.poll=async()=>{const state=await poll(),events=[];for(const event of state.events){if(held&&event.operationId===target&&event.kind==='accepted')delayed.push(event);else events.push(event);}if(!held&&delayed.length)events.unshift(...delayed.splice(0));return{...state,events};};
 driver.pipeline.accept=async(...args)=>{if(args[0].candidateId!==target)secondAccept++;return accept(...args);};store.commit=async(...args)=>{const result=await commit(...args);if(args[1].nativeDecision)commits++;return result;};
 target=submit();const second=submit(32);let firstSettled=false,secondSettled=false;const firstWait=session.pipeline.waitOperation(target).then(r=>{firstSettled=true;return r;}),secondWait=session.pipeline.waitOperation(second).then(r=>{secondSettled=true;return r;});
 const deadline=performance.now()+3000;while(commits<2){if(performance.now()>deadline)throw Error('Second project CAS waited for prior native accept/confirmation');await new Promise(r=>setTimeout(r,2));}
 result.beforeAccepted={commits,secondAccept,firstSettled,secondSettled,project:session.snapshot().project};held=false;result.outcomes=await Promise.all([firstWait,secondWait]);result.records=await session.operationRecords();result.progress=progress;
}else if(mode==='pipeline-undo-race'){
 let release;const gate=new Promise(r=>release=r);let blocked=false,armed=true;const open=fs.open.bind(fs),commitsDir=path.join(root,'.storyboard-flow/image-project-v2/commits');
 fs.open=async(...args)=>{const handle=await open(...args);if(armed&&args[0]===commitsDir&&args[1]==='r'){const sync=handle.sync.bind(handle);handle.sync=async()=>{if(armed){armed=false;blocked=true;await gate;}return sync();};}return handle;};
 const first=submit();await until(()=>blocked);
 const begin=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[12,32]}});if(begin.kind!=='admitted')throw Error(JSON.stringify(begin));
 session.pipeline.input({kind:'append',operationId:begin.operationId,fromSeq:2,points:[44,32]});
 const undo=session.request({kind:'undo'});result.up=session.pipeline.input({kind:'end',operationId:begin.operationId,throughSeq:2});release();
 let timer;try{result.busyUndo=await Promise.race([undo,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Undo barrier waited for a decision enqueued behind itself')),3000);})]);}finally{clearTimeout(timer);}
 result.paints=await Promise.all([first,begin.operationId].map(op=>session.pipeline.waitOperation(op)));fs.open=open;
 result.beforeThird=session.snapshot();const third=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[12,44]}});result.third=third;
 if(third.kind==='admitted'){result.cancel=session.pipeline.input({kind:'cancel',operationId:third.operationId});await session.pipeline.waitOperation(third.operationId);}
 result.retryUndo=await session.request({kind:'undo'});result.afterRetry=session.snapshot();
}else if(mode==='pipeline-cas-delay'||mode==='pipeline-intent-delay'){
 const blockedDir=path.join(root,'.storyboard-flow/image-project-v2',mode==='pipeline-cas-delay'?'commits':'settlements');
 let release;const gate=new Promise(r=>release=r);let blocked=false,armed=true;const open=fs.open.bind(fs);
 fs.open=async(...args)=>{const handle=await open(...args);if(armed&&args[0]===blockedDir&&args[1]==='r'){const sync=handle.sync.bind(handle);handle.sync=async()=>{if(armed){armed=false;blocked=true;await gate;}return sync();};}return handle;};
 const first=submit();const metadata=session.request({kind:'board',edit:{kind:'setScriptText',shotId:'a',text:'between end1 and end2'}});await until(()=>blocked);
 const second=submit(32),third=submit(44),fourth=submit(56);result.fifth=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[12,8]}});result.duplicateEnd=session.pipeline.input({kind:'end',operationId:fourth,throughSeq:2});
 if(mode==='pipeline-cas-delay')await until(()=>progress.some(e=>e.operationId===second&&e.stage==='queued'));
 else await new Promise(r=>setTimeout(r,30));
 result.beforeRelease={progress:structuredClone(progress),snapshot:session.snapshot()};release();
 result.outcomes=await Promise.all([first,second,third,fourth].map(op=>session.pipeline.waitOperation(op)));result.metadata=await metadata;fs.open=open;
 result.commits=(await store.committed()).map(c=>({operationId:c.commit.commitId,revision:c.commit.after.revision,text:c.commit.after.shots[0].scriptText,native:Boolean(c.commit.nativeDecision)}));
 result.afterPaint=session.snapshot();result.painted=await capture();result.undo=[];for(let i=0;i<5;i++)result.undo.push(await session.request({kind:'undo'}));result.undone=await capture();result.redo=[];for(let i=0;i<5;i++)result.redo.push(await session.request({kind:'redo'}));result.redone=await capture();result.progress=progress;
}else if(mode==='pipeline-barrier'){
 const begin=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[12,20]}});result.begin=begin;
 result.undoActive=await session.request({kind:'undo'});result.beginSealed=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[20,20]}});
 result.end=session.pipeline.input({kind:'end',operationId:begin.operationId,throughSeq:1});result.paint=await session.pipeline.waitOperation(begin.operationId);
 let releaseStop,stopping=false;const stopGate=new Promise(r=>releaseStop=r),stop=driver.pipeline.stop.bind(driver.pipeline);driver.pipeline.stop=async()=>{stopping=true;await stopGate;return stop();};
 const invalidMetadata=session.request({kind:'board',edit:{kind:'setScriptText',shotId:'missing',text:'refused'}}),undo=session.request({kind:'undo'});await until(()=>stopping);
 result.metadataRefused=await invalidMetadata;result.barrierStillSealed=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[24,20]}});releaseStop();result.undo=await undo;driver.pipeline.stop=stop;result.undone=await capture();
 const next=session.pipeline.input({kind:'begin',shotId:'a',stroke:{...stroke,points:[24,20]}});result.next=next;result.cancel=session.pipeline.input({kind:'cancel',operationId:next.operationId});await session.pipeline.waitOperation(next.operationId);
}else if(mode==='pipeline-noop'){
 const warm=submit(20,0);result.warm=await session.pipeline.waitOperation(warm);result.beforeNoop=session.snapshot();const op=submit(20,0);result.noop=await session.pipeline.waitOperation(op);result.afterNoop=session.snapshot();
 result.metadata=await session.request({kind:'board',edit:{kind:'setScriptText',shotId:'a',text:'after no-op'}});const second=submit(20);result.paint=await session.pipeline.waitOperation(second);result.capture=await capture();result.progress=progress;result.decisions=await store.unsettledDecisions();
}else if(mode.startsWith('pipeline-crash-')){
 const window=mode.slice('pipeline-crash-'.length),noop=window.startsWith('noop');
 if(noop){const warm=submit(20,0);await session.pipeline.waitOperation(warm);}
 const actualDecision=store.decideUnchanged.bind(store);store.decideUnchanged=async(...args)=>{if(window==='noop-before')throw Object.assign(Error('synthetic unchanged decision refusal before publication'),{effect:'none'});const r=await actualDecision(...args);if(window==='noop-after')await pause(window,{operationId:args[1].operationId});return r;};
 const actualPaintCommit=store.commit.bind(store);store.commit=async(...args)=>{const r=await actualPaintCommit(...args);if(window==='cas'&&args[1].nativeDecision)await pause(window,{operationId:args[1].commitId});return r;};
 const nativePoll=driver.pipeline.poll.bind(driver.pipeline);driver.pipeline.poll=async()=>{const r=await nativePoll();if(window==='prepared'&&r.events.some(e=>e.kind==='prepared'))await pause(window,{operationId:r.events.find(e=>e.kind==='prepared').operationId});return r;};
 const nativeAccept=driver.pipeline.accept.bind(driver.pipeline);driver.pipeline.accept=async(...args)=>{const r=await nativeAccept(...args);if(window==='accepted'||window==='noop-accepted')await pause(window,{operationId:args[0].candidateId});return r;};
 const operation=submit(20,noop?0:0.5);result.paint=await session.pipeline.waitOperation(operation);if(window==='noop-before')await pause(window,{operationId:operation,outcome:result.paint});
}else if(mode==='journal-kill-tail'){
 result.paint=await session.request({kind:'paint',shotId:'a',stroke});result.dialogue=await session.request({kind:'board',edit:{kind:'setScriptText',shotId:'a',text:'confirmed prefix'}});armJournalTail=true;await session.request({kind:'board',edit:{kind:'setScriptText',shotId:'a',text:'unconfirmed partial tail'}});
}else if(mode==='normal'){
 result.before=await capture();result.paint=await session.request({kind:'paint',shotId:'a',stroke});result.painted=await capture();
 result.dialogue=await session.request({kind:'board',edit:{kind:'setDialogues',shotId:'a',dialogues:[{id:'line',shotId:'a',text:'hello'}]}});
 result.move=await session.request({kind:'board',edit:{kind:'moveShots',shotIds:['a'],destination:'pending'}});
 result.undo=[];for(let i=0;i<3;i++)result.undo.push(await session.request({kind:'undo'}));result.undone=await capture();
 result.redo=[];for(let i=0;i<3;i++)result.redo.push(await session.request({kind:'redo'}));result.redone=await capture();
}else if(mode==='append-error'){
 result.before=await capture();result.first=await session.request({kind:'paint',shotId:'a',stroke});result.afterFailure=session.snapshot();result.cancelled=await capture();result.second=await session.request({kind:'paint',shotId:'a',stroke});result.painted=await capture();
}else if(mode==='install-error'){
 result.paint=await session.request({kind:'paint',shotId:'a',stroke});failInstall=true;result.undo=await session.request({kind:'undo'});result.whilePending=session.snapshot();result.blocked=await session.request({kind:'board',edit:{kind:'setScriptText',shotId:'a',text:'must not commit'}});result.recover=await session.request({kind:'recover'});result.capture=await capture();
}else if(mode==='freeze-error'){
 result.paint=await session.request({kind:'paint',shotId:'a',stroke});failAudit=true;result.firstFreeze=await session.request({kind:'freeze'});result.whilePending=session.snapshot();result.blocked=await session.request({kind:'paint',shotId:'a',stroke});result.recover=await session.request({kind:'recover'});result.afterRecover=session.snapshot();result.stillBlocked=await session.request({kind:'paint',shotId:'a',stroke});
}else if(mode==='inspect'){
 result.capture=await capture();result.pendingOperations=await store.pendingOperations();result.unsettled=await store.unsettled();result.operationRecords=await store.operationRecords();
}else{
 const input=mode==='unsupported'?{...stroke,brush:{tip:'pencil',spacing:0.035,hardness:0.5,grain:0.55,seed:19,pressureSize:0.45,pressureOpacity:0.6}}:stroke;
 result.paint=await session.request({kind:'paint',shotId:'a',stroke:input});
 if(mode==='unsupported'){result.capture=await capture();result.pendingOperations=await store.pendingOperations();}
 if(mode==='lost-ack'||mode==='prepared-error'){result.closeRejected=await session.close().then(()=>false,()=>true);result.freezeWhilePending=await session.request({kind:'freeze'});result.pendingBeforeRecover=await store.pendingOperations();result.whilePending=session.snapshot();result.blocked=await session.request({kind:'board',edit:{kind:'setScriptText',shotId:'a',text:'must not commit'}});result.recover=await session.request({kind:'recover'});result.capture=await capture();}
}
result.snapshot=session.snapshot();result.freeze=await session.request({kind:'freeze'});await session.close();await sources.close();await lease.release();
await fs.writeFile(path.join(root,'result-'+mode+'.json'),JSON.stringify(result));
`);
  return{root,script};
}
function child(script:string,mode:string){
  const processChild=spawn(process.execPath,[script,mode],{stdio:['ignore','pipe','pipe']});let output='';processChild.stdout.on('data',b=>{output+=b;});processChild.stderr.on('data',b=>{output+=b;});
  const done=new Promise<{code:number|null;output:string}>((resolve,reject)=>{processChild.once('error',reject);processChild.once('close',code=>resolve({code,output}));});return{process:processChild,done};
}
async function run(script:string,mode:string){const c=child(script,mode),result=await c.done;if(result.code!==0)throw Error(`Main fixture failed (${mode}): ${result.output}`);}
async function result(root:string,mode:string){return JSON.parse(await fs.readFile(path.join(root,'result-'+mode+'.json'),'utf8'));}

it('uses one real Main mixed history across native paint/dialogue/Pending and clean reopen',async()=>{
  const f=await fixture();await run(f.script,'normal');const r=await result(f.root,'normal');
  expect(r.paint.kind).toBe('settled');expect(r.dialogue.kind).toBe('settled');expect(r.move.kind).toBe('settled');
  expect(r.snapshot.project.revision).toBe(9);expect(r.snapshot.project.parkedShots[0].id).toBe('a');expect(r.snapshot.undoDepth).toBe(3);
  expect(r.before.alpha).toBe(0);expect(r.painted.alpha).toBeGreaterThanOrEqual(127);expect(r.painted.alpha).toBeLessThanOrEqual(128);expect(r.undone.hash).toBe(r.before.hash);expect(r.redone.hash).toBe(r.painted.hash);
  expect(r.undo[0].snapshot.project.parkedShots).toEqual([]);expect(r.undo[1].snapshot.project.dialogues).toEqual([]);expect(r.undo[2].snapshot.project.images.ia.content.kind).toBe('source');
  expect(r.freeze.kind).toBe('settled');await fs.unlink(path.join(f.root,'a.png'));await run(f.script,'inspect');const opened=await result(f.root,'inspect');
  expect(opened.snapshot.project).toEqual(r.snapshot.project);expect(opened.snapshot.undoDepth).toBe(0);expect(opened.capture.hash).toBe(r.painted.hash);expect(opened.pendingOperations).toEqual([]);expect(opened.unsettled).toEqual([]);
},60000);

for(const window of ['prepared','cas','accepted'])it(`reconciles real SIGKILL of Main after ${window} without repeating a stroke`,async()=>{
  const f=await fixture(),c=child(f.script,window);let barrier:any;
  try{
    for(let n=0;n<1000;n++){barrier=await fs.readFile(path.join(f.root,'barrier.json'),'utf8').then(s=>JSON.parse(s),()=>null);if(barrier)break;if(c.process.exitCode!==null)throw Error((await c.done).output);await new Promise(resolve=>setTimeout(resolve,10));}
    expect(barrier?.stage).toBe(window);if(window==='noop-before')expect(barrier.outcome.kind).toBe('recoveryPending');c.process.kill('SIGKILL');await c.done;
    // Only wait for this fixture's known children; do not kill a PID by name.
    for(let n=0;n<500;n++){const alive=[barrier.nativePid,barrier.guardPid].some(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});if(!alive)break;await new Promise(resolve=>setTimeout(resolve,10));}
    await run(f.script,'inspect');const r=await result(f.root,'inspect');
    expect(r.snapshot.project.revision).toBe(window==='prepared'?0:1);expect(r.capture.alpha).toBe(window==='prepared'?0:128);expect(r.snapshot.undoDepth).toBe(0);expect(r.pendingOperations).toEqual([]);expect(r.unsettled).toEqual([]);
    const versions=await fs.readdir(path.join(f.root,'.storyboard-flow/image-native/native/versions'));expect(versions).toHaveLength(2);
    const entries=await fs.readdir(path.join(f.root,'.storyboard-flow/image-project-v2/settlements'));
    const resolution=JSON.parse(await fs.readFile(path.join(f.root,'.storyboard-flow/image-project-v2/settlements',entries.find(e=>e.endsWith('.resolution.json'))!),'utf8'));
    expect(resolution.decision).toBe(window==='prepared'?'discarded':'committed');
  }finally{if(c.process.exitCode===null&&c.process.signalCode===null){c.process.kill('SIGKILL');await c.done;}}
},60000);

it('returns settlementPending after an actual accepted reply is lost and blocks further edits until reconciliation',async()=>{
  const f=await fixture();await run(f.script,'lost-ack');const r=await result(f.root,'lost-ack');
  expect(r.paint.kind).toBe('settlementPending');expect(r.closeRejected).toBe(true);expect(r.freezeWhilePending.kind).toBe('rejected');expect(r.pendingBeforeRecover).toHaveLength(1);expect(r.whilePending.phase).toBe('recovering');expect(r.whilePending.project.revision).toBe(1);expect(r.blocked.kind).toBe('rejected');expect(r.recover.kind).toBe('recovered');expect(r.recover.operations).toContainEqual(expect.objectContaining({decision:'committed',original:'durable-intent'}));expect(r.capture.alpha).toBe(128);expect(r.snapshot.undoDepth).toBe(1);
},60000);

it('explicitly refuses unmigrated pencil dynamics and retains their exact submitted input',async()=>{
  const f=await fixture();await run(f.script,'unsupported');const r=await result(f.root,'unsupported');expect(r.paint).toMatchObject({kind:'rejected',error:{code:'unsupported-brush',effect:'retained'}});expect(r.snapshot.project.revision).toBe(0);expect(r.snapshot.undoDepth).toBe(0);expect(r.capture.alpha).toBe(0);expect(r.pendingOperations).toEqual([]);
  const dir=path.join(f.root,'.storyboard-flow/image-project-v2/settlements'),leaf=(await fs.readdir(dir)).find(n=>n.endsWith('.intent.json'))!;const envelope=JSON.parse(await fs.readFile(path.join(dir,leaf),'utf8'));expect(envelope.intent.stroke.brush).toMatchObject({tip:'pencil',grain:0.55,pressureSize:0.45,pressureOpacity:0.6});
},60000);

it('keeps a pre-CAS unknown prepared operation and complete input until explicit discard recovery',async()=>{
  const f=await fixture();await run(f.script,'prepared-error');const r=await result(f.root,'prepared-error');expect(r.paint.kind).toBe('recoveryPending');expect(r.closeRejected).toBe(true);expect(r.freezeWhilePending.kind).toBe('rejected');expect(r.pendingBeforeRecover).toHaveLength(1);expect(r.pendingBeforeRecover[0].stroke.points).toEqual([12,20,44,20]);expect(r.recover.kind).toBe('recovered');expect(r.recover.operations).toContainEqual(expect.objectContaining({decision:'notCommitted',original:'durable-intent'}));expect(r.snapshot.project.revision).toBe(0);expect(r.snapshot.undoDepth).toBe(0);expect(r.capture.alpha).toBe(0);
},60000);

it('retains a committed Undo target when native install fails and blocks edits until exact recovery',async()=>{
  const f=await fixture();await run(f.script,'install-error');const r=await result(f.root,'install-error');expect(r.undo.kind).toBe('settlementPending');expect(r.whilePending.phase).toBe('recovering');expect(r.whilePending.project.revision).toBe(2);expect(r.whilePending.project.images.ia.content.kind).toBe('source');expect(r.whilePending.recovery.target).toBeDefined();expect(r.blocked.kind).toBe('rejected');expect(r.recover.kind).toBe('settled');expect(r.snapshot.project.revision).toBe(2);expect(r.snapshot.redoDepth).toBe(1);expect(r.capture.alpha).toBe(0);
},60000);

it('never marks a natively frozen host active after the project audit failed',async()=>{
  const f=await fixture();await run(f.script,'freeze-error');const r=await result(f.root,'freeze-error');expect(r.firstFreeze.kind).toBe('rejected');expect(r.whilePending.phase).toBe('recovering');expect(r.blocked.kind).toBe('rejected');expect(r.recover.kind).toBe('settled');expect(r.afterRecover.phase).toBe('frozen');expect(r.stillBlocked.kind).toBe('rejected');expect(r.snapshot.project.revision).toBe(1);
},60000);

it('cancels a live native preview after a real Append refusal before discarding its input intent',async()=>{
  const f=await fixture();await run(f.script,'append-error');const r=await result(f.root,'append-error');expect(r.first.kind).toBe('rejected');expect(r.afterFailure.phase).toBe('active');expect(r.afterFailure.project.revision).toBe(0);expect(r.cancelled.hash).toBe(r.before.hash);expect(r.second.kind).toBe('settled');expect(r.snapshot.project.revision).toBe(1);expect(r.painted.alpha).toBe(128);expect(r.freeze.kind).toBe('settled');
  const dir=path.join(f.root,'.storyboard-flow/image-project-v2/settlements'),files=(await fs.readdir(dir)).filter(n=>n.endsWith('.intent.json'));expect(files).toHaveLength(2);for(const file of files){const envelope=JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));expect(envelope.intent.stroke.points).toEqual([12,20,44,20]);}
},60000);


for(const mode of ['pipeline-cas-delay','pipeline-intent-delay'])it(`keeps bounded Main pipeline input independent of ${mode} and preserves one mixed FIFO history`,async()=>{
  const f=await fixture();await run(f.script,mode);const r=await result(f.root,mode);
  expect(r.fifth).toMatchObject({kind:'rejected',error:{code:'backpressure',effect:'none'}});expect(r.duplicateEnd.kind).toBe('rejected');
  expect(r.beforeRelease.snapshot.project.revision).toBe(0);expect(r.outcomes.map((o:any)=>o.kind)).toEqual(['settled','settled','settled','settled']);
  const first=r.progress[0].operationId,other=r.progress.find((e:any)=>e.operationId!==first).operationId;
  if(mode==='pipeline-cas-delay')expect(r.beforeRelease.progress.some((e:any)=>e.operationId===other&&e.stage==='queued')).toBe(true);
  else{expect(r.beforeRelease.progress.filter((e:any)=>e.stage==='admitted').map((e:any)=>e.operationId)).toContain(other);expect(r.beforeRelease.progress.some((e:any)=>e.operationId===other&&e.stage==='preview')).toBe(false);}
  expect(r.commits.map((c:any)=>c.native)).toEqual([false,true,false,true,true,true]);expect(r.commits.map((c:any)=>c.text)).toEqual(['','','between end1 and end2','between end1 and end2','between end1 and end2','between end1 and end2']);
  expect(r.afterPaint.project.revision).toBe(5);expect(r.afterPaint.undoDepth).toBe(5);expect(r.undo.every((o:any)=>o.kind==='settled')).toBe(true);expect(r.undone.alpha).toBe(0);expect(r.redone.hash).toBe(r.painted.hash);expect(r.freeze.kind).toBe('settled');
},60000);

it('settles a real native pipeline no-op without revision or Undo, then metadata and the next stroke continue',async()=>{
  const f=await fixture();await run(f.script,'pipeline-noop');const r=await result(f.root,'pipeline-noop');expect(r.noop.kind).toBe('settled');expect(r.beforeNoop.project.revision).toBe(1);expect(r.afterNoop.project).toEqual(r.beforeNoop.project);expect(r.afterNoop.undoDepth).toBe(r.beforeNoop.undoDepth);expect(r.metadata.kind).toBe('settled');expect(r.paint.kind).toBe('settled');expect(r.snapshot.project.revision).toBe(3);expect(r.snapshot.undoDepth).toBe(3);expect(r.capture.alpha).toBe(128);expect(r.decisions).toEqual([]);await run(f.script,'inspect');const reopened=await result(f.root,'inspect');expect(reopened.snapshot.project.revision).toBe(3);expect(reopened.capture.alpha).toBe(128);
},60000);

for(const window of ['prepared','cas','accepted','noop-before','noop-after','noop-accepted'])it(`recovers real Main pipeline SIGKILL after ${window} using its original intent/decision`,async()=>{
  const f=await fixture(),mode='pipeline-crash-'+window,c=child(f.script,mode);let barrier:any;
  try{
    for(let n=0;n<1500;n++){barrier=await fs.readFile(path.join(f.root,'barrier.json'),'utf8').then(s=>JSON.parse(s),()=>null);if(barrier)break;if(c.process.exitCode!==null)throw Error((await c.done).output);await new Promise(r=>setTimeout(r,10));}
    expect(barrier?.stage).toBe(window);if(window==='noop-before')expect(barrier.outcome.kind).toBe('recoveryPending');c.process.kill('SIGKILL');await c.done;
    for(let n=0;n<500;n++){const alive=[barrier.nativePid,barrier.guardPid].some(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});if(!alive)break;await new Promise(r=>setTimeout(r,10));}
    await run(f.script,'inspect');const r=await result(f.root,'inspect'),noop=window.startsWith('noop');expect(r.snapshot.project.revision).toBe(window==='prepared'?0:1);expect(r.capture.alpha).toBe(noop||window==='prepared'?0:128);expect(r.pendingOperations).toEqual([]);expect(r.unsettled).toEqual([]);
    const folder=path.join(f.root,'.storyboard-flow/image-project-v2/settlements'),files=await fs.readdir(folder),intent=JSON.parse(await fs.readFile(path.join(folder,barrier.operationId+'.intent.json'),'utf8')).intent;
    expect(intent.version).toBe(2);if(noop)expect(typeof intent.predecessorOperationId).toBe('string');else expect(intent.predecessorOperationId).toBeNull();expect(intent.stroke.points).toEqual([12,20,44,20]);const resolution=JSON.parse(await fs.readFile(path.join(folder,intent.operationId+'.resolution.json'),'utf8'));expect(resolution.decision).toBe(window==='prepared'||window==='noop-before'?'discarded':'committed');
  }finally{if(c.process.exitCode===null&&c.process.signalCode===null){c.process.kill('SIGKILL');await c.done;}}
},60000);


it('seals pipeline admission for Undo, allows captured up, drains exact work, and admits a fresh gesture after the barrier',async()=>{
  const f=await fixture();await run(f.script,'pipeline-barrier');const r=await result(f.root,'pipeline-barrier');expect(r.begin.kind).toBe('admitted');expect(r.undoActive.kind).toBe('rejected');expect(r.beginSealed).toMatchObject({kind:'rejected',error:{code:'busy'}});expect(r.end.kind).toBe('admitted');expect(r.paint.kind).toBe('settled');expect(r.undo.kind).toBe('settled');expect(r.undone.alpha).toBe(0);expect(r.metadataRefused.kind).toBe('rejected');expect(r.barrierStillSealed).toMatchObject({kind:'rejected',error:{code:'busy'}});expect(r.next.kind).toBe('admitted');expect(r.cancel.kind).toBe('admitted');expect(r.freeze.kind).toBe('settled');expect(r.snapshot.undoDepth).toBe(0);expect(r.snapshot.redoDepth).toBe(1);
},60000);


it('rejects Undo during an active later gesture without a FIFO cycle or an orphan admission seal',async()=>{
  const f=await fixture();await run(f.script,'pipeline-undo-race');const r=await result(f.root,'pipeline-undo-race');expect(r.up.kind).toBe('admitted');expect(r.busyUndo).toMatchObject({kind:'rejected',error:{code:'busy'}});expect(r.paints.map((o:any)=>o.kind)).toEqual(['settled','settled']);expect(r.beforeThird.project.revision).toBe(2);expect(r.beforeThird.undoDepth).toBe(2);expect(r.third.kind).toBe('admitted');expect(r.cancel.kind).toBe('admitted');expect(r.retryUndo.kind).toBe('settled');expect(r.afterRetry.project.revision).toBe(3);expect(r.afterRetry.undoDepth).toBe(1);expect(r.afterRetry.redoDepth).toBe(1);expect(r.freeze.kind).toBe('settled');
},60000);


for(const window of ['prepared','cas','accept','inflight-intent','undo-install','freeze-audit','noop-accept','confirmation-unknown'])it(`replaces only the owned native worker in the same Main after ${window} and preserves original mixed history`,async()=>{
 const f=await fixture(),mode='owned-'+window;await run(f.script,mode);const r=await result(f.root,mode);expect(r.newWorker.generation).toBe(2);expect(r.newWorker.pid).not.toBe(r.oldWorker.pid);expect(r.mainPid).toBeGreaterThan(0);expect(r.recover.kind).toBe('recovered');expect(r.recover.snapshot.phase).toBe(window==='freeze-audit'?'frozen':'active');expect(r.retained).toEqual([]);
 if(window==='inflight-intent'){expect(r.beforeRelease.recovered).toBe(false);expect(r.beforeRelease.phase).toBe('recovering');expect(r.beforeRelease.admission.kind).toBe('rejected');expect(r.recover.operations.filter((o:any)=>o.decision==='notCommitted')).toHaveLength(2);expect(r.afterRecover.project.revision).toBe(0);}
 else if(window==='prepared'){expect(r.initial.kind).toBe('recoveryPending');expect(r.recover.operations).toContainEqual(expect.objectContaining({operationId:r.operationId,decision:'notCommitted',original:'durable-intent'}));expect(r.afterRecover.project.revision).toBe(0);expect(r.afterRecover.undoDepth).toBe(0);}
 else if(window==='undo-install'){expect(r.undo.kind).toBe('settlementPending');expect(r.afterRecover.project.revision).toBe(2);expect(r.afterRecover.redoDepth).toBe(1);}
 else{expect(r.afterRecover.project.revision).toBe(1);expect(r.afterRecover.undoDepth).toBe(1);if(window==='cas'||window==='accept'||window==='noop-accept'||window==='confirmation-unknown')expect(r.recover.operations).toContainEqual(expect.objectContaining({operationId:r.operationId,decision:'committed'}));}
 if(window==='confirmation-unknown')expect(r.initial.kind).toBe('settlementPending');expect(r.records.every((e:any)=>e.resolution!==null)).toBe(true);expect(r.records.every((e:any)=>e.intent.stroke.points.length>0)).toBe(true);
 const changedBefore=['cas','accept','freeze-audit','confirmation-unknown'].includes(window);expect(r.recoveredCapture.alpha).toBe(changedBefore?128:0);if(window!=='freeze-audit'){expect(r.next.kind).toBe('settled');expect(r.nextCapture.alpha).toBe(changedBefore?192:128);}expect(r.freeze.kind).toBe('settled');
},60000);

for(const window of ['no-ready','active'])it(`retains ${window} volatile input explicitly instead of inventing identity or claiming recovery completion`,async()=>{
 const f=await fixture(),mode='owned-'+window,c=child(f.script,mode);let barrier:any;
 try{for(let n=0;n<1500;n++){barrier=await fs.readFile(path.join(f.root,'barrier.json'),'utf8').then(s=>JSON.parse(s),()=>null);if(barrier)break;if(c.process.exitCode!==null)throw Error((await c.done).output);await new Promise(r=>setTimeout(r,10));}expect(barrier?.stage).toBe(mode);const r=barrier.result;expect(r.newWorker.generation).toBe(2);expect(r.recover.kind).toBe('recoveryPending');expect(r.afterRecover.phase).toBe('recovering');expect(r.afterRecover.project.revision).toBe(0);expect(r.retained).toHaveLength(1);expect(r.retained[0].reason).toBe(window==='no-ready'?'missing-pipeline-identity':'incomplete-gesture');expect(r.retained[0].stroke.points).toEqual(window==='no-ready'?[12,20,44,20]:[12,20]);expect(r.blocked.kind).toBe('rejected');expect(r.recoveredCapture.alpha).toBe(0);
 }finally{if(c.process.exitCode===null&&c.process.signalCode===null){c.process.kill('SIGKILL');await c.done;}
  if(barrier){let alive=true;for(let n=0;n<500;n++){alive=[barrier.newNativePid,barrier.guardPid].some(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});if(!alive)break;await new Promise(r=>setTimeout(r,10));}expect(alive).toBe(false);}
 }
},60000);


it('fences a typed old start stalled in real manifest IO before it can Load or Start the replacement worker',async()=>{
 const f=await fixture(),mode='owned-start-read-race';await run(f.script,mode);const r=await result(f.root,mode);expect(r.oldStart.kind).toBe('rejected');expect(r.oldStart.code).toBe('worker-unavailable');expect(r.oldGenerationCalls).toEqual([]);expect(r.newWorker.generation).toBe(2);expect(r.recover.kind).toBe('recovered');expect(r.afterRecover.phase).toBe('active');expect(r.next.kind).toBe('settled');expect(r.nextCapture.alpha).toBe(128);expect(r.freeze.kind).toBe('settled');
},60000);


it('advances the unique CAS FIFO while native acceptance is withheld and keeps later accept behind its predecessor',async()=>{
 const f=await fixture(),mode='pipeline-split-accept';await run(f.script,mode);const r=await result(f.root,mode);expect(r.beforeAccepted.commits).toBe(2);expect(r.beforeAccepted.project.revision).toBe(2);expect(r.beforeAccepted.secondAccept).toBe(0);expect(r.beforeAccepted.firstSettled).toBe(false);expect(r.beforeAccepted.secondSettled).toBe(false);expect(r.outcomes.map((o:any)=>o.kind)).toEqual(['settled','settled']);expect(r.records.every((row:any)=>row.resolution?.decision==='committed')).toBe(true);expect(r.snapshot.undoDepth).toBe(2);expect(r.freeze.kind).toBe('settled');
},60000);


for(const window of ['multi-cas','multi-noop','multi-suffix'])it(`reconciles ${window} by real predecessor order despite reverse lexical operation IDs`,async()=>{
 const f=await fixture(),mode='owned-'+window;await run(f.script,mode);const r=await result(f.root,mode);expect(r.newWorker.generation).toBe(2);expect(r.recover.kind).toBe('recovered');expect(r.afterRecover.phase).toBe('active');expect(r.recover.operations.slice(0,2).map((o:any)=>o.operationId)).toEqual(['z-first','a-second']);expect(r.recover.operations.slice(0,2).every((o:any)=>o.decision==='committed')).toBe(true);
 expect(r.afterRecover.project.revision).toBe(window==='multi-noop'?1:2);expect(r.afterRecover.undoDepth).toBe(window==='multi-noop'?1:2);expect(r.recoveredCapture.alpha).toBe(window==='multi-noop'?0:128);if(window==='multi-suffix')expect(r.recover.operations).toContainEqual(expect.objectContaining({operationId:'m-third',decision:'notCommitted'}));expect(r.records.every((o:any)=>o.resolution!==null)).toBe(true);expect(r.next.kind).toBe('settled');expect(r.nextCapture.alpha).toBe(window==='multi-noop'?128:192);expect(r.freeze.kind).toBe('settled');
},60000);


it('keeps four independent confirmation credits after native admission slots release and waits for durable batches',async()=>{
 const f=await fixture(),mode='pipeline-confirmation-credit';await run(f.script,mode);const r=await result(f.root,mode);expect(r.beforeConfirmation.project.revision).toBe(4);expect(r.beforeConfirmation.settled).toBe(0);expect(r.beforeConfirmation.admission).toMatchObject({kind:'rejected',error:{code:'backpressure'}});expect(r.outcomes.map((o:any)=>o.kind)).toEqual(['settled','settled','settled','settled']);expect(r.batches.flat()).toHaveLength(4);expect(r.batches.every((b:any)=>b.length<=4)).toBe(true);expect(r.nextAdmission.kind).toBe('admitted');expect(r.freeze.kind).toBe('settled');
},60000);


it('blocks an accepted descendant with a prepared predecessor instead of manufacturing a settled prefix',async()=>{
 const f=await fixture(),mode='owned-multi-contradiction',c=child(f.script,mode);let barrier:any;
 try{for(let n=0;n<1500;n++){barrier=await fs.readFile(path.join(f.root,'barrier.json'),'utf8').then(s=>JSON.parse(s),()=>null);if(barrier)break;if(c.process.exitCode!==null)throw Error((await c.done).output);await new Promise(r=>setTimeout(r,10));}expect(barrier?.stage).toBe(mode);const r=barrier.result;expect(r.recover).toMatchObject({kind:'rejected',error:{message:'Native accepted descendant has an unaccepted predecessor'}});expect(r.afterRecover.phase).toBe('recovering');expect(r.afterRecover.project.revision).toBe(2);expect(r.parent.state).toBe('prepared');expect(r.child.state).toBe('accepted');expect(r.records.every((row:any)=>row.resolution===null)).toBe(true);
 }finally{if(c.process.exitCode===null&&c.process.signalCode===null){c.process.kill('SIGKILL');await c.done;}if(barrier)for(let n=0;n<500;n++){const alive=[barrier.newNativePid,barrier.guardPid].some(pid=>{try{process.kill(pid,0);return true;}catch{return false;}});if(!alive)break;await new Promise(r=>setTimeout(r,10));}}
},60000);

// The old multi-file fault matrix above remains intact. These cross the same
// Session Interface using the replacement journal and actual owned processes.
it('journal: real paint/dialogue/Pending mixed Undo/Redo, originals and clean reopen',async()=>{
 const f=await fixture('journal');await run(f.script,'normal');const r=await result(f.root,'normal');expect([r.paint.kind,r.dialogue.kind,r.move.kind]).toEqual(['settled','settled','settled']);expect(r.snapshot.project.revision).toBe(9);expect(r.snapshot.undoDepth).toBe(3);expect(r.undone.hash).toBe(r.before.hash);expect(r.redone.hash).toBe(r.painted.hash);expect(r.undo[0].snapshot.project.parkedShots).toEqual([]);expect(r.undo[1].snapshot.project.dialogues).toEqual([]);await fs.unlink(path.join(f.root,'a.png'));await run(f.script,'inspect');const opened=await result(f.root,'inspect');expect(opened.snapshot.project).toEqual(r.snapshot.project);expect(opened.capture.hash).toBe(r.painted.hash);expect(opened.snapshot.undoDepth).toBe(0);expect(opened.pendingOperations).toEqual([]);expect(opened.unsettled).toEqual([]);
},60000);
for(const window of ['prepared','cas','accepted'])it(`journal: actual Main SIGKILL after ${window} keeps original input and exactly one project decision`,async()=>{
 const f=await fixture('journal'),c=child(f.script,window);let barrier:any;
 try{for(let n=0;n<1000;n++){barrier=await fs.readFile(path.join(f.root,'barrier.json'),'utf8').then(s=>JSON.parse(s),()=>null);if(barrier)break;if(c.process.exitCode!==null)throw Error((await c.done).output);await new Promise(r=>setTimeout(r,10));}expect(barrier.stage).toBe(window);c.process.kill('SIGKILL');await c.done;for(let n=0;n<500;n++){if([barrier.nativePid,barrier.guardPid].every(pid=>{try{process.kill(pid,0);return false;}catch{return true;}}))break;await new Promise(r=>setTimeout(r,10));}await run(f.script,'inspect');const r=await result(f.root,'inspect');expect(r.snapshot.project.revision).toBe(window==='prepared'?0:1);expect(r.capture.alpha).toBe(window==='prepared'?0:128);expect(r.pendingOperations).toEqual([]);expect(r.unsettled).toEqual([]);expect(r.operationRecords).toHaveLength(1);expect(r.operationRecords[0].intent.stroke.points).toEqual([12,20,44,20]);expect(r.operationRecords[0].resolution.decision).toBe(window==='prepared'?'discarded':'committed');expect(await fs.readdir(path.join(f.root,'.storyboard-flow/image-native/native/versions'))).toHaveLength(2);
 }finally{if(c.process.exitCode===null&&c.process.signalCode===null){c.process.kill('SIGKILL');await c.done;}}
},60000);
for(const mode of ['pipeline-noop','pipeline-split-accept','owned-multi','owned-multi-noop','owned-multi-suffix'])it(`journal: real FIFO native recovery/confirmation ${mode}`,async()=>{
 const f=await fixture('journal');await run(f.script,mode);const r=await result(f.root,mode);expect(r.freeze.kind).toBe('settled');if(mode==='pipeline-noop'){expect(r.noop.kind).toBe('settled');expect(r.afterNoop.project).toEqual(r.beforeNoop.project);expect(r.afterNoop.undoDepth).toBe(r.beforeNoop.undoDepth);}else if(mode.startsWith('owned-')){expect(r.recover.kind).toBe('recovered');expect(r.newWorker.generation).toBe(2);expect(r.recover.snapshot.phase).toBe('active');}await run(f.script,'inspect');const opened=await result(f.root,'inspect');expect(opened.snapshot.project).toEqual(r.snapshot.project);expect(opened.pendingOperations).toEqual([]);expect(opened.unsettled).toEqual([]);
},60000);

it('journal: real SIGKILL in a partial group preserves confirmed mixed prefix and resumes without truncating evidence',async()=>{
 const f=await fixture('journal'),c=child(f.script,'journal-kill-tail');let barrier:any;
 try{for(let n=0;n<1000;n++){barrier=await fs.readFile(path.join(f.root,'barrier.json'),'utf8').then(s=>JSON.parse(s),()=>null);if(barrier)break;if(c.process.exitCode!==null)throw Error((await c.done).output);await new Promise(r=>setTimeout(r,10));}expect(barrier.stage).toBe('journal-tail');expect(barrier.before.project.revision).toBe(2);c.process.kill('SIGKILL');await c.done;for(let n=0;n<500;n++){if([barrier.nativePid,barrier.guardPid].every(pid=>{try{process.kill(pid,0);return false;}catch{return true;}}))break;await new Promise(r=>setTimeout(r,10));}const file=path.join(f.root,'.storyboard-flow/image-project-journal-v1/segment-0.log'),original=await fs.readFile(file);await run(f.script,'inspect');const r=await result(f.root,'inspect');expect(r.snapshot.project.revision).toBe(2);expect(r.snapshot.project.shots[0].scriptText).toBe('confirmed prefix');expect(r.capture.alpha).toBe(128);expect(r.pendingOperations).toEqual([]);expect(await fs.readFile(file)).toEqual(original);expect(await fs.readdir(path.dirname(file))).toContain('continuation-1.json');await run(f.script,'normal');const continued=await result(f.root,'normal');expect(continued.freeze.kind).toBe('settled');
 }finally{if(c.process.exitCode===null&&c.process.signalCode===null){c.process.kill('SIGKILL');await c.done;}}
},60000);
