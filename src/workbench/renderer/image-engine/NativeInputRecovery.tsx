import {useState,useSyncExternalStore} from 'react';
import type {ImageWorkspaceController} from './workspaceController';

/** The full original remains owned by capture until Main proves it has retained
 * that exact original. Export cancellation and uncertain replies release nothing. */
export function NativeInputRecovery({controller:c}:{controller:ImageWorkspaceController}){
 useSyncExternalStore(c.subscribe,()=>JSON.stringify(c.capture.records().filter(r=>r.failure).map(r=>[r.captureId,r.ended,r.stroke.points.length,r.failure])));
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const records=c.capture.records().filter(r=>r.failure);
 if(!records.length)return null;
 const resolve=async(captureId:string,action:'retainAndDiscard'|'exportAndDiscard')=>{
  if(busy)return;setBusy(true);setError('');
  try{await c.resolveCaptured(captureId,action);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
 };
 return <section className="flow-alert" role="alert" aria-label="待处理笔迹">
  <div><strong>有笔迹需要处理</strong><p>已保存的画面不会撤销。未确认的完整输入会先保留为恢复记录，处理完成前不能关闭项目。</p>
   {records.map(r=><div key={r.captureId}><p>{r.failure?.message}</p>
    {!r.ended?<p>请先松开画笔。</p>:<>
     {['capture-budget','invalid-sample'].includes(r.failure?.code??'')&&<button disabled={busy} onClick={()=>c.capture.resolveIncomplete(r.id,'submit-prefix')}>仅提交已采集的部分</button>}
     <button disabled={busy} onClick={()=>void resolve(r.captureId,'retainAndDiscard')}>保留恢复记录，结束本笔</button>
     <button disabled={busy} onClick={()=>void resolve(r.captureId,'exportAndDiscard')}>导出输入副本并结束本笔…</button>
    </>}
   </div>)}
   {error&&<p>{error}</p>}
  </div>
 </section>;
}
