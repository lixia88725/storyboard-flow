import fs from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import type {RetainedSourceObject} from './sourceStore.js';
import type {WorkspaceOutputBudget} from './workspaceOutputContract.js';

export type SourcePreview={width:number;height:number;sourceWidth:number;sourceHeight:number;rgba:Uint8Array};
const CAP=128<<20,PIXELS=100_000_000,EDGE=256,HEADER=88,MAX=HEADER+EDGE*EDGE*4;
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const fail=(message:string):never=>{throw Object.assign(Error(message),{code:'source-preview-conflict',effect:'none'});};
const identity=(s:{dev:bigint;ino:bigint;size:bigint;mtimeNs:bigint;ctimeNs:bigint})=>({dev:String(s.dev),ino:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)});
const equal=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
async function read(file:string,cap:number,expected?:RetainedSourceObject['identity']){
 if(!path.isAbsolute(file)||path.normalize(file)!==file||await fs.realpath(file)!==file)fail('Aliased preview input');
 const st=await fs.lstat(file,{bigint:true});if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1n||st.size>BigInt(cap))fail('Unsafe or oversized preview input');
 const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const before=await h.stat({bigint:true});if(!equal(identity(st),identity(before))||expected&&!equal(identity(before),expected))fail('Preview source identity changed');const data=Buffer.alloc(Number(before.size));let at=0;while(at<data.length){const r=await h.read(data,at,data.length-at,at);if(!r.bytesRead)fail('Truncated preview input');at+=r.bytesRead;}if(!equal(identity(before),identity(await h.stat({bigint:true}))))fail('Preview input changed during read');return data;}finally{await h.close();}
}
/** Only scan bounded PSD image resources; never read layer records or decode merged pixels. */
export function psdEmbeddedJpeg(bytes:Buffer):Buffer|null{
 if(bytes.length<30||bytes.toString('ascii',0,4)!=='8BPS'||bytes.readUInt16BE(4)!==1)return null;
 let at=26;const color=bytes.readUInt32BE(at);at+=4;if(color>bytes.length-at-4)return null;at+=color;const length=bytes.readUInt32BE(at);at+=4;if(length>16<<20||length>bytes.length-at)return null;const end=at+length;
 while(at+12<=end){if(bytes.toString('ascii',at,at+4)!=='8BIM')return null;const id=bytes.readUInt16BE(at+4);at+=6;const n=bytes[at];at+=1+n;if((1+n)%2)at++;if(at+4>end)return null;const size=bytes.readUInt32BE(at);at+=4;if(size>end-at)return null;
  if((id===1033||id===1036)&&size>=28&&size<=4<<20){const p=bytes.subarray(at,at+size);const w=p.readUInt32BE(4),h=p.readUInt32BE(8),compressed=p.readUInt32BE(20);if(p.readUInt32BE(0)===1&&w>0&&h>0&&w<=4096&&h<=4096&&w*h<=4_194_304&&p.readUInt16BE(24)===24&&p.readUInt16BE(26)===1&&compressed===size-28&&p[28]===255&&p[29]===216)return p.subarray(28);}
  at+=size+(size%2);
 }return null;
}
export async function createSourcePreview(options:{root:string;writerAuthority:{assertHeld(root:{path:string;dev:string;ino:string}):Promise<void>};budget:WorkspaceOutputBudget}){
 const root=options.root;if(!path.isAbsolute(root)||path.normalize(root)!==root)fail('Canonical preview root required');
 const dirs=new Map<string,{dev:bigint;ino:bigint}>();
 const directory=async(p:string)=>{const s=await fs.lstat(p,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(p)!==p)fail('Unsafe preview directory');const old=dirs.get(p);if(old&&(old.dev!==s.dev||old.ino!==s.ino))fail('Preview directory changed');dirs.set(p,{dev:s.dev,ino:s.ino});return s;};
 const st=await directory(root),binding={path:root,dev:String(st.dev),ino:String(st.ino)};
 const bind=async()=>{await options.writerAuthority.assertHeld(binding);for(const p of dirs.keys())await directory(p);};
 const cache=path.join(root,'.storyboard-flow','source-previews-v1');
 for(const p of[path.join(root,'.storyboard-flow'),cache]){await bind();try{await fs.mkdir(p,{mode:0o700});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}await directory(p);}
 const memory=new Map<string,SourcePreview>(),pending=new Map<string,Promise<SourcePreview|null>>();let closed=false,tail:Promise<unknown>=Promise.resolve(),queued=0;
 const copy=(p:SourcePreview)=>({...p,rgba:new Uint8Array(p.rgba)});
 const unpack=(b:Buffer):SourcePreview|null=>{if(b.length<HEADER||b.toString('ascii',0,8)!=='FLOWSPV1')return null;const width=b.readUInt32BE(8),height=b.readUInt32BE(12);if(!width||!height||width>EDGE||height>EDGE||b.readUInt32BE(16)<1||b.readUInt32BE(20)<1||b.readUInt32BE(16)>1_000_000||b.readUInt32BE(20)>1_000_000||b.length!==HEADER+width*height*4||hash(b.subarray(HEADER))!==b.toString('ascii',24,88))return null;return{width,height,sourceWidth:b.readUInt32BE(16),sourceHeight:b.readUInt32BE(20),rgba:new Uint8Array(b.subarray(HEADER))};};
 const work=async(source:RetainedSourceObject,format:string)=>{await bind();if(!/^[a-f0-9]{64}$/.test(source.digest)||!Number.isSafeInteger(source.byteLength)||source.byteLength<1||source.byteLength>CAP)fail('Invalid preview source receipt');const bytes=await read(source.path,CAP,source.identity);if(bytes.length!==source.byteLength||hash(bytes)!==source.digest)fail('Preview source digest mismatch');
 const detected=bytes.toString('ascii',0,4)==='8BPS'?'psd':bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?'png':bytes[0]===255&&bytes[1]===216?'jpeg':bytes.subarray(0,4).equals(Buffer.from([73,73,42,0]))||bytes.subarray(0,4).equals(Buffer.from([77,77,0,42]))?'tiff':null;if(detected!==(format==='jpg'?'jpeg':format==='tif'?'tiff':format))fail('Source signature differs from format hint');
 const key=source.digest+'-'+format;const cached=memory.get(key);if(cached)return copy(cached);
 const file=path.join(cache,key+'.rgba');let damaged=false;try{const p=unpack(await read(file,MAX));if(p){memory.set(key,p);while(memory.size>32)memory.delete(memory.keys().next().value!);return copy(p);}damaged=true;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 if(damaged){try{const repaired=unpack(await read(file+'.repair',MAX));if(!repaired)fail('Invalid retained repair cache');memory.set(key,repaired!);while(memory.size>32)memory.delete(memory.keys().next().value!);return copy(repaired!);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
 const input=format==='psd'?psdEmbeddedJpeg(bytes):bytes;if(!input)return null;if(!['psd','png','jpeg','jpg','tiff','tif'].includes(format))return null;
 const metadata=await sharp(input,{limitInputPixels:PIXELS,pages:1}).metadata();const swap=[5,6,7,8].includes(metadata.orientation??1),sourceWidth=format==='psd'?bytes.readUInt32BE(18):swap?metadata.height!:metadata.width!,sourceHeight=format==='psd'?bytes.readUInt32BE(14):swap?metadata.width!:metadata.height!;if(!sourceWidth||!sourceHeight||sourceWidth>1_000_000||sourceHeight>1_000_000)fail('Invalid source dimensions');
 const {data,info}=await sharp(input,{limitInputPixels:PIXELS,pages:1,failOn:'error'}).rotate().resize({width:EDGE,height:EDGE,fit:'inside',withoutEnlargement:true}).toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
 if(info.channels!==4||info.width>EDGE||info.height>EDGE||data.length!==info.width*info.height*4)fail('Invalid preview decode');
 const p={width:info.width,height:info.height,sourceWidth,sourceHeight,rgba:new Uint8Array(data)},packed=Buffer.alloc(HEADER+data.length);packed.write('FLOWSPV1');packed.writeUInt32BE(p.width,8);packed.writeUInt32BE(p.height,12);packed.writeUInt32BE(sourceWidth,16);packed.writeUInt32BE(sourceHeight,20);packed.write(hash(data),24,'ascii');data.copy(packed,HEADER);
 const grant=await options.budget.reserve({operationId:'preview-'+randomUUID(),bytes:packed.length,purpose:'source-preview-cache'});let created=false;try{await bind();const h=await fs.open(damaged?file+'.repair':file,'wx',0o600);created=true;try{await h.writeFile(packed);await h.sync();}finally{await h.close();}await bind();await grant.settleActual(packed.length);}catch(e){if(created)await grant.retainUnknown();else await grant.settleActual(0);throw e;}
 memory.set(key,p);while(memory.size>32)memory.delete(memory.keys().next().value!);return copy(p);
 };
 return{preview(source:RetainedSourceObject,formatHint:string):Promise<SourcePreview|null>{if(closed)return Promise.reject(Error('Source preview closed'));const format=formatHint.toLowerCase();if(!/^[a-z]{2,5}$/.test(format))return Promise.reject(Error('Invalid preview format'));const captured=structuredClone(source),key=JSON.stringify(captured)+format;const existing=pending.get(key);if(existing)return existing.then(p=>p?copy(p):null);if(queued>=128)return Promise.reject(Error('Source preview queue full'));queued++;const job=tail.then(()=>work(captured,format));tail=job.catch(()=>{});pending.set(key,job);void job.finally(()=>{queued--;pending.delete(key);}).catch(()=>{});return job;},async close(){closed=true;await tail;memory.clear();}};
}
