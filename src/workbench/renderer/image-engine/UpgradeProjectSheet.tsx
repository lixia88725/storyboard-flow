import {useState} from 'react';
import {projectFolderNameFor,folderNameIssue,PROJECT_FIELD_LIMIT} from '../../../platform/contracts/flowProjectFields';
import type {ImageWorkspaceUpgradeDraft,ImageWorkspaceUpgradePatch} from '../../../platform/contracts/imageWorkspace';

export function UpgradeProjectSheet({draft,busy,onChoose,onConfirm,onCancel}:{draft:ImageWorkspaceUpgradeDraft;busy:boolean;onChoose:()=>Promise<void>;onConfirm:(patch:ImageWorkspaceUpgradePatch)=>Promise<void>;onCancel:()=>Promise<void>}){
 const [name,setName]=useState(draft.projectName),[error,setError]=useState(''),[working,setWorking]=useState(false),[composing,setComposing]=useState(false);
 const folderName=projectFolderNameFor(name),nameIssue=folderNameIssue(folderName);
 const run=async(task:()=>Promise<void>)=>{if(busy||working)return;setWorking(true);setError('');try{await task();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setWorking(false);}};
 const disabled=busy||working||draft.state==='running';
 return <div className="wb-naming" data-upgrade-sheet="true"><section className="wb-sheet" role="dialog" aria-modal="true" aria-labelledby="upgrade-title">
  <h2 id="upgrade-title">为这个项目创建新版副本</h2>
  <p>「{draft.sourceLabel}」使用旧版图片引擎。Flow 会在你选择的位置创建新版项目，保留故事板顺序、对白和画稿；原项目不会改动。</p>
  <p>{draft.activeBoards} 张故事板 · {draft.pendingBoards} 张 Pending</p>
  <label className="wb-sheet-field">项目名称<input value={name} maxLength={PROJECT_FIELD_LIMIT} disabled={disabled} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)} onChange={event=>setName(event.target.value)}/></label>
  <div>保存位置 <button disabled={disabled} onClick={()=>void run(onChoose)}>选择位置…</button><span>{draft.destinationLabel??'尚未选择'}</span></div>
  <p>将创建文件夹：{folderName}</p>
  {draft.issues.map((issue,index)=><p key={`${issue.code}-${index}`}>{issue.message}</p>)}
  {error&&<p role="alert">{error}</p>}
  <footer className="wb-sheet-actions"><button disabled={disabled} onClick={()=>void run(onCancel)}>取消</button><button disabled={disabled||composing||!!nameIssue||!draft.destinationLabel||!name.trim()||draft.state==='retained'} onClick={()=>void run(()=>onConfirm({projectName:name}))}>创建副本并打开</button></footer>
 </section></div>;
}
