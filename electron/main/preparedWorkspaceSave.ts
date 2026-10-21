import fs from 'node:fs/promises';
import { readSnapshotFile } from './snapshotFileRead.js';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession.js';
import sharp from 'sharp';
import type { IpcMainInvokeEvent } from 'electron';
import { type RecoveryBudget, type RecoveryOffer } from './workspaceRecoveryStore.js';
import { createWorkspaceRecoveryPartitions } from './workspaceRecoveryPartitions.js';
import { intersectRecoveryPolicies } from './recoveryPolicyPartition.js';
import { scanRecoveryWorkspace } from './recoveryWorkspaceAccounting.js';
import type { OriginWorkspaceAccounting, ReservationFailureHandler, ReservationPhysicalControl } from './originWorkspaceAccounting.js';
import { isDeepStrictEqual } from 'node:util';
import { createControlledMemoryBudget, withControlledMemory, copyControlledBuffer, decodeControlledBase64, parseControlledJSON, cloneControlled, stringifyControlledJSON, encodeControlledUTF8, type ControlledMemoryBudget, type MemoryPressurePolicy } from './controlledMemory.js';
import type { JSONResourceLimits } from './jsonMemoryResources.js';
import { serializeStoryboardScriptMarkdown } from './storyboardScript.js';
import { withLayerFileOperation as serializedLayerOperation } from './layerFileOperationQueue.js';
import { assertPhysicalWorkspaceWriterTargets, installWorkspaceRetirementPredicate } from './workspacePhysicalWriterGate.js';
import { withWorkspaceInitialization } from './workspaceInitialization.js';
import { recoveryProjectAbsence as normalizeRecoveryProjectAbsence } from '../shared/recoveryProjectAbsence.js';
import { classifyPendingBakeEnvelope } from '../shared/pendingBakeRules.js';
import { withProducerPngEffects, type ProducerPngReceipt } from './producerPngEffects.js';
import { observeLayerFileOperations } from './layerFileEffectObservation.js';
import { withDerivedPreviewReceipt, type DerivedPreviewReceipt } from './derivedPreviewReceipt.js';
import { writeLayerPng, deleteLayerPng } from './layerAssetService.js';
import { inspectHistoryAbsenceParents } from './historyAbsencePolicy.js';
import { ProtectedLayerWriteError, planProtectedPngWrite } from './protectedLayerFileWriter.js';
import { readCommittedLayerBytes } from './committedLayerBytes.js';
import { hasOriginalOwnedStageProvenance } from './ownedStagePublication.js';
import type { createOriginEnrollment, OriginCapture } from './originEnrollment.js';
import { recoveryPolicyKey } from './recoveryPolicyPartition.js';
import { withImportFailureEvidence, type ImportFailureEvidence } from './importPreparation.js';

type Event = Pick<IpcMainInvokeEvent,'sender'|'senderFrame'>;
const recoveryProjectAbsence = (raw: unknown) => normalizeRecoveryProjectAbsence(raw, cloneControlled);
type Options = {budget?:RecoveryBudget;memoryBudget?:ControlledMemoryBudget;memoryBudgetBytes?:number;memoryPressure?:MemoryPressurePolicy;memoryJSON?:JSONResourceLimits;python:string;script:string;accounting?:OriginWorkspaceAccounting;originEnrollment?:ReturnType<typeof createOriginEnrollment>;ownerFromSender?:(sender:Event["sender"])=>object|undefined};
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const identity=async(file:string)=>{const s=await fs.lstat(file,{bigint:true});if(s.isSymbolicLink()||(!s.isDirectory()&&(!s.isFile()||s.nlink!==1n)))throw new Error('Unsupported physical identity');return `${s.dev}:${s.ino}`;};

/** Finite ordinary-owned, single-layer Save domain. No command replay, GC or
 * ordinary writer unlock. All unsupported producer branches refuse before stage. */
export const createPreparedWorkspaceSave=(options:Options)=>{
 if(options.memoryBudget&&options.memoryBudgetBytes!==undefined)throw new Error('One Main memory budget must not be declared twice');
 if((options.memoryPressure||options.memoryJSON)&&!options.memoryBudget&&options.memoryBudgetBytes===undefined)throw new Error('Memory resource policy requires an independent backing budget');
 const memoryBudget=options.memoryBudget??(options.memoryBudgetBytes===undefined?undefined:createControlledMemoryBudget(options.memoryBudgetBytes,options.memoryPressure?{policy:options.memoryPressure}:undefined,options.memoryJSON));
 const configured=()=>{const b=options.budget;if(!b||Object.keys(b).sort().join(',')!=='assets,bytes,jsonDepth,records'||!Object.values(b).every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('Explicit finite recovery limits required');return b;};
 const nativeSession=createNativeAuthorizationSession(options.python,options.script,()=>configured().bytes);
 const withLayerFileOperation=<T,>(run:()=>Promise<T>)=>serializedLayerOperation(()=>options.accounting?options.accounting.run(()=>nativeSession.run(run)):nativeSession.run(run));
 const accounting=options.accounting??scanRecoveryWorkspace;
 const native=async(request:any):Promise<any>=>{
  if(process.platform!=='darwin')throw new Error('Windows recovery unfinished');
  return nativeSession.request({...request,sourceByteLimit:configured().bytes});
 };
 const storeFor=(sourcePolicy:any)=>createWorkspaceRecoveryPartitions({budget:configured(),sourcePolicy,allowUnsealedStart:sourcePolicy!==undefined,accounting,authorize:async request=>{await native(request);}});
 const hasRecovery=async(root:string)=>{for(const name of ['workspace-recovery-v1','workspace-recovery-v2']){try{await fs.lstat(path.join(root,'.storyboard-workbench',name));return true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}return false;};
 const current=(e:Event)=>{if(!e.sender||e.senderFrame!==e.sender.mainFrame)throw new Error('Current top-frame caller required');};
 const documents=new WeakMap<object,object>();
 const documentFor=(e:Event)=>{current(e);let d=documents.get(e.sender);if(!d){d={};documents.set(e.sender,d);}return d;};
 type Lease={sender:object;frame:object;window:object;document:object;root:string;rootIdentity:string;parentIdentity:string;nonce:string;p1:string;stage:'prepared'|'executing'|'failed'|'output'|'persisted'|'completed';sourcePolicy:any;sourceAuthorityPolicy?:any;offer:RecoveryOffer;facts:unknown;result?:any;latestSeal?:string};
 const leases=new Map<string,Lease>();
 const liveStores=new WeakMap<Lease,ReturnType<typeof storeFor>>();
 const readerLeases=new WeakMap<Lease,object>();
 // An absent metadata parent is a pinned absence, not permission to accept a
 // later arbitrary parent. Only the original admitted reader/producer may bind it.
 type Preservation={operation:string;project:any;offer:RecoveryOffer;files:Map<string,Buffer>;parents:Map<string,string>;sourcePolicy:any};
 type Observation={binding:string;sender:object;frame:object;window:object;document:object;folderPath:string;metadataPath:string;rootIdentity:string;parentIdentity:string|null;facts:any[];project?:any;preservation?:Preservation;preservationError?:string;derived?:{receipt:DerivedPreviewReceipt;policy:any;seal:string};memory?:{capture:any;files:Map<string,Buffer>;sourcePolicy:any}};
 const parentIdentityFor=async(root:string)=>{try{const parent=path.join(root,'.storyboard-workbench');if(!(await fs.lstat(parent)).isDirectory())throw new Error('Workspace metadata parent is not a directory');return await identity(parent);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return null;}};
 const authenticObservation=async(e:Event,o:Observation)=>{current(e);if(o.sender!==e.sender||o.frame!==e.senderFrame||o.window!==(options.ownerFromSender?.(e.sender)??e.sender)||o.document!==documentFor(e)||o.rootIdentity!==await identity(o.folderPath)||o.parentIdentity!==await parentIdentityFor(o.folderPath))throw new Error('Observed workspace incarnation changed');};
 const observations=new Map<string,Observation>();
 // A replacement document (renderer reload) may take over a workspace only when
 // the previous document left no FAILURE evidence. Normal working state (pinned
 // layer sources, a memory capture) belongs to the dead document and is unusable
 // by the new one anyway, so it must not keep the user locked out; a failed or
 // unsettled-failure fact is protection evidence and keeps the original refusal.
 const staleHoldsEvidence=(o:Observation)=>(o.facts as any[]).some(f=>f.state==='failed'||!!f.error||!!f.settlementError);
 const observeWorkspace=async(e:Event,input:string)=>withLayerFileOperation(async()=>{
  current(e);if(typeof input!=='string'||!path.isAbsolute(input)||input.includes('\0'))throw new Error('Absolute workspace observation required');
  const root=await fs.realpath(input),rootIdentity=await identity(root),parentIdentity=await parentIdentityFor(root);
  if(!(await fs.lstat(root)).isDirectory())throw new Error('Workspace Root is not a directory');
  const window=options.ownerFromSender?.(e.sender)??e.sender;if(!window)throw new Error('Actual observation window unavailable');
  const document=documentFor(e);
  for(const old of observations.values())if(old.sender===e.sender&&old.folderPath===root){
   if(old.document===document){
    if(old.frame!==e.senderFrame||old.window!==window||old.rootIdentity!==rootIdentity||old.parentIdentity!==parentIdentity)throw new Error('Observed workspace incarnation changed');
    return {binding:old.binding,folderPath:old.folderPath,metadataPath:old.metadataPath};
   }
   // Previous document: refuse only while it still holds protection evidence.
   if(old.frame!==e.senderFrame||old.window!==window||staleHoldsEvidence(old))throw new Error('Observed workspace incarnation changed');
  }
  const l=leases.get(root);
  if(l){if(l.document===document)await authentic(e,l);else if(l.stage!=='completed')throw new Error('Observed workspace incarnation changed');}
  const o:Observation={binding:randomUUID(),sender:e.sender,frame:e.senderFrame!,window,document,folderPath:root,metadataPath:path.join(root,'.storyboard-workbench/storyboard.project.json'),rootIdentity,parentIdentity,facts:[]};observations.set(o.binding,o);
  return {binding:o.binding,folderPath:o.folderPath,metadataPath:o.metadataPath};
 });
 const authentic=async(e:Event,l:Lease)=>{current(e);if(e.sender!==l.sender||e.senderFrame!==l.frame||(options.ownerFromSender&&options.ownerFromSender(e.sender)!==l.window)||documentFor(e)!==l.document||await identity(l.root)!==l.rootIdentity||await identity(path.join(l.root,'.storyboard-workbench'))!==l.parentIdentity)throw new Error('Save capability caller/document/physical binding mismatch');};
 const canonicalPath=async(root:string,file:string)=>{
  if(!path.isAbsolute(file)||file!==path.normalize(file)||!file.startsWith(root+path.sep)||file.includes('\0'))throw new Error('Save dependency outside physical root');
  let cursor=file;
  for(;;){try{await fs.lstat(cursor);break;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;cursor=path.dirname(cursor);}}
  if(await fs.realpath(cursor)!==cursor)throw new Error('Save path alias refused');
  await identity(cursor);
 };
 const readExact=async(file:string)=>readSnapshotFile(file,configured().bytes);
 const dependencyShots=(p:any,deleted:any[]=[])=>[...p.shots,...(p.parkedShots??[]),...deleted];
 const survivingShots=(p:any)=>[...p.shots,...(p.parkedShots??[])];
 const supported=(p:any)=>{
  if(!p||!Array.isArray(p.shots)||p.parkedShots!==undefined&&!Array.isArray(p.parkedShots)||p.pendingDeletedShots!==undefined&&!Array.isArray(p.pendingDeletedShots))throw new Error('Malformed finite shot lifecycle');
  const shots=dependencyShots(p);
  if(shots.length>configured().assets)throw new Error('Finite shot lifecycle asset budget exceeded');
  const pending=p.pendingDeletedShots??[];
  if(shots.length+pending.length>configured().assets||pending.some((s:any)=>!s||!/^[\w-]{1,80}$/.test(s.id)||typeof s.imagePath!=='string'||s.fileName!==path.basename(s.imagePath)))throw new Error('Invalid finite deleted-source lifecycle');
  if(new Set([...shots,...pending].map((s:any)=>s.id)).size!==shots.length+pending.length)throw new Error('Ambiguous shot identity');
  let count=0;
  for(const s of shots){
   if(!Number.isSafeInteger(s.swb?.canvasWidth)||!Number.isSafeInteger(s.swb?.canvasHeight)||s.swb.canvasWidth<=0||s.swb.canvasHeight<=0||s.swb.canvasWidth*s.swb.canvasHeight>Math.floor(configured().bytes/4)||!/^[\w-]{1,80}$/.test(s.id)||s.swb?.status!=='owned'||!/^.*\.tiff?$/iu.test(s.imagePath)||!Array.isArray(s.layers)||!s.layers.length||new Set(s.layers.map((l:any)=>l.id)).size!==s.layers.length||s.sketchLayers?.some((l:any)=>l.strokes?.length)||(s.imageLayerEdits?.length??0))throw new Error('Only finite owned ordinary bitmap TIFF is prepared');
   count+=1+s.layers.length;
   for(const l of s.layers)if(!Number.isSafeInteger(l.width)||!Number.isSafeInteger(l.height)||l.width<=0||l.height<=0||l.width*l.height>Math.floor(configured().bytes/4)||!/^[\w-]{1,80}$/.test(l.id)||!['image','paint'].includes(l.kind)||typeof l.bitmapPath!=='string'||!l.bitmapPath.endsWith('.png'))throw new Error('Unsupported finite bitmap layer');
  }
  if(count>configured().assets)throw new Error('Complete bitmap dependency asset budget exceeded');
 };
 const raster=async(bytes:Buffer,role:string,assetId:string):Promise<RecoveryOffer['assets'][number]>=>{const m=await sharp(bytes,{limitInputPixels:Math.floor(configured().bytes/4),failOn:'error'}).metadata();if(!m.width||!m.height||!['png','tiff'].includes(m.format??'')||(m.pages??1)!==1)throw new Error('Finite ordinary raster required');return {bytes,role,assetId,width:m.width,height:m.height,encoding:m.format!};};
 const readState=async(root:string)=>{
  configured();if(await fs.realpath(root)!==root)throw new Error('Readonly root alias refused');
  const store=storeFor(undefined),state=await store.inspectReadonly(root);
  if(state.state==='protocolAbsent')throw Object.assign(new Error('No recovery namespace'),{code:'ENOENT'});
  if(!['protectedReadable','protectedIncomplete'].includes(state.state)||!state.content||!state.ack||!state.storagePolicy)throw new Error(`Readonly prepared recovery unavailable: ${state.state} ${state.issue??''}`);
  return {store,state,storagePolicy:state.storagePolicy as any};
 };
 type OrdinaryBefore={offer:RecoveryOffer;project:any;files:Map<string,{bytes:Buffer;physical:string}>;parents:Map<string,string>;policy:any};
 type OrdinaryAttempt={before:OrdinaryBefore;active:number;callbacks:number;operations:number;signals:number;errors:string[];callbackError?:string};
 const ordinaryFacts=new Map<string,{lease:Lease;nonce:string;stage:'pending'|'persisted'|'failed';channels:string[];project?:any;deleted?:any[];attempt?:OrdinaryAttempt;sourcePin?:any}>();
 const retired=new Map<string,{rootIdentity:string;parentIdentity:string;seal:string;inventory:string;sourcePin?:any}>();
 const inventoryFingerprint=async(root:string)=>{
  return (await accounting(root,configured())).fingerprint;
 };
 const terminalPaths=(root:string,p:any,deleted:any[]=[])=>{
  supported(p);
  const pending=p.pendingDeletedShots??[];
  if(pending.length!==deleted.length||pending.some((d:any)=>deleted.filter((s:any)=>s.id===d.id&&s.imagePath===d.imagePath&&s.fileName===d.fileName).length!==1))throw new Error('Unfinished deleted-source dependencies cannot retire');
  supported({...p,shots:dependencyShots(p,deleted),parkedShots:[],pendingDeletedShots:[]});
  const files=[path.join(root,'.storyboard-workbench/storyboard.project.json'),path.join(root,'storyboard-script.md')];
  for(const s of dependencyShots(p,deleted)){const parent=path.dirname(s.imagePath),pendingPath=path.join(root,'Pending'),parked=(p.parkedShots??[]).some((v:any)=>v.id===s.id),isDeleted=pending.some((v:any)=>v.id===s.id);if(parked?parent!==pendingPath:isDeleted?parent!==root&&parent!==pendingPath:parent!==root)throw new Error('Terminal TIFF outside finite lifecycle location');files.push(s.imagePath);for(const l of s.layers){const png=path.resolve(root,l.bitmapPath);if(path.relative(root,png)!==l.bitmapPath)throw new Error('Terminal bitmap alias');files.push(png);}}
  if(new Set(files).size!==files.length)throw new Error('Terminal dependency collision');return files;
 };
 const terminalSourcePolicy=(content:any,storagePolicy:any)=>{
  const pin=content.continuationState?.terminal?.sourcePolicy;
  if(pin===undefined)return storagePolicy; // legacy keeps its stricter equality rule
  if(pin.schema!=='swb.finite-source-policy'||pin.version!==1||!Array.isArray(pin.observed)||!pin.observed.length)throw new Error('Unknown terminal source policy');
  recoveryPolicyKey(pin);return pin;
 };
 const sourceRestrictionSignature=(policy:any)=>stringifyControlledJSON(policy.observed.map(([file,info]:[string,any])=>[file,info.kind,info.links,info.uid,info.gid,info.mode,info.flags,info.xattrs]).sort((a:any,b:any)=>a[0].localeCompare(b[0])));
 const survivingSourceRestrictionsMatch=(beforePolicy:any,currentPolicy:any)=>{
  const current=new Map<string,any>(currentPolicy.observed),before=beforePolicy.observed.filter(([file]:[string,unknown])=>current.has(file));
  return sourceRestrictionSignature({observed:before})===sourceRestrictionSignature({observed:before.map(([file]:[string,unknown])=>[file,current.get(file)])});
 };
 const terminalPolicyMatches=(content:any,storagePolicy:any,currentPolicy:any)=>{
  const pin=terminalSourcePolicy(content,storagePolicy);
  if(recoveryPolicyKey(intersectRecoveryPolicies([storagePolicy,currentPolicy]))!==recoveryPolicyKey(storagePolicy)||stringifyControlledJSON(pin.expected)!==stringifyControlledJSON(currentPolicy.expected))return false;
  if(content.continuationState?.terminal?.sourcePolicy===undefined)return true;
  // Bind cold restrictions to the actual final ACK, not archive access bits.
  // Inodes/bytes remain governed by custody and the exact terminal inventory.
  return sourceRestrictionSignature(pin)===sourceRestrictionSignature(currentPolicy);
 };
 const rootRetired=async(root:string)=>{
  try{
   if(ordinaryFacts.has(root))return false;
   const live=retired.get(root);
   // Same-process retirement is an explicit Main receipt. Ordinary edits may
   // change source bytes, but cannot mutate the recovery namespace. Inspect its
   // bounded identity/ctime/name inventory, rather than decoding every historic
   // raster/native attribute on every brush or Add IPC. Unknown growth refuses.
   if(live){
    if(live.rootIdentity!==await identity(root)||live.parentIdentity!==await identity(path.join(root,'.storyboard-workbench')))return false;
    const inventory=await inventoryFingerprint(root);
    if(live.inventory!==inventory){
     // Only this Main's authenticated resource-terminal append can rebase the
     // cache. Namespace changes and other origin changes remain protected.
     if(!options.accounting||!await options.accounting.isControlOnlyChange(root,live.inventory,inventory))return false;
     live.inventory=inventory;
    }
    if(live.sourcePin){
     // Recheck current restrictions even on the live fast path. This does NOT
     // reread historical rasters; it prevents ordinary or prepared Save from
     // laundering a source change into a replacement completed pin.
     const currentPolicy=(await native({phase:'capturePolicy',sources:live.sourcePin.observed.map(([file]:[string,unknown])=>file)})).sourcePolicy;
     return stringifyControlledJSON(currentPolicy.expected)===stringifyControlledJSON(live.sourcePin.expected)&&sourceRestrictionSignature(currentPolicy)===sourceRestrictionSignature(live.sourcePin);
    }
    // Missing-pin legacy captures retain the full cold validation below on
    // EVERY admission, including strict storage/current equality. A successful
    // old retirement cannot manufacture a historical source pin or new rights.
   }
   const {state,storagePolicy}=await readState(root);if(state.state!=='protectedReadable')return false;
   // This proves current bytes, not historical notification, and creates no
   // executable continuation or nonce. Completed strings alone are insufficient.
   const c=state.content!,completion=(c.continuationState as any)?.terminal;
   if((c.continuationState as any)?.stage!=='completed'||(c.effectFacts as any)?.state!=='completed-binding-persist-ack'||!completion||completion.schema!=='swb.current-terminal.v1'||!Array.isArray(completion.files))return false;
   const files=terminalPaths(root,c.projectRaw,(c.continuationState as any)?.deletedDependencies??[]);
   if(completion.files.length!==files.length)return false;
   for(let i=0;i<files.length;i++){const d=completion.files[i];if(d.file!==path.relative(root,files[i])||!/^[a-f0-9]{64}$/.test(d.digest))return false;await canonicalPath(root,files[i]);if(hash(await readExact(files[i]))!==d.digest)return false;}
   if(!(await readExact(files[0])).equals(encodeControlledUTF8(`${stringifyControlledJSON(c.projectRaw,null,2)}\n`))||!(await readExact(files[1])).equals(encodeControlledUTF8(serializeStoryboardScriptMarkdown(c.projectRaw as any))))return false;
   // Terminal bytes alone cannot certify changed source restrictions. Namespace
   // policy is authenticated storage data, not a grant of ordinary writer authority.
   const policy=(await native({phase:'capturePolicy',sources:files})).sourcePolicy;
   if(!terminalPolicyMatches(c,storagePolicy,policy))return false;
   retired.set(root,{rootIdentity:await identity(root),parentIdentity:await identity(path.join(root,'.storyboard-workbench')),seal:state.ack!.sealDigest,inventory:await inventoryFingerprint(root),sourcePin:cloneControlled(completion.sourcePolicy)});return true;
  }catch{return false;}
 };
 installWorkspaceRetirementPredicate(root=>withControlledMemory(memoryBudget,()=>{memoryBudget?.checkPressure();return rootRetired(root);}));
 const continuationAssets=async(root:string,store:ReturnType<typeof storeFor>,state:any)=>{
  const tip=state.content,reference=tip.scriptState?.importSourceReference;
  const descriptors=[...tip.assets],bytes=await store.readAssets(root,state.ack.generationId);
  if(reference!==undefined){
   const c=tip.continuationState;
   if(c?.stage!=='continued-editing'||!isDeepStrictEqual(reference,c.failedBase?.reference))throw new Error('Import source reference binding');
   const original=await store.readCapture(root,reference);
   if((original.content.continuationState as any)?.stage!=='failed'||(original.content.scriptState as any)?.importSourceReference!==undefined||!isDeepStrictEqual(original.content.effectFacts,tip.effectFacts)||(original.content.scriptState as any)?.imageImportFailure?.schema!=='swb.image-import-failure.v1')throw new Error('Import source reference is not the original failure');
   for(const a of original.content.assets){if(bytes.has(a.assetId)||a.role.startsWith('continued/'))throw new Error('Import source reference asset collision');const body=original.assets.get(a.assetId);if(!body)throw new Error('Import original source bytes unavailable');descriptors.push(a);bytes.set(a.assetId,body);}
  }
  return {descriptors,bytes};
 };
 const readReadonly=async(root:string)=>{
  const {store,state}=await readState(root),assets=[],retained=await continuationAssets(root,store,state);
  for(const a of retained.descriptors){const b=retained.bytes.get(a.assetId);if(!b)throw new Error('Readonly whole-capture asset missing');const display=a.encoding==='tiff'?await sharp(b,{limitInputPixels:Math.floor(configured().bytes/4),failOn:'error'}).png().toBuffer():b;assets.push({role:a.role,sourceDataUrl:`data:image/${a.encoding};base64,${b.toString('base64')}`,dataUrl:`data:image/png;base64,${display.toString('base64')}`});}
  return {state:state.state,revision:state.ack!.revision,projectRaw:state.content!.projectRaw,effectFacts:state.content!.effectFacts,viewState:state.content!.viewState,continuationState:state.content!.continuationState,original:{...(state.content!.scriptState as any).original,projectRaw:parseControlledJSON(decodeControlledBase64((state.content!.scriptState as any).original.metadataBytes)),scriptText:(state.content!.scriptState as any).original.scriptBytes===null?null:decodeControlledBase64((state.content!.scriptState as any).original.scriptBytes).toString('utf8')},assets};
 };
 // A partial publication is NOT a completed terminal. Record its actual settled
 // source inventory while the original Main still owns the failed operation.
 // Old cold captures lacking this record are never retroactively enrolled.
 const partialSaveFailure=(f:any)=>f?.code==='SAVE_RECOVERY_INCOMPLETE'&&f.recoveryIncomplete===true&&f.publicationOrCleanup==='started'&&f.metadata==='unknown';
 const partialSourceInventory=async(root:string)=>{
  const files:{file:string;identity:string;digest:string}[]=[],directories:{file:string;identity:string;names:string[]}[]=[];
  const buffers=new Map<string,Buffer>();let bytes=0,records=0;
  const namesAt=async(dir:string)=>(await fs.readdir(dir)).filter(name=>dir!==path.join(root,'.storyboard-workbench')||!['workspace-recovery-v1','workspace-recovery-v2'].includes(name)).sort();
  const visit=async(dir:string,depth:number):Promise<void>=>{
   if(depth>configured().jsonDepth||++records>configured().records)throw new Error('Partial Save inventory bound');
   if(await fs.realpath(dir)!==dir||!(await fs.lstat(dir)).isDirectory())throw new Error('Partial Save directory alias/type');
   const names=await namesAt(dir);directories.push({file:path.relative(root,dir),identity:await identity(dir),names});
   for(const name of names){const file=path.join(dir,name),stat=await fs.lstat(file);if(stat.isDirectory())await visit(file,depth+1);else{
    if(++records>configured().records||files.length>=configured().assets)throw new Error('Partial Save inventory record bound');
    if(!/\.(png|tiff?|json|md)$/iu.test(name))throw new Error('Partial Save unknown content type; no content read');
    await canonicalPath(root,file);const physical=await identity(file),body=await readExact(file);bytes+=body.length;
    if(bytes>configured().bytes)throw new Error('Partial Save inventory byte bound');
    files.push({file:path.relative(root,file),identity:physical,digest:hash(body)});buffers.set(file,body);
   }}
  };
  await visit(root,0);
  // Use the existing provenance adapter, never manufacture a finite source
  // certificate from a memory-only observation or accept unknown file types.
  const policy=(await native({phase:'capturePolicy',sources:[...buffers.keys()]})).sourcePolicy;
  for(const [file,body] of buffers)if(!(await readExact(file)).equals(body)||await identity(file)!==files.find(v=>v.file===path.relative(root,file))!.identity)throw new Error('Partial Save source changed during certification');
  for(const dir of directories)if(await identity(path.resolve(root,dir.file))!==dir.identity||!isDeepStrictEqual(await namesAt(path.resolve(root,dir.file)),dir.names))throw new Error('Partial Save inventory changed during certification');
  return {record:{schema:'swb.partial-save-inventory.v1',rootIdentity:await identity(root),parentIdentity:await parentIdentityFor(root),files,directories,policy},buffers};
 };
 type VerifiedContinuation=Parameters<NonNullable<Parameters<ReturnType<typeof storeFor>['verifyCapturesReadonly']>[1]>>[0];
 const certifyPartialSaveContinuation=(e:Event,selector:unknown,check?:(verified:VerifiedContinuation)=>Promise<void>)=>withLayerFileOperation(async()=>{
  current(e);configured();
  if(!exactKeys(selector,['binding'])||typeof (selector as any).binding!=='string')throw new Error('Observed partial-Save selector required');
  const observed=observations.get((selector as any).binding);if(!observed)throw new Error('Partial-Save observation unavailable');
  await authenticObservation(e,observed);
  try{
   const live=leases.get(observed.folderPath),ordinary=ordinaryFacts.get(observed.folderPath),history=historyByRoot.get(observed.folderPath);
   if(live&&live.stage!=='failed'||ordinary||history&&!history.preserved)return {eligible:false as const};
   const store=storeFor(undefined);let eligibility:{eligible:true;revision:string}|undefined;
   await store.verifyCapturesReadonly(observed.folderPath,async verified=>{
   const {state,captures}=verified;
   const tip=state.content!,c=tip.continuationState as any,pin=(tip.scriptState as any)?.partialSaveInventory;
   const historyContinuation=(tip.scriptState as any)?.historyContinuation;
   const failed=c?.stage==='continued-editing'?c.failedBase:c?.stage==='history-preserved'?historyContinuation:c;
   const main=(tip.effectFacts as any)?.main,importFailure=(tip.scriptState as any)?.imageImportFailure;
   const approvedImport=importFailure?.schema==='swb.image-import-failure.v1'&&isDeepStrictEqual(main,importFailure)&&importFailure.operation===failed?.nonce&&importFailure.acknowledged===false&&importFailure.preparation?.schema==='swb.import-preparation-failure.v1'&&importFailure.preparation.code==='EEXIST'&&importFailure.preparation.syscall==='mkdir'&&importFailure.preparation.preparationStarted===false;
   const historyFacts=(tip.effectFacts as any)?.historyOperation;
   const approvedHistory=historyContinuation?.schema==='swb.history-continuation.v1'&&uuid(historyContinuation.operation)&&historyContinuation.operation===historyFacts?.operation&&historyContinuation.nonce===historyFacts?.ordinaryNonce&&historyContinuation.acknowledged===false&&historyFacts?.acknowledged===false&&historyFacts?.invalidated===false&&historyFacts?.metadataStage==='failed'&&(tip.effectFacts as any)?.state==='history-preserved'&&historyContinuation.p1===hash(stringifyControlledJSON(historyFacts));
   if(state.state!=='protectedReadable'||!pin||pin.schema!=='swb.partial-save-inventory.v1'||!['failed','continued-editing','history-preserved'].includes(c?.stage)||c.notExecutable!==true||!uuid(failed?.nonce)||!/^[a-f0-9]{64}$/.test(failed.p1)||!partialSaveFailure(main)&&!approvedImport&&!approvedHistory)return;
   if(approvedImport){importProjectSupported(tip.projectRaw,importFailure.candidateProject);await continuationAssets(observed.folderPath,store,state);}
   const view=tip.viewState as any;if(!Array.isArray(view?.history?.undo)||!Array.isArray(view?.history?.redo))return;
   const currentInventory=await partialSourceInventory(observed.folderPath);
   if(!isDeepStrictEqual(pin,currentInventory.record))return;
   if(c.stage==='continued-editing'){
    const original=captures.find(capture=>isDeepStrictEqual(capture.reference,c.failedBase.reference));
    if(!original)return;
    const originalState=original.content.continuationState as any;
    const originalFailure=originalState.stage==='history-preserved'?(original.content.scriptState as any)?.historyContinuation:originalState;
    if(!['failed','history-preserved'].includes(originalState.stage)||originalFailure?.nonce!==failed.nonce||originalFailure?.p1!==failed.p1||!isDeepStrictEqual((original.content.scriptState as any).historyContinuation,historyContinuation)||!isDeepStrictEqual(original.content.effectFacts,tip.effectFacts)||!isDeepStrictEqual((original.content.scriptState as any).partialSaveInventory,pin)||failed.acknowledged!==false)return;
   }
   await check?.(verified);
   eligibility={eligible:true,revision:state.ack!.revision};
   });
   await authenticObservation(e,observed);
   return eligibility??{eligible:false as const};
  }catch{return {eligible:false as const};}
 });
 const inspectPartialSaveContinuation=(e:Event,selector:unknown)=>certifyPartialSaveContinuation(e,selector);
 type PartialSession={observation:Observation;revision:string;seal:string};
 const partialSessions=new Map<string,PartialSession>();
 const beginPartialSaveContinuation=(e:Event,selector:unknown)=>withLayerFileOperation(async()=>{
  const eligibility=await inspectPartialSaveContinuation(e,selector);if(!eligibility.eligible)throw new Error('Partial Save continuation unavailable; workspace remains read-only');
  const observation=observations.get((selector as any).binding)!,{state}=await readState(observation.folderPath);
  if(state.ack!.revision!==eligibility.revision)throw new Error('Partial Save generation changed');
  const recovery=await readReadonly(observation.folderPath);await authenticObservation(e,observation);
  const session=randomUUID();partialSessions.set(session,{observation,revision:eligibility.revision,seal:state.ack!.sealDigest});
  return {session,revision:eligibility.revision,recovery,originalSaveAcknowledged:false as const};
 });
 const persistPartialSaveContinuation=(e:Event,input:unknown)=>withLayerFileOperation(async()=>{
  const p=input as any;
  if(!exactKeys(p,['session','revision','projectRaw','viewState','desiredAssets'])||typeof p.session!=='string'||typeof p.revision!=='string'||!Array.isArray(p.desiredAssets))throw new Error('Exact continuation generation payload required');
  const session=partialSessions.get(p.session);if(!session||session.revision!==p.revision)throw new Error('Continuation session/revision unavailable');
  const observation=session.observation;await authenticObservation(e,observation);
  let certified!:VerifiedContinuation,bytes!:Map<string,Buffer>;
  if(!(await certifyPartialSaveContinuation(e,{binding:observation.binding},async verified=>{
   certified=verified;
   const selected=verified.captures.find(c=>c.ack.sealDigest===verified.state.ack!.sealDigest)!;
   bytes=await verified.readAssets(selected.reference);
  })).eligible)throw new Error('Continuation source/failure certification refused');
  const state=certified.state,storagePolicy=state.storagePolicy,tip=state.content!,continuation=tip.continuationState as any;
  if(state.ack!.sealDigest!==session.seal||state.ack!.revision!==session.revision)throw new Error('Continuation exact generation changed');
  const importFailure=(tip.scriptState as any)?.imageImportFailure;
  const validateProject=(project:any)=>importFailure?importProjectSupported(project,importFailure.candidateProject):supported(project);
  validateProject(p.projectRaw);
  if((p.projectRaw as any).id!==(tip.projectRaw as any).id)throw new Error('Continuation Project identity changed');
  // Logical edits only. No renderer-selected source/destination, import, Trash,
  // source writer or original Save ACK can be reached through this capability.
  const after=dependencyShots(p.projectRaw);
  const logicalPaths=(project:any)=>{
   for(const shot of dependencyShots(project)){
    const relative=path.relative(observation.folderPath,shot.imagePath);
    if(path.isAbsolute(relative)||relative.startsWith('..')||relative.split(path.sep).some(part=>['workspace-recovery-v1','workspace-recovery-v2'].includes(part)))throw new Error('Continuation logical image outside Root');
    for(const layer of shot.layers??[])if(!/^\.storyboard-workbench\/layers\/[\w-]{1,80}\/[\w-]{1,80}\.png$/.test(layer.bitmapPath))throw new Error('Continuation logical layer outside finite domain');
   }
  };
  logicalPaths(p.projectRaw);
  const view=p.viewState;if(!view||!Array.isArray(view.history?.undo)||!Array.isArray(view.history?.redo)||view.history.undo.length+view.history.redo.length>configured().records||view.canvas?.hasUnsettledGesture||view.canvas?.captures?.some((v:any)=>v.hasUnsettledGesture))throw new Error('Settled continuation view and dual History required');
  for(const entries of [view.history.undo,view.history.redo])for(const entry of entries){validateProject(entry.project);logicalPaths(entry.project);if(entry.project.id!==p.projectRaw.id)throw new Error('Continuation History Project mismatch');}

  // desiredAssets is the complete logical overlay, so Undo may omit a newer
  // overlay in THIS generation. Its earlier bytes stay in the immutable chain.
  const assets:RecoveryOffer['assets']=importFailure?[]:tip.assets.filter(a=>!a.role.startsWith('continued/')).map(a=>({...a,bytes:bytes.get(a.assetId)!}));
  const seen=new Set<string>();
  for(const edit of p.desiredAssets){
   if(!exactKeys(edit,['shotId','layerId','dataUrl'])||typeof edit.dataUrl!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(edit.dataUrl))throw new Error('Continuation PNG edit payload');
   const shot=after.find((s:any)=>s.id===edit.shotId),layer=shot?.layers?.find((l:any)=>l.id===edit.layerId),role=`continued/${edit.shotId}/${edit.layerId}`;
   if(!layer||seen.has(role))throw new Error('Continuation PNG layer identity');seen.add(role);
   const asset=await raster(decodeControlledBase64(edit.dataUrl.split(',')[1]),role,`continued_${seen.size}`);
   if(asset.encoding!=='png'||asset.width!==layer.width||asset.height!==layer.height)throw new Error('Continuation PNG dimensions');
   const old=tip.assets.find(a=>a.role===role);if(old)asset.assetId=old.assetId;else asset.assetId=`continued_${hash(role).slice(0,32)}`;
   const index=assets.findIndex(a=>a.role===role);if(index>=0)assets[index]=asset;else assets.push(asset);
  }
  const failure=continuation.stage==='history-preserved'?(tip.scriptState as any).historyContinuation:continuation;
  const failedBase=continuation.stage==='failed'||continuation.stage==='history-preserved'?{nonce:failure.nonce,p1:failure.p1,acknowledged:false,reference:certified.captures.find(c=>c.ack.sealDigest===state.ack!.sealDigest)!.reference}:continuation.failedBase;
  const revision=`continued:${randomUUID()}`;
  const offer:RecoveryOffer={revision,projectRaw:parseControlledJSON(encodeControlledUTF8(stringifyControlledJSON(p.projectRaw))),viewState:parseControlledJSON(encodeControlledUTF8(stringifyControlledJSON(view))),scriptState:importFailure?{...tip.scriptState as any,importSourceReference:failedBase.reference}:tip.scriptState,effectFacts:tip.effectFacts,continuationState:{stage:'continued-editing',notExecutable:true,failedBase},assets,requiredAssetIds:assets.map(a=>a.assetId)};
  const writer=storeFor(storagePolicy),ack=await writer.retain({sender:e.sender,frame:e.senderFrame!,window:observation.window,document:observation.document},observation.folderPath,offer);
  // Selected byte readback and source/failure checks share the same two fresh
  // full-chain passes, rather than each recursively scanning that whole chain.
  if(!(await certifyPartialSaveContinuation(e,{binding:observation.binding},async verified=>{
   if(verified.state.ack?.sealDigest!==ack.sealDigest||!isDeepStrictEqual(verified.state.content?.projectRaw,offer.projectRaw)||!isDeepStrictEqual(verified.state.content?.viewState,offer.viewState))throw new Error('Continuation exact generation readback unavailable');
   const selected=verified.captures.find(c=>c.ack.sealDigest===ack.sealDigest)!;
   const reread=await verified.readAssets(selected.reference);
   for(const asset of assets)if(!reread.get(asset.assetId)?.equals(copyControlledBuffer(asset.bytes)))throw new Error('Continuation full asset readback mismatch');
  })).eligible)throw new Error('Continuation exact generation readback unavailable');
  await authenticObservation(e,observation);
  session.revision=revision;session.seal=ack.sealDigest;
  return {revision,generationId:ack.generationId,originalSaveAcknowledged:false as const};
 });
 type Custody = { records:any[]; current:Record<string,{version:string;state:'present'|'deleted'}>; assets:RecoveryOffer['assets'] };
 // A replacement renderer must take the full cold-authentication path, not
 // inherit the previous document's live producer cache. Old-document custody
 // stays associated with its owner while its leases/failed evidence survive.
 const custodyDocuments=new WeakMap<object,Map<string,{sender:object;document:object;rootIdentity:string;parentIdentity:string;value:Custody}>>();
 const documentIds=new WeakMap<object,string>();
 const uuid=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
 const exactKeys=(v:any,required:string[],optional:string[]=[])=>!!v&&typeof v==='object'&&!Array.isArray(v)&&required.every(k=>Object.prototype.hasOwnProperty.call(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
 const receiptSemantics=(l:Lease,r:any)=>{
  const fail=()=>{throw new Error('Cold custody receipt/policy/origin semantics');};
  if(!exactKeys(r,['schema','version','rootIdentity','parentIdentity','document','producer','file','identity','digest','width','height','sourcePolicy'],['originalAbsence','deletionReceipt','commitFailure'])||r.schema!=='swb.producer-png-receipt.v1'||!uuid(r.version)||!uuid(r.document)||r.rootIdentity!==l.rootIdentity||r.parentIdentity!==l.parentIdentity||!['layers:createPng','layers:writePng'].includes(r.producer)||typeof r.file!=='string'||!/^\.storyboard-workbench\/layers\/[\w-]{1,80}\/[\w-]{1,80}\.png$/.test(r.file)||!/^[a-f0-9]{64}$/.test(r.digest)||typeof r.identity!=='string'||!/^\d+:\d+$/.test(r.identity)||!Number.isSafeInteger(r.width)||!Number.isSafeInteger(r.height)||r.width<=0||r.height<=0)fail();
  const p=r.sourcePolicy,fields=['uid','gid','mode','flags','xattrs'];
  if(!exactKeys(p,['schema','version','expected','observed'])||p.schema!=='swb.finite-source-policy'||p.version!==1||!exactKeys(p.expected,fields)||!Array.isArray(p.observed)||p.observed.length!==1||!Array.isArray(p.observed[0])||p.observed[0].length!==2||p.observed[0][0]!==path.resolve(l.root,r.file))fail();
  const n=p.observed[0][1];
  if(!exactKeys(n,['kind','reason','dev','ino','uid','gid','mode','flags','links','size','mtime_ns','ctime_ns','xattrs'])||n.kind!=='ordinary'||n.reason!==null||n.flags!==0||n.links!==1||n.mode&0o7111||n.uid!==process.getuid?.()||!['dev','ino','uid','gid','mode','flags','links','size','mtime_ns','ctime_ns'].every(k=>Number.isInteger(n[k])&&n[k]>=0)||`${n.dev}:${n.ino}`!==r.identity||!exactKeys(n.xattrs,[])&&(!n.xattrs||typeof n.xattrs!=='object'||Array.isArray(n.xattrs)))fail();
  if(!fields.every(k=>stringifyControlledJSON(n[k])===stringifyControlledJSON(p.expected[k])))fail();
  for(const [key,value] of Object.entries(n.xattrs)){if(typeof value!=='string'||decodeControlledBase64(key).toString('base64')!==key||decodeControlledBase64(value).toString('base64')!==value||!decodeControlledBase64(key).length||decodeControlledBase64(key).includes(0))fail();}
  restrictCustody(l,p);
  if(r.originalAbsence!==undefined){const a=r.originalAbsence;
   if(!exactKeys(a,['schema','version','document','rootIdentity','parentIdentity','file','project','shotId','layerId'])||r.producer!=='layers:createPng'||a.schema!=='swb.exclusive-original-absence.v1'||a.version!==r.version||a.document!==r.document||a.rootIdentity!==l.rootIdentity||a.parentIdentity!==l.parentIdentity||a.file!==r.file||a.file!==`.storyboard-workbench/layers/${a.shotId}/${a.layerId}.png`)fail();
   supported(a.project);const s=dependencyShots(a.project).find((s:any)=>s.id===a.shotId);
   if(!s||a.project.id!==(l.offer.projectRaw as any).id||s.swb.canvasWidth!==r.width||s.swb.canvasHeight!==r.height||dependencyShots(a.project).some((s:any)=>s.layers.some((v:any)=>v.id===a.layerId||v.bitmapPath===a.file)))fail();
  }
  if(r.deletionReceipt!==undefined){const d=r.deletionReceipt;
   // Its historical document is an origin fact, not the fresh reader's authority.
   if(!exactKeys(d,['schema','version','digest','file','rootIdentity','parentIdentity','document'])||d.schema!=='swb.producer-deleted-version.v1'||d.version!==r.version||d.digest!==r.digest||d.file!==r.file||d.rootIdentity!==l.rootIdentity||d.parentIdentity!==l.parentIdentity||!uuid(d.document))fail();
  }
  if(r.commitFailure!==undefined){const f=r.commitFailure;if(!exactKeys(f,['effect','retainedTemporary','warnings'])||f.effect!=='committed'||f.retainedTemporary!==null&&typeof f.retainedTemporary!=='string'||!Array.isArray(f.warnings)||f.warnings.some((w:any)=>typeof w!=='string'))fail();}
 };
 const custodyFor=async(l:Lease):Promise<Custody>=>{
  let custodies=custodyDocuments.get(l.document);
  if(!custodies){custodies=new Map();custodyDocuments.set(l.document,custodies);}
  const live=custodies.get(l.root);
  if(live){if(live.sender!==l.sender||live.document!==l.document||live.rootIdentity!==l.rootIdentity||live.parentIdentity!==l.parentIdentity)throw new Error('Producer custody caller/document/incarnation mismatch');return live.value;}
  const value:Custody={records:[],current:{},assets:[]};
  // Cold adoption is content-only, after the sealed store's full native chain,
  // inventory, physical binding and every encoded byte have been authenticated.
  try{const {store,state}=await readState(l.root),c=state.content!,record=(c.scriptState as any)?.producerCustody;
   if(record===undefined&&c.assets.some(a=>a.role.startsWith('custody/')))throw new Error('Cold custody record inventory omitted');
   if(record!==undefined){
    if(state.state!=='protectedReadable'||!exactKeys(record,['schema','rootIdentity','parentIdentity','records','current'])||record.schema!=='swb.producer-png-custody.v1'||record.rootIdentity!==l.rootIdentity||record.parentIdentity!==l.parentIdentity||!Array.isArray(record.records)||!record.current||typeof record.current!=='object'||Array.isArray(record.current)||record.records.length>configured().records)throw new Error('Cold producer custody association');
    const bytes=await store.readAssets(l.root,state.ack!.generationId);
    for(const r of record.records){
     receiptSemantics(l,r);
     const asset=c.assets.find(a=>a.role===`custody/${r.version}`),b=asset&&bytes.get(asset.assetId);
     if(!asset||!b||r.sourcePolicy.observed[0][1].size!==b.length||asset.encoding!=='png'||hash(b)!==r.digest||asset.width!==r.width||asset.height!==r.height||value.records.some(v=>v.version===r.version))throw new Error('Cold custody producer asset association');
     restrictCustody(l,r.sourcePolicy);value.records.push(cloneControlled(r));value.assets.push({...asset,bytes:b});
    }
    const files=new Set(value.records.map(r=>r.file));
    if(Object.keys(record.current).length!==files.size||c.assets.filter(a=>a.role.startsWith('custody/')).length!==value.records.length)throw new Error('Cold custody complete version inventory');
    for(const [file,s] of Object.entries(record.current) as [string,any][]){const r=value.records.find(r=>r.version===s?.version&&r.file===file);if(!files.has(file)||!exactKeys(s,['version','state'])||!['present','deleted'].includes(s.state)||!r||s.state==='deleted'&&!r.deletionReceipt)throw new Error('Cold producer current-version association');value.current[file]={version:s.version,state:s.state};}
    // Validate ALL current records, including deleted or off-Project paths, before
    // publishing editable History. A historic A need not equal current B.
    for(const file of files)await currentCustody(l,path.resolve(l.root,file),value);
   }
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;if(!await hasRecovery(l.root)){custodies.set(l.root,{sender:l.sender,document:l.document,rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,value});return value;}throw new Error(`Cold custody current inventory missing: ${String(error)}`);}
  custodies.set(l.root,{sender:l.sender,document:l.document,rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,value});return value;
 };
 const restrictCustody=(l:Lease,policy:any)=>{
  const expected=l.sourcePolicy.expected,actual=policy?.expected;
  if(policy?.schema!=='swb.finite-source-policy'||policy.version!==1||!Array.isArray(policy.observed)||policy.observed.length!==1||!actual||Object.keys(expected).some(k=>k==='mode'?(expected.mode&actual.mode)!==expected.mode: stringifyControlledJSON(expected[k])!==stringifyControlledJSON(actual[k])))throw new Error('Producer source restrictions conflict with immutable storage policy');
 };
 const currentCustody=async(l:Lease,file:string,value:Custody)=>{
  await canonicalPath(l.root,file);const rel=path.relative(l.root,file),s=value.current[rel];if(!s)return;
  const r=value.records.find(v=>v.version===s.version&&v.file===rel);if(!r)throw new Error('Producer current custody missing');
  if(s.state==='deleted'){try{await fs.lstat(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}throw new Error('Producer deleted path replaced');}
  const b=await readExact(file),policy=(await native({phase:'capturePolicy',sources:[file]})).sourcePolicy;
  if(hash(b)!==r.digest||stringifyControlledJSON(policy)!==stringifyControlledJSON(r.sourcePolicy))throw new Error('Producer source physical version changed');
 };
 const appendCustody=async(l:Lease,offer:RecoveryOffer):Promise<RecoveryOffer>=>{
  const value=await custodyFor(l);if(!value.records.length)return offer;
  if(value.records.length>configured().records||value.assets.length>configured().assets)throw new Error('Producer custody finite budget');
  const assets=[...offer.assets.filter(a=>!a.role.startsWith('custody/')),...value.assets.map(a=>({...a,bytes:copyControlledBuffer(a.bytes)}))];
  return {...offer,scriptState:{...offer.scriptState as object,producerCustody:{schema:'swb.producer-png-custody.v1',rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,records:cloneControlled(value.records),current:cloneControlled(value.current)}},assets,requiredAssetIds:assets.map(a=>a.assetId)};
 };
 const producerEffects=(e:Event,l:Lease,channel:string,physicalOnly=false)=>{
  const authenticate=()=>physicalOnly?historyPhysical({lease:l} as HOperation):authentic(e,l);
  return ({
  physicalWrite:async<T,>(request:{root:string;filePath:string;bytes:Buffer;mode:'upsert'|'create-only';kind?:'node-exclusive-create'},execute:(plan?:Record<string,any>,control?:ReservationPhysicalControl)=>Promise<T>):Promise<T>=>{
   await authenticate();if(request.root!==l.root)throw new Error('PNG physical plan outside original Root');
   if(request.kind==='node-exclusive-create'&&(channel!=='layers:createPng'||request.mode!=='create-only'))throw new Error('Original Add physical binding required');
   if(!options.accounting)return execute();
   const plan=await planProtectedPngWrite(l.root,request.filePath,request.bytes,request.mode,configured().bytes,options.python);
   const quote=await options.accounting.quote(l.root,configured(),plan.peakBytes,plan.peakRecords,l.sourcePolicy);
   return options.accounting.reserve(l.root,configured(),plan.peakBytes,plan.peakRecords,async control=>{
    if(request.kind==='node-exclusive-create'){
     if(!control||plan.target!==null||plan.missingDirectories.length)throw new Error('Original exclusive physical plan/control required');
     const current=await planProtectedPngWrite(l.root,request.filePath,request.bytes,request.mode,configured().bytes,options.python);
     if(!isDeepStrictEqual(current,plan))throw new Error('Native exclusive plan changed before original wx');
    }
    return execute(plan,control);
   },async error=>{
    // Predeclared error evidence only. The original request still rejects;
    // business failure, committed receipts and Root protection stay intact.
    l.facts={state:'png-physical-accounting-failed',error:String(error),previous:l.facts};
   },quote);
  },
  beforeWrite:async(file:string)=>{await authenticate();const value=await custodyFor(l);await currentCustody(l,file,value);},
  written:async(receipt:ProducerPngReceipt)=>{
   await authenticate();const file=receipt.filePath,rel=path.relative(l.root,file);
   if(!rel.startsWith('.storyboard-workbench/layers/')||!rel.endsWith('.png'))return;
   if(receipt.commitFailure){
    // Failed fresh publication may leave target+owned staging hardlinked. It is
    // not ordinary/native-authorized custody. Pin the genuine committed B as an
    // explicitly failed version under the immutable storage policy instead of
    // mislabelling A current or relaxing the ordinary-file/native restriction.
    await canonicalPath(l.root,path.dirname(file));
    const {bytes:b,physical}=await readCommittedLayerBytes(file,receipt,configured().bytes);
    const version=randomUUID(),asset=await raster(b,'failed-custody/'+version,'failed_custody_'+version);
    let nativeCertification='certified',nativeError:unknown;
    try{restrictCustody(l,(await native({phase:'capturePolicy',sources:[file]})).sourcePolicy);}catch(error){nativeCertification='refused';nativeError=error;}
    const failure={schema:'swb.failed-producer-commit.v1',version,file:rel,identity:physical,digest:hash(b),width:asset.width,height:asset.height,...receipt.commitFailure,nativeCertification,nativeError:nativeError===undefined?null:String(nativeError)};
    const offer:RecoveryOffer={...l.offer,revision:`producer-commit-failed:${version}`,assets:[...l.offer.assets,asset],requiredAssetIds:[...l.offer.requiredAssetIds,asset.assetId],effectFacts:{state:'ordinary-failed',owner:l.offer.effectFacts,producerCommitFailure:failure},continuationState:{stage:'ordinary-failed',notExecutable:true}};
    l.offer=offer;l.facts=failure;
    const original=receipt.commitFailure.ownedStageReceipt;
    if(options.originEnrollment&&hasOriginalOwnedStageProvenance(original)){
     let captureStarted=false;
     try{
      const previous=await storeFor(l.sourcePolicy).inspectReadonly(l.root);
      const capturePolicy=intersectRecoveryPolicies([l.sourcePolicy,...(previous.storagePolicy?[previous.storagePolicy]:[])]);
      await options.originEnrollment.capture(original,capturePolicy,async()=>{captureStarted=true;return retainExact(l,offer);});
     }
     catch(error){
      Object.assign(failure,{originRegistrationError:String(error)});
      // An issued failure must not lose the genuine failed B. This is content
      // preservation only, never origin success or replay of a started capture.
      if(!captureStarted)try{await retainExact(l,offer);}catch(preservationError){throw new AggregateError([error,preservationError],'Origin enrollment and failed-B preservation failed');}
      throw error;
     }
    }else await retainExact(l,offer);
    await authenticate();return;
   }
   // Inert committed-failure preservation above covers actual writer receipts
   // from ALL admitted PNG producers, including an unminted fresh copy/merge.
   // It does not mint ordinary custody or authorize deletion of owned staging.
   // Ordinary version authority remains limited to the original Add lifecycle.
   if(!['layers:createPng','layers:writePng'].includes(channel))return;
   const value=await custodyFor(l);if(receipt.kind==='written'&&!value.current[rel])return;
   if(receipt.kind==='created'&&value.current[rel])throw new Error('Producer creation is not a new custody lifecycle');
   await canonicalPath(l.root,file);const before=await identity(file),b=await readExact(file);
   if(before!==`${receipt.identity.dev}:${receipt.identity.ino}`||!b.equals(receipt.bytes))throw new Error('Original producer physical effect receipt mismatch');
   const policy=(await native({phase:'capturePolicy',sources:[file]})).sourcePolicy;restrictCustody(l,policy);
   const a=await raster(b,'custody/pending','pending');if(a.encoding!=='png')throw new Error('Producer custody requires PNG');
   const again=(await native({phase:'capturePolicy',sources:[file]})).sourcePolicy;
   if(stringifyControlledJSON(again)!==stringifyControlledJSON(policy)||await identity(file)!==before||!(await readExact(file)).equals(b))throw new Error('Producer changed during native receipt capture');
   let document=documentIds.get(l.document);if(!document){document=randomUUID();documentIds.set(l.document,document);}
   const version=randomUUID(),record={schema:'swb.producer-png-receipt.v1',version,rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,document,producer:channel,file:rel,identity:before,digest:hash(b),width:a.width,height:a.height,sourcePolicy:policy};
   if(receipt.kind==='created'&&receipt.originalAbsence){
    const origin=receipt.originalAbsence,project=origin.project as any; supported(project);
    const shot=dependencyShots(project).find((s:any)=>s.id===origin.shotId);
    if(!shot||dependencyShots(project).some((s:any)=>s.layers.some((a:any)=>a.id===origin.layerId||a.bitmapPath===rel))||rel!==`.storyboard-workbench/layers/${origin.shotId}/${origin.layerId}.png`)throw new Error('Original exclusive absence descriptor mismatch');
    Object.assign(record,{originalAbsence:{schema:'swb.exclusive-original-absence.v1',version,document,rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,file:rel,project:cloneControlled(project),shotId:origin.shotId,layerId:origin.layerId}});
   }
   value.records.push(record);value.current[rel]={version,state:'present'};value.assets.push({...a,assetId:`custody_${version}`,role:`custody/${version}`});
   // Keep the genuine unsettled ordinary fact; this durable receipt is not ACK.
   await retainExact(l,l.offer);await authenticate();
  },
  beforeDelete:async(file:string)=>{await authenticate();await currentCustody(l,file,await custodyFor(l));},
  deleted:async(file:string)=>{
   await authenticate();const value=await custodyFor(l),s=value.current[path.relative(l.root,file)];if(!s)return;
   try{await fs.lstat(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    const record=value.records.find(r=>r.version===s.version&&r.file===path.relative(l.root,file));if(!record)throw new Error('Deleted producer version missing');
    let document=documentIds.get(l.document);if(!document){document=randomUUID();documentIds.set(l.document,document);}
    record.deletionReceipt={schema:'swb.producer-deleted-version.v1',version:record.version,digest:record.digest,file:record.file,rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,document};
    s.state='deleted';await retainExact(l,l.offer);await authenticate();return;}throw new Error('Original producer deletion did not settle');
  }
 });};
 const custodyAuthenticates=async(l:Lease,file:string,dataUrl:unknown,currentOnly=false)=>{
  const value=await custodyFor(l);await currentCustody(l,file,value);const rel=path.relative(l.root,file);
  if(!value.current[rel]||typeof dataUrl!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(dataUrl))return false;
  const bytes=decodeControlledBase64(dataUrl.split(',')[1]);return value.records.some(r=>r.file===rel&&(!currentOnly||value.current[rel].state==='present'&&value.current[rel].version===r.version)&&r.digest===hash(bytes)&&value.assets.some(a=>a.role===`custody/${r.version}`&&copyControlledBuffer(a.bytes).equals(bytes)));
 };
 const custodyAuthenticatesAbsence=async(l:Lease,file:string,project:any)=>{
  const value=await custodyFor(l);await currentCustody(l,file,value);const rel=path.relative(l.root,file);
  if(!value.current[rel])return false;
  return value.records.some(r=>{
   const a=r.originalAbsence,d=r.deletionReceipt;
   if(!a||!d||a.schema!=='swb.exclusive-original-absence.v1'||d.schema!=='swb.producer-deleted-version.v1'||r.producer!=='layers:createPng'||a.version!==r.version||d.version!==r.version||d.digest!==r.digest||a.document!==r.document||a.rootIdentity!==l.rootIdentity||a.parentIdentity!==l.parentIdentity||d.rootIdentity!==l.rootIdentity||d.parentIdentity!==l.parentIdentity||a.file!==rel||d.file!==rel||r.file!==rel||a.project.id!==project.id)return false;
   const original=dependencyShots(a.project).find((s:any)=>s.id===a.shotId),historic=dependencyShots(project).find((s:any)=>s.id===a.shotId);
   return !!original&&!!historic&&original.imagePath===historic.imagePath&&original.swb.canvasWidth===historic.swb.canvasWidth&&original.swb.canvasHeight===historic.swb.canvasHeight&&rel===`.storyboard-workbench/layers/${a.shotId}/${a.layerId}.png`&&
    !dependencyShots(a.project).some((s:any)=>s.layers.some((v:any)=>v.id===a.layerId||v.bitmapPath===rel))&&!dependencyShots(project).some((s:any)=>s.layers.some((v:any)=>v.id===a.layerId||v.bitmapPath===rel))&&value.assets.some(v=>v.role===`custody/${r.version}`&&hash(v.bytes)===r.digest);
  });
 };
 const retainExact=async(l:Lease,offer:RecoveryOffer,onFailure?:ReservationFailureHandler):Promise<OriginCapture>=>{
  offer=await appendCustody(l,offer);
  // Normal-open/rebase may produce own undefined for these OPTIONAL absent
  // collections. Match the existing JSON/History snapshot convention only for
  // those keys; unknown fields, values and raw pending states are not washed.
  const projectRaw=recoveryProjectAbsence(offer.projectRaw);
  const viewState=cloneControlled(offer.viewState) as any;
  if(viewState?.history)for(const direction of ['undo','redo'])if(Array.isArray(viewState.history[direction]))for(const entry of viewState.history[direction])entry.project=recoveryProjectAbsence(entry.project);
  offer={...offer,projectRaw,viewState};
  // Any sidecar attempt changes the bounded live inventory. Invalidate even on
  // partial failure; only the cold full-byte terminal predicate may retire anew.
  retired.delete(l.root);
  let store=liveStores.get(l);if(!store){store=storeFor(l.sourcePolicy);liveStores.set(l,store);}
  const ack=await store.retain({sender:l.sender,frame:l.frame,window:l.window,document:l.document},l.root,offer,onFailure);
  const state=await store.inspectReadonly(l.root);if(!['protectedReadable','protectedIncomplete'].includes(state.state)||state.ack?.sealDigest!==ack.sealDigest||state.ack.revision!==offer.revision)throw new Error('Prepared generation exact readback unavailable');
  const retained=await store.readAssets(l.root,ack.generationId);
  for(const a of offer.assets)if(!retained.get(a.assetId)?.equals(copyControlledBuffer(a.bytes)))throw new Error('Prepared asset full-byte readback mismatch');
  l.latestSeal=ack.sealDigest;
  if((offer.effectFacts as any)?.state==='completed-binding-persist-ack'&&!ordinaryFacts.has(l.root)&&!await rootRetired(l.root))throw new Error('Retained current terminal cannot retire Root');
  return {...ack,format:state.content?.version===2?'v2':'v1',policyKey:state.content?.version===2?recoveryPolicyKey(state.storagePolicy):null};
 };
 const captureCurrentAssets=async(root:string,p:any,deleted:any[]=[])=>{
  terminalPaths(root,p,deleted);const assets:RecoveryOffer['assets']=[];
  for(const s of dependencyShots(p,deleted))for(const d of [{file:s.imagePath,role:`original/${s.id}/base`,width:s.swb.canvasWidth,height:s.swb.canvasHeight},...s.layers.map((v:any)=>({file:path.resolve(root,v.bitmapPath),role:`original/${s.id}/${v.id}`,width:v.width,height:v.height}))]){await canonicalPath(root,d.file);const a=await raster(await readExact(d.file),d.role,`asset_${assets.length}`);if(a.width!==d.width||a.height!==d.height)throw new Error('Current ordinary raster dimensions');assets.push(a);}
  return assets;
 };
 const protectedRoots=async(targets:readonly string[])=>{
  const roots=new Set<string>();
  for(const target of targets){if(!path.isAbsolute(target)||target.includes('\0'))throw new Error('Invalid ordinary physical target');let cursor=path.normalize(target);
   for(;;){try{await fs.lstat(cursor);break;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;cursor=path.dirname(cursor);}}
   cursor=await fs.realpath(cursor);if(!(await fs.stat(cursor)).isDirectory())cursor=path.dirname(cursor);
   for(;;){if(await hasRecovery(cursor))roots.add(cursor);const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  }return [...roots];
 };
 const ordinaryLease=async(e:Event,root:string)=>{
  let l=leases.get(root);
  if(l&&l.stage!=='completed')throw new Error('Unfinished Save cannot authorize ordinary effects');
  if(l&&l.sender===e.sender&&l.document===documentFor(e)){await authentic(e,l);return l;}
  const {store,state,storagePolicy}=await readState(root),c=state.content!;
  const bytes=await store.readAssets(root,state.ack!.generationId),assets=c.assets.map(a=>({...a,bytes:bytes.get(a.assetId)!}));
  const window=options.ownerFromSender?.(e.sender)??e.sender;if(!window)throw new Error('Actual ordinary window unavailable');
  l={sender:e.sender,frame:e.senderFrame!,window,document:documentFor(e),root,rootIdentity:await identity(root),parentIdentity:await identity(path.join(root,'.storyboard-workbench')),nonce:randomUUID(),p1:hash(stringifyControlledJSON(c.projectRaw)),stage:'completed',sourcePolicy:storagePolicy,sourceAuthorityPolicy:terminalSourcePolicy(c,storagePolicy),offer:{...c,assets,requiredAssetIds:assets.map(a=>a.assetId)},facts:{},result:{project:c.projectRaw},latestSeal:state.ack!.sealDigest};
  leases.set(root,l);return l;
 };

 // Private admitted History operation: renderer handles identify a session, never
 // supply recovery bytes or authority to an ordinary writer. Main owns every
 // before/after version and uses the real protected native writer for restoration.
 type HVersion={bytes:Buffer|null;physical:string|null;policy:any};
 type HAsset={bitmapPath:string;file:string;before:HVersion;desired:Buffer|null;started:boolean;after?:HVersion;observed?:HVersion;error?:string;compensationError?:string;unresolved?:boolean;compensationStarted?:boolean;compensationAcknowledged?:boolean;failure?:any;compensationFailure?:any;compensationConflict?:{kind:'write-after-conflict-before-compensation';origin:'unknown';notExecutable:true}};
 type HOperation={id:string;lease:Lease;project:any;targetProject:any;assets:HAsset[];inventory:Map<string,HVersion>;binding?:Map<string,HVersion>;metadataObservation?:{kind:'original-callback-failure-observation';error:string;attemptedProject:any;versions:Map<string,HVersion>};preserved?:boolean;next:number;state:'active'|'failed'|'restored'|'persisted';invalidated:boolean};
 const historyOperations=new Map<string,HOperation>();
 const historyByRoot=new Map<string,HOperation>();
 const historyVersion=async(l:Lease,file:string):Promise<HVersion>=>{
  await canonicalPath(l.root,file);
  try{const physical=await identity(file),bytes=await readExact(file),policy=(await native({phase:'captureMemoryPolicy',sources:[file]})).sourcePolicy;
   if(physical!==await identity(file)||!(await readExact(file)).equals(bytes))throw new Error('History version changed during native certification');
   return {bytes,physical,policy};
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
   const parent=path.dirname(file),physical=await identity(parent),policy=await inspectHistoryAbsenceParents(options.python,l.root,file,configured().jsonDepth);
   try{await fs.lstat(file);throw new Error('History absence replaced during certification');}catch(absent){if((absent as NodeJS.ErrnoException).code!=='ENOENT')throw absent;}
   return {bytes:null,physical,policy};
  }
 };
 const sameHVersion=(a:HVersion,b:HVersion)=>{
  // Sibling effects legitimately change a directory's size/mtime/ctime. Keep the
  // full native observation in facts, but authenticate absence through exact
  // directory identity + all stable native restrictions and actual ENOENT.
  const policy=(v:HVersion)=>v.bytes===null?{...v.policy,observed:v.policy.observed.map(([file,info]:[string,any])=>{const {size,mtime_ns,ctime_ns,...stable}=info;return [file,stable];})}:v.policy;
  return a.physical===b.physical&&stringifyControlledJSON(policy(a))===stringifyControlledJSON(policy(b))&&(a.bytes===null?b.bytes===null:b.bytes!==null&&a.bytes.equals(b.bytes));
 };
 const historyPhysical=async(o:HOperation)=>{if(await identity(o.lease.root)!==o.lease.rootIdentity||await parentIdentityFor(o.lease.root)!==o.lease.parentIdentity)throw new Error('History original physical Root/parent changed');};
 const historyCaller=async(e:Event,id:string)=>{const o=historyOperations.get(id);if(!o||o.invalidated||o.preserved||historyByRoot.get(o.lease.root)!==o)throw new Error('History operation unavailable');await authentic(e,o.lease);return o;};
 const historyCertification=(v:HVersion|undefined)=>v?{identity:v.physical,state:v.bytes===null?'absent':'present',digest:v.bytes===null?null:hash(v.bytes),sourcePolicy:v.policy}:null;
 const historyFacts=(o:HOperation)=>JSON.parse(stringifyControlledJSON(o.assets.map(a=>{
  const actual=a.observed??a.after;
  return {bitmapPath:a.bitmapPath,before:a.before.bytes===null?undefined:'data:image/png;base64,'+a.before.bytes.toString('base64'),desired:a.desired===null?undefined:'data:image/png;base64,'+a.desired.toString('base64'),actual:actual?.bytes===null?undefined:actual?.bytes?'data:image/png;base64,'+actual.bytes.toString('base64'):undefined,observed:!!actual,started:a.started,acknowledged:a.started&&!a.error,compensationStarted:!!a.compensationStarted,compensationAcknowledged:!!a.compensationAcknowledged,restoreError:a.error,restoreUnresolved:a.unresolved,compensationError:a.compensationError,compensationConflict:a.compensationConflict,beforeCertification:historyCertification(a.before),writeAfterCertification:historyCertification(a.after),actualCertification:historyCertification(actual),failure:a.failure,compensationFailure:a.compensationFailure};
 })));
 const historyErrorFacts=(error:unknown)=>{const e=error as any;return JSON.parse(stringifyControlledJSON({message:String(error),effect:e?.effect,retainedTemporary:e?.retainedTemporary,identity:e?.identity,warnings:e?.warnings,receiptError:e?.receiptError===undefined?undefined:String(e.receiptError)}));};
 const verifyHistoryBefore=async(o:HOperation,bindingPersisted=false)=>{
  await historyPhysical(o);
  for(const [file,before] of o.inventory){if(bindingPersisted&&[path.join(o.lease.root,'.storyboard-workbench/storyboard.project.json'),path.join(o.lease.root,'storyboard-script.md')].includes(file))continue;const now=await historyVersion(o.lease,file),a=o.assets.find(a=>a.file===file);
   if(a?.started){if(before.bytes===null?now.bytes!==null:now.bytes===null||!now.bytes.equals(before.bytes))throw new Error('History compensation before bytes/absence mismatch');
    if(!a.after||!sameHVersion(now,a.after))throw new Error('History compensated native identity changed');
   }else if(!sameHVersion(now,before))throw new Error('History untouched before version changed');
  }
 };
 const retainHistoryFailure=async(o:HOperation)=>{
  const l=o.lease,facts={schema:'swb.history-operation-failure.v1',operation:o.id,project:o.project,assets:historyFacts(o),invalidated:o.invalidated};
  await historyPhysical(o);const present:string[]=[];
  for(const file of o.inventory.keys())if((await historyVersion(l,file)).bytes!==null)present.push(file);
  const currentPolicy=(await native({phase:'capturePolicy',sources:present})).sourcePolicy;
  const archiveLease:Lease={...l,sourcePolicy:intersectRecoveryPolicies([l.sourcePolicy,currentPolicy])};
  const assets=l.offer.assets.filter(a=>!a.role.startsWith(`history-failure/${o.id}/`));
  for(const [i,a] of o.assets.entries())for(const [kind,b] of [['before',a.before.bytes],['desired',a.desired],['actual',a.after?.bytes]] as const)if(b){assets.push(await raster(b,`history-failure/${o.id}/${i}/${kind}`,`history_${o.id}_${i}_${kind}`));}
  const offer={...l.offer,revision:'history-failed:'+o.id,assets,requiredAssetIds:assets.map(a=>a.assetId),effectFacts:{state:'ordinary-failed',previous:l.offer.effectFacts,historyOperation:facts},continuationState:{stage:'ordinary-failed',notExecutable:true}};
  l.facts=facts;await retainExact(archiveLease,offer);l.offer=offer;
 };
 const recoverHistory=async(o:HOperation)=>{
  if(o.preserved)throw new Error('History operation preserved without execution authority');
  await historyPhysical(o);o.state='failed';const fact=ordinaryFacts.get(o.lease.root);if(fact)fact.stage='failed';
  for(const a of [...o.assets].reverse()){
   if(!a.started)continue;
   try{const actual=await historyVersion(o.lease,a.file);a.observed=actual;
    if(a.before.bytes===null?actual.bytes===null:actual.bytes!==null&&actual.bytes.equals(a.before.bytes)){a.after=actual;continue;}
    if(!a.after||!sameHVersion(actual,a.after)||a.unresolved){
     if(a.after?.bytes&&actual.bytes&&!a.error&&!a.compensationStarted&&!sameHVersion(actual,a.after))a.compensationConflict={kind:'write-after-conflict-before-compensation',origin:'unknown',notExecutable:true};
     a.unresolved=true;throw new Error('History write-after identity/bytes unknown or independently replaced');
    }
    // Only this already-started, exact write-after path. No renderer payload is
    // used to choose bytes, destinations, or whether a failed fact can execute.
    const p={folderPath:o.lease.root,bitmapPath:a.bitmapPath};
    a.compensationStarted=true;
    await withProducerPngEffects(producerEffectsPhysical(o.lease,a.before.bytes===null?'layers:deletePng':'layers:writePng'),()=>a.before.bytes===null?deleteLayerPng(p):writeLayerPng({...p,dataUrl:'data:image/png;base64,'+a.before.bytes.toString('base64')}));
    a.after=await historyVersion(o.lease,a.file);a.observed=a.after;a.compensationAcknowledged=true;
   }catch(error){a.compensationError=String(error);a.compensationFailure=historyErrorFacts(error);try{a.observed=await historyVersion(o.lease,a.file);}catch{a.observed=undefined;}}
  }
  if(o.assets.every(a=>!a.unresolved&&!a.compensationError)){try{await verifyHistoryBefore(o);o.state='restored';}catch(error){o.assets[0].compensationError=String(error);}}
  await retainHistoryFailure(o);return {assets:historyFacts(o),compensated:o.state==='restored'};
 };
 // Original effects can settle after document invalidation. This private port
 // keeps physical/custody checks but never grants the old caller a new write.
 const producerEffectsPhysical=(l:Lease,channel:string)=>producerEffects({sender:l.sender,senderFrame:l.frame} as Event,l,channel,true);
 const beginHistoryAssets=async(e:Event,p:any)=>withLayerFileOperation(async()=>{
  current(e);configured();const root=p?.folderPath;
  if(typeof root!=='string'||root!==await fs.realpath(root)||ordinaryFacts.has(root)||historyByRoot.has(root))throw new Error('History Root already unsettled or aliased');
  if(!(await protectedRoots([root])).length)return {operation:null};
  supported(p.project);supported(p.targetProject);
  if(p.project.id!==p.targetProject.id||!Array.isArray(p.assets)||!p.assets.length||p.assets.length>configured().assets||new Set(p.assets.map((a:any)=>a.bitmapPath)).size!==p.assets.length)throw new Error('History finite inventory required');
  const paths=new Set([...terminalPaths(root,p.project),...terminalPaths(root,p.targetProject)]);
  for(const a of p.assets){const file=path.resolve(root,a.bitmapPath);if(path.relative(root,file)!==a.bitmapPath||!a.bitmapPath.startsWith('.storyboard-workbench/layers/')||!a.bitmapPath.endsWith('.png')||!paths.has(file))throw new Error('History asset outside source/target inventory');}
  if(!await rootRetired(root))throw new Error('History Root not retired');
  const l=await ordinaryLease(e,root);await authentic(e,l);
  const sourceShape=(p:any)=>dependencyShots(p).map((s:any)=>[s.id,s.imagePath,s.fileName,s.swb?.canvasWidth,s.swb?.canvasHeight,s.layers.map((a:any)=>[a.id,a.kind,a.bitmapPath,a.width,a.height])]);
  if(p.project.id!==l.result.project.id||stringifyControlledJSON(sourceShape(p.project))!==stringifyControlledJSON(sourceShape(l.result.project)))throw new Error('History original Project source inventory mismatch');
  const custody=await custodyFor(l),known=new Set([...terminalPaths(root,l.result.project),...l.sourcePolicy.observed.map((v:any)=>v[0]),...custody.records.map(v=>path.resolve(root,v.file))]);
  for(const file of paths)if(!known.has(file)&&file!==path.join(root,'storyboard-script.md'))throw new Error('History target inventory lacks authenticated provenance');
  const o:HOperation={id:randomUUID(),lease:l,project:cloneControlled(p.project),targetProject:cloneControlled(p.targetProject),assets:[],inventory:new Map(),next:0,state:'active',invalidated:false};
  try{
   let bytes=0;for(const file of paths){const v=await historyVersion(l,file);bytes+=v.bytes?.length??0;if(bytes>configured().bytes)throw new Error('History before inventory byte budget');o.inventory.set(file,v);}
   for(const a of p.assets){let desired:Buffer|null=null;if(a.dataUrl!==undefined){if(!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(a.dataUrl))throw new Error('History PNG encoding');desired=decodeControlledBase64(a.dataUrl.split(',')[1]);bytes+=desired.length;if(bytes>configured().bytes)throw new Error('History desired byte budget');const decoded=await raster(desired,'history/desired','history_desired'),layer=dependencyShots(p.targetProject).flatMap((s:any)=>s.layers).find((v:any)=>v.bitmapPath===a.bitmapPath);if(!layer||decoded.encoding!=='png'||decoded.width!==layer.width||decoded.height!==layer.height)throw new Error('History desired PNG dimensions/encoding');}
    const file=path.resolve(root,a.bitmapPath);o.assets.push({bitmapPath:a.bitmapPath,file,before:o.inventory.get(file)!,desired,started:false});}
   for(const [file,v] of o.inventory)if(!sameHVersion(v,await historyVersion(l,file)))throw new Error('History complete before inventory changed');
   await authentic(e,l);await ordinary(e,'history:admit',p,[...paths],async()=>undefined);
   if(!ordinaryFacts.has(root))throw new Error('History prepared Root required');
   historyOperations.set(o.id,o);historyByRoot.set(root,o);return {operation:o.id};
  }catch(error){throw error;}
 });
 const stepHistoryAssets=async(e:Event,p:any)=>withLayerFileOperation(async()=>{
  const o=await historyCaller(e,p.operation);if(o.state!=='active'||p.index!==o.next||!Number.isSafeInteger(p.index)||!o.assets[p.index])throw new Error('History next effect mismatch');
  const a=o.assets[p.index],now=await historyVersion(o.lease,a.file);
  // Restrictions are freshly inspected and the native writer decides current
  // write permission (e.g. chmod 0400 after the first asset). This is not cached
  // authorization; bytes/physical source must still be the admitted version.
  if(a.before.physical!==now.physical||(a.before.bytes===null?now.bytes!==null:now.bytes===null||!a.before.bytes.equals(now.bytes)))throw new Error('History before effect changed');
  await authentic(e,o.lease);if(o.invalidated)throw new Error('History original document invalidated before effect');a.started=true;
  let receipt:ProducerPngReceipt|undefined,deletedReceipt=false;
  try{const payload={folderPath:o.lease.root,bitmapPath:a.bitmapPath},ports=producerEffectsPhysical(o.lease,a.desired===null?'layers:deletePng':'layers:writePng');
   await withProducerPngEffects({...ports,written:async r=>{receipt=r;await ports.written(r);},deleted:async file=>{if(file===a.file)deletedReceipt=true;await ports.deleted(file);}},()=>a.desired===null?deleteLayerPng(payload):writeLayerPng({...payload,dataUrl:'data:image/png;base64,'+a.desired.toString('base64')}));
   a.after=await historyVersion(o.lease,a.file);if(a.desired===null?a.after.bytes!==null:a.after.bytes===null||!a.after.bytes.equals(a.desired))throw new Error('History exact effect readback mismatch');o.next++;
   if(o.invalidated){await recoverHistory(o);throw new Error('History original document invalidated');}await authentic(e,o.lease);return true;
  }catch(error){a.error=String(error);a.failure=historyErrorFacts(error);a.unresolved=/PNG_COMMITTED|PNG_UNKNOWN|retained staging/u.test(String(error));o.state='failed';ordinaryFacts.get(o.lease.root)!.stage='failed';
   try{const observed=await historyVersion(o.lease,a.file);a.observed=observed;
    const beforeEqual=observed.physical===a.before.physical&&(a.before.bytes===null?observed.bytes===null:observed.bytes!==null&&a.before.bytes.equals(observed.bytes)),receiptEqual=!!receipt&&receipt.filePath===a.file&&observed.physical===`${receipt.identity.dev}:${receipt.identity.ino}`&&observed.bytes!==null&&observed.bytes.equals(receipt.bytes);
    if(beforeEqual||receiptEqual||deletedReceipt&&observed.bytes===null)a.after=observed;else{a.after=undefined;a.unresolved=true;}
   }catch{a.after=undefined;a.unresolved=true;}await retainHistoryFailure(o);throw error;}
 });
 const compensateHistoryAssets=async(e:Event,p:any)=>withLayerFileOperation(async()=>recoverHistory(await historyCaller(e,p.operation)));
 const historyPersistence=async(e:Event,root:string,project:any)=>{
  const o=historyByRoot.get(root);if(!o)return;
  await authentic(e,o.lease);if(o.invalidated||o.preserved)throw new Error('History original document cannot persist');
  if(o.state==='restored'){await verifyHistoryBefore(o,ordinaryFacts.get(root)?.stage==='persisted');
   const shape=(p:any)=>dependencyShots(p).map((s:any)=>[s.id,s.imagePath,s.fileName,s.swb,s.layers]);
   if(project.id!==o.project.id||stringifyControlledJSON(shape(project))!==stringifyControlledJSON(shape(o.project)))throw new Error('History compensation original source Project mismatch');
  }else{
   if(o.state!=='active'||o.next!==o.assets.length)throw new Error('History effects not fully settled');
   const shape=(p:any)=>dependencyShots(p).map((s:any)=>[s.id,s.imagePath,s.fileName,s.swb?.canvasWidth,s.swb?.canvasHeight,s.layers.map((a:any)=>[a.id,a.kind,a.bitmapPath,a.width,a.height])]);
   if(project.id!==o.targetProject.id||stringifyControlledJSON(shape(project))!==stringifyControlledJSON(shape(o.targetProject)))throw new Error('History successful original target Project mismatch');
  }
 };

 // Observe complete original business dependencies before an ordinary effect.
 // This RAM-only capability carries no writer, Save, retirement or ACK authority.
 const pinOrdinarySources=async(e:Event,o:Observation,targets:readonly string[])=>{
  await authenticObservation(e,o);
  if(o.preservation){
   for(const file of targets)if(file!==o.folderPath&&!o.preservation.files.has(file))throw new Error('Ordinary effect adds an unobserved source dependency');
   return;
  }
  const metadataBytes=await readExact(o.metadataPath),project=parseControlledJSON(metadataBytes);
  supported(project);
  const paths=terminalPaths(o.folderPath,project),files=new Map<string,Buffer>(),parents=new Map<string,string>();
  for(const file of new Set([...paths,...targets])){
   if(file===o.folderPath)continue;
   await canonicalPath(o.folderPath,file);files.set(file,await readExact(file));
   for(let dir=path.dirname(file);dir!==o.folderPath;dir=path.dirname(dir))parents.set(dir,await identity(dir));
  }
  if([...files.values()].reduce((n,b)=>n+b.length,0)>configured().bytes)throw new Error('Ordinary pre-effect source byte budget');
  const sourcePolicy=(await native({phase:'capturePolicy',sources:[...files.keys()]})).sourcePolicy;
  for(const [file,b] of files)if(!(await readExact(file)).equals(b))throw new Error('Ordinary pre-effect source changed');
  const again=(await native({phase:'capturePolicy',sources:[...files.keys()]})).sourcePolicy;
  if(stringifyControlledJSON(again)!==stringifyControlledJSON(sourcePolicy))throw new Error('Ordinary pre-effect source restrictions changed');
  const assets=await captureCurrentAssets(o.folderPath,project),operation=randomUUID();
  for(const [file,b] of files)if(!paths.includes(file)&&/\.(png|tiff?)$/iu.test(file))assets.push(await raster(b,'ordinary-source/'+assets.length,'ordinary_source_'+assets.length));
  const sourceInventory=[...files].map(([file,b])=>({file:path.relative(o.folderPath,file),digest:hash(b),source:sourcePolicy.observed.find((v:any)=>v[0]===file),...(/\.(json|md)$/iu.test(file)?{bytes:b.toString('base64')}:{})}));
  await authenticObservation(e,o);
  o.preservation={operation,project:cloneControlled(project),files,parents,sourcePolicy,offer:{revision:'ordinary-observed:'+operation,projectRaw:project,viewState:{},scriptState:{ordinaryPreservation:{schema:'swb.ordinary-source-inventory.v1',operation,sourceInventory,parents:[...parents].map(([dir,physical])=>({dir:path.relative(o.folderPath,dir),identity:physical}))},original:{metadataPath:o.metadataPath,metadataBytes:metadataBytes.toString('base64'),scriptPath:path.join(o.folderPath,'storyboard-script.md'),scriptBytes:files.get(path.join(o.folderPath,'storyboard-script.md'))!.toString('base64'),sourcePolicy}},effectFacts:{state:'ordinary-observed',operation},continuationState:{stage:'ordinary-observed',notExecutable:true},assets,requiredAssetIds:assets.map(a=>a.assetId)}};
 };
 const verifyOrdinaryBefore=async(e:Event,l:Lease,before:OrdinaryBefore)=>{
  await authentic(e,l);
  for(const [dir,physical] of before.parents)if(await identity(dir)!==physical)throw new Error('Ordinary before parent identity changed');
  for(const [file,old] of before.files){await canonicalPath(l.root,file);if(await identity(file)!==old.physical||!(await readExact(file)).equals(old.bytes))throw new Error('Ordinary before source bytes/identity changed');}
  const policy=(await native({phase:'capturePolicy',sources:[...before.files.keys()]})).sourcePolicy;
  if(stringifyControlledJSON(policy)!==stringifyControlledJSON(before.policy))throw new Error('Ordinary before source restrictions changed');
  await authentic(e,l);
 };
 const captureOrdinaryBefore=async(e:Event,l:Lease):Promise<OrdinaryBefore>=>{
  const paths=terminalPaths(l.root,l.result.project,(l.offer.continuationState as any)?.deletedDependencies??[]);
  const files=new Map<string,{bytes:Buffer;physical:string}>(),parents=new Map<string,string>();let bytes=0;
  for(const file of paths){await canonicalPath(l.root,file);const physical=await identity(file),data=await readExact(file);bytes+=data.length;if(bytes>configured().bytes)throw new Error('Ordinary before source budget');files.set(file,{physical,bytes:data});for(let dir=path.dirname(file);dir!==l.root;dir=path.dirname(dir))parents.set(dir,await identity(dir));}
  const policy=(await native({phase:'capturePolicy',sources:paths})).sourcePolicy;
  const before={offer:cloneControlled(l.offer),project:cloneControlled(l.result.project),files,parents,policy};
  const original=(before.offer.scriptState as any)?.original;
  if(!original||!decodeControlledBase64(original.metadataBytes).equals(files.get(path.join(l.root,'.storyboard-workbench/storyboard.project.json'))!.bytes)||!decodeControlledBase64(original.scriptBytes).equals(files.get(path.join(l.root,'storyboard-script.md'))!.bytes))throw new Error('Ordinary before binding bytes changed');
  // The existing before capture must describe these actual file versions too.
  const assets=await captureCurrentAssets(l.root,before.project,(l.offer.continuationState as any)?.deletedDependencies??[]);
  for(const a of assets){const recorded=before.offer.assets.find(v=>v.assetId===a.assetId&&v.role===a.role);if(!recorded||!copyControlledBuffer(recorded.bytes).equals(copyControlledBuffer(a.bytes)))throw new Error('Ordinary before asset association changed');}
  await verifyOrdinaryBefore(e,l,before);return before;
 };
 const ordinaryOperation=async(e:Event,channel:string,payload:any,targets:readonly string[],execute:()=>Promise<any>)=>withLayerFileOperation(async()=>{
  current(e);const roots=await protectedRoots(targets);
  if(!roots.length){
   const document=documentFor(e);const observed=[...observations.values()].filter(o=>o.sender===e.sender&&o.document===document&&targets.some(t=>t===o.folderPath||t.startsWith(o.folderPath+path.sep)));
   for(const o of observed)await authenticObservation(e,o);
   await assertPhysicalWorkspaceWriterTargets(targets);
   for(const o of observed)if(channel.startsWith('layers:')){
    try{await pinOrdinarySources(e,o,targets);}catch(error){o.preservationError=String(error);}
   }
   const facts=observed.map(o=>{const fact={channel,state:'started',targets:[...targets],nativeRefusal:false,error:undefined as string|undefined,settlementError:undefined as string|undefined,failure:undefined as unknown};o.facts.push(fact);return {o,fact};});
   const finalize=async()=>{for(const {o} of facts){
    // Binding was consumed at the original mkdir receipt, not by later existence.
    await authenticObservation(e,o);
   }};
   try{const result=await withWorkspaceInitialization(observed.filter(o=>o.parentIdentity===null).map(o=>({parent:path.join(o.folderPath,'.storyboard-workbench'),created:async()=>{if(o.rootIdentity!==await identity(o.folderPath))throw new Error('Observed workspace incarnation changed');if(o.parentIdentity!==null)throw new Error('Observed parent creator receipt repeated');o.parentIdentity=await identity(path.join(o.folderPath,'.storyboard-workbench'));await authenticObservation(e,o);}})),execute);await finalize();for(const {o,fact} of facts){fact.state=result?.ok===false||result?.recoveryIncomplete?'failed':'settled';if(result?.project)o.project=cloneControlled(result.project);if(channel==='workspace:autosave'&&payload?.project)o.project=cloneControlled(payload.project);}return result;}
   catch(error){
    for(const {fact} of facts){fact.state='failed';fact.error=String(error);fact.failure=historyErrorFacts(error);fact.nativeRefusal=error instanceof ProtectedLayerWriteError&&error.effect==='refused'&&error.retainedTemporary===null&&targets.includes(error.filePath);}
    // A real producer failure and a changed document/physical binding are two
    // distinct facts. Finalization never grants old-document authority, but its
    // rejection must not replace the native committed/refused/unknown receipt.
    try{await finalize();}catch(settlementError){
     for(const {fact} of facts)fact.settlementError=String(settlementError);
     if(error instanceof Error&&Object.isExtensible(error)){
      Object.assign(error,{settlementError:String(settlementError)});
      error.message+=`; original Root settlement: ${String(settlementError)}`;
     }else throw new AggregateError([error,settlementError],`${String(error)}; original Root settlement: ${String(settlementError)}`);
    }
    throw error;
   }
  }
  if(roots.length!==1)throw new Error('Ordinary operation touches multiple protected physical Roots');const root=roots[0];
  // Pure open/derived observations do not retire a producer, nor borrow its
  // in-flight authority. Their pre-existing physical guard remains unchanged.
  if(['workspace:openFolderByPath','workspace:startFolderWatch','workspace:checkExternalChanges','workspace:checkStoryboardScript'].includes(channel)){
   const document=documentFor(e);const observed=[...observations.values()].filter(o=>o.sender===e.sender&&o.document===document&&targets.some(t=>t===o.folderPath||t.startsWith(o.folderPath+path.sep)));
   for(const o of observed)await authenticObservation(e,o);
   await assertPhysicalWorkspaceWriterTargets(targets);
   const facts=observed.map(o=>{const fact={channel,state:'started',error:undefined as string|undefined};o.facts.push(fact);return {o,fact};});
   try{const result=await withDerivedPreviewReceipt(async receipt=>{
    if(channel!=='workspace:openFolderByPath'||receipt.root!==root)throw new Error('Derived preview outside actual reader');
    const {state}=await readState(root),tip=state.content!,terminal=(tip.continuationState as any)?.terminal;
    if(state.state!=='protectedReadable'||!terminal||terminal.schema!=='swb.current-terminal.v1'||stringifyControlledJSON(recoveryProjectAbsence(receipt.original))!==stringifyControlledJSON(recoveryProjectAbsence(tip.projectRaw)))throw new Error('Derived preview original current terminal mismatch');
    for(const image of receipt.images){if(!terminal.files.some((f:any)=>f.file===path.relative(root,image.source)&&f.digest===image.sourceDigest))throw new Error('Derived preview terminal source mismatch');await canonicalPath(root,image.preview);if(hash(await readExact(image.preview))!==image.previewDigest)throw new Error('Derived preview receipt changed');}
    const policy=(await native({phase:'captureMemoryPolicy',sources:receipt.images.flatMap(i=>[i.source,i.preview])})).sourcePolicy;
    for(const {o} of facts){await authenticObservation(e,o);o.derived={receipt:cloneControlled(receipt),policy,seal:state.ack!.sealDigest};}
   },execute);for(const {o,fact} of facts){await authenticObservation(e,o);fact.state='settled';if(result?.project)o.project=cloneControlled(result.project);}
    if(channel==='workspace:openFolderByPath'){
     const {state}=await readState(root);if(state.state!=='protectedReadable')throw new Error('Cold History full inventory unavailable');
     const l=await ordinaryLease(e,root);await custodyFor(l);await authentic(e,l);
     const reader=facts.find(({o})=>o.folderPath===root)?.o;if(reader)readerLeases.set(l,reader);
     const history=(state.content!.viewState as any)?.history;
     if(history!==undefined)return {...result,recoveryHistory:cloneControlled(history)};
    }
    return result;
   }
   catch(error){for(const {fact} of facts){fact.state='failed';fact.error=String(error);}throw error;}
  }
  for(const target of targets){if(target!==root&&!target.startsWith(root+path.sep))throw new Error('Ordinary destination outside exact Root');if(['/workspace-recovery-v1','/workspace-recovery-v2'].some(name=>target.includes(name)))throw new Error('Ordinary recovery-namespace target refused');await canonicalPath(root,target===root?path.join(root,'.storyboard-workbench'):target);}
  const historyOperation=historyByRoot.get(root);
  if(historyOperation&&channel!=='workspace:autosave')throw new Error('History operation excludes ordinary producers');
  if(channel==='workspace:autosave'){if(payload.folderPath!==root||payload.metadataPath!==path.join(root,'.storyboard-workbench/storyboard.project.json'))throw new Error('Ordinary persist binding mismatch');supported(payload.project);await historyPersistence(e,root,payload.project);}
  let fact=ordinaryFacts.get(root);
  if(fact){await authentic(e,fact.lease);if(fact.stage!=='pending'&&!(channel==='workspace:autosave'&&historyOperation?.state==='restored'&&fact.stage==='failed'))throw new Error('Ordinary producer failed or awaiting exact ACK; Root protected');}
  else{
   if(!await rootRetired(root))throw new Error('Physical workspace is protected by a recovery inventory left by an earlier session that did not close cleanly; nothing on disk was changed. Use "Read recovery content only" to inspect and recover it.');
   const l=await ordinaryLease(e,root);readerLeases.delete(l);fact={lease:l,nonce:randomUUID(),stage:'pending',channels:[],sourcePin:retired.get(root)?.sourcePin};ordinaryFacts.set(root,fact);retired.delete(root);
   try{const deleted=(l.offer.continuationState as any)?.deletedDependencies??[],paths=terminalPaths(root,l.result.project,deleted);
    const policy=(await native({phase:'capturePolicy',sources:paths})).sourcePolicy;if(stringifyControlledJSON(policy.expected)!==stringifyControlledJSON((l.sourceAuthorityPolicy??l.sourcePolicy).expected))throw new Error('Ordinary source restriction intersection changed');
    // Legacy has no historical final pin. Bind this NEW operation to its
    // actual pre-effect Native observation, without updating the old terminal
    // or authorizing a legacy fast path from this observation.
    fact.sourcePin??=policy;
    const assets=await captureCurrentAssets(root,l.result.project,deleted);
    const offer:RecoveryOffer={...l.offer,assets,requiredAssetIds:assets.map(a=>a.assetId),scriptState:{original:{...(l.offer.scriptState as any).original,metadataBytes:(await readExact(path.join(root,'.storyboard-workbench/storyboard.project.json'))).toString('base64'),scriptBytes:(await readExact(path.join(root,'storyboard-script.md'))).toString('base64'),sourcePolicy:policy}},revision:`ordinary-started:${fact.nonce}`,projectRaw:l.result.project,effectFacts:{state:'ordinary-unsettled',channels:[channel]},continuationState:{stage:'ordinary-unsettled',notExecutable:true,deletedDependencies:deleted}};
    await retainExact(l,offer);l.offer=offer;
    if(channel==='layers:writePng'&&targets.every(target=>target===root||terminalPaths(root,l.result.project,deleted).includes(target))){const before=await captureOrdinaryBefore(e,l);fact.attempt={before,active:0,callbacks:0,operations:0,signals:0,errors:[]};}
   }catch(error){fact.stage='failed';throw error;}
  }
  const own=fact,metadataAttempt=historyOperation&&channel==='workspace:autosave'?cloneControlled(payload.project):undefined;let originalCallbackStarted=false;own.channels.push(channel);
  if(metadataAttempt)historyOperation!.metadataObservation=undefined;
  try{
   const attempt=own.attempt,ports=producerEffects(e,own.lease,channel);
   if(attempt){attempt.active++;attempt.callbacks++;}
   const observed=await observeLayerFileOperations(()=>withProducerPngEffects({
    physicalWrite:ports.physicalWrite,
    beforeWrite:async file=>{if(attempt)attempt.signals++;await ports.beforeWrite(file);},
    written:async receipt=>{if(attempt)attempt.signals++;await ports.written(receipt);},
    beforeDelete:async file=>{if(attempt)attempt.signals++;await ports.beforeDelete(file);},
    deleted:async file=>{if(attempt)attempt.signals++;await ports.deleted(file);}
   },()=>{originalCallbackStarted=true;return execute();}));
   if(attempt){attempt.active--;attempt.operations+=observed.started;attempt.errors.push(...observed.errors.map(String));if(!observed.outcome.ok)attempt.callbackError=String(observed.outcome.error);}
   if(!observed.outcome.ok)throw observed.outcome.error;
   const result=observed.outcome.value;await authentic(e,own.lease);
   if(result?.ok===false||result?.recoveryIncomplete===true){own.stage='failed';own.lease.facts={state:'ordinary-failed',channels:own.channels,result};return result;}
   if(channel==='workspace:autosave'){
    if(payload.folderPath!==root||payload.metadataPath!==path.join(root,'.storyboard-workbench/storyboard.project.json'))throw new Error('Ordinary persist binding mismatch');supported(payload.project);
    const json=await readExact(payload.metadataPath),md=await readExact(path.join(root,'storyboard-script.md'));
    if(!json.equals(encodeControlledUTF8(`${stringifyControlledJSON(payload.project,null,2)}\n`))||!md.equals(encodeControlledUTF8(serializeStoryboardScriptMarkdown(payload.project))))throw new Error('Ordinary current JSON/MD readback mismatch');
    if(historyOperation){
     // Only the original successful persistence call may certify new JSON/MD.
     // Close must never infer a partial publication from a later observation.
     const binding=new Map<string,HVersion>();
     for(const file of [payload.metadataPath,path.join(root,'storyboard-script.md')])binding.set(file,await historyVersion(own.lease,file));
     if(!binding.get(payload.metadataPath)!.bytes?.equals(json)||!binding.get(path.join(root,'storyboard-script.md'))!.bytes?.equals(md))throw new Error('History original persistence version changed');
     historyOperation.binding=binding;
    }
    own.project=parseControlledJSON(json);own.deleted=cloneControlled(payload.recoveryContent?.deletedDependencies??[]);own.stage='persisted';
    return {...result,ordinaryPersistenceNonce:own.nonce,...(historyOperation?{historyOperation:historyOperation.id}:{})};
   }
   return result;
  }catch(error){
   own.stage='failed';own.lease.facts={state:'ordinary-failed',channels:own.channels,error:String(error),previous:own.lease.facts};
   if(historyOperation&&metadataAttempt&&originalCallbackStarted&&!historyOperation.binding&&!historyOperation.invalidated&&!historyOperation.preserved){
    try{
     await authentic(e,own.lease);await historyPhysical(historyOperation);
     const versions=new Map<string,HVersion>();
     for(const file of [path.join(root,'.storyboard-workbench/storyboard.project.json'),path.join(root,'storyboard-script.md')])versions.set(file,await historyVersion(own.lease,file));
     for(const [file,version] of versions)if(!sameHVersion(version,await historyVersion(own.lease,file)))throw new Error('Original failed metadata observation changed');
     await authentic(e,own.lease);
     // Observation of the failed ORIGINAL call only, never a publication
     // receipt, successful binding, ACK, or Close-time inference of its effects.
     historyOperation.metadataObservation={kind:'original-callback-failure-observation',error:String(error),attemptedProject:metadataAttempt,versions};
    }catch(observationError){own.lease.facts={original:own.lease.facts,metadataObservationError:String(observationError)};}
   }
   throw error;
  }
 });
 type ImportPin={observation:Observation;inventory:Awaited<ReturnType<typeof partialSourceInventory>>;project:any;preparation:ImportFailureEvidence;nonce:string;p1:string;failure:any};
 const importFailures=new Map<string,ImportPin>();
 const ordinary=async(e:Event,channel:string,payload:any,targets:readonly string[],execute:()=>Promise<any>)=>withLayerFileOperation(async()=>{
  if(channel!=='workspace:importSwbFormat'||payload?.normalSave!==true||payload.normalSaveImageImport!==true)return ordinaryOperation(e,channel,payload,targets,execute);
  const o=[...observations.values()].find(v=>v.sender===e.sender&&v.document===documentFor(e)&&v.folderPath===payload.folderPath);
  let before:Awaited<ReturnType<typeof partialSourceInventory>>|undefined;
  // Unsupported inventories follow the original Import path, without new rights.
  if(o)try{await authenticObservation(e,o);before=await partialSourceInventory(o.folderPath);}catch{}
  // IPC structured clone carries optional undefined fields, while durable
  // captures are JSON. Bind both to the same nonexecuting JSON representation.
  const facts:ImportFailureEvidence[]=[],nonce=randomUUID(),project=parseControlledJSON(encodeControlledUTF8(stringifyControlledJSON(payload.project))),p1=hash(stringifyControlledJSON(payload));
  try{return await ordinaryOperation(e,channel,payload,targets,()=>withImportFailureEvidence(f=>facts.push(f),execute));}
  catch(error){
   if(o&&before&&facts.length===1)try{
    await authenticObservation(e,o);const preparation=facts[0];
    // Real exclusive-creation collision; never a no-effect or cleanup receipt.
    if(preparation.code!=='EEXIST'||preparation.syscall!=='mkdir'||preparation.preparationStarted||!preparation.candidatePath.startsWith(path.join(o.folderPath,'.storyboard-workbench/import-tmp')+path.sep))throw new Error('Import failure not in certified finite domain');
    const inventory=await partialSourceInventory(o.folderPath);
    const candidate=path.relative(o.folderPath,preparation.candidatePath),parent=path.dirname(candidate),leaf=path.basename(candidate);
    const priorCandidate=before.record.directories.some(d=>d.file===candidate);
    const comparable=priorCandidate?inventory.record:{...inventory.record,directories:inventory.record.directories.filter(d=>d.file!==candidate).map(d=>d.file===parent?{...d,names:d.names.filter(n=>n!==leaf)}:d)};
    if(!isDeepStrictEqual(before.record,comparable))throw new Error('Import failure original inventory changed');
    for(const shot of dependencyShots(project))if(!inventory.buffers.has(shot.imagePath))throw new Error('Import candidate source unavailable');
    importFailures.set(o.folderPath,{observation:o,inventory,project,preparation,nonce,p1,failure:{message:String(error),code:(error as any)?.code??null,syscall:(error as any)?.syscall??null,path:(error as any)?.path??null}});
   }catch{}
   throw error;
  }
 });
 const importProjectSupported=(project:any,original:any)=>{
  if(!project||project.id!==original.id||!Array.isArray(project.shots)||project.pendingDeletedShots?.length)throw new Error('Import continuation Project binding');
  const external=dependencyShots(original).filter((s:any)=>s.swb?.status!=='owned');
  const pending=dependencyShots(project).filter((s:any)=>s.swb?.status!=='owned');
  if(new Set(pending.map((s:any)=>s.id)).size!==pending.length)throw new Error('Import candidate membership changed');
  const structural=(s:any)=>{const v=parseControlledJSON(encodeControlledUTF8(stringifyControlledJSON(s)));delete v.scriptText;return v;};
  for(const s of pending){const old=external.find((v:any)=>v.id===s.id);if(!old||!isDeepStrictEqual(structural(s),structural(old)))throw new Error('Import candidate source cannot be changed or reimported');}
  supported({...project,shots:project.shots.filter((s:any)=>s.swb?.status==='owned'),parkedShots:(project.parkedShots??[]).filter((s:any)=>s.swb?.status==='owned')});
 };
 const retainedImport=async(e:Event,c:any,pin:ImportPin)=>{
  const o=pin.observation;
  const validate=async()=>{await authenticObservation(e,o);if(importFailures.get(o.folderPath)!==pin||!isDeepStrictEqual((await partialSourceInventory(o.folderPath)).record,pin.inventory.record))throw new Error('Import original failure/source inventory changed');};
  await validate();importProjectSupported(c.content?.projectRaw,pin.project);
  if(!c.history||!Array.isArray(c.history.undo)||!Array.isArray(c.history.redo)||c.history.undo.length+c.history.redo.length>configured().records||c.content.retainedAssetIntents?.length||c.content.desiredAssets?.length||c.canvas?.hasUnsettledGesture||!Array.isArray(c.canvas?.captures))throw new Error('Import settled view and dual History required');
  const layerSource=(shot:any,layer:any)=>{
   if(shot.swb?.status==='owned')return path.resolve(o.folderPath,layer.bitmapPath);
   // A non-SWB image has a virtual image-layer descriptor before Import.
   // Authenticate its original image; never pretend that its uncreated PNG
   // exists, materialize it, or grant an ordinary layer-writer capability.
   if(shot.layers?.length!==1||layer.kind!=='image')throw new Error('Import virtual layer source unknown');
   return shot.imagePath;
  };
  const dependencyBytes=async(project:any)=>{
   importProjectSupported(project,pin.project);
   for(const shot of dependencyShots(project)){
    if(!pin.inventory.buffers.has(shot.imagePath))throw new Error('Import Project/History base bytes unavailable');
    for(const layer of shot.layers??[]){const body=pin.inventory.buffers.get(layerSource(shot,layer));if(!body)throw new Error('Import Project/History layer bytes unavailable');const m=await sharp(body,{limitInputPixels:Math.floor(configured().bytes/4),failOn:'error'}).metadata();if(m.width!==layer.width||m.height!==layer.height)throw new Error('Import layer/source dimensions changed');}
   }
  };
  await dependencyBytes(c.content.projectRaw);
  for(const entries of [c.history.undo,c.history.redo])for(const entry of entries){
   await dependencyBytes(entry.project);
   for(const asset of entry.layerAssets??[]){
    const shot=dependencyShots(entry.project).find((s:any)=>s.layers?.some((l:any)=>l.bitmapPath===asset.bitmapPath)),layer=shot?.layers.find((l:any)=>l.bitmapPath===asset.bitmapPath);
    const body=layer&&pin.inventory.buffers.get(layerSource(shot,layer));
    if(!body||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(asset.dataUrl))throw new Error('Import History pixels have no certified retained source');
    const pixels=await sharp(decodeControlledBase64(asset.dataUrl.split(',')[1]),{limitInputPixels:Math.floor(configured().bytes/4),failOn:'error'}).ensureAlpha().raw().toBuffer({resolveWithObject:true}),retained=await sharp(body,{limitInputPixels:Math.floor(configured().bytes/4),failOn:'error'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(pixels.info.width!==retained.info.width||pixels.info.height!==retained.info.height||!pixels.data.equals(retained.data))throw new Error('Import historical version has no certified retained bytes');
   }
  }
  for(const capture of c.canvas.captures){
   if(capture.hasUnsettledGesture||capture.folderPath!==o.folderPath||!Array.isArray(capture.liveLayers))throw new Error('Import canvas binding');
   for(const layer of capture.liveLayers){
    const shot=dependencyShots(pin.project).find((s:any)=>s.id===capture.shotId),source=shot?.layers?.find((v:any)=>v.id===layer.layerId),original=source&&pin.inventory.buffers.get(layerSource(shot,source));
    if(!original||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(layer.dataUrl))throw new Error('Import canvas has unretained bytes');
    const captured=await sharp(decodeControlledBase64(layer.dataUrl.split(',')[1]),{limitInputPixels:Math.floor(configured().bytes/4),failOn:'error'}).ensureAlpha().raw().toBuffer({resolveWithObject:true}),current=await sharp(original,{limitInputPixels:Math.floor(configured().bytes/4),failOn:'error'}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(captured.info.width!==current.info.width||captured.info.height!==current.info.height||!captured.data.equals(current.data))throw new Error('Import canvas has unretained pixels');
   }
  }
  const assets:RecoveryOffer['assets']=[];
  for(const [file,bytes] of pin.inventory.buffers)if(/\.(png|tiff?)$/iu.test(file)){
   let role=`import-source/${path.relative(o.folderPath,file)}`;
   for(const shot of dependencyShots(pin.project)){if(shot.swb?.status==='owned'&&shot.imagePath===file)role=`original/${shot.id}/base`;for(const layer of shot.layers??[])if(path.resolve(o.folderPath,layer.bitmapPath)===file)role=`original/${shot.id}/${layer.id}`;}
   assets.push(await raster(bytes,role,`import_${assets.length}`));
  }
  const metadata=path.join(o.folderPath,'.storyboard-workbench/storyboard.project.json'),script=path.join(o.folderPath,'storyboard-script.md'),metadataBytes=pin.inventory.buffers.get(metadata),scriptBytes=pin.inventory.buffers.get(script);
  if(!metadataBytes||!scriptBytes)throw new Error('Import original metadata unavailable');
  const main={schema:'swb.image-import-failure.v1',operation:pin.nonce,acknowledged:false,preparation:pin.preparation,failure:pin.failure,candidateProject:pin.project};
  const offer:RecoveryOffer={revision:`import-failed:${pin.nonce}`,projectRaw:c.content.projectRaw,viewState:{canvas:c.canvas,history:c.history,selectedShotIds:c.selectedShotIds,dirtyShotIds:c.dirtyShotIds,fileNameSyncState:c.fileNameSyncState,workspaceSaveState:c.workspaceSaveState},scriptState:{imageImportFailure:main,partialSaveInventory:pin.inventory.record,original:{metadataPath:metadata,metadataBytes:metadataBytes.toString('base64'),scriptPath:script,scriptBytes:scriptBytes.toString('base64')}},effectFacts:{main,owner:c.content.effectFacts},continuationState:{stage:'failed',notExecutable:true,nonce:pin.nonce,p1:pin.p1},assets,requiredAssetIds:assets.map(a=>a.assetId)};
  let sourcePolicy=pin.inventory.record.policy;
  if(await hasRecovery(o.folderPath))sourcePolicy=intersectRecoveryPolicies([sourcePolicy,(await readState(o.folderPath)).storagePolicy]);
  const lease:Lease={sender:o.sender,frame:o.frame,window:o.window,document:o.document,root:o.folderPath,rootIdentity:o.rootIdentity,parentIdentity:o.parentIdentity!,nonce:pin.nonce,p1:pin.p1,stage:'failed',sourcePolicy,offer,facts:main};
  return {lease,offer,validate};
 };
 const acknowledgeOrdinary=async(e:Event,payload:any,fact:NonNullable<ReturnType<typeof ordinaryFacts.get>>)=>{
  const l=fact.lease;await authentic(e,l);
  await historyPersistence(e,l.root,payload.project);
  if(fact.stage!=='persisted'||payload.nonce!==fact.nonce||hash(stringifyControlledJSON(payload.project))!==hash(stringifyControlledJSON(fact.project)))throw new Error('Ordinary exact persistence ACK mismatch');
  const p=fact.project,deleted=fact.deleted??[],files=[],assets:RecoveryOffer['assets']=[];
  const paths=terminalPaths(l.root,p,deleted);
  for(const file of paths){await canonicalPath(l.root,file);const bytes=await readExact(file);files.push({file:path.relative(l.root,file),digest:hash(bytes)});}
  if(!(await readExact(paths[0])).equals(encodeControlledUTF8(`${stringifyControlledJSON(p,null,2)}\n`))||!(await readExact(paths[1])).equals(encodeControlledUTF8(serializeStoryboardScriptMarkdown(p))))throw new Error('Ordinary binding changed before ACK');
  for(const s of dependencyShots(p,deleted)){for(const d of [{file:s.imagePath,role:`original/${s.id}/base`,width:s.swb.canvasWidth,height:s.swb.canvasHeight},...s.layers.map((v:any)=>({file:path.resolve(l.root,v.bitmapPath),role:`original/${s.id}/${v.id}`,width:v.width,height:v.height}))]){const a=await raster(await readExact(d.file),d.role,`asset_${assets.length}`);if(a.width!==d.width||a.height!==d.height)throw new Error('Ordinary current raster dimensions');assets.push(a);}}
  const policy=(await native({phase:'capturePolicy',sources:paths})).sourcePolicy;if(stringifyControlledJSON(policy.expected)!==stringifyControlledJSON((l.sourceAuthorityPolicy??l.sourcePolicy).expected))throw new Error('Ordinary source restrictions changed');
  if(fact.sourcePin){
   // Add/remove/rename membership still follows the original producer,
   // custody and terminal inventory rules. An existing source's restrictions
   // cannot change silently while this admitted ordinary fact is in flight.
   if(!survivingSourceRestrictionsMatch(fact.sourcePin,policy))throw new Error('Ordinary admitted source restrictions changed');
  }
  const offer:RecoveryOffer={...l.offer,revision:`ordinary-completed:${fact.nonce}`,projectRaw:p,scriptState:{original:{...(l.offer.scriptState as any).original,metadataBytes:(await readExact(paths[0])).toString('base64'),scriptBytes:(await readExact(paths[1])).toString('base64'),sourcePolicy:policy}},effectFacts:{state:'completed-binding-persist-ack',ordinaryChannels:fact.channels},continuationState:{stage:'completed',deletedDependencies:deleted,terminal:{schema:'swb.current-terminal.v1',files,sourcePolicy:policy}},assets,requiredAssetIds:assets.map(a=>a.assetId)};
  await retainExact(l,offer);await authentic(e,l);
  ordinaryFacts.delete(l.root);l.offer=offer;l.result={project:p};
  if(!await rootRetired(l.root)){ordinaryFacts.set(l.root,fact);throw new Error('Ordinary terminal cannot retire Root');}
  const historyOperation=historyByRoot.get(l.root);if(historyOperation){historyByRoot.delete(l.root);historyOperations.delete(historyOperation.id);}return true;
 };
 const run=async(e:Event,payload:any,save:()=>Promise<any>)=>withLayerFileOperation(async()=>{
  configured();current(e);if(payload.normalSave!==true)throw new Error('Prepared Save requires actual normal Save');
  const root=await fs.realpath(payload.folderPath);if(root!==payload.folderPath)throw new Error('Save root alias refused');
  const previous=leases.get(root);if(previous&&previous.stage!=='completed')throw new Error('Unfinished Save capability cannot be replayed');
  await assertPhysicalWorkspaceWriterTargets([root]);
  let existingPolicy:any;try{existingPolicy=(await readState(root)).storagePolicy;}catch(error){if(await hasRecovery(root))throw error;}
  supported(payload.project);
  if(['unsupported','corrupt'].includes(classifyPendingBakeEnvelope(payload.project.pendingBake))||Object.values(payload.project.pendingBake?.shots??{}).some((entry:any)=>entry.state==='unknown'))throw new Error('Unsupported/corrupt/unknown Pending Save input');
  const plan=payload.renamePlan??[];if(!Array.isArray(plan)||new Set(plan.map((v:any)=>v.shotId)).size!==plan.length)throw new Error('Ambiguous finite rename plan');
  for(const r of plan){const s=payload.project.shots.find((v:any)=>v.id===r.shotId);if(!s||s.imagePath!==r.finalPath||s.fileName!==r.finalFileName||path.dirname(r.fromPath)!==root||path.dirname(r.finalPath)!==root||path.dirname(r.temporaryPath)!==root||r.temporaryPath!==path.join(root,`.storyboard-renaming-${r.shotId}${path.extname(r.fromPath)}`)||r.finalFileName!==path.basename(r.finalPath)||!/^.*\.tiff?$/iu.test(r.finalPath))throw new Error('Rename outside finite root plan');for(const file of [r.fromPath,r.finalPath,r.temporaryPath])await canonicalPath(root,file);for(const file of [r.temporaryPath,r.finalPath])if(file!==r.fromPath){try{await fs.lstat(file);throw new Error('Finite rename target already exists');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}}
  const c=payload.recoveryContent;if(!c||!Array.isArray(c.desiredAssets)||!c.effectFacts||c.effectFacts.receipt?.length||c.effectFacts.deletions?.length||c.effectFacts.remainingScript)throw new Error('Latest Owner dependency capture required');supported(c.projectRaw);
  const pendingDeleted=payload.project.pendingDeletedShots??[],deleted=c.deletedDependencies??[];
  if(!Array.isArray(deleted)||deleted.length!==pendingDeleted.length||pendingDeleted.some((d:any)=>deleted.filter((s:any)=>s.id===d.id&&s.imagePath===d.imagePath&&s.fileName===d.fileName).length!==1))throw new Error('Exact deleted-source dependency capture required');
  supported({...payload.project,shots:dependencyShots(payload.project,deleted),parkedShots:[],pendingDeletedShots:[]});
  const mapped=cloneControlled(c.projectRaw);mapped.updatedAt=payload.project.updatedAt;for(const r of plan){const s=mapped.shots.find((v:any)=>v.id===r.shotId);if(!s||s.imagePath!==r.fromPath)throw new Error('Owner before-rename source mismatch');const target=payload.project.shots.find((v:any)=>v.id===r.shotId);s.imagePath=r.finalPath;s.fileName=r.finalFileName;s.sourceFileName=target.sourceFileName;}
  if(stringifyControlledJSON(mapped)!==stringifyControlledJSON(payload.project))throw new Error('Owner raw Project/P1 mismatch');
  const metadata=path.join(root,'.storyboard-workbench/storyboard.project.json');if(payload.metadataPath!==metadata)throw new Error('Metadata binding mismatch');
  const paths=[metadata],assets:RecoveryOffer['assets']=[],versionInputs:any[]=[];
  await canonicalPath(root,metadata);
  for(const marker of ["pending-file-transaction.json"]){try{await fs.lstat(path.join(root,".storyboard-workbench",marker));throw new Error("Uncovered Pending transaction inventory");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
  const originalJSON=await readExact(metadata);parseControlledJSON(originalJSON);
  const script=path.join(root,'storyboard-script.md');let scriptBytes:Buffer|null=null;try{await canonicalPath(root,script);scriptBytes=await readExact(script);paths.push(script);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  for(const s of dependencyShots(payload.project,deleted)){
   const parked=(payload.project.parkedShots??[]).some((v:any)=>v.id===s.id),deleted=(payload.project.pendingDeletedShots??[]).some((v:any)=>v.id===s.id);
   const parent=path.dirname(s.imagePath),pending=path.join(root,'Pending');
   if(parked?parent!==pending:deleted?parent!==root&&parent!==pending:parent!==root)throw new Error('Shot source outside exact finite lifecycle location');
   const source=plan.find((r:any)=>r.shotId===s.id)?.fromPath??s.imagePath;
   const dependencies=[{file:source,role:`original/${s.id}/base`,width:s.swb.canvasWidth,height:s.swb.canvasHeight},...s.layers.map((l:any)=>{const file=path.resolve(root,l.bitmapPath);if(l.bitmapPath!==path.relative(root,file))throw new Error('Layer source alias refused');return {file,role:`original/${s.id}/${l.id}`,width:l.width,height:l.height};})];
   for(const d of dependencies){paths.push(d.file);await canonicalPath(root,d.file);const b=await readExact(d.file);const asset=await raster(b,d.role,`asset_${assets.length}`);if(asset.width!==d.width||asset.height!==d.height)throw new Error('Input raster dimensions outside finite Save domain');assets.push(asset);versionInputs.push({file:d.file,identity:await identity(d.file),digest:hash(b)});}
  }
  if(new Set(paths).size!==paths.length)throw new Error('Aliased or duplicate Save dependency');for(const file of paths)await canonicalPath(root,file);
  const sourcePolicy=(await native({phase:'capturePolicy',sources:paths})).sourcePolicy;
  const storagePolicy=intersectRecoveryPolicies([sourcePolicy,...(existingPolicy?[existingPolicy]:[])]);
  for(const d of c.desiredAssets){const s=dependencyShots(payload.project,deleted).find((v:any)=>v.id===d.shotId),layer=s?.layers.find((v:any)=>v.id===d.layerId);if(!layer||d.folderPath!==root||d.bitmapPath!==layer.bitmapPath||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(d.dataUrl))throw new Error('Unpublished desired asset cannot be omitted');const desired=await raster(decodeControlledBase64(d.dataUrl.split(',')[1]),`desired/${d.shotId}/${d.layerId}`,`asset_${assets.length}`);if(desired.encoding!=='png'||desired.width!==layer.width||desired.height!==layer.height)throw new Error('Desired PNG dimensions/encoding mismatch');assets.push(desired);}
  const nonce=randomUUID(),p1=hash(stringifyControlledJSON(payload));
  const offer:RecoveryOffer={revision:`prepared:${nonce}`,projectRaw:c.projectRaw,viewState:{sequence:c.sequence,assetRevision:c.assetRevision},scriptState:{original:{metadataPath:metadata,metadataBytes:originalJSON.toString('base64'),scriptPath:script,scriptBytes:scriptBytes?.toString('base64')??null,versionInputs,sourcePolicy}},effectFacts:c.effectFacts,continuationState:{stage:'prepared',nonce,p1,domain:'owned-single-existing-PNG-finite-rename',renamePlan:plan},assets,requiredAssetIds:assets.map(a=>a.assetId)};
  const window=options.ownerFromSender?.(e.sender)??e.sender;if(options.ownerFromSender&&!options.ownerFromSender(e.sender))throw new Error("Actual Save window unavailable");
  const l:Lease={sender:e.sender,frame:e.senderFrame!,window,document:documentFor(e),root,rootIdentity:await identity(root),parentIdentity:await identity(path.dirname(metadata)),nonce,p1,stage:'prepared',sourcePolicy:storagePolicy,sourceAuthorityPolicy:sourcePolicy,offer,facts:c.effectFacts};
  // Ownership exists before the first sidecar effect. Failed preparation keeps
  // pinned offer/facts and never claims that sourceEffects:0 means no sidecar.
  leases.set(root,l);retired.delete(root);
  try{await retainExact(l,offer);
  // Revalidate finite original versions and native policy after sidecar readback,
  // immediately before actual original stagePendingDeletedShotFiles.
  const rereadPolicy=(await native({phase:'capturePolicy',sources:paths})).sourcePolicy;if(stringifyControlledJSON(rereadPolicy)!==stringifyControlledJSON(sourcePolicy))throw new Error('Sources changed during g1 preparation');
  if(!(await readExact(metadata)).equals(originalJSON)||scriptBytes&&!(await readExact(script)).equals(scriptBytes))throw new Error('Metadata/script changed during preparation');
  for(const v of versionInputs)if(await identity(v.file)!==v.identity||hash(await readExact(v.file))!==v.digest)throw new Error('Original source changed before stage');
  await authentic(e,l);if(hash(stringifyControlledJSON(payload))!==p1)throw new Error('P1 changed before original execution');l.stage='executing';
  }catch(error){l.stage='failed';l.facts={phase:'preparation',sourceEffects:0,sidecarEffects:'partial-or-unknown',error:String(error)};throw error;}
  try{const result=await save();await authentic(e,l);if(result?.ok===false){l.stage='failed';l.facts=result.error;
    if(partialSaveFailure(result.error))try{
     const inventory=await partialSourceInventory(root),actual:RecoveryOffer['assets']=[];
     for(const [file,body] of inventory.buffers)if(/\.(png|tiff?)$/iu.test(file))actual.push(await raster(body,`partial-failure/${path.relative(root,file)}`,`partial_${actual.length}`));
     l.sourcePolicy=intersectRecoveryPolicies([l.sourcePolicy,inventory.record.policy]);
     l.offer={...l.offer,scriptState:{...l.offer.scriptState as any,partialSaveInventory:inventory.record},assets:[...l.offer.assets,...actual],requiredAssetIds:[...l.offer.assets,...actual].map(a=>a.assetId)};
    }catch(error){l.facts={...result.error,continuationInventoryError:String(error)};}
    // This already-failed Save may report its original failure after recording
    // a secondary preservation failure. Neither result is a successful ACK.
    const retentionFailed:ReservationFailureHandler=async retentionError=>{l.facts={main:result.error,retention:{message:retentionError instanceof Error?retentionError.message:String(retentionError)}};};
    try{await retainExact(l,{...l.offer,revision:`failed:${l.nonce}`,effectFacts:{main:l.facts,owner:l.offer.effectFacts},continuationState:{stage:'failed',nonce:l.nonce,p1:l.p1,notExecutable:true}},retentionFailed);}catch(retentionError){await retentionFailed(retentionError);}
    return result;}
   l.result=result;l.stage='output';return {...result,recoverySaveNonce:nonce};}catch(error){l.stage='failed';l.facts={stage:'failed',error:error instanceof Error?{name:error.name,message:error.message,...Object.fromEntries(Object.entries(error))}:String(error)};throw error;}
 });
 const persist=async(e:Event,payload:any,write:()=>Promise<any>)=>withLayerFileOperation(async()=>{
  const l=leases.get(payload.folderPath);if(payload.normalSave!==true||payload.normalSaveScriptInput!==undefined||payload.normalSaveScriptExpectedInput!==undefined)throw new Error('Binding persist outside ordinary Save domain');if(!l||typeof payload.recoverySaveNonce!=='string'||payload.recoverySaveNonce!==l.nonce||l.stage!=='output')throw new Error('Binding persist capability/stage mismatch');await authentic(e,l);
  if(payload.metadataPath!==path.join(l.root,'.storyboard-workbench/storyboard.project.json'))throw new Error('Binding persist metadata mismatch');supported(payload.project);
  if(payload.project.shots.length!==l.result.project.shots.length||payload.project.shots.some((s:any)=>!l.result.project.shots.some((v:any)=>v.id===s.id&&v.imagePath===s.imagePath&&stringifyControlledJSON(v.layers)===stringifyControlledJSON(s.layers))))throw new Error('Binding persist outside prepared asset domain');
  try{const result=await write();await authentic(e,l);
    const metadata=path.join(l.root,'.storyboard-workbench/storyboard.project.json'),script=path.join(l.root,'storyboard-script.md');for(const file of [metadata,script])await canonicalPath(l.root,file);
    if(!(await readExact(metadata)).equals(encodeControlledUTF8(`${stringifyControlledJSON(payload.project,null,2)}\n`))||!(await readExact(script)).equals(encodeControlledUTF8(serializeStoryboardScriptMarkdown(payload.project))))throw new Error('Exact binding JSON/MD readback mismatch');
    for(const ack of l.result.normalSaveOutputs??[])if(hash(await readExact(ack.targetPath))!==ack.outputHash)throw new Error('Output changed before final binding persist ACK');
    l.result={...l.result,project:cloneControlled(payload.project)};l.stage='persisted';return result;}catch(error){l.stage='failed';throw error;}
 });
 const acknowledge=async(e:Event,payload:any)=>withLayerFileOperation(async()=>{const ordinaryFact=ordinaryFacts.get(payload.folderPath);if(ordinaryFact)return acknowledgeOrdinary(e,payload,ordinaryFact);const l=leases.get(payload.folderPath);if(!l||payload.nonce!==l.nonce||l.stage!=='persisted')throw new Error('Owner ACK capability/stage mismatch');await authentic(e,l);if(hash(stringifyControlledJSON(payload.project))!==hash(stringifyControlledJSON(l.result.project)))throw new Error('Owner exact binding ACK mismatch');
  if(!(await readExact(path.join(l.root,'.storyboard-workbench/storyboard.project.json'))).equals(encodeControlledUTF8(`${stringifyControlledJSON(l.result.project,null,2)}\n`))||!(await readExact(path.join(l.root,'storyboard-script.md'))).equals(encodeControlledUTF8(serializeStoryboardScriptMarkdown(l.result.project))))throw new Error('Current final binding changed before Owner ACK');
  for(const ack of l.result.normalSaveOutputs??[])if(hash(await readExact(ack.targetPath))!==ack.outputHash)throw new Error('Current output changed before Owner ACK');
  const files=[];for(const file of terminalPaths(l.root,l.result.project)){await canonicalPath(l.root,file);files.push({file:path.relative(l.root,file),digest:hash(await readExact(file))});}
  const policy=(await native({phase:'capturePolicy',sources:terminalPaths(l.root,l.result.project)})).sourcePolicy;
  if(stringifyControlledJSON(policy.expected)!==stringifyControlledJSON((l.sourceAuthorityPolicy??l.sourcePolicy).expected))throw new Error('Prepared source restrictions changed before ACK');
  if(!survivingSourceRestrictionsMatch(l.sourceAuthorityPolicy??l.sourcePolicy,policy))throw new Error('Prepared admitted source restrictions changed');
  await retainExact(l,{...l.offer,revision:`completed:${l.nonce}`,projectRaw:l.result.project,effectFacts:{state:'completed-binding-persist-ack'},continuationState:{stage:'completed',outputs:l.result.normalSaveOutputs,terminal:{schema:'swb.current-terminal.v1',files,sourcePolicy:policy}}});
  // Consume the same cold current-terminal predicate before retiring live state.
  if(!await rootRetired(l.root))throw new Error('Current terminal cannot retire Root');l.stage='completed';return true;});
 const protectedInventory=(e:Event)=>{
  const roots=new Map<string,Lease|Observation>();
  for(const o of observations.values())if(o.sender===e.sender&&(o.facts.length||o.memory))roots.set(o.folderPath,o);
  for(const l of leases.values())if(l.sender===e.sender&&l.stage!=='completed')roots.set(l.root,l);
  for(const fact of ordinaryFacts.values())if(fact.lease.sender===e.sender)roots.set(fact.lease.root,fact.lease);
  return roots;
 };
 const retainedCapture=async(l:Lease,c:any,expected:any,handoff:boolean,baseAssets:RecoveryOffer['assets'])=>{
  if(c.canvas?.hasUnsettledGesture||c.canvas?.captures?.some((v:any)=>v.hasUnsettledGesture)||!c.content||c.content.retainedAssetIntents?.length)throw new Error('Unsettled mounted capture or retained producer intent; keep window');supported(c.content.projectRaw);
  const p=c.content.projectRaw;
  for(const group of ['shots','parkedShots','pendingDeletedShots']){
   const actual=p[group]??[],prepared=expected[group]??[];
   if(actual.length!==prepared.length||actual.some((s:any)=>!prepared.some((v:any)=>v.id===s.id&&v.imagePath===s.imagePath&&v.fileName===s.fileName&&stringifyControlledJSON(v.layers)===stringifyControlledJSON(s.layers))))throw new Error('Close new producer inventory not prepared');
  }
  const assets:RecoveryOffer['assets']=baseAssets.map(a=>({...a,bytes:copyControlledBuffer(a.bytes)}));
  if(!Array.isArray(c.content.desiredAssets)||c.content.effectFacts?.receipt?.length||c.content.effectFacts?.deletions?.length||c.content.effectFacts?.remainingScript)throw new Error('Close dependency domain unsupported');
  for(const d of c.content.desiredAssets){const s=p.shots.find((v:any)=>v.id===d.shotId),layer=s?.layers.find((v:any)=>v.id===d.layerId);if(!layer||d.folderPath!==l.root||d.bitmapPath!==layer.bitmapPath||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(d.dataUrl))throw new Error('Close desired binding mismatch');const desired=await raster(decodeControlledBase64(d.dataUrl.split(',')[1]),`desired/${d.shotId}/${d.layerId}`,`asset_${assets.length}`);if(desired.encoding!=='png'||desired.width!==layer.width||desired.height!==layer.height)throw new Error('Desired PNG dimensions/encoding mismatch');assets.push(desired);}
  if(!c.canvas||!Array.isArray(c.canvas.captures))throw new Error('Mounted registry capture required');
  for(const v of c.canvas.captures){
   const shot=dependencyShots(p).find((s:any)=>s.id===v.shotId);
   if(!shot||v.folderPath!==l.root||!Array.isArray(v.liveLayers))throw new Error('Mounted slot source binding mismatch');
   for(const layer of v.liveLayers){
    const source=shot.layers.find((a:any)=>a.id===layer.layerId);
    if(!source||!l.sourcePolicy.observed.some((a:any)=>a[0]===path.resolve(l.root,source.bitmapPath))&&!await custodyAuthenticates(l,path.resolve(l.root,source.bitmapPath),layer.dataUrl,true)||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(layer.dataUrl))throw new Error('Mounted PNG source not authenticated');
    const a=await raster(decodeControlledBase64(layer.dataUrl.split(',')[1]),`canvas/${v.shotId}/${layer.layerId}`,`asset_${assets.length}`);
    if(a.encoding!=='png'||a.width!==source.width||a.height!==source.height)throw new Error('Mounted PNG dimensions');assets.push(a);
   }
  }
  if(c.history!==undefined){
   if(!c.history||Object.keys(c.history).sort().join(',')!=='redo,undo'||!Array.isArray(c.history.undo)||!Array.isArray(c.history.redo)||c.history.undo.length+c.history.redo.length>configured().records)throw new Error('Finite History data capture required');
   for(const [direction,entries] of Object.entries(c.history) as [string,any[]][])for(const [index,entry] of entries.entries()){
    supported(entry.project);if(entry.project.id!==p.id||!Array.isArray(entry.selectedShotIds)||!['synced','unsynced'].includes(entry.fileNameSyncState))throw new Error('History project binding mismatch');
    for(const [assetIndex,a] of (entry.layerAssets??[]).entries()){
     const source=path.resolve(l.root,a.bitmapPath),layer=dependencyShots(entry.project).flatMap((s:any)=>s.layers).find((v:any)=>v.bitmapPath===a.bitmapPath);
     if(path.relative(l.root,source)!==a.bitmapPath)throw new Error('History PNG source not authenticated');
     if(a.dataUrl===undefined){
      // Historical absence is inert content, never current deletion authority.
      if(!await custodyAuthenticatesAbsence(l,source,entry.project))throw new Error('History PNG source not authenticated');
      continue;
     }
     if(!layer||!l.sourcePolicy.observed.some((v:any)=>v[0]===source)&&!await custodyAuthenticates(l,source,a.dataUrl))throw new Error('History PNG source not authenticated');
     if(!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(a.dataUrl))throw new Error('History PNG encoding');
     const h=await raster(decodeControlledBase64(a.dataUrl.split(',')[1]),`history/${direction}/${index}/${assetIndex}`,`asset_${assets.length}`);
     if(h.encoding!=='png'||h.width!==layer.width||h.height!==layer.height)throw new Error('History PNG dimensions');assets.push(h);
    }
   }
  }else if(handoff)throw new Error('Handoff requires explicit private History data');
  return {p,assets};
 };
 const retainedOffer=async(e:Event,c:any,l:Lease,handoff=false):Promise<RecoveryOffer>=>{
  if(!['failed','output','persisted','completed'].includes(l.stage))throw new Error('No settled retained production Save operation');
  await authentic(e,l);await canonicalPath(l.root,path.join(l.root,'.storyboard-workbench/workspace-recovery-v1'));
  if(handoff){const o=observations.get(c.binding);if(!o||o.sender!==e.sender||o.document!==documentFor(e)||o.folderPath!==l.root||o.rootIdentity!==l.rootIdentity||o.parentIdentity!==l.parentIdentity)throw new Error('Handoff original observation mismatch');}
  const fact=ordinaryFacts.get(l.root);
  if(fact&&fact.stage!=='failed')throw new Error('Ordinary source I/O or exact persistence ACK remains unsettled');
  if(fact)throw new Error('Ordinary failed producer is outside the prepared Save domain');
  if(l.stage==='completed'&&c.content?.effectFacts?.unsettled)throw new Error('New producer failure is outside the prepared Save domain');
  // Required persistence has already read back the renamed result exactly.
  // If final ACK fails, Close must retain that actual Project, not demand the
  // pre-rename names. This is inert retention only: stage stays persisted and
  // the physical writer remains protected until a genuine completed ACK.
  const expected=l.stage==='completed'||l.stage==='persisted'?l.result.project:l.offer.projectRaw;
  const {p,assets}=await retainedCapture(l,c,expected,handoff,l.offer.assets.filter(a=>a.role.startsWith('original/')||a.role.startsWith('partial-failure/')));
  let terminal: unknown;
  if(l.stage==='completed'&&hash(stringifyControlledJSON(p))===hash(stringifyControlledJSON(l.result.project))){
   // A new g2 must not erase the genuine completed ACK. Verify CURRENT native
   // tip, exact JSON/MD and every TIFF/PNG digest, not renderer saved flags or a
   // cached live retirement. New/unpersisted bytes remain protected instead.
   const {state}=await readState(l.root),tip=state.content!,continuation=tip.continuationState as any;
   if(state.state!=='protectedReadable'||state.ack!.sealDigest!==l.latestSeal||(tip.effectFacts as any)?.state!=='completed-binding-persist-ack'||continuation?.stage!=='completed'||!continuation.terminal||continuation.terminal.schema!=='swb.current-terminal.v1')throw new Error('Completed current ACK unavailable');
   const files=terminalPaths(l.root,p,continuation.deletedDependencies??[]),receipts=continuation.terminal.files;
   if(!Array.isArray(receipts)||receipts.length!==files.length)throw new Error('Completed full inventory mismatch');
   for(let i=0;i<files.length;i++){
    const d=receipts[i];await canonicalPath(l.root,files[i]);
    if(d.file!==path.relative(l.root,files[i])||!/^[a-f0-9]{64}$/.test(d.digest)||hash(await readExact(files[i]))!==d.digest)throw new Error('Completed current bytes changed');
   }
   if(!(await readExact(files[0])).equals(encodeControlledUTF8(`${stringifyControlledJSON(p,null,2)}\n`))||!(await readExact(files[1])).equals(encodeControlledUTF8(serializeStoryboardScriptMarkdown(p))))throw new Error('Completed exact current binding mismatch');
   const policy=(await native({phase:'capturePolicy',sources:files})).sourcePolicy;
   if(!terminalPolicyMatches(tip,(await readState(l.root)).storagePolicy,policy))throw new Error('Completed source restrictions changed');
   for(const d of c.content.desiredAssets)if(!decodeControlledBase64(d.dataUrl.split(',')[1]).equals(await readExact(path.resolve(l.root,d.bitmapPath))))throw new Error('Completed desired PNG not current');
   // A policy-observed path is provenance, not proof of the mounted version.
   // Completed canvas bytes must match this exact current terminal too; historic
   // snapshots retain their separate History authentication and are not discarded.
   for(const capture of c.canvas.captures)for(const live of capture.liveLayers){
    const source=dependencyShots(p).find((s:any)=>s.id===capture.shotId).layers.find((layer:any)=>layer.id===live.layerId);
    if(!decodeControlledBase64(live.dataUrl.split(',')[1]).equals(await readExact(path.resolve(l.root,source.bitmapPath))))throw new Error('Completed canvas PNG not current');
   }
   terminal=cloneControlled(continuation);
  }
  return {...l.offer,revision:`${handoff?'handoff':'close'}:${c.content.sequence}:${c.content.assetRevision}:${l.nonce}`,projectRaw:p,viewState:{canvas:{...c.canvas,captures:c.canvas.captures.map((v:any)=>({...v,pointerId:v.pointerId===undefined?{state:'absent'}:v.pointerId,transformPixels:v.transformPixels===undefined?{state:'absent'}:v.transformPixels}))},selectedShotIds:c.selectedShotIds,dirtyShotIds:c.dirtyShotIds,fileNameSyncState:c.fileNameSyncState,workspaceSaveState:c.workspaceSaveState,...(c.history===undefined?{}:{history:c.history})},effectFacts:{...(terminal?{state:'completed-binding-persist-ack'}:{}),owner:c.content.effectFacts,main:l.facts},continuationState:terminal??{stage:l.stage,notExecutable:true,nonce:l.nonce,p1:l.p1},assets,requiredAssetIds:assets.map(a=>a.assetId)};
 };
 const failedOrdinaryRetained=async(e:Event,c:any,l:Lease)=>{
  const fact=ordinaryFacts.get(l.root),attempt=fact?.attempt;
  if(!fact||fact.lease!==l||fact.stage!=='failed'||!attempt||attempt.active||!attempt.callbacks||attempt.callbackError===undefined||attempt.operations||attempt.signals||fact.channels.some(channel=>channel!=='layers:writePng'))throw new Error('Ordinary failed producer exact no-effect settlement unavailable');
  const validate=async()=>{if(ordinaryFacts.get(l.root)!==fact||fact.stage!=='failed'||attempt.active||attempt.operations||attempt.signals)throw new Error('Failed ordinary attempt changed');await verifyOrdinaryBefore(e,l,attempt.before);};
  await validate();
  if(c.content?.projectRaw?.id!==attempt.before.project.id||!c.history)throw new Error('Failed ordinary original Project/History unavailable');
  const {p,assets}=await retainedCapture(l,c,attempt.before.project,true,attempt.before.offer.assets);
  const main={schema:'swb.failed-ordinary-no-effect.v1',operation:fact.nonce,stage:'failed',channels:[...fact.channels],callbackError:attempt.callbackError,operationErrors:[...attempt.errors],original:l.facts};
  const sourcePolicy=intersectRecoveryPolicies([l.sourcePolicy,attempt.before.policy]);
  const lease:Lease={...l,sourcePolicy,facts:main};
  const beforeInventory=[...attempt.before.files].map(([file,v])=>({file:path.relative(l.root,file),identity:v.physical,digest:hash(v.bytes),...(/\.(json|md)$/iu.test(file)?{bytes:v.bytes.toString('base64')}:{})}));
  const offer:RecoveryOffer={...attempt.before.offer,revision:`failed-ordinary:${fact.nonce}:${c.content.sequence}:${c.content.assetRevision}`,projectRaw:p,
   scriptState:{...attempt.before.offer.scriptState as any,failedOrdinary:{schema:main.schema,operation:fact.nonce,sourcePolicy:attempt.before.policy,inventory:beforeInventory}},
   viewState:{canvas:c.canvas,history:c.history,selectedShotIds:c.selectedShotIds,dirtyShotIds:c.dirtyShotIds,fileNameSyncState:c.fileNameSyncState,workspaceSaveState:c.workspaceSaveState},
   effectFacts:{state:'failed-ordinary-preserved',owner:c.content.effectFacts,main},continuationState:{stage:'failed-ordinary',notExecutable:true,operation:fact.nonce,sourceSave:{nonce:l.nonce,stage:l.stage,p1:l.p1,latestSeal:l.latestSeal}},assets,requiredAssetIds:assets.map(a=>a.assetId)};
  await validate();return {lease,offer,validate};
 };
 const certifyRetained=async(e:Event,raw:unknown)=>withLayerFileOperation(async()=>{
  const c=raw as any,l=leases.get(c?.folderPath);if(!l)throw new Error('No retained production Save operation');await authentic(e,l);
  if([...protectedInventory(e).keys()].some(root=>root!==l.root))throw new Error('Hidden unfinished Save inventory cannot be omitted');
  const offer=await retainedOffer(e,c,l);await retainExact(l,offer);await authentic(e,l);return true;
 });
 const readerProject=async(e:Event,o:Observation,tip:any,seal:string)=>{
  if(!o.derived)return tip.projectRaw;
  const d=o.derived,r=d.receipt;
  if(d.seal!==seal||stringifyControlledJSON(recoveryProjectAbsence(r.original))!==stringifyControlledJSON(recoveryProjectAbsence(tip.projectRaw)))throw new Error('Derived view current-terminal association changed');
  const policy=(await native({phase:'captureMemoryPolicy',sources:r.images.flatMap(i=>[i.source,i.preview])})).sourcePolicy;
  if(stringifyControlledJSON(policy)!==stringifyControlledJSON(d.policy))throw new Error('Derived view native incarnation changed');
  for(const i of r.images){if(hash(await readExact(i.source))!==i.sourceDigest||hash(await readExact(i.preview))!==i.previewDigest)throw new Error('Derived view pixels changed');}
  await authenticObservation(e,o);return r.derived;
 };
 const certifiedReaderLease=async(e:Event,c:any)=>{
  const o=observations.get(c?.binding);
  if(!o||o.folderPath!==c.folderPath||!o.facts.length||o.facts.some(f=>f.state!=='settled'||!['workspace:openFolderByPath','workspace:startFolderWatch','workspace:checkExternalChanges','workspace:checkStoryboardScript'].includes(f.channel))||ordinaryFacts.has(c.folderPath))throw new Error('Close collection Root has no Main-owned Save lease or authenticated settled reader');
  await authenticObservation(e,o);
  const {state,storagePolicy}=await readState(o.folderPath);
  if(state.state!=='protectedReadable'||!state.content)throw new Error('Cold reader current terminal not certified');
  const tip=state.content,content=c.content;
  const terminal=(tip.continuationState as any)?.terminal,files=terminalPaths(o.folderPath,tip.projectRaw,(tip.continuationState as any)?.deletedDependencies??[]);
  if((tip.effectFacts as any)?.state!=='completed-binding-persist-ack'||!terminal||terminal.schema!=='swb.current-terminal.v1'||terminal.files?.length!==files.length)throw new Error('Cold reader current terminal missing');
  for(let i=0;i<files.length;i++){await canonicalPath(o.folderPath,files[i]);if(terminal.files[i].file!==path.relative(o.folderPath,files[i])||hash(await readExact(files[i]))!==terminal.files[i].digest)throw new Error('Cold reader current terminal bytes changed');}
  const currentPolicy=(await native({phase:'capturePolicy',sources:files})).sourcePolicy;
  if(!terminalPolicyMatches(tip,storagePolicy,currentPolicy))throw new Error('Cold reader current source restrictions changed');
  if(!await rootRetired(o.folderPath))throw new Error('Cold reader current terminal not certified');
  const expected=await readerProject(e,o,tip,state.ack!.sealDigest);
  if(state.state!=='protectedReadable'||!content||content.retainedAssetIntents?.length||content.desiredAssets?.length||content.effectFacts?.unsettled||content.effectFacts?.error||content.effectFacts?.receipt?.length||content.effectFacts?.deletions?.length||content.effectFacts?.remainingScript||stringifyControlledJSON(recoveryProjectAbsence(content.projectRaw))!==stringifyControlledJSON(recoveryProjectAbsence(expected)))throw new Error('Cold reader capture has unpreserved obligations');
  const history=(tip.viewState as any)?.history??{undo:[],redo:[]};
  if(hash(stringifyControlledJSON(c.history))!==hash(stringifyControlledJSON(history)))throw new Error('Cold reader omitted retained History');
  if(c.canvas?.hasUnsettledGesture||!Array.isArray(c.canvas?.captures)||c.canvas.captures.some((v:any)=>v.hasUnsettledGesture))throw new Error('Cold reader canvas unsettled');
  for(const v of c.canvas.captures){
   const shot=dependencyShots(expected).find((s:any)=>s.id===v.shotId);
   if(!shot||v.folderPath!==o.folderPath||!Array.isArray(v.liveLayers))throw new Error('Cold reader canvas source binding');
   for(const a of v.liveLayers){
    const layer=shot.layers.find((l:any)=>l.id===a.layerId);
    if(!layer||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(a.dataUrl))throw new Error('Cold reader layer source binding');
    const captured=await sharp(decodeControlledBase64(a.dataUrl.split(',')[1])).ensureAlpha().raw().toBuffer({resolveWithObject:true}),current=await sharp(await readExact(path.resolve(o.folderPath,layer.bitmapPath))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(captured.info.width!==current.info.width||captured.info.height!==current.info.height||!captured.data.equals(current.data))throw new Error('Cold reader has unpreserved canvas pixels');
   }
  }
  await authenticObservation(e,o);const l=await ordinaryLease(e,o.folderPath);readerLeases.set(l,o);return l;
 };
 const ordinaryPreservationLease=async(e:Event,c:any)=>{
  const o=observations.get(c?.binding),pin=o?.preservation;
  if(!o||!pin||o.folderPath!==c.folderPath||o.parentIdentity===null||!o.facts.length||o.facts.some(f=>!['settled','failed'].includes(f.state)||f.settlementError))throw new Error('Ordinary preservation has no authenticated settled pre-effect source inventory');
  for(const f of o.facts){
   if(f.state==='settled'&&['workspace:openFolderByPath','workspace:startFolderWatch','workspace:checkExternalChanges','workspace:checkStoryboardScript'].includes(f.channel))continue;
   if(f.state!=='failed'||!f.nativeRefusal||f.failure?.effect!=='refused'||f.failure.retainedTemporary!==null||!Array.isArray(f.targets)||f.targets.some((file:string)=>!pin.files.has(file)))throw new Error('Ordinary preservation has uncovered effect or residue inventory');
  }
  if(o.preservationError)throw new Error('Ordinary preservation source admission failed: '+o.preservationError);
  await authenticObservation(e,o);
  // Failed observations remain failures. Refused effects may be durably held
  // only while ALL original current versions and native restrictions still match.
  for(const [dir,physical] of pin.parents)if(await identity(dir)!==physical)throw new Error('Ordinary preservation source parent chain changed');
  for(const [file,b] of pin.files){await canonicalPath(o.folderPath,file);if(!(await readExact(file)).equals(b))throw new Error('Ordinary preservation current source changed');}
  const policy=(await native({phase:'capturePolicy',sources:[...pin.files.keys()]})).sourcePolicy;
  if(stringifyControlledJSON(policy)!==stringifyControlledJSON(pin.sourcePolicy))throw new Error('Ordinary preservation source identity/restrictions changed');
  for(const direction of ['undo','redo'])for(const entry of c.history?.[direction]??[])for(const a of entry.layerAssets??[]){
   const original=pin.files.get(path.resolve(o.folderPath,a.bitmapPath));
   if(!original||typeof a.dataUrl!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(a.dataUrl)||!decodeControlledBase64(a.dataUrl.split(',')[1]).equals(original))throw new Error('Ordinary preservation History version lacks original source receipt');
  }
  const facts=JSON.parse(stringifyControlledJSON(o.facts));
  return {sender:o.sender,frame:o.frame,window:o.window,document:o.document,root:o.folderPath,rootIdentity:o.rootIdentity,parentIdentity:o.parentIdentity,nonce:pin.operation,p1:hash(stringifyControlledJSON(pin.project)),stage:'failed' as const,sourcePolicy:pin.sourcePolicy,offer:pin.offer,facts:{state:'ordinary-settled-preservation',operation:pin.operation,operations:facts}};
 };
 // Inert Close only. Known native-refused prefixes retain their immutable
 // before/after observations too. Partial metadata and unknown effects refuse.
 const retainedHistory=async(e:Event,c:any,l:Lease,o:HOperation)=>{
  const fact=ordinaryFacts.get(l.root),stage=fact?.stage;
  const metadataObservation=stage==='failed'?o.metadataObservation:undefined;
  // A real no-effect compensation refusal does not erase the successful
  // write-after certificate. Keep both; only archive the separately observed
  // present version when its inode and bytes still equal that original write.
  const refusedCompensation=(a:HAsset)=>!!(a.compensationStarted&&!a.compensationAcknowledged&&a.compensationError&&a.compensationFailure?.effect==='refused'&&a.compensationFailure.retainedTemporary===null&&a.after?.bytes&&a.observed?.bytes&&a.after.physical===a.observed.physical&&a.after.bytes.equals(a.observed.bytes));
  const observedConflict=(a:HAsset)=>!!(a.compensationConflict?.kind==='write-after-conflict-before-compensation'&&a.compensationConflict.origin==='unknown'&&a.compensationConflict.notExecutable&&a.unresolved&&!a.error&&a.compensationError&&!a.compensationStarted&&!a.compensationAcknowledged&&a.after?.bytes&&a.observed?.bytes);
  const actualAsset=(a:HAsset)=>refusedCompensation(a)||observedConflict(a)?a.observed!:a.after!;
  const actualVersion=(file:string,before:HVersion)=>{
   if(stage==='persisted'&&o.binding?.has(file))return o.binding.get(file)!;
   if(metadataObservation?.versions.has(file))return metadataObservation.versions.get(file)!;
   const a=o.assets.find(a=>a.file===file);return a?.started?actualAsset(a):before;
  };
  const validate=async()=>{
   await authentic(e,l);await historyPhysical(o);
   if(historyByRoot.get(l.root)!==o||historyOperations.get(o.id)!==o||o.lease!==l||o.invalidated||!['active','failed','restored'].includes(o.state)||
      o.state==='active'&&o.next!==o.assets.length||o.state==='failed'&&(stage!=='failed'||!o.assets.some(a=>a.error||a.compensationError))||
      !fact||ordinaryFacts.get(l.root)!==fact||fact.lease!==l||fact.stage!==stage||!['pending','persisted','failed'].includes(stage!)||
      fact.channels.some(channel=>!['history:admit','workspace:autosave'].includes(channel))||
      o.assets.some(a=>a.started&&!a.after||a.unresolved&&!observedConflict(a)||a.compensationError&&!refusedCompensation(a)&&!observedConflict(a)||a.compensationStarted&&!a.compensationAcknowledged&&!refusedCompensation(a)||a.error&&(a.failure?.effect!=='refused'||a.failure.retainedTemporary!==null)))throw new Error('History Close original settled inventory unavailable');
   if(stage==='persisted'&&(!o.binding||o.binding.size!==2||!fact.project))throw new Error('History Close original persistence evidence unavailable');
   if(metadataObservation&&(o.metadataObservation!==metadataObservation||metadataObservation.kind!=='original-callback-failure-observation'||metadataObservation.versions.size!==2||![path.join(l.root,'.storyboard-workbench/storyboard.project.json'),path.join(l.root,'storyboard-script.md')].every(file=>metadataObservation.versions.has(file))))throw new Error('History Close failed metadata observation unavailable');
   if(stage!=='persisted'&&(o.binding||fact.channels.includes('workspace:autosave')&&!metadataObservation))throw new Error('History Close metadata publication unknown');
   if(o.state==='restored')await verifyHistoryBefore(o,stage==='persisted');
   for(const [file,before] of o.inventory){
    const a=o.assets.find(a=>a.file===file),expected=actualVersion(file,before);
    if(!sameHVersion(expected,await historyVersion(l,file))||a?.observed&&!sameHVersion(a.observed,expected))throw new Error('History Close current version changed');
   }
   await authentic(e,l);if(o.invalidated)throw new Error('History Close original document changed');
  };
  await validate();
  const present=[...o.inventory].filter(([file,before])=>actualVersion(file,before).bytes!==null).map(([file])=>file);
  const currentPolicy=(await native({phase:'capturePolicy',sources:present})).sourcePolicy;
  const sourcePolicy=intersectRecoveryPolicies([l.sourcePolicy,currentPolicy]);
  // Archive through the existing stricter policy partition. The original
  // operation's immutable policy and its failed writer fact are not replaced.
  const archiveLease:Lease={...l,sourcePolicy};
  const {p,assets}=await retainedCapture(l,c,metadataObservation?.attemptedProject??(stage==='persisted'?fact!.project:o.state!=='active'?o.project:o.targetProject),true,l.offer.assets);
  const version=async(file:string,v:HVersion,role:string)=>{
   const certification=historyCertification(v);if(v.bytes===null)return {certification};
   if(/\.(json|md)$/iu.test(file))return {certification,bytes:v.bytes.toString('base64')};
   let asset=assets.find(a=>copyControlledBuffer(a.bytes).equals(v.bytes!));
   if(!asset){asset=await raster(v.bytes,role,`history_close_${o.id}_${assets.length}`);assets.push(asset);}
   return {certification,assetId:asset.assetId};
  };
  const inventory=[];
  for(const [file,before] of o.inventory){
   const actual=actualVersion(file,before);
   inventory.push({file:path.relative(l.root,file),before:await version(file,before,`history-close/${o.id}/before/${inventory.length}`),actual:await version(file,actual,`history-close/${o.id}/actual/${inventory.length}`)});
  }
  for(const [i,a] of o.assets.entries())if(a.desired!==null&&!assets.some(v=>copyControlledBuffer(v.bytes).equals(a.desired!)))assets.push(await raster(a.desired,`history-close/${o.id}/desired/${i}`,`history_close_${o.id}_desired_${i}`));
  const facts={schema:'swb.history-operation-preservation.v1',operation:o.id,project:o.project,targetProject:o.targetProject,persistedProject:fact!.project??null,...(metadataObservation?{metadataObservation:{kind:metadataObservation.kind,error:metadataObservation.error,attemptedProject:metadataObservation.attemptedProject,acknowledged:false}}:{}),state:o.state,next:o.next,metadataStage:stage,ordinaryNonce:fact!.nonce,channels:[...fact!.channels],acknowledged:false,invalidated:o.invalidated,assets:historyFacts(o),inventory};
  // History targets/Projects come from the renderer's in-memory snapshots, which may
  // carry own-undefined optional fields that JSON cannot represent. Normalize exactly
  // as the Import continuation does instead of refusing the whole close; absence
  // stays absent and no present value is invented.
  const durable=(v:unknown)=>parseControlledJSON(encodeControlledUTF8(stringifyControlledJSON(v)));
  // Enroll only the original live Main operation after its failure and complete
  // current inventory have been certified. Old cold archives are never upgraded.
  // Inability to enroll leaves ordinary read-only retention intact, not writable.
  let scriptState=l.offer.scriptState;
  if(stage==='failed'&&!o.invalidated)try{
   const current=await partialSourceInventory(l.root);await validate();
   // The editor must start from certified CURRENT PNGs, not the pre-History
   // original/desired versions also retained for audit. Missing current layers
   // leave this failure read-only; historical bytes never stand in for current.
   const overlays:RecoveryOffer['assets']=[];
   for(const shot of dependencyShots(p))for(const layer of shot.layers){
    const file=path.resolve(l.root,layer.bitmapPath),before=o.inventory.get(file);
    if(!before)throw new Error('History continuation current layer unregistered');
    const actual=actualVersion(file,before);
    if(!actual.bytes||!current.buffers.get(file)?.equals(actual.bytes))throw new Error('History continuation current layer unavailable');
    const overlay=await raster(actual.bytes,`continued/${shot.id}/${layer.id}`,`continued_${hash(`${shot.id}/${layer.id}`).slice(0,32)}`);
    if(overlay.encoding!=='png'||overlay.width!==layer.width||overlay.height!==layer.height)throw new Error('History continuation current layer dimensions');
    overlays.push(overlay);
   }
   archiveLease.sourcePolicy=intersectRecoveryPolicies([sourcePolicy,current.record.policy]);
   scriptState={...scriptState as any,partialSaveInventory:current.record,historyContinuation:{schema:'swb.history-continuation.v1',operation:o.id,nonce:fact!.nonce,p1:hash(stringifyControlledJSON(facts)),acknowledged:false}};
   assets.push(...overlays);
  }catch{/* Unknown inventory grants no continuation; keep the original failure. */}
  const offer:RecoveryOffer={...l.offer,scriptState,revision:`history-close:${o.id}:${c.content.sequence}:${c.content.assetRevision}`,projectRaw:durable(p),
   viewState:durable({canvas:c.canvas,history:c.history,selectedShotIds:c.selectedShotIds,dirtyShotIds:c.dirtyShotIds,fileNameSyncState:c.fileNameSyncState,workspaceSaveState:c.workspaceSaveState}),
   effectFacts:durable({state:'history-preserved',owner:c.content.effectFacts,previous:l.offer.effectFacts,main:l.facts,historyOperation:facts}),
   continuationState:{stage:'history-preserved',notExecutable:true,operation:o.id,metadataStage:stage,acknowledged:false},assets,requiredAssetIds:assets.map(a=>a.assetId)};
  await validate();return {lease:archiveLease,offer,validate,seal:()=>{o.preserved=true;}};
 };
 const certifyRetainedSet=async(e:Event,rawCollection:unknown)=>withLayerFileOperation(async()=>{
  configured();current(e);
  const encoded=stringifyControlledJSON(rawCollection);if(!encoded||Buffer.byteLength(encoded)>configured().bytes)throw new Error('Close collection byte budget');
  const collection=JSON.parse(encoded);
  if(collection?.partialContinuation!==undefined){
   if(!exactKeys(collection,['slots','partialContinuation'])||!Array.isArray(collection.slots)||collection.slots.length)throw new Error('Exact standalone continuation close collection required');
   const p=collection.partialContinuation;
   if(!exactKeys(p,['session','revision','projectRaw','viewState','desiredAssets'])||!Array.isArray(p.desiredAssets))throw new Error('Exact continuation close capture required');
   const session=partialSessions.get(p.session);if(!session||p.revision!==session.revision)throw new Error('Continuation close session/revision changed');
   const o=session.observation;await authenticObservation(e,o);
   if([...protectedInventory(e).keys()].some(root=>root!==o.folderPath))throw new Error('Hidden unfinished Root cannot be omitted');
   if(!(await inspectPartialSaveContinuation(e,{binding:o.binding})).eligible)throw new Error('Continuation close source/failure certification refused');
   const {store,state}=await readState(o.folderPath),tip=state.content!;
   if(state.ack!.sealDigest!==session.seal||!isDeepStrictEqual(tip.projectRaw,p.projectRaw)||!isDeepStrictEqual(tip.viewState,p.viewState))throw new Error('Continuation latest view not persisted');
   const bytes=await store.readAssets(o.folderPath,state.ack!.generationId),expected=tip.assets.filter(a=>a.role.startsWith('continued/'));
   if(p.desiredAssets.length!==expected.length||new Set(p.desiredAssets.map((a:any)=>`${a.shotId}/${a.layerId}`)).size!==expected.length)throw new Error('Continuation close PNG inventory mismatch');
   for(const asset of expected){const edit=p.desiredAssets.find((a:any)=>`continued/${a.shotId}/${a.layerId}`===asset.role);if(!edit||!exactKeys(edit,['shotId','layerId','dataUrl'])||edit.dataUrl!==`data:image/png;base64,${bytes.get(asset.assetId)!.toString('base64')}`)throw new Error('Continuation latest PNG not persisted');}
   await authenticObservation(e,o);return true;
  }
  if(!collection||!Array.isArray(collection.slots)||!collection.slots.length||collection.slots.length>configured().records)throw new Error('Finite nonempty close collection required');
  const expected=protectedInventory(e),verified=new Map<string,{lease:Lease;offer?:RecoveryOffer;validate?:()=>Promise<void>;seal?:()=>void}>(),physical=new Set<string>();
  // Authenticate/preflight every Root before the first native sidecar write.
  for(const c of collection.slots){
   const root=c?.folderPath;
   if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root||root.includes('\0')||await fs.realpath(root)!==root||verified.has(root))throw new Error('Close collection duplicate/alias physical Root');
   const importPin=importFailures.get(root);
   if(importPin){if(c.binding!==importPin.observation.binding)throw new Error('Import original observation binding');const retained=await retainedImport(e,c,importPin);if(physical.has(retained.lease.rootIdentity))throw new Error('Close duplicate physical identity');physical.add(retained.lease.rootIdentity);verified.set(root,retained);continue;}
   const existing=leases.get(root),preservation=!existing&&!!observations.get(c.binding)?.preservation,reader=!preservation&&(!existing||readerLeases.has(existing)),l=preservation?await ordinaryPreservationLease(e,c):reader?await certifiedReaderLease(e,c):existing!;
   await authentic(e,l);if(physical.has(l.rootIdentity))throw new Error('Close collection duplicate physical identity');physical.add(l.rootIdentity);
   const history=historyByRoot.get(root);
   verified.set(root,history?await retainedHistory(e,c,l,history):!reader&&ordinaryFacts.get(root)?.stage==='failed'?await failedOrdinaryRetained(e,c,l):{lease:l,...(reader?{}:{offer:await retainedOffer(e,c,l)})});
  }
  if([...expected.keys()].some(root=>!verified.has(root)))throw new Error('Hidden unfinished Save inventory cannot be omitted');
  // Revoke future effects only after the entire collection passes preflight.
  // Failed sidecar/readback keeps the originals quarantined, never executable.
  for(const {seal} of verified.values())seal?.();
  // Closure-private capability; partial durable protection is never rolled back.
  for(const {lease,offer,validate} of verified.values()){await validate?.();if(offer)await retainExact(lease,offer);await validate?.();await authentic(e,lease);}
  for(const {lease,validate} of verified.values()){await validate?.();await authentic(e,lease);}
  if([...protectedInventory(e).keys()].some(root=>!verified.has(root)))throw new Error('Protected inventory changed during collection readback');
  return true;
 });
 // Preservation only. Does not complete/retire any lease or issue a Close permit.
 const certifyOrdinaryMemory=async(e:Event,c:any)=>{
  configured();const o=observations.get(c?.binding);if(!o||o.folderPath!==c.folderPath)throw new Error('Ordinary handoff observation mismatch');await authenticObservation(e,o);
  if(o.facts.some(f=>f.state!=='settled')||!o.facts.length)throw new Error('Ordinary staging/producer obligation unsettled');
  // A finite inert pin of ALL files, not a clean/saved renderer declaration.
  // No old closure, path execution, disk retirement or Close permit is issued.
  const encoded=stringifyControlledJSON(c);if(!encoded||Buffer.byteLength(encoded)>configured().bytes||!c.content||c.canvas?.hasUnsettledGesture||c.canvas?.captures?.some((v:any)=>v.hasUnsettledGesture)||c.content.effectFacts?.unsettled||c.content.retainedAssetIntents?.length)throw new Error('Ordinary memory capture unsupported/unsettled');
  const files=new Map<string,Buffer>(),directories=new Map<string,{identity:string;names:string[]}>();let bytes=Buffer.byteLength(encoded),records=0;
  const visit=async(dir:string,depth:number):Promise<void>=>{if(depth>configured().jsonDepth)throw new Error('Ordinary inventory depth budget');const names=(await fs.readdir(dir)).sort();directories.set(dir,{identity:await identity(dir),names});for(const name of names){
   const file=path.join(dir,name),s=await fs.lstat(file);if(++records>configured().records||s.isSymbolicLink())throw new Error('Ordinary inventory identity/record budget');
   if(s.isDirectory())await visit(file,depth+1);else{await canonicalPath(o.folderPath,file);const b=await readExact(file);bytes+=b.length;if(bytes>configured().bytes)throw new Error('Ordinary inventory byte budget');files.set(file,b);}
  }};
  await visit(o.folderPath,0);
  const sourcePolicy=(await native({phase:'captureMemoryPolicy',sources:[...files.keys()]})).sourcePolicy;
  for(const [file,b] of files)if(!(await readExact(file)).equals(b))throw new Error('Ordinary bytes changed during certification');
  for(const [dir,before] of directories)if(await identity(dir)!==before.identity||stringifyControlledJSON((await fs.readdir(dir)).sort())!==stringifyControlledJSON(before.names))throw new Error('Ordinary full inventory changed during certification');
  await authenticObservation(e,o);o.memory={capture:JSON.parse(encoded),files,sourcePolicy};
  return {mode:'ordinary-memory' as const,readonly:false};
 };
 const certifyHandoff=(e:Event,raw:unknown)=>withLayerFileOperation(async()=>{const c=raw as any,l=leases.get(c?.folderPath);if(!l)return certifyOrdinaryMemory(e,c);const offer=await retainedOffer(e,c,l,true);await retainExact(l,offer);await authentic(e,l);
  // Exact completed terminal is a Main-certified editable adoption. Failed or
  // residual content stays the existing inert/readonly handoff; renderer flags
  // never retire its fact, change native policy, or grant ordinary authority.
  if((offer.continuationState as any)?.stage==='completed'&&(offer.effectFacts as any)?.state==='completed-binding-persist-ack'&&!c.content.effectFacts?.unsettled&&!c.content.effectFacts?.error&&!ordinaryFacts.has(l.root)&&await rootRetired(l.root))return {mode:'completed-terminal' as const,readonly:false as const};
  return true;});
 const failedOrigin=async(e:Event,p:any)=>{
  current(e);configured();
  if(!p||Object.keys(p).sort().join(',')!=='binding,failedVersion'||typeof p.binding!=='string'||typeof p.failedVersion!=='string')throw new Error('Observed failed-version selector required');
  const observed=observations.get(p.binding);
  if(!observed||!options.originEnrollment)throw new Error('Original private origin enrollment unavailable');
  await authenticObservation(e,observed);
  const {store,state}=await readState(observed.folderPath),tipAck=state.ack!;
  const findFailure=(facts:any):any=>{
   const pending=[facts];let visited=0;const matches:any[]=[];
   while(pending.length){
    if(++visited>configured().records)throw new Error('Failed publication fact traversal budget');
    const value=pending.pop();if(!value||typeof value!=='object'||Array.isArray(value))continue;
    if(value.producerCommitFailure?.version===p.failedVersion)matches.push(value.producerCommitFailure);
    // These are the existing inert Main failure wrappers, not arbitrary keys
    // or renderer instructions. The enclosing capture still needs native seal.
    for(const key of ['owner','main'])if(value[key]&&typeof value[key]==='object')pending.push(value[key]);
   }
   if(matches.some(f=>stringifyControlledJSON(f)!==stringifyControlledJSON(matches[0])))throw new Error('Ambiguous failed publication facts');
   return matches[0];
  };
  // The first appearance on the certified causal chain is the original failed
  // capture, not a later Close's repeated/nested fact. The private sealed hash
  // must authenticate that EXACT immutable ack; no fallback on a native error.
  const original=(await store.inspectCapturesReadonly(observed.folderPath)).find(c=>findFailure(c.content.effectFacts));
  if(!original)throw new Error('Exact failed publication association required');
  const {content,ack,assets:retained,storagePolicy}=await store.readCapture(observed.folderPath,original.reference);
  const failure=findFailure(content.effectFacts),proof=failure?.ownedStageReceipt;
  if(failure?.schema!=='swb.failed-producer-commit.v1'||failure.version!==p.failedVersion||failure.effect!=='committed'||!proof||proof.root!==observed.folderPath||typeof failure.file!=='string'||proof.target!==path.resolve(observed.folderPath,failure.file)||proof.bytes?.digest!==failure.digest)throw new Error('Exact failed publication association required');
  const asset=content.assets.find(a=>a.role===`failed-custody/${failure.version}`);
  if(!asset||!retained.get(asset.assetId)||hash(retained.get(asset.assetId)!)!==failure.digest)throw new Error('Exact failed B bytes unavailable');
  const capture:OriginCapture={...ack,format:content.version===2?'v2':'v1',policyKey:content.version===2?recoveryPolicyKey(storagePolicy):null};
  await options.originEnrollment.verifyCold(proof,storagePolicy,capture);
  const after=await store.inspectReadonly(observed.folderPath);
  if(after.ack?.generationId!==tipAck.generationId||after.ack.sealDigest!==tipAck.sealDigest)throw new Error('Failed publication chain changed during origin verification');
  await authenticObservation(e,observed);
  return {observed,proof,storagePolicy,capture};
 };
 const verifyFailedOrigin=async(e:Event,p:any)=>withLayerFileOperation(async()=>{
  await failedOrigin(e,p);
  // Provenance only. No pair/delete/native permission or writer/ACK capability.
  return {verified:true as const};
 });
 const retryFailedOrigin=async(e:Event,p:any,onDispatch?:()=>void)=>{
  let dispatched=false,reported:any;
  try{return await withLayerFileOperation(async()=>{
  const source=await failedOrigin(e,p);
  // Called only by an explicit observed selector. Native cleanup reopens all
  // directory/file FDs and authenticates the private records again; this source
  // lookup is never a cached permission, arbitrary path or ordinary two-link
  // exception. Original producer facts, leases and Save ACK remain untouched.
  const result=await options.originEnrollment!.cleanupCold(source.proof,source.storagePolicy,source.capture,()=>{dispatched=true;onDispatch?.();});
  try{await authenticObservation(e,source.observed);}
  catch(error){return reported={...result,status:'caller-invalid' as const,callerValidity:'invalid' as const,error:error instanceof Error?error.message:String(error)};}
  return reported={...result,callerValidity:'valid' as const};
  });}catch(error){
   if(!dispatched)throw error;
   // The outer content-reader/accountant workers can fail terminal handling
   // AFTER the destructive helper has returned. Preserve its reported receipt
   // as evidence, but never expose a fully successful or no-effects result.
   return {...reported,status:'unknown' as const,cleanupOutcome:'unknown' as const,auditOutcome:'unknown' as const,callerValidity:'unknown' as const,error:error instanceof Error?error.message:String(error)};
  }
 };
 const runIpc=async(e:Event,payload:any,execute:()=>Promise<any>)=>{let started=false;try{memoryBudget?.checkPressure();return await run(e,payload,async()=>{started=true;return execute();});}catch(error){return {ok:false,error:{code:'SAVE_RECOVERY_INCOMPLETE',message:`${started?'Save execution was not certified':'Recovery preparation refused before source effects (0)'}: ${error instanceof Error?error.message:String(error)}`,recoveryIncomplete:true,publicationOrCleanup:started?'started':'not-started',metadata:started?'unknown':'not-started',sourceEffects:started?'unknown':0,sidecarEffects:leases.get(payload?.folderPath)?.facts,retainedPaths:[]}};}};
 const api={inspectPartialSaveContinuation,beginPartialSaveContinuation,persistPartialSaveContinuation,verifyFailedOrigin,retryFailedOrigin,beginHistoryAssets,stepHistoryAssets,compensateHistoryAssets,ordinary,run,runIpc,persist,acknowledge,observeWorkspace,certifyHandoff,certifyRetained,certifyRetainedSet,readReadonly:(root:string)=>withLayerFileOperation(()=>readReadonly(root)),invalidateDocument:(sender:object)=>{documents.set(sender,{});for(const o of historyOperations.values())if(o.lease.sender===sender&&!o.preserved){o.invalidated=true;void withLayerFileOperation(()=>recoverHistory(o)).catch(error=>{o.state='failed';o.lease.facts={state:'history-invalidation-recovery-failed',error:String(error)};});}}};
 // One service budget spans all Roots and survives individual method returns.
 // Nested store/readback calls inherit the same owner rather than a new cap.
 // Context binding is not admission: revocation must remain unconditional;
 // Save IPC owns its admission inside the existing failure-result boundary.
 return Object.fromEntries(Object.entries(api).map(([key,method])=>[key,(...args:any[])=>withControlledMemory(memoryBudget,()=>{if(key!=='invalidateDocument'&&key!=='runIpc')memoryBudget?.checkPressure();return (method as (...values:any[])=>any)(...args);})])) as typeof api;
};
