import path from "node:path";

export type CopyShotAssetsPayload = {
  folderPath: string;
  sourceImagePath: string;
  fileName: string;
  layerCopies: Array<{
    sourceBitmapPath: string;
    targetBitmapPath: string;
  }>;
};

export type CopyShotAssetsResult = CopyShotAssetsPayload & {
  imagePath: string;
  previewPath: string;
};

export type CopyShotAssetsServiceOptions = {
  assertPathInsideFolder: (folderPath: string, filePath: string) => void;
  copyBitmapLayerFile: (sourcePath: string, targetPath: string) => Promise<void>;
  copyFile: (sourcePath: string, targetPath: string) => Promise<void>;
  createId: () => string;
  createPreview: (imagePath: string, previewRoot: string) => Promise<string>;
  previewRootForFolder: (folderPath: string) => string;
  rename: (sourcePath: string, targetPath: string) => Promise<void>;
  resolveLayerAssetPath: (folderPath: string, bitmapPath: string) => string;
  unlink: (filePath: string) => Promise<void>;
  uniquePath: (directory: string, fileName: string) => Promise<string>;
  workspaceCopyTemporaryFileName: (fileName: string, id: string) => string;
};

export const copyShotAssets = async (
  payload: CopyShotAssetsPayload,
  options: CopyShotAssetsServiceOptions
): Promise<CopyShotAssetsResult> => {
  options.assertPathInsideFolder(payload.folderPath, payload.sourceImagePath);
  const targetImagePath = await options.uniquePath(
    path.dirname(payload.sourceImagePath),
    `copy-${payload.fileName}`
  );
  const temporaryImagePath = await options.uniquePath(
    path.dirname(payload.sourceImagePath),
    options.workspaceCopyTemporaryFileName(payload.fileName, options.createId())
  );
  options.assertPathInsideFolder(payload.folderPath, targetImagePath);
  options.assertPathInsideFolder(payload.folderPath, temporaryImagePath);
  const copiedLayerPaths: string[] = [];

  try {
    await options.copyFile(payload.sourceImagePath, temporaryImagePath);
    for (const item of payload.layerCopies) {
      const targetPath = options.resolveLayerAssetPath(payload.folderPath, item.targetBitmapPath);
      await options.copyBitmapLayerFile(
        options.resolveLayerAssetPath(payload.folderPath, item.sourceBitmapPath),
        targetPath
      );
      copiedLayerPaths.push(targetPath);
    }
    await options.rename(temporaryImagePath, targetImagePath);
    const previewPath = await options.createPreview(
      targetImagePath,
      options.previewRootForFolder(payload.folderPath)
    );
    options.assertPathInsideFolder(payload.folderPath, previewPath);
    copiedLayerPaths.push(previewPath);
    return {
      ...payload,
      imagePath: targetImagePath,
      fileName: path.basename(targetImagePath),
      previewPath
    };
  } catch (error) {
    await options.unlink(targetImagePath).catch(() => undefined);
    await options.unlink(temporaryImagePath).catch(() => undefined);
    await Promise.all(copiedLayerPaths.map((filePath) => options.unlink(filePath).catch(() => undefined)));
    throw error;
  }
};
