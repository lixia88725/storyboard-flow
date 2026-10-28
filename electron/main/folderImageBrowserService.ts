import { constants } from 'node:fs';
import { open, readdir, realpath, stat, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { readProjectMetadata } from './projectMetadataService.js';
import { metadataPathForFolder } from './imageDiscoveryService.js';
import { isWorkspaceTemporaryImagePath } from './workspaceTemporaryPaths.js';
import { assertEditableWorkspaceFormat } from '../shared/workspaceFormat.js';
import { manualImageImportAdmission } from '../shared/manualImageImportRules.js';
import type { FolderImages, FolderImageRequest, FolderImagePreview, FolderImageCopy } from '../shared/folderImages.js';

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
  let browse: boolean;
  try {
    const project = await readProjectMetadata<Parameters<typeof assertEditableWorkspaceFormat>[0]>(metadataPathForFolder(root));
    // Keep the existing ordinary PNG/JPEG/TIFF Open→Import workflow. Formats
    // needing conversion first use the browser. Any later normal-open refusal
    // can also fall back to these independently readable root images.
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

// Explicit Import creates only a unique NEW child directory. Each flattened PNG
// is a new external input for the existing Import pipeline, not a claim that an
// old TIFF/JSON/layer set was migrated. Original metadata and artwork stay put.
export const copyFolderImagesForImport = async (requested: string, parentPath: string,
  assertDestination: (paths: readonly string[]) => Promise<void>): Promise<FolderImageCopy> => {
  const root = await folder(requested), parent = await folder(parentPath);
  if (parent === root || parent.startsWith(root + path.sep)) throw new Error('Choose a destination outside the original folder');
  const files = await list(root);
  if (!files.length) throw new Error('No supported images to import');
  await assertDestination([parent]);
  const destination = await mkdtemp(path.join(parent, `${path.basename(root)}-Storyboard-Flow-`));
  let count = 0;
  try {
    for (const fileName of files) {
      const bytes = await readImage(root, fileName);
      const png = await sharp(bytes).rotate().png().toBuffer();
      const name = `${String(count + 1).padStart(4, '0')}-${path.parse(fileName).name}.png`;
      await writeFile(path.join(destination, name), png, { flag: 'wx', mode: 0o600 });
      count++;
    }
    return { folderPath: destination, count };
  } catch (error) {
    throw new Error(`Import preparation stopped after ${count} images. Originals are unchanged; partial copies remain at ${destination}. ${error instanceof Error ? error.message : String(error)}`);
  }
};
