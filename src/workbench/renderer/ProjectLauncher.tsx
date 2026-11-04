import type { FlowRecentProject } from '../../platform/contracts/flowEditor';

/** First window with no project: every action here opens or creates a real target.
 * A recent entry that no longer resolves is shown as unavailable instead of being
 * silently treated as another project. */
export function ProjectLauncher({ recent, busy, message, onCreate, onOpen, onOpenRecent }: {
  recent: FlowRecentProject[]; busy: boolean; message: string;
  onCreate: () => void; onOpen: () => void; onOpenRecent: (id: string) => void;
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
          ? <ul>{recent.map(project => <li key={project.id}>
              <button disabled={busy || !project.available} title={project.available ? project.name : '文件夹已不可用'}
                onClick={() => onOpenRecent(project.id)}>
                <span>{project.name}</span>
                {!project.available && <small>不可用</small>}
              </button>
            </li>)}</ul>
          : <p>还没有打开过项目。</p>}
      </section>
    </section>
  </main>;
}
