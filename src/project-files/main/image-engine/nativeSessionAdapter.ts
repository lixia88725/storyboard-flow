import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { startImageEngine } from '../../../platform/main/imageEngineConnection.js';
import type { NativeFrame } from '../../../platform/main/imageEngineFraming.js';
import type { NativeImageRef } from '../../../platform/contracts/imageProject.js';
import type { FlowStroke } from '../../../platform/contracts/flowWave2.js';
import type { NativeOperationStatus, NativeSessionDriver, PreparedImage } from '../../../session/core/nativeSession.js';
import { validNativeImageRef, validProjectStroke } from '../../../session/core/imageProjectModel.js';
import { record, same } from '../../../session/core/imageProjectValues.js';
import type { RetainedSourceObject } from './sourceStore.js';

type Connection=ReturnType<typeof startImageEngine>;
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
function refuse(message:string,code='conflict',effect:'none'|'retained'|'unknown'='none'):never{throw Object.assign(Error(message),{code,effect});}
async function boundedFile(file:string,limit:number,expected?:RetainedSourceObject['identity']){
  if(!path.isAbsolute(file)||await fs.realpath(file)!==file||typeof constants.O_NOFOLLOW!=='number')refuse('Native input path cannot be verified');
  const entry=await fs.lstat(file,{bigint:true});if(!entry.isFile()||entry.isSymbolicLink()||entry.size>BigInt(limit))refuse('Native input exceeds bounds');
  const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await h.stat({bigint:true});if(before.dev!==entry.dev||before.ino!==entry.ino)refuse('Native input changed while opening');
    if(expected&&(expected.dev!==String(before.dev)||expected.ino!==String(before.ino)||expected.size!==String(before.size)||expected.mtimeNs!==String(before.mtimeNs)||expected.ctimeNs!==String(before.ctimeNs)))refuse('Retained source identity changed before streaming');
    const parts:Buffer[]=[],buf=Buffer.allocUnsafe(64<<10);let n=0;
    while(true){const r=await h.read(buf,0,Math.min(buf.length,limit-n+1),n);if(!r.bytesRead)break;n+=r.bytesRead;if(n>limit)refuse('Native input grew beyond bounds');parts.push(Buffer.from(buf.subarray(0,r.bytesRead)));}
    const after=await h.stat({bigint:true});if(before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs||BigInt(n)!==before.size)refuse('Native input changed during streaming');return Buffer.concat(parts,n);
  }finally{await h.close();}
}

/** Real Node transport adapter. Only these Flow operations cross the seam. No
 * pipeline, file Save, native user Undo, arbitrary command or renderer path. */
export function createNativeSessionAdapter(options:{connection:Connection;storeRoot:string;storeId:string;onFrame?:(frame:NativeFrame)=>void}){
  const connection=options.connection,storeId=options.storeId,storeRoot=options.storeRoot;
  let current:NativeImageRef|null=null,candidate:string|undefined,previewOperation:string|undefined,serial=0;
  const next=()=>`control-${++serial}`;
  const call=async(operationId:string,body:Record<string,unknown>,base:string|null=current?.versionId??null,payload?:Uint8Array)=>{
    const frame=await connection.request(operationId,body,base,payload?new Uint8Array(payload):undefined);const reply=frame.header.body;
    if(!record(reply)||typeof reply.kind!=='string')refuse('Malformed native reply','protocol','unknown');
    if(reply.kind==='failure'){const error=reply.error;if(!record(error)||typeof error.message!=='string')refuse('Malformed native failure','protocol','unknown');refuse(error.message,String(error.code??'native'),error.effect==='none'?'none':error.effect==='retained'?'retained':'unknown');}
    if(record(reply.frame))try{options.onFrame?.(frame);}catch{/* presentation observers cannot change an accepted native operation */}return{reply,frame};
  };
  const nativeRef=(receipt:unknown):NativeImageRef=>{
    if(!record(receipt)||receipt.schema!=='flow.image-version'||receipt.version!==1)refuse('Invalid native version receipt','protocol','unknown');
    const ref={storeId,documentId:receipt.documentId,versionId:receipt.versionId,manifestSha256:receipt.manifestSha256,width:receipt.width,height:receipt.height};
    if(!validNativeImageRef(ref))refuse('Invalid native version identity','protocol','unknown');return ref;
  };
  const prepared=(reply:Record<string,unknown>):PreparedImage=>{
    if(reply.kind!=='prepared'||typeof reply.candidateId!=='string'||(reply.baseVersion!==null&&typeof reply.baseVersion!=='string'))refuse('Expected durable native prepared receipt','protocol','unknown');
    candidate=reply.candidateId;return{candidateId:reply.candidateId,baseVersion:reply.baseVersion,native:nativeRef(reply.receipt)};
  };
  const verifyNative=async(ref:NativeImageRef)=>{
    if(!validNativeImageRef(ref)||ref.storeId!==storeId)refuse('Unknown native store/ref');
    const raw=await boundedFile(path.join(storeRoot,'versions',ref.versionId+'.json'),16<<20);
    if(sha(raw)!==ref.versionId||ref.versionId!==ref.manifestSha256)refuse('Native manifest hash changed','corrupt','retained');
    const parsed:unknown=JSON.parse(raw.toString('utf8'));
    if(!record(parsed)||parsed.schema!=='flow.image-native-snapshot'||parsed.version!==1||parsed.documentId!==ref.documentId||!record(parsed.nativeManifest)||!record(parsed.nativeManifest.document)||!record(parsed.nativeManifest.document.size)||parsed.nativeManifest.document.size.width!==ref.width||parsed.nativeManifest.document.size.height!==ref.height)refuse('Native manifest geometry/identity mismatch','corrupt','retained');
    // Full compressed object verification occurs inside native load/install;
    // a live prepared receipt already follows native durable object publication.
  };
  const install=async(ref:NativeImageRef)=>{
    await verifyNative(ref);if(current&&same(current,ref))return;
    const result=await call(next(),current?{kind:'install',versionId:ref.versionId}:{kind:'load',versionId:ref.versionId});
    if(!['installed','loaded'].includes(result.reply.kind as string)||result.reply.versionId!==ref.versionId)refuse('Native install identity mismatch','protocol','unknown');current={...ref};
  };
  const capture=async()=>{if(!current)refuse('No native editing target');return(await call(next(),{kind:'capture'})).frame;};
  const confirm=async(ref:NativeImageRef,base:NativeImageRef|null)=>{
    // An accepted journal record alone does not prove that context installation
    // succeeded. A successful base-checked Capture confirms the actual context.
    try{await call(next(),{kind:'capture'},ref.versionId);current={...ref};return;}
    catch(e){if((e as {code?:string}).code!=='conflict')throw e;}
    if(!base)refuse('Native accepted context remains unknown','conflict','unknown');
    await call(next(),{kind:'capture'},base.versionId);current={...base};await install(ref);
  };
  const driver:NativeSessionDriver={
    async preparePaint(operationId,base,stroke){
      if(!validProjectStroke(stroke))refuse('Invalid stroke');
      if(stroke.brush&&(stroke.brush.tip!=='hard'||stroke.brush.grain!==0||stroke.brush.pressureSize!==0||stroke.brush.pressureOpacity!==0))refuse('Stage-A brush preset unsupported: tip must be hard; grain, pressureSize and pressureOpacity must be zero. Original input is retained.','unsupported-brush');
      await install(base);
      const points=Array.from({length:stroke.points.length/2},(_,i)=>({x:stroke.points[i*2],y:stroke.points[i*2+1],pressure:stroke.pressures?.[i]??1}));
      const brush={size:stroke.size,opacity:stroke.opacity,color:stroke.color,erase:stroke.tool==='eraser',hardness:stroke.brush?.hardness??1-stroke.softness,spacing:stroke.brush?.spacing??0.06,seed:stroke.brush?.seed??0,brush:{pressureSize:false,pressureOpacity:false}};
      previewOperation=operationId;
      await call(`${operationId}-begin`,{kind:'strokeBegin',previewId:operationId,brush,points:points.slice(0,1)});
      for(let offset=1;offset<points.length;offset+=256)await call(`${operationId}-points-${offset}`,{kind:'strokeAppend',previewId:operationId,fromSeq:offset+1,points:points.slice(offset,offset+256)});
      const value=prepared((await call(operationId,{kind:'strokeFinish',previewId:operationId,throughSeq:points.length})).reply);previewOperation=undefined;return value;
    },
    async accept(value,base){
      const result=await call(next(),{kind:'accept',candidateId:value.candidateId},base.versionId);
      if(result.reply.kind!=='accepted'||result.reply.candidateId!==value.candidateId)refuse('Native acceptance mismatch','protocol','unknown');
      const ref=nativeRef(result.reply.receipt);if(!same(ref,value.native))refuse('Native accepted wrong content','protocol','unknown');current=ref;candidate=undefined;return ref;
    },
    async status(operationId):Promise<NativeOperationStatus>{
      const {reply}=await call(next(),{kind:'status',targetOperationId:operationId});
      if(reply.kind!=='status'||!['absent','intent','prepared','accepted','discarded','failed'].includes(String(reply.state)))refuse('Invalid native operation status','protocol','unknown');
      if(reply.state==='prepared'){
        if(!record(reply.result))refuse('Missing native prepared status','protocol','unknown');
        const r=reply.result;if(typeof r.candidateId!=='string'||(r.baseVersion!==null&&typeof r.baseVersion!=='string'))refuse('Invalid native prepared status','protocol','unknown');
        return{state:'prepared',prepared:{candidateId:r.candidateId,baseVersion:r.baseVersion,native:nativeRef(r.receipt)}};
      }
      if(reply.state==='accepted'){if(!record(reply.result))refuse('Missing native accepted status','protocol','unknown');return{state:'accepted',native:nativeRef(reply.result.receipt)};}
      return{state:reply.state as 'absent'|'intent'|'discarded'|'failed'};
    },
    async recoverAccept(candidateId,base,ref){
      const status=await driver.status(candidateId);
      if(status.state==='accepted'){if(!same(status.native,ref))refuse('Accepted native receipt disagrees with Main');if(!current)await install(ref);await confirm(ref,base);return;}
      if(status.state!=='prepared'||!same(status.prepared?.native,ref))refuse('Cannot settle unknown native candidate','conflict','unknown');
      if(!candidate){
        if(connection.supports('recoveredCandidateAcceptAtInstalledVersion'))await install(ref);
        else if(base)await install(base);
      }
      const {reply}=await call(next(),{kind:'accept',candidateId});
      if(reply.kind!=='accepted'||!same(nativeRef(reply.receipt),ref))refuse('Recovered accept receipt mismatch','protocol','unknown');candidate=undefined;await confirm(ref,base);
    },
    async cancelPreview(operationId){
      if(previewOperation===undefined)return;
      if(previewOperation!==operationId)refuse('Another native preview remains active','conflict','unknown');
      const {reply}=await call(next(),{kind:'strokeCancel',previewId:operationId});
      if(reply.kind!=='cancelled')refuse('Native preview cancellation not confirmed','protocol','unknown');previewOperation=undefined;
    },
    async discard(operationId){
      const {reply}=await call(next(),candidate===operationId?{kind:'discard',candidateId:operationId}:{kind:'abandon',targetOperationId:operationId});
      if(reply.kind!=='discarded'||reply.candidateId!==operationId)refuse('Native discard receipt mismatch','protocol','unknown');candidate=undefined;
    },
    install,
    async freeze(){const{reply}=await call(next(),{kind:'freeze'});if(reply.kind!=='frozen'||reply.versionId!==(current?.versionId??null))refuse('Native freeze identity failed','protocol','unknown');},
    async close(){const{reply}=await call(next(),{kind:'close'});if(reply.kind!=='closed')refuse('Native close failed','protocol','unknown');await connection.exited;}
  };
  return {
    driver,verifyNative,capture,
    /** Stage-A transport accepts at most 64 MiB. SourceStore may retain larger
     * files; those remain unhydrated instead of being read 128 times by readRange.
     * One bound handle streams into one bounded transport payload, identity is
     * checked before/after and native independently checks the declared SHA. */
    async openRetained(operationId:string,source:RetainedSourceObject,formatHint:string){
      const payload=await boundedFile(source.path,64<<20,source.identity);
      if(payload.length!==source.byteLength||sha(payload)!==source.digest)refuse('Retained source digest changed','corrupt','retained');
      return prepared((await call(operationId,{kind:'open',source:{digest:source.digest,byteLength:source.byteLength,formatHint}},null,payload)).reply);
    },
    async acceptOpened(value:PreparedImage){const{reply}=await call(next(),{kind:'accept',candidateId:value.candidateId},null);if(reply.kind!=='accepted')refuse('Source acceptance failed','protocol','unknown');const ref=nativeRef(reply.receipt);if(!same(ref,value.native))refuse('Source acceptance identity mismatch');current=ref;candidate=undefined;return ref;}
  };
}
