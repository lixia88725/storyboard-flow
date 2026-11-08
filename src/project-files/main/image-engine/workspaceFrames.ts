import type { NativeFrame } from '../../../platform/main/imageEngineFraming.js';
import type { ImageWorkspaceFrameIdentity, ImageWorkspaceFrameMessage, ImageWorkspaceFrameReply, ImageWorkspaceOwner } from '../../../platform/contracts/imageWorkspace.js';
import { validateImageFrame, type FrameIdentity, type ImageFrameHeader } from '../../../drawing/renderer/image-engine/frames.js';
import type { ImageWorkspaceFrameTransport } from './workspaceRuntimeContract.js';

import {canonicalJson} from '../persistence/canonicalJson.js';
const equal=(a:unknown,b:unknown)=>canonicalJson(a)===canonicalJson(b);
const identity=(h:ImageFrameHeader):FrameIdentity=>({sessionId:h.sessionId,incarnation:h.incarnation,documentId:h.documentId,workerEpoch:h.workerEpoch,epoch:h.epoch});
type DisplayFrame={header:ImageFrameHeader;pixels:Uint8Array};
/** Read-only, bounded display delivery. A Canvas ACK controls this transport only;
 * it never settles an input, releases native persistence credit, or gates CAS. */
export function createWorkspaceFrameDelivery(options:{
 owner:ImageWorkspaceOwner;mintNonce():string;
 captureKeyframe():Promise<boolean>;
 onStream(identity:ImageWorkspaceFrameIdentity):void;
 onFault(error:{code:string;message:string;effect:'none'}):void;
}){
 const owner=structuredClone(options.owner);let descriptor:ImageWorkspaceFrameIdentity={owner,nonce:options.mintNonce(),streamGeneration:1};
 let port:ImageWorkspaceFrameTransport|undefined,off:()=>void=()=>{},offClose:()=>void=()=>{},disposed=false,ready=false,serial=0;
 let current:FrameIdentity|undefined,installed:FrameIdentity|undefined,control:string|undefined,inflight:{id:string;header:ImageFrameHeader}|undefined;
 let queued:DisplayFrame[]=[],needsKeyframe=false,capturing=false,captureAgain=false,failures=0,lastAck=0;
 const base=()=>structuredClone(descriptor);
 const fault=(message:string)=>options.onFault({code:'display-unavailable',message,effect:'none'});
 const detach=()=>{off();offClose();off=offClose=()=>{};const old=port;port=undefined;ready=false;queued=[];inflight=undefined;control=undefined;current=undefined;installed=undefined;lastAck=0;needsKeyframe=false;captureAgain=false;old?.close();};
 const rotate=()=>{detach();if(disposed)return;descriptor={owner,nonce:options.mintNonce(),streamGeneration:descriptor.streamGeneration+1};options.onStream(base());};
 const send=(message:ImageWorkspaceFrameMessage)=>{try{port?.send(message);}catch(e){fault(`Display port send failed: ${String(e)}`);rotate();}};
 const capture=()=>{
  if(!port||!ready||disposed)return;if(capturing){captureAgain=true;return;}capturing=true;const generation=descriptor.streamGeneration;
  void options.captureKeyframe().then(produced=>{if(!produced&&generation===descriptor.streamGeneration)needsKeyframe=true;}).catch(e=>{if(generation===descriptor.streamGeneration){fault(`Keyframe capture failed: ${String(e)}`);}}).finally(()=>{capturing=false;if(captureAgain){captureAgain=false;capture();}});
 };
 const controlFor=(next:FrameIdentity)=>{
  if(!port||!ready)return;current=next;installed=undefined;lastAck=0;inflight=undefined;control=`display-${++serial}`;
  send({...base(),id:control,kind:'reset',identity:next});
 };
 const pump=()=>{
  if(!port||!ready||control||inflight||!queued.length)return;
  const frame=queued.shift()!,next=identity(frame.header);
  if(!installed||!equal(installed,next)){queued.unshift(frame);current=next;control=`display-${++serial}`;send({...base(),id:control,kind:installed?'reset':'initialize',identity:next});return;}
  if(frame.header.baseFrameSeq!==null&&frame.header.baseFrameSeq!==lastAck){queued=[];needsKeyframe=true;capture();return;}
  const id=`display-${++serial}`;inflight={id,header:frame.header};send({...base(),id,kind:'frame',header:frame.header,pixels:frame.pixels});
 };
 const receive=(reply:ImageWorkspaceFrameReply)=>{
  if(!port||disposed||!reply||typeof reply!=='object'||!equal(reply.owner,owner)||reply.nonce!==descriptor.nonce||reply.streamGeneration!==descriptor.streamGeneration)return;
  if(reply.kind==='ready'){if(!ready){ready=true;capture();}return;}
  if(reply.kind!=='ack'||!reply.result||typeof reply.result.ok!=='boolean')return;
  if(reply.id===control){
   control=undefined;if(!reply.result.ok){if(++failures>=3){fault(reply.result.message);rotate();return;}if(current)controlFor(current);return;}
   failures=0;installed=current;lastAck=0;if(!queued.length){needsKeyframe=true;capture();}else pump();return;
  }
  if(!inflight||reply.id!==inflight.id)return;
  const frame=inflight.header;inflight=undefined;
  if(!reply.result.ok){queued=[];needsKeyframe=true;if(++failures>=3){fault(reply.result.message);rotate();return;}if(current)controlFor(current);return;}
  if(!reply.installed||reply.installed.frameSeq!==frame.frameSeq||reply.installed.inputThrough!==frame.inputThrough){queued=[];needsKeyframe=true;fault('Canvas ACK does not match the in-flight frame');capture();return;}failures=0;lastAck=frame.frameSeq;pump();
 };
 return{
  identity:base,
  /** Runtime idle/settlement/context events wake a busy-deferred keyframe. */
  wake(){if(needsKeyframe&&!disposed)capture();},
  async connect(request:ImageWorkspaceFrameIdentity,transport:ImageWorkspaceFrameTransport){
   if(disposed||!equal(request,descriptor))throw Error('Stale display stream capability');if(port)throw Error('Display stream already attached');
   port=transport;const generation=descriptor.streamGeneration;off=transport.subscribe(receive);offClose=transport.onClose(()=>{if(generation===descriptor.streamGeneration)rotate();});
   // The platform must transfer the peer port after this Promise resolves. Do
   // not wait for ready here or the transfer and handshake would deadlock.
  },
  publish(value:NativeFrame){
   if(!port||!ready||disposed)return;
   const body=value.header.body,header=body&&typeof body==='object'&&!Array.isArray(body)?(body as Record<string,unknown>).frame:undefined;
   const checked=validateImageFrame(header,value.payload);if(!checked.ok){fault(checked.message);queued=[];needsKeyframe=true;return;}
   const frame=checked.value,next=identity(frame.header);
   if(current&&!equal(current,next)){queued=[];needsKeyframe=frame.header.baseFrameSeq!==null;current=next;controlFor(next);}
   else current=next;
   if(needsKeyframe&&frame.header.baseFrameSeq!==null)return;
   if(frame.header.baseFrameSeq===null){queued=[];needsKeyframe=false;}
   else if(queued.length>=2){queued=[];needsKeyframe=true;capture();return;}
   queued.push(frame);pump();
  },
  /** Read-only health, useful for tests/diagnostics without exposing pixels. */
  snapshot:()=>({identity:base(),ready,queued:queued.length,inflight:!!inflight,needsKeyframe,capturing}),
  close(){disposed=true;detach();},
 };
}
