import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {SourceImageRef} from '../../../platform/contracts/imageProject.js';
import type {WorkspaceOutputBudget} from './workspaceOutputContract.js';
import {createSourceBackedImport,openSourceBackedImportForTargetUse,inspectSourceBackedImport,inspectImportSource,type SourceImportManifest,type SourceImportItem,type SourceInput,type SourceImportStore,type RetainedSourceObject,type SourceStoreLimits} from './sourceStore.js';
import {publishDirectoryExclusive,syncDirectory} from '../../../platform/main/platform/index.js';
import {assertPhysicalWorkspaceWriterTargets} from '../workspacePhysicalWriterGate.js';
import {readImageWorkspaceProject}from'./workspaceProbe.js';
import {readBoundFile}from'../persistence/fileOps.js';
import {canonicalUtf8,sha256Hex} from '../persistence/canonicalJson.js';

export type WorkspaceSourcesOptions={root:string;writerAuthority:{assertHeld(root:{path:string;dev:string;ino:string}):Promise<void>};budget:WorkspaceOutputBudget;limits?:Pick<Partial<SourceStoreLimits>,'maxSourceBytes'|'maxStoredBytes'|'maxItems'>;fault?:(point:string)=>Promise<void>};
export type WorkspaceSources={snapshot():readonly SourceImportManifest[];verify(ref:SourceImageRef,retained?:{digest:string;byteLength:number}):Promise<void>;object(ref:SourceImageRef):Promise<RetainedSourceObject>;registerBatch(input:{importId:string;sources:readonly SourceInput[]}):Promise<SourceImportManifest>;retain(importId:string,itemId:string):Promise<SourceImportItem>;resume(importId:string,options?:{signal?:AbortSignal;itemIds?:readonly string[];onProgress?:(manifest:SourceImportManifest)=>void}):Promise<SourceImportManifest>;pause(importId:string):Promise<SourceImportManifest>;close():Promise<void>};
export class WorkspaceSourcesError extends Error{constructor(readonly code:string,message:string,readonly effect:'none'|'retained'|'unknown'='none'){super(message);}}
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/,MAX=8*1024**3;
const clone=<T>(value:T):T=>structuredClone(value);
const same=(a:unknown,b:unknown)=>sha256Hex(canonicalUtf8(a))===sha256Hex(canonicalUtf8(b));
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
const owners=new Set<string>();
const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

/** Main-private source registry. SourceStore owns the sole durable source facts;
 * the cache is manifest-only and never certifies native-ready image bytes. */
export async function openWorkspaceSources(options:WorkspaceSourcesOptions):Promise<WorkspaceSources>{
 const {root}=options,limits={maxSourceBytes:128<<20,maxStoredBytes:MAX,maxItems:100000,...options.limits};
 if(!path.isAbsolute(root)||path.normalize(root)!==root||!options.writerAuthority?.assertHeld||!options.budget?.reserve||Object.entries(limits).some(([k,n])=>!Number.isSafeInteger(n)||n<1||n>({maxSourceBytes:128<<20,maxStoredBytes:MAX,maxItems:100000}[k as keyof typeof limits])))throw new WorkspaceSourcesError('invalid-input','Canonical source root, authority, budget and valid limits required');
 const directory=async(at:string)=>{const st=await fs.lstat(at,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(at)!==at)throw new WorkspaceSourcesError('conflict','Unsafe source registry directory','retained');return st;};
 const identity=await directory(root),binding={path:root,dev:String(identity.dev),ino:String(identity.ino)};
 if(owners.has(root))throw new WorkspaceSourcesError('busy','Source registry already open');owners.add(root);
 const hidden=path.join(root,'.storyboard-flow'),storage=path.join(hidden,'image-engine'),originals=path.join(storage,'originals'),imports=path.join(storage,'imports'),stages=path.join(hidden,'source-registration-v1');
 const upgradeSources=new Set<string>();
 const directories=new Map<string,{dev:bigint;ino:bigint}>(),manifests=new Map<string,SourceImportManifest>(),objectCache=new Map<string,RetainedSourceObject>(),versions=new Map<string,number>(),resumes=new Set<Promise<SourceImportManifest>>();
 let closed=false,closing=false,tail:Promise<unknown>=Promise.resolve(),current:{id:string;store:SourceImportStore}|undefined;
 type Grant=Awaited<ReturnType<WorkspaceOutputBudget['reserve']>>;
 const unknown=new Map<string,{grant:Grant;before:number;importId:string}>();
 const fail=(message:string):never=>{throw new WorkspaceSourcesError('conflict',message,'retained');};
 const bind=async()=>{if(closed)throw new WorkspaceSourcesError('closed','Source registry closed');await options.writerAuthority.assertHeld(binding);const now=await directory(root);if(now.dev!==identity.dev||now.ino!==identity.ino)fail('Source root identity changed');await assertPhysicalWorkspaceWriterTargets([root]);for(const [at,id]of directories){const st=await directory(at);if(st.dev!==id.dev||st.ino!==id.ino)fail('Source directory identity changed');}};
 const ensure=async(at:string)=>{await bind();try{await fs.mkdir(at,{mode:0o700});await syncDirectory(path.dirname(at));}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}const st=await directory(at);directories.set(at,{dev:st.dev,ino:st.ino});};
 const remember=(m:SourceImportManifest)=>{const immutable=freeze(clone(m));manifests.set(m.importId,immutable);return clone(immutable);};
 const requireManifest=(id:string)=>{if(!ID.test(id)||!manifests.has(id))throw new WorkspaceSourcesError('invalid-input','Unknown source import');return manifests.get(id)!;};
 const checkRef=(ref:SourceImageRef)=>{if(!ref||!ID.test(ref.importId)||!ID.test(ref.itemId)||!['photocraft-v1','flow-v1-upgrade'].includes(ref.interpretationId))throw new WorkspaceSourcesError('invalid-input','Unsupported source interpretation');const m=requireManifest(ref.importId);const item=m.items.find(i=>i.id===ref.itemId);if(!item)throw new WorkspaceSourcesError('invalid-input','Unknown source item');const upgrade=upgradeSources.has(ref.importId+'\n'+ref.itemId);if((ref.interpretationId==='flow-v1-upgrade')!==upgrade||upgrade&&(!item.retained||item.state!=='retained'||item.formatHint!=='tiff'))throw new WorkspaceSourcesError('invalid-input','Source interpretation is not authorized by its copy-upgrade genesis');};

 const loadUpgradeAuthorization=async()=>{
  const file=path.join(hidden,'native-creation-complete.json'),bytes=await readBoundFile(file,8*1024*1024);if(!bytes)return;
  const st=await fs.lstat(file);if(st.nlink!==1)fail('Aliased copy-upgrade source authorization');const proof=JSON.parse(bytes.toString()) as {schema:string;version:number;projectId:string;genesisCommitHash:string;inputFingerprint:string;input:{sourceDigest:string;destinationParent:string;folderName:string};target:{path:string;dev:string;ino:string}};
  const read=await readImageWorkspaceProject(root);
  if(proof.schema!=='flow.native-workspace-creation-complete'||proof.version!==1||proof.projectId!==read.plan.identity.id||proof.genesisCommitHash!==read.genesisCommitHash||!proof.input||!/^[a-f0-9]{64}$/.test(proof.input.sourceDigest)||proof.inputFingerprint!==sha256Hex(canonicalUtf8(proof.input))||typeof proof.input.destinationParent!=='string'||!path.isAbsolute(proof.input.destinationParent)||typeof proof.input.folderName!=='string'||!proof.input.folderName||/[\\/\0]/.test(proof.input.folderName)||proof.input.folderName==='.'||proof.input.folderName==='..'||proof.target?.path!==path.join(proof.input.destinationParent,proof.input.folderName)||typeof proof.target.dev!=='string'||!/^\d+$/.test(proof.target.dev)||typeof proof.target.ino!=='string'||!/^\d+$/.test(proof.target.ino))fail('Invalid copy-upgrade source authorization');
  // Creation inode values are historical facts. A cold complete folder copy
  // preserves this sealed genesis; bind() separately pins the current root for
  // this opening and rejects replacement during every admitted use.
  for(const image of Object.values(read.genesisProject.images)){const content=image.content;if(content.kind==='source'&&content.source.interpretationId==='flow-v1-upgrade'){const ref=content.source,item=requireManifest(ref.importId).items.find(i=>i.id===ref.itemId);if(!item?.retained||item.state!=='retained'||item.formatHint!=='tiff')fail('Upgrade genesis lacks a retained TIFF source');upgradeSources.add(ref.importId+'\n'+ref.itemId);}}
 };
 const enqueue=<T>(job:()=>Promise<T>)=>{const next=tail.then(job);tail=next.catch(()=>{});return next;};
 const admit=<T>(job:()=>Promise<T>)=>closing||closed?Promise.reject(new WorkspaceSourcesError('closed','Source registry is closing')):enqueue(job);
 const measure=async()=>{await bind();let total=0,count=0;const walk=async(at:string,depth:number):Promise<void>=>{if(depth>32)fail('Source inventory depth exceeded');let names:string[];try{names=await fs.readdir(at);}catch(e){if(missing(e))return;throw e;}await directory(at);for(const name of names){if(++count>1000000)fail('Source inventory entry budget exceeded');const file=path.join(at,name),st=await fs.lstat(file,{bigint:true});if(st.isSymbolicLink())fail('Source inventory contains an alias');if(st.isDirectory())await walk(file,depth+1);else if(st.isFile()){total+=Number(st.size);if(!Number.isSafeInteger(total)||total>limits.maxStoredBytes)throw new WorkspaceSourcesError('resource-limit','Source actual storage budget exceeded','retained');}else fail('Unknown source inventory entry');}};for(const at of[originals,imports,stages])await walk(at,0);return total;};
 const closeCurrent=async()=>{if(current){try{await current.store.close();current=undefined;}catch(e){throw new WorkspaceSourcesError('recovery-pending','Source writer close remains unresolved: '+(e instanceof Error?e.message:String(e)),'unknown');}}};
 const use=async(id:string)=>{requireManifest(id);await bind();if(current?.id===id)return current.store;await closeCurrent();const opened=await openSourceBackedImportForTargetUse({root,importId:id,limits}),store=opened.store;current={id,store};remember(store.snapshot());return store;};
 const refresh=async(id:string)=>{const value=await inspectSourceBackedImport({root,importId:id,limits});return remember(value.manifest);};
 const reconcile=async(id:string)=>{
  if(!unknown.size)return;await bind();if([...unknown.values()].some(item=>item.importId!==id))throw new WorkspaceSourcesError('recovery-pending','Resume the source import with retained expenditure first','retained');await closeCurrent();
  try{await refresh(id);}catch(e){if(!missing(e))throw e;if(manifests.has(id))fail('Registered source manifest disappeared; evidence retained');try{await fs.lstat(path.join(imports,id));fail('Published source batch has missing metadata; evidence retained');}catch(probe){if(!missing(probe))throw probe;}}
  const actual=await measure();for(const [key,item]of unknown){await item.grant.settleActual(actual-item.before);unknown.delete(key);}
 };
 const mutate=async<T>(id:string,bytes:number,purpose:string,job:()=>Promise<T>):Promise<T>=>{
  await bind();if(unknown.size)throw new WorkspaceSourcesError('recovery-pending','Source expenditure is unknown; explicitly resume this import','unknown');const before=await measure();if(before+bytes>limits.maxStoredBytes)throw new WorkspaceSourcesError('resource-limit','Source actual plus reservation exceeds configured storage budget','retained');const key='source-'+randomUUID(),grant=await options.budget.reserve({operationId:key,bytes,purpose});
  try{await bind();const value=await job();await bind();await grant.settleActual((await measure())-before);return value;}
  catch(e){await grant.retainUnknown();unknown.set(key,{grant,before,importId:id});throw new WorkspaceSourcesError('source-effect-pending',e instanceof Error?e.message:String(e),'unknown');}
 };
 const metaBound=(m:SourceImportManifest)=>canonicalUtf8(m).length+12288;
 const cancel=async(id:string)=>{const m=requireManifest(id);if(m.phase==='cancelled')return clone(m);const store=await use(id);return mutate(id,metaBound(m)*3,'source-pause-manifest',async()=>remember(await store.cancel()));};
 const retain=async(id:string,itemId:string)=>{
  const m=requireManifest(id),item=m.items.find(i=>i.id===itemId);if(!item)throw new WorkspaceSourcesError('invalid-input','Unknown source item');const store=await use(id);
  if(item.state==='retained'||item.state==='source-changed'){const value=await store.retain(itemId);remember(store.snapshot());return value;}
  const size=Number(item.expected.size);if(!Number.isSafeInteger(size)||size>limits.maxSourceBytes)throw new WorkspaceSourcesError('resource-limit','Source exceeds configured byte budget');
  return mutate(id,(item.state==='publishing'?0:size*2)+metaBound(m)*5,'source-original-and-manifest-history',async()=>{const value=await store.retain(itemId);remember(store.snapshot());await options.fault?.('after-source-retain');if(value.error?.effect==='unknown')throw new WorkspaceSourcesError(value.error.code,value.error.message,'unknown');return value;});
 };
 const matching=(m:SourceImportManifest,sources:readonly SourceInput[])=>sources.length===m.items.length&&sources.every((s,i)=>{const item=m.items[i];return s&&s.id===item.id&&s.sourcePath===item.sourcePath&&s.formatHint===item.formatHint&&(s.expected===undefined||same(s.expected,item.expected));});
 const resolveObject=async(ref:SourceImageRef)=>{
  await bind();checkRef(ref);if(unknown.size)throw new WorkspaceSourcesError('recovery-pending','Source expenditure remains unknown','unknown');const key=ref.importId+'\n'+ref.itemId,cached=objectCache.get(key);
  // This is reuse of a bound receipt, not a new content audit. The native input
  // consumer must read a bound handle and compare actual byteLength/SHA with the
  // receipt (nativeSessionAdapter.openRetained does both before native.open).
  if(cached){const now=await inspectImportSource(cached.path);if(same(now,cached.identity))return clone(cached);objectCache.delete(key);}
  const store=await use(ref.importId),object=await store.object(ref.itemId);await bind();objectCache.set(key,clone(object));return clone(object);
 };
 try{
  await bind();for(const at of[hidden,storage,originals,imports,stages])try{const st=await directory(at);directories.set(at,{dev:st.dev,ino:st.ino});}catch(e){if(!missing(e))throw e;}
  let ids:string[];try{ids=await fs.readdir(imports);}catch(e){if(missing(e))ids=[];else throw e;}
  for(const id of ids.sort()){if(!ID.test(id))fail('Unknown source import entry');await refresh(id);}
  await loadUpgradeAuthorization();
  if([...manifests.values()].reduce((n,m)=>n+m.items.length,0)>limits.maxItems)throw new WorkspaceSourcesError('resource-limit','Source registry item budget exceeded');
  return{
   snapshot(){return Object.freeze([...manifests.values()]);},
   async verify(ref,retained){const captured=clone(ref),expected=clone(retained);if(closing||closed)throw new WorkspaceSourcesError('closed','Source registry closing');await bind();checkRef(captured);if(expected){const object=await admit(()=>resolveObject(captured));if(object.digest!==expected.digest||object.byteLength!==expected.byteLength)fail('Retained source digest or byte length differs');}},
   object(ref){const captured=clone(ref);return admit(()=>resolveObject(captured));},
   registerBatch(input){const captured=clone(input);return admit(async()=>{
    await bind();if(!captured||Object.keys(captured).sort().join()!=='importId,sources'||!ID.test(captured.importId)||!Array.isArray(captured.sources)||!captured.sources.length||captured.sources.length>limits.maxItems||new Set(captured.sources.map(s=>s?.id)).size!==captured.sources.length||captured.sources.some(s=>!s||typeof s!=='object'||!Object.hasOwn(s,'id')||!Object.hasOwn(s,'sourcePath')||Object.keys(s).some(k=>!['id','sourcePath','formatHint','expected'].includes(k))))throw new WorkspaceSourcesError('invalid-input','Invalid source batch');
    await reconcile(captured.importId);const existing=manifests.get(captured.importId);if(existing){if(!matching(existing,captured.sources))fail('Source registration identity reused');return clone(existing);}
    if([...manifests.values()].reduce((n,m)=>n+m.items.length,0)+captured.sources.length>limits.maxItems)throw new WorkspaceSourcesError('resource-limit','Source registry item budget exceeded');
    const sources:SourceInput[]=[];for(const s of captured.sources){if(!s||!ID.test(s.id)||typeof s.sourcePath!=='string'||!path.isAbsolute(s.sourcePath)||path.normalize(s.sourcePath)!==s.sourcePath||s.formatHint!==undefined&&(typeof s.formatHint!=='string'||s.formatHint.length>64||s.formatHint.includes('\0')))throw new WorkspaceSourcesError('invalid-input','Invalid source input');const expected=await inspectImportSource(s.sourcePath);if(s.expected&&!same(s.expected,expected))fail('Source changed before registration');sources.push({...s,expected});}
    const sample:SourceImportManifest={schema:'storyboard-flow.source-import',version:1,importId:captured.importId,generation:0,phase:'active',items:sources.map(s=>({id:s.id,sourcePath:s.sourcePath,...(s.formatHint===undefined?{}:{formatHint:s.formatHint}),expected:s.expected!,state:'queued',hydration:'unhydrated'}))};
    return mutate(captured.importId,canonicalUtf8(sample).length*3+1024,'source-queued-registration',async()=>{
     await closeCurrent();for(const at of[hidden,storage,originals,imports,stages])await ensure(at);const stage=await fs.mkdtemp(path.join(stages,'registration-'));let temporary:SourceImportStore|undefined;
     try{temporary=await createSourceBackedImport({root:stage,importId:captured.importId,sources,limits});const manifest=temporary.snapshot();await temporary.close();temporary=undefined;const batch=path.join(stage,'.storyboard-flow/image-engine/imports',captured.importId),st=await directory(batch);await bind();await publishDirectoryExclusive(batch,path.join(imports,captured.importId),{dev:st.dev,ino:st.ino});await options.fault?.('after-registration-publication');return remember(manifest);}finally{if(temporary)await temporary.close();}
    });
   });},
   retain(importId,itemId){return admit(()=>retain(importId,itemId));},
   resume(importId,opts={}){
    if(closing||closed)return Promise.reject(new WorkspaceSourcesError('closed','Source registry is closing'));if(opts.itemIds!==undefined&&!Array.isArray(opts.itemIds))return Promise.reject(new WorkspaceSourcesError('invalid-input','Invalid source resume item IDs'));const selection=opts.itemIds===undefined?undefined:[...opts.itemIds],manifest=requireManifest(importId);if(selection&&(new Set(selection).size!==selection.length||selection.some(id=>!manifest.items.some(item=>item.id===id))))return Promise.reject(new WorkspaceSourcesError('invalid-input','Invalid source resume item IDs'));const version=versions.get(importId)??0,signal=opts.signal,onProgress=opts.onProgress,stop=()=>closing||closed||!!signal?.aborted||(versions.get(importId)??0)!==version;
    const work=(async()=>{
     await enqueue(async()=>{await reconcile(importId);const m=requireManifest(importId);if(stop()){await cancel(importId);return;}if(m.phase==='cancelled'){const store=await use(importId);await mutate(importId,metaBound(m)*3,'source-resume-manifest',async()=>remember(await store.resume({itemIds:[]})));}});
     const ids=selection??requireManifest(importId).items.map(i=>i.id);
     for(const id of ids){if(stop())break;await enqueue(async()=>{if(stop())return;await retain(importId,id);});try{onProgress?.(clone(requireManifest(importId)));}catch{/* advisory */}}
     if(stop())await enqueue(()=>cancel(importId));return clone(requireManifest(importId));
    })();resumes.add(work);void work.finally(()=>resumes.delete(work)).catch(()=>{});return work;
   },
   pause(importId){if(closing||closed)return Promise.reject(new WorkspaceSourcesError('closed','Source registry is closing'));requireManifest(importId);versions.set(importId,(versions.get(importId)??0)+1);return admit(()=>cancel(importId));},
   async close(){if(closed)return;if(closing)throw new WorkspaceSourcesError('busy','Source registry is already closing');closing=true;try{const results=await Promise.allSettled([...resumes]);for(const result of results)if(result.status==='rejected'&&(result.reason as{effect?:string})?.effect==='unknown'&&!unknown.size)throw result.reason;await tail;if(unknown.size)throw new WorkspaceSourcesError('recovery-pending','Unknown source expenditure prevents close; resume it explicitly','unknown');await closeCurrent();await bind();closed=true;owners.delete(root);}catch(e){closing=false;throw e;}}
  };
 }catch(e){try{await closeCurrent();}finally{owners.delete(root);}throw e;}
}
