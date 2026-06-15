import path from "node:path";
import { mapWithConcurrency } from "./mapWithConcurrency.js";
import type { WorkspaceTaskProgressReporter } from "./workspaceTaskProgress.js";

export type ImportedImageRecord<SwbMetadata> = {
  imagePath: string;
  previewPath?: string;
  fileName: string;
  width?: number;
  height?: number;
  fingerprint?: string;
  swbMetadata?: SwbMetadata;
};

type ImageMetadata = {
  width?: number;
  height?: number;
};

export type ImageRecordsOptions<SwbMetadata> = {
  createPreview: (imagePath: string, previewRoot: string) => Promise<string>;
  onProgress?: WorkspaceTaskProgressReporter;
  pixelFingerprint: (imagePath: string) => Promise<string>;
  readImageMetadata: (imagePath: string) => Promise<ImageMetadata>;
  readSwbMetadata: (imagePath: string) => Promise<SwbMetadata | undefined>;
  label?: string;
  concurrency?: number;
};

export const createImageRecords = async <SwbMetadata>(
  imagePaths: string[],
  previewRoot: string,
  options: ImageRecordsOptions<SwbMetadata>
): Promise<ImportedImageRecord<SwbMetadata>[]> => {
  let completed = 0;
  return mapWithConcurrency(
    imagePaths,
    options.concurrency ?? 6,
    async (imagePath) => {
      const extension = path.extname(imagePath).toLowerCase();
      const isTiff = extension === ".tif" || extension === ".tiff";
      const previewPath = isTiff ? await options.createPreview(imagePath, previewRoot) : undefined;
      const metadata = await options.readImageMetadata(imagePath);
      const swbMetadata = isTiff ? await options.readSwbMetadata(imagePath) : undefined;

      return {
        imagePath,
        previewPath,
        fileName: path.basename(imagePath),
        width: metadata.width,
        height: metadata.height,
        fingerprint: await options.pixelFingerprint(imagePath),
        swbMetadata
      };
    },
    () => {
      completed += 1;
      options.onProgress?.({
        kind: "open",
        label: options.label,
        current: completed,
        total: imagePaths.length
      });
    }
  );
};
