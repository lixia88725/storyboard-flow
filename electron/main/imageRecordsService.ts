import path from "node:path";
import { mapWithConcurrency } from "./mapWithConcurrency.js";
import type { WorkspaceTaskProgressReporter } from "./workspaceTaskProgress.js";
import type { PreviewReceipt } from "./previewService.js";

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
  createPreview: (imagePath: string, previewRoot: string, readOnly?: boolean, onReceipt?: (receipt: PreviewReceipt) => void) => Promise<string>;
  onPreviewReceipt?: (receipt: PreviewReceipt) => void;
  readOnly?: boolean;
  deferMissingPreviews?: boolean;
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
      let previewPath: string | undefined;
      if (isTiff) {
        try { previewPath = await (options.readOnly ? options.createPreview(imagePath, previewRoot, true) :
          options.onPreviewReceipt ? options.createPreview(imagePath, previewRoot, false, options.onPreviewReceipt) :
          options.createPreview(imagePath, previewRoot)); }
        catch (error) {
          if (!options.readOnly || !options.deferMissingPreviews) throw error;
          // Read-only discovery reports absent cache; explicit phase two must admit it.
        }
      }
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
