import { useEffect, useMemo, useRef, useState } from 'react';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';
import { orderedOutputNames } from '../../platform/contracts/flowNaming';
import { beginBindingRead, canApplyBinding, settleBindingRead, type BindingRead, type BoundOutputName } from './namingBindings';
type Naming = NonNullable<ProjectV1['naming']>;
export type { BoundOutputName };
/** Draft fields become one Board edit, so Apply/Undo includes all settings. The sample is
 * computed from the bound filenames Save actually reads, so a Pending file that reserves
 * 0010 shifts the sample exactly as Save will. Every read carries a token: a superseded or
 * late answer is dropped, and only a ready read of the current token may be applied. */
export function FlowNaming({ project, onApply, onCancel, loadBindings }: {
  project: ProjectV1; onApply: (name: string, naming: Naming) => Promise<void>; onCancel: () => void;
  loadBindings: (project: ProjectV1) => Promise<BoundOutputName[]>;
}) {
  const [name, setName] = useState(project.name);
  const [naming, setNaming] = useState<Naming>(project.naming ?? { sceneCode: 'scene', artistName: 'artist', version: 'v001' });
  const [busy, setBusy] = useState(false);
  const token = useMemo(() => Symbol('naming bindings'), [project, loadBindings]);
  const [received, setRead] = useState<BindingRead>(() => beginBindingRead(token));
  // Invalidate immediately on render, before the next read effect starts.
  const read = received.token === token ? received : beginBindingRead(token);
  const composing = useRef(false);
  useEffect(() => {
    setRead(beginBindingRead(token));
    let active = true;
    loadBindings(project).then(
      names => { if (active) setRead(current => settleBindingRead(current, token, { names })); },
      error => { if (active) setRead(current => settleBindingRead(current, token, { error: String(error instanceof Error ? error.message : error) || '读取失败' })); });
    return () => { active = false; };
  }, [loadBindings, project, token]);
  const bindings = read.status === 'ready' ? read.names : undefined;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || busy) return;
      // Never swallow the Escape that cancels an IME candidate window.
      if (event.isComposing || event.keyCode === 229 || composing.current) { composing.current = false; return; }
      onCancel();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy, onCancel]);
  const preview = useMemo(() => {
    if (!bindings) return { names: [] as string[], error: '' };
    try {
      const names = orderedOutputNames({ ...project, name, naming }, bindings);
      return { names: project.shots.map(shot => names.get(shot.id) ?? shot.name), error: '' };
    } catch { return { names: [] as string[], error: '这些设置生成的文件名过长，请缩短项目名、场次、作者或版本。' }; }
  }, [project, name, naming, bindings]);
  const blocked = !canApplyBinding(read) || !!preview.error;
  const field = (label: string, value: string, set: (next: string) => void, focus = false) =>
    <label className="wb-sheet-field"><span>{label}</span><input value={value} disabled={busy} autoFocus={focus}
      onFocus={event => event.currentTarget.select()} onChange={event => set(event.target.value)}
      onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} /></label>;
  return <form className="wb-sheet" aria-label="命名" aria-modal="true" role="dialog"
    onSubmit={event => {
      event.preventDefault();
      if (composing.current) return;
      if (busy || blocked) return;
      setBusy(true); void onApply(name, naming).catch(() => setBusy(false));
    }}>
    <h2>命名</h2>
    <p className="wb-sheet-note">保存时按此规则为故事板生成文件名。</p>
    <div className="wb-sheet-group">
      {field('项目', name, setName, true)}
      <div className="wb-sheet-row">
        {field('场次', naming.sceneCode, value => setNaming({ ...naming, sceneCode: value }))}
        {field('作者', naming.artistName, value => setNaming({ ...naming, artistName: value }))}
        {field('版本', naming.version, value => setNaming({ ...naming, version: value }))}
      </div>
    </div>
    <div className="wb-sheet-preview" aria-live="polite">
      <span className="wb-sheet-label">预览</span>
      {read.status === 'loading' ? <p className="wb-sheet-count">正在读取实际文件名…</p>
        : read.status === 'error' ? <p className="wb-sheet-error">无法读取实际文件名，暂不能预览或应用：{read.message}</p>
        : preview.error ? <p className="wb-sheet-error">{preview.error}</p>
        : preview.names.length ? <>
          {preview.names.slice(0, 2).map(sample => <code key={sample}>{sample}</code>)}
          <p className="wb-sheet-count">{preview.names.length > 2 ? `… 共 ${preview.names.length} 张，按故事板顺序编号` : `共 ${preview.names.length} 张`}</p>
        </> : <p className="wb-sheet-count">还没有故事板，保存时按此规则生成新文件。</p>}
    </div>
    <footer className="wb-sheet-actions">
      <button type="button" onClick={onCancel} disabled={busy}>取消</button>
      <button type="submit" className="primary" disabled={busy || blocked}>{busy ? '应用中…' : '应用'}</button>
    </footer>
  </form>;
}
