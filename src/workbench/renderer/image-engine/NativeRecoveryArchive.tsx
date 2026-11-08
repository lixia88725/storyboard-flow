import {useEffect,useRef,useState} from 'react';
import type {ImageWorkspaceOutcome} from '../../../platform/contracts/imageWorkspace';
import type {ImageWorkspaceController} from './workspaceController';

type Records=Extract<ImageWorkspaceOutcome,{kind:'retainedInputRecords'}>['records'];
/** Read-only archive browsing. Export uses Main's picker and does not reapply,
 * delete, or reinterpret the archived image operation. */
export function NativeRecoveryArchive({controller:c,onClose}:{controller:ImageWorkspaceController;onClose():void}){
 const [records,setRecords]=useState<Records>([]),[next,setNext]=useState<string|null>(null),[after,setAfter]=useState<string>(),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const working=useRef(false),alive=useRef(true);
 const run=async(task:()=>Promise<void>)=>{if(working.current)return;working.current=true;setBusy(true);setMessage('');try{await task();}catch(error){if(alive.current)setMessage(error instanceof Error?error.message:String(error));}finally{working.current=false;if(alive.current)setBusy(false);}};
 const load=(cursor?:string)=>run(async()=>{
  const result=await c.request({kind:'retainedInputs',...(cursor?{afterRecordId:cursor}:{})});
  if(result.kind!=='retainedInputRecords')throw Error(result.kind==='rejected'?result.error.message:'恢复记录暂时无法读取。');
  if(alive.current){setRecords(result.records);setNext(result.nextAfterRecordId);setAfter(cursor);}
 });
 const exportRecord=(recordId:string)=>run(async()=>{
  c.setInputPause('recovery-export',true);
  try{const result=await c.request({kind:'exportRetainedInput',recordId});
   if(result.kind==='canceled')return;
   if(result.kind!=='retainedInputExported'||result.recordId!==recordId)throw Error(result.kind==='rejected'?result.error.message:'导出结果尚未确认；项目中的原记录仍保留。');
   if(alive.current)setMessage('输入副本已导出，项目中的恢复记录仍保留。');
  }finally{c.setInputPause('recovery-export',false);}
 });
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[c]);
 return <div className="wb-naming"><section className="wb-sheet" role="dialog" aria-modal="true" aria-labelledby="native-recovery-title">
  <h2 id="native-recovery-title">恢复记录</h2>
  <p>这里保留了曾经需要处理的完整绘画或图层输入。导出只保存一份记录，不会重新绘画，也不会改变当前项目。</p>
  {!records.length&&!busy&&<p>这一页没有保管的输入记录。</p>}
  <ul>{records.map(record=><li key={record.recordId}>{record.kind==='paint'?'笔迹':'图层编辑'} · 故事板 {record.shotId}{record.capturedThrough!==undefined?` · ${record.capturedThrough} 个采样点`:''} <button disabled={busy} onClick={()=>void exportRecord(record.recordId)}>导出输入副本…</button></li>)}</ul>
  {message&&<p role="status">{message}</p>}
  <footer className="wb-sheet-actions"><button disabled={busy||!after} onClick={()=>void load()}>第一页</button><button disabled={busy||next===null} onClick={()=>void load(next!)}>下一页</button><button disabled={busy} onClick={onClose}>关闭</button></footer>
 </section></div>;
}
