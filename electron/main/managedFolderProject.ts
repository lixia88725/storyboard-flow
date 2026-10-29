import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

const safeName = (v: unknown): v is string => typeof v === 'string' && !!v && v !== '.' && v !== '..' && path.basename(v) === v && !/[\\\0]/.test(v);

// A new child project, not a rename/migration of the source's legacy metadata.
export const managedProjectDirectory = '.storyboard-flow-project';
export const managedProjectMarker = '.source-folder.json';
export const managedProjectKind = 'Storyboard Flow folder project';

export type ManagedSourceImage = { inputName: string; sourceName: string; sourceHash: string };
export const readManagedProject = async (source: string): Promise<{ folderPath: string; count: number; images?: ManagedSourceImage[] } | undefined> => {
  const target = path.join(source, managedProjectDirectory);
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(target) !== target) throw Error('可编辑项目目录不是普通子文件夹，未改动任何文件。');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const handle = await open(path.join(target, managedProjectMarker), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 1024 * 1024) throw Error('Invalid project marker');
      const marker = JSON.parse(await handle.readFile('utf8'));
      if (marker.kind !== managedProjectKind || marker.version !== 1 || !Number.isSafeInteger(marker.count) || marker.count < 1) throw Error('Invalid project marker');
      if (marker.images !== undefined && (!Array.isArray(marker.images) || marker.images.length !== marker.count || marker.images.some((v: ManagedSourceImage) => !v || !safeName(v.inputName) || !safeName(v.sourceName) || !/^[a-f0-9]{64}$/.test(v.sourceHash)) || new Set(marker.images.map((v: ManagedSourceImage) => v.inputName)).size !== marker.count || new Set(marker.images.map((v: ManagedSourceImage) => v.sourceName)).size !== marker.count)) throw Error('Invalid source mapping');
      return { folderPath: target, count: marker.count, ...(marker.images ? { images: marker.images } : {}) };
    } finally { await handle.close(); }
  } catch {
    throw Error(`可编辑项目目录已存在，但导入记录不完整。文件已保留，请先检查：${target}`);
  }
};

// Display names/recent folders only. This never grants writer authority or
// replaces the real child path used by Save, recovery, observation and History.
export const sourceFolderForManagedProject = async (requested: string): Promise<string> => {
  if (path.basename(requested) !== managedProjectDirectory) return requested;
  const physical = await realpath(requested);
  const source = path.dirname(physical);
  const managed = await readManagedProject(source);
  return managed?.folderPath === physical ? source : requested;
};
