import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ProjectV2} from '../../../platform/contracts/imageProject.js';
import {namingIssue,orderedOutputNames} from '../../../platform/contracts/flowNaming.js';
import {snapshotImageProject,validNativeImageRef,validSourceImageRef} from '../../../session/core/imageProjectModel.js';
import {createOutputObservation} from '../flowOutputObservation.js';
import {settleOutputFileMove,outputPath} from '../flowOutputMove.js';
import {createOutputTrash,validOutputDeletion,type OutputDeletion} from '../flowOutputTrash.js';
import {assertPhysicalWorkspaceWriterTargets} from '../workspacePhysicalWriterGate.js';
import {createFileExclusive,readBoundFile} from '../persistence/fileOps.js';
import {canonicalUtf8,sha256Hex} from '../persistence/canonicalJson.js';
import {syncDirectory} from '../../../platform/main/platform/index.js';
import type {WorkspaceOutput,WorkspaceOutputFile,WorkspaceOutputFrozen,WorkspaceOutputMetadata,WorkspaceOutputOptions,WorkspaceOutputReceipt,WorkspaceOutputObservation,WorkspaceOutputRefreshReceipt,WorkspaceOutputKeepFlowReceipt} from './workspaceOutputContract.js';
import {validWorkspaceOutputBinding,validWorkspaceOutputMetadataEnvelope,validWorkspaceOutputNameSeed,validWorkspaceOutputFileName,WORKSPACE_OUTPUT_NAME_SEED,type WorkspaceOutputNameSeed} from './workspaceOutputContract.js';
import {validWorkspaceColdCopyReceipt,validWorkspaceColdCopyAuthorization,coldCopyReceipt,type WorkspaceColdCopyReceipt}from'./workspaceColdCopyContract.js';
import {inspectImportSource}from'./sourceStore.js';
import {readImageWorkspaceProject} from './workspaceProbe.js';

const LIMIT=128*1024*1024, JOURNAL_LIMIT=8*1024*1024;
const owners=new Set<string>();
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const token=(v:unknown):v is string=>typeof v==='string'&&/^[\w-]{1,80}$/.test(v);
const leaf=validWorkspaceOutputFileName;
type Identity={dev:string;ino:string};
type Entry=WorkspaceOutputFile&Identity&{content:string;opaque?:true;vacant?:true};
type Move=Identity&{from:string;to:string;digest:string};
type Transaction={operationId:string;storageId?:string;revision:number;commitHash:string;kind:'save'|'append';phase:'preparing'|'deleting'|'staging'|'publishing';
 next:Entry[];stages:Move[];publishes:Move[];deletions:{entry:Entry;intent:OutputDeletion}[];receipt:WorkspaceOutputReceipt};
type CaptureFact={file:string;entry:Entry;byteLength:number;layerCount:number};
type Operation={fingerprint:string;state:'pending'|'completed'|'retained';receipt:WorkspaceOutputReceipt;retryablePreparation?:true;captures?:CaptureFact[]};
type CopyBaseline={receipt:WorkspaceColdCopyReceipt;fromLedgerHash:string;fromRoot:Identity};
type Ledger={schema:'flow.native-output';version:1;projectId:string;root:Identity;seq:number;previousHash:string|null;entries:Entry[];copyBaseline?:CopyBaseline;operationFacts?:Record<string,Operation>;transaction?:Transaction;saved?:{revision:number;commitHash:string};refresh?:{receiptHash:string;revision:number;commitHash:string};nameSeed?:{sha256:string;consumedShotIds:string[]};keepFlowAck?:{receiptHash:string;operationId:string;revision:number;commitHash:string}};

export class WorkspaceOutputError extends Error {
 constructor(readonly code:string,message:string,readonly effect:'none'|'retained'|'unknown'='none'){super(message);}
}
const fail=(message:string):never=>{throw new WorkspaceOutputError('conflict',message,'retained');};
const metadata=(project:ProjectV2,shot:ProjectV2['shots'][number]):WorkspaceOutputMetadata=>({projectName:project.name,shotName:shot.name,scriptText:shot.scriptText,
 dialogues:project.dialogues.filter(d=>d.shotId===shot.id),presentation:shot.presentation??project.presentation??null});
const expectedDigest=(e:Entry)=>e.vacant?null:e.digest;
const baselineNative=(e:Entry)=>e.opaque?null:e.native;
export const workspaceOutputDecisionHash=(receipt:WorkspaceOutputRefreshReceipt|WorkspaceOutputKeepFlowReceipt):string=>sha256Hex(canonicalUtf8(receipt));
const same=(a:unknown,b:unknown)=>sha256Hex(canonicalUtf8(a))===sha256Hex(canonicalUtf8(b));
const publicFile=({shotId,imageId,name,location,digest,native,source,format}:Entry):WorkspaceOutputFile=>({shotId,imageId,name,location,digest,native,...(source?{source}:{}),format});

const relative=(e:Entry)=>`${e.location}/${e.name}`;
const validRelative=(v:unknown):v is string=>typeof v==='string'&&(
  /^operations\/[a-f0-9-]{36}\/(old|new)-\d+\.tif$/.test(v)||/^active\//.test(v)&&leaf(v.slice(7))||/^parked\//.test(v)&&leaf(v.slice(7)));
const validIdentity=(v:Identity)=>v&&/^\d+$/.test(v.dev)&&/^\d+$/.test(v.ino);
 const validEntry=(e:Entry)=>e&&token(e.shotId)&&token(e.imageId)&&leaf(e.name)&&['active','parked'].includes(e.location)&&digest(e.digest)&&digest(e.content)&&validWorkspaceOutputBinding(e)&&e.format==='tiff'&&validIdentity(e)&&(e.opaque===undefined||e.opaque===true)&&(e.vacant===undefined||e.vacant===true)&&(!e.vacant||e.opaque===true);
 const validEntries=(entries:Entry[])=>Array.isArray(entries)&&entries.length<=10000&&entries.every(validEntry)&&new Set(entries.map(e=>e.shotId)).size===entries.length&&new Set(entries.map(e=>e.name.toLowerCase())).size===entries.length;
 const operationIdValid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
 const validReceipt=(r:WorkspaceOutputReceipt,id:string,projectId:string)=>r&&r.operationId===id&&r.projectId===projectId&&Number.isSafeInteger(r.revision)&&r.revision>=0&&digest(r.commitHash)&&Array.isArray(r.files)&&r.files.length<=10000&&r.files.every(e=>e&&token(e.shotId)&&token(e.imageId)&&leaf(e.name)&&['active','parked'].includes(e.location)&&digest(e.digest)&&validWorkspaceOutputBinding(e)&&e.format==='tiff')&&new Set(r.files.map(e=>e.shotId)).size===r.files.length;
async function readOutputLedger(root:string,projectId:string,bind:()=>Promise<void>,registerDirectory:(at:string,identity:Identity)=>void){
 const container=path.join(root,'.storyboard-flow/native-output-v1'),operations=path.join(container,'operations');
 const directory=async(at:string)=>{const st=await fs.lstat(at);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(at)!==at)fail('Unsafe output directory');return st;};
 await directory(container);await directory(operations);
  await bind();let previous:string|null=null,sequence=0,latest:Ledger|undefined;const accepted=new Set<string>();
  const names=(await fs.readdir(container)).filter(n=>n!=='operations').sort();
  for(const name of names){if(!/^\d{12}\.json$/.test(name)||Number(name.slice(0,12))!==sequence+1)fail('Unknown or missing output journal record');
   if((await fs.lstat(path.join(container,name))).nlink!==1)fail('Aliased output journal record');
   const bytes=await readBoundFile(path.join(container,name),JOURNAL_LIMIT);if(!bytes)fail('Output journal disappeared');
   const v=JSON.parse(bytes!.toString()) as Ledger;
   if(v.schema!=='flow.native-output'||v.version!==1||v.projectId!==projectId||v.seq!==sequence+1||v.previousHash!==previous||!validIdentity(v.root)||!validEntries(v.entries)||v.refresh&&(!digest(v.refresh.receiptHash)||!digest(v.refresh.commitHash)||!Number.isSafeInteger(v.refresh.revision)||v.refresh.revision<0)||v.nameSeed&&(!digest(v.nameSeed.sha256)||!Array.isArray(v.nameSeed.consumedShotIds)||v.nameSeed.consumedShotIds.length>10000||!v.nameSeed.consumedShotIds.every(token)||new Set(v.nameSeed.consumedShotIds).size!==v.nameSeed.consumedShotIds.length))fail('Invalid output journal');
   if(v.operationFacts&&(typeof v.operationFacts!=='object'||Array.isArray(v.operationFacts)||Object.entries(v.operationFacts).some(([id,f])=>!operationIdValid(id)||!f||!digest(f.fingerprint)||!['pending','completed','retained'].includes(f.state)||!validReceipt(f.receipt,id,projectId)||f.retryablePreparation!==undefined&&f.retryablePreparation!==true||f.captures!==undefined&&(!Array.isArray(f.captures)||f.captures.length>10000||f.captures.some(c=>!c||!validEntry(c.entry)||!/^operations\/[a-f0-9-]{36}\/new-\d+\.tif$/.test(c.file)||!Number.isSafeInteger(c.byteLength)||c.byteLength<1||c.byteLength>LIMIT||!Number.isSafeInteger(c.layerCount)||c.layerCount<1)))))fail('Invalid output operation facts');
   if(v.keepFlowAck&&(!digest(v.keepFlowAck.receiptHash)||!token(v.keepFlowAck.operationId)||!digest(v.keepFlowAck.commitHash)||!Number.isSafeInteger(v.keepFlowAck.revision)||v.keepFlowAck.revision<0))fail('Invalid keep-Flow physical decision');
   const t=v.transaction;
   if(t){if(t.storageId!==undefined&&!operationIdValid(t.storageId)||!/^[a-f0-9-]{36}$/.test(t.operationId)||!['save','append'].includes(t.kind)||!['preparing','deleting','staging','publishing'].includes(t.phase)||!Number.isSafeInteger(t.revision)||t.revision<0||!digest(t.commitHash)||!validEntries(t.next)||!Array.isArray(t.stages)||!Array.isArray(t.publishes)||!Array.isArray(t.deletions))fail('Invalid output transaction');
    for(const m of [...t.stages,...t.publishes])if(!validRelative(m.from)||!validRelative(m.to)||!digest(m.digest)||!validIdentity(m))fail('Unsafe output move');
    const matches=(m:Move,e:Entry)=>m.digest===e.digest&&m.dev===e.dev&&m.ino===e.ino;
    for(const m of t.stages)if(!m.to.startsWith(`operations/${t.storageId??t.operationId}/old-`)||!v.entries.some(e=>relative(e)===m.from&&matches(m,e)))fail('Unbound output stage');
    for(const m of t.publishes)if(!m.from.startsWith(`operations/${t.storageId??t.operationId}/`)||!t.next.some(e=>relative(e)===m.to&&matches(m,e)))fail('Unbound output publication');
    for(const d of t.deletions)if(!validEntry(d.entry)||!validOutputDeletion(d.intent)||d.intent.digest!==d.entry.digest||d.intent.from!==d.entry.location||!v.entries.some(e=>relative(e)===relative(d.entry)&&e.dev===d.intent.dev&&e.ino===d.intent.ino&&e.digest===d.intent.digest))fail('Invalid output deletion');
    const operationDirectory=path.join(operations,t.storageId??t.operationId);const st=await directory(operationDirectory);registerDirectory(operationDirectory,{dev:String(st.dev),ino:String(st.ino)});
   }
   if(v.operationFacts){for(const fact of Object.values(v.operationFacts))for(const capture of fact.captures??[]){const at=path.dirname(path.join(container,capture.file)),st=await directory(at);registerDirectory(at,{dev:String(st.dev),ino:String(st.ino)});}for(const [id,f] of Object.entries(v.operationFacts)){if(f.state==='pending'&&t?.operationId!==id)fail('Unbound pending output fact');if(t?.operationId===id&&(f.state!=='pending'||!validReceipt(t.receipt,id,projectId)||sha256Hex(canonicalUtf8(t.receipt))!==sha256Hex(canonicalUtf8(f.receipt))))fail('Output transaction receipt differs from operation fact');}}
   if(v.copyBaseline&&(sequence===0||!validWorkspaceColdCopyReceipt(v.copyBaseline.receipt)||!digest(v.copyBaseline.fromLedgerHash)||!validIdentity(v.copyBaseline.fromRoot)||v.copyBaseline.receipt.projectId!==projectId))fail('Invalid copied output baseline');
   if(latest&&(v.root.dev!==latest.root.dev||v.root.ino!==latest.root.ino||v.copyBaseline?.receipt.authorizationSha256!==latest.copyBaseline?.receipt.authorizationSha256)){
    const portable=({seq,previousHash,root,copyBaseline,entries,...rest}:Ledger)=>({...rest,entries:entries.map(({dev,ino,...e})=>e)});const copy=v.copyBaseline;if(sha256Hex(canonicalUtf8(portable(v)))!==sha256Hex(canonicalUtf8(portable(latest)))||!copy||copy.fromLedgerHash!==previous||copy.fromRoot.dev!==latest.root.dev||copy.fromRoot.ino!==latest.root.ino||copy.receipt.previousRoot.dev!==latest.root.dev||copy.receipt.previousRoot.ino!==latest.root.ino||copy.receipt.outputHeadHash!==previous||copy.receipt.outputLedgerSeq!==sequence||copy.receipt.currentRoot.dev!==v.root.dev||copy.receipt.currentRoot.ino!==v.root.ino||v.transaction||latest.transaction||sha256Hex(canonicalUtf8(v.entries.map(({dev,ino,...e})=>e)))!==sha256Hex(canonicalUtf8(latest.entries.map(({dev,ino,...e})=>e)))||sha256Hex(canonicalUtf8(v.entries))!==copy.receipt.filesDigest)fail('Unbound copied output transition');
   }
   if(v.refresh)accepted.add(v.refresh.receiptHash);if(v.keepFlowAck)accepted.add(v.keepFlowAck.receiptHash);latest=v;sequence++;previous=sha256Hex(bytes!);
  }
  await bind();return{ledger:latest,lastHash:previous,accepted};
}

/** Physical output ledger only. It never installs a ProjectV2, advances a Session
 * head, rewrites a native version, or sends V2 through a V1 image writer. */
export async function openWorkspaceOutput(options:WorkspaceOutputOptions):Promise<WorkspaceOutput>{
 const {root,projectId}=options;
 if(!path.isAbsolute(root)||path.normalize(root)!==root||root.includes('\0')||!token(projectId)||!options.writerAuthority?.assertHeld||!options.budget?.reserve||!options.captureImage)
  throw new WorkspaceOutputError('invalid-input','Canonical output root, project and Main capabilities required');
 const rootStat=await fs.lstat(root),binding={path:root,dev:String(rootStat.dev),ino:String(rootStat.ino)};
 if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||await fs.realpath(root)!==root)fail('Aliased output root');
 if(owners.has(root))throw new WorkspaceOutputError('busy','Workspace output already open');
 owners.add(root);
 const hidden=path.join(root,'.storyboard-flow'),container=path.join(hidden,'native-output-v1'),operations=path.join(container,'operations');
 const directories=new Map<string,Identity>();
 type Grant=Awaited<ReturnType<WorkspaceOutputOptions['budget']['reserve']>>;
 const grants=new Map<string,{grant:Grant;file:string;max:number}[]>();
 const hold=async(operationId:string,file:string,bytes:number,purpose:string)=>{const grant=await options.budget.reserve({operationId:operationId+'-'+randomUUID(),bytes,purpose});grants.set(operationId,[...(grants.get(operationId)??[]),{grant,file,max:bytes}]);return grant;};
 const settleGrants=async(operationId?:string)=>{
  for(const [id,items] of grants){if(operationId!==undefined&&id!==operationId)continue;
   for(const item of items){await bind();let actual=0;try{const st=await fs.lstat(item.file);if(!st.isFile()||st.isSymbolicLink()||st.size>item.max)fail('Unknown budgeted output entry');actual=st.size;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}await item.grant.settleActual(actual);}
   grants.delete(id);
  }
 };
 let closed=false,blocked=false,active=0,queue:Promise<unknown>=Promise.resolve(),lastHash:string|null=null;
 let nameSeed:WorkspaceOutputNameSeed|undefined;let accepted=new Set<string>();
 let ledger:Ledger={schema:'flow.native-output',version:1,projectId,root:{dev:binding.dev,ino:binding.ino},seq:0,previousHash:null,entries:[]};
 const directory=async(at:string)=>{const st=await fs.lstat(at);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(at)!==at)fail('Unsafe output directory');return st;};
 const bind=async()=>{
  if(closed)throw new WorkspaceOutputError('closed','Workspace output closed');
  await options.writerAuthority.assertHeld(binding);
  const st=await directory(root);if(String(st.dev)!==binding.dev||String(st.ino)!==binding.ino)fail('Output root identity changed');
  await assertPhysicalWorkspaceWriterTargets([root]);
  for(const [at,identity] of directories){const now=await directory(at);if(String(now.dev)!==identity.dev||String(now.ino)!==identity.ino)fail('Output directory identity changed');}
 };
 const ensure=async(at:string)=>{await bind();try{await fs.mkdir(at,{mode:0o700});await syncDirectory(path.dirname(at));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  const st=await directory(at);directories.set(at,{dev:String(st.dev),ino:String(st.ino)});};
 const observePhysical=createOutputObservation(bind);
 const inspectFile=async(file:string)=>{await bind();let before;try{before=await fs.lstat(file,{bigint:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return{digest:null,identity:null};throw e;}
  if(before.isSymbolicLink())fail('Aliased output file');const value=await observePhysical(file),after=await fs.lstat(file,{bigint:true});
  if(value===null||['dev','ino','size','mtimeNs','ctimeNs'].some(key=>before[key as 'dev']!==after[key as 'dev']))fail('Output changed while binding its identity');
  return{digest:value,identity:{dev:String(after.dev),ino:String(after.ino)}};};
 const observe=async(file:string)=>(await inspectFile(file)).digest;
 const trash=createOutputTrash(root,projectId,rootStat,bind,options.trashItem);
 const persist=async()=>{
  await bind();const next={...ledger,seq:ledger.seq+1,previousHash:lastHash},bytes=canonicalUtf8(next);
  if(bytes.length>JOURNAL_LIMIT)throw new WorkspaceOutputError('resource-limit','Output ledger exceeds 8 MiB');
  const file=path.join(container,`${String(next.seq).padStart(12,'0')}.json`);let grant:Grant;
  try{grant=await options.budget.reserve({operationId:(ledger.transaction?.operationId??'output-journal')+'-'+randomUUID(),bytes:bytes.length,purpose:'native-output-journal'});}catch(e){blocked=true;throw e;}
  try{await bind();await createFileExclusive(file,bytes);await syncDirectory(container);
   ledger=next;lastHash=sha256Hex(bytes);if(next.refresh)accepted.add(next.refresh.receiptHash);if(next.keepFlowAck)accepted.add(next.keepFlowAck.receiptHash);await grant.settleActual(bytes.length);
  }catch(e){blocked=true;grants.set('output-journal',[...(grants.get('output-journal')??[]),{grant,file,max:bytes.length}]);await grant.retainUnknown();throw e;}
 };
 const physical=(relative:string)=>path.join(container,relative);

 const resolve=(v:string)=>v.startsWith('active/')?outputPath(root,v.slice(7),'active'):v.startsWith('parked/')?outputPath(root,v.slice(7),'parked'):physical(v);


 const load=async()=>{
  const loaded=await readOutputLedger(root,projectId,bind,(at,id)=>directories.set(at,id));ledger=loaded.ledger??{schema:'flow.native-output',version:1,projectId,root:{dev:binding.dev,ino:binding.ino},seq:0,previousHash:null,entries:[]};lastHash=loaded.lastHash;accepted=loaded.accepted;blocked=false;
  const receipt=options.writerAuthority.copyReceipt===undefined?undefined:structuredClone(options.writerAuthority.copyReceipt);
  if(ledger.root.dev!==binding.dev||ledger.root.ino!==binding.ino){if(!receipt||!validWorkspaceColdCopyReceipt(receipt)||receipt.outputHeadHash!==lastHash||receipt.previousRoot.dev!==ledger.root.dev||receipt.previousRoot.ino!==ledger.root.ino)fail('Copied output requires an explicit current lease receipt');}
  await syncDirectory(container);await loadNameSeed();
  if(receipt&&ledger.copyBaseline?.receipt.authorizationSha256!==receipt.authorizationSha256&&receipt.outputHeadHash!==null){
   if(!validWorkspaceColdCopyReceipt(receipt)||receipt.projectId!==projectId||receipt.currentRoot.path!==root||receipt.currentRoot.dev!==binding.dev||receipt.currentRoot.ino!==binding.ino||receipt.outputHeadHash!==lastHash||receipt.outputLedgerSeq!==ledger.seq||ledger.transaction||Object.values(ledger.operationFacts??{}).some(f=>f.state==='pending'))fail('Copied output admission no longer matches');
   const authorization=await readBoundFile(path.join(hidden,'image-project-v2',receipt.authorizationFile),16384),original=await readBoundFile(path.join(hidden,'image-project-v2',receipt.previousOwnerFile),16384);
   if(!authorization||sha256Hex(authorization)!==receipt.authorizationSha256||!original||sha256Hex(original)!==receipt.previousOwnerSha256)fail('Copied output admission evidence is missing or changed');const parsed=JSON.parse(authorization!.toString());if(!validWorkspaceColdCopyAuthorization(parsed)||sha256Hex(canonicalUtf8(coldCopyReceipt(parsed)))!==sha256Hex(canonicalUtf8(receipt)))fail('Copied output admission proof differs');
   const project=await readImageWorkspaceProject(root);if(project.plan.identity.id!==projectId||project.genesisCommitHash!==receipt.genesisCommitHash||project.commitHash!==receipt.commitHash)fail('Copied Main project chain changed before output adoption');
   const next:Entry[]=[];for(const entry of ledger.entries){const observed=await inspectFile(outputPath(root,entry.name,entry.location));if(entry.vacant){if(observed.digest!==null)fail('A foreign file appeared in an acknowledged vacant slot');next.push(entry);}else{if(observed.digest!==entry.digest||!observed.identity)fail('Copied output content changed');next.push({...entry,...observed.identity});}}
   if(sha256Hex(canonicalUtf8(next))!==receipt.filesDigest)fail('Copied output files changed since admission');
   await options.fault?.('before-copy-baseline');for(const entry of next){const observed=await inspectFile(outputPath(root,entry.name,entry.location));if(entry.vacant?observed.digest!==null:observed.digest!==entry.digest||observed.identity?.dev!==entry.dev||observed.identity?.ino!==entry.ino)fail('Copied output changed before baseline publication');}const previousRoot=ledger.root,fromLedgerHash=lastHash!;ledger={...ledger,root:{dev:binding.dev,ino:binding.ino},entries:next,copyBaseline:{receipt,fromLedgerHash,fromRoot:previousRoot}};await persist();await options.fault?.('after-copy-baseline');
  }
 };

 const loadNameSeed=async()=>{
  await bind();const file=path.join(root,WORKSPACE_OUTPUT_NAME_SEED),bytes=await readBoundFile(file,JOURNAL_LIMIT);
  if(!bytes){if(ledger.nameSeed)fail('Output naming seed disappeared');nameSeed=undefined;return;}
  const st=await fs.lstat(file);if(st.nlink!==1)fail('Aliased output naming seed');
  const seed:unknown=JSON.parse(bytes.toString()),sha256=sha256Hex(bytes);
  if(!validWorkspaceOutputNameSeed(seed)||seed.projectId!==projectId)fail('Invalid or different-project output naming seed');
  const typed=seed as WorkspaceOutputNameSeed;
  if(ledger.nameSeed?.sha256!==undefined&&ledger.nameSeed.sha256!==sha256||ledger.seq>0&&!ledger.nameSeed)fail('Output naming seed changed after physical ledger creation');
  const completion=await readBoundFile(path.join(hidden,'native-creation-complete.json'),JOURNAL_LIMIT);if(!completion)fail('Output naming seed has no creation completion');
  const proof=JSON.parse(completion!.toString()) as {projectId:string;genesisCommitHash:string;outputNameSeedSha256:string;input:{projectId:string;sourceDigest:string}};
  if(proof.projectId!==projectId||proof.genesisCommitHash!==typed.genesisCommitHash||proof.outputNameSeedSha256!==sha256||proof.input?.projectId!==typed.sourceProjectId||proof.input.sourceDigest!==typed.sourceDigest)fail('Output naming seed does not match creation evidence');
  const read=await readImageWorkspaceProject(root);if(read.plan.identity.id!==projectId||read.genesisCommitHash!==typed.genesisCommitHash)fail('Output naming seed genesis no longer matches');
  nameSeed=typed;ledger.nameSeed??={sha256,consumedShotIds:[]};
 };
 const run=<T>(work:()=>Promise<T>)=>{active++;const result=queue.then(async()=>{try{return await work();}finally{active--;}});queue=result.catch(()=>{});return result;};
 const settle=async()=>{
  await bind();if(blocked)await load();const t=ledger.transaction;if(!t){await settleGrants();return;}
  if(t.phase==='preparing'){
   // No user-visible effect is permitted before the prepared record is durable.
   // Retain private capture bytes after a crash, but never guess missing content.
   if(ledger.operationFacts?.[t.operationId])ledger.operationFacts[t.operationId].state='retained';delete ledger.transaction;await persist();await settleGrants();return;
  }
  if(t.phase==='deleting'){
   for(const d of t.deletions)await trash.settle(d.entry.name,d.intent,persist);
   t.phase='staging';await persist();await options.fault?.('after-deletions');
  }
  if(t.phase==='staging'){
   for(const move of t.stages){await settleOutputFileMove(resolve(move.from),resolve(move.to),move,bind);await options.fault?.('after-stage');}
   t.phase='publishing';await persist();await options.fault?.('before-publish');
  }
  for(const move of t.publishes){
   const target=resolve(move.to);await bind();
   if((await fs.readdir(path.dirname(target))).some(n=>n.toLowerCase()===path.basename(target).toLowerCase()&&n!==path.basename(target)))fail('Case-folded output collision');
   await settleOutputFileMove(resolve(move.from),target,move,bind);await options.fault?.('after-publish');
  }
  for(const e of t.next.filter(e=>t.kind==='save'||t.receipt.files.some(f=>f.shotId===e.shotId))){const at=outputPath(root,e.name,e.location);if(await observe(at)!==e.digest)fail('Published output changed before receipt');const st=await fs.lstat(at);if(String(st.dev)!==e.dev||String(st.ino)!==e.ino)fail('Published output identity changed');}
  ledger.entries=t.next;if(ledger.nameSeed&&nameSeed)ledger.nameSeed.consumedShotIds=[...new Set([...ledger.nameSeed.consumedShotIds,...t.next.filter(f=>nameSeed!.names.some(n=>n.shotId===f.shotId)).map(f=>f.shotId)])];if(t.kind==='save')ledger.saved={revision:t.revision,commitHash:t.commitHash};if(ledger.operationFacts?.[t.operationId])ledger.operationFacts[t.operationId]={...ledger.operationFacts[t.operationId],state:'completed',receipt:t.receipt,retryablePreparation:undefined,captures:undefined};delete ledger.transaction;await persist();await settleGrants();
 };
 const checkProject=(p:ProjectV2)=>{const project=snapshotImageProject(p);if(project.id!==projectId)throw new WorkspaceOutputError('invalid-input','Wrong output project');return project;};
 const plannedNames=(project:ProjectV2,sourceNames?:Readonly<Record<string,string>>,pendingOnly=false)=>{
  const entries=ledger.entries.map(e=>({shotId:e.shotId,name:e.name})),used=new Set(entries.map(e=>e.name.toLowerCase()));
  for(const seed of nameSeed?.names??[])if(!entries.some(e=>e.shotId===seed.shotId)&&!ledger.nameSeed?.consumedShotIds.includes(seed.shotId)&&project.parkedShots.some(s=>s.id===seed.shotId&&s.imageId===seed.imageId)){
   if(used.has(seed.name.toLowerCase()))fail('Seeded Pending output filename collision');entries.push({shotId:seed.shotId,name:seed.name});used.add(seed.name.toLowerCase());
  }
  for(const shot of [...project.shots,...project.parkedShots])if(!entries.some(e=>e.shotId===shot.id)){
   const source=sourceNames?.[shot.id]??shot.id+'.tif';if(!source||source.startsWith('.')||/[\\/\0]/.test(source))throw new WorkspaceOutputError('invalid-input','Unsafe Pending source basename');
   const basis=source.replace(/\.[^.]+$/,'');let candidate=basis+'.tif',n=1;while(used.has(candidate.toLowerCase()))candidate=`${basis}_${++n}.tif`;
   if(!leaf(candidate))throw new WorkspaceOutputError('invalid-input','Unsafe output name');used.add(candidate.toLowerCase());entries.push({shotId:shot.id,name:candidate});
  }
  // Naming depends only on project order and labels; no V1 image value is passed.
  const names=pendingOnly?new Map(entries.map(e=>[e.shotId,e.name])):orderedOutputNames({...project,version:1,images:{}},entries);
  return [...project.shots.map(s=>({shotId:s.id,name:names.get(s.id)!,location:'active' as const})),...project.parkedShots.map(s=>({shotId:s.id,name:names.get(s.id)!,location:'parked' as const}))];
 };
 const publish=async(frozen:WorkspaceOutputFrozen,batch?:{shotIds:readonly string[];sourceNames?:Readonly<Record<string,string>>},requestedId?:string,retryCapture=false)=>{
  await bind();if(blocked)await load();const fingerprint=sha256Hex(canonicalUtf8({frozen,batch:batch??null}));
  if(requestedId!==undefined&&!operationIdValid(requestedId))throw new WorkspaceOutputError('invalid-input','Invalid output operation UUID');
  const prior=requestedId===undefined?undefined:ledger.operationFacts?.[requestedId];
  if(prior&&prior.fingerprint!==fingerprint)throw new WorkspaceOutputError('conflict','Output operation binding changed','retained');
  await settle();
  if(retryCapture&&!prior)throw new WorkspaceOutputError('invalid-input','No retained output capture operation exists');
  if(prior){const known=ledger.operationFacts![requestedId!];if(known.state==='completed')return structuredClone(known.receipt);if(!retryCapture||known.state!=='retained'||known.retryablePreparation!==true)throw new WorkspaceOutputError('operation-retained','Output operation retains preparation evidence; do not replay it','retained');}
  const reusable=structuredClone(prior?.captures??[]);
  const snapshot=structuredClone(frozen),project=checkProject(snapshot.project);
  if(!digest(snapshot.commitHash)||!token(snapshot.owner?.sessionId)||!token(snapshot.owner?.incarnation)||!Number.isSafeInteger(snapshot.owner?.workspaceEpoch)||snapshot.owner.workspaceEpoch<0)throw new WorkspaceOutputError('invalid-input','Invalid frozen output identity');
  if(!batch&&project.naming){const issue=namingIssue(project.name,project.naming);if(issue)throw new WorkspaceOutputError('invalid-input',issue);}
  let shots=[...project.shots,...project.parkedShots];
  if(batch){const ids=new Set(batch.shotIds);if(!ids.size||ids.size!==batch.shotIds.length||ids.size>10000||[...ids].some(id=>!project.parkedShots.some(s=>s.id===id)||ledger.entries.some(e=>e.shotId===id)))throw new WorkspaceOutputError('invalid-input','Append accepts only new Pending shots');shots=project.parkedShots.filter(s=>ids.has(s.id));}
  const names=plannedNames(project,batch?.sourceNames,!!batch).filter(n=>shots.some(s=>s.id===n.shotId));
  const removals=batch?[]:ledger.entries.filter(e=>!shots.some(s=>s.id===e.shotId));
  // Verify all existing files before any capture, Trash dispatch or rename.
  for(const e of batch?[]:ledger.entries){if(await observe(outputPath(root,e.name,e.location))!==expectedDigest(e))fail('External output change requires Refresh');if(!e.vacant){const st=await fs.lstat(outputPath(root,e.name,e.location));if(String(st.dev)!==e.dev||String(st.ino)!==e.ino)fail('Output identity changed');}}
  const allowed=new Set((batch?[]:ledger.entries).map(e=>`${e.location}/${e.name}`));
  if(new Set(names.map(n=>n.name.toLowerCase())).size!==names.length)fail('Duplicate output names');
  await ensure(path.join(root,'Pending'));
  for(const n of names){if(!leaf(n.name))fail('Unsafe output name');const dir=n.location==='active'?root:path.join(root,'Pending');
   for(const found of await fs.readdir(dir))if(found.toLowerCase()===n.name.toLowerCase()&&!allowed.has(`${n.location}/${found}`))fail(`Foreign output filename collision: ${n.name}`);
  }
  const resolved=shots.map(shot=>{const value=snapshot.resolvedImages?.[shot.imageId],binding=project.images[shot.imageId].content;if(!value||!validWorkspaceOutputBinding(value)||value.format!=='tiff'||(value.native===null?(binding.kind!=='source'||value.source.interpretationId!=='photocraft-v1'||!same(binding.source,value.source)||!options.sourceCustody||!options.captureSource):(binding.kind==='native'&&!same(binding.native,value.native))))throw new WorkspaceOutputError('unsupported','Ordinary Save requires matching settled native references and TIFF output');const text=metadata(project,shot);if(!validWorkspaceOutputMetadataEnvelope({schema:'flow.native-output-metadata',version:2,projectId,revision:project.revision,shotId:shot.id,imageId:shot.imageId,metadata:text}))throw new WorkspaceOutputError('resource-limit','Native output metadata exceeds its supported envelope');return{shot,value,metadata:text};});
  const operationId=requestedId??randomUUID(),storageId=retryCapture?randomUUID():operationId,dir=path.join(operations,storageId);await ensure(dir);
  const receipt:WorkspaceOutputReceipt={operationId,projectId,revision:project.revision,commitHash:snapshot.commitHash,files:[]};
  const t:Transaction={operationId,storageId,revision:project.revision,commitHash:snapshot.commitHash,kind:batch?'append':'save',phase:'preparing',next:batch?[...ledger.entries]:[],stages:[],publishes:[],deletions:[],receipt};
  ledger.operationFacts??={};ledger.operationFacts[operationId]={fingerprint,state:'pending',receipt,retryablePreparation:true,captures:reusable};ledger.transaction=t;await persist();
  try{
   for(let i=0;i<resolved.length;i++){
    const {shot,value,metadata}=resolved[i],name=names.find(n=>n.shotId===shot.id)!;
    const content=sha256Hex(canonicalUtf8({imageId:shot.imageId,native:value.native,...(value.source?{source:value.source}:{}),format:value.format,metadata})),old=ledger.entries.find(e=>e.shotId===shot.id);
    const sourceObject=value.native===null?await options.sourceCustody!.object(value.source,{verify:'full'}):undefined;
    let next:Entry,source:string;
    if(old&&old.content===content){next={...old,...name};source=relative(old);}
    else{
     const previous=reusable.find(c=>c.entry.shotId===shot.id&&c.entry.imageId===shot.imageId&&c.entry.content===content);
     let capture:Awaited<ReturnType<WorkspaceOutputOptions['captureImage']>>;
     if(previous){const observed=await inspectFile(physical(previous.file));if(observed.digest!==previous.entry.digest||!same(observed.identity,{dev:previous.entry.dev,ino:previous.entry.ino}))fail('Retained output capture changed or disappeared');const bytes=await readBoundFile(physical(previous.file),LIMIT);if(!bytes||bytes.length!==previous.byteLength||sha256Hex(bytes)!==previous.entry.digest)fail('Retained output capture digest differs');const after=await inspectFile(physical(previous.file));if(!same(observed,after))fail('Retained output capture changed while reading');capture={bytes:bytes!,sha256:previous.entry.digest,layerCount:previous.layerCount};}
     else if(value.native===null){
      const object=sourceObject!;
      capture=await options.captureSource!({owner:snapshot.owner,commitHash:snapshot.commitHash,projectId,revision:project.revision,shotId:shot.id,imageId:shot.imageId,source:value.source,object,metadata});
      const after=await options.sourceCustody!.object(value.source,{verify:'full'});if(!same(object,after))fail('Source changed during readonly output');
     }else capture=await options.captureImage({owner:snapshot.owner,commitHash:snapshot.commitHash,projectId,revision:project.revision,shotId:shot.id,imageId:shot.imageId,native:value.native,format:value.format,metadata});
     if(!(capture.bytes instanceof Uint8Array)||capture.bytes.length===0||capture.bytes.length>LIMIT||!digest(capture.sha256)||sha256Hex(capture.bytes)!==capture.sha256||!Number.isSafeInteger(capture.layerCount)||capture.layerCount<1)fail('Invalid native output capture receipt');
     source=`operations/${storageId}/new-${i}.tif`;const grant=await hold(operationId,physical(source),capture.bytes.length,'native-output-capture');
     try{await bind();const owned=await createFileExclusive(physical(source),capture.bytes);await syncDirectory(dir);
      next={...name,imageId:shot.imageId,native:value.native,...(value.source?{source:value.source}:{}),format:value.format,digest:capture.sha256,content,dev:owned.dev,ino:owned.ino};
      const facts=ledger.operationFacts![operationId];facts.captures=[...(facts.captures??[]).filter(c=>c.entry.shotId!==shot.id),{file:source,entry:next,byteLength:capture.bytes.length,layerCount:capture.layerCount}];await persist();
     }catch(e){await grant.retainUnknown();throw e;}
    }
    if(old&&!old.vacant&&(old.content!==content||relative(old)!==relative(next))){const st=await fs.lstat(outputPath(root,old.name,old.location));
     const backup=`operations/${storageId}/old-${i}.tif`;await hold(operationId,physical(backup),st.size,'native-output-backup');t.stages.push({from:relative(old),to:backup,digest:old.digest,dev:String(st.dev),ino:String(st.ino)});
     if(old.content===content)source=backup;
    }
    if(!old||old.content!==content||relative(old)!==relative(next))t.publishes.push({from:source,to:relative(next),digest:next.digest,dev:next.dev,ino:next.ino});
    t.next.push(next);receipt.files.push(publicFile(next));
   }
   for(const entry of removals.filter(e=>!e.vacant)){const intent=await trash.prepare(entry.name,entry.location,entry.digest),st=await fs.lstat(outputPath(root,entry.name,entry.location));await hold(operationId,path.join(hidden,'deletions',intent.token,entry.name),st.size,'native-output-trash');t.deletions.push({entry,intent});}
   t.phase='deleting';await persist();await options.fault?.('after-prepared');await settle();return structuredClone(receipt);
  }catch(e){
   if(t.phase==='preparing'&&!blocked){ledger.operationFacts![operationId].state='retained';delete ledger.transaction;try{await persist();await settleGrants(operationId);}catch{blocked=true;}}
   if(ledger.transaction||blocked)for(const items of grants.values())for(const item of items)await item.grant.retainUnknown();
   throw new WorkspaceOutputError('output-failed',e instanceof Error?e.message:String(e),ledger.transaction||blocked?'unknown':'retained');
  }
 };
 const checkObservation=(change:WorkspaceOutputObservation,repeated=false)=>{
  const entry=ledger.entries.find(e=>e.shotId===change?.shotId);
  if(!entry||entry.imageId!==change.imageId||entry.name!==change.name||entry.location!==change.location||(change.expectedDigest!==null&&!digest(change.expectedDigest))||(change.observedDigest!==null&&!digest(change.observedDigest))||(change.observedDigest===null?change.observedIdentity!==null:!validIdentity(change.observedIdentity!))||(change.baselineNative!==null&&!validNativeImageRef(change.baselineNative))||expectedDigest(entry)!==(repeated?change.observedDigest:change.expectedDigest)||!repeated&&!same(baselineNative(entry),change.baselineNative))fail('Output observation baseline no longer matches');return entry!;
 };
 const checkObservedFile=async(change:WorkspaceOutputObservation)=>{const observed=await inspectFile(outputPath(root,change.name,change.location));if(observed.digest!==change.observedDigest||!same(observed.identity,change.observedIdentity))fail('Observed external file changed or was replaced');return observed;};
 try{
  await bind();await ensure(hidden);await ensure(container);await ensure(operations);await load();
  return{
   names(project){const snapshot=structuredClone(project);return run(async()=>{await bind();return plannedNames(checkProject(snapshot));});},
   inspect(project,selection){const snapshot=structuredClone(project),requested=structuredClone(selection);return run(async()=>{await bind();const p=checkProject(snapshot),shots=[...p.shots,...p.parkedShots],ids=new Set(shots.map(s=>s.id)),changes=[];
    if(requested!==undefined&&(requested===null||typeof requested!=='object'||Array.isArray(requested)||Object.keys(requested).some(k=>k!=='includeShotIds')||requested.includeShotIds!==undefined&&(!Array.isArray(requested.includeShotIds)||requested.includeShotIds.length>10000||new Set(requested.includeShotIds).size!==requested.includeShotIds.length||Array.from(requested.includeShotIds).some(id=>!token(id)||!shots.some(s=>s.id===id&&ledger.entries.some(e=>e.shotId===id&&e.imageId===s.imageId))))))throw new WorkspaceOutputError('invalid-input','Forced observations require distinct live managed shot IDs');
    const include=new Set(requested?.includeShotIds??[]);
    if(ledger.transaction||blocked)throw new WorkspaceOutputError('recovery-pending','Recover output before inspecting external changes','retained');
    for(const e of ledger.entries.filter(e=>ids.has(e.shotId))){const file=outputPath(root,e.name,e.location),observed=await inspectFile(file);if(include.has(e.shotId)||observed.digest!==expectedDigest(e)||observed.identity&&(observed.identity.dev!==e.dev||observed.identity.ino!==e.ino))changes.push({shotId:e.shotId,imageId:e.imageId,name:e.name,location:e.location,baselineNative:structuredClone(baselineNative(e)),expectedDigest:expectedDigest(e),observedDigest:observed.digest,observedIdentity:observed.identity});}return changes;});},
   observeSource(observation,selection){const change=structuredClone(observation),itemId=selection?.itemId??(/^[A-Za-z0-9]/.test(change.shotId)?change.shotId:'observed-'+change.shotId);return run(async()=>{await bind();if(ledger.transaction||blocked)throw new WorkspaceOutputError('recovery-pending','Recover output before retaining an observation','retained');checkObservation(change);if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(itemId)||change.observedDigest===null||!change.observedIdentity)throw new WorkspaceOutputError('invalid-input','A present observed file and valid source item ID required');const file=outputPath(root,change.name,change.location),before=await inspectImportSource(file);await checkObservedFile(change);const after=await inspectImportSource(file);if(!same(before,after)||after.dev!==change.observedIdentity.dev||after.ino!==change.observedIdentity.ino)fail('Observed source changed while binding its complete identity');return{id:itemId,sourcePath:file,formatHint:'tiff',expected:after};});},
   save(frozen,operation){const snapshot=structuredClone(frozen),id=operation?.operationId;return run(()=>publish(snapshot,undefined,id));},
   appendPendingBatch(frozen,batch,operation){const snapshot=structuredClone(frozen),selection=structuredClone(batch),id=operation?.operationId;return run(()=>publish(snapshot,selection,id));},
   retryRetainedCapture(frozen,batch,operation){const snapshot=structuredClone(frozen),selection=batch===undefined?undefined:structuredClone(batch),id=operation?.operationId,settled=operation?.readonlyCaptureSettled;return run(async()=>{if(settled!==true||!operationIdValid(id))throw new WorkspaceOutputError('invalid-input','Explicit settled readonly capture and original operation UUID required');return publish(snapshot,selection,id,true);});},
   queryOperation(operationId){return run(async()=>{await bind();if(blocked)await load();if(!operationIdValid(operationId))throw new WorkspaceOutputError('invalid-input','Invalid output operation UUID');const known=ledger.operationFacts?.[operationId];if(!known)return{state:'absent' as const};if(known.state==='completed')return{state:'completed' as const,receipt:structuredClone(known.receipt)};return{state:known.state};});},
   queryRefreshReceipt(receiptHash){return run(async()=>{await bind();if(blocked)await load();if(!digest(receiptHash))throw new WorkspaceOutputError('invalid-input','Invalid physical decision hash');return accepted.has(receiptHash)?'accepted' as const:'absent' as const;});},
   acceptRefresh(receipt){const input=structuredClone(receipt);return run(async()=>{
    await settle();if(input.projectId!==projectId||!Number.isSafeInteger(input.revision)||input.revision<0||!digest(input.commitHash)||!Array.isArray(input.changes)||!input.changes.length||input.changes.length>10000||new Set(input.changes.map(c=>c.shotId)).size!==input.changes.length)throw new WorkspaceOutputError('invalid-input','Invalid Main Refresh receipt');
    const receiptHash=sha256Hex(canonicalUtf8(input)),repeated=ledger.refresh?.receiptHash===receiptHash,next=[...ledger.entries];
    for(const change of input.changes){
     const index=next.findIndex(e=>e.shotId===change.shotId),entry=next[index];
     if(!entry||entry.imageId!==change.imageId||entry.location!==change.location||entry.name!==change.name||change.expectedDigest!==null&&!digest(change.expectedDigest)||!digest(change.observedDigest)||!validIdentity(change.observedIdentity)||!validNativeImageRef(change.native)||change.format!=='tiff'||change.baselineNative!==undefined&&!repeated&&!same(change.baselineNative,baselineNative(entry))||expectedDigest(entry)!==(repeated?change.observedDigest:change.expectedDigest))fail('Refresh baseline no longer matches');
     const file=outputPath(root,entry.name,entry.location),observed=await inspectFile(file);if(observed.digest!==change.observedDigest||!observed.identity)fail('External output changed during Refresh acceptance');if(observed.identity!.dev!==change.observedIdentity.dev||observed.identity!.ino!==change.observedIdentity.ino)fail('External output identity changed during Refresh acceptance');
     // A Refresh baseline is deliberately not the project content fingerprint:
     // the next Save must overlay authoritative text onto its native candidate.
     const{opaque,vacant,...old}=entry;delete old.source;next[index]={...old,digest:change.observedDigest,native:change.native,...observed.identity,content:sha256Hex(canonicalUtf8({refresh:receiptHash,shotId:entry.shotId}))};
    }
    await options.fault?.('before-refresh-ack');for(const change of input.changes)await checkObservedFile({...change,baselineNative:change.baselineNative??null});
    if(!repeated){ledger={...ledger,entries:next,refresh:{receiptHash,revision:input.revision,commitHash:input.commitHash}};await persist();}
   });},
   acceptKeepFlow(receipt,custody){const input=structuredClone(receipt);return run(async()=>{
    await settle();if(input.projectId!==projectId||!token(input.operationId)||!Number.isSafeInteger(input.revision)||input.revision<0||!digest(input.commitHash)||!Array.isArray(input.changes)||!input.changes.length||input.changes.length>10000||new Set(input.changes.map(c=>c.shotId)).size!==input.changes.length)throw new WorkspaceOutputError('invalid-input','Invalid Main keep-Flow decision');
    const receiptHash=sha256Hex(canonicalUtf8(input)),repeated=ledger.keepFlowAck?.receiptHash===receiptHash,next=[...ledger.entries];if(ledger.keepFlowAck?.operationId===input.operationId&&!repeated)fail('Keep-Flow operation binding changed');
    for(const change of input.changes){const entry=checkObservation(change,repeated),index=next.findIndex(e=>e.shotId===entry.shotId);await checkObservedFile(change);
     if(change.observedDigest!==null){const proof=change.retainedSource;if(!proof||!custody||!validSourceImageRef(proof.source)||proof.digest!==change.observedDigest||!Number.isSafeInteger(proof.byteLength)||proof.byteLength<0)fail('Keep-Flow requires verified custody of the external bytes');const object=await custody!.object(proof!.source,{verify:'full'});if(object.digest!==change.observedDigest||object.digest!==proof!.digest||object.byteLength!==proof!.byteLength)fail('Keep-Flow external custody digest or length differs');await checkObservedFile(change);next[index]={...entry,digest:change.observedDigest,...change.observedIdentity!,opaque:true,content:sha256Hex(canonicalUtf8({keepFlow:receiptHash,shotId:entry.shotId}))};delete next[index].vacant;
     }else{if(change.retainedSource!==undefined)fail('Missing-file choice cannot claim external source bytes');next[index]={...entry,opaque:true,vacant:true,content:sha256Hex(canonicalUtf8({keepFlowMissing:receiptHash,shotId:entry.shotId}))};}
    }
    await options.fault?.('before-keep-flow-ack');for(const change of input.changes)await checkObservedFile(change);if(!repeated){ledger={...ledger,entries:next,keepFlowAck:{receiptHash,operationId:input.operationId,revision:input.revision,commitHash:input.commitHash}};await persist();await options.fault?.('after-keep-flow-ack');}
   });},
   recover(){return run(settle);},
   hasObligations(){return active>0||blocked||!!ledger.transaction||grants.size>0||trash.hasPendingAcknowledgements();},
   close(){return run(async()=>{if(closed)return;await bind();if(blocked||ledger.transaction||grants.size>0||trash.hasPendingAcknowledgements())throw new WorkspaceOutputError('recovery-pending','Output obligations prevent close','retained');closed=true;owners.delete(root);});}
  };
 }catch(e){owners.delete(root);throw e;}
}

/** Read-only evidence for the explicit Main cold-copy lease authorization. */
export async function inspectWorkspaceOutputColdCopy(root:string,projectId:string,previousRoot:Identity){
 const st=await fs.lstat(root,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(root)!==root)fail('Unsafe copied output root');
 const bind=async()=>{const now=await fs.lstat(root,{bigint:true});if(now.dev!==st.dev||now.ino!==st.ino||!now.isDirectory()||now.isSymbolicLink())fail('Copied output root changed');};
 let loaded;try{loaded=await readOutputLedger(root,projectId,bind,()=>{});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT'){const container=path.join(root,'.storyboard-flow/native-output-v1');try{await fs.lstat(container);}catch(missing){if((missing as NodeJS.ErrnoException).code==='ENOENT')return{outputHeadHash:null,outputLedgerSeq:0,filesDigest:sha256Hex(canonicalUtf8([]))};} }throw e;}
 const ledger=loaded.ledger;if(!ledger&&(await fs.readdir(path.join(root,'.storyboard-flow/native-output-v1/operations'))).length)fail('Output history is missing while operation evidence remains');if(!ledger)return{outputHeadHash:null,outputLedgerSeq:0,filesDigest:sha256Hex(canonicalUtf8([]))};
 if(ledger.root.dev!==previousRoot.dev||ledger.root.ino!==previousRoot.ino||ledger.transaction||Object.values(ledger.operationFacts??{}).some(f=>f.state==='pending'))fail('Copied output contains unsettled or foreign operations');
 const observe=createOutputObservation(bind),entries:Entry[]=[];
 for(const e of ledger.entries){const file=outputPath(root,e.name,e.location);if(e.vacant){try{await fs.lstat(file);fail('A foreign file appeared in an acknowledged vacant slot');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}entries.push(e);continue;}const before=await fs.lstat(file,{bigint:true}),value=await observe(file),after=await fs.lstat(file,{bigint:true});if(value!==e.digest||['dev','ino','size','mtimeNs','ctimeNs'].some(k=>before[k as 'dev']!==after[k as 'dev']))fail('Copied managed output is missing or changed');entries.push({...e,dev:String(after.dev),ino:String(after.ino)});}
 await bind();return{outputHeadHash:loaded.lastHash,outputLedgerSeq:ledger.seq,filesDigest:sha256Hex(canonicalUtf8(entries))};
}
