import { access, lstat, readFile, realpath } from "node:fs/promises";
import { mkdirObserved as mkdir } from './workspaceInitialization.js';
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { writePreviewImage } from "./previewService.js";
import { manualImageImportAdmission, type ManualImportShot } from "../shared/manualImageImportRules.js";
import { hasPendingFileTransaction } from "./pendingFileTransactionService.js";
import { previewPathForImage, previewRootForFolder } from "./previewPaths.js";
import { isFreshStandaloneLayeredTiffPreview } from "../shared/standaloneLayeredInput.js";
import sharp from 'sharp';
import { recordsDerivedPreview, recordDerivedPreview } from './derivedPreviewReceipt.js';
import { assertEditableWorkspaceFormat } from '../shared/workspaceFormat.js';

type Image = { imagePath: string; fileName?: string; width?: number; height?: number; previewPath?: string; swbMetadata?: unknown };
type Project = { shots: ManualImportShot[]; parkedShots?: ManualImportShot[]; pendingBake?: unknown };
const stat = async (p: string) => {
 try { return await lstat(p); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; }
};
const bytes = async (p: string) => {
 try { return await readFile(p); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw e; }
};
const hash = async (p: string) => createHash("sha256").update(await readFile(p)).digest("hex");

// Preview is a derived cache, never evidence that internal PNGs are synced.
// Called only by the explicit second phase while the App loader owns its queue.
export const initializeNormalOpenPreviews = async <S extends { folderPath: string; metadataPath: string; project?: Project; images: Image[] }>(
 scan: S,
 ports: { createImageRecords: (paths: string[], root: string, options: { readOnly: boolean; deferMissingPreviews?: boolean }) => Promise<S["images"]> }
): Promise<S> => {
 assertEditableWorkspaceFormat(scan.project);
 const root = scan.folderPath, previewRoot = previewRootForFolder(root), internal = path.dirname(previewRoot);
 const raw = await bytes(scan.metadataPath);
 if ((raw ? JSON.stringify(JSON.parse(raw.toString())) : undefined) !== (scan.project ? JSON.stringify(scan.project) : undefined)) throw new Error("Preview discovery project changed");
 if (await hasPendingFileTransaction(root)) throw new Error("Pending transaction prevents preview initialization; assets retained");
 for (const p of [root, internal, previewRoot]) {
  const s = await stat(p);
  if (s && (!s.isDirectory() || s.isSymbolicLink())) throw new Error("Unsafe preview directory");
 }
 const images = scan.project ? await ports.createImageRecords([...scan.project.shots, ...(scan.project.parkedShots ?? [])].map(s => s.imagePath), previewRoot, { readOnly: true, deferMissingPreviews: true }) : scan.images;
 const identities = new Map<string, string>();
 const missing: Image[] = [];
 for (const image of images) {
  const relative = path.relative(root, image.imagePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unsafe preview source");
  // Only root / visible Pending sources; no symlink traversal into another workspace.
  const parent = path.dirname(image.imagePath);
  if (parent !== root && parent !== path.join(root, "Pending")) throw new Error("Unsupported preview source parent");
  if (!(await lstat(parent)).isDirectory() || (await lstat(parent)).isSymbolicLink() || !(await lstat(image.imagePath)).isFile() || (await lstat(image.imagePath)).isSymbolicLink()) throw new Error("Unsafe preview source link");
  identities.set(image.imagePath, await hash(image.imagePath));
  if (/\.tiff?$/iu.test(image.imagePath) && !image.previewPath) {
   const target = previewPathForImage(image.imagePath, previewRoot), s = await stat(target);
   if (s && (!s.isFile() || s.isSymbolicLink())) throw new Error("Unsafe preview output");
   if (s) { await access(target, constants.W_OK); }
   missing.push(image);
  }
 }
 // Cache presence is not admission or ownership. Only a finite external layered
 // snapshot may receive a preview before explicit Import in a clean directory.
 const assertFresh = async () => {
  if (!scan.project && ((await stat(path.join(internal, "layers"))) ||
      images.some(i => i.swbMetadata !== undefined && !isFreshStandaloneLayeredTiffPreview(i)))) {
   throw new Error("Preview initialization source is unknown; explicit Import required");
  }
 };
 await assertFresh();
 if (scan.project) {
  const admitted = manualImageImportAdmission(scan.project);
  for (const a of admitted) {
   // Preview generation is a derived display cache, not output-obligation certification.
   // Pending and compatible-external-edit sources keep their token/H0 and lifecycle
   // decision here: only source/asset safety is judged, never synced/H0 equality.
   if (!a.fresh) {
    for (const layer of a.shot.layers ?? []) {
     const asset = (layer as { bitmapPath?: string }).bitmapPath;
     if (!asset || path.isAbsolute(asset)) throw new Error("Unknown preview internal asset");
     const target = path.resolve(root, asset), relative = path.relative(root, target);
     if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Unsafe internal asset");
     const s = await stat(target); if (!s?.isFile() || s.isSymbolicLink() || await realpath(target) !== target) throw new Error("Missing or unsafe internal asset");
     await readFile(target);
    }
   } else {
    for (const layer of a.shot.layers ?? []) if (await stat(path.resolve(root, (layer as { bitmapPath: string }).bitmapPath))) throw new Error("Fresh source has internal edits; assets retained");
   }
  }
 }
 const recheck = async () => {
  await assertFresh();
  const latest = await bytes(scan.metadataPath);
  if (!((raw === undefined && latest === undefined) || raw && latest && raw.equals(latest)) || await hasPendingFileTransaction(root)) throw new Error("Preview project or transaction changed");
  for (const [p, identity] of identities) if (await hash(p) !== identity) throw new Error("Preview source changed");
 };
 await recheck(); // complete finite plan before the first derived-cache write
 if (missing.length) {
  await mkdir(internal, { recursive: true });
  if (!(await lstat(internal)).isDirectory() || (await lstat(internal)).isSymbolicLink()) throw new Error("Unsafe preview directory");
  await mkdir(previewRoot, { recursive: true });
  if (!(await lstat(previewRoot)).isDirectory() || (await lstat(previewRoot)).isSymbolicLink()) throw new Error("Unsafe preview directory");
  await access(previewRoot, constants.W_OK);
  for (const image of missing) {
   await recheck();
   const target = previewPathForImage(image.imagePath, previewRoot), s = await stat(target);
   if (s && (!s.isFile() || s.isSymbolicLink())) throw new Error("Unsafe preview output");
   if (s) await access(target, constants.W_OK);
   await writePreviewImage(image.imagePath, target);
  }
 }
 // Read back actual cache bytes; never publish the pre-initialization records.
 const refreshed = await ports.createImageRecords(images.map(i => i.imagePath), previewRoot, { readOnly: true });
 await recheck();
 if (!scan.project) return { ...scan, images: refreshed };
 const previews = new Map(refreshed.map(i => [i.imagePath, i.previewPath]));
 const patch = (s: ManualImportShot) => ({ ...s, ...(previews.get(s.imagePath) ? { previewPath: previews.get(s.imagePath) } : {}) });
 const derived = { ...scan.project, shots: scan.project.shots.map(patch), parkedShots: scan.project.parkedShots?.map(patch) } as NonNullable<S["project"]>;
 if (recordsDerivedPreview()) {
  const receipts = [];
  for (const shot of [...scan.project.shots, ...(scan.project.parkedShots ?? [])]) {
   const preview = previews.get(shot.imagePath); if (!preview) throw new Error('Derived reader preview missing');
   if (preview !== previewPathForImage(shot.imagePath, previewRoot) || await realpath(preview) !== preview || !(await lstat(preview)).isFile() || (await lstat(preview)).isSymbolicLink()) throw new Error('Derived reader preview alias');
   const sourceBytes = await readFile(shot.imagePath), previewBytes = await readFile(preview);
   const encoded = await sharp(sourceBytes, { unlimited: true }).rotate().resize({ width: 1800, height: 1200, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
   if (!encoded.equals(previewBytes)) throw new Error('Derived reader preview is not the actual source pixels');
   receipts.push({ shotId: shot.id, source: shot.imagePath, sourceDigest: createHash('sha256').update(sourceBytes).digest('hex'), preview, previewDigest: createHash('sha256').update(previewBytes).digest('hex'), pixels: createHash('sha256').update(await sharp(previewBytes).ensureAlpha().raw().toBuffer()).digest('hex') });
  }
  await recheck();
  await recordDerivedPreview({ root, original: scan.project, derived, images: receipts });
 }
 return { ...scan, project: derived };
};
