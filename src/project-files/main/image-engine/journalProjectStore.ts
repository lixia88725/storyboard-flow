import{verifyCreationTransition,validImageCreationIntent}from'../../../session/core/imageCreation.js';
import {workspaceRecoveryRecord,type WorkspaceRecoveryRecord} from './workspaceRecords.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import type { HydrationRecord, ImageOperationDecision, ImageOperationIntent, ImageOperationPage, ImageOperationResolution, NativeDecision, NativeImageRef, ProjectCommitV2, SourceImageRef } from '../../../platform/contracts/imageProject.js';
import { validNativeDecision, validNativeImageRef, validSourceImageRef, imageHash } from '../../../session/core/imageProjectModel.js';
import { same, shape } from '../../../session/core/imageProjectValues.js';
import { canonicalJson } from '../persistence/canonicalJson.js';
import { writeTemporaryFile, releaseTemporary } from '../persistence/fileOps.js';
import { assertPhysicalWorkspaceWriterTargets } from '../workspacePhysicalWriterGate.js';
import { ImageProjectStoreError, commitRecord, hydrationRecord, operationIntent, hydrationKey } from './projectStoreRecords.js';
import type { ImageProjectStoreOptions, ProjectStoreV2, ProjectCommitReceipt, ProjectConfirmation } from './projectStoreRecords.js';
import { openRecoveryJournal } from './recoveryJournal.js';

const MAX=8*1024**3,TOKEN=/^[A-Za-z0-9_-]{1,128}$/,GATE_VERSION=2147483647;
const copy=<T>(v:T):T=>structuredClone(v),bytes=(v:unknown)=>Buffer.from(canonicalJson(v)+'\n'),sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
const token=(v:unknown):v is string=>typeof v==='string'&&TOKEN.test(v);
function bad(m:string):never{throw new ImageProjectStoreError('conflict',m);}
const owners=new Map<string,symbol>();
type Summary=ImageOperationIntent extends infer T?T extends ImageOperationIntent?Omit<T,'stroke'>:never:never;
type Fact=
 |{kind:'workspace';record:WorkspaceRecoveryRecord}
 |{kind:'format';formatId:string}
 |{kind:'input';intent:ImageOperationIntent}
 |{kind:'commit';expectedHead:string|null;record:ProjectCommitV2}
 |{kind:'unchanged';commitHash:string;decision:NativeDecision}
 |{kind:'confirmation';records:ProjectConfirmation[];resolve:boolean}
 |{kind:'hydration';record:HydrationRecord}
 |{kind:'hydrationAccepted';source:SourceImageRef;operationId:string;native:NativeImageRef}
 |{kind:'resolution';resolution:ImageOperationResolution};
type State={workspaceKinds:Map<WorkspaceRecoveryRecord['kind'],string[]>;workspaceResolutions:Map<string,Extract<WorkspaceRecoveryRecord,{kind:'requestResolution'}>>;workspace:Map<string,{sequence:number;digest:string}>;sequence:number;format:boolean;commits:ProjectCommitReceipt[];byId:Map<string,ProjectCommitReceipt>;byHash:Map<string,ProjectCommitReceipt>;inputs:Map<string,{sequence:number;summary:Summary;digest:string}>;captures:Map<string,string>;decisions:Map<string,ImageOperationDecision>;confirmations:Set<string>;hydrations:Map<string,HydrationRecord>;hydrated:Set<string>;resolutions:Map<string,ImageOperationResolution>};
const empty=():State=>({workspaceKinds:new Map(),workspaceResolutions:new Map(),workspace:new Map(),sequence:0,format:false,commits:[],byId:new Map(),byHash:new Map(),inputs:new Map(),captures:new Map(),decisions:new Map(),confirmations:new Set(),hydrations:new Map(),hydrated:new Set(),resolutions:new Map()});
const captureKey=(i:{sessionId:string;incarnation:string},o:{workspaceEpoch:number;captureId:string})=>`${i.sessionId}\n${i.incarnation}\n${o.workspaceEpoch}\n${o.captureId}`;
function apply(s:State,f:Fact,sequence:number){
 s.sequence=sequence;
 switch(f.kind){
  case'workspace':{const ids=s.workspaceKinds.get(f.record.kind)??[];ids.push(f.record.id);s.workspaceKinds.set(f.record.kind,ids);}s.workspace.set(f.record.id,{sequence,digest:sha(bytes(f.record))});if(f.record.kind==='requestResolution')s.workspaceResolutions.set(f.record.operationId,copy(f.record));break;
  case'format':s.format=true;break;
  case'input':{const{stroke:_stroke,...summary}={...f.intent,stroke:'stroke'in f.intent?f.intent.stroke:undefined};if(f.intent.origin)s.captures.set(captureKey(f.intent,f.intent.origin),f.intent.operationId);s.inputs.set(f.intent.operationId,{sequence,summary,digest:sha(bytes(f.intent))});break;}
  case'commit':{const hash=sha(bytes(f.record)),head={schema:'flow.project-head' as const,version:1 as const,projectId:f.record.after.id,commitHash:hash},r={commitHash:hash,commit:copy(f.record),head};s.commits.push(r);s.byId.set(f.record.commitId,r);s.byHash.set(hash,r);if(f.record.nativeDecision)s.decisions.set(f.record.nativeDecision.operationId,{commitHash:hash,decision:copy(f.record.nativeDecision),unchanged:false});break;}
  case'unchanged':s.decisions.set(f.decision.operationId,{commitHash:f.commitHash,decision:copy(f.decision),unchanged:true});break;
  case'confirmation':for(const r of f.records){s.confirmations.add(r.operationId);if(f.resolve)s.resolutions.set(r.operationId,{schema:'flow.image-edit-resolution',version:1,operationId:r.operationId,decision:'committed',commitHash:r.commitHash});}break;
  case'hydration':s.hydrations.set(hydrationKey(f.record.source),copy(f.record));break;
  case'hydrationAccepted':s.hydrated.add(hydrationKey(f.source));break;
  case'resolution':s.resolutions.set(f.resolution.operationId,copy(f.resolution));break;
 }
}
async function directory(p:string,create=false){if(create)await fs.mkdir(p,{mode:0o700}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});const s=await fs.lstat(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(p)!==p)bad('Unsafe journal project directory');return s;}
async function syncDir(p:string){const h=await fs.open(p,'r');try{await h.sync();}finally{await h.close();}}
/** Main's sole project authority. All project/input/derived native facts share
 * one bounded physical group flush; no head/checkpoint file commits edits. */
export async function openJournalProjectStore(options:ImageProjectStoreOptions):Promise<ProjectStoreV2>{
 if(!options||!path.isAbsolute(options.root)||path.normalize(options.root)!==options.root||options.root.includes('\0')||typeof options.verifyNative!=='function'||typeof options.verifySource!=='function'||typeof options.writerAuthority?.assertHeld!=='function')throw new ImageProjectStoreError('invalid-input','Canonical root, lease and verifiers required');
 const root=options.root,budget=options.maxRecoveryBytes??MAX;if(!Number.isSafeInteger(budget)||budget<1||budget>MAX)throw new ImageProjectStoreError('invalid-input','Invalid recovery budget');
 if(process.platform==='win32'||typeof constants.O_NOFOLLOW!=='number')bad('Journal platform has no verified no-follow/directory sync support');
 const identity=await directory(root),binding={path:root,dev:String(identity.dev),ino:String(identity.ino)},owner=Symbol();
 await assertPhysicalWorkspaceWriterTargets([root]);await options.writerAuthority.assertHeld(binding);if(owners.has(root))throw new ImageProjectStoreError('busy','Image journal writer already open');owners.set(root,owner);
 const hidden=path.join(root,'.storyboard-flow'),legacy=path.join(hidden,'image-project-v2'),home=path.join(hidden,'image-project-journal-v1'),gateFile=path.join(legacy,'head.json');
 let closed=false,closing=false,auditing=false,formatId='',creating=false,actual=0,reservations=0,budgetDirty=false,admission=Promise.resolve(),budgetTail=Promise.resolve();let closePromise:Promise<void>|undefined;
 const dirs=new Map<string,{dev:bigint;ino:bigint}>();let gateBytes:Buffer|undefined;
 const readGate=async()=>{const entry=await fs.lstat(gateFile,{bigint:true});if(!entry.isFile()||entry.isSymbolicLink()||entry.size>4096n)bad('Unsafe journal writer gate');const h=await fs.open(gateFile,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await h.stat({bigint:true});if(before.dev!==entry.dev||before.ino!==entry.ino)bad('Writer gate identity changed');const b=Buffer.alloc(4097);let n=0;for(;;){const r=await h.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;if(n>4096)bad('Oversized writer gate');}const after=await h.stat({bigint:true});if(after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs||BigInt(n)!==before.size)bad('Writer gate changed during read');return b.subarray(0,n);}finally{await h.close();}};

 const bound=async()=>{
  if(closed||owners.get(root)!==owner)throw new ImageProjectStoreError('closed','Journal writer closed');await options.writerAuthority.assertHeld(binding);await assertPhysicalWorkspaceWriterTargets([root]);
  for(const[p,id]of [[root,identity] as const,...dirs]){const s=await directory(p);if(s.dev!==id.dev||s.ino!==id.ino)bad('Journal project directory identity changed');}
  if(gateBytes){if(!(await readGate()).equals(gateBytes))bad('Journal writer format gate changed');}
 };
 const inventory=async()=>{let used=0,count=0;const walk=async(p:string,depth:number):Promise<void>=>{if(depth>32)bad('Recovery nesting budget');for(const leaf of await fs.readdir(p)){if(++count>1_000_000)bad('Recovery entry budget');const at=path.join(p,leaf),s=await fs.lstat(at);if(s.isSymbolicLink())bad('Recovery inventory contains symlink');if(s.isDirectory())await walk(at,depth+1);else if(s.isFile()){used+=s.size;if(!Number.isSafeInteger(used))bad('Recovery size overflow');}else bad('Unknown recovery inventory entry');}};await walk(hidden,0);actual=used;};
 const reserve=async(n:number)=>{
  const task=budgetTail.then(async()=>{if(budgetDirty)throw new ImageProjectStoreError('busy','Unknown journal expenditure requires drained recovery','retained');const other=await options.reservedRecoveryBytes?.()??0;if(!Number.isSafeInteger(other)||other<0||actual+reservations+other+n>budget)throw new ImageProjectStoreError('resource-limit','Recovery actual/reserved budget exceeded');reservations+=n;let released=false;return()=>{if(!released){released=true;reservations-=n;}};});budgetTail=task.then(()=>undefined,()=>undefined);return task;
 };
 let journal:Awaited<ReturnType<typeof openRecoveryJournal>>,staged=empty(),durable=empty();
 const verifyRefs=new Set<string>();
 const verify=async(content:{kind:'source';source:SourceImageRef}|{kind:'native';native:NativeImageRef})=>{const k=canonicalJson(content);if(verifyRefs.has(k))return;if(content.kind==='native')await options.verifyNative(copy(content.native));else await options.verifySource(copy(content.source));verifyRefs.add(k);};
 const checkBase=(s:State,d:NativeDecision)=>{
  const i=s.inputs.get(d.operationId)?.summary;if(!i||i.imageId!==d.imageId||d.operationId!==d.candidateId)bad('Project decision has no matching original input');
  if(i.version===1||i.version===3){if(d.pipeline||!same(i.expected,d.expected)||!same(i.baseNative,d.baseNative))bad('Serial decision differs from original input');}
  else{
   if(!same(d.pipeline,{pipelineId:i.pipelineId,anchorCommitHash:i.anchorCommitHash,predecessorOperationId:i.predecessorOperationId}))bad('Pipeline decision differs from original input chain');
   const anchor=s.byHash.get(i.anchorCommitHash);if(!anchor||!same(anchor.commit.after.images[i.imageId]?.content,i.expectedAtAnchor))bad('Input anchor is unreachable');
   if(i.predecessorOperationId){const p=s.decisions.get(i.predecessorOperationId);if(!p||p.decision.imageId!==i.imageId||p.decision.pipeline?.pipelineId!==i.pipelineId||p.decision.pipeline.anchorCommitHash!==i.anchorCommitHash||!same(p.decision.prepared,d.baseNative)||!same(d.expected,p.unchanged?p.decision.expected:{kind:'native',native:p.decision.prepared}))bad('Pipeline predecessor decision mismatch');}
   else if(!same(d.baseNative,i.anchor)||!same(d.expected,i.expectedAtAnchor))bad('First pipeline decision base mismatch');
  }
  if(d.expected.kind==='native'){if(!same(d.baseNative,d.expected.native))bad('Native decision content mismatch');}
  else if(!same(s.hydrations.get(hydrationKey(d.expected.source))?.native,d.baseNative))bad('Source decision hydration mismatch');
  if(!d.baseNative||d.baseNative.documentId!==d.prepared.documentId||d.baseNative.storeId!==d.prepared.storeId)bad('Native document/store changed');
 };
 const validate=async(s:State,f:Fact,replay=false)=>{
  if(f.kind!=='format'&&!s.format)bad('Journal has no format record');
  switch(f.kind){
   case'workspace':{const r=workspaceRecoveryRecord(f.record);if(r.kind==='sourceHydrationResolution'){const h=s.hydrations.get(hydrationKey(r.source));if(r.decision==='hydrated'?(!h||h.operationId!==r.operationId||!same(h.native,r.native)||!s.hydrated.has(hydrationKey(r.source))):(!!h&&h.operationId===r.operationId))bad('Source resolution contradicts derived index');}if(r.kind==='fileIntent'||r.kind==='fileResult'){
 const get=async(id:string)=>{const a=s.workspace.get(id);if(!a)return null;const f=parseFact(await journal.read(a.sequence));return f.kind==='workspace'?f.record:null;};
 const binding=await get(`request-${sha(Buffer.from(canonicalJson({owner:r.owner,requestId:r.requestId})))}`);if(binding?.kind!=='request'||binding.operationId!==r.operationId||binding.command.kind!=='save')bad('File fact lacks exact Main request');
 const at=await get(`file-intent-${r.operationId}`);
 if(r.kind==='fileIntent'){if(await get(`file-result-${r.operationId}`))bad('A terminal file request cannot start again');const c=s.byHash.get(r.commitHash);if(!c)bad('File intent is not a reachable project');const p=c.commit.after,live=[...p.shots,...p.parkedShots];if(Object.keys(r.resolvedImages).length!==new Set(live.map(v=>v.imageId)).size)bad('Save intent must cover every live image');for(const shot of live){const image=p.images[shot.imageId],ref=r.resolvedImages[shot.imageId]?.native;if(!ref)bad('Save image missing');if(image.content.kind==='native'?!same(image.content.native,ref):(!s.hydrated.has(hydrationKey(image.content.source))||!same(s.hydrations.get(hydrationKey(image.content.source))?.native,ref)))bad('Save reference does not match committed content/settled hydration');}}
 else if(r.decision==='notStarted'){if(at)bad('Started file operation cannot become notStarted');}
 else{if(at?.kind!=='fileIntent'||at.outputOperationId!==r.receipt!.operationId||at.commitHash!==r.receipt!.commitHash)bad('File result lacks original frozen intent');const p=s.byHash.get(at.commitHash)!.commit.after,shots=[...p.shots,...p.parkedShots];if(r.receipt!.projectId!==p.id||r.receipt!.revision!==p.revision||r.receipt!.files.length!==shots.length)bad('Save result differs from frozen project');for(const f of r.receipt!.files){const shot=shots.find(s=>s.id===f.shotId);if(!shot||shot.imageId!==f.imageId||f.location!==(p.shots.some(s=>s.id===shot.id)?'active':'parked')||!same(f.native,at.resolvedImages[f.imageId]?.native))bad('Save result binding changed');}}
 }if(s.workspace.has(r.id))bad('Duplicate workspace recovery fact');if(r.kind==='requestResolution'){const old=s.workspaceResolutions.get(r.operationId);if(old&&(old.decision!==r.decision||old.commitHash!==r.commitHash))bad('Workspace operation already resolved differently');const c=s.byId.get(r.operationId),d=s.decisions.get(r.operationId);if(r.decision==='committed'?(c?.commitHash!==r.commitHash&&d?.commitHash!==r.commitHash):(Boolean(c)||Boolean(d)))bad('Workspace resolution contradicts Main decision');}break;}
   case'format':if(s.sequence!==0||f.formatId!==formatId)bad('Journal format/project identity changed');break;
   case'input':{
    const i=operationIntent(f.intent);if(s.workspaceResolutions.get(i.operationId)?.decision==='notCommitted')bad('Resolved input cannot be applied');if(i.origin&&s.captures.has(captureKey(i,i.origin)))bad('Capture identity already belongs to an operation');if(s.inputs.has(i.operationId))bad('Duplicate input journal record');
    if(i.version===1||i.version===3){if(!same(s.commits.at(-1)?.commit.after.images[i.imageId]?.content,i.expected))bad('Input baseline changed');}
    else{const anchor=s.byHash.get(i.anchorCommitHash);if(!anchor||!same(anchor.commit.after.images[i.imageId]?.content,i.expectedAtAnchor))bad('Input anchor is not reachable');if(i.expectedAtAnchor.kind==='native'){if(!same(i.anchor,i.expectedAtAnchor.native))bad('Input native anchor mismatch');}else if(!same(s.hydrations.get(hydrationKey(i.expectedAtAnchor.source))?.native,i.anchor))bad('Input source anchor mismatch');if(i.predecessorOperationId){const p=s.inputs.get(i.predecessorOperationId)?.summary;if(!p||p.version!==2||p.pipelineId!==i.pipelineId||p.anchorCommitHash!==i.anchorCommitHash||p.imageId!==i.imageId||!same(p.anchor,i.anchor)||!same(p.expectedAtAnchor,i.expectedAtAnchor))bad('Input predecessor mismatch');}}
    break;
   }
   case'commit':{
    const c=commitRecord(f.record);if(s.workspaceResolutions.get(c.commitId)?.decision==='notCommitted')bad('Discarded request cannot later commit');const current=s.commits.at(-1);if(s.byId.has(c.commitId)||f.expectedHead!==(current?.commitHash??null)||c.previousCommitHash!==f.expectedHead)bad('Project compare-and-swap conflict');
    if(current){if(c.after.id!==current.commit.after.id||c.beforeRevision!==current.commit.after.revision||c.after.revision!==Number(c.beforeRevision)+1)bad('Project revision/identity conflict');}else if(c.beforeRevision!==null||c.after.revision!==0||c.nativeDecision||c.creationDecision)bad('Invalid project genesis');
    if(c.nativeDecision){const d=c.nativeDecision;if(s.decisions.has(d.operationId))bad('Operation has two project decisions');checkBase(s,d);const before=current!.commit.after;if(!same(before.images[d.imageId]?.content,d.expected)||!same(c.after,{...before,revision:c.after.revision,images:{...before.images,[d.imageId]:{id:d.imageId,content:{kind:'native',native:d.prepared}}}}))bad('Native decision differs from project transition');}
    if(c.creationDecision){if(!current||c.creationDecision.operationId!==c.commitId)bad('Creation decision has no Main operation');const location=s.workspace.get(c.creationDecision.intentId);if(!location)bad('Creation decision lacks original input');const fact=parseFact(await journal.read(location.sequence));if(fact.kind!=='workspace'||fact.record.kind!=='creationBatch'||!validImageCreationIntent(fact.record.intent)||fact.record.intent.anchorCommitHash!==f.expectedHead)bad('Creation batch anchor changed');verifyCreationTransition(current.commit.after,c.after,fact.record.intent,c.creationDecision);}
    if(!replay)for(const image of Object.values(c.after.images))await verify(image.content);break;
   }
   case'unchanged':{
    const d=f.decision;if(!validNativeDecision(d)||!same(d.baseNative,d.prepared)||s.decisions.has(d.operationId)||s.commits.at(-1)?.commitHash!==f.commitHash)bad('Invalid unchanged project decision');
    if(!same(s.commits.at(-1)?.commit.after.images[d.imageId]?.content,d.expected))bad('Unchanged binding differs from head');checkBase(s,d);if(d.expected.kind==='source'&&!s.hydrated.has(hydrationKey(d.expected.source)))bad('Unchanged source requires accepted hydration');break;
   }
   case'confirmation':{
    if(!Array.isArray(f.records)||f.records.length<1||f.records.length>4||typeof f.resolve!=='boolean'||new Set(f.records.map(r=>r.operationId)).size!==f.records.length)bad('Invalid confirmation group');
    for(const r of f.records){if(!shape(r,['commitHash','operationId','native'])||!token(r.operationId)||!validNativeImageRef(r.native))bad('Malformed native confirmation');const d=s.decisions.get(r.operationId);if(!d||d.commitHash!==r.commitHash||!same(d.decision.prepared,r.native))bad('Confirmation has no exact reachable Main decision');const old=s.resolutions.get(r.operationId);if(old&&old.decision!=='committed')bad('Confirmation contradicts resolution');}break;
   }
   case'hydration':{const h=hydrationRecord(f.record),key=hydrationKey(h.source);if(s.hydrations.has(key))bad('Duplicate hydration');if(!replay){await options.verifySource({importId:h.source.importId,itemId:h.source.itemId,interpretationId:h.source.interpretationId},{digest:h.source.digest,byteLength:h.source.byteLength});await options.verifyNative(copy(h.native));}break;}
   case'hydrationAccepted':{if(!validSourceImageRef(f.source)||!validNativeImageRef(f.native)||!token(f.operationId))bad('Invalid hydration confirmation');const h=s.hydrations.get(hydrationKey(f.source));if(!h||h.operationId!==f.operationId||!same(h.native,f.native))bad('Hydration confirmation mismatch');break;}
   case'resolution':{const r=f.resolution;if(!shape(r,['schema','version','operationId','decision','commitHash'])||r.schema!=='flow.image-edit-resolution'||r.version!==1||!token(r.operationId)||!s.inputs.has(r.operationId)||!['discarded','committed'].includes(r.decision))bad('Invalid input resolution');const d=s.decisions.get(r.operationId);if(r.decision==='committed'?(!d||d.commitHash!==r.commitHash):(!!d||r.commitHash!==null))bad('Resolution contradicts Main project decision');const old=s.resolutions.get(r.operationId);if(old&&!same(old,r))bad('Input already resolved differently');break;}
   default:bad('Unknown journal record');
  }
 };
 const parseFact=(v:unknown):Fact=>{if(!v||typeof v!=='object'||typeof(v as {kind?:unknown}).kind!=='string')bad('Malformed journal fact');const f=v as Fact;const fields:Record<string,string[]>={workspace:['kind','record'],format:['kind','formatId'],input:['kind','intent'],commit:['kind','expectedHead','record'],unchanged:['kind','commitHash','decision'],confirmation:['kind','records','resolve'],hydration:['kind','record'],hydrationAccepted:['kind','source','operationId','native'],resolution:['kind','resolution']};if(!fields[f.kind]||!shape(v,fields[f.kind]))bad('Unknown journal record shape');return f;};
 const open=()=>openRecoveryJournal({directory:home,formatId,assertHeld:bound,reserve,manualFlush:true,createInitial:creating,onGrowth:n=>{actual+=n;}});
 const replay=async()=>{const s=empty();for(const sequence of journal.sequences()){const f=parseFact(await journal.read(sequence));await validate(s,f,true);apply(s,f,sequence);}if(!s.format&&!creating)bad('Journal initialization incomplete or damaged: existing gate has no durable format record');for(const c of s.commits)for(const image of Object.values(c.commit.after.images))await verify(image.content);for(const h of s.hydrations.values()){await options.verifySource({importId:h.source.importId,itemId:h.source.itemId,interpretationId:h.source.interpretationId},{digest:h.source.digest,byteLength:h.source.byteLength});await options.verifyNative(copy(h.native));}durable=s;staged=copy(s);};
 // Admission is serialized only through validation/reservation, never through IO
 // completion. Independent facts can occupy one physical durable group.
 let queuedMutations=0,batchAdmitted=0;
 const mutate=<T>(prepare:(s:State)=>Promise<{fact?:Fact;result:T}>):Promise<T>=>{
  if(closing||closed||auditing)return Promise.reject(new ImageProjectStoreError('busy','Journal admission closed'));if(queuedMutations>=64)return Promise.reject(new ImageProjectStoreError('busy','Journal admission queue full'));queuedMutations++;
  const task=admission.then(async()=>{
   if(budgetDirty)throw new ImageProjectStoreError('busy','Journal needs reconciliation','retained');await bound();const p=await prepare(staged);if(!p.fact)return{result:p.result,durable:journal.barrier()};
   await validate(staged,p.fact);const fact=p.fact,sequence=staged.sequence+1;
   // append() reserves bytes before any asynchronous write. No other mutation
   // can observe a staged fact whose admission has already failed.
   const admitted=await journal.admit(fact);if(admitted.sequence!==sequence)bad('Journal/staged sequence differs');const completion=admitted.completion;apply(staged,fact,sequence);
   const done=completion.then(r=>{if(r.sequence!==sequence)bad('Journal admission order changed');apply(durable,fact,sequence);},e=>{budgetDirty=true;throw e;});void done.catch(()=>{});return{result:p.result,durable:done};
  });const admitted=task.finally(()=>{queuedMutations--;if(++batchAdmitted>=16||!queuedMutations){batchAdmitted=0;journal.flushSoon();}});admission=admitted.then(()=>undefined,()=>undefined);return admitted.then(async p=>{await p.durable;return copy(p.result);});
 };
 const read=<T>(f:(s:State)=>T|Promise<T>)=>{if(closing||closed)return Promise.reject(new ImageProjectStoreError('closed','Journal closed'));return Promise.resolve().then(async()=>{await bound();return copy(await f(durable));});};
 const source=(s:SourceImageRef)=>{if(!validSourceImageRef(s))bad('Invalid source reference');return hydrationKey(s);};
 const confirm=(records:readonly ProjectConfirmation[],resolve:boolean)=>{const captured=copy(records) as ProjectConfirmation[];if(!Array.isArray(captured)||!captured.length||captured.length>4)return Promise.reject(new ImageProjectStoreError('invalid-input','Confirmation requires 1..4 records'));return mutate(async s=>({fact:captured.every(r=>s.confirmations.has(r.operationId)&&(!resolve||s.resolutions.has(r.operationId)))?(await validate(s,{kind:'confirmation',records:captured,resolve}),undefined):{kind:'confirmation',records:captured,resolve},result:undefined}));};
 const inputRecord=async(s:State,operationId:string)=>{const i=s.inputs.get(operationId);if(!i)bad('Unknown input');const f=parseFact(await journal.read(i.sequence));if(f.kind!=='input')bad('Input index mismatch');return{intent:operationIntent(f.intent),resolution:copy(s.resolutions.get(operationId)??null)};};
 try{
  dirs.set(hidden,await directory(hidden,true));dirs.set(legacy,await directory(legacy,true));await inventory();
  let gate:unknown;try{gateBytes=await readGate();gate=JSON.parse(gateBytes.toString('utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(gate===undefined){const existing=await fs.readdir(legacy);if(existing.some(n=>n!=='owner.json'&&n!=='writer.lock'))bad('Legacy project evidence requires explicit copy upgrade');for(const leaf of existing){const at=path.join(legacy,leaf),st=await fs.lstat(at);if(!st.isFile()||st.isSymbolicLink()||await fs.realpath(at)!==at||(leaf==='writer.lock'?st.size!==0:st.size>4096))bad('Unsafe lease evidence');}await options.writerAuthority.assertHeld(binding);formatId=randomBytes(16).toString('hex');gate={schema:'flow.project-head',version:GATE_VERSION,writer:'flow.recovery-journal',formatId};const b=bytes(gate),release=await reserve(b.length);const temp=await writeTemporaryFile(legacy,'writer-format',b);try{await fs.link(temp.path,gateFile);await syncDir(legacy);await syncDir(hidden);await syncDir(root);actual+=b.length;release();gateBytes=b;creating=true;}finally{await releaseTemporary(temp);}}
  if(!shape(gate,['schema','version','writer','formatId'])||gate.schema!=='flow.project-head'||gate.version!==GATE_VERSION||gate.writer!=='flow.recovery-journal'||typeof gate.formatId!=='string'||!(/^[a-f0-9]{32}$/).test(gate.formatId))bad('Legacy/unknown project format; no in-place upgrade');formatId=gate.formatId;
  await syncDir(legacy);await syncDir(hidden);await syncDir(root);journal=await open();await inventory();await replay();if(!durable.format)await mutate(async()=>({fact:{kind:'format',formatId},result:undefined}));creating=false;
 }catch(e){await journal!?.close().catch(()=>{});owners.delete(root);throw e;}
 return{
  recordWorkspace:input=>{const record=workspaceRecoveryRecord(input);return mutate(async s=>{const old=s.workspace.get(record.id);if(old){if(old.digest!==sha(bytes(record)))bad('Workspace record ID conflict');return{result:undefined};}return{fact:{kind:'workspace',record},result:undefined};});},
  workspaceRecord:id=>read(async s=>{if(!token(id))bad('Invalid workspace recovery ID');const at=s.workspace.get(id);if(!at)return null;const f=parseFact(await journal.read(at.sequence));if(f.kind!=='workspace')bad('Workspace index changed');return workspaceRecoveryRecord(f.record);}),
  workspaceRecordPage:page=>read(async s=>{
   if(!shape(page,['kinds'],['afterId','maxRecords'])||!Array.isArray(page.kinds)||!page.kinds.length||page.kinds.length>9||new Set(page.kinds).size!==page.kinds.length||page.kinds.some(k=>!['request','requestResolution','capturedInput','capturedEdit','creationBatch','sourceHydration','sourceHydrationResolution','fileIntent','fileResult'].includes(k))||(page.afterId!==undefined&&!token(page.afterId))||(page.maxRecords!==undefined&&(!Number.isSafeInteger(page.maxRecords)||page.maxRecords<1||page.maxRecords>16)))bad('Invalid filtered workspace page');
   const after=page.afterId?s.workspace.get(page.afterId)?.sequence:0;if(after===undefined)bad('Unknown workspace page cursor');const lists=page.kinds.map(kind=>s.workspaceKinds.get(kind)??[]),positions=lists.map(ids=>{let low=0,high=ids.length;while(low<high){const middle=(low+high)>>>1;if(s.workspace.get(ids[middle])!.sequence<=after)low=middle+1;else high=middle;}return low;});const records:WorkspaceRecoveryRecord[]=[];let last:string|null=null;
   while(records.length<(page.maxRecords??16)){let chosen=-1,sequence=Infinity;for(let n=0;n<lists.length;n++){const id=lists[n][positions[n]];if(id&&s.workspace.get(id)!.sequence<sequence){chosen=n;sequence=s.workspace.get(id)!.sequence;}}if(chosen<0)break;const id=lists[chosen][positions[chosen]++],f=parseFact(await journal.read(sequence));if(f.kind!=='workspace')bad('Filtered recovery index changed');records.push(workspaceRecoveryRecord(f.record));last=id;}
   return{records,nextAfterId:lists.some((ids,n)=>positions[n]<ids.length)?last:null};
  }),
  workspaceRecords:(page={})=>read(async s=>{if(!shape(page,[],['afterId','maxRecords'])||(page.afterId!==undefined&&!token(page.afterId))||(page.maxRecords!==undefined&&(!Number.isSafeInteger(page.maxRecords)||page.maxRecords<1||page.maxRecords>16)))bad('Invalid workspace page');const out:WorkspaceRecoveryRecord[]=[];for(const id of [...s.workspace.keys()].sort())if(!page.afterId||id>page.afterId){const f=parseFact(await journal.read(s.workspace.get(id)!.sequence));if(f.kind!=='workspace')bad('Workspace index changed');out.push(workspaceRecoveryRecord(f.record));if(out.length>=(page.maxRecords??16))break;}return out;}),
  load:()=>read(s=>s.commits.at(-1)??null),committed:()=>read(s=>s.commits),
  commit:(expectedHead,input)=>{const record=commitRecord(input);if(expectedHead!==null&&!imageHash(expectedHead))throw new ImageProjectStoreError('invalid-input','Invalid expected head');return mutate(async s=>{const existing=s.byId.get(record.commitId),hash=sha(bytes(record));if(existing){if(existing.commitHash!==hash)bad('Commit ID reused with different content');return{result:existing};}const receipt:ProjectCommitReceipt={commitHash:hash,commit:record,head:{schema:'flow.project-head',version:1,projectId:record.after.id,commitHash:hash}};return{fact:{kind:'commit',expectedHead,record},result:receipt};});},
  unsettled:()=>read(s=>s.commits.filter(c=>c.commit.nativeDecision&&!s.confirmations.has(c.commit.nativeDecision.operationId))),
  decideUnchanged:(commitHash,input)=>{const decision=copy(input);return mutate(async s=>{const old=s.decisions.get(decision.operationId);if(old){if(!old.unchanged||old.commitHash!==commitHash||!same(old.decision,decision))bad('Conflicting project decision');return{result:undefined};}return{fact:{kind:'unchanged',commitHash,decision},result:undefined};});},
  operationDecision:operationId=>read(s=>{if(!token(operationId))bad('Invalid operation identity');return s.decisions.get(operationId)??null;}),
  unsettledDecisions:()=>read(s=>[...s.decisions.values()].filter(d=>!s.confirmations.has(d.decision.operationId))),
  confirmOperations:records=>confirm(records,true),settle:(commitHash,operationId,native)=>confirm([{commitHash,operationId,native}],false),
  hydration:ref=>read(s=>s.hydrations.get(source(ref))??null),
  publishHydration:input=>{const record=hydrationRecord(input),key=hydrationKey(record.source);return mutate(async s=>{const old=s.hydrations.get(key);if(old&&!same(old,record))bad('Hydration interpretation collision');return{fact:old?undefined:{kind:'hydration',record},result:key};});},
  settleHydration:(ref,operationId,native)=>{const s=copy(ref),n=copy(native);return mutate(async state=>{const fact:Fact={kind:'hydrationAccepted',source:s,operationId,native:n};await validate(state,fact);return{fact:state.hydrated.has(source(s))?undefined:fact,result:undefined};});},
  pendingHydrations:()=>read(s=>[...s.hydrations.entries()].filter(([k])=>!s.hydrated.has(k)).map(([,h])=>h)),
  beginOperation:input=>{const intent=operationIntent(input);return mutate(async s=>{const old=s.inputs.get(intent.operationId);if(old){if(old.digest!==sha(bytes(intent)))bad('Operation ID reused with changed original input');return{result:undefined};}return{fact:{kind:'input',intent},result:undefined};});},
  captureRecord:(owner,captureId)=>read(async s=>{if(!token(owner.sessionId)||!token(owner.incarnation)||!Number.isSafeInteger(owner.workspaceEpoch)||owner.workspaceEpoch<0||!token(captureId))bad('Invalid capture identity');const id=s.captures.get(captureKey(owner,{workspaceEpoch:owner.workspaceEpoch,captureId}));return id?inputRecord(s,id):null;}),
  operationRecord:id=>read(s=>{if(!token(id))bad('Invalid operation ID');return s.inputs.has(id)?inputRecord(s,id):null;}),
  pendingOperations:()=>read(async s=>{const out:ImageOperationIntent[]=[];for(const id of s.inputs.keys())if(!s.resolutions.has(id))out.push((await inputRecord(s,id)).intent);return out;}),
  operationRecords:(page:ImageOperationPage={})=>{const p=copy(page);if(!shape(p,[],['afterOperationId','maxRecords'])||(p.afterOperationId!==undefined&&!token(p.afterOperationId))||(p.maxRecords!==undefined&&(!Number.isSafeInteger(p.maxRecords)||p.maxRecords<1||p.maxRecords>16)))return Promise.reject(new ImageProjectStoreError('invalid-input','Invalid input page'));return read(async s=>{const out=[];for(const id of [...s.inputs.keys()].sort())if(!p.afterOperationId||id>p.afterOperationId){out.push(await inputRecord(s,id));if(out.length>=(p.maxRecords??16))break;}return out;});},
  resolveOperation:(operationId,decision,commitHash)=>{const resolution:ImageOperationResolution={schema:'flow.image-edit-resolution',version:1,operationId,decision,commitHash};return mutate(async s=>{await validate(s,{kind:'resolution',resolution});return{fact:s.resolutions.has(operationId)?undefined:{kind:'resolution',resolution},result:undefined};});},
  validateRecovery:async()=>{if(closing||closed||auditing)throw new ImageProjectStoreError('busy','Journal audit closed');auditing=true;try{await admission;await journal.close();await budgetTail;await inventory();reservations=0;budgetDirty=false;verifyRefs.clear();journal=await open();await inventory();await replay();}catch(e){budgetDirty=true;throw e;}finally{auditing=false;}},
  close:()=>{if(closePromise)return closePromise;closing=true;closePromise=(async()=>{await admission;await journal.close();await budgetTail;await bound();closed=true;owners.delete(root);})();return closePromise;}
 };
}
