import { useState } from 'react';
import type { ProjectV1 } from '../../../electron/shared/refactorV1';
/** Draft fields become one Board edit, so Apply/Undo includes all settings. */
export function FlowNaming({ project, onApply, onCancel }: { project: ProjectV1; onApply: (name: string, naming: NonNullable<ProjectV1['naming']>) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState(project.name);
  const [naming, setNaming] = useState(project.naming ?? { sceneCode: 'scene', artistName: 'artist', version: 'v001' });
  const [busy, setBusy] = useState(false);
  return <form aria-label="Output naming settings" onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); void onApply(name, naming).catch(() => setBusy(false)); }}>
    <label>Project <input aria-label="Project name" value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label>
    {(['sceneCode', 'artistName', 'version'] as const).map((field, index) => <label key={field}>{['Scene', 'Artist', 'Version'][index]} <input aria-label={['Scene code', 'Artist name', 'Output version'][index]} value={naming[field]} disabled={busy} onChange={e => setNaming({ ...naming, [field]: e.target.value })} /></label>)}
    <p>Save applies project_scene_stb_artist_version_0010.tif in board order. Pending keeps its filenames.</p>
    <button disabled={busy} type="submit">Apply naming</button><button disabled={busy} type="button" onClick={onCancel}>Cancel naming</button>
  </form>;
}
