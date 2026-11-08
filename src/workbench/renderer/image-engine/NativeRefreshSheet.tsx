import {useEffect,useRef,useState} from 'react';

import type {ImageWorkspaceRefreshPreview,ImageWorkspaceRefreshChoice} from '../../../platform/contracts/imageWorkspace';
export type RefreshPreviewView=ImageWorkspaceRefreshPreview;
export type RefreshChoice=ImageWorkspaceRefreshChoice;

/** Choice is about the observed external version, never permission to overwrite
 * a later file. Main validates the plan again when the user confirms. */
export function NativeRefreshSheet({preview,onConfirm,onCancel}:{
 preview:RefreshPreviewView;onConfirm:(choices:RefreshChoice[])=>Promise<void>;onCancel:()=>void;
}){
 const [choices,setChoices]=useState<Record<string,RefreshChoice['decision']>>(()=>Object.fromEntries(preview.items.filter(i=>!i.conflict).map(i=>[i.shotId,i.canUseExternal?'useExternal':'keepFlow'])));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLElement>(null);
 useEffect(()=>{
  const previous=document.activeElement as HTMLElement|null;dialog.current?.focus();
  const key=(event:KeyboardEvent)=>{
   if(event.isComposing)return;
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!busy)onCancel();}
   if(event.key==='Tab'){
    const nodes=[...dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)')??[]];
    if(!nodes.length){event.preventDefault();return;}
    const index=nodes.indexOf(document.activeElement as HTMLElement);
    if(event.shiftKey&&index<=0){event.preventDefault();nodes.at(-1)?.focus();}
    else if(!event.shiftKey&&(index===-1||index===nodes.length-1)){event.preventDefault();nodes[0].focus();}
   }
  };
  window.addEventListener('keydown',key,true);return()=>{window.removeEventListener('keydown',key,true);previous?.focus();};
 },[busy,onCancel]);
 const confirm=async()=>{if(busy)return;setBusy(true);setError('');try{await onConfirm(preview.items.map(i=>({shotId:i.shotId,decision:choices[i.shotId]})));}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 return <div className="wb-naming"><section ref={dialog} tabIndex={-1} className="wb-sheet" role="dialog" aria-modal="true" aria-label="取回外部改动">
  <h2>取回外部改动</h2>
  <p className="wb-sheet-note">选择要显示在 Flow 中的版本。此次更新可以撤销；保存时才把 Flow 的画面写回工作文件。</p>
  <div className="wb-refresh-items">{preview.items.map(item=><div key={item.shotId} className="wb-sheet-group">
   <strong>{item.name}</strong>
   <p>{item.change==='missing'?'工作文件已不在原位置。保留 Flow 后，可在下次保存时重建文件。':item.conflict?'这张图在 Flow 和外部软件中都改过，请选择保留哪一版。':'外部软件修改了这张图。'}</p>
   {item.issue&&<p className="wb-sheet-warning">{typeof item.issue==='string'?item.issue:item.issue.message}</p>}
   <label>采用的版本 <select aria-label={`采用的版本 ${item.name}`} disabled={busy} value={choices[item.shotId]??''} onChange={e=>setChoices(old=>({...old,[item.shotId]:e.target.value as RefreshChoice['decision']}))}>
    <option value="" disabled>请选择…</option>
    {item.canUseExternal&&<option value="useExternal">采用外部修改</option>}
    <option value="keepFlow">保留 Flow 画面</option>
   </select></label>
  </div>)}</div>
  {error&&<p className="wb-sheet-error" role="alert">{error}</p>}
  <footer className="wb-sheet-actions"><button disabled={busy} onClick={onCancel}>取消</button><button className="primary" disabled={busy||preview.items.some(i=>!choices[i.shotId])} onClick={()=>void confirm()}>{busy?'正在取回…':'确认选择'}</button></footer>
 </section></div>;
}
