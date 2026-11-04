import type { ProjectV1 } from './refactorV1.js';

export type OutputNameEntry = { shotId: string; name: string };

/** Filesystem-unsafe characters, whitespace runs and repeated separators collapse to one underscore. */
const part = (text: string) => text.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').replace(/^\.+/, '');

/** Active boards are emitted in board order as project_scene_stb_artist_version_0010.tif,
 * stepping by ten. Pending keeps its bound names and reserves them from active reuse.
 * Shared by Save and the naming preview so the sample cannot drift from the real output. */
export function orderedOutputNames(project: ProjectV1, entries: readonly OutputNameEntry[]): Map<string, string> {
  const result = new Map(entries.map(e => [e.shotId, e.name]));
  if (!project.naming) return result; // Low-level unconfigured checkpoints preserve bound names.
  const n = project.naming;
  const version = part(n.version) || 'v001';
  const prefix = [part(project.name) || 'project', part(n.sceneCode) || 'scene', 'stb', part(n.artistName) || 'artist', /^\d+$/.test(version) ? `v${version.padStart(3, '0')}` : version].join('_');
  const reserved = new Set(project.parkedShots.map(s => result.get(s.id)?.toLowerCase()));
  let sequence = 0;
  for (const shot of project.shots) {
    let name: string;
    do { name = `${prefix}_${String(++sequence * 10).padStart(4, '0')}.tif`; } while (reserved.has(name.toLowerCase()));
    // TextEncoder, not Buffer: this module is shared with the renderer bundle.
    if (new TextEncoder().encode(name).length > 240) throw Error('Output filename exceeds 240 UTF-8 bytes; shorten naming settings');
    result.set(shot.id, name);
  }
  return result;
}
