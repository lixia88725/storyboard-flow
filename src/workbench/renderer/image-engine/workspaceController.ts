import type { ImageWorkspaceBootstrap, ImageWorkspaceBridge, ImageWorkspaceCommand, ImageWorkspaceEvent, ImageWorkspaceFailure, ImageWorkspaceFrameIdentity, ImageWorkspaceFrameMessage, ImageWorkspaceFramePort, ImageWorkspaceFrameReply, ImageWorkspaceOwner, ImageWorkspaceSnapshot } from '../../../platform/contracts/imageWorkspace';
import { createImageFrameStore, type FrameView } from '../../../drawing/renderer/image-engine/frames';
import { createImageInputCapture } from '../../../drawing/renderer/image-engine/capture';

const sameOwner=(a:ImageWorkspaceOwner,b:ImageWorkspaceOwner)=>a.sessionId===b.sessionId&&a.incarnation===b.incarnation&&a.workspaceEpoch===b.workspaceEpoch;
const sameStream=(a:ImageWorkspaceFrameIdentity,b:ImageWorkspaceFrameIdentity)=>sameOwner(a.owner,b.owner)&&a.nonce===b.nonce&&a.streamGeneration===b.streamGeneration;

/** Renderer orchestration, not a second Session. Main snapshots are read-only;
 * commands never install speculative project edits here. Frame subscriptions
 * bypass React state, so each pointer batch does not redraw the whole toolbar. */
export function createImageWorkspaceController(bridge:ImageWorkspaceBridge,initial:ImageWorkspaceBootstrap){
 if(!sameOwner(initial.snapshot.owner,initial.frames.owner))throw Error('Bootstrap frame owner mismatch');
 const owner={...initial.snapshot.owner};let snapshot=initial.snapshot,stream=initial.frames;
 // Immutable thumbnail IDs are scoped to this owner. Keep a bounded renderer
 // copy so remounting a board never needs another IPC round trip to show it.
 type Thumbnail=Awaited<ReturnType<ImageWorkspaceBridge['thumbnail']>>;
 const thumbnails=new Map<string,Thumbnail>(),thumbnailLoads=new Map<string,Promise<Thumbnail>>();
 let thumbnailBytes=0;
 const cachedThumbnail=(id:string)=>{const value=thumbnails.get(id);if(value){thumbnails.delete(id);thumbnails.set(id,value);}return value;};
 const thumbnail=(id:string):Promise<Thumbnail>=>{
  const cached=cachedThumbnail(id);if(cached)return Promise.resolve(cached);
  const pending=thumbnailLoads.get(id);if(pending)return pending;
  const load=bridge.thumbnail(owner,id).then(value=>{
   if(!Number.isSafeInteger(value.width)||!Number.isSafeInteger(value.height)||value.width<1||value.height<1||value.width>512||value.height>512||!(value.rgba instanceof Uint8Array)||value.rgba.byteLength!==value.width*value.height*4)throw Error('Invalid thumbnail');
   if(!disposed){thumbnails.set(id,value);thumbnailBytes+=value.rgba.byteLength;
    while(thumbnailBytes>32*1024*1024||thumbnails.size>128){const key=thumbnails.keys().next().value!;thumbnailBytes-=thumbnails.get(key)!.rgba.byteLength;thumbnails.delete(key);}}
   return value;
  }).finally(()=>thumbnailLoads.delete(id));
  thumbnailLoads.set(id,load);return load;
 };

 let port:MessagePort|undefined,disposed=false,ready=false;
 let fault:ImageWorkspaceFailure|undefined;
 let displayOverride:Extract<ImageWorkspaceEvent,{kind:'display'}>|undefined;
 let projected=snapshot;
 const projectDisplay=()=>{const d=displayOverride,image=d?snapshot.images[d.imageId]:undefined;projected=d&&image?{...snapshot,images:{...snapshot.images,[d.imageId]:{...image,displayIdentity:d.displayIdentity,displayNative:d.displayNative,displayDocumentId:d.displayIdentity?.documentId??null}}}:snapshot;};
 const listeners=new Set<()=>void>(),eventListeners=new Set<(event:ImageWorkspaceEvent)=>void>();
 const frames=createImageFrameStore({sessionId:owner.sessionId,incarnation:owner.incarnation,documentId:'preparing',workerEpoch:0,epoch:0});
 const notify=()=>{for(const listener of listeners)try{listener();}catch{/* Presentation observers only. */}};
 const setFault=(error:ImageWorkspaceFailure)=>{fault=error;notify();};
 const displayIdentity=(state:ImageWorkspaceSnapshot)=>state.context.imageId?state.images[state.context.imageId]?.displayIdentity??null:null;
 const sameDisplay=(a:ReturnType<typeof displayIdentity>,b:ReturnType<typeof displayIdentity>)=>a===null||b===null?a===b:a.sessionId===b.sessionId&&a.incarnation===b.incarnation&&a.documentId===b.documentId&&a.workerEpoch===b.workerEpoch&&a.epoch===b.epoch;
 const displayListeners=new Set<(view:FrameView)=>void>();
 const displayView=():FrameView=>{const view=frames.view();return sameDisplay(view.identity,displayIdentity(projected))?view:{...view,header:null,needsKeyframe:true,damage:[],readRegion:()=>null};};
 const displayNotify=()=>{const view=displayView();for(const listener of displayListeners)try{listener(view);}catch{/* Observer only. */}};
 frames.subscribe(displayNotify);
 const install=(next:ImageWorkspaceSnapshot)=>{
  if(disposed||!sameOwner(owner,next.owner)||next.stateSeq<=snapshot.stateSeq)return;
  const before=displayIdentity(projected);
  snapshot=next;if(displayOverride&&displayOverride.stateSeq<=next.stateSeq)displayOverride=undefined;projectDisplay();
  if(!sameDisplay(before,displayIdentity(projected)))displayNotify();syncInputPause();capture.wake();notify();
 };
 let activation:{shotId:string;work:Promise<import('../../../platform/contracts/imageWorkspace').ImageWorkspaceOutcome>}|undefined;
 async function request(command:ImageWorkspaceCommand){
  if(disposed)throw Error('Workspace controller is disposed');
  if(command.kind==='activateShot'&&activation?.shotId===command.shotId)return activation.work;
  const work=requestTracked(command).result;
  if(command.kind==='activateShot'){
   const item={shotId:command.shotId,work};activation=item;
   void work.finally(()=>{if(activation===item)activation=undefined;}).catch(()=>{});
  }
  return work;
 }
 function requestTracked(command:ImageWorkspaceCommand){
  if(disposed)throw Error('Workspace controller is disposed');
  const requestId=`ui-${crypto.randomUUID()}`,captured=structuredClone(command),contextToken=snapshot.context.token,priorFault=fault;
  const result=Promise.resolve().then(()=>bridge.request({owner,requestId,command:captured,...(captured.kind==='activateShot'?{contextToken}:{})})).then(outcome=>{
   if('snapshot' in outcome)install(outcome.snapshot);
   if(outcome.kind==='rejected')setFault(outcome.error);
   // Only a confirmed recovery acknowledges the previously displayed failure.
   // An unrelated successful edit, or a new fault arriving meanwhile, cannot.
   else if(captured.kind==='recover'&&(outcome.kind==='recovered'||outcome.kind==='settled')&&'snapshot' in outcome&&outcome.snapshot.session.phase==='active'&&fault===priorFault){fault=undefined;notify();}
   return outcome;
  });
  return {requestId,result};
 }
 const capture=createImageInputCapture({
  input:(value,trace)=>bridge.input(owner,value,trace),
  async resolveTarget(shotId){
   let context=snapshot.context;
   if(context.shotId!==shotId||context.layerId===null||context.generation===null){
    const result=await request({kind:'activateShot',shotId});
    if('snapshot' in result)install(result.snapshot);
    if(result.kind==='rejected')return{ok:false,error:result.error};
    context=snapshot.context;
   }
   if(context.shotId!==shotId||context.layerId===null||context.generation===null)return{ok:false,error:{code:'busy',message:'正在准备落笔目标。',effect:'none'}};
   const view=context.imageId?snapshot.images[context.imageId]:undefined;
   return{ok:true,target:{shotId,layerId:context.layerId,expectedContextGeneration:context.generation},width:view?.width,height:view?.height};
  },
  async settled(operationId){
   const outcome=await bridge.waitOperation(owner,operationId);
   if('snapshot' in outcome)install(outcome.snapshot);
   if(outcome.kind==='settled'||outcome.kind==='recovered')return{ok:true};
   const error=outcome.kind==='rejected'?outcome.error:{code:outcome.kind,message:'笔迹尚未完成保存，已保留输入。',effect:'retained' as const};
   setFault(error);return{ok:false,error};
  },changed:notify,
 });
 const pauseReasons=new Set<string>();
 const syncInputPause=()=>capture.pause(pauseReasons.size>0||snapshot.session.phase!=='active');
 const setInputPause=(reason:string,value:boolean)=>{value?pauseReasons.add(reason):pauseReasons.delete(reason);syncInputPause();};
 syncInputPause();
 const conceal=()=>{ready=false;frames.reset(frames.view().identity);};
 const detach=()=>{if(port){port.onmessage=null;port.onmessageerror=null;port.close();port=undefined;}conceal();};
 const attach=(attachment:ImageWorkspaceFramePort)=>{
  if(disposed||!sameStream(stream,attachment)){attachment.port.close();return;}
  detach();const connection=attachment.port;port=connection;
  const reply=(message:ImageWorkspaceFrameReply)=>{if(port===connection&&!disposed)connection.postMessage(message);};
  connection.onmessage=event=>{
   const message=event.data as ImageWorkspaceFrameMessage;
   if(disposed||port!==connection||!message||!message.owner||!sameStream(stream,message)||typeof message.id!=='string')return;
   let result:{ok:true}|{ok:false;code:'wrong-identity'|'needs-keyframe'|'invalid-frame';message:string}|ReturnType<typeof frames.accept>;
   if(message.kind==='initialize'||message.kind==='reset'){
    const identity=message.identity;
    if(!identity||identity.sessionId!==owner.sessionId||identity.incarnation!==owner.incarnation){result={ok:false,code:'wrong-identity',message:'Frame reset belongs to another session'};}
    else {result=frames.reset(identity);ready=result.ok;}
   }else if(message.kind==='frame'){
    result=ready?frames.accept(message.header,message.pixels):{ok:false,code:'needs-keyframe',message:'Initialize the stream before displaying frames'};
   }else return;
   const header=frames.view().header;
   reply({...stream,kind:'ack',id:message.id,result:result.ok?{ok:true}:result,...(result.ok&&message.kind==='frame'&&header?{installed:{frameSeq:header.frameSeq,inputThrough:header.inputThrough}}:{})});
  };
  connection.onmessageerror=()=>{if(port!==connection)return;detach();setFault({code:'frame-transport',message:'画面连接已中断，正在等待重新连接。',effect:'none'});};
  connection.start();reply({...stream,kind:'ready'});
 };
 const unsubscribePort=bridge.onFramePort(attach);
 const unsubscribe=bridge.subscribe(event=>{
  if(disposed)return;
  if(event.kind==='snapshot')install(event.snapshot);
  else if(event.kind==='frameStream'){
   if(!sameOwner(owner,event.identity.owner)||event.identity.streamGeneration<=stream.streamGeneration)return;
   detach();stream=event.identity;void connect();
  }else if(sameOwner(owner,event.owner)){
   if(event.kind==='display'){
    if(!Number.isSafeInteger(event.stateSeq)||event.stateSeq<snapshot.stateSeq||(displayOverride&&event.stateSeq<=displayOverride.stateSeq))return;
    const before=displayIdentity(projected);displayOverride=event;projectDisplay();if(!sameDisplay(before,displayIdentity(projected)))displayNotify();notify();
   }
   if(event.kind==='fault')setFault(event.error);
   if(event.kind==='pipeline')capture.wake();
   for(const listener of eventListeners)try{listener(event);}catch{/* Observer only. */}
  }
 });
 async function connect(){try{await bridge.connectFrames(stream);}catch{setFault({code:'frame-transport',message:'无法连接画布。',effect:'none'});}}
 return {
  thumbnail,cachedThumbnail,
  owner,capabilities:initial.capabilities,capture,setInputPause,
  inputPausedExcept:(reason:string)=>[...pauseReasons].some(item=>item!==reason),
  start:connect,
  snapshot:()=>projected,
  fault:()=>fault,
  subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
  onEvent(listener:(event:ImageWorkspaceEvent)=>void){eventListeners.add(listener);return()=>{eventListeners.delete(listener);};},
  frames:{view:displayView,subscribe(listener:(view:FrameView)=>void){displayListeners.add(listener);return()=>{displayListeners.delete(listener);};}},
  request,requestTracked,
  async resolveCaptured(captureId:string,action:'retainAndDiscard'|'exportAndDiscard'){
   await capture.waitTransportIdle();
   const record=capture.records().find(item=>item.captureId===captureId);
   if(!record||!record.ended||!record.failure)throw Error('请先结束并确认需要处理的笔迹。');
   const original={originOwner:owner,shotId:record.target.shotId,layerId:record.target.layerId,
    stroke:record.stroke,ended:true,capturedThrough:record.stroke.points.length/2,
    coordinateSpace:record.coordinateSpace,...(record.resolvedDimensions?{resolvedDimensions:record.resolvedDimensions}:{})};
   const result=await request({kind:'resolveInput',captureId,action,original});
   if(result.kind==='canceled')return false;
   if(result.kind!=='inputResolved')throw Error(result.kind==='rejected'?result.error.message:'输入尚未安全保留，请勿关闭项目。');
   if(result.captureId!==captureId||!result.original.recordId||result.original.capturedThrough!==original.capturedThrough)
    throw Error('保留回执与整笔输入不一致，仍保留窗口中的笔迹。');
   if(!capture.acknowledgeArchived(captureId,result.original.capturedThrough))throw Error('笔迹仍在变化，暂不能释放。');
   return true;
  },
  settleCaptured(){
   if(capture.state().activeId!==null)return Promise.reject(Error('请先完成当前笔迹。'));
   return new Promise<void>((resolve,reject)=>{
    const check=()=>{const state=capture.state();if(state.blocked){listeners.delete(check);reject(Error('有未处理的笔迹，不能关闭或切换项目。'));}else if(state.pending===0){listeners.delete(check);resolve();}};
    listeners.add(check);check();
   });
  },
  async refreshSnapshot(){const next=await bridge.bootstrap();if(!sameOwner(owner,next.snapshot.owner))throw Error('项目归属已变化，不能恢复旧窗口输入。');install(next.snapshot);},
  /** Call only after Main certifies close; accepted volatile inputs prevent
   * disposal even if a surface has already unmounted. */
  dispose(){if(!capture.dispose())return false;disposed=true;thumbnails.clear();thumbnailBytes=0;unsubscribe();unsubscribePort();detach();frames.dispose();displayListeners.clear();listeners.clear();eventListeners.clear();return true;},
 };
}
export type ImageWorkspaceController=ReturnType<typeof createImageWorkspaceController>;
