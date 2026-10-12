import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession.js';
import sharp from 'sharp';
import type { IpcMainInvokeEvent } from 'electron';
import { createWorkspaceRecoveryStore, type RecoveryBudget, type RecoveryOffer } from './workspaceRecoveryStore.js';
import { serializeStoryboardScriptMarkdown } from './storyboardScript.js';
import { withLayerFileOperation as serializedLayerOperation } from './layerFileOperationQueue.js';
import { assertPhysicalWorkspaceWriterTargets, installWorkspaceRetirementPredicate } from './workspacePhysicalWriterGate.js';
import { withWorkspaceInitialization } from './workspaceInitialization.js';
import { recoveryProjectAbsence } from '../shared/recoveryProjectAbsence.js';
import { classifyPendingBakeEnvelope } from '../shared/pendingBakeRules.js';
import { withProducerPngEffects, type ProducerPngReceipt } from './producerPngEffects.js';
import { withDerivedPreviewReceipt, type DerivedPreviewReceipt } from './derivedPreviewReceipt.js';

type Event = Pick<IpcMainInvokeEvent,'sender'|'senderFrame'>;
type Options = {budget?:RecoveryBudget;python:string;script:string;ownerFromSender?:(sender:Event["sender"])=>object|undefined};
const hash=(v:Uint8Array|string)=>createHash('sha256').update(v).digest('hex');
const identity=async(file:string)=>{const s=await fs.lstat(file);if(s.isSymbolicLink()||(!s.isDirectory()&&(!s.isFile()||s.nlink!==1)))throw new Error('Unsupported physical identity');return `${s.dev}:${s.ino}`;};

/** Finite ordinary-owned, single-layer Save domain. No command replay, GC or
 * ordinary writer unlock. All unsupported producer branches refuse before stage. */
export const createPreparedWorkspaceSave=(options:Options)=>{
 const configured=()=>{const b=options.budget;if(!b||Object.keys(b).sort().join(',')!=='assets,bytes,jsonDepth,records'||!Object.values(b).every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('Explicit finite recovery limits required');return b;};
 const nativeSession=createNativeAuthorizationSession(options.python,options.script,()=>configured().bytes);
 const withLayerFileOperation=<T,>(run:()=>Promise<T>)=>serializedLayerOperation(()=>nativeSession.run(run));
 const native=async(request:any):Promise<any>=>{
  if(process.platform!=='darwin')throw new Error('Windows recovery unfinished');
  return nativeSession.request({...request,sourceByteLimit:configured().bytes});
 };
 const storeFor=(sourcePolicy:any)=>createWorkspaceRecoveryStore({budget:configured(),sourcePolicy,allowUnsealedStart:true,authorize:async request=>{await native({...request,sourcePolicy});}});
 const current=(e:Event)=>{if(!e.sender||e.senderFrame!==e.sender.mainFrame)throw new Error('Current top-frame caller required');};
 const documents=new WeakMap<object,object>();
 const documentFor=(e:Event)=>{current(e);let d=documents.get(e.sender);if(!d){d={};documents.set(e.sender,d);}return d;};
 type Lease={sender:object;frame:object;window:object;document:object;root:string;rootIdentity:string;parentIdentity:string;nonce:string;p1:string;stage:'prepared'|'executing'|'failed'|'output'|'persisted'|'completed';sourcePolicy:any;offer:RecoveryOffer;facts:unknown;result?:any;latestSeal?:string};
 const leases=new Map<string,Lease>();
 const readerLeases=new WeakMap<Lease,object>();
 // An absent metadata parent is a pinned absence, not permission to accept a
 // later arbitrary parent. Only the original admitted reader/producer may bind it.
 type Observation={binding:string;sender:object;frame:object;window:object;document:object;folderPath:string;metadataPath:string;rootIdentity:string;parentIdentity:string|null;facts:any[];project?:any;derived?:{receipt:DerivedPreviewReceipt;policy:any;seal:string};memory?:{capture:any;files:Map<string,Buffer>;sourcePolicy:any}};
 const parentIdentityFor=async(root:string)=>{try{const parent=path.join(root,'.storyboard-workbench');if(!(await fs.lstat(parent)).isDirectory())throw new Error('Workspace metadata parent is not a directory');return await identity(parent);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;return null;}};
 const authenticObservation=async(e:Event,o:Observation)=>{current(e);if(o.sender!==e.sender||o.frame!==e.senderFrame||o.window!==(options.ownerFromSender?.(e.sender)??e.sender)||o.document!==documentFor(e)||o.rootIdentity!==await identity(o.folderPath)||o.parentIdentity!==await parentIdentityFor(o.folderPath))throw new Error('Observed workspace incarnation changed');};
 const observations=new Map<string,Observation>();
 const observeWorkspace=async(e:Event,input:string)=>withLayerFileOperation(async()=>{
  current(e);if(typeof input!=='string'||!path.isAbsolute(input)||input.includes('\0'))throw new Error('Absolute workspace observation required');
  const root=await fs.realpath(input),rootIdentity=await identity(root),parentIdentity=await parentIdentityFor(root);
  if(!(await fs.lstat(root)).isDirectory())throw new Error('Workspace Root is not a directory');
  const window=options.ownerFromSender?.(e.sender)??e.sender;if(!window)throw new Error('Actual observation window unavailable');
  const document=documentFor(e);
  for(const old of observations.values())if(old.sender===e.sender&&old.folderPath===root){
   if(old.frame!==e.senderFrame||old.window!==window||old.document!==document||old.rootIdentity!==rootIdentity||old.parentIdentity!==parentIdentity)throw new Error('Observed workspace incarnation changed');
   return {binding:old.binding,folderPath:old.folderPath,metadataPath:old.metadataPath};
  }
  const l=leases.get(root);if(l)await authentic(e,l);
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
 const readExact=async(file:string)=>{const before=await fs.lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size>configured().bytes)throw new Error('Save dependency identity/byte budget');const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await fd.stat();const b=await fd.readFile();const after=await fs.lstat(file);if(before.dev!==s.dev||before.ino!==s.ino||b.length!==before.size||before.ino!==after.ino||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw new Error('Save dependency changed');return b;}finally{await fd.close();}};
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
  const file=path.join(root,'.storyboard-workbench/workspace-recovery-v1/namespace.json');await canonicalPath(root,file);
  // Bootstrap only finite inert JSON; native full destination-policy certification
  // follows immediately, before returning any content. No source path is opened.
  const ns=JSON.parse((await readExact(file)).toString('utf8'));if(!ns.sourcePolicy)throw new Error('Native immutable source policy absent');
  await native({path:file,root,phase:'readback',sources:[],sourcePolicy:ns.sourcePolicy});
  const store=storeFor(ns.sourcePolicy),state=await store.inspectReadonly(root);if(!['protectedReadable','protectedIncomplete'].includes(state.state)||!state.content||!state.ack)throw new Error(`Readonly prepared recovery unavailable: ${state.state} ${state.issue??''}`);
  return {store,state,storagePolicy:ns.sourcePolicy};
 };
 const ordinaryFacts=new Map<string,{lease:Lease;nonce:string;stage:'pending'|'persisted'|'failed';channels:string[];project?:any;deleted?:any[]}>();
 const retired=new Map<string,{rootIdentity:string;parentIdentity:string;seal:string;inventory:string}>();
 const inventoryFingerprint=async(root:string)=>{
  const base=path.join(root,'.storyboard-workbench/workspace-recovery-v1'),items:any[]=[];let bytes=0;
  const visit=async(file:string,depth:number):Promise<void>=>{
   if(depth>7||items.length>=configured().records)throw new Error('Retired inventory budget');
   const s=await fs.lstat(file);if(s.isSymbolicLink()||!s.isDirectory()&&(!s.isFile()||s.nlink!==1))throw new Error('Retired inventory identity');
   if(s.isFile())bytes+=s.size;if(bytes>configured().bytes)throw new Error('Retired inventory bytes');
   items.push([path.relative(base,file),s.dev,s.ino,s.mode,s.uid,s.gid,s.nlink,s.size,s.mtimeMs,s.ctimeMs]);
   if(s.isDirectory())for(const name of (await fs.readdir(file)).sort())await visit(path.join(file,name),depth+1);
  };
  await visit(base,0);return hash(JSON.stringify(items));
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
 const rootRetired=async(root:string)=>{
  try{
   if(ordinaryFacts.has(root))return false;
   const live=retired.get(root);
   // Same-process retirement is an explicit Main receipt. Ordinary edits may
   // change source bytes, but cannot mutate the recovery namespace. Inspect its
   // bounded identity/ctime/name inventory, rather than decoding every historic
   // raster/native attribute on every brush or Add IPC. Unknown growth refuses.
   if(live)return live.rootIdentity===await identity(root)&&live.parentIdentity===await identity(path.join(root,'.storyboard-workbench'))&&live.inventory===await inventoryFingerprint(root);
   const {state,storagePolicy}=await readState(root);if(state.state!=='protectedReadable')return false;
   // This proves current bytes, not historical notification, and creates no
   // executable continuation or nonce. Completed strings alone are insufficient.
   const c=state.content!,completion=(c.continuationState as any)?.terminal;
   if((c.continuationState as any)?.stage!=='completed'||(c.effectFacts as any)?.state!=='completed-binding-persist-ack'||!completion||completion.schema!=='swb.current-terminal.v1'||!Array.isArray(completion.files))return false;
   const files=terminalPaths(root,c.projectRaw,(c.continuationState as any)?.deletedDependencies??[]);
   if(completion.files.length!==files.length)return false;
   for(let i=0;i<files.length;i++){const d=completion.files[i];if(d.file!==path.relative(root,files[i])||!/^[a-f0-9]{64}$/.test(d.digest))return false;await canonicalPath(root,files[i]);if(hash(await readExact(files[i]))!==d.digest)return false;}
   if(!(await readExact(files[0])).equals(Buffer.from(`${JSON.stringify(c.projectRaw,null,2)}\n`))||!(await readExact(files[1])).equals(Buffer.from(serializeStoryboardScriptMarkdown(c.projectRaw as any))))return false;
   // Terminal bytes alone cannot certify changed source restrictions. Namespace
   // policy is authenticated storage data, not a grant of ordinary writer authority.
   const policy=(await native({phase:'capturePolicy',sources:files})).sourcePolicy;
   if(JSON.stringify(policy.expected)!==JSON.stringify(storagePolicy.expected))return false;
   retired.set(root,{rootIdentity:await identity(root),parentIdentity:await identity(path.join(root,'.storyboard-workbench')),seal:state.ack!.sealDigest,inventory:await inventoryFingerprint(root)});return true;
  }catch{return false;}
 };
 installWorkspaceRetirementPredicate(rootRetired);
 const readReadonly=async(root:string)=>{const {store,state}=await readState(root);const assets=[],retained=await store.readAssets(root,state.ack!.generationId);for(const a of state.content!.assets){const b=retained.get(a.assetId);if(!b)throw new Error('Readonly whole-capture asset missing');const display=a.encoding==='tiff'?await sharp(b,{limitInputPixels:Math.floor(configured().bytes/4),failOn:'error'}).png().toBuffer():b;assets.push({role:a.role,sourceDataUrl:`data:image/${a.encoding};base64,${b.toString('base64')}`,dataUrl:`data:image/png;base64,${display.toString('base64')}`});}return {state:state.state,revision:state.ack!.revision,projectRaw:state.content!.projectRaw,effectFacts:state.content!.effectFacts,viewState:state.content!.viewState,continuationState:state.content!.continuationState,original:{...(state.content!.scriptState as any).original,projectRaw:JSON.parse(Buffer.from((state.content!.scriptState as any).original.metadataBytes,'base64').toString('utf8')),scriptText:(state.content!.scriptState as any).original.scriptBytes===null?null:Buffer.from((state.content!.scriptState as any).original.scriptBytes,'base64').toString('utf8')},assets};};
 type Custody = { records:any[]; current:Record<string,{version:string;state:'present'|'deleted'}>; assets:RecoveryOffer['assets'] };
 const custodies=new Map<string,{sender:object;document:object;rootIdentity:string;parentIdentity:string;value:Custody}>();
 const documentIds=new WeakMap<object,string>();
 const custodyFor=async(l:Lease):Promise<Custody>=>{
  const live=custodies.get(l.root);
  if(live){if(live.sender!==l.sender||live.document!==l.document||live.rootIdentity!==l.rootIdentity||live.parentIdentity!==l.parentIdentity)throw new Error('Producer custody caller/document/incarnation mismatch');return live.value;}
  const value:Custody={records:[],current:{},assets:[]};
  // Cold adoption is content-only, after the sealed store's full native chain,
  // inventory, physical binding and every encoded byte have been authenticated.
  try{const {store,state}=await readState(l.root),c=state.content!,record=(c.scriptState as any)?.producerCustody;
   if(record!==undefined){
    if(state.state!=='protectedReadable'||record.schema!=='swb.producer-png-custody.v1'||record.rootIdentity!==l.rootIdentity||record.parentIdentity!==l.parentIdentity||!Array.isArray(record.records)||!record.current||record.records.length>configured().records)throw new Error('Cold producer custody association');
    const bytes=await store.readAssets(l.root,state.ack!.generationId);
    for(const r of record.records){
     if(r.schema!=='swb.producer-png-receipt.v1'||r.rootIdentity!==l.rootIdentity||r.parentIdentity!==l.parentIdentity||typeof r.document!=='string'||!['layers:createPng','layers:writePng'].includes(r.producer)||!r.file.startsWith('.storyboard-workbench/layers/')||path.relative(l.root,path.resolve(l.root,r.file))!==r.file||!r.file.endsWith('.png')||!/^[a-f0-9]{64}$/.test(r.digest))throw new Error('Cold producer receipt malformed');
     const asset=c.assets.find(a=>a.role===`custody/${r.version}`),b=asset&&bytes.get(asset.assetId);
     if(!asset||!b||asset.encoding!=='png'||hash(b)!==r.digest||asset.width!==r.width||asset.height!==r.height||value.records.some(v=>v.version===r.version))throw new Error('Cold producer asset association');
     restrictCustody(l,r.sourcePolicy);value.records.push(structuredClone(r));value.assets.push({...asset,bytes:b});
    }
    for(const [file,s] of Object.entries(record.current) as [string,any][]){if(!['present','deleted'].includes(s.state)||!value.records.some(r=>r.version===s.version&&r.file===file))throw new Error('Cold producer current-version association');value.current[file]={version:s.version,state:s.state};}
   }
  }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  custodies.set(l.root,{sender:l.sender,document:l.document,rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,value});return value;
 };
 const restrictCustody=(l:Lease,policy:any)=>{
  const expected=l.sourcePolicy.expected,actual=policy?.expected;
  if(policy?.schema!=='swb.finite-source-policy'||policy.version!==1||!Array.isArray(policy.observed)||policy.observed.length!==1||!actual||Object.keys(expected).some(k=>k==='mode'?(expected.mode&actual.mode)!==expected.mode:JSON.stringify(expected[k])!==JSON.stringify(actual[k])))throw new Error('Producer source restrictions conflict with immutable storage policy');
 };
 const currentCustody=async(l:Lease,file:string,value:Custody)=>{
  await canonicalPath(l.root,file);const rel=path.relative(l.root,file),s=value.current[rel];if(!s)return;
  const r=value.records.find(v=>v.version===s.version&&v.file===rel);if(!r)throw new Error('Producer current custody missing');
  if(s.state==='deleted'){try{await fs.lstat(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}throw new Error('Producer deleted path replaced');}
  const b=await readExact(file),policy=(await native({phase:'capturePolicy',sources:[file]})).sourcePolicy;
  if(hash(b)!==r.digest||JSON.stringify(policy)!==JSON.stringify(r.sourcePolicy))throw new Error('Producer source physical version changed');
 };
 const appendCustody=async(l:Lease,offer:RecoveryOffer):Promise<RecoveryOffer>=>{
  const value=await custodyFor(l);if(!value.records.length)return offer;
  if(value.records.length>configured().records||value.assets.length>configured().assets)throw new Error('Producer custody finite budget');
  const assets=[...offer.assets.filter(a=>!a.role.startsWith('custody/')),...value.assets.map(a=>({...a,bytes:Buffer.from(a.bytes)}))];
  return {...offer,scriptState:{...offer.scriptState as object,producerCustody:{schema:'swb.producer-png-custody.v1',rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,records:structuredClone(value.records),current:structuredClone(value.current)}},assets,requiredAssetIds:assets.map(a=>a.assetId)};
 };
 const producerEffects=(e:Event,l:Lease,channel:string)=>({
  beforeWrite:async(file:string)=>{await authentic(e,l);const value=await custodyFor(l);await currentCustody(l,file,value);},
  written:async(receipt:ProducerPngReceipt)=>{
   await authentic(e,l);const file=receipt.filePath,rel=path.relative(l.root,file);
   // Only the original Add exclusive creation and its subsequent admitted PNG
   // writer can mint versions. Other producer channels remain unsupported.
   if(!rel.startsWith('.storyboard-workbench/layers/')||!rel.endsWith('.png'))return;
   if(!['layers:createPng','layers:writePng'].includes(channel))return;
   const value=await custodyFor(l);if(receipt.kind==='written'&&!value.current[rel])return;
   if(receipt.kind==='created'&&value.current[rel])throw new Error('Producer creation is not a new custody lifecycle');
   await canonicalPath(l.root,file);const before=await identity(file),b=await readExact(file);
   if(before!==`${receipt.identity.dev}:${receipt.identity.ino}`||!b.equals(receipt.bytes))throw new Error('Original producer physical effect receipt mismatch');
   const policy=(await native({phase:'capturePolicy',sources:[file]})).sourcePolicy;restrictCustody(l,policy);
   const a=await raster(b,'custody/pending','pending');if(a.encoding!=='png')throw new Error('Producer custody requires PNG');
   const again=(await native({phase:'capturePolicy',sources:[file]})).sourcePolicy;
   if(JSON.stringify(again)!==JSON.stringify(policy)||await identity(file)!==before||!(await readExact(file)).equals(b))throw new Error('Producer changed during native receipt capture');
   let document=documentIds.get(l.document);if(!document){document=randomUUID();documentIds.set(l.document,document);}
   const version=randomUUID(),record={schema:'swb.producer-png-receipt.v1',version,rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,document,producer:channel,file:rel,identity:before,digest:hash(b),width:a.width,height:a.height,sourcePolicy:policy};
   if(receipt.kind==='created'&&receipt.originalAbsence){
    const origin=receipt.originalAbsence,project=origin.project as any; supported(project);
    const shot=dependencyShots(project).find((s:any)=>s.id===origin.shotId);
    if(!shot||dependencyShots(project).some((s:any)=>s.layers.some((a:any)=>a.id===origin.layerId||a.bitmapPath===rel))||rel!==`.storyboard-workbench/layers/${origin.shotId}/${origin.layerId}.png`)throw new Error('Original exclusive absence descriptor mismatch');
    Object.assign(record,{originalAbsence:{schema:'swb.exclusive-original-absence.v1',version,document,rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,file:rel,project:structuredClone(project),shotId:origin.shotId,layerId:origin.layerId}});
   }
   value.records.push(record);value.current[rel]={version,state:'present'};value.assets.push({...a,assetId:`custody_${version}`,role:`custody/${version}`});
   // Keep the genuine unsettled ordinary fact; this durable receipt is not ACK.
   await retainExact(l,l.offer);await authentic(e,l);
  },
  beforeDelete:async(file:string)=>{await authentic(e,l);await currentCustody(l,file,await custodyFor(l));},
  deleted:async(file:string)=>{
   await authentic(e,l);const value=await custodyFor(l),s=value.current[path.relative(l.root,file)];if(!s)return;
   try{await fs.lstat(file);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;
    const record=value.records.find(r=>r.version===s.version&&r.file===path.relative(l.root,file));if(!record)throw new Error('Deleted producer version missing');
    let document=documentIds.get(l.document);if(!document){document=randomUUID();documentIds.set(l.document,document);}
    record.deletionReceipt={schema:'swb.producer-deleted-version.v1',version:record.version,digest:record.digest,file:record.file,rootIdentity:l.rootIdentity,parentIdentity:l.parentIdentity,document};
    s.state='deleted';await retainExact(l,l.offer);await authentic(e,l);return;}throw new Error('Original producer deletion did not settle');
  }
 });
 const custodyAuthenticates=async(l:Lease,file:string,dataUrl:unknown)=>{
  const value=await custodyFor(l);await currentCustody(l,file,value);const rel=path.relative(l.root,file);
  if(!value.current[rel]||typeof dataUrl!=='string'||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(dataUrl))return false;
  const bytes=Buffer.from(dataUrl.split(',')[1],'base64');return value.records.some(r=>r.file===rel&&r.digest===hash(bytes)&&value.assets.some(a=>a.role===`custody/${r.version}`&&Buffer.from(a.bytes).equals(bytes)));
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
 const retainExact=async(l:Lease,offer:RecoveryOffer)=>{
  offer=await appendCustody(l,offer);
  // Normal-open/rebase may produce own undefined for these OPTIONAL absent
  // collections. Match the existing JSON/History snapshot convention only for
  // those keys; unknown fields, values and raw pending states are not washed.
  const projectRaw=recoveryProjectAbsence(offer.projectRaw);
  const viewState=structuredClone(offer.viewState) as any;
  if(viewState?.history)for(const direction of ['undo','redo'])if(Array.isArray(viewState.history[direction]))for(const entry of viewState.history[direction])entry.project=recoveryProjectAbsence(entry.project);
  offer={...offer,projectRaw,viewState};
  // Any sidecar attempt changes the bounded live inventory. Invalidate even on
  // partial failure; only the cold full-byte terminal predicate may retire anew.
  retired.delete(l.root);
  const store=storeFor(l.sourcePolicy),ack=await store.retain({sender:l.sender,frame:l.frame,window:l.window,document:l.document},l.root,offer);
  const state=await store.inspectReadonly(l.root);if(!['protectedReadable','protectedIncomplete'].includes(state.state)||state.ack?.sealDigest!==ack.sealDigest||state.ack.revision!==offer.revision)throw new Error('Prepared generation exact readback unavailable');
  const retained=await store.readAssets(l.root,ack.generationId);
  for(const a of offer.assets)if(!retained.get(a.assetId)?.equals(Buffer.from(a.bytes)))throw new Error('Prepared asset full-byte readback mismatch');
  l.latestSeal=ack.sealDigest;
  if((offer.effectFacts as any)?.state==='completed-binding-persist-ack'&&!ordinaryFacts.has(l.root)&&!await rootRetired(l.root))throw new Error('Retained current terminal cannot retire Root');
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
   for(;;){try{await fs.lstat(path.join(cursor,'.storyboard-workbench/workspace-recovery-v1'));roots.add(cursor);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}const parent=path.dirname(cursor);if(parent===cursor)break;cursor=parent;}
  }return [...roots];
 };
 const ordinaryLease=async(e:Event,root:string)=>{
  let l=leases.get(root);
  if(l&&l.stage!=='completed')throw new Error('Unfinished Save cannot authorize ordinary effects');
  if(l&&l.sender===e.sender&&l.document===documentFor(e)){await authentic(e,l);return l;}
  const {store,state,storagePolicy}=await readState(root),c=state.content!;
  const bytes=await store.readAssets(root,state.ack!.generationId),assets=c.assets.map(a=>({...a,bytes:bytes.get(a.assetId)!}));
  const window=options.ownerFromSender?.(e.sender)??e.sender;if(!window)throw new Error('Actual ordinary window unavailable');
  l={sender:e.sender,frame:e.senderFrame!,window,document:documentFor(e),root,rootIdentity:await identity(root),parentIdentity:await identity(path.join(root,'.storyboard-workbench')),nonce:randomUUID(),p1:hash(JSON.stringify(c.projectRaw)),stage:'completed',sourcePolicy:storagePolicy,offer:{...c,assets,requiredAssetIds:assets.map(a=>a.assetId)},facts:{},result:{project:c.projectRaw},latestSeal:state.ack!.sealDigest};
  leases.set(root,l);return l;
 };
 const ordinary=async(e:Event,channel:string,payload:any,targets:readonly string[],execute:()=>Promise<any>)=>withLayerFileOperation(async()=>{
  current(e);const roots=await protectedRoots(targets);
  if(!roots.length){
   const observed=[...observations.values()].filter(o=>o.sender===e.sender&&targets.some(t=>t===o.folderPath||t.startsWith(o.folderPath+path.sep)));
   for(const o of observed)await authenticObservation(e,o);
   await assertPhysicalWorkspaceWriterTargets(targets);
   const facts=observed.map(o=>{const fact={channel,state:'started',error:undefined as string|undefined};o.facts.push(fact);return {o,fact};});
   const finalize=async()=>{for(const {o} of facts){
    // Binding was consumed at the original mkdir receipt, not by later existence.
    await authenticObservation(e,o);
   }};
   try{const result=await withWorkspaceInitialization(observed.filter(o=>o.parentIdentity===null).map(o=>({parent:path.join(o.folderPath,'.storyboard-workbench'),created:async()=>{if(o.rootIdentity!==await identity(o.folderPath))throw new Error('Observed workspace incarnation changed');if(o.parentIdentity!==null)throw new Error('Observed parent creator receipt repeated');o.parentIdentity=await identity(path.join(o.folderPath,'.storyboard-workbench'));await authenticObservation(e,o);}})),execute);await finalize();for(const {o,fact} of facts){fact.state=result?.ok===false||result?.recoveryIncomplete?'failed':'settled';if(result?.project)o.project=structuredClone(result.project);if(channel==='workspace:autosave'&&payload?.project)o.project=structuredClone(payload.project);}return result;}
   catch(error){for(const {fact} of facts){fact.state='failed';fact.error=String(error);}await finalize();throw error;}
  }
  if(roots.length!==1)throw new Error('Ordinary operation touches multiple protected physical Roots');const root=roots[0];
  // Pure open/derived observations do not retire a producer, nor borrow its
  // in-flight authority. Their pre-existing physical guard remains unchanged.
  if(['workspace:openFolderByPath','workspace:startFolderWatch','workspace:checkExternalChanges','workspace:checkStoryboardScript'].includes(channel)){
   const observed=[...observations.values()].filter(o=>o.sender===e.sender&&targets.some(t=>t===o.folderPath||t.startsWith(o.folderPath+path.sep)));
   for(const o of observed)await authenticObservation(e,o);
   await assertPhysicalWorkspaceWriterTargets(targets);
   const facts=observed.map(o=>{const fact={channel,state:'started',error:undefined as string|undefined};o.facts.push(fact);return {o,fact};});
   try{const result=await withDerivedPreviewReceipt(async receipt=>{
    if(channel!=='workspace:openFolderByPath'||receipt.root!==root)throw new Error('Derived preview outside actual reader');
    const {state}=await readState(root),tip=state.content!,terminal=(tip.continuationState as any)?.terminal;
    if(state.state!=='protectedReadable'||!terminal||terminal.schema!=='swb.current-terminal.v1'||JSON.stringify(recoveryProjectAbsence(receipt.original))!==JSON.stringify(recoveryProjectAbsence(tip.projectRaw)))throw new Error('Derived preview original current terminal mismatch');
    for(const image of receipt.images){if(!terminal.files.some((f:any)=>f.file===path.relative(root,image.source)&&f.digest===image.sourceDigest))throw new Error('Derived preview terminal source mismatch');await canonicalPath(root,image.preview);if(hash(await readExact(image.preview))!==image.previewDigest)throw new Error('Derived preview receipt changed');}
    const policy=(await native({phase:'captureMemoryPolicy',sources:receipt.images.flatMap(i=>[i.source,i.preview])})).sourcePolicy;
    for(const {o} of facts){await authenticObservation(e,o);o.derived={receipt:structuredClone(receipt),policy,seal:state.ack!.sealDigest};}
   },execute);for(const {o,fact} of facts){await authenticObservation(e,o);fact.state='settled';if(result?.project)o.project=structuredClone(result.project);}
    if(channel==='workspace:openFolderByPath'){
     const {state}=await readState(root);if(state.state!=='protectedReadable')throw new Error('Cold History full inventory unavailable');
     const history=(state.content!.viewState as any)?.history;
     if(history!==undefined)return {...result,recoveryHistory:structuredClone(history)};
    }
    return result;
   }
   catch(error){for(const {fact} of facts){fact.state='failed';fact.error=String(error);}throw error;}
  }
  for(const target of targets){if(target!==root&&!target.startsWith(root+path.sep))throw new Error('Ordinary destination outside exact Root');if(target.includes('/workspace-recovery-v1'))throw new Error('Ordinary recovery-namespace target refused');await canonicalPath(root,target===root?path.join(root,'.storyboard-workbench'):target);}
  let fact=ordinaryFacts.get(root);
  if(fact){await authentic(e,fact.lease);if(fact.stage!=='pending')throw new Error('Ordinary producer failed or awaiting exact ACK; Root protected');}
  else{
   if(!await rootRetired(root))throw new Error('Physical workspace protected by recovery inventory; ordinary writer refused');
   const l=await ordinaryLease(e,root);readerLeases.delete(l);fact={lease:l,nonce:randomUUID(),stage:'pending',channels:[]};ordinaryFacts.set(root,fact);retired.delete(root);
   try{const deleted=(l.offer.continuationState as any)?.deletedDependencies??[],paths=terminalPaths(root,l.result.project,deleted);
    const policy=(await native({phase:'capturePolicy',sources:paths})).sourcePolicy;if(JSON.stringify(policy.expected)!==JSON.stringify(l.sourcePolicy.expected))throw new Error('Ordinary source restriction intersection changed');
    const assets=await captureCurrentAssets(root,l.result.project,deleted);
    const offer:RecoveryOffer={...l.offer,assets,requiredAssetIds:assets.map(a=>a.assetId),scriptState:{original:{...(l.offer.scriptState as any).original,metadataBytes:(await readExact(path.join(root,'.storyboard-workbench/storyboard.project.json'))).toString('base64'),scriptBytes:(await readExact(path.join(root,'storyboard-script.md'))).toString('base64'),sourcePolicy:policy}},revision:`ordinary-started:${fact.nonce}`,projectRaw:l.result.project,effectFacts:{state:'ordinary-unsettled',channels:[channel]},continuationState:{stage:'ordinary-unsettled',notExecutable:true,deletedDependencies:deleted}};
    await retainExact(l,offer);l.offer=offer;
   }catch(error){fact.stage='failed';throw error;}
  }
  const own=fact;own.channels.push(channel);
  try{
   const result=await withProducerPngEffects(producerEffects(e,own.lease,channel),execute);await authentic(e,own.lease);
   if(result?.ok===false||result?.recoveryIncomplete===true){own.stage='failed';own.lease.facts={state:'ordinary-failed',channels:own.channels,result};return result;}
   if(channel==='workspace:autosave'){
    if(payload.folderPath!==root||payload.metadataPath!==path.join(root,'.storyboard-workbench/storyboard.project.json'))throw new Error('Ordinary persist binding mismatch');supported(payload.project);
    const json=await readExact(payload.metadataPath),md=await readExact(path.join(root,'storyboard-script.md'));
    if(!json.equals(Buffer.from(`${JSON.stringify(payload.project,null,2)}\n`))||!md.equals(Buffer.from(serializeStoryboardScriptMarkdown(payload.project))))throw new Error('Ordinary current JSON/MD readback mismatch');
    own.project=JSON.parse(json.toString('utf8'));own.deleted=structuredClone(payload.recoveryContent?.deletedDependencies??[]);own.stage='persisted';
    return {...result,ordinaryPersistenceNonce:own.nonce};
   }
   return result;
  }catch(error){own.stage='failed';own.lease.facts={state:'ordinary-failed',channels:own.channels,error:String(error)};throw error;}
 });
 const acknowledgeOrdinary=async(e:Event,payload:any,fact:NonNullable<ReturnType<typeof ordinaryFacts.get>>)=>{
  const l=fact.lease;await authentic(e,l);
  if(fact.stage!=='persisted'||payload.nonce!==fact.nonce||hash(JSON.stringify(payload.project))!==hash(JSON.stringify(fact.project)))throw new Error('Ordinary exact persistence ACK mismatch');
  const p=fact.project,deleted=fact.deleted??[],files=[],assets:RecoveryOffer['assets']=[];
  const paths=terminalPaths(l.root,p,deleted);
  for(const file of paths){await canonicalPath(l.root,file);const bytes=await readExact(file);files.push({file:path.relative(l.root,file),digest:hash(bytes)});}
  if(!(await readExact(paths[0])).equals(Buffer.from(`${JSON.stringify(p,null,2)}\n`))||!(await readExact(paths[1])).equals(Buffer.from(serializeStoryboardScriptMarkdown(p))))throw new Error('Ordinary binding changed before ACK');
  for(const s of dependencyShots(p,deleted)){for(const d of [{file:s.imagePath,role:`original/${s.id}/base`,width:s.swb.canvasWidth,height:s.swb.canvasHeight},...s.layers.map((v:any)=>({file:path.resolve(l.root,v.bitmapPath),role:`original/${s.id}/${v.id}`,width:v.width,height:v.height}))]){const a=await raster(await readExact(d.file),d.role,`asset_${assets.length}`);if(a.width!==d.width||a.height!==d.height)throw new Error('Ordinary current raster dimensions');assets.push(a);}}
  const policy=(await native({phase:'capturePolicy',sources:paths})).sourcePolicy;if(JSON.stringify(policy.expected)!==JSON.stringify(l.sourcePolicy.expected))throw new Error('Ordinary source restrictions changed');
  const offer:RecoveryOffer={...l.offer,revision:`ordinary-completed:${fact.nonce}`,projectRaw:p,scriptState:{original:{...(l.offer.scriptState as any).original,metadataBytes:(await readExact(paths[0])).toString('base64'),scriptBytes:(await readExact(paths[1])).toString('base64'),sourcePolicy:policy}},effectFacts:{state:'completed-binding-persist-ack',ordinaryChannels:fact.channels},continuationState:{stage:'completed',deletedDependencies:deleted,terminal:{schema:'swb.current-terminal.v1',files}},assets,requiredAssetIds:assets.map(a=>a.assetId)};
  await retainExact(l,offer);await authentic(e,l);
  ordinaryFacts.delete(l.root);l.offer=offer;l.result={project:p};
  if(!await rootRetired(l.root)){ordinaryFacts.set(l.root,fact);throw new Error('Ordinary terminal cannot retire Root');}return true;
 };
 const run=async(e:Event,payload:any,save:()=>Promise<any>)=>withLayerFileOperation(async()=>{
  configured();current(e);if(payload.normalSave!==true)throw new Error('Prepared Save requires actual normal Save');
  const root=await fs.realpath(payload.folderPath);if(root!==payload.folderPath)throw new Error('Save root alias refused');
  const previous=leases.get(root);if(previous&&previous.stage!=='completed')throw new Error('Unfinished Save capability cannot be replayed');
  await assertPhysicalWorkspaceWriterTargets([root]);
  let existingPolicy:any;try{existingPolicy=(await readState(root)).storagePolicy;}catch(error){try{await fs.lstat(path.join(root,'.storyboard-workbench/workspace-recovery-v1'));throw error;}catch(absent){if((absent as NodeJS.ErrnoException).code!=='ENOENT')throw absent;}}
  supported(payload.project);
  if(['unsupported','corrupt'].includes(classifyPendingBakeEnvelope(payload.project.pendingBake))||Object.values(payload.project.pendingBake?.shots??{}).some((entry:any)=>entry.state==='unknown'))throw new Error('Unsupported/corrupt/unknown Pending Save input');
  const plan=payload.renamePlan??[];if(!Array.isArray(plan)||new Set(plan.map((v:any)=>v.shotId)).size!==plan.length)throw new Error('Ambiguous finite rename plan');
  for(const r of plan){const s=payload.project.shots.find((v:any)=>v.id===r.shotId);if(!s||s.imagePath!==r.finalPath||s.fileName!==r.finalFileName||path.dirname(r.fromPath)!==root||path.dirname(r.finalPath)!==root||path.dirname(r.temporaryPath)!==root||r.temporaryPath!==path.join(root,`.storyboard-renaming-${r.shotId}${path.extname(r.fromPath)}`)||r.finalFileName!==path.basename(r.finalPath)||!/^.*\.tiff?$/iu.test(r.finalPath))throw new Error('Rename outside finite root plan');for(const file of [r.fromPath,r.finalPath,r.temporaryPath])await canonicalPath(root,file);for(const file of [r.temporaryPath,r.finalPath])if(file!==r.fromPath){try{await fs.lstat(file);throw new Error('Finite rename target already exists');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}}
  const c=payload.recoveryContent;if(!c||!Array.isArray(c.desiredAssets)||!c.effectFacts||c.effectFacts.receipt?.length||c.effectFacts.deletions?.length||c.effectFacts.remainingScript)throw new Error('Latest Owner dependency capture required');supported(c.projectRaw);
  const pendingDeleted=payload.project.pendingDeletedShots??[],deleted=c.deletedDependencies??[];
  if(!Array.isArray(deleted)||deleted.length!==pendingDeleted.length||pendingDeleted.some((d:any)=>deleted.filter((s:any)=>s.id===d.id&&s.imagePath===d.imagePath&&s.fileName===d.fileName).length!==1))throw new Error('Exact deleted-source dependency capture required');
  supported({...payload.project,shots:dependencyShots(payload.project,deleted),parkedShots:[],pendingDeletedShots:[]});
  const mapped=structuredClone(c.projectRaw);mapped.updatedAt=payload.project.updatedAt;for(const r of plan){const s=mapped.shots.find((v:any)=>v.id===r.shotId);if(!s||s.imagePath!==r.fromPath)throw new Error('Owner before-rename source mismatch');const target=payload.project.shots.find((v:any)=>v.id===r.shotId);s.imagePath=r.finalPath;s.fileName=r.finalFileName;s.sourceFileName=target.sourceFileName;}
  if(JSON.stringify(mapped)!==JSON.stringify(payload.project))throw new Error('Owner raw Project/P1 mismatch');
  const metadata=path.join(root,'.storyboard-workbench/storyboard.project.json');if(payload.metadataPath!==metadata)throw new Error('Metadata binding mismatch');
  const paths=[metadata],assets:RecoveryOffer['assets']=[],versionInputs:any[]=[];
  await canonicalPath(root,metadata);
  for(const marker of ["pending-file-transaction.json"]){try{await fs.lstat(path.join(root,".storyboard-workbench",marker));throw new Error("Uncovered Pending transaction inventory");}catch(e){if((e as NodeJS.ErrnoException).code!=="ENOENT")throw e;}}
  const originalJSON=await readExact(metadata);JSON.parse(originalJSON.toString('utf8'));
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
  const storagePolicy=existingPolicy??sourcePolicy;if(JSON.stringify(storagePolicy.expected)!==JSON.stringify(sourcePolicy.expected))throw new Error('New source restriction intersection conflicts with immutable namespace policy');
  for(const d of c.desiredAssets){const s=dependencyShots(payload.project,deleted).find((v:any)=>v.id===d.shotId),layer=s?.layers.find((v:any)=>v.id===d.layerId);if(!layer||d.folderPath!==root||d.bitmapPath!==layer.bitmapPath||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(d.dataUrl))throw new Error('Unpublished desired asset cannot be omitted');const desired=await raster(Buffer.from(d.dataUrl.split(',')[1],'base64'),`desired/${d.shotId}/${d.layerId}`,`asset_${assets.length}`);if(desired.encoding!=='png'||desired.width!==layer.width||desired.height!==layer.height)throw new Error('Desired PNG dimensions/encoding mismatch');assets.push(desired);}
  const nonce=randomUUID(),p1=hash(JSON.stringify(payload));
  const offer:RecoveryOffer={revision:`prepared:${nonce}`,projectRaw:c.projectRaw,viewState:{sequence:c.sequence,assetRevision:c.assetRevision},scriptState:{original:{metadataPath:metadata,metadataBytes:originalJSON.toString('base64'),scriptPath:script,scriptBytes:scriptBytes?.toString('base64')??null,versionInputs,sourcePolicy}},effectFacts:c.effectFacts,continuationState:{stage:'prepared',nonce,p1,domain:'owned-single-existing-PNG-finite-rename',renamePlan:plan},assets,requiredAssetIds:assets.map(a=>a.assetId)};
  const window=options.ownerFromSender?.(e.sender)??e.sender;if(options.ownerFromSender&&!options.ownerFromSender(e.sender))throw new Error("Actual Save window unavailable");
  const l:Lease={sender:e.sender,frame:e.senderFrame!,window,document:documentFor(e),root,rootIdentity:await identity(root),parentIdentity:await identity(path.dirname(metadata)),nonce,p1,stage:'prepared',sourcePolicy:storagePolicy,offer,facts:c.effectFacts};
  // Ownership exists before the first sidecar effect. Failed preparation keeps
  // pinned offer/facts and never claims that sourceEffects:0 means no sidecar.
  leases.set(root,l);retired.delete(root);
  try{await retainExact(l,offer);
  // Revalidate finite original versions and native policy after sidecar readback,
  // immediately before actual original stagePendingDeletedShotFiles.
  const rereadPolicy=(await native({phase:'capturePolicy',sources:paths})).sourcePolicy;if(JSON.stringify(rereadPolicy)!==JSON.stringify(sourcePolicy))throw new Error('Sources changed during g1 preparation');
  if(!(await readExact(metadata)).equals(originalJSON)||scriptBytes&&!(await readExact(script)).equals(scriptBytes))throw new Error('Metadata/script changed during preparation');
  for(const v of versionInputs)if(await identity(v.file)!==v.identity||hash(await readExact(v.file))!==v.digest)throw new Error('Original source changed before stage');
  await authentic(e,l);if(hash(JSON.stringify(payload))!==p1)throw new Error('P1 changed before original execution');l.stage='executing';
  }catch(error){l.stage='failed';l.facts={phase:'preparation',sourceEffects:0,sidecarEffects:'partial-or-unknown',error:String(error)};throw error;}
  try{const result=await save();await authentic(e,l);if(result?.ok===false){l.stage='failed';l.facts=result.error;
    try{await retainExact(l,{...l.offer,revision:`failed:${l.nonce}`,effectFacts:{main:result.error,owner:l.offer.effectFacts},continuationState:{stage:'failed',nonce:l.nonce,p1:l.p1,notExecutable:true}});}catch(retentionError){l.facts={main:result.error,retention:{message:retentionError instanceof Error?retentionError.message:String(retentionError)}};}
    return result;}
   l.result=result;l.stage='output';return {...result,recoverySaveNonce:nonce};}catch(error){l.stage='failed';l.facts={stage:'failed',error:error instanceof Error?{name:error.name,message:error.message,...Object.fromEntries(Object.entries(error))}:String(error)};throw error;}
 });
 const persist=async(e:Event,payload:any,write:()=>Promise<any>)=>withLayerFileOperation(async()=>{
  const l=leases.get(payload.folderPath);if(payload.normalSave!==true||payload.normalSaveScriptInput!==undefined||payload.normalSaveScriptExpectedInput!==undefined)throw new Error('Binding persist outside ordinary Save domain');if(!l||typeof payload.recoverySaveNonce!=='string'||payload.recoverySaveNonce!==l.nonce||l.stage!=='output')throw new Error('Binding persist capability/stage mismatch');await authentic(e,l);
  if(payload.metadataPath!==path.join(l.root,'.storyboard-workbench/storyboard.project.json'))throw new Error('Binding persist metadata mismatch');supported(payload.project);
  if(payload.project.shots.length!==l.result.project.shots.length||payload.project.shots.some((s:any)=>!l.result.project.shots.some((v:any)=>v.id===s.id&&v.imagePath===s.imagePath&&JSON.stringify(v.layers)===JSON.stringify(s.layers))))throw new Error('Binding persist outside prepared asset domain');
  try{const result=await write();await authentic(e,l);
    const metadata=path.join(l.root,'.storyboard-workbench/storyboard.project.json'),script=path.join(l.root,'storyboard-script.md');for(const file of [metadata,script])await canonicalPath(l.root,file);
    if(!(await readExact(metadata)).equals(Buffer.from(`${JSON.stringify(payload.project,null,2)}\n`))||!(await readExact(script)).equals(Buffer.from(serializeStoryboardScriptMarkdown(payload.project))))throw new Error('Exact binding JSON/MD readback mismatch');
    for(const ack of l.result.normalSaveOutputs??[])if(hash(await readExact(ack.targetPath))!==ack.outputHash)throw new Error('Output changed before final binding persist ACK');
    l.result={...l.result,project:structuredClone(payload.project)};l.stage='persisted';return result;}catch(error){l.stage='failed';throw error;}
 });
 const acknowledge=async(e:Event,payload:any)=>withLayerFileOperation(async()=>{const ordinaryFact=ordinaryFacts.get(payload.folderPath);if(ordinaryFact)return acknowledgeOrdinary(e,payload,ordinaryFact);const l=leases.get(payload.folderPath);if(!l||payload.nonce!==l.nonce||l.stage!=='persisted')throw new Error('Owner ACK capability/stage mismatch');await authentic(e,l);if(hash(JSON.stringify(payload.project))!==hash(JSON.stringify(l.result.project)))throw new Error('Owner exact binding ACK mismatch');
  if(!(await readExact(path.join(l.root,'.storyboard-workbench/storyboard.project.json'))).equals(Buffer.from(`${JSON.stringify(l.result.project,null,2)}\n`))||!(await readExact(path.join(l.root,'storyboard-script.md'))).equals(Buffer.from(serializeStoryboardScriptMarkdown(l.result.project))))throw new Error('Current final binding changed before Owner ACK');
  for(const ack of l.result.normalSaveOutputs??[])if(hash(await readExact(ack.targetPath))!==ack.outputHash)throw new Error('Current output changed before Owner ACK');
  const files=[];for(const file of terminalPaths(l.root,l.result.project)){await canonicalPath(l.root,file);files.push({file:path.relative(l.root,file),digest:hash(await readExact(file))});}
  await retainExact(l,{...l.offer,revision:`completed:${l.nonce}`,projectRaw:l.result.project,effectFacts:{state:'completed-binding-persist-ack'},continuationState:{stage:'completed',outputs:l.result.normalSaveOutputs,terminal:{schema:'swb.current-terminal.v1',files}}});
  // Consume the same cold current-terminal predicate before retiring live state.
  if(!await rootRetired(l.root))throw new Error('Current terminal cannot retire Root');l.stage='completed';return true;});
 const protectedInventory=(e:Event)=>{
  const roots=new Map<string,Lease|Observation>();
  for(const o of observations.values())if(o.sender===e.sender&&(o.facts.length||o.memory))roots.set(o.folderPath,o);
  for(const l of leases.values())if(l.sender===e.sender&&l.stage!=='completed')roots.set(l.root,l);
  for(const fact of ordinaryFacts.values())if(fact.lease.sender===e.sender)roots.set(fact.lease.root,fact.lease);
  return roots;
 };
 const retainedOffer=async(e:Event,c:any,l:Lease,handoff=false):Promise<RecoveryOffer>=>{
  if(!['failed','output','persisted','completed'].includes(l.stage))throw new Error('No settled retained production Save operation');
  await authentic(e,l);await canonicalPath(l.root,path.join(l.root,'.storyboard-workbench/workspace-recovery-v1'));
  if(handoff){const o=observations.get(c.binding);if(!o||o.sender!==e.sender||o.document!==documentFor(e)||o.folderPath!==l.root||o.rootIdentity!==l.rootIdentity||o.parentIdentity!==l.parentIdentity)throw new Error('Handoff original observation mismatch');}
  const fact=ordinaryFacts.get(l.root);
  if(fact&&fact.stage!=='failed')throw new Error('Ordinary source I/O or exact persistence ACK remains unsettled');
  if(fact)throw new Error('Ordinary failed producer is outside the prepared Save domain');
  if(l.stage==='completed'&&c.content?.effectFacts?.unsettled)throw new Error('New producer failure is outside the prepared Save domain');
  if(c.canvas?.hasUnsettledGesture||c.canvas?.captures?.some((v:any)=>v.hasUnsettledGesture)||!c.content||c.content.retainedAssetIntents?.length)throw new Error('Unsettled mounted capture or retained producer intent; keep window');supported(c.content.projectRaw);
  const p=c.content.projectRaw,expected=l.stage==='completed'?l.result.project:l.offer.projectRaw as any;
  for(const group of ['shots','parkedShots','pendingDeletedShots']){
   const actual=p[group]??[],prepared=expected[group]??[];
   if(actual.length!==prepared.length||actual.some((s:any)=>!prepared.some((v:any)=>v.id===s.id&&v.imagePath===s.imagePath&&v.fileName===s.fileName&&JSON.stringify(v.layers)===JSON.stringify(s.layers))))throw new Error('Close new producer inventory not prepared');
  }
  const assets:RecoveryOffer['assets']=l.offer.assets.filter(a=>a.role.startsWith('original/')).map(a=>({...a,bytes:Buffer.from(a.bytes)}));
  if(!Array.isArray(c.content.desiredAssets)||c.content.effectFacts?.receipt?.length||c.content.effectFacts?.deletions?.length||c.content.effectFacts?.remainingScript)throw new Error('Close dependency domain unsupported');
  for(const d of c.content.desiredAssets){const s=p.shots.find((v:any)=>v.id===d.shotId),layer=s?.layers.find((v:any)=>v.id===d.layerId);if(!layer||d.folderPath!==l.root||d.bitmapPath!==layer.bitmapPath||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(d.dataUrl))throw new Error('Close desired binding mismatch');const desired=await raster(Buffer.from(d.dataUrl.split(',')[1],'base64'),`desired/${d.shotId}/${d.layerId}`,`asset_${assets.length}`);if(desired.encoding!=='png'||desired.width!==layer.width||desired.height!==layer.height)throw new Error('Desired PNG dimensions/encoding mismatch');assets.push(desired);}
  if(!c.canvas||!Array.isArray(c.canvas.captures))throw new Error('Mounted registry capture required');
  for(const v of c.canvas.captures){
   const shot=dependencyShots(p).find((s:any)=>s.id===v.shotId);
   if(!shot||v.folderPath!==l.root||!Array.isArray(v.liveLayers))throw new Error('Mounted slot source binding mismatch');
   for(const layer of v.liveLayers){
    const source=shot.layers.find((a:any)=>a.id===layer.layerId);
    if(!source||!l.sourcePolicy.observed.some((a:any)=>a[0]===path.resolve(l.root,source.bitmapPath))&&!await custodyAuthenticates(l,path.resolve(l.root,source.bitmapPath),layer.dataUrl)||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(layer.dataUrl))throw new Error('Mounted PNG source not authenticated');
    const a=await raster(Buffer.from(layer.dataUrl.split(',')[1],'base64'),`canvas/${v.shotId}/${layer.layerId}`,`asset_${assets.length}`);
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
     const h=await raster(Buffer.from(a.dataUrl.split(',')[1],'base64'),`history/${direction}/${index}/${assetIndex}`,`asset_${assets.length}`);
     if(h.encoding!=='png'||h.width!==layer.width||h.height!==layer.height)throw new Error('History PNG dimensions');assets.push(h);
    }
   }
  }else if(handoff)throw new Error('Handoff requires explicit private History data');
  let terminal: unknown;
  if(l.stage==='completed'&&hash(JSON.stringify(p))===hash(JSON.stringify(l.result.project))){
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
   if(!(await readExact(files[0])).equals(Buffer.from(`${JSON.stringify(p,null,2)}\n`))||!(await readExact(files[1])).equals(Buffer.from(serializeStoryboardScriptMarkdown(p))))throw new Error('Completed exact current binding mismatch');
   const policy=(await native({phase:'capturePolicy',sources:files})).sourcePolicy;
   if(JSON.stringify(policy.expected)!==JSON.stringify(l.sourcePolicy.expected))throw new Error('Completed source restrictions changed');
   for(const d of c.content.desiredAssets)if(!Buffer.from(d.dataUrl.split(',')[1],'base64').equals(await readExact(path.resolve(l.root,d.bitmapPath))))throw new Error('Completed desired PNG not current');
   terminal=structuredClone(continuation);
  }
  return {...l.offer,revision:`${handoff?'handoff':'close'}:${c.content.sequence}:${c.content.assetRevision}:${l.nonce}`,projectRaw:p,viewState:{canvas:{...c.canvas,captures:c.canvas.captures.map((v:any)=>({...v,pointerId:v.pointerId===undefined?{state:'absent'}:v.pointerId,transformPixels:v.transformPixels===undefined?{state:'absent'}:v.transformPixels}))},selectedShotIds:c.selectedShotIds,dirtyShotIds:c.dirtyShotIds,fileNameSyncState:c.fileNameSyncState,workspaceSaveState:c.workspaceSaveState,...(c.history===undefined?{}:{history:c.history})},effectFacts:{...(terminal?{state:'completed-binding-persist-ack'}:{}),owner:c.content.effectFacts,main:l.facts},continuationState:terminal??{stage:l.stage,notExecutable:true,nonce:l.nonce,p1:l.p1},assets,requiredAssetIds:assets.map(a=>a.assetId)};
 };
 const certifyRetained=async(e:Event,raw:unknown)=>withLayerFileOperation(async()=>{
  const c=raw as any,l=leases.get(c?.folderPath);if(!l)throw new Error('No retained production Save operation');await authentic(e,l);
  if([...protectedInventory(e).keys()].some(root=>root!==l.root))throw new Error('Hidden unfinished Save inventory cannot be omitted');
  const offer=await retainedOffer(e,c,l);await retainExact(l,offer);await authentic(e,l);return true;
 });
 const readerProject=async(e:Event,o:Observation,tip:any,seal:string)=>{
  if(!o.derived)return tip.projectRaw;
  const d=o.derived,r=d.receipt;
  if(d.seal!==seal||JSON.stringify(recoveryProjectAbsence(r.original))!==JSON.stringify(recoveryProjectAbsence(tip.projectRaw)))throw new Error('Derived view current-terminal association changed');
  const policy=(await native({phase:'captureMemoryPolicy',sources:r.images.flatMap(i=>[i.source,i.preview])})).sourcePolicy;
  if(JSON.stringify(policy)!==JSON.stringify(d.policy))throw new Error('Derived view native incarnation changed');
  for(const i of r.images){if(hash(await readExact(i.source))!==i.sourceDigest||hash(await readExact(i.preview))!==i.previewDigest)throw new Error('Derived view pixels changed');}
  await authenticObservation(e,o);return r.derived;
 };
 const certifiedReaderLease=async(e:Event,c:any)=>{
  const o=observations.get(c?.binding);
  if(!o||o.folderPath!==c.folderPath||!o.facts.length||o.facts.some(f=>f.state!=='settled'||!['workspace:openFolderByPath','workspace:startFolderWatch','workspace:checkExternalChanges','workspace:checkStoryboardScript'].includes(f.channel))||ordinaryFacts.has(c.folderPath))throw new Error('Close collection Root has no Main-owned Save lease or authenticated settled reader');
  await authenticObservation(e,o);
  if(!await rootRetired(o.folderPath))throw new Error('Cold reader current terminal not certified');
  const {state,storagePolicy}=await readState(o.folderPath),tip=state.content!,content=c.content;
  const terminal=(tip.continuationState as any)?.terminal,files=terminalPaths(o.folderPath,tip.projectRaw,(tip.continuationState as any)?.deletedDependencies??[]);
  if((tip.effectFacts as any)?.state!=='completed-binding-persist-ack'||!terminal||terminal.schema!=='swb.current-terminal.v1'||terminal.files?.length!==files.length)throw new Error('Cold reader current terminal missing');
  for(let i=0;i<files.length;i++){await canonicalPath(o.folderPath,files[i]);if(terminal.files[i].file!==path.relative(o.folderPath,files[i])||hash(await readExact(files[i]))!==terminal.files[i].digest)throw new Error('Cold reader current terminal bytes changed');}
  const currentPolicy=(await native({phase:'capturePolicy',sources:files})).sourcePolicy;
  if(JSON.stringify(currentPolicy.expected)!==JSON.stringify(storagePolicy.expected))throw new Error('Cold reader current source restrictions changed');
  const expected=await readerProject(e,o,tip,state.ack!.sealDigest);
  if(state.state!=='protectedReadable'||!content||content.retainedAssetIntents?.length||content.desiredAssets?.length||content.effectFacts?.unsettled||content.effectFacts?.error||content.effectFacts?.receipt?.length||content.effectFacts?.deletions?.length||content.effectFacts?.remainingScript||JSON.stringify(recoveryProjectAbsence(content.projectRaw))!==JSON.stringify(recoveryProjectAbsence(expected)))throw new Error('Cold reader capture has unpreserved obligations');
  const history=(tip.viewState as any)?.history??{undo:[],redo:[]};
  if(hash(JSON.stringify(c.history))!==hash(JSON.stringify(history)))throw new Error('Cold reader omitted retained History');
  if(c.canvas?.hasUnsettledGesture||!Array.isArray(c.canvas?.captures)||c.canvas.captures.some((v:any)=>v.hasUnsettledGesture))throw new Error('Cold reader canvas unsettled');
  for(const v of c.canvas.captures){
   const shot=dependencyShots(expected).find((s:any)=>s.id===v.shotId);
   if(!shot||v.folderPath!==o.folderPath||!Array.isArray(v.liveLayers))throw new Error('Cold reader canvas source binding');
   for(const a of v.liveLayers){
    const layer=shot.layers.find((l:any)=>l.id===a.layerId);
    if(!layer||!/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(a.dataUrl))throw new Error('Cold reader layer source binding');
    const captured=await sharp(Buffer.from(a.dataUrl.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true}),current=await sharp(await readExact(path.resolve(o.folderPath,layer.bitmapPath))).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    if(captured.info.width!==current.info.width||captured.info.height!==current.info.height||!captured.data.equals(current.data))throw new Error('Cold reader has unpreserved canvas pixels');
   }
  }
  await authenticObservation(e,o);const l=await ordinaryLease(e,o.folderPath);readerLeases.set(l,o);return l;
 };
 const certifyRetainedSet=async(e:Event,rawCollection:unknown)=>withLayerFileOperation(async()=>{
  configured();current(e);
  const encoded=JSON.stringify(rawCollection);if(!encoded||Buffer.byteLength(encoded)>configured().bytes)throw new Error('Close collection byte budget');
  const collection=JSON.parse(encoded);
  if(!collection||!Array.isArray(collection.slots)||!collection.slots.length||collection.slots.length>configured().records)throw new Error('Finite nonempty close collection required');
  const expected=protectedInventory(e),verified=new Map<string,{lease:Lease;offer?:RecoveryOffer}>(),physical=new Set<string>();
  // Authenticate/preflight every Root before the first native sidecar write.
  for(const c of collection.slots){
   const root=c?.folderPath;
   if(typeof root!=='string'||!path.isAbsolute(root)||path.normalize(root)!==root||root.includes('\0')||await fs.realpath(root)!==root||verified.has(root))throw new Error('Close collection duplicate/alias physical Root');
   const existing=leases.get(root),reader=!existing||readerLeases.has(existing),l=reader?await certifiedReaderLease(e,c):existing!;
   await authentic(e,l);if(physical.has(l.rootIdentity))throw new Error('Close collection duplicate physical identity');physical.add(l.rootIdentity);
   verified.set(root,{lease:l,...(reader?{}:{offer:await retainedOffer(e,c,l)})});
  }
  if([...expected.keys()].some(root=>!verified.has(root)))throw new Error('Hidden unfinished Save inventory cannot be omitted');
  // Closure-private capability; partial durable protection is never rolled back.
  for(const {lease,offer} of verified.values()){if(offer)await retainExact(lease,offer);await authentic(e,lease);}
  for(const {lease} of verified.values())await authentic(e,lease);
  if([...protectedInventory(e).keys()].some(root=>!verified.has(root)))throw new Error('Protected inventory changed during collection readback');
  return true;
 });
 // Preservation only. Does not complete/retire any lease or issue a Close permit.
 const certifyOrdinaryMemory=async(e:Event,c:any)=>{
  configured();const o=observations.get(c?.binding);if(!o||o.folderPath!==c.folderPath)throw new Error('Ordinary handoff observation mismatch');await authenticObservation(e,o);
  if(o.facts.some(f=>f.state!=='settled')||!o.facts.length)throw new Error('Ordinary staging/producer obligation unsettled');
  // A finite inert pin of ALL files, not a clean/saved renderer declaration.
  // No old closure, path execution, disk retirement or Close permit is issued.
  const encoded=JSON.stringify(c);if(!encoded||Buffer.byteLength(encoded)>configured().bytes||!c.content||c.canvas?.hasUnsettledGesture||c.canvas?.captures?.some((v:any)=>v.hasUnsettledGesture)||c.content.effectFacts?.unsettled||c.content.retainedAssetIntents?.length)throw new Error('Ordinary memory capture unsupported/unsettled');
  const files=new Map<string,Buffer>(),directories=new Map<string,{identity:string;names:string[]}>();let bytes=Buffer.byteLength(encoded),records=0;
  const visit=async(dir:string,depth:number):Promise<void>=>{if(depth>configured().jsonDepth)throw new Error('Ordinary inventory depth budget');const names=(await fs.readdir(dir)).sort();directories.set(dir,{identity:await identity(dir),names});for(const name of names){
   const file=path.join(dir,name),s=await fs.lstat(file);if(++records>configured().records||s.isSymbolicLink())throw new Error('Ordinary inventory identity/record budget');
   if(s.isDirectory())await visit(file,depth+1);else{await canonicalPath(o.folderPath,file);const b=await readExact(file);bytes+=b.length;if(bytes>configured().bytes)throw new Error('Ordinary inventory byte budget');files.set(file,b);}
  }};
  await visit(o.folderPath,0);
  const sourcePolicy=(await native({phase:'captureMemoryPolicy',sources:[...files.keys()]})).sourcePolicy;
  for(const [file,b] of files)if(!(await readExact(file)).equals(b))throw new Error('Ordinary bytes changed during certification');
  for(const [dir,before] of directories)if(await identity(dir)!==before.identity||JSON.stringify((await fs.readdir(dir)).sort())!==JSON.stringify(before.names))throw new Error('Ordinary full inventory changed during certification');
  await authenticObservation(e,o);o.memory={capture:JSON.parse(encoded),files,sourcePolicy};
  return {mode:'ordinary-memory' as const,readonly:false};
 };
 const certifyHandoff=(e:Event,raw:unknown)=>withLayerFileOperation(async()=>{const c=raw as any,l=leases.get(c?.folderPath);if(!l)return certifyOrdinaryMemory(e,c);const offer=await retainedOffer(e,c,l,true);await retainExact(l,offer);await authentic(e,l);return true;});
 const runIpc=async(e:Event,payload:any,execute:()=>Promise<any>)=>{let started=false;try{return await run(e,payload,async()=>{started=true;return execute();});}catch(error){return {ok:false,error:{code:'SAVE_RECOVERY_INCOMPLETE',message:`${started?'Save execution was not certified':'Recovery preparation refused before source effects (0)'}: ${error instanceof Error?error.message:String(error)}`,recoveryIncomplete:true,publicationOrCleanup:started?'started':'not-started',metadata:started?'unknown':'not-started',sourceEffects:started?'unknown':0,sidecarEffects:leases.get(payload?.folderPath)?.facts,retainedPaths:[]}};}};
 return {ordinary,run,runIpc,persist,acknowledge,observeWorkspace,certifyHandoff,certifyRetained,certifyRetainedSet,readReadonly:(root:string)=>withLayerFileOperation(()=>readReadonly(root)),invalidateDocument:(sender:object)=>{documents.set(sender,{});}};
};
