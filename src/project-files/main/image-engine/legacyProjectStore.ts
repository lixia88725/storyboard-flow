import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import type { HydrationRecord, ImageOperationDecision, NativeDecision, UnchangedImageDecision, ImageOperationPage, ImageOperationRecord, ImageOperationIntent, ImageOperationResolution, NativeImageRef, NativeSettlement, ProjectCommitV2, ProjectHeadV2, ProjectV2, SourceImageRef } from '../../../platform/contracts/imageProject.js';
import { imageHash, snapshotImageProject, validNativeDecision, validNativeImageRef, validSourceImageRef, validImageBinding, validProjectStroke } from '../../../session/core/imageProjectModel.js';
import { same, shape } from '../../../session/core/imageProjectValues.js';
import { canonicalJson } from '../persistence/canonicalJson.js';
import { releaseTemporary, writeTemporaryFile } from '../persistence/fileOps.js';
import { assertPhysicalWorkspaceWriterTargets } from '../workspacePhysicalWriterGate.js';

import { ImageProjectStoreError, commitRecord, hydrationRecord, operationIntent, hydrationKey } from './projectStoreRecords.js';
import type { ProjectConfirmation, ProjectCommitReceipt, ProjectStoreV2, ImageProjectStoreOptions } from './projectStoreRecords.js';
export { ImageProjectStoreError } from './projectStoreRecords.js';
export type { ProjectConfirmation, ProjectCommitReceipt, ProjectStoreV2, ImageProjectStoreOptions } from './projectStoreRecords.js';
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
const intentBytes=(intent:ImageOperationIntent)=>bytes({schema:'flow.image-intent-envelope',version:1,sha256:sha(bytes(intent)),intent});
function readIntent(raw:Buffer){const v=parse(raw);if(!shape(v,['schema','version','sha256','intent'])||v.schema!=='flow.image-intent-envelope'||v.version!==1||!imageHash(v.sha256)||sha(bytes(v.intent))!==v.sha256)bad('Input intent checksum mismatch');return operationIntent(v.intent);}


/** Main-only project decision store. An orphan commit is never adopted on open.
 * Caller holds project-wide writer authority; exclusive open here additionally
 * prevents two instances in this process. No PID locks, repair, GC or migrations. */
export async function openLegacyImageProjectStore(options:ImageProjectStoreOptions):Promise<ProjectStoreV2>{
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
  const byId=new Map<string,ProjectCommitReceipt>(),byHash=new Map<string,ProjectCommitReceipt>(),verifiedRefs=new Set<string>(),verifiedUnchanged=new Map<string,UnchangedImageDecision>();
  let inventoryBytes=0,budgetDirty=true;const inventorySizes=new Map<string,number>();
  const bindings=new Map<string,Identity>();let closed=false,closing=false,auditing=false,tail=Promise.resolve(),intentTail=Promise.resolve(),confirmationTail=Promise.resolve(),budgetTail=Promise.resolve();let closeWork:Promise<void>|undefined,auditWork:Promise<void>|undefined;
  let reservedBytes=0; // Shared across both queues; an unknown write retains its credit until an explicit drained audit.
  const bound=async()=>{
    if(closed)throw new ImageProjectStoreError('closed','Image-project store closed');
    if(owners.get(root)!==owner||!sameFile(rootIdentity,await dir(root)))bad('Project writer/root identity changed');
    await assertPhysicalWorkspaceWriterTargets([root]);await authority({...rootBinding});
    for(const [p,identity]of bindings)if(!sameFile(identity,await dir(p)))bad(`Storage directory changed: ${p}`);
  };
  const queue=<T>(f:(admit:(bytes:number)=>Promise<void>)=>Promise<T>,intentLane:boolean|'confirmation'=false):Promise<T>=>{
    if(closing||closed||auditing)return Promise.reject(new ImageProjectStoreError(auditing?'busy':'closed','Image-project store admission closed'));
    const result=(intentLane==='confirmation'?confirmationTail:intentLane?intentTail:tail).then(async()=>{
      let credit=0;
      const admit=async(add:number)=>{
        const work=budgetTail.then(async()=>{
          if(budgetDirty)throw new ImageProjectStoreError('busy','Uncertain recovery expenditure requires a drained audit','retained');
          const other=reserved?await reserved():0;
          if(!Number.isSafeInteger(add)||add<0||!Number.isSafeInteger(other)||other<0||inventoryBytes+reservedBytes+other+add>budget)throw new ImageProjectStoreError('resource-limit','Recovery actual/reserved budget exceeded');
          // No await between the shared check and reservation.
          reservedBytes+=add;credit+=add;
        });budgetTail=work.then(()=>undefined,()=>undefined);await work;
      };
      try{const value=await f(admit);reservedBytes-=credit;return value;}
      catch(e){if(credit)budgetDirty=true;throw e;}
    });
    if(intentLane==='confirmation')confirmationTail=result.then(()=>undefined,()=>undefined);else if(intentLane)intentTail=result.then(()=>undefined,()=>undefined);else tail=result.then(()=>undefined,()=>undefined);return result;
  };
  const verify=async(p:ProjectV2)=>{for(const image of Object.values(p.images)){const key=canonicalJson(image.content);if(verifiedRefs.has(key))continue;if(image.content.kind==='native')await verifyNative(clone(image.content.native));else await verifySource(clone(image.content.source));verifiedRefs.add(key);}};
  // Only open or explicit drained recovery audits inventory every recovery file.
  const refreshInventory=async()=>{
    let count=0,used=0;const sizes=new Map<string,number>();
    const walk=async(p:string,depth:number):Promise<void>=>{
      if(depth>32)bad('Recovery directory nesting exceeds budget');
      for(const leaf of await fs.readdir(p)){if(++count>1_000_000)bad('Recovery inventory exceeds item budget');const at=path.join(p,leaf),st=await fs.lstat(at,{bigint:true});if(st.isSymbolicLink())bad('Recovery symlink retained; cannot certify budget');if(st.isDirectory())await walk(at,depth+1);else if(st.isFile()){const size=Number(st.size);used+=size;if(!Number.isSafeInteger(used))bad('Recovery inventory size overflow');sizes.set(at,size);}else bad('Unknown recovery entry retained');}
    };
    await walk(hidden,0);inventoryBytes=used;inventorySizes.clear();for(const [file,size]of sizes)inventorySizes.set(file,size);budgetDirty=false;
  };
  const account=(file:string,size:number)=>{inventoryBytes+=size-(inventorySizes.get(file)??0);inventorySizes.set(file,size);};
  const immutable=async(file:string,data:Buffer)=>{
    const prior=await read(file);if(prior){if(!prior.equals(data))bad(`Immutable record conflict: ${file}`);await sync(path.dirname(file));return;}
    const temp=await writeTemporaryFile(path.dirname(file),'record',data);
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
      const record=commitRecord(parse(raw));if(record.creationDecision)bad('Detached creation requires the recovery journal');if(record.after.id!==head.projectId)bad('Project identity changed in commit chain');
      result.push({commitHash:hash,commit:record,head});hash=record.previousCommitHash;
    }
    result.reverse();
    for(let i=0;i<result.length;i++){
      const c=result[i].commit,previous=result[i-1]?.commit;
      if(!previous){if(c.beforeRevision!==null||c.after.revision!==0||c.nativeDecision)bad('Invalid genesis commit');}
      else{
        if(c.beforeRevision!==previous.after.revision||c.after.revision!==c.beforeRevision+1)bad('Commit revision chain mismatch');
        if(c.nativeDecision){const d=c.nativeDecision,image=previous.after.images[d.imageId];await checkNativeBase(d,result.slice(0,i));if(!image||!same(image.content,d.expected)||!same(c.after,{...previous.after,revision:c.after.revision,images:{...previous.after.images,[d.imageId]:{id:d.imageId,content:{kind:'native',native:d.prepared}}}}))bad('Native decision differs from project transition');}
      }
    }
    byId.clear();byHash.clear();for(const c of result){if(byId.has(c.commit.commitId))bad('Duplicate reachable commit identity');byId.set(c.commit.commitId,c);byHash.set(c.commitHash,c);}
    prefix=result;prefixHead=head;tailStamp=await stamp(path.join(commits,`${head.commitHash}.json`));return result;
  };
  const checkNativeBase=async(d:NonNullable<ProjectCommitV2['nativeDecision']>,ancestors:readonly ProjectCommitReceipt[],seen=new Set<string>())=>{
    if(seen.has(d.operationId)||seen.size>=65536)bad('Cyclic/overlong input predecessor chain');seen.add(d.operationId);
    const intentRaw=await read(path.join(settlements,`${d.operationId}.intent.json`));if(!intentRaw)bad('Native project decision has no recoverable input intent');const intent=readIntent(intentRaw);if(intent.version===3)bad('Legacy format cannot accept product edit inputs');
    if(intent.imageId!==d.imageId||intent.operationId!==d.operationId||intent.operationId!==d.candidateId)bad('Native project decision differs from original intent');
    if(intent.version===1){if(d.pipeline||!same(intent.expected,d.expected)||!same(intent.baseNative,d.baseNative))bad('Serial decision differs from input baseline');}
    else{
      if(!same(d.pipeline,{pipelineId:intent.pipelineId,anchorCommitHash:intent.anchorCommitHash,predecessorOperationId:intent.predecessorOperationId}))bad('Pipeline decision chain differs from original intent');
      const anchor=ancestors.find(c=>c.commitHash===intent.anchorCommitHash);
      if(!anchor||!same(anchor.commit.after.images[intent.imageId]?.content,intent.expectedAtAnchor))bad('Pipeline anchor is not a reachable project decision');
      if(intent.expectedAtAnchor.kind==='native'){if(!same(intent.anchor,intent.expectedAtAnchor.native))bad('Pipeline anchor native identity mismatch');}
      else{const h=await read(path.join(hydrations,`${hydrationKey(intent.expectedAtAnchor.source)}.json`));if(!h||!same(hydrationRecord(parse(h)).native,intent.anchor))bad('Pipeline anchor source identity mismatch');}
      if(intent.predecessorOperationId===null){if(!same(d.baseNative,intent.anchor)||!same(d.expected,intent.expectedAtAnchor))bad('Pipeline first base differs from anchor');}
      else{
        const changed=ancestors.find(c=>c.commit.nativeDecision?.operationId===intent.predecessorOperationId)?.commit.nativeDecision;
        const noop=changed?null:await unchanged(intent.predecessorOperationId,ancestors,seen),predecessor=changed??noop?.decision;
        const expected=changed?{kind:'native',native:changed.prepared}:noop?.decision.expected;
        if(!predecessor||predecessor.imageId!==intent.imageId||predecessor.pipeline?.pipelineId!==intent.pipelineId||predecessor.pipeline.anchorCommitHash!==intent.anchorCommitHash||!same(d.baseNative,predecessor.prepared)||!same(d.expected,expected))bad('Pipeline predecessor has no matching reachable project decision');
      }
    }
    if(d.expected.kind==='native'){if(!same(d.baseNative,d.expected.native))bad('Native decision base differs from current content');}
    else{const raw=await read(path.join(hydrations,`${hydrationKey(d.expected.source)}.json`));if(!raw||!same(hydrationRecord(parse(raw)).native,d.baseNative))bad('Native decision source base has no matching hydration');}
    if(!d.baseNative||d.baseNative.documentId!==d.prepared.documentId||d.baseNative.storeId!==d.prepared.storeId)bad('Native edit changed document/store identity');
  };
  const unchanged=async(operationId:string,ancestors:readonly ProjectCommitReceipt[],seen=new Set<string>()):Promise<UnchangedImageDecision|null>=>{
    const cached=verifiedUnchanged.get(operationId);if(cached&&ancestors.some(c=>c.commitHash===cached.commitHash))return clone(cached);
    const raw=await read(path.join(settlements,`${operationId}.unchanged.json`));if(!raw)return null;const v=parse(raw);
    if(!shape(v,['schema','version','commitHash','decision'])||v.schema!=='flow.image-unchanged-decision'||v.version!==1||!imageHash(v.commitHash)||!validNativeDecision(v.decision)||v.decision.operationId!==operationId||!same(v.decision.baseNative,v.decision.prepared))bad('Invalid unchanged decision');
    const c=ancestors.find(c=>c.commitHash===v.commitHash);if(!c||!same(c.commit.after.images[v.decision.imageId]?.content,v.decision.expected))bad('Unchanged decision has no matching reachable head');
    await checkNativeBase(v.decision,ancestors.slice(0,ancestors.indexOf(c)+1),seen);
    // A source binding requires a settled interpretation, not just a publication.
    if(v.decision.expected.kind==='source'){
      const key=hydrationKey(v.decision.expected.source),h=await read(path.join(hydrations,`${key}.json`)),s=await read(path.join(settlements,`${key}.hydration.json`));
      if(!h||!s)bad('Unchanged source decision requires settled hydration');const hydration=hydrationRecord(parse(h));
      if(!same(parse(s),{schema:'flow.hydration-settlement',version:1,hydrationKey:key,operationId:hydration.operationId,native:hydration.native})||!same(hydration.native,v.decision.baseNative))bad('Unchanged hydration settlement mismatch');
    }
    const verified=clone(v as unknown as UnchangedImageDecision);verifiedUnchanged.set(operationId,verified);return clone(verified);
  };
  const operationDecision=async(operationId:string,verified?:ProjectCommitReceipt[]):Promise<ImageOperationDecision|null>=>{
    const list=verified??await chain(),c=list.find(c=>c.commit.nativeDecision?.operationId===operationId);if(c){if(await read(path.join(settlements,`${operationId}.unchanged.json`)))bad('Operation has two project decisions');return{commitHash:c.commitHash,decision:clone(c.commit.nativeDecision!),unchanged:false};}
    const n=await unchanged(operationId,list);return n?{commitHash:n.commitHash,decision:n.decision,unchanged:true}:null;
  };
  const settlementFile=(d:ImageOperationDecision)=>path.join(settlements,d.unchanged?`${d.decision.operationId}.unchanged-settlement.json`:`${d.commitHash}.json`);
  const settlementValue=(d:ImageOperationDecision):NativeSettlement=>({schema:'flow.native-settlement',version:1,commitHash:d.commitHash,operationId:d.decision.operationId,candidateId:d.decision.candidateId,native:d.decision.prepared});
  const load=async()=>{const list=await chain(),last=list.at(-1)??null;if(last)await verify(last.commit.after);return clone(last);};
  const pending=async()=>{const list=await chain(),result:ProjectCommitReceipt[]=[];for(const c of list)if(c.commit.nativeDecision){const raw=await read(path.join(settlements,`${c.commitHash}.json`));if(!raw)result.push(c);else{const d=c.commit.nativeDecision;const expected:NativeSettlement={schema:'flow.native-settlement',version:1,commitHash:c.commitHash,operationId:d.operationId,candidateId:d.candidateId,native:d.prepared};if(!same(parse(raw),expected))bad('Native settlement contradicts committed decision');}}return result;};
  const operationRecords=async(onlyPending:boolean,page:ImageOperationPage={}):Promise<ImageOperationRecord[]>=>{
    const list=await chain(),result:ImageOperationRecord[]=[];
    for(const leaf of (await fs.readdir(settlements)).sort((a,b)=>a.slice(0,-12)<b.slice(0,-12)?-1:a.slice(0,-12)>b.slice(0,-12)?1:0)){
      if(!leaf.endsWith('.intent.json'))continue;const name=leaf.slice(0,-12);if(!token(name))bad('Invalid input intent filename');
      if(!onlyPending&&page.afterOperationId&&name<=page.afterOperationId)continue;
      const raw=await read(path.join(settlements,leaf));if(!raw)bad('Input intent disappeared');const intent=readIntent(raw);if(intent.operationId!==name)bad('Input intent identity mismatch');
      const resolution=await read(path.join(settlements,`${name}.resolution.json`));
      if(!resolution)result.push({intent,resolution:null});
      else{
        const value=parse(resolution);
        if(!shape(value,['schema','version','operationId','decision','commitHash'])||value.schema!=='flow.image-edit-resolution'||value.version!==1||value.operationId!==name||!['discarded','committed'].includes(String(value.decision))||(value.decision==='committed'?!imageHash(value.commitHash):value.commitHash!==null))bad('Invalid input resolution');
        const committed=await operationDecision(name,list);if(value.decision==='committed'?(!committed||committed.commitHash!==value.commitHash):!!committed)bad('Input resolution contradicts reachable project decision');
        if(!onlyPending)result.push({intent,resolution:clone(value as unknown as ImageOperationResolution)});
      }
      if(!onlyPending&&result.length>=(page.maxRecords??16))break;
    }
    return result;
  };
  try{for(const p of [hidden,store,commits,settlements,hydrations])bindings.set(p,await dir(p,true));for(const p of [commits,settlements,hydrations,store,hidden,root])await sync(p);await bound();await load();await refreshInventory();}catch(e){owners.delete(root);throw e;}
  return {
    load:()=>queue(load),validateRecovery:()=>{
      if(closing||closed||auditing)return Promise.reject(new ImageProjectStoreError('busy','Image-project audit admission closed'));auditing=true;
      auditWork=Promise.all([tail,intentTail,confirmationTail,budgetTail]).then(async()=>{prefix=undefined;prefixHead=undefined;tailStamp=undefined;verifiedRefs.clear();verifiedUnchanged.clear();await load();await refreshInventory();reservedBytes=0;await sync(commits);await sync(settlements);await sync(store);await bound();}).catch(e=>{budgetDirty=true;throw e;}).finally(()=>{auditing=false;});return auditWork;
    },committed:()=>queue(async(admit)=>clone(await chain())),unsettled:()=>queue(async(admit)=>clone(await pending())),
    commit:(expectedHead,input)=>{const captured=commitRecord(input);if(captured.creationDecision)bad('Detached creation requires the recovery journal');return queue(async(admit)=>{
      if(expectedHead!==null&&!imageHash(expectedHead))bad('Invalid expected head');
      const list=await chain(),current=list.at(-1),data=bytes(captured),hash=sha(data),existing=byId.get(captured.commitId);
      if(existing){if(existing.commitHash!==hash)bad('Commit identity reused with different content');await bound();await sync(commits);await sync(store);await bound();const actual=await read(headFile);if(!actual||!same(parse(actual),prefixHead))bad('Head changed during durability confirmation','unknown');return clone(existing);}
      if((current?.commitHash??null)!==expectedHead||captured.previousCommitHash!==expectedHead)bad('Project compare-and-swap conflict');
      if(current){if(captured.after.id!==current.commit.after.id||captured.beforeRevision!==current.commit.after.revision||captured.after.revision!==captured.beforeRevision+1)bad('Project revision/identity conflict');}
      else if(captured.beforeRevision!==null||captured.after.revision!==0||captured.nativeDecision)bad('Invalid initial project');
      if(captured.nativeDecision){const d=captured.nativeDecision,before=current!.commit.after;if(await read(path.join(settlements,`${d.operationId}.unchanged.json`)))bad('Operation already has an unchanged decision');await checkNativeBase(d,list);if(!same(before.images[d.imageId]?.content,d.expected)||!same(captured.after,{...before,revision:captured.after.revision,images:{...before.images,[d.imageId]:{id:d.imageId,content:{kind:'native',native:d.prepared}}}}))bad('Invalid native project CAS');}
      await verify(captured.after);const head:ProjectHeadV2={schema:'flow.project-head',version:1,projectId:captured.after.id,commitHash:hash},headBytes=bytes(head);
      if(data.length>META)throw new ImageProjectStoreError('resource-limit','Project commit exceeds metadata budget');
      await admit(data.length+headBytes.length);await immutable(path.join(commits,`${hash}.json`),data);await bound();
      const actual=await chain();if((actual.at(-1)?.commitHash??null)!==expectedHead)bad('Head changed before publication','retained');
      const temp=await writeTemporaryFile(store,'head',headBytes);
      try{await bound();if(expectedHead===null){await fs.link(temp.path,headFile);await releaseTemporary(temp);}else await fs.rename(temp.path,headFile);await sync(store);await bound();const check=await read(headFile);if(!check?.equals(headBytes))bad('Published head differs','unknown');}
      catch(e){throw new ImageProjectStoreError('io-failure',`Project head publication needs reconciliation: ${String(e)}`,'unknown');}
      account(headFile,headBytes.length);const receipt={commitHash:hash,commit:clone(captured),head};
      prefix=[...list,receipt];prefixHead=head;tailStamp=await stamp(path.join(commits,`${hash}.json`));byId.set(captured.commitId,receipt);byHash.set(hash,receipt);return clone(receipt);
    });},
    decideUnchanged:(commitHash,input)=>{const d=clone(input);return queue(async(admit)=>{
      const list=await chain();if(list.some(c=>c.commit.nativeDecision?.operationId===d.operationId))bad('Operation already has a changed project decision');if(!validNativeDecision(d)||!same(d.baseNative,d.prepared)||!list.some(c=>c.commitHash===commitHash))bad('Invalid unchanged decision');
      const record:UnchangedImageDecision={schema:'flow.image-unchanged-decision',version:1,commitHash,decision:d},file=path.join(settlements,`${d.operationId}.unchanged.json`),prior=await read(file);
      if(!prior&&list.at(-1)?.commitHash!==commitHash)bad('Unchanged project compare-and-swap conflict');
      const c=list.find(c=>c.commitHash===commitHash)!;if(!same(c.commit.after.images[d.imageId]?.content,d.expected))bad('Unchanged binding differs from head');await checkNativeBase(d,list.slice(0,list.indexOf(c)+1));
      if(d.expected.kind==='source'){const key=hydrationKey(d.expected.source),raw=await read(path.join(settlements,`${key}.hydration.json`)),h=await read(path.join(hydrations,`${key}.json`));if(!raw||!h)bad('Unchanged source requires settled hydration');const hydration=hydrationRecord(parse(h));if(!same(parse(raw),{schema:'flow.hydration-settlement',version:1,hydrationKey:key,operationId:hydration.operationId,native:hydration.native})||!same(hydration.native,d.baseNative))bad('Unchanged source settlement differs');}
      const data=bytes(record);await admit(prior?0:data.length);await immutable(file,data);await unchanged(d.operationId,list);
    });},
    operationDecision:operationId=>queue(async()=>{if(!token(operationId))bad('Invalid operation identity');return operationDecision(operationId);}),
    unsettledDecisions:()=>queue(async()=>{
      const list=await chain(),decisions:ImageOperationDecision[]=list.filter(c=>c.commit.nativeDecision).map(c=>({commitHash:c.commitHash,decision:clone(c.commit.nativeDecision!),unchanged:false}));
      for(const leaf of await fs.readdir(settlements))if(leaf.endsWith('.unchanged.json')){const op=leaf.slice(0,-15);if(!token(op))bad('Invalid unchanged filename');const d=await operationDecision(op);if(!d||!d.unchanged)bad('Missing/conflicting unchanged decision');decisions.push(d);}
      const pending:ImageOperationDecision[]=[];for(const d of decisions){const s=await read(settlementFile(d));if(!s)pending.push(d);else if(!same(parse(s),settlementValue(d)))bad('Native settlement contradicts project decision');}return pending;
    }),
    confirmOperations:input=>{
      const records=clone(input);
      if(!Array.isArray(records)||records.length<1||records.length>4||records.some(r=>!shape(r,['commitHash','operationId','native'])||!imageHash(r.commitHash)||!token(r.operationId)||!validNativeImageRef(r.native))||new Set(records.map(r=>r.operationId)).size!==records.length)return Promise.reject(new ImageProjectStoreError('invalid-input','Confirmation batch requires 1..4 unique operations'));
      return queue(async(admit)=>{
        const list=await chain(),writes:Array<{file:string;data:Buffer}>=[];
        // Validate every decision before reserving or publishing any file.
        for(const record of records){
          const d=await operationDecision(record.operationId,list);
          if(!d||d.commitHash!==record.commitHash||!same(d.decision.prepared,record.native))bad('Confirmation has no reachable project decision');
          const intent=await read(path.join(settlements,`${record.operationId}.intent.json`));if(!intent||readIntent(intent).operationId!==record.operationId)bad('Confirmation input is missing');
          const resolution:ImageOperationResolution={schema:'flow.image-edit-resolution',version:1,operationId:record.operationId,decision:'committed',commitHash:record.commitHash};
          for(const value of [{file:settlementFile(d),data:bytes(settlementValue(d))},{file:path.join(settlements,`${record.operationId}.resolution.json`),data:bytes(resolution)}]){
            const prior=await read(value.file);if(prior){if(!prior.equals(value.data))bad('Confirmation contradicts immutable evidence');}else writes.push(value);
          }
        }
        await admit(writes.reduce((sum,w)=>sum+w.data.length,0));
        const temps:Array<Awaited<ReturnType<typeof writeTemporaryFile>>>=[];
        try{
          for(const write of writes){
            const temp=await writeTemporaryFile(settlements,'confirmation',write.data);temps.push(temp);await bound();
            await fs.link(temp.path,write.file).catch(async e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;const raced=await read(write.file);if(!raced?.equals(write.data))bad('Confirmation publication collision','retained');});
          }
          await bound();await sync(settlements);await bound();
          for(const write of writes)account(write.file,write.data.length);
          for(const temp of temps)await releaseTemporary(temp);
        }catch(e){throw new ImageProjectStoreError('io-failure',`Confirmation batch needs reconciliation: ${String(e)}`,'unknown');}
      },'confirmation');
    },
    settle:(commitHash,operationId,native)=>{const captured=clone(native);return queue(async(admit)=>{
      const d=await operationDecision(operationId);if(!d||d.commitHash!==commitHash||!same(d.decision.prepared,captured))bad('Settlement has no reachable project decision');
      const data=bytes(settlementValue(d)),file=settlementFile(d);await admit((await read(file))?0:data.length);await immutable(file,data);
    });},
    hydration:source=>{const captured=clone(source);return queue(async(admit)=>{if(!validSourceImageRef(captured))bad('Invalid hydration lookup');await bound();const raw=await read(path.join(hydrations,`${hydrationKey(captured)}.json`));if(!raw)return null;const record=hydrationRecord(parse(raw));if(!same({importId:record.source.importId,itemId:record.source.itemId,interpretationId:record.source.interpretationId},captured))bad('Hydration identity mismatch');await verifySource(captured);await verifyNative(record.native);return record;});},
    publishHydration:input=>{const record=hydrationRecord(input);return queue(async(admit)=>{await bound();await verifySource({importId:record.source.importId,itemId:record.source.itemId,interpretationId:record.source.interpretationId},{digest:record.source.digest,byteLength:record.source.byteLength});await verifyNative(record.native);const data=bytes(record),key=hydrationKey(record.source);await admit(data.length);await immutable(path.join(hydrations,`${key}.json`),data);return key;});},
    settleHydration:(source,operationId,native)=>{const s=clone(source),n=clone(native);return queue(async(admit)=>{if(!validSourceImageRef(s)||!validNativeImageRef(n)||!token(operationId))bad('Invalid hydration settlement');await bound();const key=hydrationKey(s),raw=await read(path.join(hydrations,`${key}.json`));if(!raw)bad('Unknown hydration');const record=hydrationRecord(parse(raw));if(record.operationId!==operationId||!same(record.native,n))bad('Hydration settlement identity mismatch');const data=bytes({schema:'flow.hydration-settlement',version:1,hydrationKey:key,operationId,native:n});await admit(data.length);await immutable(path.join(settlements,`${key}.hydration.json`),data);});},
    pendingHydrations:()=>queue(async(admit)=>{await bound();const result:HydrationRecord[]=[];for(const leaf of await fs.readdir(hydrations)){if(!/^[a-f0-9]{64}\.json$/.test(leaf)){if(leaf.endsWith('.tmp'))continue;bad('Unknown hydration evidence');}const raw=await read(path.join(hydrations,leaf));if(!raw)bad('Hydration disappeared');const record=hydrationRecord(parse(raw)),key=hydrationKey(record.source);if(leaf!==`${key}.json`)bad('Hydration key mismatch');const settled=await read(path.join(settlements,`${key}.hydration.json`));if(!settled)result.push(record);else if(!same(parse(settled),{schema:'flow.hydration-settlement',version:1,hydrationKey:key,operationId:record.operationId,native:record.native}))bad('Hydration settlement conflict');}return result;}),
    beginOperation:input=>{const intent=operationIntent(input);if(intent.version===3)bad('Legacy format cannot accept product edit inputs');return queue(async(admit)=>{
      await bound();
      if(intent.version===1){const current=await load();if(!current||!same(current.commit.after.images[intent.imageId]?.content,intent.expected))bad('Operation intent baseline changed');}
      else{
        // The anchor was verified by this leased Session. Never await/read a CAS
        // which may currently be publishing a newer head in the other queue.
        const anchor=byHash.get(intent.anchorCommitHash);
        if(!anchor||!same(anchor.commit.after.images[intent.imageId]?.content,intent.expectedAtAnchor))bad('Input anchor is not reachable');
        if(intent.expectedAtAnchor.kind==='native'){if(!same(intent.anchor,intent.expectedAtAnchor.native))bad('Input anchor content mismatch');}
        else{const h=await read(path.join(hydrations,`${hydrationKey(intent.expectedAtAnchor.source)}.json`));if(!h||!same(hydrationRecord(parse(h)).native,intent.anchor))bad('Input anchor hydration mismatch');}
        if(intent.predecessorOperationId){const raw=await read(path.join(settlements,`${intent.predecessorOperationId}.intent.json`));if(!raw)bad('Input predecessor has no durable intent');const predecessor=readIntent(raw);if(predecessor.version!==2||predecessor.pipelineId!==intent.pipelineId||predecessor.anchorCommitHash!==intent.anchorCommitHash||predecessor.imageId!==intent.imageId||!same(predecessor.anchor,intent.anchor)||!same(predecessor.expectedAtAnchor,intent.expectedAtAnchor))bad('Input predecessor chain mismatch');}
      }
      const file=path.join(settlements,`${intent.operationId}.intent.json`),data=intentBytes(intent);if(data.length>META)throw new ImageProjectStoreError('resource-limit','Input intent exceeds metadata budget');await admit((await read(file))?0:data.length);await immutable(file,data);
    },intent.version===2);},
    captureRecord:()=>Promise.reject(new ImageProjectStoreError('conflict','Legacy format has no capture index')),
    pendingOperations:()=>queue(async()=>{const records=await operationRecords(true);return records.map(r=>r.intent);}),
    operationRecords:page=>{const captured=clone(page??{});if(!shape(captured,[],['afterOperationId','maxRecords'])||(captured.afterOperationId!==undefined&&!token(captured.afterOperationId))||(captured.maxRecords!==undefined&&(!Number.isSafeInteger(captured.maxRecords)||captured.maxRecords<1||captured.maxRecords>16)))return Promise.reject(new ImageProjectStoreError('invalid-input','Invalid input record page'));return queue(async()=>clone(await operationRecords(false,captured)));},
    resolveOperation:(operationId,decision,commitHash)=>queue(async(admit)=>{if(!token(operationId)||!['discarded','committed'].includes(decision))bad('Invalid operation resolution');await chain();const raw=await read(path.join(settlements,`${operationId}.intent.json`));if(!raw)bad('Resolution has no operation intent');readIntent(raw);const committed=await operationDecision(operationId);if(decision==='committed'?(!committed||committed.commitHash!==commitHash):(!!committed||commitHash!==null))bad('Resolution contradicts project decision');const record:ImageOperationResolution={schema:'flow.image-edit-resolution',version:1,operationId,decision,commitHash},data=bytes(record),file=path.join(settlements,`${operationId}.resolution.json`);await admit((await read(file))?0:data.length);await immutable(file,data);}),
    close:()=>{if(closeWork)return closeWork;closing=true;closeWork=Promise.all([tail,intentTail,confirmationTail,budgetTail,auditWork]).then(async()=>{await bound();owners.delete(root);closed=true;});return closeWork;}
  };
}
