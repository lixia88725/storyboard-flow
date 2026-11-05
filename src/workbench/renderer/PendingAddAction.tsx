import { createPortal } from 'react-dom';
import { useEffect, useRef, useState } from 'react';
import type { FlowPendingAdd, FlowSession } from '../../platform/contracts/flowWave2';
import type { FlowPendingIssues, FlowPendingProgress } from '../../platform/contracts/flowEditor';

type Phase = 'choose' | 'running' | 'issues' | 'error';
type State = {
  open: boolean;
  phase: Phase;
  mode?: 'files' | 'folder';
  operationId?: string;
  progress?: { done: number; total: number; phase?: 'read' | 'write' };
  issues?: FlowPendingIssues;
  error: string;
  unknown: boolean;
  canceling: boolean;
};

const blank: State = { open: false, phase: 'choose', error: '', unknown: false, canceling: false };

/** The Pending panel action. Session owns FIFO, installation and the single undo
 * step; this component only calls the request, shows progress/issues and asks Main
 * to abort the file work. Main never receives a path. */
export function PendingAddAction({ anchor, flow, sessionId, disabled, recovery }: {
  anchor: HTMLSpanElement | null; flow: FlowSession; sessionId: string; disabled: boolean; recovery?: FlowPendingAdd;
}) {
  const [supported, setSupported] = useState(false);
  const [state, setState] = useState<State>(blank);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    let active = true;
    void window.flowEditor!.pendingCapability().then(value => { if (active) setSupported(value); }, () => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const api = window.flowEditor!;
    const offProgress = api.onPendingProgress((progress: FlowPendingProgress) => {
      const current = stateRef.current;
      if (!current.open || progress.operationId !== current.operationId) return;
      setState(value => value.operationId === progress.operationId
        ? { ...value, progress: { done: progress.done, total: progress.total, ...(progress.phase ? { phase: progress.phase } : {}) } }
        : value);
    });
    const offIssues = api.onPendingIssues((issues: FlowPendingIssues) => {
      const current = stateRef.current;
      if (!current.open || issues.operationId !== current.operationId) return;
      setState(value => value.operationId === issues.operationId ? { ...value, phase: 'issues', issues, error: '' } : value);
    });
    return () => { offProgress(); offIssues(); };
  }, []);

  const run = async (mode: 'files' | 'folder', operationId: string) => {
    try {
      const result = await flow.request({ kind: 'pendingAdd', mode, operationId });
      if (result.ok) { setState(blank); return; }
      const message = result.error.message;
      if (!stateRef.current.open) return;
      setState(value => value.operationId === operationId
        ? { ...value, phase: 'error', issues: undefined, error: message, unknown: result.error.effect === 'unknown', canceling: false }
        : value);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState(value => value.operationId === operationId
        ? { ...value, phase: 'error', issues: undefined, error: message, unknown: true, canceling: false }
        : value);
    }
  };
  const start = (mode: 'files' | 'folder') => {
    const operationId = `pending_${crypto.randomUUID()}`;
    setState({ open: true, phase: 'running', mode, operationId, error: '', unknown: false, canceling: false });
    void run(mode, operationId);
  };
  const retry = () => {
    const current = stateRef.current;
    if (!current.mode || !current.operationId) return;
    setState(value => ({ ...value, phase: 'running', issues: undefined, error: '', unknown: false, canceling: false }));
    void run(current.mode, current.operationId);
  };
  const cancel = () => {
    const current = stateRef.current;
    if (!current.operationId) return;
    setState(value => ({ ...value, canceling: true }));
    void window.flowEditor!.cancelPendingAdd(sessionId, current.operationId).catch(error => {
      setState(value => ({ ...value, canceling: false, error: String(error) }));
    });
  };
  const respond = async (decision: 'continue' | 'cancel') => {
    const current = stateRef.current;
    if (!current.issues) return;
    try {
      const accepted = await window.flowEditor!.respondPendingIssues(current.issues.requestId, decision);
      if (!accepted) return;
      setState(value => value.issues?.requestId === current.issues!.requestId
        ? { ...value, issues: undefined, phase: decision === 'continue' ? 'running' : 'error', error: decision === 'cancel' ? '已取消添加' : '' }
        : value);
    } catch (error) {
      setState(value => ({ ...value, issues: undefined, phase: 'error', error: String(error) }));
    }
  };
  const openRecovery = () => {
    if (!recovery) return;
    setState({ open: true, phase: 'error', mode: recovery.mode, operationId: recovery.operationId,
      error: '上次添加结果未确认，需要重试后才能继续编辑。', unknown: true, canceling: false });
  };

  if (!supported) return null;
  const label = recovery && !state.open ? '重试添加' : '添加板';
  // The normal state is an icon; an unresolved add keeps its words so the retry reads clearly.
  const retrying = Boolean(recovery) && !state.open;
  return <>
    {anchor && createPortal(<button type="button" className={`wb-pending-add wb-icon-button${retrying ? ' is-retry' : ''}`} data-recovery={Boolean(recovery) || undefined}
      disabled={disabled || state.open} aria-label={label} title={recovery ? '上次添加未确认，需要重试' : '从图片添加故事板到 Pending'}
      onClick={() => { if (recovery && !state.open) openRecovery(); else setState({ ...blank, open: true }); }}>
      {retrying ? label : <><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.9v6.2M5.5 6.8 8 9.3l2.5-2.5M2.9 11v1.7h10.2V11"/></svg><span className="wb-sr-only">{label}</span></>}
    </button>, anchor)}
    {state.open && <div className="wb-naming" data-pending-add="true" data-pending-phase={state.phase}>
      <section className="wb-sheet" role="dialog" aria-modal="true" aria-label="添加到 Pending">
        <h2>添加到 Pending</h2>
        <p className="wb-sheet-note">新图片加入 Pending；只写入这一批的新文件，现有故事板不改动。</p>
        {state.phase === 'choose' && <div className="wb-sheet-group wb-pending-source">
          <button type="button" onClick={() => start('files')}>选择图片…</button>
          <button type="button" onClick={() => start('folder')}>选择文件夹…</button>
        </div>}
        {state.phase === 'running' && <div className="wb-create-progress" data-pending-progress="true">
          <progress max={state.progress?.total || 1} value={state.progress?.done ?? 0} />
          <span>{state.canceling ? '正在取消…' : state.progress
            ? `${state.progress.phase === 'write' ? '正在写入' : '正在读取'} ${state.progress.done} / ${state.progress.total}`
            : '正在选择图片…'}</span>
        </div>}
        {state.phase === 'issues' && state.issues && <div className="wb-create-issues" data-pending-issues="true" role="alertdialog" aria-label="部分图片需要确认">
          <p>以下图片需要处理。继续会按标注的方式处理，取消则不加入 Pending。</p>
          <ul>{state.issues.issues.map(issue => <li key={issue.file}>
            <code>{issue.file}</code><span>{issue.reason}</span><b>{issue.action === 'skip' ? '跳过' : '扁平化'}</b>
          </li>)}</ul>
        </div>}
        {state.error && <p className="wb-sheet-error" role="alert">{state.error}{state.unknown ? '（仍需重试）' : ''}</p>}
        <footer className="wb-sheet-actions">
          {state.phase === 'choose' && <button type="button" onClick={() => setState(blank)}>取消</button>}
          {state.phase === 'running' && <button type="button" onClick={cancel} disabled={state.canceling}>{state.canceling ? '正在取消…' : '取消添加'}</button>}
          {state.phase === 'issues' && <>
            <button type="button" onClick={() => void respond('cancel')}>取消添加</button>
            <button type="button" className="primary" onClick={() => void respond('continue')}>继续添加</button>
          </>}
          {state.phase === 'error' && <>
            <button type="button" onClick={() => setState(blank)}>关闭</button>
            {state.unknown && <button type="button" className="primary" onClick={retry}>重试</button>}
          </>}
        </footer>
      </section>
    </div>}
  </>;
}
