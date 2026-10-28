import { useEffect, useRef, useState } from 'react';
import type { PartialSaveBootstrap, PartialSaveEdit, ReadonlyRecovery } from '../shared/readonlyRecovery';
import type { Project } from '../shared/types';
import type { WorkspaceRootObservation } from './workspaceSlots';
import { ownedStageRetryMessage } from './ownedStageRetryDisplay';
import { startupResumeTarget } from './workspaceAutoRestore';
import { App } from './App';
/** Recovery presentation never mounts App/SketchPad, plans or writer controllers.
 * All retained descriptions are text; only certified raster data URLs are decoded. */
export const RecoveryEntry = () => {
 const [folder,setFolder]=useState(new URLSearchParams(location.hash.slice(1)).get('readonlyRecovery')??'');
 const [loaded,setLoaded]=useState<{root:WorkspaceRootObservation;recovery:ReadonlyRecovery;eligible?:boolean}>();
 const [editing,setEditing]=useState<PartialSaveBootstrap>();
 const recovery=loaded?.recovery;
 const [normal,setNormal]=useState(false);
 const [issue,setIssue]=useState('');
 const [busy,setBusy]=useState(false),[outcome,setOutcome]=useState<{version:string;message:string}>();
 const pending=useRef(false),readTicket=useRef(0),active=useRef<typeof loaded>(undefined);
 active.current=loaded;
 // A user who already has a workspace should land in it, not on an empty entry
 // screen — before and after a renderer reload. If that workspace is protected
 // (an earlier session did not close cleanly), fall back to the existing
 // read-only recovery view instead of leaving the user with an error dialog.
 const entryTicket=useRef(0);
 useEffect(()=>{if(folder)return;let cancelled=false;const ticket=entryTicket.current;void (async()=>{
  try{
   const target=startupResumeTarget(await window.storyboard.getRecentFolders());
   if(cancelled||entryTicket.current!==ticket)return;
   if(!target){setNormal(true);return;}
   // A protected workspace refuses ordinary writers before any effect; the
   // external-change check hits the same guard without writing, so it separates
   // "open normally" from "show the recovered content read-only".
   let blocked=false;
   try{await window.storyboard.checkExternalChanges({folderPath:target,metadataPath:`${target}/.storyboard-workbench/storyboard.project.json`,project:{id:'probe',name:'probe',shots:[],dialogues:[]}} as any);}
   catch(error){blocked=/protected by a recovery inventory/.test(String(error));}
   if(cancelled||entryTicket.current!==ticket)return;
   if(!blocked){setNormal(true);return;}
   setFolder(target);
   setIssue('This workspace is protected because an earlier session did not close cleanly. Showing it read-only; nothing on disk was changed.');
   await read(target);
  }catch{if(!cancelled&&entryTicket.current===ticket)setNormal(true);}
 })();return()=>{cancelled=true;};},[]);
 useEffect(()=>()=>{active.current=undefined;readTicket.current++;entryTicket.current++;},[]);
 const read=async (p:string)=>{entryTicket.current++;const ticket=++readTicket.current;setNormal(false);try{
  const root=await window.storyboard.observeWorkspace(p);
  if(readTicket.current!==ticket)return;
  const recovery=await window.storyboard.readReadonlyRecovery(root.folderPath);
  if(readTicket.current===ticket){setLoaded({root,recovery});setIssue('');}
  const eligibility=await window.storyboard.inspectPartialSaveContinuation?.({binding:root.binding});
  if(readTicket.current===ticket&&eligibility?.eligible&&eligibility.revision===recovery.revision)setLoaded({root,recovery,eligible:true});
 }catch(e){if(readTicket.current===ticket)setIssue(String(e));}};
 const continueEditing=async()=>{
  if(pending.current||!loaded?.eligible)return;
  const origin=loaded;pending.current=true;setBusy(true);
  try{const bootstrap=await window.storyboard.beginPartialSaveContinuation({binding:origin.root.binding});if(active.current===origin)setEditing(bootstrap);}
  catch(error){if(active.current===origin){setLoaded({...origin,eligible:false});setIssue(String(error));}}
  finally{pending.current=false;setBusy(false);}
 };
 const retry=async(version:string)=>{
  if(pending.current||!loaded)return;
  const origin=loaded;
  pending.current=true;setBusy(true);
  try{
   const result=await window.storyboard.retryOwnedStage({binding:origin.root.binding,failedVersion:version});
   if(active.current===origin)setOutcome({version,message:ownedStageRetryMessage(result)});
  }catch{
   // A failed invoke/bridge can follow a real native effect: do not call it a
   // no-effects refusal or replay it. Preserve the original readonly snapshot.
   if(active.current===origin)setOutcome({version,message:ownedStageRetryMessage({status:'unknown',cleanupOutcome:'unknown',auditOutcome:'unknown',callerValidity:'unknown'})});
  }finally{pending.current=false;setBusy(false);}
 };
 useEffect(()=>{if(folder)void read(folder);},[]);
 useEffect(()=>{
  if(normal||editing)return;
  return window.storyboard.onPrepareCloseRequested(({requestId})=>{
   void window.storyboard.finishCloseCapture({requestId,captureAvailable:true,recoveryRequired:false,busy:false,hasUnsavedChanges:false});
  });
 },[normal,editing]);
 if(editing)return <PartialSaveEditor bootstrap={editing}/>;
 if(normal)return <App/>;
 if(!folder)return <main style={{padding:24}}><p role="status">Opening workspace…</p></main>;
 if(recovery)return <main data-recovery-readonly="true" style={{padding:24,overflow:'auto',height:'100vh'}}>
  <h1>Storyboard Flow — Read-only Recovery</h1>
  <p>Unfinished operation remains protected. No Save, Import, preview generation or automatic repair is performed.</p>
  <p>Certified content revision: {recovery.revision}</p>
  {loaded.eligible&&<button type="button" disabled={busy} onClick={()=>{void continueEditing();}}>Continue editing a new version</button>}
  <p role="status">{issue}</p>
  <pre aria-label="Recovered project">{JSON.stringify(recovery.projectRaw,null,2)}</pre>
  <pre aria-label="Original source metadata and script bytes">{JSON.stringify(recovery.original,null,2)}</pre>
  <pre aria-label="Unfinished operation facts">{JSON.stringify(recovery.effectFacts,null,2)}</pre>
  <h2>Retained selection, transform, draft and interface state</h2>
  <p>Descriptions are shown as inert text, not restored actions. Missing fields were not retained; history hooks and filesystem paths are never executed.</p>
  <pre aria-label="Recovered view state">{recovery.viewState === undefined ? 'View state not retained in this generation.' : JSON.stringify(recovery.viewState,null,2)}</pre>
  <pre aria-label="Recovered continuation state">{recovery.continuationState === undefined ? 'Continuation state not retained in this generation.' : JSON.stringify(recovery.continuationState,null,2)}</pre>
  {recovery.assets.map((a,i)=><figure key={i}><figcaption>{a.role}</figcaption><img alt={a.role} src={a.dataUrl} style={{maxWidth:600}}/>
   {a.role.startsWith('failed-custody/')&&<div>
    <button type="button" disabled={busy} onClick={()=>{void retry(a.role.slice('failed-custody/'.length));}}>Verify and clean this version’s temporary link…</button>
    {outcome?.version===a.role.slice('failed-custody/'.length)&&<p role="status">{outcome.message}</p>}
   </div>}
  </figure>)}
 </main>;
 return <main style={{padding:24}}><h1>Storyboard Flow</h1>
  <button onClick={()=>{entryTicket.current++;readTicket.current++;active.current=undefined;setNormal(true);}}>Open normal workspace</button>
  <h2>Read recovery content only</h2><form onSubmit={e=>{e.preventDefault();void read(folder);}}>
   <input aria-label="Recovery folder path" value={folder} onChange={e=>{entryTicket.current++;readTicket.current++;setFolder(e.target.value);}}/>
   <button type="submit">Read Recovery Content</button>
  </form><p role="status">{issue}</p>
 </main>;
};

type ContinuedAsset={shotId:string;layerId:string;dataUrl:string};
type ContinuedView={project:Project;view:any;edits:Record<string,ContinuedAsset>};
/** Explicit generation-only editor; it has no ordinary source-writing ports. */
const PartialSaveEditor=({bootstrap}:{bootstrap:PartialSaveBootstrap})=>{
 const initial=():ContinuedView=>({project:structuredClone(bootstrap.recovery.projectRaw) as Project,view:structuredClone(bootstrap.recovery.viewState),edits:Object.fromEntries(bootstrap.recovery.assets.filter(a=>a.role.startsWith('continued/')).map(a=>{const [,shotId,layerId]=a.role.split('/');return [`${shotId}/${layerId}`,{shotId,layerId,dataUrl:a.sourceDataUrl??a.dataUrl}];}))});
 const [state,setState]=useState(initial),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false),[issue,setIssue]=useState('');
 const [selected,setSelected]=useState((bootstrap.recovery.viewState as any)?.selectedShotIds?.[0]??(bootstrap.recovery.projectRaw as Project).shots[0]?.id??'');
 const [layerId,setLayerId]=useState(''),[epoch,setEpoch]=useState(0);
 const current=useRef(state),revision=useRef(bootstrap.revision),pending=useRef<Promise<void>|undefined>(undefined),changed=useRef(false),frozen=useRef(false),drawing=useRef(false),ready=useRef(false),canvas=useRef<HTMLCanvasElement>(null);
 current.current=state;
 const payload=():PartialSaveEdit=>({session:bootstrap.session,revision:revision.current,projectRaw:current.current.project,viewState:current.current.view,desiredAssets:Object.values(current.current.edits)});
 const persist=async()=>{
  if(drawing.current)throw new Error('Finish the current drawing before retaining this version.');
  if(pending.current)return pending.current;
  if(!changed.current)return;
  setBusy(true);const captured=payload();
  const operation=(async()=>{const result=await window.storyboard.persistPartialSaveContinuation(captured);revision.current=result.revision;changed.current=false;setDirty(false);setIssue('New recovery version retained. The original operation is still failed, not acknowledged.');})();
  pending.current=operation;
  try{await operation;}finally{pending.current=undefined;setBusy(false);}
 };
 const persistRef=useRef(persist);persistRef.current=persist;
 useEffect(()=>{void window.storyboard.updateCloseGuard({hasUnsavedChanges:dirty,recoveryRequired:true}).catch(error=>setIssue(String(error)));},[dirty]);
 useEffect(()=>{
  const off=window.storyboard.onPrepareCloseRequested(({requestId})=>{
   if(drawing.current){void window.storyboard.finishCloseCapture({requestId,captureAvailable:false,recoveryRequired:true,busy:true,hasUnsavedChanges:true});return;}
   frozen.current=true;void(async()=>{
   try{await persistRef.current();await window.storyboard.finishCloseCapture({requestId,captureAvailable:true,recoveryRequired:true,busy:false,hasUnsavedChanges:false,capture:{slots:[],partialContinuation:payload()}});}
   catch(error){setIssue(String(error));frozen.current=false;await window.storyboard.finishCloseCapture({requestId,captureAvailable:false,recoveryRequired:true,busy:drawing.current,hasUnsavedChanges:true});}
  })();});
  const cancel=window.storyboard.onCloseCancelled(()=>{frozen.current=false;setEpoch(v=>v+1);});
  return()=>{off();cancel();};
 },[]);
 const publish=(next:ContinuedView)=>{current.current=next;changed.current=true;setDirty(true);setState(next);};
 const edit=(modify:(next:ContinuedView)=>void)=>{
  if(frozen.current||pending.current)return;
  const before=current.current,next=structuredClone(before);
  next.view.history.undo.push({project:structuredClone(before.project),selectedShotIds:[selected],fileNameSyncState:'unsynced',continuationEditable:true,continuedAssets:Object.values(before.edits)});
  next.view.history.redo=[];modify(next);publish(next);
 };
 const moveHistory=(direction:'undo'|'redo')=>{
  if(frozen.current||pending.current||drawing.current)return;
  const next=structuredClone(current.current),entries=next.view.history[direction],entry=entries[entries.length-1];
  if(!entry)return;
  entries.pop();next.view.history[direction==='undo'?'redo':'undo'].push({project:next.project,selectedShotIds:[selected],fileNameSyncState:'unsynced',continuationEditable:true,continuedAssets:Object.values(next.edits)});
  next.project=entry.project;
  if(entry.continuationEditable)next.edits=Object.fromEntries((entry.continuedAssets??[]).map((a:ContinuedAsset)=>[`${a.shotId}/${a.layerId}`,a]));
  else for(const asset of entry.layerAssets??[]){const shot=next.project.shots.find(s=>s.layers?.some(l=>l.bitmapPath===asset.bitmapPath)),layer=shot?.layers?.find(l=>l.bitmapPath===asset.bitmapPath);if(shot&&layer&&asset.dataUrl)next.edits[`${shot.id}/${layer.id}`]={shotId:shot.id,layerId:layer.id,dataUrl:asset.dataUrl};}
  const live=[...next.project.shots,...(next.project.parkedShots??[])];
  next.edits=Object.fromEntries(Object.entries(next.edits).filter(([,a])=>live.some(s=>s.id===a.shotId&&s.layers?.some(l=>l.id===a.layerId))));
  next.view.selectedShotIds=entry.selectedShotIds??[];setSelected(next.view.selectedShotIds[0]??next.project.shots[0]?.id??'');publish(next);
 };
 const shot=state.project.shots.find(s=>s.id===selected),layer=shot?.layers?.find(l=>l.id===layerId)??shot?.layers?.find(l=>l.kind==='paint')??shot?.layers?.[0];
 const source=(shotId:string,id:string)=>{
  const direct=state.edits[`${shotId}/${id}`]?.dataUrl??bootstrap.recovery.assets.find(a=>a.role===`desired/${shotId}/${id}`)?.dataUrl??bootstrap.recovery.assets.find(a=>a.role===`original/${shotId}/${id}`)?.dataUrl;
  if(direct)return direct;
  const shot=state.project.shots.find(s=>s.id===shotId),layer=shot?.layers?.find(l=>l.id===id);
  const metadata=(bootstrap.recovery.original as any)?.metadataPath,marker='.storyboard-workbench/storyboard.project.json';
  if(shot?.swb?.status==='owned'||layer?.kind!=='image'||typeof metadata!=='string'||!metadata.endsWith(marker))return undefined;
  const root=metadata.slice(0,-marker.length);
  if(!shot?.imagePath.startsWith(root))return undefined;
  return bootstrap.recovery.assets.find(a=>a.role===`import-source/${shot.imagePath.slice(root.length)}`)?.dataUrl;
 };
 const data=shot&&layer?source(shot.id,layer.id):undefined;
 useEffect(()=>{
  ready.current=false;const target=canvas.current;if(!target||!layer||!data)return;
  let cancelled=false;const image=new Image();image.onload=()=>{if(cancelled)return;const context=target.getContext('2d');if(!context)return;context.clearRect(0,0,target.width,target.height);context.drawImage(image,0,0);ready.current=true;};image.onerror=()=>{if(!cancelled)setIssue('Certified layer could not be decoded; drawing remains disabled.');};image.src=data;return()=>{cancelled=true;};
 },[selected,layer?.id,data,epoch]);
 const point=(event:React.PointerEvent<HTMLCanvasElement>)=>{const rect=event.currentTarget.getBoundingClientRect();return [(event.clientX-rect.left)*event.currentTarget.width/rect.width,(event.clientY-rect.top)*event.currentTarget.height/rect.height];};
 const finishDrawing=(event:React.PointerEvent<HTMLCanvasElement>)=>{
  if(!drawing.current||!shot||!layer)return;drawing.current=false;
  const dataUrl=event.currentTarget.toDataURL('image/png');edit(next=>{next.edits[`${shot.id}/${layer.id}`]={shotId:shot.id,layerId:layer.id,dataUrl};});
 };
 return <main data-partial-save-editor="true" style={{padding:24,overflow:'auto',height:'100vh'}}>
  <h1>Storyboard Flow — New recovery version</h1>
  <p>The failed operation, original images and both original History stacks stay protected. Edit notes and layer pixels here; only new recovery generations are written. Undo and Redo apply retained project and pixel data, never filesystem actions. Import and source-file publication remain unavailable.</p>
  <label>Project name <input aria-label="Continued project name" value={state.project.name} disabled={busy||frozen.current} onChange={e=>edit(next=>{next.project.name=e.target.value;})}/></label>
  <button disabled={busy||frozen.current} onClick={()=>moveHistory('undo')}>Undo retained edit</button><button disabled={busy||frozen.current} onClick={()=>moveHistory('redo')}>Redo retained edit</button>
  <button disabled={busy||!dirty||frozen.current} onClick={()=>{void persist().catch(error=>setIssue(String(error)));}}>Retain new version</button>
  <p role="status">{issue||'Original operation acknowledgement: 0. No original image or failed stage is overwritten.'}</p>
  <label>Storyboard <select aria-label="Continued storyboard" value={selected} disabled={busy||frozen.current} onChange={e=>{setSelected(e.target.value);setLayerId('');publish({...current.current,view:{...current.current.view,selectedShotIds:[e.target.value]}});}}>{state.project.shots.map(s=><option key={s.id} value={s.id}>{s.fileName}</option>)}</select></label>
  {shot&&<section><label>Notes <textarea aria-label="Continued storyboard notes" value={shot.scriptText??''} disabled={busy||frozen.current} onChange={e=>edit(next=>{next.project.shots.find(s=>s.id===shot.id)!.scriptText=e.target.value;})}/></label>
   <label>Layer <select aria-label="Continued layer" value={layer?.id??''} disabled={busy||frozen.current} onChange={e=>setLayerId(e.target.value)}>{shot.layers?.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
   {layer&&data&&<canvas ref={canvas} aria-label="Continued layer drawing" width={layer.width} height={layer.height} style={{maxWidth:'100%',width:600,touchAction:'none',border:'1px solid #888'}} onPointerDown={e=>{
    if(!ready.current||busy||frozen.current||layer.locked)return;const context=e.currentTarget.getContext('2d');if(!context)return;drawing.current=true;e.currentTarget.setPointerCapture(e.pointerId);const [x,y]=point(e);context.beginPath();context.strokeStyle='#ee4444';context.lineWidth=6;context.lineCap='round';context.moveTo(x,y);context.lineTo(x+.1,y+.1);context.stroke();
   }} onPointerMove={e=>{if(!drawing.current)return;const context=e.currentTarget.getContext('2d');if(context){const [x,y]=point(e);context.lineTo(x,y);context.stroke();}}} onPointerUp={finishDrawing} onPointerCancel={finishDrawing}/>}</section>}
  <details><summary>Original failure and retained History evidence</summary><pre>{JSON.stringify({facts:bootstrap.recovery.effectFacts,continuation:bootstrap.recovery.continuationState,history:(bootstrap.recovery.viewState as any)?.history},null,2)}</pre></details>
 </main>;
};
