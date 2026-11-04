import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { ProjectNamingState } from './useProjectNaming';

const unsafe = /[\\/:*?"<>|\u0000-\u001f]/;

export function ProjectNamingBar({ naming, folderName, disabled }: {
  naming: ProjectNamingState; folderName: string; disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const title = naming.draft.name.trim() || '未命名项目';
  const close = (restoreFocus: boolean) => {
    if (naming.composing) return;
    void naming.flush().catch(() => {});
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    const input = root.current?.querySelector<HTMLInputElement>('input');
    input?.focus();
    input?.select();
  }, [open]);
  useEffect(() => {
    if (!open || naming.composing) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        void naming.flush().catch(() => {});
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusin', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusin', outside, true);
    };
  }, [open, naming.composing, naming.flush]);
  const field = (label: string, key: 'name' | 'sceneCode' | 'artistName' | 'version', value: string) => {
    const invalid = !value.trim() || unsafe.test(value);
    return <label className="wb-project-field" key={key}>
      <span>{label}</span>
      <input value={value} disabled={disabled} aria-invalid={invalid || undefined}
        data-project-field={key} spellCheck={false}
        onChange={event => naming.setField(key, event.target.value)}
        onFocus={naming.focus}
        onBlur={() => { naming.blur(); void naming.flush().catch(() => {}); }}
        onCompositionStart={naming.beginComposing}
        onCompositionEnd={naming.endComposing}
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); close(true); } }} />
    </label>;
  };
  return <div className="wb-document" ref={root} onKeyDown={event => {
    if (open && event.key === 'Escape' && !event.nativeEvent.isComposing && !naming.composing) {
      event.stopPropagation(); event.preventDefault(); close(true);
    }
  }}>
    <button type="button" ref={trigger} className="wb-document-title" data-project-title
      aria-label={`重命名项目：${title}`} aria-haspopup="dialog" aria-expanded={open}
      aria-controls={open ? panelId : undefined} data-invalid={Boolean(naming.issue) || undefined}
      title={naming.issue || '点击编辑项目名称与命名信息'} disabled={disabled}
      onClick={() => open ? close(true) : setOpen(true)}>
      <span>{title}</span><ChevronDown size={12} aria-hidden/>
    </button>
    {open && <section id={panelId} className="wb-document-popover" role="dialog" aria-label="项目命名" data-project-naming>
      <h2>项目命名</h2>
      {field('项目名称', 'name', naming.draft.name)}
      <div className="wb-document-metadata">
        {field('场次', 'sceneCode', naming.draft.naming.sceneCode)}
        {field('作者', 'artistName', naming.draft.naming.artistName)}
        {field('版本', 'version', naming.draft.naming.version)}
      </div>
      {naming.composing && <span className="wb-project-issue" role="status">输入法组字中</span>}
      {!naming.composing && naming.issue && <span className="wb-project-issue" role="alert">{naming.issue}</span>}
      <footer><span className="wb-project-folder" title={folderName}>文件夹 {folderName || '—'}</span>
        <button type="button" disabled={naming.composing} onClick={() => close(true)}>完成</button></footer>
    </section>}
  </div>;
}
