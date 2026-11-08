import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {ProjectV1,ImageDocumentV1,AssetReaderV1} from '../../../platform/contracts/refactorV1.js';
import type {ProjectV2,SourceImageRef} from '../../../platform/contracts/imageProject.js';
import type {CreateImageProjectOptions} from '../../../platform/contracts/flowProjectCreation.js';
import {folderNameFromProjectName} from '../../../platform/contracts/flowProjectFields.js';
import {acquireImageProjectLease,type ImageProjectLease} from '../../../platform/main/imageProjectLease.js';
import {flowCodecOptions} from '../../../platform/main/flowRuntimePaths.js';
import {publishDirectoryExclusive,syncDirectory} from '../../../platform/main/platform/index.js';
import {createTiffCodec} from '../formats/index.js';
import {readPhotocraft} from '../formats/photocraft.js';
import {bindDestination,bindInput} from '../createImageProject.js';
import {scanImageSources,SOURCE_BYTE_LIMIT} from '../imageSourceConversion.js';
import {loadCheckpoint} from '../persistence/checkpoint.js';
import {canonicalUtf8,sha256Hex} from '../persistence/canonicalJson.js';
import {createFileExclusive,readBoundFile} from '../persistence/fileOps.js';
import {assertPhysicalWorkspaceWriterTargets} from '../workspacePhysicalWriterGate.js';
import {createSourceBackedImport,inspectImportSource,type SourceInput,type SourceImportStore,type SourceIdentity} from './sourceStore.js';
import {openImageProjectStore,type ProjectStoreV2} from './projectStore.js';
import {readImageWorkspaceProject} from './workspaceProbe.js';
import {readFlowTiffOutputNames} from '../flowTiffSave.js';
import {WORKSPACE_OUTPUT_NAME_SEED,validWorkspaceOutputFileName,type WorkspaceOutputNameSeed} from './workspaceOutputContract.js';
import type {ImageWorkspaceCreation,WorkspaceCreationOptions,WorkspaceUpgradeInspection,WorkspaceCreationBudget,WorkspaceCopyUpgradeInput} from './workspaceCreationContract.js';

const MAX=8*1024**3,INTERPRETATION='photocraft-v1';
const COMPLETION_LIMIT=8*1024*1024,COMPLETION_FILE='.storyboard-flow/native-creation-complete.json';
type CopyCompletion={schema:'flow.native-workspace-creation-complete';version:1;input:WorkspaceCopyUpgradeInput;inputFingerprint:string;projectId:string;genesisCommitHash:string;
 parent:{path:string;dev:string;ino:string};target:{path:string;dev:string;ino:string};outputNameSeedSha256?:string};
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
const inside=(parent:string,child:string)=>{const r=path.relative(parent,child);return r===''||!path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep);};
const aborted=()=>Object.assign(Error('创建已取消'),{name:'AbortError'});
const checkSignal=(options:CreateImageProjectOptions)=>{if(!options?.signal||typeof options.signal.aborted!=='boolean')throw Error('An AbortSignal is required');if(options.signal.aborted)throw aborted();};
const report=(options:CreateImageProjectOptions,done:number,total:number,phase:'read'|'write')=>{try{options.onProgress?.({done,total,phase});}catch{/* advisory */}};
const identity=(s:{dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint}):SourceIdentity=>({dev:String(s.dev),ino:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)});
const same=(a:unknown,b:unknown)=>sha256Hex(canonicalUtf8(a))===sha256Hex(canonicalUtf8(b));
type FileRecord={relative:string;identity:SourceIdentity};

/** Byte inventory is read-only and never follows a link. The one forbidden source
 * input is excluded before lstat/read/copy, including archive operations. */
async function inventory(root:string,limit:number):Promise<{files:FileRecord[];directories:string[];bytes:number}>{
 const files:FileRecord[]=[],directories:string[]=[];let bytes=0,count=0;
 const walk=async(directory:string,relative:string,depth:number)=>{
  if(depth>32)throw Error('Project archive nesting budget exceeded');
  for(const leaf of (await fs.readdir(directory)).sort()){
   const rel=relative?relative+'/'+leaf:leaf;if(rel==='src/renderer/normalSaveMetadataHistory.test.ts')continue;
   if(++count>1_000_000)throw Error('Project archive entry budget exceeded');
   const at=path.join(directory,leaf),st=await fs.lstat(at,{bigint:true});
   if(st.isSymbolicLink())throw Error('Project archive contains a symbolic link');
   if(st.isDirectory()){if(await fs.realpath(at)!==at)throw Error('Aliased project archive directory');directories.push(rel);await walk(at,rel,depth+1);}
   else if(st.isFile()){bytes+=Number(st.size);if(!Number.isSafeInteger(bytes)||bytes>limit)throw Error('Recovery actual/reserved budget exceeded');files.push({relative:rel,identity:identity(st)});}
   else throw Error('Project archive contains an unsupported entry');
  }
 };
 await walk(root,'',0);return{files,directories,bytes};
}
async function directory(root:string){const st=await fs.lstat(root,{bigint:true});if(!path.isAbsolute(root)||path.normalize(root)!==root||st.isSymbolicLink()||!st.isDirectory()||await fs.realpath(root)!==root)throw Error('Canonical ordinary project directory required');return st;}
async function makeDirectoryTree(root:string,relative:string){let at=root;await directory(at);for(const part of relative.split('/').filter(Boolean)){at=path.join(at,part);try{await fs.mkdir(at,{mode:0o700});await syncDirectory(path.dirname(at));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}await directory(at);}}
async function copyBoundFile(source:string,target:string,expected:SourceIdentity):Promise<string>{
 const before=await inspectImportSource(source);if(!same(before,expected))throw Error('Legacy project changed during copy');
 const input=await fs.open(source,constants.O_RDONLY|constants.O_NOFOLLOW),output=await fs.open(target,'wx',0o600).catch(async e=>{await input.close();throw e;}),hash=createHash('sha256'),chunk=Buffer.alloc(1<<20);
 try{let position=0;for(;;){const{bytesRead}=await input.read(chunk,0,chunk.length,position);if(!bytesRead)break;position+=bytesRead;if(position>Number(expected.size))throw Error('Legacy file grew during copy');hash.update(chunk.subarray(0,bytesRead));let done=0;while(done<bytesRead){const written=await output.write(chunk,done,bytesRead-done,null);if(!written.bytesWritten)throw Error('Archive copy made no progress');done+=written.bytesWritten;}}
  if(position!==Number(expected.size)||!same(identity(await input.stat({bigint:true})),expected)||!same(await inspectImportSource(source),expected))throw Error('Legacy project changed during copy');await output.sync();return hash.digest('hex');
 }finally{const results=await Promise.allSettled([input.close(),output.close()]);const failed=results.find(r=>r.status==='rejected');if(failed?.status==='rejected')throw failed.reason;}
}
const upgradeIssues=(project:ProjectV1)=>{
 const images=new Set([...project.shots,...project.parkedShots].map(s=>s.imageId)),issues:WorkspaceUpgradeInspection['issues']=[];
 if([...images].some(id=>project.images[id].layers.some(l=>l.sourceReference)))issues.push({code:'protected-source-unsupported',message:'受保护的复杂原件与附加画稿尚无完整保真升级桥；原项目保持不变。'});
 if([...images].some(id=>project.images[id].layers.some(l=>Math.round(l.opacity*255)/255!==l.opacity)))issues.push({code:'opacity-precision-unsupported',message:'此旧项目含 TIFF 255 级无法精确表示的图层透明度；需升级专用原生解释恢复原值，当前不量化或烘焙画稿。'});
 return issues;
};
async function legacy(root:string){await directory(root);const loaded=await loadCheckpoint(root);if(!loaded.ok)throw Error(loaded.error.message);for(const image of Object.values(loaded.value.project.images))for(const layer of image.layers)await loaded.value.readAsset(layer.assetId);return loaded.value;}
async function legacyPendingNames(root:string,project:ProjectV1){
 const source=await readFlowTiffOutputNames(root,project);if(!source)return undefined;
 const {ledger}=source;
 const names:WorkspaceOutputNameSeed['names']=[];
 for(const shot of project.parkedShots){const entry=ledger.entries.find(e=>e.shotId===shot.id&&!e.retired&&e.location==='parked'&&e.current!==null);if(entry){if(!validWorkspaceOutputFileName(entry.name))throw Error('Legacy Pending output filename is invalid');names.push({shotId:shot.id,imageId:shot.imageId,name:entry.name,location:'parked'});}}
 return{names,legacyLedgerSha256:source.sha256};
}
async function rgba(bytes:Uint8Array){return sharp(bytes,{limitInputPixels:16*1024*1024}).toColourspace('srgb').ensureAlpha().raw().toBuffer();}
async function verifyUpgradeImage(image:ImageDocumentV1,read:AssetReaderV1,bytes:Uint8Array,options:WorkspaceCreationOptions,root:string){
 const external=options.verifyLegacyLayers?await options.verifyLegacyLayers({bytes,projectRoot:root,imageId:image.id}):await readPhotocraft(bytes,'tiff').then(r=>({...r.value,reference:r.reference,warnings:r.warnings}));
 if(external.reference||external.warnings.length||external.width!==image.width||external.height!==image.height||external.layers.length!==image.layers.length)throw Error('Independent upgrade layer verification refused');
 const composite=new Float64Array(image.width*image.height*4);
 for(let i=0;i<image.layers.length;i++){
  const expected=image.layers[i],actual=external.layers[i];
  // PhotoCraft stores opacity as f32. Require that exact representation (or the
  // original f64 value), never a tolerance that could hide TIFF's 255-level loss.
  if(actual.name!==expected.name||actual.visible!==expected.visible||actual.locked!==expected.locked||(actual.opacity!==expected.opacity&&actual.opacity!==Math.fround(expected.opacity))||actual.blendMode!==expected.blendMode)throw Error('Independent upgrade layer semantics differ: '+JSON.stringify({index:i,expected:{name:expected.name,visible:expected.visible,locked:expected.locked,opacity:expected.opacity,blendMode:expected.blendMode},observed:{name:actual.name,visible:actual.visible,locked:actual.locked,opacity:actual.opacity,blendMode:actual.blendMode}}));
  const original=await rgba(await read(expected.assetId)),observed=await rgba(actual.png);if(!original.equals(observed))throw Error('Independent upgrade layer pixels differ');
  if(!expected.visible)continue;
  for(let k=0;k<original.length;k+=4){const sa=original[k+3]/255*expected.opacity,da=composite[k+3],oa=sa+da*(1-sa);for(let c=0;c<3;c++){const s=original[k+c]/255,b=composite[k+c],blend=expected.blendMode==='multiply'?s*b:expected.blendMode==='screen'?s+b-s*b:s;composite[k+c]=oa?(sa*(1-da)*s+sa*da*blend+da*(1-sa)*b)/oa:0;}composite[k+3]=oa;}
 }
 const embedded=await sharp(bytes,{limitInputPixels:16*1024*1024}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(embedded.info.width!==image.width||embedded.info.height!==image.height||embedded.info.channels!==4)throw Error('Upgrade composite dimensions differ');
 for(let i=0;i<embedded.data.length;i++){if(i%4!==3&&embedded.data[i-i%4+3]===0&&composite[i-i%4+3]===0)continue;if(Math.abs(embedded.data[i]-Math.round(composite[i]*255))>2)throw Error('Independent upgrade composite pixels differ');}
}

/** Dedicated creation coordinator. The only source registry is sourceStore and
 * the only project authority is the existing V2 journal. No native hydration or
 * working TIFF publication occurs while creating a source-backed project. */
export function createImageWorkspaceCreation(options:WorkspaceCreationOptions):ImageWorkspaceCreation{
 const maximum=options.maxRecoveryBytes??MAX;if(!path.isAbsolute(options.leaseBinary)||!options.budgetFactory||!Number.isSafeInteger(maximum)||maximum<1||maximum>MAX)throw Error('Creation lease, shared budget factory and valid limit required');
 const resumeCompletedCopy=async(input:WorkspaceCopyUpgradeInput)=>{
  if(typeof input.sourceRoot!=='string'||!path.isAbsolute(input.sourceRoot)||path.normalize(input.sourceRoot)!==input.sourceRoot||typeof input.destinationParent!=='string'||!path.isAbsolute(input.destinationParent)||path.normalize(input.destinationParent)!==input.destinationParent||typeof input.folderName!=='string'||!input.folderName||input.folderName.startsWith('.')||/[\\/\0]/.test(input.folderName)||typeof input.operationId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input.operationId))throw Error('Invalid copy-upgrade identity or destination');
  const parent=input.destinationParent,parentIdentity=await directory(parent),target=path.join(parent,input.folderName);if(inside(input.sourceRoot,target))throw Error('Upgrade destination must be outside the original project');
  let current;try{current=await directory(target);}catch(e){if(missing(e))return null;throw e;}
  await assertPhysicalWorkspaceWriterTargets([target]);await directory(path.join(target,'.storyboard-flow'));const proofPath=path.join(target,COMPLETION_FILE),entry=await fs.lstat(proofPath).catch(e=>{if(missing(e))throw Error('Existing target is not a completed copy of this operation');throw e;});if(entry.nlink!==1||entry.isSymbolicLink()||!entry.isFile())throw Error('Unsafe copy completion proof');
  const bytes=await readBoundFile(proofPath,COMPLETION_LIMIT);if(!bytes)throw Error('Copy completion proof disappeared');const proof=JSON.parse(bytes.toString()) as CopyCompletion;
  if(proof.schema!=='flow.native-workspace-creation-complete'||proof.version!==1||proof.inputFingerprint!==sha256Hex(canonicalUtf8(input))||!same(proof.input,input)||proof.parent?.path!==parent||proof.parent.dev!==String(parentIdentity.dev)||proof.parent.ino!==String(parentIdentity.ino)||proof.target?.path!==target||proof.target.dev!==String(current.dev)||proof.target.ino!==String(current.ino)||typeof proof.projectId!=='string'||!/^[a-f0-9]{64}$/.test(proof.genesisCommitHash))throw Error('Existing target does not match this completed operation');
  const read=await readImageWorkspaceProject(target);if(read.plan.identity.id!==proof.projectId||read.genesisCommitHash!==proof.genesisCommitHash)throw Error('Copy completion genesis no longer matches');
  if(proof.outputNameSeedSha256){const seed=await readBoundFile(path.join(target,WORKSPACE_OUTPUT_NAME_SEED),COMPLETION_LIMIT);if(!seed||sha256Hex(seed)!==proof.outputNameSeedSha256)throw Error('Copy completion naming seed changed');}
  try{await options.prepare?.({root:target,projectId:proof.projectId});const after=await directory(target),afterParent=await directory(parent);if(after.dev!==current.dev||after.ino!==current.ino||afterParent.dev!==parentIdentity.dev||afterParent.ino!==parentIdentity.ino)throw Error('Completed copy identity changed during recovery');return{root:target};}
  catch(e){throw Object.assign(Error(`Completed copy could not be prepared: ${e instanceof Error?e.message:String(e)}; evidence retained at ${target}`),{retainedRoot:target,effect:'retained'});}
 };
 const create=async(input:{destinationParent:string;folderName:string},operation:CreateImageProjectOptions,prepare:(context:{stage:string;budget:WorkspaceCreationBudget;bind:()=>Promise<void>})=>Promise<{project:ProjectV2;sources:SourceInput[];verifySources?:()=>Promise<void>;copyInput?:WorkspaceCopyUpgradeInput;pendingNames?:Awaited<ReturnType<typeof legacyPendingNames>>}>)=>{
  checkSignal(operation);const{parent,target}=await bindDestination(input.destinationParent,input.folderName),parentIdentity=await directory(parent);await assertPhysicalWorkspaceWriterTargets([target]);
  let stage:string|undefined,stageIdentity:Awaited<ReturnType<typeof directory>>|undefined,lease:ImageProjectLease|undefined,source:SourceImportStore|undefined,store:ProjectStoreV2|undefined,published=false,budget:WorkspaceCreationBudget|undefined,cleanupGrant:Awaited<ReturnType<WorkspaceCreationBudget['reserve']>>|undefined;
  try{
   stage=await fs.mkdtemp(path.join(parent,'.flow-native-create-'));stageIdentity=await directory(stage);budget=await options.budgetFactory({root:stage,maxRecoveryBytes:maximum});
   cleanupGrant=await budget.reserve({operationId:randomUUID(),bytes:8192,purpose:'creation-lease-release'});
   const leaseGrant=await budget.reserve({operationId:randomUUID(),bytes:8192,purpose:'creation-lease-acquire'});try{lease=await acquireImageProjectLease({root:stage,binary:options.leaseBinary});await leaseGrant.settleActual((await inventory(stage,maximum)).bytes);}catch(e){await leaseGrant.retainUnknown();throw e;}
   const stableStage=stage,stableIdentity=stageIdentity,stableLease=lease;
   const bind=async()=>{const current=await directory(stableStage),p=await directory(parent);if(current.dev!==stableIdentity.dev||current.ino!==stableIdentity.ino||p.dev!==parentIdentity.dev||p.ino!==parentIdentity.ino)throw Error('Creation directory identity changed');await directory(path.join(stableStage,'.storyboard-flow'));await stableLease.assertHeld({path:stableStage,dev:String(stableIdentity.dev),ino:String(stableIdentity.ino)});await assertPhysicalWorkspaceWriterTargets([target]);};
   const prepared=await prepare({stage,budget,bind});checkSignal(operation);await bind();
   const importId=prepared.sources.length?randomUUID():null;
   if(importId){
    const sources=prepared.sources.map(s=>({...s})),retainBeforePublish=prepared.copyInput!==undefined;let total=0,largest=0;
    for(const item of sources){item.expected??=await inspectImportSource(item.sourcePath);const size=Number(item.expected.size);if(retainBeforePublish&&size>SOURCE_BYTE_LIMIT)throw Error('Source exceeds retention byte budget');total+=size;largest=Math.max(largest,size);}
    const sample={schema:'storyboard-flow.source-import',version:1,importId,generation:9_999_999_999,phase:'active',items:sources.map(s=>({...s,state:'publishing',hydration:'unhydrated',copy:{temporary:'copy-'+randomUUID()+'.partial'},candidate:{digest:'f'.repeat(64),byteLength:Number(s.expected!.size)},retained:{digest:'f'.repeat(64),byteLength:Number(s.expected!.size)}}))};
    const queued={schema:'storyboard-flow.source-import',version:1,importId,generation:0,phase:'active',items:sources.map(s=>({id:s.id,sourcePath:s.sourcePath,...(s.formatHint===undefined?{}:{formatHint:s.formatHint}),expected:s.expected!,state:'queued',hydration:'unhydrated'}))};
    const metaMaximum=Buffer.byteLength(JSON.stringify(sample))+8192+1024,reservation=retainBeforePublish?total+largest+metaMaximum*(3*sources.length+5):canonicalUtf8(queued).length*3+1024;
    const before=(await inventory(stage,maximum)).bytes,grant=await budget.reserve({operationId:importId,bytes:reservation,purpose:retainBeforePublish?'creation-source-originals-and-manifest-history':'creation-queued-source-manifest'});
    try{
     await bind();source=await createSourceBackedImport({root:stage,importId,sources,limits:{maxStoredBytes:maximum}});
     // External image creation enters after identity registration. Runtime owns
     // background retention and prioritizes the demanded image. Upgrade-derived
     // files are private stage paths and must be retained before the rename.
     if(retainBeforePublish)for(const[index,item]of sources.entries()){checkSignal(operation);await bind();const retained=await source.retain(item.id);if(retained.state!=='retained')throw Error(retained.error?.message??'Source was not retained');report(operation,index+1,sources.length,'read');}
     for(const image of Object.values(prepared.project.images)){const ref=image.content;if(ref.kind!=='source')throw Error('Creation cannot install unverified native references');ref.source.importId=importId;}
     await grant.settleActual((await inventory(stage,maximum)).bytes-before);
    }catch(e){await grant.retainUnknown();throw e;}
   }
   await prepared.verifySources?.();checkSignal(operation);await bind();
   const verifySource=async(ref:SourceImageRef,retained?:{digest:string;byteLength:number})=>{if(!source||ref.importId!==importId||ref.interpretationId!==INTERPRETATION||!source.snapshot().items.some(i=>i.id===ref.itemId))throw Error('Unregistered creation source reference');if(retained){const object=await source.object(ref.itemId);if(object.digest!==retained.digest||object.byteLength!==retained.byteLength)throw Error('Retained creation source differs');}};
   // Source expenditure is fully settled and no other writer runs concurrently.
   // Journal inventories the entire recovery tree, including archived V1 data,
   // so its existing total actual+reserved cap covers its own new bytes as well.
   store=await openImageProjectStore({root:stage,writerAuthority:lease,maxRecoveryBytes:maximum-8192,verifySource,verifyNative:async()=>{throw Error('Creation has no prepared native version');}});
   await store.commit(null,{schema:'flow.project-commit',version:1,commitId:randomUUID(),previousCommitHash:null,beforeRevision:null,after:prepared.project});
   const head=await store.load();if(!head||!same(head.commit.after,prepared.project))throw Error('Creation genesis verification failed');await store.validateRecovery();
   await store.close();store=undefined;if(source){await source.close();source=undefined;}await cleanupGrant.settleActual(0);cleanupGrant=undefined;await budget.audit();cleanupGrant=await budget.reserve({operationId:randomUUID(),bytes:8192,purpose:'creation-lease-release'});
   if(prepared.copyInput){
    let outputNameSeedSha256:string|undefined;
    if(prepared.pendingNames?.names.length){
     const seed:WorkspaceOutputNameSeed={schema:'flow.native-output-name-seed',version:1,projectId:prepared.project.id,genesisCommitHash:head.commitHash,sourceProjectId:prepared.copyInput.projectId,sourceDigest:prepared.copyInput.sourceDigest,...prepared.pendingNames};
     const seedBytes=canonicalUtf8(seed);if(seedBytes.length>COMPLETION_LIMIT)throw Error('Output name seed exceeds its metadata budget');const seedGrant=await budget.reserve({operationId:randomUUID(),bytes:seedBytes.length,purpose:'creation-pending-output-name-seed'});
     try{await bind();await createFileExclusive(path.join(stage,WORKSPACE_OUTPUT_NAME_SEED),seedBytes);await syncDirectory(path.join(stage,'.storyboard-flow'));await seedGrant.settleActual(seedBytes.length);outputNameSeedSha256=sha256Hex(seedBytes);}catch(e){await seedGrant.retainUnknown();throw e;}
    }
    const completion:CopyCompletion={schema:'flow.native-workspace-creation-complete',version:1,input:prepared.copyInput,inputFingerprint:sha256Hex(canonicalUtf8(prepared.copyInput)),projectId:prepared.project.id,genesisCommitHash:head.commitHash,
     parent:{path:parent,dev:String(parentIdentity.dev),ino:String(parentIdentity.ino)},target:{path:target,dev:String(stageIdentity.dev),ino:String(stageIdentity.ino)},...(outputNameSeedSha256?{outputNameSeedSha256}:{})};
    const bytes=canonicalUtf8(completion);if(bytes.length>COMPLETION_LIMIT)throw Error('Creation completion proof exceeds its metadata budget');const grant=await budget.reserve({operationId:randomUUID(),bytes:bytes.length,purpose:'creation-completion-proof'});
    try{await bind();await createFileExclusive(path.join(stage,COMPLETION_FILE),bytes);await syncDirectory(path.join(stage,'.storyboard-flow'));await grant.settleActual(bytes.length);}catch(e){await grant.retainUnknown();throw e;}
   }
   const beforeRelease=(await inventory(stage,maximum)).bytes;try{await lease.release();lease=undefined;await cleanupGrant.settleActual(Math.max(0,(await inventory(stage,maximum)).bytes-beforeRelease));cleanupGrant=undefined;}catch(e){await cleanupGrant?.retainUnknown();throw e;}
   await options.fault?.('before-publication',{stage,target});checkSignal(operation);
   const latest=await directory(stage),parentNow=await directory(parent);if(latest.dev!==stageIdentity.dev||latest.ino!==stageIdentity.ino||parentNow.dev!==parentIdentity.dev||parentNow.ino!==parentIdentity.ino)throw Error('Creation namespace identity changed');
   if((await fs.readdir(parent)).some(n=>n.toLowerCase()===path.basename(target).toLowerCase()))throw Error('Destination appeared during creation; nothing was replaced');await assertPhysicalWorkspaceWriterTargets([target]);
   try{await publishDirectoryExclusive(stage,target,{dev:stageIdentity.dev,ino:stageIdentity.ino});published=true;}catch(e){const attached=await fs.lstat(target,{bigint:true}).catch(probe=>{if(missing(probe))return null;throw probe;});if(attached?.isDirectory()&&!attached.isSymbolicLink()&&attached.dev===stageIdentity.dev&&attached.ino===stageIdentity.ino)published=true;throw e;}
   await options.fault?.('after-publication',{stage,target});await options.prepare?.({root:target,projectId:prepared.project.id});report(operation,1,1,'write');return{root:target};
  }catch(e){
   const failures:unknown[]=[];if(store)try{await store.close();}catch(error){failures.push(error);}if(source)try{await source.close();}catch(error){failures.push(error);}if(lease&&failures.length===0)try{const before=stage?(await inventory(stage,maximum)).bytes:0;await lease.release();lease=undefined;await cleanupGrant?.settleActual(stage?Math.max(0,(await inventory(stage,maximum)).bytes-before):0);cleanupGrant=undefined;}catch(error){failures.push(error);await cleanupGrant?.retainUnknown();}else if(!lease&&cleanupGrant){await cleanupGrant.settleActual(0);cleanupGrant=undefined;}
   const message=e instanceof Error?e.message:String(e),retained=published?target:stage;
   throw Object.assign(Error(`Native project creation failed: ${message}${retained?'; evidence retained at '+retained:''}${failures.length?'; owned close/release remains unknown: '+failures.map(String).join(', '):''}`),{name:(e as Error).name==='AbortError'?'AbortError':'Error',effect:failures.length?'unknown':'retained',retainedRoot:retained});
  }
 };
 return{
  createBlankProject(rawInput,operation){const input=structuredClone(rawInput),bound=bindInput(input);return create(input,operation,async()=>({project:{schema:'storyboard-flow.project',version:2,id:randomUUID(),revision:0,...bound,shots:[],parkedShots:[],dialogues:[],images:{}},sources:[]}));},
  async createImageProject(rawInput,operation){
   const input=structuredClone(rawInput);
   const bound=bindInput(input);checkSignal(operation);const scanned=await scanImageSources(input.source);for(const item of scanned)if(inside(path.dirname(item.file),path.join(input.destinationParent,input.folderName)))throw Error('The new project must be outside the source folder');
   return create(input,operation,async()=>{
    const project:ProjectV2={schema:'storyboard-flow.project',version:2,id:randomUUID(),revision:0,...bound,shots:[],parkedShots:[],dialogues:[],images:{}},sources:SourceInput[]=[];
    for(const item of scanned){const imageId=randomUUID(),itemId=randomUUID();project.shots.push({id:randomUUID(),imageId,name:path.parse(item.name).name,scriptText:''});project.images[imageId]={id:imageId,content:{kind:'source',source:{importId:'pending',itemId,interpretationId:INTERPRETATION}}};sources.push({id:itemId,sourcePath:item.file,formatHint:path.extname(item.name).slice(1).toLowerCase(),expected:await inspectImportSource(item.file)});}
    return{project,sources,verifySources:async()=>{const now=await scanImageSources(input.source);if(!same(scanned,now))throw Error('Source folder changed during creation');for(const source of sources)if(!same(await inspectImportSource(source.sourcePath),source.expected))throw Error('Source changed during creation');}};
   });
  },
  async inspectUpgrade(sourceRoot){const loaded=await legacy(sourceRoot),project=loaded.project,projectHash=sha256Hex(canonicalUtf8(project)),sourceInventory=await inventory(sourceRoot,maximum);return{sourceRoot,projectId:project.id,projectName:project.name,folderName:folderNameFromProjectName(project.name)+' 升级副本',activeBoards:project.shots.length,pendingBoards:project.parkedShots.length,sourceDigest:sha256Hex(canonicalUtf8({projectHash,inventory:sourceInventory})),projectHash,issues:upgradeIssues(project)};},
  async copyUpgrade(rawInput,operation){
   const input=structuredClone(rawInput);checkSignal(operation);const completed=await resumeCompletedCopy(input);if(completed){report(operation,1,1,'write');return completed;}
   const loaded=await legacy(input.sourceRoot),old=loaded.project,issues=upgradeIssues(old);if(issues.length)throw Error(issues.map(i=>i.message).join(' '));if(inside(input.sourceRoot,path.join(input.destinationParent,input.folderName)))throw Error('Upgrade destination must be outside the original project');
   const originalInventory=await inventory(input.sourceRoot,maximum),sourceProjectHash=sha256Hex(canonicalUtf8(old));if(old.id!==input.projectId||sha256Hex(canonicalUtf8({projectHash:sourceProjectHash,inventory:originalInventory}))!==input.sourceDigest||!/^[A-Za-z0-9_-]{1,100}$/.test(input.operationId)||typeof input.projectName!=='string')throw Error('Upgrade source changed since inspection or operation identity is invalid');const pendingNames=await legacyPendingNames(input.sourceRoot,old);
   return create(input,operation,async({stage,budget,bind})=>{
    const hidden=path.join(stage,'.storyboard-flow');await bind();await directory(hidden);const archive=path.join(hidden,'legacy-copy-v1');await fs.mkdir(archive,{mode:0o700});
    const archiveReceiptMaximum=canonicalUtf8({schema:'flow.legacy-copy',version:1,projectHash:sourceProjectHash,directories:originalInventory.directories,files:originalInventory.files.map(f=>({...f,digest:'f'.repeat(64)}))}).length;
    const archiveGrant=await budget.reserve({operationId:input.operationId,bytes:originalInventory.bytes+archiveReceiptMaximum,purpose:'creation-immutable-legacy-copy'});
    try{const records=[];for(const rel of originalInventory.directories){checkSignal(operation);await bind();await makeDirectoryTree(archive,rel);}for(const file of originalInventory.files){checkSignal(operation);await bind();const target=path.join(archive,file.relative);await directory(path.dirname(target));records.push({...file,digest:await copyBoundFile(path.join(input.sourceRoot,file.relative),target,file.identity)});await syncDirectory(path.dirname(target));}
     await createFileExclusive(path.join(hidden,'legacy-copy-receipt.json'),canonicalUtf8({schema:'flow.legacy-copy',version:1,projectHash:sourceProjectHash,directories:originalInventory.directories,files:records}));await syncDirectory(hidden);await archiveGrant.settleActual((await inventory(archive,maximum)).bytes+(await fs.stat(path.join(hidden,'legacy-copy-receipt.json'))).size);
    }catch(e){await archiveGrant.retainUnknown();throw e;}
    const derived=path.join(hidden,'legacy-derived-v1');await fs.mkdir(derived,{mode:0o700});const project:ProjectV2={...structuredClone(old),version:2,id:randomUUID(),revision:0,name:input.projectName,images:{}},sources:SourceInput[]=[],codec=options.legacyCodec??createTiffCodec(flowCodecOptions());
    for(const shot of [...project.shots,...project.parkedShots]){
     checkSignal(operation);await bind();const image=old.images[shot.imageId],grant=await budget.reserve({operationId:shot.id,bytes:SOURCE_BYTE_LIMIT,purpose:'creation-layered-v1-upgrade'});
     try{const encoded=await codec.encode({image,text:{projectId:old.id,projectName:old.name,shotId:shot.id,shotName:shot.name,scriptText:shot.scriptText,dialogues:old.dialogues.filter(d=>d.shotId===shot.id)}},loaded.readAsset);if(!encoded.ok)throw Error(encoded.error.message);if(encoded.value.length>SOURCE_BYTE_LIMIT)throw Error('Upgrade TIFF exceeds byte budget');await verifyUpgradeImage(image,loaded.readAsset,encoded.value,options,input.sourceRoot);
      const sourcePath=path.join(derived,shot.id+'.tif');await createFileExclusive(sourcePath,encoded.value);await syncDirectory(derived);await grant.settleActual(encoded.value.length);const itemId=randomUUID();project.images[shot.imageId]={id:shot.imageId,content:{kind:'source',source:{importId:'pending',itemId,interpretationId:INTERPRETATION}}};sources.push({id:itemId,sourcePath,formatHint:'tiff',expected:await inspectImportSource(sourcePath)});
     }catch(e){await grant.retainUnknown();throw e;}
    }
    return{project,sources,copyInput:input,pendingNames,verifySources:async()=>{if(!same(originalInventory,await inventory(input.sourceRoot,maximum))||sha256Hex(canonicalUtf8((await legacy(input.sourceRoot)).project))!==sourceProjectHash)throw Error('Original project changed during copy upgrade');}};
   });
  }
 };
}
