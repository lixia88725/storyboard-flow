import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { canonicalJson } from '../persistence/canonicalJson.js';
import { writeTemporaryFile, releaseTemporary } from '../persistence/fileOps.js';

const HEADER=88,SEAL=40,MAX_GROUP=16<<20,MAX_PENDING=64<<20,ZERO='0'.repeat(64);
const MAGIC=Buffer.from('FLOWGRP1'),END=Buffer.from('FLOWEND1');
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const encode=(v:unknown)=>Buffer.from(canonicalJson(v));
type Entry={sequence:number;value:unknown};
type Location={file:string;offset:number;bodyBytes:number;index:number;hash:string;dev:bigint;ino:bigint};
type Receipt={sequence:number;durableThrough:number;groupHash:string};
type Pending={entry:Entry;bytes:number;resolve(r:Receipt):void;reject(e:unknown):void};
export class RecoveryJournalError extends Error{
 constructor(message:string,readonly verifiedThrough:number,readonly verifiedBytes:number,readonly effect:'retained'|'unknown'='retained'){super(message);}
}
async function syncDir(p:string){const h=await fs.open(p,'r');try{await h.sync();}finally{await h.close();}}
async function regular(p:string){const s=await fs.lstat(p,{bigint:true});if(!s.isFile()||s.isSymbolicLink()||await fs.realpath(p)!==p)throw Error('Unsafe journal file');return s;}
async function readManifest(file:string){
 const entry=await regular(file);if(entry.size>4096n)throw Error('Oversized journal manifest');const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await h.stat({bigint:true});if(before.dev!==entry.dev||before.ino!==entry.ino||before.size>4096n)throw Error('Manifest identity changed');const b=Buffer.alloc(4097);let n=0;for(;;){const r=await h.read(b,n,b.length-n,n);if(!r.bytesRead)break;n+=r.bytesRead;if(n>4096)throw Error('Oversized journal manifest');}const after=await h.stat({bigint:true});if(after.dev!==before.dev||after.ino!==before.ino||after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs||BigInt(n)!==before.size)throw Error('Manifest changed during read');return b.subarray(0,n);}finally{await h.close();}
}
async function immutable(file:string,bytes:Buffer){
 const temp=await writeTemporaryFile(path.dirname(file),'journal',bytes);
 try{await fs.link(temp.path,file).catch(async e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;if(!(await readManifest(file)).equals(bytes))throw Error('Journal manifest collision');});await syncDir(path.dirname(file));}finally{await releaseTemporary(temp);}
}
function group(entries:Entry[],previous:string){
 const body=encode(entries.map(e=>e.value)),h=Buffer.alloc(HEADER);MAGIC.copy(h);h.writeUInt32BE(body.length,8);h.writeUInt32BE(entries.length,12);h.writeBigUInt64BE(BigInt(entries[0].sequence),16);Buffer.from(previous,'hex').copy(h,24);Buffer.from(hash(h.subarray(0,56)),'hex').copy(h,56);
 const digest=hash(Buffer.concat([h,body])),seal=Buffer.concat([END,Buffer.from(digest,'hex')]);return{data:Buffer.concat([h,body,seal]),digest};
}
/** Single append owner, bounded group flush. Only a sealed, successfully synced
 * prefix receives durableThrough. Directory IO occurs only at create/continuation. */
export async function openRecoveryJournal(options:{directory:string;formatId:string;assertHeld():Promise<void>;reserve(bytes:number):Promise<()=>void>;onGrowth(bytes:number):void;manualFlush?:boolean;createInitial:boolean;readOnly?:boolean}){
 const {directory,formatId}=options;if(options.readOnly&&options.createInitial)throw Error('Inspection cannot create a journal');await options.assertHeld();if(options.createInitial)await fs.mkdir(directory,{mode:0o700}).catch(e=>{if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;});
 const ds=await fs.lstat(directory,{bigint:true});if(!ds.isDirectory()||ds.isSymbolicLink()||await fs.realpath(directory)!==directory)throw Error('Unsafe journal directory');
 const checkDir=async()=>{await options.assertHeld();const s=await fs.lstat(directory,{bigint:true});if(s.dev!==ds.dev||s.ino!==ds.ino||!s.isDirectory()||s.isSymbolicLink())throw Error('Journal directory identity changed');};
 const ensureFile=async(file:string,exclusive=false)=>{let created=false;const h=await fs.open(file,constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600).then(h=>{created=true;return h;},async e=>{if(e.code!=='EEXIST'||exclusive)throw e;await regular(file);return fs.open(file,constants.O_RDWR|constants.O_NOFOLLOW);});try{await h.sync();if(created){await syncDir(directory);await syncDir(path.dirname(directory));}}finally{await h.close();}};
 let file=path.join(directory,'segment-0.log'),generation=0,offset=0,through=0,previous=ZERO;
 if(options.createInitial)await ensureFile(file,true);else await regular(file);
 const locations=new Map<number,Location>(),segments:Array<{file:string;size:number;hash:string}>=[];
 // Every old segment stays intact. A continuation commits only a verified
 // unsealed tail; a fully present but invalid group is corruption, never skipped.
 for(;;){
  await checkDir();await regular(file);const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);const st=await h.stat({bigint:true});let at=0,partial=false;
  const readExact=async(n:number,pos:number)=>{const b=Buffer.alloc(n);let done=0;while(done<n){const r=await h.read(b,done,n-done,pos+done);if(!r.bytesRead)break;done+=r.bytesRead;}return b.subarray(0,done);};
  try{while(at<Number(st.size)){
   const header=await readExact(HEADER,at);if(header.length<HEADER){partial=true;break;}
   if(!header.subarray(0,8).equals(MAGIC)||hash(header.subarray(0,56))!==header.subarray(56,88).toString('hex'))throw new RecoveryJournalError('Journal header corruption',through,at);
   const n=header.readUInt32BE(8),count=header.readUInt32BE(12),seq=Number(header.readBigUInt64BE(16));
   if(n>MAX_GROUP||!count||count>64||seq+count-1>1_000_000||seq!==through+1||header.subarray(24,56).toString('hex')!==previous)throw new RecoveryJournalError('Journal chain corruption',through,at);
   const total=HEADER+n+SEAL;if(Number(st.size)-at<total){
    const tail=await readExact(Number(st.size)-at,at);let probe=tail.indexOf(MAGIC,HEADER);
    while(probe>=0){if(tail.length-probe>=HEADER){const ph=tail.subarray(probe,probe+HEADER),pn=ph.readUInt32BE(8),end=probe+HEADER+pn;
     if(hash(ph.subarray(0,56))===ph.subarray(56).toString('hex')&&pn<=MAX_GROUP&&end+SEAL<=tail.length&&tail.subarray(end,end+8).equals(END)&&hash(tail.subarray(probe,end))===tail.subarray(end+8,end+SEAL).toString('hex'))throw new RecoveryJournalError('Valid later group follows a damaged middle group',through,at);
    }probe=tail.indexOf(MAGIC,probe+1);}partial=true;break;
   }
   const body=await readExact(n,at+HEADER),seal=await readExact(SEAL,at+HEADER+n),digest=hash(Buffer.concat([header,body]));
   if(!seal.subarray(0,8).equals(END)||seal.subarray(8).toString('hex')!==digest)throw new RecoveryJournalError('Journal sealed group corruption',through,at);
   let values:unknown;try{values=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));}catch{throw new RecoveryJournalError('Journal record encoding corruption',through,at);}
   if(!Array.isArray(values)||values.length!==count||!encode(values).equals(body))throw new RecoveryJournalError('Journal record count/canonical encoding corruption',through,at);
   for(let index=0;index<values.length;index++)locations.set(++through,{file,offset:at+HEADER,bodyBytes:n,index,hash:digest,dev:st.dev,ino:st.ino});previous=digest;at+=total;
  }}finally{await h.close();}
  const digest=createHash('sha256'),fh=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);try{const b=Buffer.alloc(256<<10);let p=0;for(;;){const r=await fh.read(b,0,b.length,p);if(!r.bytesRead)break;digest.update(b.subarray(0,r.bytesRead));p+=r.bytesRead;}const after=await fh.stat({bigint:true});if(after.dev!==st.dev||after.ino!==st.ino||after.size!==st.size||after.mtimeNs!==st.mtimeNs||after.ctimeNs!==st.ctimeNs)throw Error('Journal changed during recovery');}finally{await fh.close();}
  const fileHash=digest.digest('hex'),manifestFile=path.join(directory,`continuation-${generation+1}.json`);let continuation:unknown;
  try{const m=await readManifest(manifestFile);continuation=JSON.parse(m.toString('utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(!partial&&continuation===undefined){offset=at;break;}
  if(!partial)throw new RecoveryJournalError('Continuation does not name an unsealed tail',through,at);
  const expected={schema:'flow.journal-continuation',version:1,formatId,generation:generation+1,previousFile:path.basename(file),previousSize:Number(st.size),previousSha256:fileHash,validBytes:at,through,prefixHash:previous};
  if(options.readOnly&&continuation===undefined){offset=at;break;}
  if(!options.readOnly){const prior=await fs.open(file,constants.O_RDWR|constants.O_NOFOLLOW);try{await prior.sync();}finally{await prior.close();}}
  if(continuation===undefined){
   const next=`segment-${generation+1}-${randomBytes(12).toString('hex')}.log`;await checkDir();await ensureFile(path.join(directory,next),true);
   continuation={...expected,next};const manifestBytes=encode(continuation),release=await options.reserve(manifestBytes.length*2);await immutable(manifestFile,manifestBytes);options.onGrowth(manifestBytes.length);release();
  }
  if(typeof continuation!=='object'||continuation===null)throw Error('Invalid journal continuation');const m=continuation as Record<string,unknown>,{next,...binding}=m;
  if(canonicalJson(binding)!==canonicalJson(expected)||typeof next!=='string'||!new RegExp(`^segment-${generation+1}-[a-f0-9]{24}\\.log$`).test(next))throw new RecoveryJournalError('Journal continuation binding changed',through,at);
  await checkDir();if(!options.readOnly)await syncDir(directory);segments.push({file,size:Number(st.size),hash:fileHash});file=path.join(directory,next);await regular(file);generation++;if(generation>1024)throw Error('Journal continuation budget exhausted');
 }
 for(const leaf of await fs.readdir(directory)){const m=/^continuation-(\d+)\.json$/.exec(leaf);if(m&&(leaf!==`continuation-${Number(m[1])}.json`||Number(m[1])<1||Number(m[1])>generation))throw new RecoveryJournalError('Unreachable continuation manifest',through,offset);}
 await checkDir();const handle=await fs.open(file,(options.readOnly?constants.O_RDONLY:constants.O_RDWR)|constants.O_NOFOLLOW),identity=await handle.stat({bigint:true});try{if(!options.readOnly)await handle.sync();}catch(e){await handle.close();throw e;}
 if(through>1_000_000)throw new RecoveryJournalError('Journal record index budget exceeded',through,offset);
 let nextSequence=through+1,pending:Pending[]=[],pendingBytes=0,pendingCount=0,flushRequested=false,running:Promise<void>|undefined,timer:ReturnType<typeof setTimeout>|undefined,failed:unknown,closing=false,closed=false;
 const releases=new Map<number,()=>void>();
 const binding=async()=>{await checkDir();const entry=await regular(file),s=await handle.stat({bigint:true});if(s.dev!==identity.dev||s.ino!==identity.ino||entry.dev!==s.dev||entry.ino!==s.ino||s.size!==BigInt(offset))throw Error('Journal file identity/length changed');};
 const flush=()=>{
  if(running||failed||!pending.length)return;flushRequested=false;if(timer)clearTimeout(timer);timer=undefined;
  const batch:Pending[]=[];let n=0;while(pending.length&&batch.length<64){const p=pending[0];if(batch.length&&n+p.bytes>MAX_GROUP-2)break;batch.push(pending.shift()!);n+=p.bytes;}
  const encoded=group(batch.map(p=>p.entry),previous);
  running=(async()=>{try{
   await binding();let done=0;while(done<encoded.data.length){const r=await handle.write(encoded.data,done,encoded.data.length-done,offset+done);if(!r.bytesWritten)throw Error('Journal append made no progress');done+=r.bytesWritten;}
   offset+=encoded.data.length;await handle.sync();await binding();previous=encoded.digest;through=batch.at(-1)!.entry.sequence;options.onGrowth(encoded.data.length);
   for(const [index,p] of batch.entries()){locations.set(p.entry.sequence,{file,offset:offset-encoded.data.length+HEADER,bodyBytes:encoded.data.length-HEADER-SEAL,index,hash:previous,dev:identity.dev,ino:identity.ino});pendingBytes-=p.bytes;pendingCount--;releases.get(p.entry.sequence)?.();releases.delete(p.entry.sequence);p.resolve({sequence:p.entry.sequence,durableThrough:through,groupHash:previous});}
  }catch(e){failed=new RecoveryJournalError(`Journal append outcome unknown: ${String(e)}`,through,offset,'unknown');for(const p of [...batch,...pending])p.reject(failed);pending=[];}
  })().finally(()=>{running=undefined;if(pending.length&&!failed)flush();});
 };
 return{
  sequences:()=>[...locations.keys()],
  async read(sequence:number){
   const loc=locations.get(sequence);if(!loc)throw Error('Unknown journal record');const entry=await regular(loc.file),h=await fs.open(loc.file,constants.O_RDONLY|constants.O_NOFOLLOW);
   try{const before=await h.stat({bigint:true});if(entry.dev!==loc.dev||entry.ino!==loc.ino||before.dev!==loc.dev||before.ino!==loc.ino)throw Error('Journal read identity changed');
    const b=Buffer.alloc(HEADER+loc.bodyBytes+SEAL);let done=0;while(done<b.length){const r=await h.read(b,done,b.length-done,loc.offset-HEADER+done);if(!r.bytesRead)throw Error('Journal record truncated');done+=r.bytesRead;}
    const header=b.subarray(0,HEADER),seal=b.subarray(HEADER+loc.bodyBytes),after=await h.stat({bigint:true});
    if(after.dev!==before.dev||after.ino!==before.ino||!header.subarray(0,8).equals(MAGIC)||hash(header.subarray(0,56))!==header.subarray(56).toString('hex')||header.readUInt32BE(8)!==loc.bodyBytes||!seal.subarray(0,8).equals(END)||seal.subarray(8).toString('hex')!==loc.hash||hash(b.subarray(0,HEADER+loc.bodyBytes))!==loc.hash)throw new RecoveryJournalError('Journal indexed group changed',through,loc.offset-HEADER);
    const values=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(HEADER,HEADER+loc.bodyBytes)));return values[loc.index] as unknown;
   }finally{await h.close();}
  },
  get durableThrough(){return through;},get failed(){return failed;},
  async admit(value:unknown):Promise<{sequence:number;completion:Promise<Receipt>}>{
   if(options.readOnly)throw Error('Read-only journal inspection');if(closing||closed||failed)throw failed??Error('Journal admission closed');const captured=structuredClone(value),n=encode(captured).length+1;
   if(nextSequence>1_000_000||n>MAX_GROUP-2||pendingBytes+n>MAX_PENDING||pendingCount>=64)throw Error('Journal record/pending budget exceeded');
   const release=await options.reserve(n+HEADER+SEAL);
   if(closing||closed||failed||nextSequence>1_000_000||pendingBytes+n>MAX_PENDING||pendingCount>=64){release();throw failed??Error('Journal admission/record budget closed');}
   const entry={sequence:nextSequence++,value:captured};pendingBytes+=n;pendingCount++;releases.set(entry.sequence,release);
   const completion=new Promise<Receipt>((resolve,reject)=>{pending.push({entry,bytes:n,resolve,reject});if(!timer&&!running)timer=setTimeout(()=>{timer=undefined;flush();},options.manualFlush?2:0);});return{sequence:entry.sequence,completion};
  },
  flushSoon(){flushRequested=true;flush();},
  async barrier(){if(timer){clearTimeout(timer);timer=undefined;}flush();while(running||pending.length){if(running)await running;else flush();if(failed)throw failed;}if(failed)throw failed;},
  async audit(){if(running)await running;if(pending.length)throw Error('Journal must be drained before audit');await binding();if(!options.readOnly)await handle.sync();if(failed)throw failed;for(const s of segments){const st=await regular(s.file),h=await fs.open(s.file,constants.O_RDONLY|constants.O_NOFOLLOW),digest=createHash('sha256');try{const buf=Buffer.alloc(256<<10);let pos=0;for(;;){const r=await h.read(buf,0,buf.length,pos);if(!r.bytesRead)break;digest.update(buf.subarray(0,r.bytesRead));pos+=r.bytesRead;}if(pos!==s.size||digest.digest('hex')!==s.hash)throw Error('Retained journal segment changed');const after=await h.stat({bigint:true});if(after.dev!==st.dev||after.ino!==st.ino||after.size!==st.size)throw Error('Retained journal identity changed');}finally{await h.close();}}},
  async close(){closing=true;if(timer){clearTimeout(timer);timer=undefined;}flush();while(running||pending.length){if(running)await running;else flush();if(failed)break;}if(!closed){closed=true;await handle.close();}},
 };
}
