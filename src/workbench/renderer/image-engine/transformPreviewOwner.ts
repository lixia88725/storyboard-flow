import {validImageEnginePreviewStamp,type ImageEngineEdit,type ImageEnginePreviewStamp} from '../../../platform/contracts/imageEngine';
import type {ImageWorkspaceImageView,ImageWorkspaceFailure,ImageWorkspaceOutcome} from '../../../platform/contracts/imageWorkspace';
import {transformSelectionPoints} from '../../../drawing/renderer/selectionTransform';
import {captureLayerPanelTarget,sameLayerNative,validateLayerPanelEdit,type LayerPanelTarget} from './nativeLayerPanelHostModel';
import type {ImageWorkspaceController} from './workspaceController';
type Transform=Extract<ImageEngineEdit,{kind:'transform'}>;
type State={revision:number;active:boolean;failure?:ImageWorkspaceFailure};
const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical((v as Record<string,unknown>)[k])])):v;
const failure=(result:ImageWorkspaceOutcome):ImageWorkspaceFailure=>result.kind==='rejected'?result.error:{code:'transform-unconfirmed',message:'变换结果尚未确认，已保留输入。',effect:'unknown'};

/** Absolute transforms are coalesced against one immutable starting image. A
 * preview changes display only; pointerup emits exactly one durable edit. */
export function createTransformPreviewOwner(c:ImageWorkspaceController){
 let state:State={revision:0,active:false},target:LayerPanelTarget|undefined,previewId='',stamp:ImageEnginePreviewStamp|undefined;
 let desired:Transform|undefined,applied:Transform|undefined,version=0,shown=0,ending=false,canceling=false,running:Promise<void>|undefined;
 const listeners=new Set<()=>void>();
 const publish=(patch:Partial<State>)=>{state={...state,...patch,revision:state.revision+1};c.setInputPause('transform',state.active);for(const listener of listeners)listener();};
 const clear=()=>{target=undefined;desired=undefined;applied=undefined;stamp=undefined;ending=false;canceling=false;version=shown=0;publish({active:false,failure:undefined});};
 const fail=(error:unknown)=>publish({failure:typeof error==='object'&&error!==null&&'effect'in error?error as ImageWorkspaceFailure:{code:'transform-transport',effect:'unknown',message:error instanceof Error?error.message:String(error)}});
 async function pump(){
  if(running||!target||state.failure)return;
  const task=(async()=>{
   try{while(target&&!state.failure){
    const fixed=target;
    if(canceling){
     if(stamp){const result=await c.request({kind:'cancelImagePreview',shotId:fixed.shotId,expectedNative:fixed.native,expectedContextGeneration:fixed.generation,stamp});if(result.kind!=='previewCanceled')throw failure(result);
      if(result.displayIdentity.documentId!==fixed.native.documentId||result.displayIdentity.incarnation!==fixed.owner.incarnation)throw Error('变换取消回执不匹配。');}
     clear();return;
    }
    if(shown<version){
     const next=structuredClone(desired!),nextVersion=version,seq=(stamp?.throughSeq??0)+1;
     const result=await c.request({kind:'previewImageEdit',shotId:fixed.shotId,expectedNative:fixed.native,expectedContextGeneration:fixed.generation,previewId,fromSeq:seq,edit:next});
     if(result.kind!=='previewed')throw failure(result);
     const received=result.stamp;
     if(!validImageEnginePreviewStamp(received)||received.previewId!==previewId||received.throughSeq!==seq||received.baseVersion!==fixed.native.versionId||received.sourceContextGeneration!==fixed.generation||received.documentId!==fixed.native.documentId||result.displayIdentity.sessionId!==fixed.owner.sessionId||result.displayIdentity.incarnation!==fixed.owner.incarnation||result.displayIdentity.documentId!==received.documentId||result.displayIdentity.workerEpoch!==received.workerEpoch||result.displayIdentity.epoch!==received.epoch)throw Error('变换预览回执与原始目标不一致。');
     stamp=received;applied=next;shown=nextVersion;continue;
    }
    if(ending){
     const edit=structuredClone(applied!),result=await c.request({kind:'imageEdit',shotId:fixed.shotId,expectedNative:fixed.native,expectedContextGeneration:fixed.generation,edit,preview:stamp});
     if(result.kind!=='settled'&&result.kind!=='recovered')throw failure(result);
     // The image is committed. Selection is a separate temporary context, so a
     // selection refusal must never turn into retrying the already committed edit.
     const context=result.snapshot.context;
     if(context.shotId===fixed.shotId&&context.generation!==null){await c.request({kind:'selection',shotId:fixed.shotId,expectedContextGeneration:context.generation,selection:transformSelectionPoints(edit.selection,edit.matrix)}).catch(()=>{});}
     clear();return;
    }
    return;
   }}catch(error){fail(error);}
  })();running=task;await task;if(running===task)running=undefined;
  if(target&&!state.failure&&(canceling||ending||shown<version))void pump();
 }
 return{
  snapshot:()=>state,subscribe(listener:()=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},busy:()=>state.active,
  begin(image:ImageWorkspaceImageView,edit:Transform){
   if(state.active||c.capture.state().pending||c.capture.state().paused||!c.capabilities.commands.includes('previewImageEdit')||!c.capabilities.imageEdits.includes('transform'))throw Error('请先完成当前操作，再变换选区。');
   validateLayerPanelEdit(image,edit);target=captureLayerPanelTarget(c,image);previewId=crypto.randomUUID();desired=structuredClone(edit);version=1;shown=0;ending=canceling=false;stamp=undefined;publish({active:true,failure:undefined});void pump();
  },
  update(edit:Transform){if(!target||ending||canceling||state.failure)return; if(edit.layerId!==desired!.layerId||JSON.stringify(edit.selection)!==JSON.stringify(desired!.selection))throw Error('变换起点不可改变。');desired=structuredClone(edit);version++;void pump();},
  finish(){if(!target)return;ending=true;void pump();},
  cancel(){if(!target)return;canceling=true;void pump();},
  async flush(){if(running)await running;if(state.active)throw Error(state.failure?.message??'请先结束当前选区变换。');},
  async resolve(action:'retainAndDiscard'|'exportAndDiscard'){
   if(running)await running;if(!state.failure||!target||!desired)throw Error('没有需要处理的变换。');
   const fixed=target,edit=structuredClone(desired),result=await c.request({kind:'resolveImagePreview',previewId,action,original:{shotId:fixed.shotId,expectedNative:fixed.native,expectedContextGeneration:fixed.generation,edit}});
   if(result.kind==='canceled')return;
   if(result.kind!=='previewStatus'||result.previewId!==previewId||result.status.state!=='resolved')throw failure(result);
   const status=result.status;
   if(!status.recordId||!sameLayerNative(status.expectedNative,fixed.native)||status.expectedContextGeneration!==fixed.generation||JSON.stringify(canonical(status.edit))!==JSON.stringify(canonical(edit)))throw Error('保留的变换输入与结算回执不符。');
   clear();
  },
 };
}
const owners=new WeakMap<ImageWorkspaceController,ReturnType<typeof createTransformPreviewOwner>>();
export function transformPreviewOwnerFor(c:ImageWorkspaceController){let owner=owners.get(c);if(!owner){owner=createTransformPreviewOwner(c);owners.set(c,owner);}return owner;}
