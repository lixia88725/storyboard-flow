import path from "node:path";
import { mapWithConcurrency } from "./mapWithConcurrency.js";
import type { WorkspaceTaskProgressReporter } from "./workspaceTaskProgress.js";
import type { PreviewReceipt } from "./previewService.js";

export type ImportedImageRecord<FlowMetadata> = {
  imagePath: string;
  previewPath?: string;
  fileName: string;
  width?: number;
  height?: number;
  fingerprint?: string;
  flowMetadata?: FlowMetadata;
};

type ImageMetadata = {
  width?: number;
  height?: number;
};

export type ImageRecordsOptions<FlowMetadata> = {
  createPreview: (imagePath: string, previewRoot: string, readOnly?: boolean, onReceipt?: (receipt: PreviewReceipt) => void) => Promise<string>;
  onPreviewReceipt?: (receipt: PreviewReceipt) => void;
  readOnly?: boolean;
  deferMissingPreviews?: boolean;
  onProgress?: WorkspaceTaskProgressReporter;
  pixelFingerprint: (imagePath: string) => Promise<string>;
  readImageMetadata: (imagePath: string) => Promise<ImageMetadata>;
  readFlowMetadata: (imagePath: string) => Promise<FlowMetadata | undefined>;
  label?: string;
  concurrency?: number;
};

export const createImageRecords = async <FlowMetadata>(
  imagePaths: string[],
  previewRoot: string,
  options: ImageRecordsOptions<FlowMetadata>
): Promise<ImportedImageRecord<FlowMetadata>[]> => {
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
      const flowMetadata = isTiff ? await options.readFlowMetadata(imagePath) : undefined;

      return {
        imagePath,
        previewPath,
        fileName: path.basename(imagePath),
        width: metadata.width,
        height: metadata.height,
        fingerprint: await options.pixelFingerprint(imagePath),
        flowMetadata
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
