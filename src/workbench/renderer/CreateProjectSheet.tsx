import { useEffect, useRef, useState } from 'react';
import type { FlowCreateDraftView, FlowCreateIssues } from '../../platform/contracts/flowEditor';
import { namingIssue } from '../../platform/contracts/flowNaming';
import { folderNameIssue, projectFolderNameFor } from '../../platform/contracts/flowProjectFields';

export type CreateSheetState = {
  draft: FlowCreateDraftView;
  phase: 'editing' | 'creating' | 'issues';
  progress: { done: number; total: number; phase?: 'read' | 'write' } | null;
  issues: FlowCreateIssues | null;
  error: string;
};
export type CreateFields = { name: string };

type Props = {
  state: CreateSheetState;
  busy: boolean;
  onChooseDestination: () => void;
  onConfirm: (fields: CreateFields) => void;
  onCancel: () => void;
  onAbort: () => void;
  onRespond: (decision: 'continue' | 'cancel') => void;
  onError: (message: string) => void;
};

/** Two entry points share one sheet: opening an image folder and starting a
 * blank project. Both ask only for a name and a location — the new folder is
 * derived from the name, and the source pictures are read, never moved. */
export function CreateProjectSheet(p: Props) {
  const [name, setName] = useState(p.state.draft.name);
  const [error, setError] = useState('');
  const composing = useRef(false);
  const mode = p.state.draft.mode;
  const sourceLabel = p.state.draft.source.kind === 'none' ? '' : p.state.draft.source.label;
  // Preview only: Main derives and validates the same leaf again before creating.
  const folderName = projectFolderNameFor(name, mode === 'images' ? sourceLabel : undefined);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      if (p.state.phase === 'creating') return;
      event.preventDefault();
      if (p.state.phase === 'issues') p.onRespond('cancel');
      else p.onCancel();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [p]);

  const issue = namingIssue(name, p.state.draft.naming);
  const folderProblem = folderNameIssue(folderName);
  const missing = mode === 'images' && p.state.draft.source.kind === 'none' ? '请重新选择图片来源'
    : !p.state.draft.destination ? '请先选择保存位置' : '';
  const editable = p.state.phase === 'editing' && !p.busy;
  const invalid = missing || folderProblem || issue || '';
  const confirm = () => {
    const problem = missing || folderProblem || issue;
    if (composing.current) { setError('请先完成输入法组字'); p.onError('请先完成输入法组字'); return; }
    if (problem) { setError(problem); p.onError(problem); return; }
    setError('');
    p.onError('');
    p.onConfirm({ name });
  };

  return <div className="wb-naming" data-create-sheet="true" data-create-mode={mode} data-create-phase={p.state.phase}>
    <section className="wb-sheet" role="dialog" aria-modal="true" aria-label={mode === 'blank' ? '新建项目' : '创建项目'}>
      <h2>{mode === 'blank' ? '新建项目' : '创建项目'}</h2>
      {mode === 'images'
        ? <p className="wb-sheet-note" data-create-source-note>{sourceLabel} · {p.state.draft.imageCount} 张图片。项目会保存到新的文件夹，来源图片不会被移动或修改。</p>
        : <p className="wb-sheet-note">项目会保存到新的文件夹。创建后可以在这个项目里新建第一张故事板。</p>}
      <div className="wb-sheet-group">
        <label className="wb-sheet-field"><span>项目名称</span>
          <input value={name} disabled={!editable} spellCheck={false} data-create-field="name" autoFocus
            onChange={event => setName(event.target.value)}
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }} />
        </label>
        <div className="wb-create-source">
          <span>保存位置</span>
          <div><button type="button" disabled={!editable} onClick={() => { setError(''); p.onChooseDestination(); }}>选择位置…</button></div>
          <output data-create-destination>{p.state.draft.destination?.label ?? '尚未选择'}</output>
        </div>
        <p className="wb-sheet-hint" data-create-folder>{folderProblem ? folderProblem : `将创建文件夹：${folderName}`}</p>
      </div>
      {p.state.phase === 'creating' && <div className="wb-create-progress" data-create-progress="true">
        <progress max={p.state.progress?.total || 1} value={p.state.progress?.done ?? 0} />
        <span>{p.state.progress ? `${p.state.progress.phase === 'write' ? '正在写入' : '正在读取'} ${p.state.progress.done} / ${p.state.progress.total}` : '正在准备…'}</span>
      </div>}
      {p.state.phase === 'issues' && p.state.issues && <div className="wb-create-issues" data-create-issues="true" role="alertdialog" aria-label="部分图片需要确认">
        <p>以下图片需要处理。选择继续会按标注的方式处理，或取消整个创建。</p>
        <ul>{p.state.issues.issues.map(item => <li key={item.file}>
          <code>{item.file}</code><span>{item.reason}</span><b>{item.action === 'skip' ? '跳过' : item.reason.startsWith('PhotoCraft') ? '兼容导入' : '扁平化'}</b>
        </li>)}</ul>
      </div>}
      {(error || p.state.error) && <p className="wb-sheet-error" role="alert">{p.state.error || error}</p>}
      {!p.state.error && (folderProblem || issue) && p.state.phase === 'editing' && <p className="wb-sheet-error">{folderProblem || issue}</p>}
      <footer className="wb-sheet-actions">
        {p.state.phase === 'editing' && <>
          <button type="button" onClick={p.onCancel} disabled={!editable && !p.busy}>取消</button>
          <button type="button" className="primary" onClick={confirm} disabled={!editable || Boolean(invalid)}>创建并打开</button>
        </>}
        {p.state.phase === 'creating' && <button type="button" onClick={p.onAbort}>取消创建</button>}
        {p.state.phase === 'issues' && <>
          <button type="button" onClick={() => p.onRespond('cancel')}>取消创建</button>
          <button type="button" className="primary" onClick={() => p.onRespond('continue')}>继续创建</button>
        </>}
      </footer>
    </section>
  </div>;
}
