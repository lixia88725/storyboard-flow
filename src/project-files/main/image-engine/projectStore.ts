import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import type { HydrationRecord, NativeImageRef, NativeSettlement, ProjectCommitV2, ProjectHeadV2, ProjectV2, SourceImageRef } from '../../../platform/contracts/imageProject.js';
import { imageHash, snapshotImageProject, validNativeDecision, validNativeImageRef, validSourceImageRef } from '../../../session/core/imageProjectModel.js';
import { same, shape } from '../../../session/core/imageProjectValues.js';
import { canonicalJson } from '../persistence/canonicalJson.js';
import { releaseTemporary, writeTemporaryFile } from '../persistence/fileOps.js';
import { assertPhysicalWorkspaceWriterTargets } from '../workspacePhysicalWriterGate.js';

export class ImageProjectStoreError extends Error {
  constructor(readonly code:'invalid-input'|'conflict'|'busy'|'closed'|'resource-limit'|'io-failure',message:string,readonly effect:'none'|'retained'|'unknown'='none'){super(message);}
}
export type ProjectCommitReceipt={commitHash:string;commit:ProjectCommitV2;head:ProjectHeadV2};
export type ProjectStoreV2={
  load():Promise<ProjectCommitReceipt|null>;
  /** Explicit checkpoint/close audit; normal commits reuse the verified leased prefix. */
  validateRecovery():Promise<void>;
  commit(expectedHead:string|null,record:ProjectCommitV2):Promise<ProjectCommitReceipt>;
  committed():Promise<ProjectCommitReceipt[]>;
  unsettled():Promise<ProjectCommitReceipt[]>;
  settle(commitHash:string,operationId:string,native:NativeImageRef):Promise<void>;
  hydration(source:SourceImageRef):Promise<HydrationRecord|null>;
  publishHydration(record:HydrationRecord):Promise<string>;
  settleHydration(source:SourceImageRef,operationId:string,native:NativeImageRef):Promise<void>;
  pendingHydrations():Promise<HydrationRecord[]>;
  close():Promise<void>;
};
export type ImageProjectStoreOptions={
  root:string;maxRecoveryBytes?:number;
  /** Required external project lease. A process-local test authority is not a production lock. */
  writerAuthority:{assertHeld(root:{path:string;dev:string;ino:string}):Promise<void>};
  /** Main supplies the shared in-flight reservation count of native/source/output work. */
  reservedRecoveryBytes?:()=>Promise<number>;
  /** Prepared native versions are valid references before native acceptance. */
  verifyNative(ref:NativeImageRef):Promise<void>;
  verifySource(ref:SourceImageRef,retained?:{digest:string;byteLength:number}):Promise<void>;
};
const MAX=8*1024**3,META=64<<20,TOKEN=/^[A-Za-z0-9_-]{1,128}$/;
const owners=new Map<string,symbol>();
const clone=<T>(v:T):T=>structuredClone(v);
const sha=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
const bytes=(v:unknown)=>Buffer.from(canonicalJson(v)+'\n');
function bad(message:string,effect:ImageProjectStoreError['effect']='none'):never{throw new ImageProjectStoreError('conflict',message,effect);}
const missing=(e:unknown)=>(e as NodeJS.ErrnoException).code==='ENOENT';
const token=(v:unknown):v is string=>typeof v==='string'&&TOKEN.test(v);
type Identity={dev:bigint;ino:bigint};
const sameFile=(a:Identity,b:Identity)=>a.dev===b.dev&&a.ino===b.ino;
async function stamp(p:string){const st=await fs.lstat(p,{bigint:true});if(!st.isFile()||st.isSymbolicLink())bad('Unsafe current commit');return {dev:String(st.dev),ino:String(st.ino),size:String(st.size),mtime:String(st.mtimeNs),ctime:String(st.ctimeNs)};}
async function dir(p:string,create=false):Promise<Identity>{
  if(create)await fs.mkdir(p,{mode:0o700}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});
  const st=await fs.lstat(p,{bigint:true});
  if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(p)!==p)bad(`Unsafe image-project directory: ${p}`);
  return st;
}
async function read(p:string):Promise<Buffer|null>{
  let entry;try{entry=await fs.lstat(p,{bigint:true});}catch(e){if(missing(e))return null;throw e;}
  if(!entry.isFile()||entry.isSymbolicLink()||entry.size>BigInt(META)||await fs.realpath(p)!==p)bad(`Unsafe image-project record: ${p}`);
  if(typeof constants.O_NOFOLLOW!=='number')bad('No-follow reads unavailable');
  const h=await fs.open(p,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const start=await h.stat({bigint:true});if(!sameFile(entry,start))bad('Record changed before read');
    const parts:Buffer[]=[],buf=Buffer.allocUnsafe(64<<10);let n=0;
    while(true){const r=await h.read(buf,0,Math.min(buf.length,META-n+1),n);if(!r.bytesRead)break;n+=r.bytesRead;if(n>META)bad('Record exceeds metadata budget');parts.push(Buffer.from(buf.subarray(0,r.bytesRead)));}
    const end=await h.stat({bigint:true});if(!sameFile(start,end)||start.size!==end.size||start.mtimeNs!==end.mtimeNs||start.ctimeNs!==end.ctimeNs||BigInt(n)!==start.size)bad('Record changed during read');
    return Buffer.concat(parts,n);
  }finally{await h.close();}
}
async function sync(p:string){if(process.platform==='win32')return;const h=await fs.open(p,'r');try{await h.sync();}finally{await h.close();}}
function parse(raw:Buffer):unknown{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
function commitRecord(v:unknown):ProjectCommitV2{
  if(!shape(v,['schema','version','commitId','previousCommitHash','beforeRevision','after'],['nativeDecision'])||v.schema!=='flow.project-commit'||v.version!==1||!token(v.commitId)||(v.previousCommitHash!==null&&!imageHash(v.previousCommitHash))||(v.beforeRevision!==null&&(!Number.isSafeInteger(v.beforeRevision)||Number(v.beforeRevision)<0)))bad('Invalid project commit');
  const after=snapshotImageProject(v.after);
  if(v.nativeDecision!==undefined&&!validNativeDecision(v.nativeDecision))bad('Invalid native decision');
  return {...clone(v as unknown as ProjectCommitV2),after};
}
function hydrationRecord(v:unknown):HydrationRecord{
  if(!shape(v,['schema','version','source','hostBuildDigest','optionsHash','native','operationId'])||v.schema!=='flow.image-hydration'||v.version!==1||!shape(v.source,['importId','itemId','interpretationId','digest','byteLength'])||!validSourceImageRef({importId:v.source.importId,itemId:v.source.itemId,interpretationId:v.source.interpretationId})||!imageHash(v.source.digest)||!Number.isSafeInteger(v.source.byteLength)||Number(v.source.byteLength)<0||!imageHash(v.hostBuildDigest)||!imageHash(v.optionsHash)||!validNativeImageRef(v.native)||!token(v.operationId))bad('Invalid hydration record');
  return clone(v as unknown as HydrationRecord);
}
const hydrationKey=(s:SourceImageRef)=>sha(bytes({importId:s.importId,itemId:s.itemId,interpretationId:s.interpretationId}));

/** Main-only project decision store. An orphan commit is never adopted on open.
 * Caller holds project-wide writer authority; exclusive open here additionally
 * prevents two instances in this process. No PID locks, repair, GC or migrations. */
export async function openImageProjectStore(options:ImageProjectStoreOptions):Promise<ProjectStoreV2>{
  if(!options||typeof options.root!=='string'||!path.isAbsolute(options.root)||path.normalize(options.root)!==options.root||options.root.includes('\0')||typeof options.verifyNative!=='function'||typeof options.verifySource!=='function'||typeof options.writerAuthority?.assertHeld!=='function')throw new ImageProjectStoreError('invalid-input','Canonical root and reference verifiers are required');
  const root=options.root,budget=options.maxRecoveryBytes??MAX,verifyNative=options.verifyNative.bind(options),verifySource=options.verifySource.bind(options),reserved=options.reservedRecoveryBytes?.bind(options);
  if(!Number.isSafeInteger(budget)||budget<1||budget>MAX)throw new ImageProjectStoreError('invalid-input','Invalid recovery budget');
  const rootIdentity=await dir(root);await assertPhysicalWorkspaceWriterTargets([root]);
  const authority=options.writerAuthority.assertHeld.bind(options.writerAuthority),rootBinding={path:root,dev:String(rootIdentity.dev),ino:String(rootIdentity.ino)};
  await authority({...rootBinding});
  if(owners.has(root))throw new ImageProjectStoreError('busy','Image-project writer already open');
  const owner=Symbol();owners.set(root,owner);
  const hidden=path.join(root,'.storyboard-flow'),store=path.join(hidden,'image-project-v2'),commits=path.join(store,'commits'),settlements=path.join(store,'settlements'),hydrations=path.join(store,'hydrations'),headFile=path.join(store,'head.json');
  let prefix:ProjectCommitReceipt[]|undefined,prefixHead:ProjectHeadV2|undefined,tailStamp:Awaited<ReturnType<typeof stamp>>|undefined;
  const byId=new Map<string,ProjectCommitReceipt>(),byHash=new Map<string,ProjectCommitReceipt>(),verifiedRefs=new Set<string>();
  let inventoryBytes=0,budgetDirty=true;const inventorySizes=new Map<string,number>();
  const bindings=new Map<string,Identity>();let closed=false,closing=false,tail=Promise.resolve();let closeWork:Promise<void>|undefined;
  const bound=async()=>{
    if(closed)throw new ImageProjectStoreError('closed','Image-project store closed');
    if(owners.get(root)!==owner||!sameFile(rootIdentity,await dir(root)))bad('Project writer/root identity changed');
    await assertPhysicalWorkspaceWriterTargets([root]);await authority({...rootBinding});
    for(const [p,identity]of bindings)if(!sameFile(identity,await dir(p)))bad(`Storage directory changed: ${p}`);
  };
  const queue=<T>(f:()=>Promise<T>):Promise<T>=>{if(closing||closed)return Promise.reject(new ImageProjectStoreError('closed','Image-project store closing'));const result=tail.then(f);tail=result.then(()=>undefined,()=>undefined);return result;};
  const verify=async(p:ProjectV2)=>{for(const image of Object.values(p.images)){const key=canonicalJson(image.content);if(verifiedRefs.has(key))continue;if(image.content.kind==='native')await verifyNative(clone(image.content.native));else await verifySource(clone(image.content.source));verifiedRefs.add(key);}};
  // Snapshot actual recovery data on open/recovery or an uncertain effect.
  // While authority is held, own writes update this ledger; other owned writers
  // must fit their supplied full reservations. No per-stroke recursive scan/GC.
  const refreshInventory=async()=>{
    let count=0,used=0;const sizes=new Map<string,number>();
    const walk=async(p:string,depth:number):Promise<void>=>{
      if(depth>32)bad('Recovery directory nesting exceeds budget');
      for(const leaf of await fs.readdir(p)){if(++count>1_000_000)bad('Recovery inventory exceeds item budget');const at=path.join(p,leaf),st=await fs.lstat(at,{bigint:true});if(st.isSymbolicLink())bad('Recovery symlink retained; cannot certify budget');if(st.isDirectory())await walk(at,depth+1);else if(st.isFile()){const size=Number(st.size);used+=size;if(!Number.isSafeInteger(used))bad('Recovery inventory size overflow');sizes.set(at,size);}else bad('Unknown recovery entry retained');}
    };
    await walk(hidden,0);inventoryBytes=used;inventorySizes.clear();for(const [file,size]of sizes)inventorySizes.set(file,size);budgetDirty=false;
  };
  const admit=async(add:number)=>{
    if(budgetDirty)await refreshInventory();
    const other=reserved?await reserved():0;
    if(!Number.isSafeInteger(other)||other<0||inventoryBytes+other+add>budget)throw new ImageProjectStoreError('resource-limit','Recovery actual/reserved budget exceeded');
  };
  const account=(file:string,size:number)=>{inventoryBytes+=size-(inventorySizes.get(file)??0);inventorySizes.set(file,size);};
  const immutable=async(file:string,data:Buffer)=>{
    const prior=await read(file);if(prior){if(!prior.equals(data))bad(`Immutable record conflict: ${file}`);await sync(path.dirname(file));return;}
    budgetDirty=true;const temp=await writeTemporaryFile(path.dirname(file),'record',data);
    await bound();
    await fs.link(temp.path,file).catch(async e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const raced=await read(file);if(!raced?.equals(data))bad('Immutable publication collision','retained');});
    await sync(path.dirname(file));await releaseTemporary(temp);account(file,data.length);
  };
  const chain=async():Promise<ProjectCommitReceipt[]>=>{
    await bound();const rawHead=await read(headFile);if(!rawHead){if(prefix?.length)bad('Published head disappeared');prefix=[];return [];}
    const h=parse(rawHead);if(!shape(h,['schema','version','projectId','commitHash'])||h.schema!=='flow.project-head'||h.version!==1||!token(h.projectId)||!imageHash(h.commitHash))bad('Invalid project head');
    const head=clone(h as ProjectHeadV2);
    if(prefix&&same(prefixHead,head)){const last=prefix.at(-1);if(last&&tailStamp&&same(tailStamp,await stamp(path.join(commits,`${last.commitHash}.json`))))return prefix;}
    const result:ProjectCommitReceipt[]=[],seen=new Set<string>();let hash:string|null=head.commitHash;
    while(hash){
      if(seen.has(hash)||seen.size>=100_000)bad('Invalid project commit chain');seen.add(hash);
      const raw=await read(path.join(commits,`${hash}.json`));if(!raw||sha(raw)!==hash)bad('Missing/damaged reachable project commit');
      const record=commitRecord(parse(raw));if(record.after.id!==head.projectId)bad('Project identity changed in commit chain');
      result.push({commitHash:hash,commit:record,head});hash=record.previousCommitHash;
    }
    result.reverse();
    for(let i=0;i<result.length;i++){
      const c=result[i].commit,previous=result[i-1]?.commit;
      if(!previous){if(c.beforeRevision!==null||c.after.revision!==0||c.nativeDecision)bad('Invalid genesis commit');}
      else{
        if(c.beforeRevision!==previous.after.revision||c.after.revision!==c.beforeRevision+1)bad('Commit revision chain mismatch');
        if(c.nativeDecision){const d=c.nativeDecision,image=previous.after.images[d.imageId];await checkNativeBase(d);if(!image||!same(image.content,d.expected)||!same(c.after,{...previous.after,revision:c.after.revision,images:{...previous.after.images,[d.imageId]:{id:d.imageId,content:{kind:'native',native:d.prepared}}}}))bad('Native decision differs from project transition');}
      }
    }
    byId.clear();byHash.clear();for(const c of result){if(byId.has(c.commit.commitId))bad('Duplicate reachable commit identity');byId.set(c.commit.commitId,c);byHash.set(c.commitHash,c);}
    prefix=result;prefixHead=head;tailStamp=await stamp(path.join(commits,`${head.commitHash}.json`));return result;
  };
  const checkNativeBase=async(d:NonNullable<ProjectCommitV2['nativeDecision']>)=>{
    if(d.expected.kind==='native'){if(!same(d.baseNative,d.expected.native))bad('Native decision base differs from current content');}
    else{const raw=await read(path.join(hydrations,`${hydrationKey(d.expected.source)}.json`));if(!raw||!same(hydrationRecord(parse(raw)).native,d.baseNative))bad('Native decision source base has no matching hydration');}
    if(!d.baseNative||d.baseNative.documentId!==d.prepared.documentId||d.baseNative.storeId!==d.prepared.storeId)bad('Native edit changed document/store identity');
  };
  const load=async()=>{const list=await chain(),last=list.at(-1)??null;if(last)await verify(last.commit.after);return clone(last);};
  const pending=async()=>{const list=await chain(),result:ProjectCommitReceipt[]=[];for(const c of list)if(c.commit.nativeDecision){const raw=await read(path.join(settlements,`${c.commitHash}.json`));if(!raw)result.push(c);else{const d=c.commit.nativeDecision;const expected:NativeSettlement={schema:'flow.native-settlement',version:1,commitHash:c.commitHash,operationId:d.operationId,candidateId:d.candidateId,native:d.prepared};if(!same(parse(raw),expected))bad('Native settlement contradicts committed decision');}}return result;};
  try{for(const p of [hidden,store,commits,settlements,hydrations])bindings.set(p,await dir(p,true));await load();await refreshInventory();}catch(e){owners.delete(root);throw e;}
  return {
    load:()=>queue(load),validateRecovery:()=>queue(async()=>{prefix=undefined;prefixHead=undefined;tailStamp=undefined;verifiedRefs.clear();await load();await refreshInventory();await sync(commits);await sync(store);await bound();}),committed:()=>queue(async()=>clone(await chain())),unsettled:()=>queue(async()=>clone(await pending())),
    commit:(expectedHead,input)=>{const captured=commitRecord(input);return queue(async()=>{
      if(expectedHead!==null&&!imageHash(expectedHead))bad('Invalid expected head');
      const list=await chain(),current=list.at(-1),data=bytes(captured),hash=sha(data),existing=byId.get(captured.commitId);
      if(existing){if(existing.commitHash!==hash)bad('Commit identity reused with different content');await bound();await sync(commits);await sync(store);await bound();const actual=await read(headFile);if(!actual||!same(parse(actual),prefixHead))bad('Head changed during durability confirmation','unknown');return clone(existing);}
      if((current?.commitHash??null)!==expectedHead||captured.previousCommitHash!==expectedHead)bad('Project compare-and-swap conflict');
      if(current){if(captured.after.id!==current.commit.after.id||captured.beforeRevision!==current.commit.after.revision||captured.after.revision!==captured.beforeRevision+1)bad('Project revision/identity conflict');}
      else if(captured.beforeRevision!==null||captured.after.revision!==0||captured.nativeDecision)bad('Invalid initial project');
      if(captured.nativeDecision){const d=captured.nativeDecision,before=current!.commit.after;await checkNativeBase(d);if(!same(before.images[d.imageId]?.content,d.expected)||!same(captured.after,{...before,revision:captured.after.revision,images:{...before.images,[d.imageId]:{id:d.imageId,content:{kind:'native',native:d.prepared}}}}))bad('Invalid native project CAS');}
      await verify(captured.after);const head:ProjectHeadV2={schema:'flow.project-head',version:1,projectId:captured.after.id,commitHash:hash},headBytes=bytes(head);
      if(data.length>META)throw new ImageProjectStoreError('resource-limit','Project commit exceeds metadata budget');
      await admit(data.length+headBytes.length);await immutable(path.join(commits,`${hash}.json`),data);await bound();
      const actual=await chain();if((actual.at(-1)?.commitHash??null)!==expectedHead)bad('Head changed before publication','retained');
      budgetDirty=true;const temp=await writeTemporaryFile(store,'head',headBytes);
      try{await bound();if(expectedHead===null){await fs.link(temp.path,headFile);await releaseTemporary(temp);}else await fs.rename(temp.path,headFile);await sync(store);await bound();const check=await read(headFile);if(!check?.equals(headBytes))bad('Published head differs','unknown');}
      catch(e){throw new ImageProjectStoreError('io-failure',`Project head publication needs reconciliation: ${String(e)}`,'unknown');}
      account(headFile,headBytes.length);budgetDirty=false;const receipt={commitHash:hash,commit:clone(captured),head};
      prefix=[...list,receipt];prefixHead=head;tailStamp=await stamp(path.join(commits,`${hash}.json`));byId.set(captured.commitId,receipt);byHash.set(hash,receipt);return clone(receipt);
    });},
    settle:(commitHash,operationId,native)=>{const captured=clone(native);return queue(async()=>{
      await chain();const c=byHash.get(commitHash),d=c?.commit.nativeDecision;
      if(!d||d.operationId!==operationId||!same(d.prepared,captured))bad('Settlement has no reachable project decision');
      const record:NativeSettlement={schema:'flow.native-settlement',version:1,commitHash,operationId,candidateId:d.candidateId,native:captured};
      const data=bytes(record);await admit(data.length);await immutable(path.join(settlements,`${commitHash}.json`),data);budgetDirty=false;
    });},
    hydration:source=>{const captured=clone(source);return queue(async()=>{if(!validSourceImageRef(captured))bad('Invalid hydration lookup');await bound();const raw=await read(path.join(hydrations,`${hydrationKey(captured)}.json`));if(!raw)return null;const record=hydrationRecord(parse(raw));if(!same({importId:record.source.importId,itemId:record.source.itemId,interpretationId:record.source.interpretationId},captured))bad('Hydration identity mismatch');await verifySource(captured);await verifyNative(record.native);return record;});},
    publishHydration:input=>{const record=hydrationRecord(input);return queue(async()=>{await bound();await verifySource({importId:record.source.importId,itemId:record.source.itemId,interpretationId:record.source.interpretationId},{digest:record.source.digest,byteLength:record.source.byteLength});await verifyNative(record.native);const data=bytes(record),key=hydrationKey(record.source);await admit(data.length);await immutable(path.join(hydrations,`${key}.json`),data);budgetDirty=false;return key;});},
    settleHydration:(source,operationId,native)=>{const s=clone(source),n=clone(native);return queue(async()=>{if(!validSourceImageRef(s)||!validNativeImageRef(n)||!token(operationId))bad('Invalid hydration settlement');await bound();const key=hydrationKey(s),raw=await read(path.join(hydrations,`${key}.json`));if(!raw)bad('Unknown hydration');const record=hydrationRecord(parse(raw));if(record.operationId!==operationId||!same(record.native,n))bad('Hydration settlement identity mismatch');const data=bytes({schema:'flow.hydration-settlement',version:1,hydrationKey:key,operationId,native:n});await admit(data.length);await immutable(path.join(settlements,`${key}.hydration.json`),data);budgetDirty=false;});},
    pendingHydrations:()=>queue(async()=>{await bound();const result:HydrationRecord[]=[];for(const leaf of await fs.readdir(hydrations)){if(!/^[a-f0-9]{64}\.json$/.test(leaf)){if(leaf.endsWith('.tmp'))continue;bad('Unknown hydration evidence');}const raw=await read(path.join(hydrations,leaf));if(!raw)bad('Hydration disappeared');const record=hydrationRecord(parse(raw)),key=hydrationKey(record.source);if(leaf!==`${key}.json`)bad('Hydration key mismatch');const settled=await read(path.join(settlements,`${key}.hydration.json`));if(!settled)result.push(record);else if(!same(parse(settled),{schema:'flow.hydration-settlement',version:1,hydrationKey:key,operationId:record.operationId,native:record.native}))bad('Hydration settlement conflict');}return result;}),
    close:()=>{if(closeWork)return closeWork;closing=true;closeWork=tail.then(async()=>{await bound();owners.delete(root);closed=true;});return closeWork;}
  };
}
