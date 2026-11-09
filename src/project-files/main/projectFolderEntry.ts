import fs from 'node:fs/promises';
import path from 'node:path';
import { SOURCE_EXTENSIONS } from './imageSourceConversion.js';

/** Only the current Flow project marker affects folder classification. */
export const FLOW_PROJECT_DIRECTORY = '.storyboard-flow';

export type ProjectFolderEntry =
  | { kind: 'flow' }
  /** A Flow marker that cannot be used as a project. Never falls back to import. */
  | { kind: 'damaged'; reason: string }
  /** A folder of direct images. */
  | { kind: 'images'; imageCount: number }
  | { kind: 'empty' };

const probe = async (root: string, name: string) => {
  try { return await fs.lstat(path.join(root, name)); }
  catch (error) { if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return undefined; throw error; }
};

/** Direct supported images only — the same scope creation reads. Files that are
 * links or folders are not counted here; creation still refuses them by name,
 * so classification never promises an import it cannot perform. */
export async function countDirectImages(root: string): Promise<number> {
  let count = 0;
  for (const item of await fs.readdir(root, { withFileTypes: true })) {
    if (item.name.startsWith('.') || !SOURCE_EXTENSIONS.has(path.extname(item.name).toLowerCase())) continue;
    if (!item.isFile()) continue;
    count += 1;
  }
  return count;
}

/** One read-only look at a folder the user picked. Main keeps the path; the
 * renderer only receives the classification and a draft. */
export async function inspectProjectFolder(root: string): Promise<ProjectFolderEntry> {
  const flow = await probe(root, FLOW_PROJECT_DIRECTORY);
  if (flow) {
    if (!flow.isDirectory() || flow.isSymbolicLink())
      return { kind: 'damaged', reason: `${FLOW_PROJECT_DIRECTORY} 不是普通文件夹` };
    return { kind: 'flow' };
  }
  const imageCount = await countDirectImages(root);
  if (imageCount) return { kind: 'images', imageCount };
  return { kind: 'empty' };
}
