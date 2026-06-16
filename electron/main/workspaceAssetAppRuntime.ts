import { randomUUID } from "node:crypto";
import { copyFile, rename, unlink } from "node:fs/promises";
import { copyBitmapLayerFile } from "./bitmapLayers.js";
import {
  copyShotAssets,
  type CopyShotAssetsPayload,
  type CopyShotAssetsServiceOptions
} from "./copyShotAssetsService.js";
import type { WorkspaceAssetIpcHandlers } from "./ipc/workspaceAssetHandlers.js";
import { resolveLayerAssetPath } from "./layerAssetService.js";
import { assertPathInsideFolder } from "./pathSafety.js";
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
  copyBitmapLayerFile: copyBitmapLayerFileDependency = copyBitmapLayerFile,
  copyFile: copyFileDependency = copyFile,
  copyShotAssets: copyShotAssetsDependency = copyShotAssets,
  createId = randomUUID,
  createPreview: createPreviewDependency = createPreview,
  previewRootForFolder: previewRootForFolderDependency = previewRootForFolder,
  rename: renameDependency = rename,
  resolveLayerAssetPath: resolveLayerAssetPathDependency = resolveLayerAssetPath,
  unlink: unlinkDependency = unlink,
  uniquePath,
  workspaceCopyTemporaryFileName: workspaceCopyTemporaryFileNameDependency =
    workspaceCopyTemporaryFileName
}: WorkspaceAssetAppRuntimeOptions): WorkspaceAssetIpcHandlers => ({
  copyShotAssets: (payload) =>
    copyShotAssetsDependency(payload as CopyShotAssetsPayload, {
      assertPathInsideFolder: assertPathInsideFolderDependency,
      copyBitmapLayerFile: copyBitmapLayerFileDependency,
      copyFile: copyFileDependency,
      createId,
      createPreview: createPreviewDependency,
      previewRootForFolder: previewRootForFolderDependency,
      rename: renameDependency,
      resolveLayerAssetPath: resolveLayerAssetPathDependency,
      unlink: unlinkDependency,
      uniquePath,
      workspaceCopyTemporaryFileName: workspaceCopyTemporaryFileNameDependency
    })
});
