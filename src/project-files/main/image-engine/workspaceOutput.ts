import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ProjectV2} from '../../../platform/contracts/imageProject.js';
import {namingIssue,orderedOutputNames} from '../../../platform/contracts/flowNaming.js';
import {snapshotImageProject,validNativeImageRef} from '../../../session/core/imageProjectModel.js';
import {createOutputObservation} from '../flowOutputObservation.js';
import {settleOutputFileMove,outputPath} from '../flowOutputMove.js';
import {createOutputTrash,validOutputDeletion,type OutputDeletion} from '../flowOutputTrash.js';
import {assertPhysicalWorkspaceWriterTargets} from '../workspacePhysicalWriterGate.js';
import {createFileExclusive,readBoundFile} from '../persistence/fileOps.js';
import {canonicalUtf8,sha256Hex} from '../persistence/canonicalJson.js';
import {syncDirectory} from '../../../platform/main/platform/index.js';
import type {WorkspaceOutput,WorkspaceOutputFile,WorkspaceOutputFrozen,WorkspaceOutputMetadata,WorkspaceOutputOptions,WorkspaceOutputReceipt} from './workspaceOutputContract.js';
import {validWorkspaceOutputMetadataEnvelope} from './workspaceOutputContract.js';

const LIMIT=128*1024*1024, JOURNAL_LIMIT=8*1024*1024;
const owners=new Set<string>();
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const token=(v:unknown):v is string=>typeof v==='string'&&/^[\w-]{1,80}$/.test(v);
const leaf=(v:unknown):v is string=>typeof v==='string'&&!v.startsWith('.')&&!/[\\/\0]/.test(v)&&/\.tif$/i.test(v)&&Buffer.byteLength(v)<=240;
type Identity={dev:string;ino:string};
type Entry=WorkspaceOutputFile&Identity&{content:string};
type Move=Identity&{from:string;to:string;digest:string};
type Transaction={operationId:string;revision:number;commitHash:string;kind:'save'|'append';phase:'preparing'|'deleting'|'staging'|'publishing';
 next:Entry[];stages:Move[];publishes:Move[];deletions:{entry:Entry;intent:OutputDeletion}[];receipt:WorkspaceOutputReceipt};
type Ledger={schema:'flow.native-output';version:1;projectId:string;root:Identity;seq:number;previousHash:string|null;entries:Entry[];transaction?:Transaction;saved?:{revision:number;commitHash:string};refresh?:{receiptHash:string;revision:number;commitHash:string}};

export class WorkspaceOutputError extends Error {
 constructor(readonly code:string,message:string,readonly effect:'none'|'retained'|'unknown'='none'){super(message);}
}
const fail=(message:string):never=>{throw new WorkspaceOutputError('conflict',message,'retained');};
const metadata=(project:ProjectV2,shot:ProjectV2['shots'][number]):WorkspaceOutputMetadata=>({projectName:project.name,shotName:shot.name,scriptText:shot.scriptText,
 dialogues:project.dialogues.filter(d=>d.shotId===shot.id),presentation:shot.presentation??project.presentation??null});
const publicFile=({shotId,imageId,name,location,digest,native,format}:Entry):WorkspaceOutputFile=>({shotId,imageId,name,location,digest,native,format});

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
 const hold=async(operationId:string,file:string,bytes:number,purpose:string)=>{const grant=await options.budget.reserve({operationId,bytes,purpose});grants.set(operationId,[...(grants.get(operationId)??[]),{grant,file,max:bytes}]);return grant;};
 const settleGrants=async(operationId?:string)=>{
  for(const [id,items] of grants){if(operationId!==undefined&&id!==operationId)continue;
   for(const item of items){await bind();let actual=0;try{const st=await fs.lstat(item.file);if(!st.isFile()||st.isSymbolicLink()||st.size>item.max)fail('Unknown budgeted output entry');actual=st.size;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}await item.grant.settleActual(actual);}
   grants.delete(id);
  }
 };
 let closed=false,blocked=false,active=0,queue:Promise<unknown>=Promise.resolve(),lastHash:string|null=null;
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
  try{grant=await options.budget.reserve({operationId:ledger.transaction?.operationId??'output-journal',bytes:bytes.length,purpose:'native-output-journal'});}catch(e){blocked=true;throw e;}
  try{await bind();await createFileExclusive(file,bytes);await syncDirectory(container);
   ledger=next;lastHash=sha256Hex(bytes);await grant.settleActual(bytes.length);
  }catch(e){blocked=true;grants.set('output-journal',[...(grants.get('output-journal')??[]),{grant,file,max:bytes.length}]);await grant.retainUnknown();throw e;}
 };
 const physical=(relative:string)=>path.join(container,relative);
 const validRelative=(v:unknown):v is string=>typeof v==='string'&&(
  /^operations\/[a-f0-9-]{36}\/(old|new)-\d+\.tif$/.test(v)||/^active\//.test(v)&&leaf(v.slice(7))||/^parked\//.test(v)&&leaf(v.slice(7)));
 const resolve=(v:string)=>v.startsWith('active/')?outputPath(root,v.slice(7),'active'):v.startsWith('parked/')?outputPath(root,v.slice(7),'parked'):physical(v);
 const relative=(e:Entry)=>`${e.location}/${e.name}`;
 const validIdentity=(v:Identity)=>v&&/^\d+$/.test(v.dev)&&/^\d+$/.test(v.ino);
 const validEntry=(e:Entry)=>e&&token(e.shotId)&&token(e.imageId)&&leaf(e.name)&&['active','parked'].includes(e.location)&&digest(e.digest)&&digest(e.content)&&validNativeImageRef(e.native)&&e.format==='tiff'&&validIdentity(e);
 const validEntries=(entries:Entry[])=>Array.isArray(entries)&&entries.length<=10000&&entries.every(validEntry)&&new Set(entries.map(e=>e.shotId)).size===entries.length&&new Set(entries.map(e=>e.name.toLowerCase())).size===entries.length;
 const load=async()=>{
  await bind();let previous:string|null=null,sequence=0,latest:Ledger|undefined;
  const names=(await fs.readdir(container)).filter(n=>n!=='operations').sort();
  for(const name of names){if(!/^\d{12}\.json$/.test(name)||Number(name.slice(0,12))!==sequence+1)fail('Unknown or missing output journal record');
   if((await fs.lstat(path.join(container,name))).nlink!==1)fail('Aliased output journal record');
   const bytes=await readBoundFile(path.join(container,name),JOURNAL_LIMIT);if(!bytes)fail('Output journal disappeared');
   const v=JSON.parse(bytes!.toString()) as Ledger;
   if(v.schema!=='flow.native-output'||v.version!==1||v.projectId!==projectId||v.seq!==sequence+1||v.previousHash!==previous||!validIdentity(v.root)||v.root.dev!==binding.dev||v.root.ino!==binding.ino||!validEntries(v.entries)||v.refresh&&(!digest(v.refresh.receiptHash)||!digest(v.refresh.commitHash)||!Number.isSafeInteger(v.refresh.revision)||v.refresh.revision<0))fail('Invalid output journal');
   const t=v.transaction;
   if(t){if(!/^[a-f0-9-]{36}$/.test(t.operationId)||!['save','append'].includes(t.kind)||!['preparing','deleting','staging','publishing'].includes(t.phase)||!Number.isSafeInteger(t.revision)||t.revision<0||!digest(t.commitHash)||!validEntries(t.next)||!Array.isArray(t.stages)||!Array.isArray(t.publishes)||!Array.isArray(t.deletions))fail('Invalid output transaction');
    for(const m of [...t.stages,...t.publishes])if(!validRelative(m.from)||!validRelative(m.to)||!digest(m.digest)||!validIdentity(m))fail('Unsafe output move');
    const matches=(m:Move,e:Entry)=>m.digest===e.digest&&m.dev===e.dev&&m.ino===e.ino;
    for(const m of t.stages)if(!m.to.startsWith(`operations/${t.operationId}/old-`)||!v.entries.some(e=>relative(e)===m.from&&matches(m,e)))fail('Unbound output stage');
    for(const m of t.publishes)if(!m.from.startsWith(`operations/${t.operationId}/`)||!t.next.some(e=>relative(e)===m.to&&matches(m,e)))fail('Unbound output publication');
    for(const d of t.deletions)if(!validEntry(d.entry)||!validOutputDeletion(d.intent)||d.intent.digest!==d.entry.digest||d.intent.from!==d.entry.location||!v.entries.some(e=>relative(e)===relative(d.entry)&&e.dev===d.intent.dev&&e.ino===d.intent.ino&&e.digest===d.intent.digest))fail('Invalid output deletion');
    const operationDirectory=path.join(operations,t.operationId);const st=await directory(operationDirectory);directories.set(operationDirectory,{dev:String(st.dev),ino:String(st.ino)});
   }
   latest=v;sequence++;previous=sha256Hex(bytes!);
  }
  ledger=latest??{schema:'flow.native-output',version:1,projectId,root:{dev:binding.dev,ino:binding.ino},seq:0,previousHash:null,entries:[]};lastHash=previous;blocked=false;await syncDirectory(container);
 };
 const run=<T>(work:()=>Promise<T>)=>{active++;const result=queue.then(async()=>{try{return await work();}finally{active--;}});queue=result.catch(()=>{});return result;};
 const settle=async()=>{
  await bind();if(blocked)await load();const t=ledger.transaction;if(!t){await settleGrants();return;}
  if(t.phase==='preparing'){
   // No user-visible effect is permitted before the prepared record is durable.
   // Retain private capture bytes after a crash, but never guess missing content.
   delete ledger.transaction;await persist();await settleGrants();return;
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
  for(const e of t.next){const at=outputPath(root,e.name,e.location);if(await observe(at)!==e.digest)fail('Published output changed before receipt');const st=await fs.lstat(at);if(String(st.dev)!==e.dev||String(st.ino)!==e.ino)fail('Published output identity changed');}
  ledger.entries=t.next;if(t.kind==='save')ledger.saved={revision:t.revision,commitHash:t.commitHash};delete ledger.transaction;await persist();await settleGrants();
 };
 const checkProject=(p:ProjectV2)=>{const project=snapshotImageProject(p);if(project.id!==projectId)throw new WorkspaceOutputError('invalid-input','Wrong output project');return project;};
 const plannedNames=(project:ProjectV2,sourceNames?:Readonly<Record<string,string>>,pendingOnly=false)=>{
  const entries=ledger.entries.map(e=>({shotId:e.shotId,name:e.name})),used=new Set(entries.map(e=>e.name.toLowerCase()));
  for(const shot of [...project.shots,...project.parkedShots])if(!entries.some(e=>e.shotId===shot.id)){
   const source=sourceNames?.[shot.id]??shot.id+'.tif';if(!source||source.startsWith('.')||/[\\/\0]/.test(source))throw new WorkspaceOutputError('invalid-input','Unsafe Pending source basename');
   const basis=source.replace(/\.[^.]+$/,'');let candidate=basis+'.tif',n=1;while(used.has(candidate.toLowerCase()))candidate=`${basis}_${++n}.tif`;
   if(!leaf(candidate))throw new WorkspaceOutputError('invalid-input','Unsafe output name');used.add(candidate.toLowerCase());entries.push({shotId:shot.id,name:candidate});
  }
  // Naming depends only on project order and labels; no V1 image value is passed.
  const names=pendingOnly?new Map(entries.map(e=>[e.shotId,e.name])):orderedOutputNames({...project,version:1,images:{}},entries);
  return [...project.shots.map(s=>({shotId:s.id,name:names.get(s.id)!,location:'active' as const})),...project.parkedShots.map(s=>({shotId:s.id,name:names.get(s.id)!,location:'parked' as const}))];
 };
 const publish=async(frozen:WorkspaceOutputFrozen,batch?:{shotIds:readonly string[];sourceNames?:Readonly<Record<string,string>>})=>{
  await settle();const snapshot=structuredClone(frozen),project=checkProject(snapshot.project);
  if(!digest(snapshot.commitHash)||!token(snapshot.owner?.sessionId)||!token(snapshot.owner?.incarnation)||!Number.isSafeInteger(snapshot.owner?.workspaceEpoch)||snapshot.owner.workspaceEpoch<0)throw new WorkspaceOutputError('invalid-input','Invalid frozen output identity');
  if(!batch&&project.naming){const issue=namingIssue(project.name,project.naming);if(issue)throw new WorkspaceOutputError('invalid-input',issue);}
  let shots=[...project.shots,...project.parkedShots];
  if(batch){const ids=new Set(batch.shotIds);if(!ids.size||ids.size!==batch.shotIds.length||ids.size>10000||[...ids].some(id=>!project.parkedShots.some(s=>s.id===id)||ledger.entries.some(e=>e.shotId===id)))throw new WorkspaceOutputError('invalid-input','Append accepts only new Pending shots');shots=project.parkedShots.filter(s=>ids.has(s.id));}
  const names=plannedNames(project,batch?.sourceNames,!!batch).filter(n=>shots.some(s=>s.id===n.shotId));
  const removals=batch?[]:ledger.entries.filter(e=>!shots.some(s=>s.id===e.shotId));
  // Verify all existing files before any capture, Trash dispatch or rename.
  for(const e of batch?[]:ledger.entries){if(await observe(outputPath(root,e.name,e.location))!==e.digest)fail('External output change requires Refresh');const st=await fs.lstat(outputPath(root,e.name,e.location));if(String(st.dev)!==e.dev||String(st.ino)!==e.ino)fail('Output identity changed');}
  const allowed=new Set((batch?[]:ledger.entries).map(e=>`${e.location}/${e.name}`));
  if(new Set(names.map(n=>n.name.toLowerCase())).size!==names.length)fail('Duplicate output names');
  await ensure(path.join(root,'Pending'));
  for(const n of names){if(!leaf(n.name))fail('Unsafe output name');const dir=n.location==='active'?root:path.join(root,'Pending');
   for(const found of await fs.readdir(dir))if(found.toLowerCase()===n.name.toLowerCase()&&!allowed.has(`${n.location}/${found}`))fail(`Foreign output filename collision: ${n.name}`);
  }
  const resolved=shots.map(shot=>{const value=snapshot.resolvedImages?.[shot.imageId],binding=project.images[shot.imageId].content;if(!value||!validNativeImageRef(value.native)||value.format!=='tiff'||binding.kind==='native'&&sha256Hex(canonicalUtf8(binding.native))!==sha256Hex(canonicalUtf8(value.native)))throw new WorkspaceOutputError('unsupported','Ordinary Save requires matching settled native references and TIFF output');const text=metadata(project,shot);if(!validWorkspaceOutputMetadataEnvelope({schema:'flow.native-output-metadata',version:2,projectId,revision:project.revision,shotId:shot.id,imageId:shot.imageId,metadata:text}))throw new WorkspaceOutputError('resource-limit','Native output metadata exceeds its supported envelope');return{shot,value,metadata:text};});
  const operationId=randomUUID(),dir=path.join(operations,operationId);await ensure(dir);
  const receipt:WorkspaceOutputReceipt={operationId,projectId,revision:project.revision,commitHash:snapshot.commitHash,files:[]};
  const t:Transaction={operationId,revision:project.revision,commitHash:snapshot.commitHash,kind:batch?'append':'save',phase:'preparing',next:batch?[...ledger.entries]:[],stages:[],publishes:[],deletions:[],receipt};
  ledger.transaction=t;await persist();
  try{
   for(let i=0;i<resolved.length;i++){
    const {shot,value,metadata}=resolved[i],name=names.find(n=>n.shotId===shot.id)!;
    const content=sha256Hex(canonicalUtf8({imageId:shot.imageId,native:value.native,format:value.format,metadata})),old=ledger.entries.find(e=>e.shotId===shot.id);
    let next:Entry,source:string;
    if(old&&old.content===content){next={...old,...name};source=relative(old);}
    else{
     const capture=await options.captureImage({owner:snapshot.owner,commitHash:snapshot.commitHash,projectId,revision:project.revision,shotId:shot.id,imageId:shot.imageId,...value,metadata});
     if(!(capture.bytes instanceof Uint8Array)||capture.bytes.length===0||capture.bytes.length>LIMIT||!digest(capture.sha256)||sha256Hex(capture.bytes)!==capture.sha256||!Number.isSafeInteger(capture.layerCount)||capture.layerCount<1)fail('Invalid native output capture receipt');
     source=`operations/${operationId}/new-${i}.tif`;const grant=await hold(operationId,physical(source),capture.bytes.length,'native-output-capture');
     try{await bind();const owned=await createFileExclusive(physical(source),capture.bytes);await syncDirectory(dir);
      next={...name,imageId:shot.imageId,native:value.native,format:value.format,digest:capture.sha256,content,dev:owned.dev,ino:owned.ino};
     }catch(e){await grant.retainUnknown();throw e;}
    }
    if(old&&(old.content!==content||relative(old)!==relative(next))){const st=await fs.lstat(outputPath(root,old.name,old.location));
     const backup=`operations/${operationId}/old-${i}.tif`;await hold(operationId,physical(backup),st.size,'native-output-backup');t.stages.push({from:relative(old),to:backup,digest:old.digest,dev:String(st.dev),ino:String(st.ino)});
     if(old.content===content)source=backup;
    }
    if(!old||old.content!==content||relative(old)!==relative(next))t.publishes.push({from:source,to:relative(next),digest:next.digest,dev:next.dev,ino:next.ino});
    t.next.push(next);receipt.files.push(publicFile(next));
   }
   for(const entry of removals){const intent=await trash.prepare(entry.name,entry.location,entry.digest),st=await fs.lstat(outputPath(root,entry.name,entry.location));await hold(operationId,path.join(hidden,'deletions',intent.token,entry.name),st.size,'native-output-trash');t.deletions.push({entry,intent});}
   t.phase='deleting';await persist();await options.fault?.('after-prepared');await settle();return structuredClone(receipt);
  }catch(e){
   if(t.phase==='preparing'&&!blocked){delete ledger.transaction;try{await persist();await settleGrants(operationId);}catch{blocked=true;}}
   if(ledger.transaction||blocked)for(const items of grants.values())for(const item of items)await item.grant.retainUnknown();
   throw new WorkspaceOutputError('output-failed',e instanceof Error?e.message:String(e),ledger.transaction||blocked?'unknown':'retained');
  }
 };
 try{
  await bind();await ensure(hidden);await ensure(container);await ensure(operations);await load();
  return{
   names(project){const snapshot=structuredClone(project);return run(async()=>{await bind();return plannedNames(checkProject(snapshot));});},
   inspect(project){const snapshot=structuredClone(project);return run(async()=>{await bind();const p=checkProject(snapshot),ids=new Set([...p.shots,...p.parkedShots].map(s=>s.id)),changes=[];
    if(ledger.transaction||blocked)throw new WorkspaceOutputError('recovery-pending','Recover output before inspecting external changes','retained');
    for(const e of ledger.entries.filter(e=>ids.has(e.shotId))){const file=outputPath(root,e.name,e.location),observedDigest=await observe(file),st=observedDigest===null?null:await fs.lstat(file);if(observedDigest!==e.digest||st&& (String(st.dev)!==e.dev||String(st.ino)!==e.ino))changes.push({shotId:e.shotId,name:e.name,location:e.location,expectedDigest:e.digest,observedDigest});}return changes;});},
   save(frozen){const snapshot=structuredClone(frozen);return run(()=>publish(snapshot));},
   appendPendingBatch(frozen,batch){const snapshot=structuredClone(frozen),selection=structuredClone(batch);return run(()=>publish(snapshot,selection));},
   acceptRefresh(receipt){const input=structuredClone(receipt);return run(async()=>{
    await settle();if(input.projectId!==projectId||!Number.isSafeInteger(input.revision)||input.revision<0||!digest(input.commitHash)||!Array.isArray(input.changes)||!input.changes.length||input.changes.length>10000||new Set(input.changes.map(c=>c.shotId)).size!==input.changes.length)throw new WorkspaceOutputError('invalid-input','Invalid Main Refresh receipt');
    const receiptHash=sha256Hex(canonicalUtf8(input)),repeated=ledger.refresh?.receiptHash===receiptHash,next=[...ledger.entries];
    for(const change of input.changes){
     const index=next.findIndex(e=>e.shotId===change.shotId),entry=next[index];
     if(!entry||entry.imageId!==change.imageId||entry.location!==change.location||entry.name!==change.name||!digest(change.expectedDigest)||!digest(change.observedDigest)||!validNativeImageRef(change.native)||change.format!=='tiff'||entry.digest!==(repeated?change.observedDigest:change.expectedDigest))fail('Refresh baseline no longer matches');
     const file=outputPath(root,entry.name,entry.location),observed=await inspectFile(file);if(observed.digest!==change.observedDigest||!observed.identity)fail('External output changed during Refresh acceptance');
     // A Refresh baseline is deliberately not the project content fingerprint:
     // the next Save must overlay authoritative text onto its native candidate.
     next[index]={...entry,digest:change.observedDigest,native:change.native,...observed.identity,content:sha256Hex(canonicalUtf8({refresh:receiptHash,shotId:entry.shotId}))};
    }
    if(!repeated){ledger={...ledger,entries:next,refresh:{receiptHash,revision:input.revision,commitHash:input.commitHash}};await persist();}
   });},
   recover(){return run(settle);},
   hasObligations(){return active>0||blocked||!!ledger.transaction||grants.size>0||trash.hasPendingAcknowledgements();},
   close(){return run(async()=>{await bind();if(blocked||ledger.transaction||grants.size>0||trash.hasPendingAcknowledgements())throw new WorkspaceOutputError('recovery-pending','Output obligations prevent close','retained');closed=true;owners.delete(root);});}
  };
 }catch(e){owners.delete(root);throw e;}
}
