import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {FolderInput,Undo2,Redo2,Save,Trash2} from 'lucide-react';
import type {ImageWorkspaceCommand,ImageWorkspaceEdit,ImageWorkspaceImageView} from '../../../platform/contracts/imageWorkspace';
import type {FlowStroke} from '../../../platform/contracts/flowWave2';
import type {Shot} from '../../../drawing/contracts/types';
import {NativeCanvas} from '../../../drawing/renderer/image-engine/NativeCanvas';
import {BrushPanel} from '../../../drawing/renderer/brushPanel';
import {preferenceFor,readBrushPreferences,strokeBrushFor,withPreference,writeBrushPreferences} from '../../../drawing/renderer/brushPresets';
import {CanvasPresentationContext,PresentationPreview} from '../../../drawing/renderer/canvasPresentation';
import {DialogueBlocks} from '../../../storyboard/renderer/dialogueBlocks';
import {createDialogueCommitState} from '../../../storyboard/renderer/dialogueCommitState';
import {pendingDeleteDecision} from '../../../storyboard/renderer/pendingSelection';
import {selectShots,nextSelectionAnchor} from '../../../storyboard/renderer/boardSelection';
import {Workbench} from '../Workbench';
import {errorText} from '../FlowAlert';
import {WorkspaceToolRail,type WorkspaceTool} from '../workspace/WorkspaceToolRail';
import {ProjectNamingBar} from '../ProjectNamingBar';
import {useProjectNaming} from '../useProjectNaming';
import {createController as createToolController} from '../toolShortcuts';
import type {ImageWorkspaceController} from './workspaceController';
import {NativeThumbnail,workspaceShots,imageIssueText} from './presentation';
import {transformPreviewOwnerFor} from './transformPreviewOwner';
import {NativeLayerPanelHost} from './NativeLayerPanelHost';
import {layerPanelOwnerFor} from './nativeLayerPanelHostModel';
import {NativeInputRecovery} from './NativeInputRecovery';
import {NativeFileRecovery} from './NativeFileRecovery';
import {NativeRefreshSheet,type RefreshPreviewView,type RefreshChoice} from './NativeRefreshSheet';

type Props={
 controller:ImageWorkspaceController;externallyPaused:boolean;
 projectMenu:(exportPsd:()=>void,disabled:boolean)=>ReactNode;
 registerTransition:(flush:()=>Promise<void>)=>()=>void;
};
const success=(kind:string)=>kind==='settled'||kind==='recovered'||kind==='imagesRegistered';

/** Existing workbench layout around the native owner. UI drafts are text/input
 * obligations, not editable image documents. All image changes are Main intents. */
export function NativeWorkbenchEditor({controller:c,externallyPaused,projectMenu,registerTransition}:Props){
 const transformOwner=useMemo(()=>transformPreviewOwnerFor(c),[c]);
 const transformState=useSyncExternalStore(transformOwner.subscribe,transformOwner.snapshot);
 const [,setGestureVersion]=useState(0);
 const layerOwner=useMemo(()=>layerPanelOwnerFor(c),[c]);
 useSyncExternalStore(layerOwner.subscribe,layerOwner.snapshot);
 const snapshot=useSyncExternalStore(c.subscribe,c.snapshot);
 useSyncExternalStore(c.subscribe,()=>{const v=c.capture.state();return `${v.activeId}:${v.pending}:${v.blocked}:${v.waiting}:${v.paused}:${c.fault()?.message??''}`;});
 const project=snapshot.session.project;
 const [selected,setSelected]=useState<string[]>(()=>project.shots[0]?[project.shots[0].id]:[]),[pendingSelected,setPendingSelected]=useState<string[]>([]);
 const [issue,setIssue]=useState(''),[tool,setTool]=useState<WorkspaceTool>('brush'),[color,setColor]=useState('#000000'),[blurRadius,setBlurRadius]=useState(8);
 const [brushPreferences,setBrushPreferences]=useState(readBrushPreferences),[brushPanel,setBrushPanel]=useState<{x:number;y:number}>();
 const [working,setWorking]=useState(false),[authority,setAuthority]=useState(0),[holdShots,setHoldShots]=useState<string[]>([]);
 const [refreshPreview,setRefreshPreview]=useState<RefreshPreviewView>();
 const [scripts,setScripts]=useState<Record<string,string>>({});
 const toolRef=useRef(tool),anchor=useRef<string|undefined>(undefined),pendingAnchor=useRef<string|undefined>(undefined);toolRef.current=tool;
 const surfaceGestures=useRef(new Set<string>()),outputActive=useRef(false);
 const actionComposing=useRef(new Set<string>()),scriptSerial=useRef(0);
 const text=useRef(createDialogueCommitState()),requests=useRef(new Set<Promise<unknown>>()),scriptVersions=useRef(new Map<string,number>());
 const active=snapshot.session.phase==='active'&&!externallyPaused;
 const currentId=selected.find(id=>project.shots.some(s=>s.id===id));
 const current=project.shots.find(s=>s.id===currentId),image=current?snapshot.images[current.imageId]:undefined;
 const activeLayer=image?.layers.find(l=>l.id===image.activeLayerId);
 const live=useRef({active,working,tool});live.current={active,working,tool};
 const refreshText=()=>setHoldShots(text.current.holdShots());
 const request=useCallback((command:ImageWorkspaceCommand):Promise<void>=>{
  const promise=c.request(command).then(outcome=>{if(outcome.kind==='canceled')return;if(!success(outcome.kind))throw Error(outcome.kind==='rejected'?(outcome.error.code==='stale-refresh'?'检查后画面或外部文件又发生了变化。请取消本次选择，重新取回外部改动。':outcome.error.message):'操作尚未完成，请先处理保留的内容。');});
  requests.current.add(promise);void promise.then(()=>requests.current.delete(promise),error=>{requests.current.delete(promise);setIssue(error instanceof Error?error.message:String(error));});return promise;
 },[c]);
 const act=(command:ImageWorkspaceCommand)=>{void request(command).catch(()=>{});};
 const naming=useProjectNaming(project,draft=>request({kind:'board',command:{kind:'setProjectNaming',...draft}}));
 useEffect(()=>registerTransition(async()=>{
  if(!c.capture.state().paused)throw Error('关闭前必须先暂停新输入。');
  if(outputActive.current)throw Error('请等待文件操作结束。');
  if(surfaceGestures.current.size)throw Error('请先完成当前画布操作。');
  if(actionComposing.current.size||text.current.composingShots().length)throw Error('请先完成输入法组字。');
  await transformOwner.flush();await layerOwner.flush();await naming.flush();await Promise.all([...requests.current]);
  if(text.current.busy()||scriptVersions.current.size)throw Error('仍有未确认的文字，请先处理。');
  await c.settleCaptured();
 }),[registerTransition,naming.flush,c,layerOwner,transformOwner]);
 useEffect(()=>{void c.start();void c.refreshSnapshot();},[c]);
 useEffect(()=>{writeBrushPreferences(brushPreferences);},[brushPreferences]);
 useEffect(()=>{
  setSelected(ids=>ids.filter(id=>project.shots.some(s=>s.id===id)));
  setPendingSelected(ids=>ids.filter(id=>project.parkedShots.some(s=>s.id===id)));
 },[project.shots,project.parkedShots]);
 const canBeginLayer=()=>!transformOwner.busy()&&live.current.active&&!outputActive.current&&!c.inputPausedExcept('layer')&&!surfaceGestures.current.size&&!actionComposing.current.size&&!text.current.busy()&&!scriptVersions.current.size&&!requests.current.size;
 const canNavigate=()=>!refreshPreview&&!transformOwner.busy()&&!layerOwner.busy()&&live.current.active&&!live.current.working&&!outputActive.current&&!c.capture.state().paused&&!surfaceGestures.current.size&&!actionComposing.current.size&&!text.current.busy()&&!scriptVersions.current.size&&requests.current.size===0&&c.capture.state().activeId===null&&!c.capture.state().blocked&&c.capture.state().pending===0;
 const activate=(id:string)=>{if(c.snapshot().context.shotId===id&&c.snapshot().context.layerId!==null)return;void c.request({kind:'activateShot',shotId:id}).then(result=>{if(result.kind==='rejected')setIssue(result.error.message);}).catch(error=>setIssue(errorText(error)));};
 const focus=(id:string)=>{if(!canNavigate())return;setSelected([id]);anchor.current=id;activate(id);};
 useEffect(()=>{if(currentId)activate(currentId);},[currentId]);
 const select=(id:string,event:{shiftKey?:boolean;metaKey?:boolean;ctrlKey?:boolean},pending=false)=>{
  if(!canNavigate())return;
  const order=(pending?project.parkedShots:project.shots).map(s=>s.id),ids=pending?pendingSelected:selected,ref=pending?pendingAnchor:anchor;
  const next=selectShots(order,ids,ref.current,id,event);
  ref.current=nextSelectionAnchor(order,ref.current,id,event);
  (pending?setPendingSelected:setSelected)(next);
  const primary=order.find(id=>next.includes(id));
  if(!pending&&primary)activate(primary);
 };
 const history=async(kind:'undo'|'redo')=>{
  if(!canNavigate())return;const before=c.snapshot().context.shotId;
  await naming.flush();await request({kind});
  const next=c.snapshot(),target=next.context.shotId;
  // History may remove the selected board or restore a different native target.
  // Follow that confirmed target without collapsing an unchanged multi-selection.
  if(target!==before&&target&&next.session.project.shots.some(shot=>shot.id===target)){setSelected([target]);anchor.current=target;}
  setAuthority(v=>v+1);
 };
 const edit=async(value:ImageWorkspaceEdit)=>{
  if(!canNavigate())throw Error('请先结束当前编辑。');
  const shown=snapshot.context,now=c.snapshot().context;
  if(!currentId||shown.shotId!==currentId||now.shotId!==currentId||shown.generation===null||now.generation!==shown.generation)throw Error('画面上下文已变化，请重新选择操作目标。');
  if(!image?.displayNative)throw Error('请等待画面准备完成。');
  await request({kind:'imageEdit',shotId:currentId,expectedContextGeneration:shown.generation,expectedNative:image.displayNative,edit:value});
 };
 const shortcuts=useMemo(()=>createToolController({current:()=>toolRef.current,apply:next=>{toolRef.current=next;setTool(next);},isBlocked:()=>{
  const state=c.capture.state();return transformOwner.busy()||layerOwner.busy()||!live.current.active||live.current.working||outputActive.current||state.paused||c.snapshot().session.phase!=='active'||(toolRef.current==='select'&&surfaceGestures.current.size>0)||actionComposing.current.size>0||text.current.busy()||!!document.querySelector('[aria-modal=true]')||state.blocked;
 }}),[c]);
 useEffect(()=>{
  const down=(e:KeyboardEvent)=>{
   if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'&&!(e.target instanceof Element&&e.target.closest('input,textarea,[contenteditable=true]'))){e.preventDefault();void history(e.shiftKey?'redo':'undo').catch(()=>{});return;}
   if((e.key.toLowerCase()==='l'||e.key.toLowerCase()==='k')&&!canNavigate())return;
   if(shortcuts.keyDown(e)!=='ignored')e.preventDefault();
  };
  const up=(e:KeyboardEvent)=>{if(shortcuts.keyUp(e)!=='ignored')e.preventDefault();};
  const blur=()=>shortcuts.blur();const hidden=()=>{if(document.hidden)shortcuts.blur();};
  window.addEventListener('keydown',down);window.addEventListener('keyup',up);window.addEventListener('blur',blur);document.addEventListener('visibilitychange',hidden);
  return()=>{window.removeEventListener('keydown',down);window.removeEventListener('keyup',up);window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',hidden);};
 },[shortcuts,project]);
 useEffect(()=>()=>shortcuts.dispose(),[shortcuts]);
 const shots=workspaceShots(snapshot).map(shot=>scripts[shot.id]===undefined?shot:{...shot,scriptText:scripts[shot.id]});
 const shotImage=(shot:Shot)=>{const board=[...project.shots,...project.parkedShots].find(s=>s.id===shot.id);return board?snapshot.images[board.imageId]:undefined;};
 const demandShots=useCallback((shotIds:string[])=>{void c.request({kind:'demandShots',shotIds}).catch(()=>{});},[c]);
 const staticMedia=(shot:Shot)=><PresentationPreview shotId={shot.id} width={shot.flow!.canvasWidth} height={shot.flow!.canvasHeight}><NativeThumbnail controller={c} image={shotImage(shot)}/></PresentationPreview>;
 const style=(strokeTool:'brush'|'eraser'):Omit<FlowStroke,'points'|'pressures'>=>{
  const preset=strokeTool==='brush'?brushPreferences.brush:brushPreferences.eraser,pref=preferenceFor(brushPreferences,preset);
  const seed=crypto.getRandomValues(new Uint32Array(1))[0],brush=strokeBrushFor(preset,seed);
  if(!brushPreferences.pressure){brush.pressureSize=0;brush.pressureOpacity=0;}
  return{tool:strokeTool,color,size:pref.size,opacity:pref.opacity,softness:0,brush};
 };
 const dialogueText=new Map<string,string>();for(const d of project.dialogues)dialogueText.set(d.shotId,[dialogueText.get(d.shotId),d.text.trim()].filter(Boolean).join(' '));
 const presentations=Object.fromEntries([...project.shots,...project.parkedShots].filter(s=>s.presentation).map(s=>[s.id,{...s.presentation!,text:dialogueText.get(s.id)??''}]));
 const dialogue=(shotId:string,compact=false,allowDrag=false)=><DialogueBlocks shotId={shotId} dialogues={project.dialogues} disabled={!active} variant={compact?'compact':'full'} allowDrag={allowDrag} authority={authority}
  onEditState={(id,state)=>{text.current.report(id,state);refreshText();}}
  onUndo={()=>{void history('undo').catch(()=>{});}} onRedo={()=>{void history('redo').catch(()=>{});}}
  onCommit={async(value,editor)=>{
   if(value.kind==='moveDialogues'){await request({kind:'board',command:{kind:'moveDialogues',dialogueIds:value.dialogueIds,targetShotId:value.targetShotId,beforeId:value.beforeId}});return;}
   const token=text.current.begin(shotId,editor);refreshText();
   try{await request({kind:'board',command:{kind:'setDialogues',shotId,dialogues:value.dialogues,typingGroup:value.edit?.group}});text.current.settle(token,true);}finally{refreshText();}
  }}/>;
 const script=(shotId:string,value:string)=>{
  const version=++scriptSerial.current;scriptVersions.current.set(shotId,version);setScripts(old=>({...old,[shotId]:value}));
  if(actionComposing.current.has(shotId))return;
  void request({kind:'board',command:{kind:'setScriptText',shotId,text:value}}).then(()=>{if(scriptVersions.current.get(shotId)!==version)return;scriptVersions.current.delete(shotId);setScripts(old=>{const next={...old};delete next[shotId];return next;});}).catch(()=>{});
 };
 const save=async(kind:'save'|'refresh'|'export')=>{
  if(outputActive.current)return;if(surfaceGestures.current.size){setIssue('请先完成当前画布操作。');return;}outputActive.current=true;setWorking(true);c.setInputPause('output',true);
  try{await transformOwner.flush();await layerOwner.flush();await naming.flush();await Promise.all([...requests.current]);await c.settleCaptured();if(text.current.busy()||scriptVersions.current.size)throw Error('仍有未确认文字。');if(kind==='refresh'){const result=await c.request({kind:'refresh'});if(result.kind==='refreshPreview'){if(result.preview.items.length)setRefreshPreview(result.preview);else setIssue('工作文件没有新的外部改动。');}else if(!success(result.kind))throw Error(result.kind==='rejected'?result.error.message:'取回尚未完成。');}else if(kind==='export'){if(!currentId)throw Error('请先选择故事板。');const outcome=await c.request({kind:'export',shotId:currentId,format:'psd'});if(outcome.kind!=='canceled'&&!success(outcome.kind))throw Error(outcome.kind==='rejected'?outcome.error.message:'导出尚未确认。');}else await request({kind});}
  catch(error){setIssue(error instanceof Error?error.message:String(error));}finally{outputActive.current=false;setWorking(false);c.setInputPause('output',c.snapshot().session.phase!=='active');}
 };
 const confirmRefresh=async(choices:RefreshChoice[])=>{
  if(!refreshPreview||outputActive.current)throw Error('请重新检查外部改动。');
  outputActive.current=true;setWorking(true);c.setInputPause('output',true);
  try{await c.settleCaptured();await request({kind:'confirmRefresh',planId:refreshPreview.planId,choices});setRefreshPreview(undefined);setIssue('');setAuthority(v=>v+1);}
  finally{outputActive.current=false;setWorking(false);c.setInputPause('output',c.snapshot().session.phase!=='active');}
 };
 const addImages=(mode:'files'|'folder')=>{if(!canNavigate())return;setIssue('');act({kind:'addImages',mode,destination:'pending'});};
 const removePending=(shotIds:string[])=>{
  if(!canNavigate())return;
  const now=c.snapshot().session,decision=pendingDeleteDecision({pending:now.pending,parked:now.project.parkedShots.map(s=>s.id)},shotIds);
  if(decision==='empty')return;
  if(decision!=='delete'){setIssue(decision==='busy'?'还有操作尚未完成，请稍后删除。':'Pending 已变化，请重新选择。');return;}
  act({kind:'board',command:{kind:'removeShots',shotIds}});
 };
 const newShot=async()=>{
  if(!canNavigate())return;
  try{const result=await c.request({kind:'board',command:{kind:'newShot',width:image?.width??1920,height:image?.height??1080,afterId:currentId}});
   if(result.kind==='settled'||result.kind==='recovered'){const id=result.createdShotIds?.[0];if(id){setSelected([id]);anchor.current=id;activate(id);}}
   else setIssue(result.kind==='rejected'?result.error.message:'新建板尚未完成。');
  }catch(error){setIssue(errorText(error));}
 };
 const visibleImages=[...new Set([...project.shots,...project.parkedShots].map(shot=>shot.imageId))].map(id=>snapshot.images[id]);
 const retaining=visibleImages.filter(image=>image?.availability==='queued'||image?.availability==='retaining').length;
 const unavailable=visibleImages.filter(image=>image?.availability==='unavailable').length;
 const sourceUncertain=visibleImages.filter(image=>image?.availability==='recoveryPending').length;
 const batches=snapshot.files.backgroundImports??[];
 const background=batches.filter(b=>!['completed','paused','needsAttention','recovering'].includes(b.phase));
 const backgroundStatus=background.length?`正在准备新增图片 ${background.reduce((n,b)=>n+b.done,0)} / ${background.reduce((n,b)=>n+b.total,0)} · 可以继续绘画`:'';
 const sourceStatus=sourceUncertain?`${sourceUncertain} 张图片的处理结果尚待确认`:retaining?`项目已打开 · 正在保管 ${retaining} 张原图`:unavailable?`${unavailable} 张图片需处理，其他故事板仍可使用`:'';
 const recoverFiles=async()=>{
  if(outputActive.current||surfaceGestures.current.size)throw Error('请先结束当前操作。');
  if(c.capture.state().blocked)throw Error('请先处理上方保留的笔迹。');
  outputActive.current=true;setWorking(true);c.setInputPause('output',true);
  try{await transformOwner.flush();await layerOwner.flush();await naming.flush();await Promise.all([...requests.current]);await c.settleCaptured();await request({kind:'recover'});setIssue('');}
  finally{outputActive.current=false;setWorking(false);c.setInputPause('output',c.snapshot().session.phase!=='active');}
 };
 const referenceStatus=image?.notice?.message??(image?.availability==='reference'?'已保留原画面 · 可在上方新建图层绘画':'');
 const preset=tool==='eraser'?brushPreferences.eraser:brushPreferences.brush,pref=preferenceFor(brushPreferences,preset);
 return <CanvasPresentationContext.Provider value={presentations}>
  {refreshPreview&&<NativeRefreshSheet key={refreshPreview.planId} preview={refreshPreview} onConfirm={confirmRefresh} onCancel={()=>setRefreshPreview(undefined)}/>}
  <NativeInputRecovery controller={c}/>
  <NativeFileRecovery snapshot={snapshot} disabled={externallyPaused||working||surfaceGestures.current.size>0} onRecover={recoverFiles} onRetryImport={async importId=>{await request({kind:'resumeImport',importId});setIssue('');}}/>
  {transformState.failure&&<aside className="wb-recovery" role="alert"><strong>选区变换需要处理</strong><p>{transformState.failure.message} 已保留最后接受的变换输入。</p><button disabled={surfaceGestures.current.size>0} onClick={()=>void transformOwner.resolve('retainAndDiscard').catch(error=>setIssue(errorText(error)))}>保管输入并结束变换</button><button disabled={surfaceGestures.current.size>0} onClick={()=>void transformOwner.resolve('exportAndDiscard').catch(error=>setIssue(errorText(error)))}>导出输入副本并结束变换…</button></aside>}
  <Workbench name={project.name} shots={shots.slice(0,project.shots.length)} parked={shots.slice(project.shots.length)} selected={selected} pendingSelected={pendingSelected} revision={project.revision} disabled={!active||working}
   dialogueText={dialogueText} renderDialogue={dialogue} status={issue||c.fault()?.message||(working?'正在更新文件…':c.capture.state().pending?'正在自动暂存笔迹…':sourceStatus||backgroundStatus|| [referenceStatus,snapshot.files.outputPending?'已自动暂存 · 文件夹待更新':'已自动暂存'].filter(Boolean).join(' · '))}
   projectBar={<ProjectNamingBar naming={naming} folderName={snapshot.files.folderName} disabled={!active||working}/>}
   select={select} focus={focus} selectMany={ids=>{const order=project.shots.map(s=>s.id),next=order.filter(id=>ids.includes(id));setSelected(next);if(next[0])activate(next[0]);}} selectAll={()=>setSelected(project.shots.map(s=>s.id))} clearSelection={()=>setSelected([])}
   selectPending={(id,event)=>select(id,event,true)} selectManyPending={setPendingSelected} selectAllPending={()=>setPendingSelected(project.parkedShots.map(s=>s.id))} clearPending={()=>setPendingSelected([])}
   canNavigate={canNavigate} canStartCanvasEdit={canNavigate} canContinueBrush={shot=>!transformOwner.busy()&&!layerOwner.busy()&&active&&!working&&!outputActive.current&&!c.capture.state().paused&&(tool==='brush'||tool==='eraser')&&!actionComposing.current.size&&!scriptVersions.current.size&&!requests.current.size&&!text.current.busy()&&!c.capture.state().blocked&&(c.snapshot().context.shotId===shot.id||c.capture.state().pending===0)} demand={()=>{}} demandShots={demandShots}
   move={(shotIds,destination,beforeId)=>{if(canNavigate())act({kind:'board',command:{kind:'moveShots',shotIds,destination,beforeId}});}} remove={removePending}
   holdShots={[...new Set([...holdShots,...Object.keys(scripts)])]} renderStatic={staticMedia}
   renderLayers={()=><NativeLayerPanelHost controller={c} image={image} canBeginGesture={canBeginLayer}/>}
   renderInfo={(shot,allowDrag)=><div className="wb-info"><label>动作说明<textarea aria-label={'动作说明 '+shot.id} value={shot.scriptText??''} disabled={!active} onChange={e=>script(shot.id,e.target.value)} onCompositionStart={()=>actionComposing.current.add(shot.id)} onCompositionEnd={e=>{actionComposing.current.delete(shot.id);script(shot.id,e.currentTarget.value);}}/></label>{dialogue(shot.id,false,allowDrag)}</div>}
   renderCanvas={(shot,previous,next)=><NativeCanvas onion={(previous||next)&&<div className="onion-skin-overlay" aria-hidden="true">{previous&&<div className="onion-skin-ghost onion-skin-ghost-previous"><NativeThumbnail controller={c} image={shotImage(previous)}/></div>}{next&&<div className="onion-skin-ghost onion-skin-ghost-next"><NativeThumbnail controller={c} image={shotImage(next)}/></div>}</div>} key={shot.id} shotId={shot.id} unavailableReason={['unavailable','recoveryPending'].includes(shotImage(shot)?.availability??'')?imageIssueText(shotImage(shot))??'这张图片暂时无法打开，其他故事板仍可使用。':undefined} documentId={shotImage(shot)?.displayDocumentId??null} dimensionsKnown={!!shotImage(shot)?.width&&!!shotImage(shot)?.height} cursorSize={pref.size} width={shot.flow!.canvasWidth} height={shot.flow!.canvasHeight} source={c.frames} capture={c.capture} target={snapshot.context.shotId===shot.id&&snapshot.context.layerId!==null&&snapshot.context.generation!==null?{shotId:shot.id,layerId:snapshot.context.layerId,expectedContextGeneration:snapshot.context.generation}:null} tool={tool} style={style} selection={snapshot.context.shotId===shot.id?snapshot.context.selection:null}
    onTransform={(phase,selection,matrix,target)=>{
     try{const value:Extract<ImageWorkspaceEdit,{kind:'transform'}>={kind:'transform',layerId:target.layerId,selection,matrix};
      if(phase==='begin'){const view=shotImage(shot),ctx=c.snapshot().context;if(!view||layerOwner.busy()||ctx.shotId!==target.shotId||ctx.generation!==target.expectedContextGeneration)throw Error('变换目标已变化，请重新圈选。');transformOwner.begin(view,value);}
      else if(phase==='update')transformOwner.update(value);else if(phase==='cancel')transformOwner.cancel();else transformOwner.finish();return true;
     }catch(error){setIssue(errorText(error));return false;}
    }}
    onSelection={(selection,target)=>act({kind:'selection',shotId:target.shotId,expectedContextGeneration:target.expectedContextGeneration,selection})}
    onGestureChange={(id,active)=>{active?surfaceGestures.current.add(id):surfaceGestures.current.delete(id);setGestureVersion(v=>v+1);}}
    onIssue={setIssue} onPickColor={setColor} onOpenBrushPanel={setBrushPanel}/>}
   actions={<div className="wb-actions">{projectMenu(()=>void save('export'),!active||working||!currentId)}<details><summary>添加图片</summary><button disabled={!active||working||!!refreshPreview} onClick={()=>addImages('files')}>选择图片…</button><button disabled={!active||working||!!refreshPreview} onClick={()=>addImages('folder')}>选择文件夹…</button></details><button className="wb-save wb-document-action" disabled={!active||working||!!naming.issue} onClick={()=>void save('save')}><Save size={15}/>保存</button><button className="wb-refresh" aria-label="从文件夹取回外部改动" disabled={!active||working} onClick={()=>void save('refresh')}><FolderInput size={17}/></button></div>}
   toolbar={null} boardActions={<><button disabled={!canNavigate()} onClick={()=>void newShot()}>新建故事板</button><button aria-label="删除所选故事板" disabled={!selected.length||!canNavigate()} onClick={()=>act({kind:'board',command:{kind:'removeShots',shotIds:selected}})}><Trash2 size={15}/></button><button aria-label="撤销" disabled={!snapshot.session.undoDepth||!canNavigate()} onClick={()=>void history('undo').catch(()=>{})}><Undo2 size={15}/></button><button aria-label="重做" disabled={!snapshot.session.redoDepth||!canNavigate()} onClick={()=>void history('redo').catch(()=>{})}><Redo2 size={15}/></button></>}
   toolRail={<WorkspaceToolRail tool={tool} disabled={!active||working} canChangeTool={!text.current.busy()} paintInFlight={snapshot.session.pending>0} onToolChange={next=>{if(!canNavigate()&&!(c.capture.state().pending>0&&!c.capture.state().paused&&!surfaceGestures.current.size&&(next==='brush'||next==='eraser')))return;shortcuts.toolChosenByUser(next);toolRef.current=next;setTool(next);}} color={color} onColorChange={setColor} size={pref.size} onSizeChange={size=>setBrushPreferences(old=>withPreference(old,preset,{...pref,size}))} blurRadius={blurRadius} onBlurRadiusChange={setBlurRadius} onApplyBlur={()=>{if(activeLayer)void edit({kind:'blur',layerId:activeLayer.id,radius:blurRadius,selection:snapshot.context.selection??undefined}).catch(()=>{});}}/>}/>
  {brushPanel&&(tool==='brush'||tool==='eraser')&&<BrushPanel tool={tool} preferences={brushPreferences} anchor={brushPanel} onChange={setBrushPreferences} onClose={()=>setBrushPanel(undefined)}/>}
 </CanvasPresentationContext.Provider>;
}
