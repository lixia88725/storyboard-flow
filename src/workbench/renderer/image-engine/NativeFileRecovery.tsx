import {useState} from 'react';
import type {ImageWorkspaceSnapshot} from '../../../platform/contracts/imageWorkspace';
import {imageIssueText} from './presentation';

/** Recovery actions resolve Main-owned obligations. A successful request alone
 * does not hide an image that Main still reports as unavailable. */
export function NativeFileRecovery({snapshot,disabled,inputBlocked=false,onRecover,onRetryImport}:{
 snapshot:ImageWorkspaceSnapshot;disabled:boolean;inputBlocked?:boolean;
 onRecover:()=>Promise<void>;onRetryImport:(importId:string)=>Promise<void>;
}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const shots=[...snapshot.session.project.shots,...snapshot.session.project.parkedShots];
 const affected=shots.flatMap(shot=>{
  const image=snapshot.images[shot.imageId];
  return image&&['unavailable','recoveryPending'].includes(image.availability)?[{shot,image}]:[];
 });
 const batches=(snapshot.files.backgroundImports??[]).filter(b=>['needsAttention','paused','recovering'].includes(b.phase));
 const fileUncertain=!!snapshot.files.recovery||affected.some(({image})=>image.availability==='recoveryPending')||batches.some(b=>b.phase==='recovering');
 // A retained stroke already has its own recovery controls. Do not call it a second file failure.
 const sessionUncertain=snapshot.session.phase==='recovering'&&!inputBlocked;
 const uncertain=fileUncertain||sessionUncertain;
 if(!uncertain&&!affected.length&&!batches.length)return null;
 const run=async(action:()=>Promise<void>)=>{if(busy||disabled||inputBlocked)return;setBusy(true);setError('');try{await action();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}};
 const imports=[...new Set([...affected.flatMap(({image})=>image.content.kind==='source'?[image.content.source.importId]:[]),...batches.map(b=>b.importId)])];
 return <section className="wb-recovery wb-file-recovery" role="alert" aria-label="图片与文件待处理">
  <div><strong>{fileUncertain?'有文件操作需要确认':sessionUncertain?'绘画状态需要核对':'部分图片尚未准备好'}</strong>
   <p>{fileUncertain?'原图和已经接受的编辑仍保留。先核对上次操作的结果，再继续处理。':sessionUncertain?'上次编辑的结果尚未确认，核对后继续。原图和保留的输入不会被删除。':'其他已准备好的故事板仍可使用。重试不会再次添加同一批故事板。'}</p>
   {!!affected.length&&<ul>{affected.map(({shot,image})=><li key={shot.id}>{snapshot.files.outputNames.find(n=>n.shotId===shot.id)?.name??shot.name}：{imageIssueText(image)??'图片暂时不可用'}</li>)}</ul>}
   {batches.map(b=><p key={b.operationId}>{b.phase==='paused'?'新增图片已暂停':b.issue?.message??'新增图片的工作文件尚未完成。'}</p>)}
   {uncertain?<button disabled={disabled||busy||inputBlocked} onClick={()=>void run(onRecover)}>{busy?'正在核对…':'核对并恢复'}</button>:
    imports.map((id,i)=><button key={id} disabled={disabled||busy||inputBlocked} onClick={()=>void run(()=>onRetryImport(id))}>{busy?'正在重试…':imports.length===1?'重试图片处理':`重试第 ${i+1} 批图片`}</button>)}
   {inputBlocked&&<p>先处理上方待确认的笔迹，再核对这些文件。</p>}
   {error&&<p>{error}</p>}
  </div>
 </section>;
}
