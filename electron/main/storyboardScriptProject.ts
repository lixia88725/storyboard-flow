import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { atomicWriteTextFile } from "./fileRenames.js";
import { previewRootForFolder } from "./previewPaths.js";
import { createPreview } from "./previewService.js";
import {
  parseStoryboardScriptMarkdown,
  serializeStoryboardScriptMarkdown,
  storyboardScriptFileName
} from "./storyboardScript.js";

const swbFormatVersion = 1;
const sharpSourceOptions = { unlimited: true } as const;
const blankShotPresets = {
  "16:9": { width: 1920, height: 1080 },
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
  blankShotPreset
}: CreateProjectFromStoryboardScriptOptions): Promise<FolderScanPayload> => {
  await assertEmptyTargetFolder(targetFolderPath);

  const markdown = await readFile(sourceMarkdownPath, "utf8");
  const entries = parseStoryboardScriptMarkdown(markdown);
  if (entries.length === 0) {
    throw new Error("No numbered storyboard script entries found");
  }

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

const pixelFingerprint = async (imagePath: string): Promise<string> => {
  const { data, info } = await sharp(imagePath, sharpSourceOptions)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hash = createHash("sha256");
  hash.update(`${info.width}x${info.height}:${info.channels}:`);
  hash.update(data);
  return hash.digest("hex");
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
