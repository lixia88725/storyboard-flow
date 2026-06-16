import { createBlankShot, type BlankShotPreset } from "./blankShotService.js";
import type { ImageIpcHandlers } from "./ipc/imageHandlers.js";
import { previewRootForFolder } from "./previewPaths.js";

type ImageAppRecord = {
  imagePath: string;
  previewPath?: string;
  fileName: string;
  width?: number;
  height?: number;
  fingerprint?: string;
  swbMetadata?: unknown;
};

type CreateImageRecords = (
  imagePaths: string[],
  previewRoot: string
) => Promise<ImageAppRecord[]>;

export type ImageAppRuntimeOptions = {
  createBlankShot?: typeof createBlankShot;
  createImageRecords: CreateImageRecords;
  previewRootForFolder?: typeof previewRootForFolder;
};

export const createImageAppHandlers = ({
  createBlankShot: createBlankShotDependency = createBlankShot,
  createImageRecords,
  previewRootForFolder: previewRootForFolderDependency = previewRootForFolder
}: ImageAppRuntimeOptions): ImageIpcHandlers => ({
  createBlankShot: async (folderPath, options?: { preset?: BlankShotPreset }) => {
    const imagePath = await createBlankShotDependency(folderPath, options?.preset ?? "16:9");
    const previewRoot = previewRootForFolderDependency(folderPath);
    const [image] = await createImageRecords([imagePath], previewRoot);
    return image;
  }
});
