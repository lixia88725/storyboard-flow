import { validImageEngineEdit, validImageEnginePreviewStamp, type ImageEngineEdit, type ImageEnginePreviewStamp } from '../../../platform/contracts/imageEngine';
import type { NativeImageRef } from '../../../platform/contracts/imageProject';
import type { ImageWorkspaceCapabilities, ImageWorkspaceCommand, ImageWorkspaceFailure, ImageWorkspaceImageView, ImageWorkspaceOutcome, ImageWorkspaceOwner, ImageWorkspaceSnapshot } from '../../../platform/contracts/imageWorkspace';
import type { NativeOpacityChange, NativeOpacityEvent, NativeLayerNameDraftEvent } from './nativeLayerPanelModel';

/** Structural subset of the real ImageWorkspaceController. This port carries
 * Main-owned capabilities and requests; it never creates a writable Session. */
export type NativeLayerPanelController = {
  readonly owner: ImageWorkspaceOwner;
  readonly capabilities: ImageWorkspaceCapabilities;
  snapshot(): ImageWorkspaceSnapshot;
  request(command: ImageWorkspaceCommand): Promise<ImageWorkspaceOutcome>;
  subscribe(listener: () => void): () => void;
  setInputPause?(reason:string,value:boolean):void;
  inputPausedExcept?(reason:string):boolean;
  capture: { state(): { activeId: number | null; pending: number; blocked: boolean; paused: boolean } };
};
export type LayerPanelTarget = {
  readonly owner: ImageWorkspaceOwner;
  readonly shotId: string;
  readonly imageId: string;
  readonly generation: number;
  readonly native: NativeImageRef;
};
export type NativeLayerPreviewRequest = {
  target: LayerPanelTarget; previewId: string; fromSeq: number;
  edit: Extract<ImageEngineEdit, {kind:'setLayerOpacities'}>;
};
/** Adapter to the typed workspace preview protocol. No native connection or raw
 * JSON is available here; unavailable preview capability disables row opacity. */
export type NativeLayerPreviewPort = {
  available(): boolean;
  preview(request: NativeLayerPreviewRequest): Promise<{stamp:ImageEnginePreviewStamp}>;
  cancel(request: {target:LayerPanelTarget;stamp:ImageEnginePreviewStamp}): Promise<void>;
};
export type NativeLayerHostFailure = ImageWorkspaceFailure & { readonly input: unknown };
export type NativeLayerHostState = {
  readonly revision: number;
  readonly phase: 'idle'|'selecting'|'editing'|'previewing'|'preview'|'committing'|'canceling'|'failed';
  readonly target?: LayerPanelTarget;
  readonly previewId?: string;
  readonly changes?: readonly NativeOpacityChange[];
  readonly stamp?: ImageEnginePreviewStamp;
  readonly failure?: NativeLayerHostFailure;
  readonly pendingOperationId?:string|null;
  readonly attemptedSeq?:number;
  readonly resetToken?:number;
  readonly nameDrafts?:readonly {target:LayerPanelTarget;layerId:string;name:string;composing:boolean;version:number}[];
};
const sameOwner=(a:ImageWorkspaceOwner,b:ImageWorkspaceOwner)=>a.sessionId===b.sessionId&&a.incarnation===b.incarnation&&a.workspaceEpoch===b.workspaceEpoch;
export const sameLayerNative=(a:NativeImageRef|null|undefined,b:NativeImageRef|null|undefined)=>!!a&&!!b&&a.storeId===b.storeId&&a.documentId===b.documentId&&a.versionId===b.versionId&&a.manifestSha256===b.manifestSha256&&a.width===b.width&&a.height===b.height;
class LayerHostError extends Error {
  constructor(readonly failure:ImageWorkspaceFailure,readonly pendingOperationId?:string){super(failure.message);}
}
const denied=(message:string)=>new LayerHostError({code:'layer-target',message,effect:'none'});
const failureOf=(error:unknown):ImageWorkspaceFailure=>error instanceof LayerHostError?error.failure:{code:'layer-transport',message:error instanceof Error?error.message:String(error),effect:'unknown'};
const clone=<T,>(value:T):T=>structuredClone(value);
const freeze=<T,>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(key=>[key,canonical((v as Record<string,unknown>)[key])])):v;
const sameEdit=(a:ImageEngineEdit,b:unknown)=>validImageEngineEdit(b)&&JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const outcomeFailure=(result:ImageWorkspaceOutcome)=>new LayerHostError(result.kind==='rejected'?result.error:{code:'preview-outcome',message:'预览结果尚未确认，已保留输入。',effect:'unknown'});
export function workspaceLayerPreviewPort(controller:NativeLayerPanelController):NativeLayerPreviewPort{
  const displayMatches=(identity:{sessionId:string;incarnation:string;documentId:string},target:LayerPanelTarget)=>identity.sessionId===target.owner.sessionId&&identity.incarnation===target.owner.incarnation&&identity.documentId===target.native.documentId;
  return{
    available:()=>['previewImageEdit','cancelImagePreview'].every(kind=>controller.capabilities.commands.some(command=>command===kind))&&controller.capabilities.imageEdits.includes('setLayerOpacities'),
    async preview({target,previewId,fromSeq,edit}){
      const result=await controller.request({kind:'previewImageEdit',shotId:target.shotId,expectedNative:target.native,expectedContextGeneration:target.generation,previewId,fromSeq,edit});
      if(result.kind!=='previewed')throw outcomeFailure(result);
      if(!displayMatches(result.displayIdentity,target)||result.displayIdentity.workerEpoch!==result.stamp.workerEpoch||result.displayIdentity.epoch!==result.stamp.epoch)throw new LayerHostError({code:'preview-display',message:'预览显示确认与固定目标不一致。',effect:'unknown'});
      return{stamp:result.stamp};
    },
    async cancel({target,stamp}){
      const result=await controller.request({kind:'cancelImagePreview',shotId:target.shotId,expectedNative:target.native,expectedContextGeneration:target.generation,stamp});
      if(result.kind!=='previewCanceled')throw outcomeFailure(result);
      if(!displayMatches(result.displayIdentity,target))throw new LayerHostError({code:'preview-display',message:'预览回滚确认与固定目标不一致。',effect:'unknown'});
    },
  };
}

export function captureLayerPanelTarget(controller:NativeLayerPanelController,image:ImageWorkspaceImageView):LayerPanelTarget {
  const snapshot=controller.snapshot(),context=snapshot.context;
  if(!sameOwner(controller.owner,snapshot.owner)||snapshot.session.phase!=='active')throw denied('项目尚未处于可编辑状态。');
  const current=snapshot.images[image.imageId];
  if(!context.shotId||context.imageId!==image.imageId||context.generation===null||image.contextGeneration!==context.generation||current?.contextGeneration!==context.generation)throw denied('图层面板与当前画布目标不同，请等待画面准备。');
  if(!snapshot.session.project.shots.some(s=>s.id===context.shotId&&s.imageId===image.imageId))throw denied('图层目标不属于当前活动故事板。');
  if(!image.displayNative||!sameLayerNative(image.displayNative,current.displayNative))throw denied('图像版本已变化，请重新操作。');
  return clone({owner:controller.owner,shotId:context.shotId,imageId:image.imageId,generation:context.generation,native:image.displayNative});
}
const assertCurrent=(controller:NativeLayerPanelController,target:LayerPanelTarget)=>{
  const snapshot=controller.snapshot(),context=snapshot.context;
  if(!sameOwner(controller.owner,target.owner)||!sameOwner(snapshot.owner,target.owner)||snapshot.session.phase!=='active'||context.shotId!==target.shotId||context.imageId!==target.imageId||context.generation!==target.generation||!sameLayerNative(snapshot.images[target.imageId]?.displayNative,target.native))throw denied('操作开始后的画布身份已变化，已保留原始目标。');
};
const layerCapability=(image:ImageWorkspaceImageView,id:string,cap:'paint'|'properties'|'structure',allowLocked=false)=>{
  const layer=image.layers.find(l=>l.id===id);
  if(!layer)throw denied('图层已不存在。');
  if(!layer.capabilities[cap])throw denied(layer.readOnlyReason??'此图层不支持这项操作。');
  if(layer.locked&&!allowLocked)throw denied('图层已锁定，请先解锁。');
};
export function validateLayerPanelEdit(image:ImageWorkspaceImageView,edit:ImageEngineEdit):void {
  if(!validImageEngineEdit(edit))throw denied('图层编辑输入不合法。');
  switch(edit.kind){
    case 'newLayer':return;
    case 'setLayer':layerCapability(image,edit.layerId,'properties',Object.keys(edit.patch).every(key=>key==='visible'||key==='locked'));return;
    case 'setLayerOpacities':for(const c of edit.changes){layerCapability(image,c.layerId,'properties');if(image.layers.find(l=>l.id===c.layerId)?.opacity!==c.before)throw denied('透明度基线已变化，请重新操作。');}return;
    case 'removeLayer':layerCapability(image,edit.layerId,'structure');return;
    case 'moveLayers':for(const id of [...edit.layerIds,edit.targetLayerId])layerCapability(image,id,'structure');return;
    case 'merge':for(const id of edit.layerIds)layerCapability(image,id,'structure');return;
    case 'mergeVisible':for(const layer of image.layers.filter(l=>l.visible))layerCapability(image,layer.id,'structure');return;
    case 'clear':case 'blur':case 'fill':case 'transform':layerCapability(image,edit.layerId,'paint');return;
  }
}

/** One owner per controller outlives mounted panels. It retains the exact edit,
 * fixed native base, last confirmed preview and unknown effects until settled. */
export function createNativeLayerPanelOwner(controller:NativeLayerPanelController,initialPreviewPort?:NativeLayerPreviewPort){
  let previewPort=initialPreviewPort;
  let state:NativeLayerHostState={revision:0,phase:'idle'};
  let inFlight:Promise<unknown>|undefined;
  let retainedEdit:ImageEngineEdit|undefined;
  let previewImage:ImageWorkspaceImageView|undefined;
  let retainedImage:ImageWorkspaceImageView|undefined;
  const names=new Map<string,{target:LayerPanelTarget;image:ImageWorkspaceImageView;layerId:string;name:string;composing:boolean;version:number}>();let nameSerial=0;
  const listeners=new Set<()=>void>();
  const publish=(next:Omit<NativeLayerHostState,'revision'>)=>{state=freeze({...clone(next),nameDrafts:[...names.values()].map(({image:_image,...draft})=>clone(draft)),revision:state.revision+1});if(controller.inputPausedExcept)controller.setInputPause?.('layer',state.phase!=='idle');for(const listener of listeners)try{listener();}catch{/* Presentation observers only. */}};
  const clear=(resetPanel=false)=>{const resetToken=(state.resetToken??0)+(resetPanel?1:0);retainedEdit=undefined;previewImage=undefined;retainedImage=undefined;publish({phase:'idle',resetToken});};
  const safeStart=()=>{
    const capture=controller.capture.state();
    if(state.phase!=='idle'||inFlight||capture.activeId!==null||capture.pending||capture.blocked||capture.paused)throw denied('请先完成画布输入或之前的图层操作。');
  };
  const ackName=(target:LayerPanelTarget,edit:ImageEngineEdit)=>{if(edit.kind!=='setLayer'||edit.patch.name===undefined)return;const key=JSON.stringify([target.imageId,edit.layerId]),draft=names.get(key);if(draft&&!draft.composing&&draft.name===edit.patch.name&&sameLayerNative(draft.target.native,target.native)&&draft.target.generation===target.generation)names.delete(key);};
  const advanceNames=(target:LayerPanelTarget,next:ImageWorkspaceSnapshot)=>{
    const image=next.images[target.imageId],context=next.context;
    if(!sameOwner(target.owner,next.owner)||context.shotId!==target.shotId||context.imageId!==target.imageId||context.generation===null||!image?.displayNative)return;
    for(const [key,draft] of names)if(draft.target.generation===target.generation&&sameLayerNative(draft.target.native,target.native))names.set(key,{...draft,image:clone(image),target:{...draft.target,generation:context.generation,native:clone(image.displayNative)}});
  };
  const commandAllowed=(kind:ImageWorkspaceCommand['kind'])=>{if(!controller.capabilities.commands.includes(kind))throw denied('当前引擎未提供这项图层操作。');};
  const editAllowed=(edit:ImageEngineEdit)=>{commandAllowed('imageEdit');if(!controller.capabilities.imageEdits.includes(edit.kind))throw denied('当前引擎未提供这项图层编辑。');};
  const outcome=async(command:ImageWorkspaceCommand)=>{
    const result=await controller.request(command);
    if(result.kind==='settled'||result.kind==='recovered')return result.snapshot;
    if(result.kind==='rejected')throw new LayerHostError(result.error);
    throw new LayerHostError({code:result.kind,message:'图层操作尚未完成，已保留输入和目标。',effect:'retained'},result.operationId);
  };
  const run=async<T,>(work:()=>Promise<T>):Promise<T>=>{
    if(inFlight)throw denied('图层操作正在结算。');
    const promise=Promise.resolve().then(work);inFlight=promise;
    try{return await promise;}finally{if(inFlight===promise)inFlight=undefined;}
  };
  const retain=(error:unknown,input:unknown)=>{
    const failure={...failureOf(error),input:clone(input)};
    publish({...state,phase:'failed',failure,...(error instanceof LayerHostError&&error.pendingOperationId?{pendingOperationId:error.pendingOperationId}:{})});
    throw new LayerHostError(failure);
  };
  const owner={
    snapshot:()=>state,
    subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    busy:()=>state.phase!=='idle'||names.size>0,
    nameDraft(image:ImageWorkspaceImageView,event:NativeLayerNameDraftEvent){
      const key=JSON.stringify([image.imageId,event.layerId]),previous=names.get(key);
      if(event.action==='discard'){names.delete(key);publish({...state});return;}
      if(event.action==='confirmed'){if(previous&&!previous.composing&&previous.name===event.name)names.delete(key);publish({...state});return;}
      let target=previous?.target;
      if(!target){
        // A late input event keeps its displayed identity even if Main has
        // already changed context. flush will reject instead of rebasing it.
        const shot=controller.snapshot().session.project.shots.find(s=>s.imageId===image.imageId);
        if(!shot||!image.displayNative||image.contextGeneration===null)throw denied('名称草稿缺少原始图层身份。');
        target=clone({owner:controller.owner,shotId:shot.id,imageId:image.imageId,generation:image.contextGeneration,native:image.displayNative});
      }
      if(!event.composing&&event.name===image.layers.find(l=>l.id===event.layerId)?.name&&state.phase==='idle'&&!inFlight)names.delete(key);
      else names.set(key,{target,image:clone(image),layerId:event.layerId,name:event.name,composing:event.composing,version:++nameSerial});
      publish({...state});
    },
    configurePreview(port:NativeLayerPreviewPort){if(previewPort===port)return;if(state.phase!=='idle')throw denied('仍有原预览连接的未结算手势。');previewPort=port;},
    previewAvailable:()=>!!previewPort?.available(),
    async select(image:ImageWorkspaceImageView,layerId:string){
      safeStart();commandAllowed('selectLayer');const target=captureLayerPanelTarget(controller,image);
      if(!image.layers.some(l=>l.id===layerId))throw denied('图层已不存在。');
      publish({phase:'selecting',target});
      return run(async()=>{try{assertCurrent(controller,target);const next=await outcome({kind:'selectLayer',shotId:target.shotId,layerId,expectedContextGeneration:target.generation});advanceNames(target,next);clear();}catch(error){if(failureOf(error).effect==='none'){publish({phase:'idle',failure:{...failureOf(error),input:{layerId,target}}});throw error;}return retain(error,{layerId,target});}});
    },
    async edit(image:ImageWorkspaceImageView,edit:ImageEngineEdit){
      safeStart();const target=captureLayerPanelTarget(controller,image);retainedEdit=clone(edit);retainedImage=clone(image);
      publish({phase:'editing',target});
      return run(async()=>{try{editAllowed(edit);validateLayerPanelEdit(image,edit);assertCurrent(controller,target);const next=await outcome({kind:'imageEdit',shotId:target.shotId,expectedContextGeneration:target.generation,expectedNative:target.native,edit:retainedEdit!});ackName(target,edit);if(edit.kind==='setLayer'&&Object.keys(edit.patch).every(key=>key==='name'))advanceNames(target,next);clear();}catch(error){return retain(error,{target,edit});}});
    },
    async opacity(image:ImageWorkspaceImageView,event:NativeOpacityEvent):Promise<void>{
      if(!previewPort?.available())throw denied('当前引擎尚未提供透明度实时预览。');
      const port=previewPort;
      if(event.phase==='preview'){
        const edit={kind:'setLayerOpacities' as const,changes:clone(event.changes)};
        if(state.phase==='idle'){
          safeStart();
          const target=captureLayerPanelTarget(controller,image);previewImage=clone(image);retainedEdit=edit;
          publish({phase:'preview',target,previewId:crypto.randomUUID(),changes:edit.changes});
        }
        if(!state.target||!state.previewId||!previewImage||!['preview','failed'].includes(state.phase))throw denied('透明度手势尚未准备好。');
        if(state.failure&&state.failure.effect!=='none')throw new LayerHostError(state.failure);
        if(!state.changes||event.changes.length!==state.changes.length||event.changes.some((c,i)=>c.layerId!==state.changes![i].layerId||c.before!==state.changes![i].before))throw denied('透明度手势的图层或基线已变化。');
        const target=state.target,previewId=state.previewId,fromSeq=(state.stamp?.throughSeq??0)+1;
        retainedEdit=edit;publish({...state,phase:'previewing',changes:edit.changes,attemptedSeq:fromSeq,failure:undefined});
        return run(async()=>{try{
          editAllowed(edit);validateLayerPanelEdit(previewImage!,edit);assertCurrent(controller,target);const reply=await port.preview({target,previewId,fromSeq,edit});const stamp=reply.stamp;
          if(!validImageEnginePreviewStamp(stamp)||stamp.previewId!==previewId||stamp.throughSeq!==fromSeq||stamp.baseVersion!==target.native.versionId||stamp.documentId!==target.native.documentId||stamp.sourceContextGeneration!==target.generation)throw new LayerHostError({code:'preview-receipt',message:'透明度预览确认与原始目标不一致，已保留输入。',effect:'unknown'});
          publish({...state,phase:'preview',stamp:clone(stamp),failure:undefined});
        }catch(error){return retain(error,{target,previewId,fromSeq,edit});}});
      }
      if(!state.target||!state.previewId||!state.changes||!retainedEdit)throw denied('没有需要结算的透明度手势。');
      if(state.failure&&state.failure.effect!=='none')throw new LayerHostError(state.failure);
      if(event.phase==='commit'&&(event.changes.length!==state.changes.length||event.changes.some((c,i)=>c.layerId!==state.changes![i].layerId||c.before!==state.changes![i].before||c.opacity!==state.changes![i].opacity)))throw denied('透明度结束输入与保留的预览不同。');
      const target=state.target,stamp=state.stamp,edit=clone(retainedEdit);
      if(!stamp){if(event.phase==='cancel'){clear();return;}throw denied('尚未取得透明度预览确认。');}
      publish({...state,phase:event.phase==='commit'?'committing':'canceling',failure:undefined});
      return run(async()=>{try{
        if(event.phase==='commit'){assertCurrent(controller,target);await outcome({kind:'imageEdit',shotId:target.shotId,expectedContextGeneration:target.generation,expectedNative:target.native,edit,preview:stamp});}
        else await port.cancel({target,stamp});
        clear();
      }catch(error){return retain(error,{target,stamp,edit,phase:event.phase});}});
    },
    /** Teardown never releases this owner. An unknown effect remains a visible
     * close obligation even when no panel is mounted. */
    async detach(){
      if(inFlight)try{await inFlight;}catch{/* The retained failure below owns it. */}
      if(state.previewId&&state.changes&&previewImage&&!state.failure)await owner.opacity(previewImage,{phase:'cancel',changes:state.changes});
    },
    async retryKnownNoEffect(){
      if(state.phase!=='failed'||state.failure?.effect!=='none'||state.previewId||!state.target||!retainedEdit||!retainedImage)throw denied('此操作不能安全重试。');
      const target=state.target,edit=clone(retainedEdit);editAllowed(edit);validateLayerPanelEdit(retainedImage,edit);
      publish({...state,phase:'editing',failure:undefined});
      return run(async()=>{try{assertCurrent(controller,target);await outcome({kind:'imageEdit',shotId:target.shotId,expectedContextGeneration:target.generation,expectedNative:target.native,edit});ackName(target,edit);clear(true);}catch(error){return retain(error,{target,edit});}});
    },
    discardKnownNoEffect(){if(state.phase!=='failed'||state.failure?.effect!=='none'||state.previewId)throw denied('原生结果尚未确认，不能放弃义务。');if(state.target&&retainedEdit)ackName(state.target,retainedEdit);clear(true);},
    async retryOpacityKnownNoEffect(){
      if(state.failure?.effect!=='none'||!state.previewId||!previewImage||!state.changes)throw denied('此透明度操作不能安全重试。');
      const image=previewImage,changes=clone(state.changes),resetToken=(state.resetToken??0)+1;
      await owner.opacity(image,{phase:'preview',changes});await owner.opacity(image,{phase:'commit',changes});publish({...state,resetToken});
    },
    async cancelRetainedOpacity(){
      if(!previewImage||!state.changes)throw denied('没有保留的透明度手势。');
      const resetToken=(state.resetToken??0)+1;await owner.opacity(previewImage,{phase:'cancel',changes:state.changes});publish({...state,resetToken});
    },
    async inspectPreview(){
      if(!state.previewId||!state.target||!retainedEdit)throw denied('没有保留的预览义务。');
      commandAllowed('inspectImagePreview');const previewId=state.previewId,target=state.target,edit=clone(retainedEdit);
      return run(async()=>{
        const result=await controller.request({kind:'inspectImagePreview',previewId});
        if(result.kind!=='previewStatus'||result.previewId!==previewId)throw outcomeFailure(result);
        const status=result.status;
        if(status.state==='resolved'){
          if(!status.recordId?.trim()||!['committed','notCommitted'].includes(status.decision)||!sameEdit(edit,status.edit)||!sameLayerNative(target.native,status.expectedNative)||target.generation!==status.expectedContextGeneration)throw new LayerHostError({code:'preview-resolution',message:'预览结算记录与保留输入不一致，不能释放义务。',effect:'unknown'});
          clear(true);return true;
        }
        if(status.state==='active'){
          const stamp=status.stamp;
          if(!validImageEnginePreviewStamp(stamp)||stamp.previewId!==previewId||stamp.documentId!==target.native.documentId||stamp.baseVersion!==target.native.versionId||stamp.sourceContextGeneration!==target.generation||stamp.throughSeq!==state.attemptedSeq)throw denied('活动预览与保留的原始输入不一致。');
          // Active is evidence to retain/cancel through Main, never a durable
          // release receipt or permission to blindly replay an unknown edit.
          publish({...state,stamp,pendingOperationId:null});return false;
        }
        publish({...state,pendingOperationId:status.pendingOperationId,...(status.stamp?{stamp:status.stamp}:{})});return false;
      });
    },
    async resolvePreview(action:'retainAndDiscard'|'exportAndDiscard'){
      if(!state.previewId||!state.target||!retainedEdit)throw denied('没有保留的预览义务。');
      commandAllowed('resolveImagePreview');const previewId=state.previewId,target=state.target,edit=clone(retainedEdit);
      return run(async()=>{
        const result=await controller.request({kind:'resolveImagePreview',previewId,action,original:{shotId:target.shotId,expectedNative:target.native,expectedContextGeneration:target.generation,edit}});
        if(result.kind!=='previewStatus'||result.previewId!==previewId||result.status.state!=='resolved')throw outcomeFailure(result);
        const status=result.status;
        if(!status.recordId?.trim()||!['committed','notCommitted'].includes(status.decision)||!sameEdit(edit,status.edit)||!sameLayerNative(target.native,status.expectedNative)||target.generation!==status.expectedContextGeneration)throw new LayerHostError({code:'preview-resolution',message:'原文保管结算记录与保留输入不一致，不能释放义务。',effect:'unknown'});
        clear(true);
      });
    },
    async flush(){
      if(inFlight)try{await inFlight;}catch{/* Check retained state after settling. */}
      if(state.phase!=='idle')throw Error(state.failure?.message??'仍有未结束的图层手势。');
      if([...names.values()].some(draft=>draft.composing))throw Error('请先完成图层名称的输入法组字。');
      for(const key of [...names.keys()]){
        const draft=names.get(key);if(!draft)continue;
        const edit:ImageEngineEdit={kind:'setLayer',layerId:draft.layerId,patch:{name:draft.name}},target=draft.target;
        retainedImage=draft.image;retainedEdit=edit;publish({phase:'editing',target,resetToken:state.resetToken});
        // This settles already accepted text while transition/output admission
        // is paused. It intentionally does not call the new-user-action gate.
        await run(async()=>{try{editAllowed(edit);validateLayerPanelEdit(draft.image,edit);assertCurrent(controller,target);const next=await outcome({kind:'imageEdit',shotId:target.shotId,expectedContextGeneration:target.generation,expectedNative:target.native,edit});if(names.get(key)?.version===draft.version)names.delete(key);advanceNames(target,next);clear(true);}catch(error){return retain(error,{target,edit});}});
      }
      if(names.size)throw Error('仍有更新的图层名称待确认。');
    },
  };
  return owner;
}
export type NativeLayerPanelOwner=ReturnType<typeof createNativeLayerPanelOwner>;
const owners=new WeakMap<NativeLayerPanelController,NativeLayerPanelOwner>();
export function layerPanelOwnerFor(controller:NativeLayerPanelController,preview?:NativeLayerPreviewPort){
  let owner=owners.get(controller);
  if(!owner){owner=createNativeLayerPanelOwner(controller,preview??workspaceLayerPreviewPort(controller));owners.set(controller,owner);}
  else if(preview)owner.configurePreview(preview);
  return owner;
}
