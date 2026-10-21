import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { createOwnedFile, publishOwnedFile, removeOwnedFile } from "./ownedFileCreation.js";
import { copyBitmapLayerFile } from "./bitmapLayers.js";
import {
  copyShotAssets,
  type CopyShotAssetsPayload,
  type CopyShotAssetsServiceOptions
} from "./copyShotAssetsService.js";
import type { WorkspaceAssetIpcHandlers } from "./ipc/workspaceAssetHandlers.js";
import { resolveLayerAssetPath } from "./layerAssetService.js";
import { withLayerFileOperation } from "./layerFileOperationQueue.js";
import { assertPathInsideFolder, pathEntryExists } from "./pathSafety.js";
import { previewRootForFolder } from "./previewPaths.js";
import { createPreview } from "./previewService.js";
import { workspaceCopyTemporaryFileName } from "./workspaceTemporaryPaths.js";

export type WorkspaceAssetAppRuntimeOptions = Partial<
  Omit<CopyShotAssetsServiceOptions, "uniquePath">
> & {
  copyShotAssets?: typeof copyShotAssets;
  uniquePath: CopyShotAssetsServiceOptions["uniquePath"];
};

export const createWorkspaceAssetAppHandlers = ({
  assertPathInsideFolder: assertPathInsideFolderDependency = assertPathInsideFolder,
  copyBitmapLayerFile: copyBitmapLayerFileDependency = (source, target, onCreated) =>
    copyBitmapLayerFile(source, target, undefined, "create-only", onCreated),
  copyFile: copyFileDependency = async (source, target, onCreated) => {
    await createOwnedFile(target, await readFile(source), onCreated);
  },
  copyShotAssets: copyShotAssetsDependency = copyShotAssets,
  createId = randomUUID,
  createPreview: createPreviewDependency = createPreview,
  previewRootForFolder: previewRootForFolderDependency = previewRootForFolder,
  pathEntryExists: pathEntryExistsDependency = pathEntryExists,
  publishImage: publishImageDependency = publishOwnedFile,
  removeOwnedFile: removeOwnedFileDependency,
  resolveLayerAssetPath: resolveLayerAssetPathDependency = resolveLayerAssetPath,
  unlink: unlinkDependency = unlink,
  uniquePath,
  workspaceCopyTemporaryFileName: workspaceCopyTemporaryFileNameDependency =
    workspaceCopyTemporaryFileName
}: WorkspaceAssetAppRuntimeOptions): WorkspaceAssetIpcHandlers => ({
  copyShotAssets: (payload) =>
    withLayerFileOperation(() => copyShotAssetsDependency(payload as CopyShotAssetsPayload, {
      assertPathInsideFolder: assertPathInsideFolderDependency,
      copyBitmapLayerFile: copyBitmapLayerFileDependency,
      copyFile: copyFileDependency,
      createId,
      createPreview: createPreviewDependency,
      previewRootForFolder: previewRootForFolderDependency,
      pathEntryExists: pathEntryExistsDependency,
      publishImage: publishImageDependency,
      removeOwnedFile: removeOwnedFileDependency ?? (receipt => removeOwnedFile(receipt, unlinkDependency)),
      resolveLayerAssetPath: resolveLayerAssetPathDependency,
      unlink: unlinkDependency,
      uniquePath,
      workspaceCopyTemporaryFileName: workspaceCopyTemporaryFileNameDependency
    }))
});
