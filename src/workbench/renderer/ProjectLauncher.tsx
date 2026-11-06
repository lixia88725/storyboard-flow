import type { FlowRecentProject } from '../../platform/contracts/flowEditor';

/** First window with no project. The entry offers two actions: Main inspects the
 * folder behind 「打开…」 and decides whether it opens a Flow project or offers to
 * create one from the images inside it. Recent projects stay below as a shortcut;
 * an entry that no longer resolves is shown as unavailable, never recreated. */
export function ProjectLauncher({ recent, busy, message, onCreate, onOpen, onOpenRecent, onRemoveRecent, onRelocateRecent }: {
  recent: FlowRecentProject[]; busy: boolean; message: string;
  onCreate: () => void; onOpen: () => void; onOpenRecent: (id: string) => void;
  onRemoveRecent: (id: string) => Promise<void>; onRelocateRecent: (id: string) => Promise<void>;
}) {
  return <main className="flow-launcher" data-project-launcher="true">
    <section className="launcher-card" aria-label="项目入口">
      <header>
        <h1>Storyboard Flow</h1>
        <p>打开 Flow 项目或图片文件夹，或者从空白项目开始。</p>
      </header>
      <div className="launcher-actions">
        <button className="primary" data-launcher-open="true" disabled={busy} onClick={onOpen}>{busy ? '处理中…' : '打开…'}</button>
        <button data-launcher-new="true" disabled={busy} onClick={onCreate}>新建项目…</button>
      </div>
      {message && <p className="launcher-message" role="alert">{message}</p>}
      <section className="launcher-recent" aria-label="最近项目">
        <h2>最近项目</h2>
        {recent.length
          ? <ul>{recent.map(project => <li key={project.id} data-recent-project={project.id} data-recent-available={project.available || undefined} data-recent-target={project.target}>
              {project.available
                ? <button disabled={busy} title={project.target} onClick={() => onOpenRecent(project.id)}>
                    <span className="launcher-recent-label"><span>{project.name}</span><small className="launcher-recent-target">{project.target}</small></span>
                  </button>
                : <div className="launcher-recent-missing">
                    <span className="launcher-recent-label"><span>{project.name} <small>不可用</small></span><small className="launcher-recent-target">{project.target}</small></span>
                    <div>
                      <button disabled={busy} onClick={() => void onRelocateRecent(project.id)}>重新定位…</button>
                      <button disabled={busy} onClick={() => void onRemoveRecent(project.id)}>移除</button>
                    </div>
                  </div>}
            </li>)}</ul>
          : <p>还没有打开过项目。</p>}
      </section>
    </section>
  </main>;
}
