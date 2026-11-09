import { expect, it, vi } from 'vitest';
import type { FlowStroke } from '../../platform/contracts/flowWave2';
import type { NativeImageRef } from '../../platform/contracts/imageProject';
import { createMainImagePipeline, type NativePipelineDriver } from './nativePipeline';

const ref:NativeImageRef={storeId:'store',documentId:'document',versionId:'a'.repeat(64),manifestSha256:'a'.repeat(64),width:64,height:64};
const limits={maxPendingStrokes:4,maxPendingPoints:65536,maxRetainedPixelBytes:16<<20};
const stroke:FlowStroke={tool:'brush',color:'#ff0000',size:10,opacity:0.5,softness:0,points:[12,20]};
function driver(){
 let began=0;const port:NativePipelineDriver={
  validateStroke:()=>{},start:async(base,limits)=>({pipelineId:'pipeline',anchorVersion:base.versionId,documentId:base.documentId,epoch:1,limits}),
  begin:async()=>{began++;},append:async()=>{},end:async(op,through)=>({candidateId:op,pipelineId:'pipeline',predecessorOperationId:null,inputThrough:through,frameInputThrough:through,epoch:1,inputDigest:'b'.repeat(64),durable:false}),
  cancel:async()=>({pipelineId:'pipeline',epoch:2}),poll:async()=>({pipelineId:'pipeline',anchorVersion:ref.versionId,acceptedVersion:ref.versionId,events:[],blocked:null,queueDepth:0,availableSlots:4}),accept:async()=>{},stop:async()=>{}
 };
 // Explicitly reflect the predecessor/epoch prefix of the two admitted test strokes.
 let last:string|null=null,prefix=0;port.end=async(op,through)=>{const pred=last;last=op;prefix+=through;return{candidateId:op,pipelineId:'pipeline',predecessorOperationId:pred,inputThrough:through,frameInputThrough:prefix,epoch:1,inputDigest:'b'.repeat(64),durable:false};};
 return{port,began:()=>began};
}
it('resolves only the first anchor lazily; a refused target and existing source chain start no extra hydration',async()=>{
 const d=driver();let serial=0,a=0,b=0;
 const pipeline=createMainImagePipeline({sessionId:'session',incarnation:'one',driver:d.port,limits,mintId:()=>`op${++serial}`,canAdmit:()=>true,
  anchor:shotId=>({imageId:shotId,expected:{kind:'source',source:{importId:'batch',itemId:shotId,interpretationId:'reader'}},commitHash:'c'.repeat(64),native:async()=>{if(shotId==='b'){b++;throw Error('Rejected target must not start hydration');}if(++a>1)throw Error('Existing anchor must not rehydrate');return ref;}}),
  persist:async()=>{},decide:async entry=>{await entry.preparedWait.promise;throw Error('This test never prepares a project decision');},blocked:()=>{}
 });
 try{
  const first=pipeline.input({kind:'begin',shotId:'a',stroke});expect(first.kind).toBe('admitted');if(first.kind!=='admitted')throw Error('Missing first op');pipeline.input({kind:'end',operationId:first.operationId,throughSeq:1});
  expect(pipeline.input({kind:'begin',shotId:'b',stroke})).toMatchObject({kind:'rejected',error:{code:'busy'}});
  const next=pipeline.input({kind:'begin',shotId:'a',stroke});expect(next.kind).toBe('admitted');
  await vi.waitFor(()=>expect(d.began()).toBe(2));expect(a).toBe(1);expect(b).toBe(0);
 }finally{pipeline.fence(Error('Synthetic fixture shutdown'));await pipeline.drainInput();}
});
it('keeps a failed lazy source resolution as explicit volatile recovery input without an unhandled promise',async()=>{
 const d=driver();let resolutions=0,persisted=0,blocked=0;
 const pipeline=createMainImagePipeline({sessionId:'session',incarnation:'one',driver:d.port,limits,mintId:()=>`op`,canAdmit:()=>true,
  anchor:()=>({imageId:'image',expected:{kind:'source',source:{importId:'batch',itemId:'item',interpretationId:'reader'}},commitHash:'c'.repeat(64),native:async()=>{resolutions++;throw Error('Synthetic source hydration unavailable');}}),
  persist:async()=>{persisted++;},decide:async entry=>{await entry.preparedWait.promise;throw Error('No native preparation expected');},blocked:()=>{blocked++;}
 });
 expect(pipeline.input({kind:'begin',shotId:'a',stroke}).kind).toBe('admitted');pipeline.input({kind:'end',operationId:'op',throughSeq:1});
 await expect(pipeline.waitOperation('op')).rejects.toThrow('Synthetic source hydration unavailable');await pipeline.drainInput();
 expect(resolutions).toBe(1);expect(d.began()).toBe(0);expect(persisted).toBe(0);expect(blocked).toBe(1);expect(pipeline.retainedInputs()).toEqual([{operationId:'op',shotId:'a',imageId:'image',stroke,ended:true,reason:'missing-pipeline-identity'}]);
});

it('separates a temporary admission pause from a fault and cannot resume through retained failure',async()=>{
 const d=driver();let canAdmit=true;
 const pipeline=createMainImagePipeline({sessionId:'s',incarnation:'i',driver:d.port,limits,mintId:()=> 'op',canAdmit:()=>canAdmit,
  anchor:()=>({imageId:'image',expected:{kind:'native',native:ref},commitHash:'c'.repeat(64),native:async()=>ref}),persist:async()=>{},decide:async()=>{throw Error('No end in this test');},blocked:()=>{}});
 const begin={kind:'begin' as const,shotId:'a',stroke};
 pipeline.seal();expect(pipeline.input(begin)).toMatchObject({kind:'rejected',error:{code:'busy',effect:'none'}});
 pipeline.resumeAdmission();canAdmit=false;expect(pipeline.input(begin)).toMatchObject({kind:'rejected',error:{code:'busy',effect:'none'}});
 canAdmit=true;expect(pipeline.input(begin).kind).toBe('admitted');await pipeline.drainInput();
 pipeline.fence(Error('Synthetic transport failure'));pipeline.resumeAdmission();
 expect(pipeline.input(begin)).toMatchObject({kind:'rejected',error:{code:'pipeline-blocked',effect:'retained'}});
 expect(pipeline.retainedInputs()).toHaveLength(1);
});

it('updates only a confirmed cancellation epoch and keeps the next stroke in the same pipeline',async()=>{
 const d=driver();let serial=0,error:unknown;const events:string[]=[];
 const end=d.port.end;d.port.end=async(op,through)=>({...await end(op,through),epoch:2});
 const pipeline=createMainImagePipeline({sessionId:'s',incarnation:'i',driver:d.port,limits,mintId:()=>`cancel-epoch-${++serial}`,canAdmit:()=>true,
  anchor:()=>({imageId:'image',expected:{kind:'native',native:ref},commitHash:'c'.repeat(64),native:async()=>ref}),persist:async()=>{},
  decide:async entry=>{await entry.preparedWait.promise;throw Error('Synthetic fixture does not prepare');},blocked:(_id,e)=>{error=e;}});
 pipeline.subscribe(e=>events.push(e.stage));
 try{
  pipeline.input({kind:'begin',shotId:'a',stroke});pipeline.input({kind:'cancel',operationId:'cancel-epoch-1'});await pipeline.drainInput();
  pipeline.input({kind:'begin',shotId:'a',stroke});pipeline.input({kind:'end',operationId:'cancel-epoch-2',throughSeq:1});await pipeline.drainInput();
  expect(error).toBeUndefined();expect(events).toContain('cancelled');expect(events).toContain('queued');
 }finally{pipeline.fence(Error('Synthetic fixture shutdown'));await pipeline.drainInput();}
});
it('retains evidence when a cancellation returns an unrelated epoch',async()=>{
 const d=driver();d.port.cancel=async()=>({pipelineId:'pipeline',epoch:99});let error:unknown;
 const pipeline=createMainImagePipeline({sessionId:'s',incarnation:'i',driver:d.port,limits,mintId:()=> 'cancel-invalid',canAdmit:()=>true,
  anchor:()=>({imageId:'image',expected:{kind:'native',native:ref},commitHash:'c'.repeat(64),native:async()=>ref}),persist:async()=>{},
  decide:async()=>{throw Error('No end expected');},blocked:(_id,e)=>{error=e;}});
 pipeline.input({kind:'begin',shotId:'a',stroke});pipeline.input({kind:'cancel',operationId:'cancel-invalid'});await pipeline.drainInput();
 expect(String(error)).toContain('cancellation identity');expect(pipeline.retainedInputs()).toHaveLength(1);
});
