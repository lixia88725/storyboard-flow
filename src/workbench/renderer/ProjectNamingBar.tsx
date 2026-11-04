import type { ProjectNamingState } from './useProjectNaming';

const unsafe = /[\\/:*?"<>|\u0000-\u001f]/;

/** The four naming fields live in the workbench chrome: always visible, always
 * editable. Invalid text is reported in place but does not block other edits or the
 * autosave; only explicit Save waits for a valid value. */
export function ProjectNamingBar({ naming, folderName, disabled }: {
  naming: ProjectNamingState; folderName: string; disabled: boolean;
}) {
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
        onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.blur(); } }} />
    </label>;
  };
  return <div className="wb-project-bar" data-project-naming="true" aria-label="项目命名">
    <span className="wb-project-folder" title="项目名只影响保存时的文件名，不改变文件夹名">文件夹 {folderName || '—'}</span>
    {field('项目', 'name', naming.draft.name)}
    {field('场次', 'sceneCode', naming.draft.naming.sceneCode)}
    {field('作者', 'artistName', naming.draft.naming.artistName)}
    {field('版本', 'version', naming.draft.naming.version)}
    {naming.composing && <span className="wb-project-issue" role="status">输入法组字中</span>}
    {!naming.composing && naming.issue && <span className="wb-project-issue" role="alert">{naming.issue}</span>}
  </div>;
}
