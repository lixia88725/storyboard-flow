import { lstat, readFile, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { resolveLayerAssetPath } from "./layerAssetService.js";
import { hasPendingFileTransaction } from "./pendingFileTransactionService.js";

export type MergeSourceIdentity = { bitmapPath: string; dataUrl: string; dev: number; ino: number };
export type MergeCleanupPayload = {
  folderPath: string;
  project: { id: string; shots: Array<{ id: string; layers?: Array<{ bitmapPath: string }> }>;
    parkedShots?: Array<{ id: string; layers?: Array<{ bitmapPath: string }> }> };
  targetBitmapPath: string;
  targetDataUrl: string;
  sources: MergeSourceIdentity[];
};
const png = (url: string) => {
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(url)) throw Error("Invalid captured PNG");
  return Buffer.from(url.slice("data:image/png;base64,".length), "base64");
};

/** Exact post-durable recycling, not atomic multi-file deletion or a lease
 * against hostile concurrent parent/file replacement. Caller retains queue. */
export const cleanupMergedLayerSources = async (payload: MergeCleanupPayload,
  { remove = unlink }: { remove?: typeof unlink } = {}) => {
  const deleted: string[] = [], retained: string[] = [], errors: string[] = [];
  const root = path.resolve(payload.folderPath);
  const metadata = path.join(root, ".storyboard-workbench/storyboard.project.json");
  const validate = async (bitmapPath: string) => {
    const file = resolveLayerAssetPath(root, bitmapPath);
    if (await realpath(root) !== root) throw Error("Cleanup root alias refused");
    let directory = root;
    for (const part of path.relative(root, path.dirname(file)).split(path.sep)) {
      directory = path.join(directory, part);
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw Error("Cleanup directory alias refused");
    }
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || await realpath(file) !== file) throw Error("Cleanup asset alias refused");
    return { file, info };
  };
  const diskMatches = async () => JSON.stringify(JSON.parse(await readFile(metadata, "utf8"))) === JSON.stringify(payload.project);
  try {
    if (await hasPendingFileTransaction(root)) throw Error("Pending transaction prevents merge cleanup");
    const target = await validate(payload.targetBitmapPath);
    const targetMatches = async () => (await readFile(target.file)).equals(png(payload.targetDataUrl));
    if (!await targetMatches()) throw Error("Merge target changed");
    const layers = [...payload.project.shots, ...(payload.project.parkedShots ?? [])].flatMap(s => s.layers ?? []);
    if (!layers.some(l => l.bitmapPath === payload.targetBitmapPath)) throw Error("Merge target is not published");
    if (new Set(payload.sources.map(s => s.bitmapPath)).size !== payload.sources.length) throw Error("Duplicate cleanup input");
    for (const source of payload.sources) {
      try {
        if (!await diskMatches()) throw Error("Durable project changed");
        const file = resolveLayerAssetPath(root, source.bitmapPath);
        if (source.bitmapPath === payload.targetBitmapPath || layers.some(l => resolveLayerAssetPath(root, l.bitmapPath) === file)) throw Error("Merge source still referenced");
        const actual = await validate(source.bitmapPath);
        if (actual.info.dev !== source.dev || actual.info.ino !== source.ino || !(await readFile(file)).equals(png(source.dataUrl))) throw Error("Merge source identity changed");
        if (!await targetMatches() || !await diskMatches()) throw Error("Cleanup durable binding changed");
        await remove(file);
        deleted.push(source.bitmapPath);
      } catch (error) { retained.push(source.bitmapPath); errors.push(String(error)); }
    }
  } catch (error) { retained.push(...payload.sources.map(s => s.bitmapPath)); errors.push(String(error)); }
  return { deleted, retained, errors };
};
