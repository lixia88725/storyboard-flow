import { Clapperboard, FolderOpen, Plus } from 'lucide-react';
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
      <header className="launcher-heading">
        <span className="launcher-symbol" aria-hidden="true"><Clapperboard size={30} strokeWidth={1.65} /></span>
        <h1>Storyboard Flow</h1>
      </header>
      <div className="launcher-actions">
        <button className="primary" data-launcher-open="true" disabled={busy} onClick={onOpen}><FolderOpen size={16} aria-hidden="true" />{busy ? '处理中…' : '打开…'}</button>
        <button data-launcher-new="true" disabled={busy} onClick={onCreate}><Plus size={16} aria-hidden="true" />新建项目…</button>
      </div>
      {message && <p className="launcher-message" role="alert">{message}</p>}
      {recent.length > 0 && <section className="launcher-recent" aria-label="最近项目">
        <h2>最近项目</h2>
        <ul>{recent.map(project => <li key={project.id} data-recent-project={project.id} data-recent-available={project.available || undefined} data-recent-target={project.target}>
              {project.available
                ? <button disabled={busy} title={project.target} onClick={() => onOpenRecent(project.id)}>
                    <FolderOpen size={17} aria-hidden="true" />
                    <span className="launcher-recent-label">
                      <span>{project.name}</span>
                      {project.target !== project.name && <small className="launcher-recent-target">{project.target}</small>}
                    </span>
                  </button>
                : <div className="launcher-recent-missing">
                    <span className="launcher-recent-label">
                      <span>{project.name} <small>不可用</small></span>
                      {project.target !== project.name && <small className="launcher-recent-target">{project.target}</small>}
                    </span>
                    <div>
                      <button disabled={busy} onClick={() => void onRelocateRecent(project.id)}>重新定位…</button>
                      <button disabled={busy} onClick={() => void onRemoveRecent(project.id)}>移除</button>
                    </div>
                  </div>}
            </li>)}</ul>
      </section>}
    </section>
  </main>;
}
