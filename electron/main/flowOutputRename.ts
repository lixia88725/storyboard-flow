import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ProjectV1 } from '../shared/refactorV1.js';
import { settleOutputFileMove } from './flowOutputMove.js';

type Entry = { shotId: string; name: string; current: string | null; location?: 'active' | 'parked' };
export type OutputRename = { phase: 'stage' | 'publish'; files: { shotId: string; from: string; stage: string; to: string; digest: string; dev: string; ino: string }[] };
const part = (text: string) => text.trim().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').replace(/^\.+/, '');
export function orderedOutputNames(project: ProjectV1, entries: readonly Entry[]): Map<string, string> {
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
    if (Buffer.byteLength(name) > 240) throw Error('Output filename exceeds 240 UTF-8 bytes; shorten naming settings');
    result.set(shot.id, name);
  }
  return result;
}

/** Preflight all destinations before TIFF writes; only this batch's active source
 * names may occupy another destination (including case-only renames). */
export async function preflightOutputNames(root: string, entries: readonly Entry[], names: Map<string, string>) {
  const sources = new Set(entries.filter(e => (e.location ?? 'active') === 'active').map(e => e.name));
  const disk = new Map<string, string[]>();
  for (const file of await fs.readdir(root)) disk.set(file.toLowerCase(), [...(disk.get(file.toLowerCase()) ?? []), file]);
  for (const entry of entries) {
    const target = names.get(entry.shotId)!;
    if (target === entry.name) continue;
    for (const found of disk.get(target.toLowerCase()) ?? []) if (!sources.has(found)) throw Error(`Output filename collision: ${target}`);
  }
}
export async function prepareOutputRename(root: string, entries: readonly Entry[], names: Map<string, string>): Promise<OutputRename | undefined> {
  const files: OutputRename['files'] = [];
  for (const entry of entries) {
    const to = names.get(entry.shotId)!;
    if (to === entry.name || (entry.location ?? 'active') !== 'active') continue;
    if (!entry.current) throw Error('TIFF must be written before rename');
    const stat = await fs.lstat(path.join(root, entry.name), { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw Error('Unsupported rename source');
    files.push({ shotId: entry.shotId, from: entry.name, to, stage: `.flow-renaming-${randomUUID()}.tif`, digest: entry.current, dev: String(stat.dev), ino: String(stat.ino) });
  }
  return files.length ? { phase: 'stage', files } : undefined;
}
export function validOutputRename(value: unknown): value is OutputRename {
  if (!value || typeof value !== 'object') return false;
  const p = value as OutputRename;
  const leaf = (s: unknown): s is string => typeof s === 'string' && !s.startsWith('.') && /^[^\\/\0]+\.tiff?$/i.test(s);
  return ['stage', 'publish'].includes(p.phase) && Array.isArray(p.files) && p.files.length > 0 && p.files.length <= 10000 && p.files.every(f =>
    f && /^[\w-]{1,80}$/.test(f.shotId) && leaf(f.from) && leaf(f.to) && f.from !== f.to &&
    /^\.flow-renaming-[a-f0-9-]{36}\.tif$/.test(f.stage) && /^[a-f0-9]{64}$/.test(f.digest) && /^\d+$/.test(f.dev) && /^\d+$/.test(f.ino)) &&
    ['shotId', 'from', 'stage', 'to'].every(key => new Set(p.files.map(f => f[key as 'from'].toLowerCase())).size === p.files.length);
}
export async function settleOutputRename(root: string, plan: OutputRename, persistPhase: () => Promise<void>, bind: () => Promise<void>) {
  if (!validOutputRename(plan)) throw Error('Invalid output rename journal');
  if (plan.phase === 'stage') {
    for (const file of plan.files) await settleOutputFileMove(path.join(root, file.from), path.join(root, file.stage), file, bind);
    plan.phase = 'publish'; await persistPhase();
  }
  for (const file of plan.files) {
    // Case-insensitive collision policy also applies on case-sensitive volumes.
    await bind();
    if ((await fs.readdir(root)).some(n => n.toLowerCase() === file.to.toLowerCase() && n !== file.to)) throw Error('Case-folded output collision');
    await settleOutputFileMove(path.join(root, file.stage), path.join(root, file.to), file, bind);
  }
}
