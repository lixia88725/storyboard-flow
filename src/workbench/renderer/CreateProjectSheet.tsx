import { useEffect, useRef, useState } from 'react';
import type { FlowCreateDraftView, FlowCreateIssues } from '../../platform/contracts/flowEditor';
import type { ProjectNamingV1 } from '../../platform/contracts/refactorV1';
import { namingIssue } from '../../platform/contracts/flowNaming';
import { folderNameIssue } from '../../platform/contracts/flowProjectFields';

export type CreateSheetState = {
  draft: FlowCreateDraftView;
  phase: 'editing' | 'creating' | 'issues';
  progress: { done: number; total: number; phase?: 'read' | 'write' } | null;
  issues: FlowCreateIssues | null;
  error: string;
};
export type CreateFields = { folderName: string; name: string; naming: ProjectNamingV1 };

type Props = {
  state: CreateSheetState;
  busy: boolean;
  onChooseSource: (kind: 'files' | 'folder') => void;
  onChooseDestination: () => void;
  onConfirm: (fields: CreateFields) => void;
  onCancel: () => void;
  onAbort: () => void;
  onRespond: (decision: 'continue' | 'cancel') => void;
  onError: (message: string) => void;
};

/** The creation draft stays in Main; this sheet only edits field values and asks
 * Main to run the native pickers, so no path ever crosses the bridge. */
export function CreateProjectSheet(p: Props) {
  const [fields, setFields] = useState<CreateFields>({ folderName: p.state.draft.folderName, name: p.state.draft.name, naming: { ...p.state.draft.naming } });
  const [error, setError] = useState('');
  const touched = useRef({ name: false, folder: false });
  const composing = useRef(false);
  const lastSource = useRef(JSON.stringify(p.state.draft.source));

  // A source choice supplies the project name and folder default. They are adopted only
  // while the corresponding field is untouched, so a later source change cannot overwrite
  // what the user typed. The parent remounts this sheet per draft, so fields reset naturally.
  const sourceKey = JSON.stringify(p.state.draft.source);
  useEffect(() => {
    if (lastSource.current === sourceKey) return;
    lastSource.current = sourceKey;
    setFields(current => ({
      ...current,
      ...(touched.current.name ? {} : { name: p.state.draft.name }),
      ...(touched.current.folder ? {} : { folderName: p.state.draft.folderName })
    }));
  }, [sourceKey, p.state.draft.name, p.state.draft.folderName]);

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

  const issue = namingIssue(fields.name, fields.naming);
  const folderProblem = folderNameIssue(fields.folderName);
  const missing = p.state.draft.source.kind === 'none' ? '请先选择图片或文件夹'
    : !p.state.draft.destination ? '请先选择保存位置' : '';
  const editable = p.state.phase === 'editing' && !p.busy;
  const invalid = missing || folderProblem || issue || '';
  const text = (label: string, key: string, value: string, onChange: (next: string) => void) =>
    <label className="wb-sheet-field" key={key}><span>{label}</span>
      <input value={value} disabled={!editable} spellCheck={false} data-create-field={key}
        onChange={event => onChange(event.target.value)}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; }} />
    </label>;

  const chooseSource = (kind: 'files' | 'folder') => {
    setError('');
    p.onChooseSource(kind);
  };
  const chooseDestination = () => {
    setError('');
    p.onChooseDestination();
  };
  const confirm = () => {
    if (composing.current) { setError('请先完成输入法组字'); p.onError('请先完成输入法组字'); return; }
    const problem = p.state.draft.source.kind === 'none' ? '请先选择图片或文件夹'
      : !p.state.draft.destination ? '请先选择保存位置'
      : folderNameIssue(fields.folderName) || namingIssue(fields.name, fields.naming);
    if (problem) { setError(problem); p.onError(problem); return; }
    setError('');
    p.onError('');
    p.onConfirm({ folderName: fields.folderName, name: fields.name, naming: { ...fields.naming } });
  };
  const setNaming = (key: keyof ProjectNamingV1, value: string) =>
    setFields(current => ({ ...current, naming: { ...current.naming, [key]: value } }));

  return <div className="wb-naming" data-create-sheet="true" data-create-phase={p.state.phase}>
    <section className="wb-sheet" role="dialog" aria-modal="true" aria-label="新建项目">
      <h2>新建项目</h2>
      <p className="wb-sheet-note">项目会保存到新的文件夹；来源图片不会被覆盖。</p>
      <div className="wb-sheet-group">
        <div className="wb-create-source">
          <span>图片</span>
          <div>
            <button type="button" disabled={!editable} onClick={() => chooseSource('files')}>选择多张图片…</button>
            <button type="button" disabled={!editable} onClick={() => chooseSource('folder')}>选择文件夹…</button>
          </div>
          <output data-create-source>{p.state.draft.source.kind === 'none' ? '尚未选择' : p.state.draft.source.label}</output>
        </div>
        <div className="wb-create-source">
          <span>保存位置</span>
          <div><button type="button" disabled={!editable} onClick={chooseDestination}>选择位置…</button></div>
          <output data-create-destination>{p.state.draft.destination?.label ?? '尚未选择'}</output>
        </div>
      </div>
      <div className="wb-sheet-group">
        {text('项目', 'name', fields.name, value => { touched.current.name = true; setFields(current => ({ ...current, name: value })); })}
        <div className="wb-sheet-row">
          {text('场次', 'sceneCode', fields.naming.sceneCode, value => setNaming('sceneCode', value))}
          {text('作者', 'artistName', fields.naming.artistName, value => setNaming('artistName', value))}
          {text('版本', 'version', fields.naming.version, value => setNaming('version', value))}
        </div>
        {text('文件夹名称', 'folderName', fields.folderName, value => { touched.current.folder = true; setFields(current => ({ ...current, folderName: value })); })}
      </div>
      {p.state.phase === 'creating' && <div className="wb-create-progress" data-create-progress="true">
        <progress max={p.state.progress?.total || 1} value={p.state.progress?.done ?? 0} />
        <span>{p.state.progress ? `${p.state.progress.phase === 'write' ? '正在写入' : '正在读取'} ${p.state.progress.done} / ${p.state.progress.total}` : '正在准备…'}</span>
      </div>}
      {p.state.phase === 'issues' && p.state.issues && <div className="wb-create-issues" data-create-issues="true" role="alertdialog" aria-label="部分图片需要确认">
        <p>以下图片需要处理。选择继续会按标注的方式处理，或取消整个创建。</p>
        <ul>{p.state.issues.issues.map(issue => <li key={issue.file}>
          <code>{issue.file}</code><span>{issue.reason}</span><b>{issue.action === 'skip' ? '跳过' : '扁平化'}</b>
        </li>)}</ul>
      </div>}
      {(error || p.state.error) && <p className="wb-sheet-error" role="alert">{p.state.error || error}</p>}
      {!p.state.error && (folderProblem || issue) && p.state.phase === 'editing' && <p className="wb-sheet-error">{folderProblem || issue}</p>}
      <footer className="wb-sheet-actions">
        {p.state.phase === 'editing' && <>
          <button type="button" onClick={p.onCancel} disabled={!editable && !p.busy}>取消</button>
          <button type="button" className="primary" onClick={confirm} disabled={!editable || Boolean(invalid)}>开始创建</button>
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
