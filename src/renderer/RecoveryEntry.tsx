import { useEffect, useState } from 'react';
import type { ReadonlyRecovery } from '../shared/readonlyRecovery';
import { App } from './App';
/** Recovery presentation never mounts App/SketchPad, plans or writer controllers.
 * All retained descriptions are text; only certified raster data URLs are decoded. */
export const RecoveryEntry = () => {
 const [folder,setFolder]=useState(new URLSearchParams(location.hash.slice(1)).get('readonlyRecovery')??'');
 const [recovery,setRecovery]=useState<ReadonlyRecovery>();
 const [normal,setNormal]=useState(false);
 const [issue,setIssue]=useState('');
 const read=async (p:string)=>{try{setRecovery(await window.storyboard.readReadonlyRecovery(p));setIssue('');}catch(e){setIssue(String(e));}};
 useEffect(()=>{if(folder)void read(folder);},[]);
 useEffect(()=>{
  if(normal)return;
  return window.storyboard.onPrepareCloseRequested(({requestId})=>{
   void window.storyboard.finishCloseCapture({requestId,captureAvailable:true,recoveryRequired:false,busy:false,hasUnsavedChanges:false});
  });
 },[normal]);
 if(normal)return <App/>;
 if(recovery)return <main data-recovery-readonly="true" style={{padding:24,overflow:'auto',height:'100vh'}}>
  <h1>Storyboard Flow — Read-only Recovery</h1>
  <p>Unfinished operation remains protected. No Save, Import, preview generation or automatic repair is performed.</p>
  <p>Certified content revision: {recovery.revision}</p>
  <pre aria-label="Recovered project">{JSON.stringify(recovery.projectRaw,null,2)}</pre>
  <pre aria-label="Original source metadata and script bytes">{JSON.stringify(recovery.original,null,2)}</pre>
  <pre aria-label="Unfinished operation facts">{JSON.stringify(recovery.effectFacts,null,2)}</pre>
  <h2>Retained selection, transform, draft and interface state</h2>
  <p>Descriptions are shown as inert text, not restored actions. Missing fields were not retained; history hooks and filesystem paths are never executed.</p>
  <pre aria-label="Recovered view state">{recovery.viewState === undefined ? 'View state not retained in this generation.' : JSON.stringify(recovery.viewState,null,2)}</pre>
  <pre aria-label="Recovered continuation state">{recovery.continuationState === undefined ? 'Continuation state not retained in this generation.' : JSON.stringify(recovery.continuationState,null,2)}</pre>
  {recovery.assets.map((a,i)=><figure key={i}><figcaption>{a.role}</figcaption><img alt={a.role} src={a.dataUrl} style={{maxWidth:600}}/></figure>)}
 </main>;
 return <main style={{padding:24}}><h1>Storyboard Flow</h1>
  <button onClick={()=>setNormal(true)}>Open normal workspace</button>
  <h2>Read recovery content only</h2><form onSubmit={e=>{e.preventDefault();void read(folder);}}>
   <input aria-label="Recovery folder path" value={folder} onChange={e=>setFolder(e.target.value)}/>
   <button type="submit">Read Recovery Content</button>
  </form><p role="status">{issue}</p>
 </main>;
};
