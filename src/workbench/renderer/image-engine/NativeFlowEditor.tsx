import {useCallback,useEffect,useRef,useState} from 'react';
import type {FlowProjectTarget,FlowRecentProject} from '../../../platform/contracts/flowEditor';
import type {ImageWorkspaceBootstrap} from '../../../platform/contracts/imageWorkspace';
import {ProjectLauncher} from '../ProjectLauncher';
import {CreateProjectSheet} from '../CreateProjectSheet';
import {useCreateProject,type TransitionResult} from '../useCreateProject';
import {FlowAlert,errorText} from '../FlowAlert';
import {UpgradeProjectSheet} from './UpgradeProjectSheet';
import {NativeWorkbenchEditor} from './NativeWorkbenchEditor';
import {imageWorkspaceBridge} from './bridge';
import {createImageWorkspaceController,type ImageWorkspaceController} from './workspaceController';

/** Project lifecycle shell. A transition first closes renderer admission, then
 * drains drafts, then asks Main to freeze/certify. Failure reopens admission only
 * after the original Main owner is active again. */
export function NativeFlowEditor(){
 const [controller,setController]=useState<ImageWorkspaceController>(),[recent,setRecent]=useState<FlowRecentProject[]>([]),[currentRecentId,setCurrentRecentId]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[issue,setIssue]=useState('');
 const [upgrade,setUpgrade]=useState<import('../../../platform/contracts/imageWorkspace').ImageWorkspaceUpgradeDraft>();
 const current=useRef<ImageWorkspaceController|undefined>(undefined),transition=useRef(false),flush=useRef<()=>Promise<void>>(async()=>{});
 const retainedClose=useRef<{owner:ImageWorkspaceController;ticket:string}|undefined>(undefined);
 const api=window.flowEditor;
 const refreshRecent=async()=>{const state=await api.launcherState();setRecent(state.recent);setCurrentRecentId(state.currentId);return state;};
 const install=(bootstrap:ImageWorkspaceBootstrap)=>{
  const previous=current.current;
  if(previous&&!previous.dispose())throw Error('原项目还有未处理输入，不能替换窗口。');
  const next=createImageWorkspaceController(imageWorkspaceBridge(),bootstrap);current.current=next;setController(next);
 };
 const beginTransition=()=>{
  if(transition.current)return false;
  transition.current=true;current.current?.setInputPause('transition',true);setBusy(true);return true;
 };
 const endTransition=async(previous:ImageWorkspaceController|undefined)=>{
  if(previous&&current.current===previous){
   let refreshed=false;
   try{await previous.refreshSnapshot();refreshed=true;}catch{/* No proof of active: keep input paused. */}
   previous.setInputPause('transition',!refreshed||previous.snapshot().session.phase!=='active');
  }
  transition.current=false;setBusy(false);
 };
 const launch=useCallback(async(target:FlowProjectTarget):Promise<TransitionResult>=>{
  if(!beginTransition())return{error:'项目正在切换。'};
  const previous=current.current;
  try{
   if(previous){await flush.current();await previous.settleCaptured();}
   const result=await api.launch(target,previous?.owner);
   if(result.canceled)return'unchanged';
   if(result.kind!=='native')throw Error('此项目尚未完成新引擎的副本升级，原项目已保留。');
   install(result.bootstrap);await refreshRecent();setIssue('');return'opened';
  }catch(error){const message=errorText(error);setIssue(message);return{error:message};}
  finally{await endTransition(previous);}
 },[]);
 const create=useCreateProject(launch,setIssue);
 const open=async()=>{try{const choice=await api.chooseOpen();if('canceled' in choice)return;if(choice.kind==='import')await create.adopt(choice.draft);else if(choice.kind==='copy-upgrade')setUpgrade(choice.draft);else await launch({kind:'pending'});}catch(error){setIssue(errorText(error));}};
 useEffect(()=>{
  let live=true;
  void refreshRecent().then(async state=>{if(state.open){const boot=await api.imageWorkspace.bootstrap();if(live)install(boot);}}).catch(error=>{if(live)setIssue(errorText(error));});
  return()=>{live=false;};
 },[]);
 useEffect(()=>api.onClose(id=>{
  const owner=current.current;if(!owner||!beginTransition())return;
  void(async()=>{
   let ticket=retainedClose.current?.owner===owner?retainedClose.current.ticket:undefined;
   try{
    await flush.current();await owner.settleCaptured();
    if(!ticket){
     const prepared=await owner.request({kind:'prepareClose'});
     if(prepared.kind!=='closePrepared')throw Error(prepared.kind==='rejected'?prepared.error.message:'项目尚未准备好关闭。');
     ticket=prepared.ticket;retainedClose.current={owner,ticket};
    }
    // Freeze cannot account for text or pointer samples retained in this renderer.
    await flush.current();await owner.settleCaptured();
    const closed=await api.finishNativeClose(owner.owner,id,ticket);
    if(!closed.ok)throw Error(closed.message??'项目未能确认关闭。');
    if(!owner.dispose())throw Error('窗口仍有未处理输入。');
    current.current=undefined;retainedClose.current=undefined;
   }catch(error){
    setIssue(errorText(error));
    if(ticket){const resumed=await owner.request({kind:'resume',ticket}).catch(()=>null);
     if(resumed&&['settled','recovered'].includes(resumed.kind))retainedClose.current=undefined;
     else setIssue('项目关闭或恢复尚未完成，已保留画稿和恢复记录。可以再次尝试关闭。');
    }
   }finally{await endTransition(owner);}
  })();
 }),[]);
 useEffect(()=>{
  const prevent=(event:BeforeUnloadEvent)=>{if(current.current){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',prevent);return()=>window.removeEventListener('beforeunload',prevent);
 },[]);
 const registerTransition=useCallback((handler:()=>Promise<void>)=>{flush.current=handler;return()=>{if(flush.current===handler)flush.current=async()=>{};};},[]);
 const removeRecent=async(id:string)=>{await api.removeRecent(id);await refreshRecent();};
 const relocateRecent=async(id:string)=>{const outcome=await api.relocateRecent(id);if('ok' in outcome&&!outcome.ok)setIssue(outcome.message);await refreshRecent();};
 const menu=(exportPsd:()=>void,disabled:boolean)=><details className="wb-project-menu"><summary className="wb-document-action">项目</summary><div className="wb-menu wb-project-menu-list">
  <button disabled={busy} onClick={()=>void open()}>打开…</button><button disabled={busy} onClick={()=>void create.begin('blank')}>新建项目…</button>
  <button disabled={busy||disabled} data-export-psd="true" onClick={exportPsd}>另存为 PSD…</button>
  <span className="wb-menu-label">最近项目</span>{recent.map(item=>item.available?<button key={item.id} disabled={busy||item.id===currentRecentId} onClick={()=>void launch({kind:'recent',id:item.id})}>{item.name}{item.id===currentRecentId?' · 当前':''}</button>:<div key={item.id}>{item.name} · 不可用<button onClick={()=>void relocateRecent(item.id)}>重新定位…</button><button onClick={()=>void removeRecent(item.id)}>移除</button></div>)}
 </div></details>;
 return <><FlowAlert message={issue} onDismiss={()=>setIssue('')}/>
  {controller?<NativeWorkbenchEditor key={controller.owner.incarnation} controller={controller} externallyPaused={busy} projectMenu={menu} registerTransition={registerTransition}/>:<ProjectLauncher recent={recent} busy={busy} message="" onOpen={()=>void open()} onCreate={()=>void create.begin('blank')} onOpenRecent={id=>void launch({kind:'recent',id})} onRemoveRecent={removeRecent} onRelocateRecent={relocateRecent}/>}
  {upgrade&&<UpgradeProjectSheet key={upgrade.id} draft={upgrade} busy={busy}
   onChoose={async()=>{const next=await api.upgradeChooseDestination(upgrade.id);if(next)setUpgrade(next);}}
   onCancel={async()=>{await api.upgradeDiscard(upgrade.id);setUpgrade(undefined);}}
   onConfirm={async patch=>{const next=await api.upgradeUpdate(upgrade.id,patch);setUpgrade(next);const result=await launch({kind:'upgrade',draftId:next.id});if(result==='opened')setUpgrade(undefined);else if(typeof result==='object')throw Error(result.error);}}/>}
  {create.state&&<CreateProjectSheet key={create.state.draft.id} state={create.state} busy={busy} onChooseDestination={()=>void create.chooseDestination()} onConfirm={fields=>void create.confirm(fields)} onCancel={()=>void create.cancel()} onAbort={()=>void create.abort()} onRespond={decision=>void create.respond(decision)} onError={create.setError}/>}
 </>;
}
