import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readProjectMetadata } from './projectMetadataService.js';
import { metadataPathForFolder } from './imageDiscoveryService.js';
import { isWorkspaceTemporaryImagePath } from './workspaceTemporaryPaths.js';
import { assertEditableWorkspaceFormat } from '../shared/workspaceFormat.js';
import { manualImageImportAdmission } from '../shared/manualImageImportRules.js';
import type { FolderImages, FolderImageRequest, FolderImagePreview, FolderImageCopy } from '../shared/folderImages.js';

import { managedProjectDirectory, managedProjectMarker, managedProjectKind, readManagedProject, sourceFolderForManagedProject } from './managedFolderProject.js';

const extensions = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff', '.webp', '.gif', '.avif']);
const imageName = (name: string) => path.basename(name) === name && extensions.has(path.extname(name).toLowerCase()) && !isWorkspaceTemporaryImagePath(name);
const folder = async (requested: string) => {
  if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0')) throw new Error('Choose an absolute folder path');
  const root = await realpath(requested);
  if (!(await stat(root)).isDirectory()) throw new Error('Choose a folder, not a file');
  return root;
};
const list = async (root: string) => (await readdir(root, { withFileTypes: true }))
  .filter(entry => entry.isFile() && imageName(entry.name)).map(entry => entry.name)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

// Browser reads root image files only; no project writes, preview cache, migration,
// external refresh or hidden layer/recovery traversal is performed here.
export const inspectFolderImages = async (requested: string): Promise<FolderImages> => {
  const root = await folder(requested), files = await list(root);
  const displayFolderPath = await sourceFolderForManagedProject(root);
  if (displayFolderPath !== root) return { folderPath: displayFolderPath, files: await list(displayFolderPath), browse: false, editableFolderPath: root };
  try {
    const managed = await readManagedProject(root);
    if (managed) {
      const project = await readProjectMetadata<Parameters<typeof assertEditableWorkspaceFormat>[0]>(metadataPathForFolder(managed.folderPath));
      // Full Open still validates assets and recovery. A directory/marker alone
      // never becomes an editable project or causes an automatic re-import.
      if (project) {
        assertEditableWorkspaceFormat(project);
        if (manualImageImportAdmission(project).some(item => item.fresh)) return { folderPath: root, files, browse: true };
        return { folderPath: root, files, browse: false, editableFolderPath: managed.folderPath };
      }
      return { folderPath: root, files, browse: true };
    }
  } catch (error) {
    return { folderPath: root, files, browse: true, issue: error instanceof Error ? error.message : String(error) };
  }
  let browse: boolean;
  try {
    const project = await readProjectMetadata<Parameters<typeof assertEditableWorkspaceFormat>[0]>(metadataPathForFolder(root));
    // Keep ordinary image/script Import and empty-folder Create routing.
    // Old projects and additional formats use the managed-child conversion.
    if (!project) browse = files.some(name => !/\.(png|jpe?g|tiff?)$/iu.test(name));
    else {
      try { assertEditableWorkspaceFormat(project); manualImageImportAdmission(project); browse = false; }
      catch { browse = true; }
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    browse = true; // Corrupt project JSON must not hide independently readable images.
  }
  return { folderPath: root, files, browse };
};

const readImage = async (root: string, fileName: string): Promise<Buffer> => {
  if (typeof fileName !== 'string' || !imageName(fileName)) throw new Error('Unsupported image name');
  const handle = await open(path.join(root, fileName), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Image is not a regular file');
    return await handle.readFile();
  } finally { await handle.close(); }
};

export const readFolderImagePreview = async (request: FolderImageRequest): Promise<FolderImagePreview> => {
  const root = await folder(request.folderPath), bytes = await readImage(root, request.fileName);
  const result = await sharp(bytes).rotate().resize({ width: 640, height: 480, fit: 'inside', withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  return { dataUrl: `data:image/png;base64,${result.data.toString('base64')}`, width: result.info.width, height: result.info.height };
};

// Explicit Import alone creates a managed child. Source images and old project
// records are never rewritten; all normal writer/recovery checks remain active.
export const copyFolderImagesForImport = async (requested: string,
  assertDestination: (paths: readonly string[]) => Promise<void>): Promise<FolderImageCopy> => {
  const root = await folder(requested);
  const existing = await readManagedProject(root);
  if (existing) {
    await assertDestination([existing.folderPath]);
    const project = await readProjectMetadata<Parameters<typeof assertEditableWorkspaceFormat>[0]>(metadataPathForFolder(existing.folderPath));
    if (project) assertEditableWorkspaceFormat(project);
    const importRequired = !project || manualImageImportAdmission(project).some(item => item.fresh);
    return { folderPath: existing.folderPath, count: existing.count, importRequired };
  }
  const files = await list(root);
  if (!files.length) throw new Error('这个文件夹中没有可导入的图片。');
  const destination = path.join(root, managedProjectDirectory);
  await assertDestination([destination]);
  // Exclusive creation refuses collisions and aliases. Failed copies are retained,
  // never overwritten or mistaken for a completed editable project.
  await mkdir(destination, { mode: 0o700 });
  let count = 0;
  const images: { inputName: string; sourceName: string; sourceHash: string }[] = [];
  try {
    for (const fileName of files) {
      const bytes = await readImage(root, fileName);
      const png = await sharp(bytes).rotate().png().toBuffer();
      const name = `${String(count + 1).padStart(4, '0')}-${path.parse(fileName).name}.png`;
      await writeFile(path.join(destination, name), png, { flag: 'wx', mode: 0o600 });
      images.push({ inputName: name, sourceName: fileName, sourceHash: createHash('sha256').update(bytes).digest('hex') });
      count++;
    }
    await writeFile(path.join(destination, managedProjectMarker), JSON.stringify({ kind: managedProjectKind, version: 1, count, images }), { flag: 'wx', mode: 0o600 });
    return { folderPath: destination, count, importRequired: true };
  } catch (error) {
    throw new Error(`已准备 ${count} 张图片，导入尚未完成。原图未改动，已生成的文件保留在：${destination}。${error instanceof Error ? error.message : String(error)}`);
  }
};
