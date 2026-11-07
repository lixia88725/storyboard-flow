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
  'session/core/nativeSession','session/core/snapshotHistory','session/core/grouping','session/core/imageProjectModel','session/core/imageProjectValues',
  'platform/contracts/flowPresentation','platform/main/imageEngineConnection','platform/main/imageEngineFraming','platform/main/imageProjectLease',
  'project-files/main/image-engine/projectStore','project-files/main/image-engine/sourceStore','project-files/main/image-engine/nativeSessionAdapter',
  'project-files/main/workspacePhysicalWriterGate','project-files/main/persistence/canonicalJson','project-files/main/persistence/fileOps','project-files/main/persistence/errors'
];
async function fixture(){
  const binary=process.env.FLOW_IMAGE_HOST,leaseBinary=process.env.FLOW_PROJECT_LEASE_BIN;
  if(!binary||!leaseBinary)throw Error('Prepare fixed native host/lease and set FLOW_IMAGE_HOST and FLOW_PROJECT_LEASE_BIN; no fake worker fallback');
  const root=await temporaryWorkspace('native-project-'),runtime=path.join(root,'runtime');await fs.mkdir(runtime);
  await fs.writeFile(path.join(runtime,'package.json'),JSON.stringify({type:'module'}));
  const src=fileURLToPath(new URL('../../../',import.meta.url));
  // This file lives in src/project-files/main/image-engine, so ../../../ is src.
  for(const name of modules){const code=await fs.readFile(path.join(src,name+'.ts'),'utf8'),out=path.join(runtime,name+'.js');await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
  const png=await sharp({create:{width:64,height:64,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
  for(const id of ['a','b'])await fs.writeFile(path.join(root,id+'.png'),png);
  const script=path.join(runtime,'main.mjs');
  await fs.writeFile(script,`
import fs from 'node:fs/promises';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {startImageEngine} from './platform/main/imageEngineConnection.js';
import {acquireImageProjectLease} from './platform/main/imageProjectLease.js';
import {createSourceBackedImport,openSourceBackedImport} from './project-files/main/image-engine/sourceStore.js';
import {openImageProjectStore} from './project-files/main/image-engine/projectStore.js';
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
const connection=startImageEngine({binary,store:path.join(root,'.storyboard-flow/image-native/native'),sessionId:'session',incarnation:randomUUID(),budgetBytes:32<<20});await connection.ready.catch(e=>{console.error(connection.diagnostics());throw e;});
let failAppend=mode==='append-error';const request=connection.request.bind(connection);connection.request=async(...args)=>{if(failAppend&&args[1].kind==='strokeAppend'){failAppend=false;args[1]={...args[1],fromSeq:999};}return request(...args);};
const adapter=createNativeSessionAdapter({connection,storeId:'native',storeRoot:path.join(root,'.storyboard-flow/image-native/native')});
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
let serial=0;const session=await openNativeProjectSession({sessionId:'main',incarnation:randomUUID(),store,native:driver,mintId:()=>randomUUID(),now:()=>performance.now()});
const capture=async()=>{const frame=await adapter.capture(),p=frame.payload;return {hash:createHash('sha256').update(p).digest('hex'),alpha:p[(20*64+24)*4+3],red:p[(20*64+24)*4]};};
const result={};
if(mode==='normal'){
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
 result.capture=await capture();result.pendingOperations=await store.pendingOperations();result.unsettled=await store.unsettled();
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
    expect(barrier?.stage).toBe(window);c.process.kill('SIGKILL');await c.done;
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
  expect(r.paint.kind).toBe('settlementPending');expect(r.closeRejected).toBe(true);expect(r.freezeWhilePending.kind).toBe('rejected');expect(r.pendingBeforeRecover).toHaveLength(1);expect(r.whilePending.phase).toBe('recovering');expect(r.whilePending.project.revision).toBe(1);expect(r.blocked.kind).toBe('rejected');expect(r.recover.kind).toBe('settled');expect(r.capture.alpha).toBe(128);expect(r.snapshot.undoDepth).toBe(1);
},60000);

it('explicitly refuses unmigrated pencil dynamics and retains their exact submitted input',async()=>{
  const f=await fixture();await run(f.script,'unsupported');const r=await result(f.root,'unsupported');expect(r.paint).toMatchObject({kind:'rejected',error:{code:'unsupported-brush',effect:'retained'}});expect(r.snapshot.project.revision).toBe(0);expect(r.snapshot.undoDepth).toBe(0);expect(r.capture.alpha).toBe(0);expect(r.pendingOperations).toEqual([]);
  const dir=path.join(f.root,'.storyboard-flow/image-project-v2/settlements'),leaf=(await fs.readdir(dir)).find(n=>n.endsWith('.intent.json'))!;const envelope=JSON.parse(await fs.readFile(path.join(dir,leaf),'utf8'));expect(envelope.intent.stroke.brush).toMatchObject({tip:'pencil',grain:0.55,pressureSize:0.45,pressureOpacity:0.6});
},60000);

it('keeps a pre-CAS unknown prepared operation and complete input until explicit discard recovery',async()=>{
  const f=await fixture();await run(f.script,'prepared-error');const r=await result(f.root,'prepared-error');expect(r.paint.kind).toBe('recoveryPending');expect(r.closeRejected).toBe(true);expect(r.freezeWhilePending.kind).toBe('rejected');expect(r.pendingBeforeRecover).toHaveLength(1);expect(r.pendingBeforeRecover[0].stroke.points).toEqual([12,20,44,20]);expect(r.recover.kind).toBe('settled');expect(r.snapshot.project.revision).toBe(0);expect(r.snapshot.undoDepth).toBe(0);expect(r.capture.alpha).toBe(0);
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
