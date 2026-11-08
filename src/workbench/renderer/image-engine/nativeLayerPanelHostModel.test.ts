import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NativeLayerPanel} from './NativeLayerPanel';
import type {ImageEnginePreviewStamp} from '../../../platform/contracts/imageEngine';
import type {ImageWorkspaceCommand,ImageWorkspaceImageView,ImageWorkspaceOutcome,ImageWorkspaceSnapshot} from '../../../platform/contracts/imageWorkspace';
import {captureLayerPanelTarget,createNativeLayerPanelOwner,layerPanelOwnerFor,validateLayerPanelEdit,workspaceLayerPreviewPort,type NativeLayerPanelController,type NativeLayerPreviewPort,type NativeLayerPreviewRequest} from './nativeLayerPanelHostModel';

const ownerId={sessionId:'session',incarnation:'incarnation',workspaceEpoch:1};
const native={storeId:'store',documentId:'10',versionId:'b'.repeat(64),manifestSha256:'a'.repeat(64),width:100,height:100};
const changes=[{layerId:'1',before:1,opacity:.25},{layerId:'2',before:.5,opacity:.2}];
function harness(){
  const image:ImageWorkspaceImageView={imageId:'img',content:{kind:'native',native},availability:'editable',displayDocumentId:'10',displayNative:native,displayIdentity:{sessionId:'session',incarnation:'incarnation',documentId:'10',workerEpoch:1,epoch:2},width:100,height:100,activeLayerId:'1',contextGeneration:7,layers:[
    {id:'1',parentId:null,name:'First',kind:'raster',visible:true,locked:false,opacity:1,blendMode:'normal',editable:true,capabilities:{paint:true,properties:true,structure:true}},
    {id:'2',parentId:null,name:'Second',kind:'group',visible:true,locked:false,opacity:.5,blendMode:'opaque',editable:false,capabilities:{paint:false,properties:true,structure:true}},
  ]};
  let state:ImageWorkspaceSnapshot={owner:ownerId,stateSeq:1,session:{sessionId:'session',incarnation:'incarnation',eventSeq:1,phase:'active',pending:0,undoDepth:0,redoDepth:0,project:{schema:'storyboard-flow.project',version:2,id:'p',name:'P',revision:1,images:{img:{id:'img',content:image.content}},shots:[{id:'shot',imageId:'img',name:'Shot',scriptText:''}],parkedShots:[],dialogues:[]}},context:{token:'context-1',shotId:'shot',imageId:'img',layerId:'1',generation:7,selection:null,floating:null},images:{img:image},files:{projectRootLabel:'Synthetic',folderName:'Synthetic',status:'current',savedRevision:1,outputPending:false,outputNames:[]}};
  const capture={activeId:null as number|null,pending:0,blocked:false,paused:false};
  const calls:ImageWorkspaceCommand[]=[];
  let respond:(command:ImageWorkspaceCommand)=>Promise<ImageWorkspaceOutcome>=async()=>({kind:'settled',operationId:'op',snapshot:state});
  const controller:NativeLayerPanelController={owner:ownerId,capabilities:{commands:['imageEdit','selectLayer'],imageEdits:['newLayer','setLayer','setLayerOpacities','moveLayers','removeLayer','merge','mergeVisible','clear'],brushTips:['hard']},snapshot:()=>state,request:async command=>{calls.push(structuredClone(command));return respond(command);},subscribe:()=>()=>{},capture:{state:()=>capture}};
  const previews:NativeLayerPreviewRequest[]=[];const canceled:unknown[]=[];
  const preview:NativeLayerPreviewPort={available:()=>true,preview:async request=>{previews.push(structuredClone(request));return{stamp:{documentId:'10',workerEpoch:1,epoch:3,previewId:request.previewId,throughSeq:request.fromSeq,baseVersion:native.versionId,sourceContextGeneration:7,editDigest:'d'.repeat(64)}};},cancel:async request=>{canceled.push(structuredClone(request));}};
  return{controller,image,capture,calls,previews,canceled,preview,state:()=>state,setState:(next:ImageWorkspaceSnapshot)=>{state=next;},respond:(next:typeof respond)=>{respond=next;}};
}
describe('native layer host target and capability binding',()=>{
  it('captures immutable shot/context/native identity and rejects a different displayed image even with the same layer ids',()=>{
    const h=harness(),target=captureLayerPanelTarget(h.controller,h.image);
    expect(target).toEqual({owner:ownerId,shotId:'shot',imageId:'img',generation:7,native});
    h.setState({...h.state(),context:{...h.state().context,shotId:'other',imageId:'other-image'}});
    expect(()=>captureLayerPanelTarget(h.controller,h.image)).toThrow('目标不同');
    expect(target.shotId).toBe('shot');
  });
  it('rejects stale context or native versions before sending an edit',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller);
    h.setState({...h.state(),images:{img:{...h.image,displayNative:{...native,versionId:'c'.repeat(64)}}}});
    await expect(owner.edit(h.image,{kind:'setLayer',layerId:'1',patch:{name:'changed'}})).rejects.toThrow('版本已变化');
    expect(h.calls).toEqual([]);
  });
  it('uses native properties/structure caps for a group whose paint alias is false',()=>{
    const h=harness();expect(()=>validateLayerPanelEdit(h.image,{kind:'setLayer',layerId:'2',patch:{name:'group'}})).not.toThrow();
    expect(()=>validateLayerPanelEdit(h.image,{kind:'merge',layerIds:['1','2']})).not.toThrow();
    expect(()=>validateLayerPanelEdit(h.image,{kind:'clear',layerId:'2'})).toThrow('不支持');
    const denied={...h.image,layers:h.image.layers.map(l=>l.id==='2'?{...l,capabilities:{paint:false,properties:false,structure:false},readOnlyReason:'原生只读内容'}:l)};
    expect(()=>validateLayerPanelEdit(denied,{kind:'removeLayer',layerId:'2'})).toThrow('原生只读内容');
  });
  it('refuses missing command/edit capabilities and capture/transition locks',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller);
    h.controller.capabilities.imageEdits=[];
    await expect(owner.edit(h.image,{kind:'newLayer',name:'N'})).rejects.toThrow('未提供');
    h.capture.paused=true;await expect(owner.select(h.image,'1')).rejects.toThrow('之前的图层操作');
    expect(h.calls).toEqual([]);
  });
  it('sends select and durable edit with the captured identity, without mutating the authority projection',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller);const before=structuredClone(h.image);
    await owner.select(h.image,'2');await owner.edit(h.image,{kind:'setLayer',layerId:'1',patch:{name:'New'}});
    expect(h.calls).toEqual([{kind:'selectLayer',shotId:'shot',layerId:'2',expectedContextGeneration:7},{kind:'imageEdit',shotId:'shot',expectedContextGeneration:7,expectedNative:native,edit:{kind:'setLayer',layerId:'1',patch:{name:'New'}}}]);
    expect(h.image).toEqual(before);expect(owner.busy()).toBe(false);
  });
  it('preserves a proven no-effect edit failure for explicit retry and does not let flush discard it',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller);
    h.respond(async()=>({kind:'rejected',operationId:'op',error:{code:'io',message:'No output installed',effect:'none'}}));
    await expect(owner.edit(h.image,{kind:'setLayer',layerId:'1',patch:{name:'kept draft'}})).rejects.toThrow('No output installed');
    await expect(owner.flush()).rejects.toThrow('No output installed');expect(owner.snapshot().failure?.input).toMatchObject({edit:{patch:{name:'kept draft'}}});
    h.respond(async()=>({kind:'settled',operationId:'retry',snapshot:h.state()}));await owner.retryKnownNoEffect();
    expect(h.calls).toHaveLength(2);expect(h.calls[1]).toEqual(h.calls[0]);expect(owner.busy()).toBe(false);
  });
  it('never retries or discards unknown durable edit results',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller);
    h.respond(async()=>{throw Error('lost reply');});
    await expect(owner.edit(h.image,{kind:'removeLayer',layerId:'1'})).rejects.toThrow('lost reply');
    await expect(owner.retryKnownNoEffect()).rejects.toThrow('不能安全重试');expect(()=>owner.discardKnownNoEffect()).toThrow('不能放弃');
    await owner.detach();await expect(owner.flush()).rejects.toThrow('lost reply');expect(h.calls).toHaveLength(1);
  });
});
describe('host-owned layer name text obligations',()=>{
  it('flushes an accepted unblurred name while new user actions and transition input are paused',async()=>{
    const h=harness(),pauses=new Set<string>();h.controller.setInputPause=(reason,value)=>{value?pauses.add(reason):pauses.delete(reason);h.capture.paused=pauses.size>0;};h.controller.inputPausedExcept=reason=>[...pauses].some(p=>p!==reason);
    const owner=createNativeLayerPanelOwner(h.controller);
    owner.nameDraft(h.image,{layerId:'1',name:'未失焦的完整名称',composing:false,action:'change'});
    expect(owner.busy()).toBe(true);expect(h.calls).toHaveLength(0);expect(h.capture.paused).toBe(true);expect([...pauses]).toEqual(['layer']);
    h.controller.setInputPause('transition',true);const canBeginGesture=()=>false;expect(canBeginGesture()).toBe(false);
    await owner.flush();
    expect(h.calls).toEqual([{kind:'imageEdit',shotId:'shot',expectedContextGeneration:7,expectedNative:native,edit:{kind:'setLayer',layerId:'1',patch:{name:'未失焦的完整名称'}}}]);
    expect(owner.busy()).toBe(false);expect(h.capture.paused).toBe(true);expect([...pauses]).toEqual(['transition']);
  });
  it('blocks close for IME candidates and submits only the confirmed complete text',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller);
    owner.nameDraft(h.image,{layerId:'1',name:'候选拼音',composing:true,action:'change'});
    await expect(owner.flush()).rejects.toThrow('输入法组字');expect(h.calls).toHaveLength(0);
    owner.nameDraft(h.image,{layerId:'1',name:'确认名称',composing:false,action:'change'});await owner.flush();
    expect(h.calls[0]).toMatchObject({edit:{patch:{name:'确认名称'}}});
  });
  it('retains complete draft/composition through panel unmount and restores the displayed input',async()=>{
    const h=harness(),owner=layerPanelOwnerFor(h.controller);owner.nameDraft(h.image,{layerId:'1',name:'保留候选',composing:true,action:'change'});await owner.detach();
    expect(layerPanelOwnerFor(h.controller)).toBe(owner);expect(owner.snapshot().nameDrafts?.[0]).toMatchObject({name:'保留候选',composing:true});
    await expect(owner.flush()).rejects.toThrow('输入法组字');
    const html=renderToStaticMarkup(createElement(NativeLayerPanel,{image:h.image,onSelect:vi.fn(),onEdit:vi.fn(),onOpacityGesture:vi.fn(),allowedEdits:['setLayer'],nameDrafts:{'1':{name:'保留候选',composing:true}}}));expect(html).toContain('value="保留候选"');
  });
  it('keeps newer name input when an earlier flush receipt returns',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller);let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});h.respond(async()=>{await gate;return{kind:'settled',operationId:'old',snapshot:h.state()};});
    owner.nameDraft(h.image,{layerId:'1',name:'Old accepted',composing:false,action:'change'});const flushing=owner.flush();
    owner.nameDraft(h.image,{layerId:'1',name:'Newer accepted',composing:false,action:'change'});release();await expect(flushing).rejects.toThrow('更新的');
    expect(owner.snapshot().nameDrafts?.[0].name).toBe('Newer accepted');expect(owner.busy()).toBe(true);
  });
  it('serializes several accepted names using only the bases confirmed by its own preceding edits',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller);let serial=0;
    h.respond(async command=>{
      if(command.kind!=='imageEdit'||command.edit.kind!=='setLayer')throw Error('wrong command');
      const nextNative={...native,versionId:String.fromCharCode('c'.charCodeAt(0)+serial++).repeat(64)},generation=7+serial;
      const nextImage={...h.state().images.img,displayNative:nextNative,contextGeneration:generation,layers:h.state().images.img.layers.map(l=>l.id===(command.edit as {layerId:string}).layerId?{...l,...(command.edit as {patch:{name:string}}).patch}:l)};
      h.setState({...h.state(),stateSeq:serial+1,context:{...h.state().context,generation},images:{img:nextImage}});return{kind:'settled',operationId:String(serial),snapshot:h.state()};
    });
    owner.nameDraft(h.image,{layerId:'1',name:'One',composing:false,action:'change'});owner.nameDraft(h.image,{layerId:'2',name:'Two',composing:false,action:'change'});await owner.flush();
    expect(h.calls).toHaveLength(2);expect(h.calls[0]).toMatchObject({expectedNative:{versionId:'b'.repeat(64)},expectedContextGeneration:7});expect(h.calls[1]).toMatchObject({expectedNative:{versionId:'c'.repeat(64)},expectedContextGeneration:8});expect(owner.busy()).toBe(false);
  });
  it('never rebinds an accepted draft to an unrelated later context',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller);owner.nameDraft(h.image,{layerId:'1',name:'Keep original target',composing:false,action:'change'});
    h.setState({...h.state(),context:{...h.state().context,shotId:'other',imageId:'other',generation:88}});
    await expect(owner.flush()).rejects.toThrow('身份已变化');expect(h.calls).toHaveLength(0);expect(owner.snapshot().nameDrafts?.[0].target.shotId).toBe('shot');
  });
});
describe('typed workspace preview adapter and authoritative resolution',()=>{
  const capabilities=(h:ReturnType<typeof harness>)=>{h.controller.capabilities.commands=['imageEdit','selectLayer','previewImageEdit','cancelImagePreview','inspectImagePreview','resolveImagePreview'];};
  const stamp=(previewId:string,throughSeq=1):ImageEnginePreviewStamp=>({documentId:'10',workerEpoch:1,epoch:3,previewId,throughSeq,baseVersion:native.versionId,sourceContextGeneration:7,editDigest:'d'.repeat(64)});
  const displayIdentity={sessionId:'session',incarnation:'incarnation',documentId:'10',workerEpoch:1,epoch:3};
  it('issues real preview/cancel Workspace intents and no durable edits during moves',async()=>{
    const h=harness();capabilities(h);
    h.respond(async command=>{
      if(command.kind==='previewImageEdit')return{kind:'previewed',operationId:'preview',stamp:stamp(command.previewId,command.fromSeq),displayIdentity};
      if(command.kind==='cancelImagePreview')return{kind:'previewCanceled',operationId:'cancel',displayIdentity:{...displayIdentity,epoch:4}};
      throw Error('Unexpected durable edit');
    });
    const owner=layerPanelOwnerFor(h.controller);expect(owner.previewAvailable()).toBe(true);
    await owner.opacity(h.image,{phase:'preview',changes});await owner.opacity(h.image,{phase:'preview',changes:changes.map(c=>({...c,opacity:.7}))});await owner.cancelRetainedOpacity();
    expect(h.calls.map(c=>c.kind)).toEqual(['previewImageEdit','previewImageEdit','cancelImagePreview']);
    expect(h.calls[0]).toMatchObject({shotId:'shot',expectedNative:native,expectedContextGeneration:7,fromSeq:1,edit:{kind:'setLayerOpacities',changes}});
    expect(h.calls[2]).toMatchObject({stamp:{throughSeq:2},expectedNative:native});expect(owner.busy()).toBe(false);
  });
  it('retries a proven no-effect preview only after explicit user intent, then commits once',async()=>{
    const h=harness();capabilities(h);let attempts=0;
    h.respond(async command=>{
      if(command.kind==='previewImageEdit')return ++attempts===1?{kind:'rejected',operationId:'preview1',error:{code:'capacity',message:'preview refused without effect',effect:'none'}}:{kind:'previewed',operationId:'preview2',stamp:stamp(command.previewId,command.fromSeq),displayIdentity};
      return{kind:'settled',operationId:'commit',snapshot:h.state()};
    });
    const owner=layerPanelOwnerFor(h.controller);await expect(owner.opacity(h.image,{phase:'preview',changes})).rejects.toThrow('without effect');
    expect(h.calls).toHaveLength(1);expect(owner.snapshot().failure?.effect).toBe('none');
    await owner.retryOpacityKnownNoEffect();
    expect(h.calls.map(c=>c.kind)).toEqual(['previewImageEdit','previewImageEdit','imageEdit']);
    expect(h.calls[1]).toMatchObject({fromSeq:1});expect(owner.busy()).toBe(false);expect(owner.snapshot().resetToken).toBe(1);
  });
  it('keeps unknown input after an active query and releases only a matching durable original-resolution receipt',async()=>{
    const h=harness();capabilities(h);let previewId='';let mismatched=true;
    h.respond(async command=>{
      if(command.kind==='previewImageEdit'){previewId=command.previewId;throw Error('delivery unknown');}
      if(command.kind==='inspectImagePreview')return{kind:'previewStatus',operationId:'inspect',previewId,status:{state:'active',stamp:stamp(previewId),pendingOperationId:null}};
      if(command.kind==='resolveImagePreview')return{kind:'previewStatus',operationId:'resolve',previewId,status:{state:'resolved',decision:'notCommitted',recordId:'durable-record',edit:{kind:'setLayerOpacities',changes:mismatched?changes.map(c=>({...c,opacity:1})):changes},expectedNative:native,expectedContextGeneration:7}};
      return{kind:'settled',operationId:'recover',snapshot:h.state()};
    });
    const owner=layerPanelOwnerFor(h.controller);await expect(owner.opacity(h.image,{phase:'preview',changes})).rejects.toThrow('delivery unknown');
    await h.controller.request({kind:'recover'});expect(owner.busy()).toBe(true);
    expect(await owner.inspectPreview()).toBe(false);expect(owner.snapshot().failure?.effect).toBe('unknown');expect(owner.busy()).toBe(true);
    await expect(owner.resolvePreview('retainAndDiscard')).rejects.toThrow('不能释放');expect(owner.busy()).toBe(true);
    mismatched=false;await owner.resolvePreview('exportAndDiscard');expect(owner.busy()).toBe(false);
    expect(h.calls.at(-1)).toEqual({kind:'resolveImagePreview',previewId,action:'exportAndDiscard',original:{shotId:'shot',expectedNative:native,expectedContextGeneration:7,edit:{kind:'setLayerOpacities',changes}}});
  });
  it('retains a candidate operation id and accepts only exact resolved edit/base/context evidence',async()=>{
    const h=harness();capabilities(h);const owner=createNativeLayerPanelOwner(h.controller,h.preview);await owner.opacity(h.image,{phase:'preview',changes});const previewId=owner.snapshot().previewId!;
    h.respond(async command=>{
      if(command.kind==='imageEdit')return{kind:'settlementPending',operationId:'candidate-operation',snapshot:h.state(),commitHash:null};
      return{kind:'previewStatus',operationId:'inspect',previewId,status:{state:'candidate',stamp:stamp(previewId),pendingOperationId:'candidate-operation'}};
    });
    await expect(owner.opacity(h.image,{phase:'commit',changes})).rejects.toThrow('尚未完成');expect(owner.snapshot().pendingOperationId).toBe('candidate-operation');
    await owner.inspectPreview();expect(owner.snapshot().pendingOperationId).toBe('candidate-operation');expect(owner.busy()).toBe(true);
    h.respond(async()=>({kind:'previewStatus',operationId:'inspect2',previewId,status:{state:'resolved',decision:'committed',recordId:'original-record',edit:{kind:'setLayerOpacities',changes},expectedNative:native,expectedContextGeneration:8}}));
    await expect(owner.inspectPreview()).rejects.toThrow('不能释放');
    h.respond(async()=>({kind:'previewStatus',operationId:'inspect3',previewId,status:{state:'resolved',decision:'committed',recordId:'original-record',edit:{kind:'setLayerOpacities',changes},expectedNative:native,expectedContextGeneration:7}}));
    expect(await owner.inspectPreview()).toBe(true);expect(owner.busy()).toBe(false);
  });
  it('rejects a preview display ACK from a different owner',async()=>{
    const h=harness();capabilities(h);h.respond(async command=>({kind:'previewed',operationId:'p',stamp:stamp(command.kind==='previewImageEdit'?command.previewId:'wrong'),displayIdentity:{...displayIdentity,incarnation:'other'}}));
    const owner=createNativeLayerPanelOwner(h.controller,workspaceLayerPreviewPort(h.controller));await expect(owner.opacity(h.image,{phase:'preview',changes})).rejects.toThrow('固定目标不一致');
    expect(owner.snapshot().failure?.effect).toBe('unknown');expect(owner.busy()).toBe(true);
  });
});
describe('controller-owned native opacity preview',()=>{
  it('uses only sequential preview calls for moves and one imageEdit for the final history entry',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller,h.preview);
    await owner.opacity(h.image,{phase:'preview',changes});
    const second=changes.map(c=>({...c,opacity:.6}));await owner.opacity(h.image,{phase:'preview',changes:second});
    expect(h.calls).toHaveLength(0);expect(h.previews.map(p=>p.fromSeq)).toEqual([1,2]);expect(h.previews[0].previewId).toBe(h.previews[1].previewId);
    expect(h.previews[0].target).toEqual(h.previews[1].target);expect(h.previews[1].edit.changes.map(c=>c.before)).toEqual([1,.5]);
    await owner.opacity(h.image,{phase:'commit',changes:second});
    expect(h.calls).toHaveLength(1);expect(h.calls[0]).toMatchObject({kind:'imageEdit',shotId:'shot',expectedContextGeneration:7,expectedNative:native,edit:{kind:'setLayerOpacities',changes:second},preview:{throughSeq:2}});
    expect(owner.busy()).toBe(false);await owner.flush();
  });
  it('rolls back a known preview with its original stamp even after context changes',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller,h.preview);await owner.opacity(h.image,{phase:'preview',changes});
    h.setState({...h.state(),context:{...h.state().context,shotId:'other',imageId:'other-image',generation:99}});
    await owner.opacity(h.image,{phase:'cancel',changes});
    expect(h.canceled).toEqual([{target:{owner:ownerId,shotId:'shot',imageId:'img',generation:7,native},stamp:expect.objectContaining({throughSeq:1})}]);expect(h.calls).toHaveLength(0);
  });
  it('rejects stale commit targets instead of silently rebasing to the latest context',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller,h.preview);await owner.opacity(h.image,{phase:'preview',changes});
    h.setState({...h.state(),context:{...h.state().context,generation:8}});
    await expect(owner.opacity(h.image,{phase:'commit',changes})).rejects.toThrow('身份已变化');
    expect(owner.snapshot()).toMatchObject({phase:'failed',target:{generation:7},changes});expect(h.calls).toHaveLength(0);
    await owner.opacity(h.image,{phase:'cancel',changes});expect(owner.busy()).toBe(false);
  });
  it('retains an unknown preview and complete input through detach/remount without retrying or canceling blindly',async()=>{
    const h=harness();h.preview.preview=vi.fn(async()=>{throw Error('preview delivery unknown');});
    const owner=layerPanelOwnerFor(h.controller,h.preview);
    await expect(owner.opacity(h.image,{phase:'preview',changes})).rejects.toThrow('unknown');await owner.detach();
    expect(layerPanelOwnerFor(h.controller)).toBe(owner);expect(owner.snapshot()).toMatchObject({phase:'failed',changes,target:{shotId:'shot',generation:7},failure:{effect:'unknown'}});
    await expect(owner.opacity(h.image,{phase:'preview',changes})).rejects.toThrow('unknown');
    await expect(owner.opacity(h.image,{phase:'cancel',changes})).rejects.toThrow('unknown');
    expect(h.preview.preview).toHaveBeenCalledTimes(1);expect(h.canceled).toHaveLength(0);await expect(owner.flush()).rejects.toThrow('unknown');
  });
  it('retains a bad stamp as an unknown result and freezes public retained inputs',async()=>{
    const h=harness();h.preview.preview=async request=>({stamp:{documentId:'10',workerEpoch:1,epoch:3,previewId:request.previewId,throughSeq:9,baseVersion:native.versionId,sourceContextGeneration:7,editDigest:'d'.repeat(64)} as ImageEnginePreviewStamp});
    const owner=createNativeLayerPanelOwner(h.controller,h.preview);await expect(owner.opacity(h.image,{phase:'preview',changes})).rejects.toThrow('确认与原始目标不一致');
    expect(owner.snapshot().failure?.effect).toBe('unknown');expect(Object.isFrozen(owner.snapshot().changes)).toBe(true);expect(Object.isFrozen(owner.snapshot().target?.native)).toBe(true);
  });
  it('cancels a settled preview on unmount while retaining any failed rollback obligation',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller,h.preview);await owner.opacity(h.image,{phase:'preview',changes});
    h.preview.cancel=async()=>{throw Error('rollback unknown');};await expect(owner.detach()).rejects.toThrow('rollback unknown');
    expect(owner.busy()).toBe(true);await expect(owner.flush()).rejects.toThrow('rollback unknown');expect(owner.snapshot().stamp?.throughSeq).toBe(1);
  });
  it('disables opacity entirely when the native preview capability is unavailable',async()=>{
    const h=harness(),owner=createNativeLayerPanelOwner(h.controller);expect(owner.previewAvailable()).toBe(false);
    await expect(owner.opacity(h.image,{phase:'preview',changes})).rejects.toThrow('尚未提供');expect(h.calls).toHaveLength(0);
  });
});

it('allows a name blur commit through its own input pause while protecting canvas admission',async()=>{
 const h=harness(),pauses=new Set<string>();h.controller.setInputPause=(reason,value)=>{value?pauses.add(reason):pauses.delete(reason);h.capture.paused=pauses.size>0;};h.controller.inputPausedExcept=reason=>[...pauses].some(p=>p!==reason);
 const owner=createNativeLayerPanelOwner(h.controller);owner.nameDraft(h.image,{layerId:'1',name:'New',composing:false,action:'change'});expect(h.capture.paused).toBe(true);
 await owner.edit(h.image,{kind:'setLayer',layerId:'1',patch:{name:'New'}});expect(owner.busy()).toBe(false);expect(h.capture.paused).toBe(false);
});

describe('exact request recovery for ordinary layer edits',()=>{
  function failed(){
    const h=harness();h.controller.capabilities.commands=[...h.controller.capabilities.commands,'inspectRequest','resolveEdit'];
    h.controller.requestTracked=command=>({requestId:'lost-edit',result:h.controller.request(command)});
    h.controller.refreshSnapshot=async()=>{};
    h.respond(async()=>{throw Error('lost reply');});
    const owner=createNativeLayerPanelOwner(h.controller),edit={kind:'setLayer' as const,layerId:'1',patch:{name:'retained name'}};
    return{h,owner,edit};
  }
  it('queries the original request without applying it a second time',async()=>{
    const{h,owner,edit}=failed();await expect(owner.edit(h.image,edit)).rejects.toThrow('lost reply');
    expect(owner.snapshot().requestId).toBe('lost-edit');
    h.respond(async command=>{expect(command).toEqual({kind:'inspectRequest',requestId:'lost-edit'});return{kind:'requestStatus',operationId:'query',requestId:'lost-edit',state:'committed',mainOperationId:'original'};});
    expect(await owner.inspectEdit()).toBe(true);expect(owner.busy()).toBe(false);
    expect(h.calls.filter(c=>c.kind==='imageEdit')).toHaveLength(1);
  });
  it.each(['wrong','missing-record','valid'])('releases only a matching durable original receipt: %s',async mode=>{
    const{h,owner,edit}=failed();owner.nameDraft(h.image,{layerId:'1',name:'retained name',composing:false,action:'change'});
    await expect(owner.flush()).rejects.toThrow('lost reply');
    h.respond(async command=>{expect(command).toEqual({kind:'resolveEdit',requestId:'lost-edit',action:'retainAndDiscard',original:{shotId:'shot',expectedNative:native,expectedContextGeneration:7,edit}});return{kind:'editResolved',operationId:'resolve',requestId:mode==='wrong'?'different':'lost-edit',mainOperationId:null,decision:'notCommitted',original:{recordId:mode==='missing-record'?'':'kept-original'}};});
    if(mode==='valid'){expect(await owner.resolveEdit('retainAndDiscard')).toBe(true);expect(owner.busy()).toBe(false);expect(owner.snapshot().nameDrafts).toEqual([]);}
    else{await expect(owner.resolveEdit('retainAndDiscard')).rejects.toThrow();expect(owner.busy()).toBe(true);expect(owner.snapshot().nameDrafts?.[0].name).toBe('retained name');}
    expect(h.calls.filter(c=>c.kind==='imageEdit')).toHaveLength(1);
  });
});
it('can query a lost layer-selection reply without inventing an image edit to archive',async()=>{
 const h=harness();h.controller.capabilities.commands=[...h.controller.capabilities.commands,'inspectRequest'];h.controller.requestTracked=command=>({requestId:'selection-request',result:h.controller.request(command)});h.controller.refreshSnapshot=async()=>{};
 const owner=createNativeLayerPanelOwner(h.controller);h.respond(async()=>{throw Error('lost selection reply');});await expect(owner.select(h.image,'2')).rejects.toThrow();expect(owner.canResolveEdit()).toBe(false);
 h.respond(async()=>({kind:'requestStatus',operationId:'wrong',requestId:'selection-request',state:'completed',mainOperationId:null,completion:{commandKind:'selectLayer',contextToken:'context-2',shotId:'other-shot',layerId:'2',contextGeneration:8,outcome:'completed'}}));await expect(owner.inspectEdit()).rejects.toThrow('不一致');expect(owner.busy()).toBe(true);
 h.respond(async command=>{expect(command).toEqual({kind:'inspectRequest',requestId:'selection-request'});return{kind:'requestStatus',operationId:'query',requestId:'selection-request',state:'completed',mainOperationId:null,completion:{commandKind:'selectLayer',contextToken:'context-2',shotId:'shot',layerId:'2',contextGeneration:8,outcome:'completed'}};});expect(await owner.inspectEdit()).toBe(true);expect(owner.busy()).toBe(false);expect(h.calls.filter(c=>c.kind==='selectLayer')).toHaveLength(1);
});
