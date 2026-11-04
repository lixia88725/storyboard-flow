import type { FlowRecentProject } from '../../platform/contracts/flowEditor';

/** First window with no project: every action here opens or creates a real target.
 * A recent entry that no longer resolves is shown as unavailable instead of being
 * silently treated as another project. */
export function ProjectLauncher({ recent, busy, message, onCreate, onOpen, onOpenRecent, onRemoveRecent, onRelocateRecent }: {
  recent: FlowRecentProject[]; busy: boolean; message: string;
  onCreate: () => void; onOpen: () => void; onOpenRecent: (id: string) => void;
  onRemoveRecent: (id: string) => Promise<void>; onRelocateRecent: (id: string) => Promise<void>;
}) {
  return <main className="flow-launcher" data-project-launcher="true">
    <section className="launcher-card" aria-label="项目入口">
      <header>
        <h1>Storyboard Flow</h1>
        <p>从故事板图片创建项目，或打开已有的 Flow 项目。</p>
      </header>
      <div className="launcher-actions">
        <button className="primary" disabled={busy} onClick={onCreate}>{busy ? '处理中…' : '新建项目'}</button>
        <button disabled={busy} onClick={onOpen}>打开项目…</button>
      </div>
      {message && <p className="launcher-message" role="alert">{message}</p>}
      <section className="launcher-recent" aria-label="最近项目">
        <h2>最近项目</h2>
        {recent.length
          ? <ul>{recent.map(project => <li key={project.id} data-recent-project={project.id} data-recent-available={project.available || undefined}>
              {project.available
                ? <button disabled={busy} title={project.name} onClick={() => onOpenRecent(project.id)}><span>{project.name}</span></button>
                : <div className="launcher-recent-missing">
                    <span>{project.name}<small>不可用</small></span>
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
