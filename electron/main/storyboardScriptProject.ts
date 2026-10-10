import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { recoverFailedImport } from "./importRecovery.js";

import path from "node:path";
import sharp from "sharp";
import { atomicWriteTextFile } from "./fileRenames.js";
import { previewRootForFolder } from "./previewPaths.js";
import { createPreview } from "./previewService.js";
import { pixelFingerprint } from "./imageFingerprintService.js";
import {
  parseStoryboardScriptMarkdown,
  serializeStoryboardScriptMarkdown,
  storyboardScriptFileName
} from "./storyboardScript.js";

const swbFormatVersion = 1;
const sharpSourceOptions = { unlimited: true } as const;
const blankShotPresets = {
  "16:9": { width: 1920, height: 1080 },
  "1.85:1": { width: 1998, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "2.39:1": { width: 2581, height: 1080 },
  "1.43:1": { width: 1544, height: 1080 }
} as const;

type BlankShotPreset = keyof typeof blankShotPresets;

type ImportedImage = {
  imagePath: string;
  previewPath?: string;
  fileName: string;
  width?: number;
  height?: number;
  fingerprint?: string;
};

type Project = {
  pendingBake?: { version: 1; shots: Record<string, { state: "pending"; editToken: string; acceptedOutputIdentity: string }> };
  id: string;
  name: string;
  shots: Array<{
    id: string;
    imagePath: string;
    previewPath?: string;
    fileName: string;
    sourceFileName?: string;
    order: number;
    scriptText?: string;
    layers?: Array<{
      id: string;
      kind: "image" | "paint";
      name: string;
      visible: boolean;
      locked: boolean;
      opacity: number;
      blendMode: "normal" | "multiply" | "screen";
      order: number;
      bitmapPath: string;
      width: number;
      height: number;
    }>;
    activeLayerTarget?: "image" | "sketch";
    activeLayerId?: string;
    sketchLayers?: [];
    swb?: {
      version: number;
      status: "owned";
      canvasWidth: number;
      canvasHeight: number;
      baseFingerprint?: string;
    };
  }>;
  dialogues: [];
  createdAt: string;
  updatedAt: string;
};

type FolderScanPayload = {
  folderPath: string;
  folderName: string;
  metadataPath: string;
  project?: Project;
  images: ImportedImage[];
  scriptImportNeeded?: boolean;
  preserveProjectWithoutImageMerge?: boolean;
};

export type CreateProjectFromStoryboardScriptOptions = {
  normalSave?: boolean;
  normalSaveSource?: unknown;
  sourceMarkdownPath: string;
  targetFolderPath: string;
  blankShotPreset: BlankShotPreset;
};

export const inspectStoryboardScriptMarkdownFile = async (
  sourceMarkdownPath: string
): Promise<{ fileName: string; entryCount: number }> => {
  const markdown = await readFile(sourceMarkdownPath, "utf8");
  return {
    fileName: path.basename(sourceMarkdownPath),
    entryCount: parseStoryboardScriptMarkdown(markdown).length
  };
};

export const createProjectFromStoryboardScriptMarkdown = async ({
  sourceMarkdownPath,
  targetFolderPath,
  blankShotPreset,
  normalSave
}: CreateProjectFromStoryboardScriptOptions): Promise<FolderScanPayload> => {
  await assertEmptyTargetFolder(targetFolderPath);

  const markdown = await readFile(sourceMarkdownPath, "utf8");
  const entries = parseStoryboardScriptMarkdown(markdown);
  if (entries.length === 0) {
    throw new Error("No numbered storyboard script entries found");
  }

  if (normalSave) return createNormalProject(targetFolderPath, blankShotPreset, entries);

  const previewRoot = previewRootForFolder(targetFolderPath);
  const images: ImportedImage[] = [];
  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    name: path.basename(targetFolderPath) || "Untitled Storyboard",
    shots: [],
    dialogues: [],
    createdAt: now,
    updatedAt: now
  };

  for (const [index, scriptText] of entries.entries()) {
    const imagePath = await createBlankShot(targetFolderPath, blankShotPreset, index);
    const image = await createImageRecord(imagePath, previewRoot);
    images.push(image);
    project.shots.push(createShotFromImage(image, index, scriptText));
  }

  await writeProjectFiles(targetFolderPath, project);

  return {
    folderPath: targetFolderPath,
    folderName: path.basename(targetFolderPath),
    metadataPath: metadataPathForFolder(targetFolderPath),
    project,
    images,
    scriptImportNeeded: false,
    preserveProjectWithoutImageMerge: true
  };
};

const assertEmptyTargetFolder = async (folderPath: string): Promise<void> => {
  const entries = await readdir(folderPath);
  if (entries.length > 0 || entries.includes(".storyboard-workbench")) {
    throw new Error("Choose an empty folder for the storyboard script import");
  }
};

const createBlankShot = async (
  folderPath: string,
  preset: BlankShotPreset,
  index: number
): Promise<string> => {
  await mkdir(folderPath, { recursive: true });
  const size = blankShotPresets[preset] ?? blankShotPresets["16:9"];

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const imagePath = path.join(folderPath, `script_shot_${String(index + 1).padStart(4, "0")}_${attempt}.tiff`);
    try {
      await stat(imagePath);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        await sharp({
          create: {
            width: size.width,
            height: size.height,
            channels: 3,
            background: "#ffffff"
          }
        })
          .tiff()
          .toFile(imagePath);
        return imagePath;
      }

      throw error;
    }
  }

  throw new Error("Could not create a unique blank shot filename");
};

const createImageRecord = async (
  imagePath: string,
  previewRoot: string
): Promise<ImportedImage> => {
  const previewPath = await createPreview(imagePath, previewRoot);
  const metadata = await sharp(imagePath, sharpSourceOptions).metadata();

  return {
    imagePath,
    previewPath,
    fileName: path.basename(imagePath),
    width: metadata.width,
    height: metadata.height,
    fingerprint: await pixelFingerprint(imagePath)
  };
};

const createShotFromImage = (
  image: ImportedImage,
  order: number,
  scriptText: string
): Project["shots"][number] => {
  const shotId = randomUUID();
  const width = image.width ?? 1920;
  const height = image.height ?? 1080;

  return {
    id: shotId,
    imagePath: image.imagePath,
    previewPath: image.previewPath,
    fileName: image.fileName,
    sourceFileName: image.fileName,
    order,
    scriptText,
    sketchLayers: [],
    activeLayerTarget: "image",
    activeLayerId: "layer-image",
    layers: [
      {
        id: "layer-image",
        kind: "image",
        name: "Image",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal",
        order: 0,
        bitmapPath: `.storyboard-workbench/layers/${shotId}/layer-image.png`,
        width,
        height
      }
    ],
    swb: {
      version: swbFormatVersion,
      status: "owned",
      canvasWidth: width,
      canvasHeight: height,
      baseFingerprint: image.fingerprint
    }
  };
};

const writeProjectFiles = async (folderPath: string, project: Project): Promise<void> => {
  const metadataPath = metadataPathForFolder(folderPath);
  await atomicWriteTextFile(metadataPath, `${JSON.stringify(project, null, 2)}\n`, {
    mkdir: async (directoryPath) => {
      await mkdir(directoryPath, { recursive: true });
    },
    writeFile,
    rename,
    unlink
  });
  await writeFile(path.join(folderPath, storyboardScriptFileName), serializeStoryboardScriptMarkdown(project), "utf8");
};

const metadataPathForFolder = (folderPath: string): string =>
  path.join(folderPath, ".storyboard-workbench", "storyboard.project.json");

// New-project-only asset initialization. No existing asset is a completion witness:
// every file is exclusively created, and every pending baseline hashes the actual TIFF.
const createNormalProject = async (
  folderPath: string, preset: BlankShotPreset, entries: string[]
): Promise<FolderScanPayload> => {
  const now = new Date().toISOString();
  const project: Project = { id: randomUUID(), name: path.basename(folderPath) || "Untitled Storyboard",
    shots: [], dialogues: [], createdAt: now, updatedAt: now, pendingBake: { version: 1, shots: {} } };
  const images: ImportedImage[] = [];
  const created: Array<{ filePath: string; hash: string; ino: number; dev: number }> = [];
  const createdDirectories: Array<{ directory: string; ino: number; dev: number }> = [];
  const root = path.resolve(folderPath);
  const assertDirectoryChain = async (directory: string): Promise<void> => {
    const resolved = path.resolve(directory);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("Storyboard directory escapes target");
    const chain: string[] = [];
    for (let current = resolved;; current = path.dirname(current)) {
      chain.unshift(current);
      if (current === path.dirname(current)) break;
    }
    for (const current of chain) {
      const identity = await lstat(current);
      if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error("Storyboard parent directory is not a real directory; symlink aliases are refused");
      const receipt = createdDirectories.find(item => item.directory === current);
      if (receipt && (identity.ino !== receipt.ino || identity.dev !== receipt.dev)) throw new Error("Created storyboard directory changed; retained for recovery");
    }
  };
  const ensureDirectory = async (directory: string): Promise<void> => {
    if (path.resolve(directory) === root) { await assertDirectoryChain(directory); return; }
    await ensureDirectory(path.dirname(directory));
    try {
      await mkdir(directory);
      const identity = await lstat(directory);
      if (!identity.isDirectory() || identity.isSymbolicLink()) throw new Error("Created storyboard directory replaced by symlink or non-directory");
      createdDirectories.push({ directory: path.resolve(directory), ino: identity.ino, dev: identity.dev });
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    await assertDirectoryChain(directory);
  };
  const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
  const writeNew = async (filePath: string, bytes: Buffer | string) => {
    await ensureDirectory(path.dirname(filePath));
    await assertDirectoryChain(path.dirname(filePath));
    const handle = await open(filePath, "wx");
    try {
      const identity = await handle.stat();
      created.push({ filePath, hash: digest(bytes), ino: identity.ino, dev: identity.dev });
      await handle.writeFile(bytes);
    } finally { await handle.close(); }
  };
  const rollback = async () => {
    const results = await Promise.allSettled(created.map(async item => {
      let identity;
      try { await assertDirectoryChain(path.dirname(item.filePath)); identity = await lstat(item.filePath); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
      if (!identity.isFile() || identity.isSymbolicLink() || identity.ino !== item.ino || identity.dev !== item.dev || digest(await readFile(item.filePath)) !== item.hash) {
        throw new Error("Created storyboard file changed; retained for recovery");
      }
      await unlink(item.filePath);
    }));
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === "rejected").map(r => r.reason);
    for (const item of [...createdDirectories].reverse()) {
      try {
        await assertDirectoryChain(item.directory);
        const identity = await lstat(item.directory);
        if (!identity.isDirectory() || identity.ino !== item.ino || identity.dev !== item.dev) throw new Error("Created storyboard directory changed; retained for recovery");
        await rmdir(item.directory);
      }
      catch (error) {
        // External additions and retained failed files remain; never recursively remove them.
        if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, `New storyboard asset rollback incomplete: ${errors.map(error => error instanceof Error ? error.message : String(error)).join("; ")}`);
  };
  try {
    // Read/parse occurs before this boundary. Recheck the actual empty destination before first effect.
    await assertEmptyTargetFolder(folderPath);
    const size = blankShotPresets[preset] ?? blankShotPresets["16:9"];
    for (const [index, scriptText] of entries.entries()) {
      const imagePath = path.join(folderPath, `script_shot_${String(index + 1).padStart(4, "0")}_0.tiff`);
      const bytes = await sharp({ create: { ...size, channels: 3, background: "#ffffff" } }).tiff().toBuffer();
      await writeNew(imagePath, bytes);
      const previewPath = path.join(previewRootForFolder(folderPath), `${randomUUID()}.png`);
      const png = await sharp(imagePath).ensureAlpha().png().toBuffer();
      await writeNew(previewPath, await sharp(imagePath).resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).png().toBuffer());
      const image: ImportedImage = { imagePath, previewPath, fileName: path.basename(imagePath), ...size,
        fingerprint: await pixelFingerprint(imagePath) };
      const shot = createShotFromImage(image, index, scriptText);
      await writeNew(path.join(folderPath, shot.layers![0].bitmapPath), png);
      const actualHash = digest(await readFile(imagePath));
      if (actualHash !== digest(bytes)) throw new Error("New blank TIFF changed before completion");
      project.pendingBake!.shots[shot.id] = { state: "pending", editToken: randomUUID(), acceptedOutputIdentity: actualHash };
      project.shots.push(shot); images.push(image);
    }
    // Reserve the required MD before any JSON write. An external script appearing here must
    // not be overwritten, nor should its failed admission install meaningless project JSON.
    await writeNew(path.join(folderPath, storyboardScriptFileName), serializeStoryboardScriptMarkdown(project));
    await writeNew(metadataPathForFolder(folderPath), `${JSON.stringify(project, null, 2)}\n`);
    return { folderPath, folderName: path.basename(folderPath), metadataPath: metadataPathForFolder(folderPath),
      project, images, scriptImportNeeded: false, preserveProjectWithoutImageMerge: true };
  } catch (error) { return recoverFailedImport(error, [{ rollback }]); }
};
