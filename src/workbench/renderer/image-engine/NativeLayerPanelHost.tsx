import {useCallback,useEffect,useMemo,useSyncExternalStore} from 'react';
import type {ImageEngineEdit} from '../../../platform/contracts/imageEngine';
import type {ImageWorkspaceImageView} from '../../../platform/contracts/imageWorkspace';
import {NativeLayerPanel} from './NativeLayerPanel';
import type {NativeOpacityEvent} from './nativeLayerPanelModel';
import {layerPanelOwnerFor,sameLayerNative,type NativeLayerPanelController,type NativeLayerPreviewPort} from './nativeLayerPanelHostModel';

export type NativeLayerPanelHostProps={
  controller:NativeLayerPanelController;
  image?:ImageWorkspaceImageView;
  /** Optional typed adapter override. The default uses the real workspace
   * previewImageEdit/cancelImagePreview commands and Main's capability list. */
  preview?:NativeLayerPreviewPort;
  canBeginGesture?:()=>boolean;
  disabledReason?:string;
  isOpen?:boolean;
};

/** This component may unmount; its controller-scoped owner may not. The shell
 * combines layerPanelOwnerFor(controller).busy()/flush() with its other drafts. */
export function NativeLayerPanelHost({controller,image,preview,canBeginGesture,disabledReason,isOpen=true}:NativeLayerPanelHostProps){
  const owner=useMemo(()=>layerPanelOwnerFor(controller,preview),[controller,preview]);
  const host=useSyncExternalStore(owner.subscribe,owner.snapshot);
  const snapshot=useSyncExternalStore(controller.subscribe,controller.snapshot);
  useSyncExternalStore(controller.subscribe,()=>{
    const capture=controller.capture.state();
    return `${capture.activeId}:${capture.pending}:${capture.blocked}:${capture.paused}:${controller.inputPausedExcept?.('layer')??capture.paused}`;
  });
  const capture=controller.capture.state(),context=snapshot.context;
  const externallyPaused=controller.inputPausedExcept?controller.inputPausedExcept('layer'):capture.paused;
  const contextReady=!!image&&context.imageId===image.imageId&&context.generation!==null&&image.contextGeneration===context.generation&&sameLayerNative(image.displayNative,snapshot.images[image.imageId]?.displayNative);
  const gateReason=disabledReason??(snapshot.session.phase!=='active'?'项目尚未处于可编辑状态。':externallyPaused?'项目正在保存或切换。':capture.activeId!==null||capture.pending||capture.blocked?'请先完成画布输入。':!contextReady?'正在准备当前图层目标。':undefined);
  const allowedEdits=controller.capabilities.commands.includes('imageEdit')&&!(host.phase==='failed'&&!host.previewId)?controller.capabilities.imageEdits.filter(kind=>kind!=='setLayerOpacities'||owner.previewAvailable()):[];
  const select=useCallback(async(layerId:string)=>{
    if(!image)throw Error('请先选择故事板。');
    if(canBeginGesture?.()===false)throw Error('请先完成当前编辑。');
    await owner.select(image,layerId);
  },[owner,image,canBeginGesture]);
  const edit=useCallback(async(value:ImageEngineEdit)=>{
    if(!image)throw Error('请先选择故事板。');
    if(canBeginGesture?.()===false)throw Error('请先完成当前编辑。');
    await owner.edit(image,value);
  },[owner,image,canBeginGesture]);
  const opacity=useCallback(async(event:NativeOpacityEvent)=>{
    if(!image)throw Error('透明度手势原图像已不可用。');
    await owner.opacity(image,event);
  },[owner,image]);
  const nameDrafts=Object.fromEntries((host.nameDrafts??[]).filter(d=>d.target.imageId===image?.imageId).map(d=>[d.layerId,{name:d.name,composing:d.composing}]));
  useEffect(()=>()=>{void owner.detach().catch(()=>{/* The owner retains the failure and close obligation. */});},[owner]);
  return <div className="native-layer-host" style={{display:'flex',flexDirection:'column',height:'100%',minHeight:0}}>
    <NativeLayerPanel key={host.resetToken??0} image={image} isOpen={isOpen} onSelect={select} onEdit={edit} onOpacityGesture={opacity}
      nameDrafts={nameDrafts} onNameDraftChange={event=>{if(image)owner.nameDraft(image,event);}}
      allowedEdits={allowedEdits} disabledReason={gateReason} canBeginGesture={()=>!gateReason&&!owner.busy()&&canBeginGesture?.()!==false}/>
    {host.failure&&<div role="alert" style={{padding:'.6em',fontSize:'.8em',color:'#ffd0b9',background:'#392922',overflowWrap:'anywhere'}}>
      <p style={{margin:'0 0 .4em'}}>{host.failure.message}</p>
      {host.failure.effect==='none'&&!host.previewId?<>
        <button type="button" onClick={()=>{void owner.retryKnownNoEffect().catch(()=>{});}}>重试保留的图层操作</button>
        <button type="button" onClick={()=>owner.discardKnownNoEffect()}>放弃未提交的图层操作</button>
      </>:host.previewId&&host.failure.effect==='none'?<>
        <button type="button" onClick={()=>{void owner.retryOpacityKnownNoEffect().catch(()=>{});}}>重试透明度提交</button>
        <button type="button" onClick={()=>{void owner.cancelRetainedOpacity().catch(()=>{});}}>回滚透明度预览</button>
      </>:<><p style={{margin:0}}>原生结果尚未确认，输入和原始目标已保留。</p>
        {!host.previewId&&host.requestId&&controller.capabilities.commands.includes('inspectRequest')&&<button type="button" onClick={()=>{void owner.inspectEdit().catch(()=>{});}}>查询这次图层编辑</button>}
        {!host.previewId&&host.requestId&&controller.capabilities.commands.includes('resolveEdit')&&<><button type="button" onClick={()=>{void owner.resolveEdit('retainAndDiscard').catch(()=>{});}}>保管原始输入并结算</button><button type="button" onClick={()=>{void owner.resolveEdit('exportAndDiscard').catch(()=>{});}}>导出原始输入并结算</button></>}
        {host.previewId&&controller.capabilities.commands.includes('inspectImagePreview')&&<button type="button" onClick={()=>{void owner.inspectPreview().catch(()=>{});}}>查询预览结算</button>}
        {host.previewId&&controller.capabilities.commands.includes('resolveImagePreview')&&<><button type="button" onClick={()=>{void owner.resolvePreview('retainAndDiscard').catch(()=>{});}}>保管原始输入并结算</button><button type="button" onClick={()=>{void owner.resolvePreview('exportAndDiscard').catch(()=>{});}}>导出原始输入并结算</button></>}
      </>}
    </div>}
  </div>;
}
