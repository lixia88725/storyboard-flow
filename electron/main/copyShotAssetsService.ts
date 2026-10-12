import path from "node:path";
import type { OwnedFileReceipt } from "./ownedFileCreation.js";
import type { PreviewReceipt } from "./previewService.js";
import { FileReplacementRecoveryIncompleteError } from "./fileRenames.js";
import { hasUnresolvedProtectedWrite, ProtectedLayerWriteError } from "./protectedLayerFileWriter.js";

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

export type RetainedCopyEffect = { filePath: string; kind: "image" | "layer" | "preview" | "staging"; effect: "committed" | "unknown" };

/** Never interpret an incomplete copy as a successful shot or zero effects. */
export class CopyCleanupIncompleteError extends AggregateError {
  readonly cleanupIncomplete = true;
  readonly recoveryIncomplete = true;
  readonly code = "COPY_RECOVERY_INCOMPLETE";

  constructor(error: unknown, failures: unknown[], readonly retainedEffects: RetainedCopyEffect[]) {
    const details = failures.map((failure) => (failure instanceof Error ? failure.message : String(failure))).join("; ");
    super(
      [error, ...failures],
      `${retainedEffects.some(item => item.kind === "layer" && item.effect === "committed") ? "[PNG_COMMITTED] " : ""}` +
        `[COPY_RECOVERY_INCOMPLETE] Copy cleanup incomplete or effects unknown: ${details}; retained: ${retainedEffects.map(item => item.filePath).join(", ")}. ` +
        `Original failure: ${error instanceof Error ? error.message : String(error)}`
    );
    this.name = "CopyCleanupIncompleteError";
  }
}

export type CopyShotAssetsServiceOptions = {
  assertPathInsideFolder: (folderPath: string, filePath: string) => void;
  copyBitmapLayerFile: (sourcePath: string, targetPath: string, onCreated: (receipt: OwnedFileReceipt) => void) => Promise<void>;
  copyFile: (sourcePath: string, targetPath: string, onCreated: (receipt: OwnedFileReceipt) => void) => Promise<void>;
  createId: () => string;
  createPreview: (imagePath: string, previewRoot: string, readOnly: boolean, onReceipt: (receipt: PreviewReceipt) => void) => Promise<string>;
  previewRootForFolder: (folderPath: string) => string;
  pathEntryExists: (filePath: string) => Promise<boolean>;
  publishImage: (source: OwnedFileReceipt, target: string, onPublished: (receipt: OwnedFileReceipt) => void) => Promise<OwnedFileReceipt>;
  removeOwnedFile: (receipt: OwnedFileReceipt) => Promise<void>;
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
  const createdFiles: Array<OwnedFileReceipt & { kind: "image" | "layer" | "staging" }> = [];
  let temporary: OwnedFileReceipt | undefined, preview: PreviewReceipt | undefined;
  let previewRequested = false;

  try {
    await options.copyFile(payload.sourceImagePath, temporaryImagePath, receipt => {
      temporary = receipt; createdFiles.push({ ...receipt, kind: "staging" });
    });
    if (!temporary) throw new CopyCleanupIncompleteError(new Error("Image copier returned without a creation receipt"), [], [
      { filePath: temporaryImagePath, kind: "staging", effect: "unknown" }
    ]);
    for (const item of payload.layerCopies) {
      const targetPath = options.resolveLayerAssetPath(payload.folderPath, item.targetBitmapPath);
      await options.copyBitmapLayerFile(
        options.resolveLayerAssetPath(payload.folderPath, item.sourceBitmapPath),
        targetPath, receipt => { createdFiles.push({ ...receipt, kind: "layer" }); }
      );
      if (!createdFiles.some(entry => entry.kind === "layer" && entry.filePath === targetPath)) {
        throw new CopyCleanupIncompleteError(new Error("Layer copier returned without a creation receipt"), [], [
          ...createdFiles.map(entry => ({ filePath: entry.filePath, kind: entry.kind, effect: "committed" as const })),
          { filePath: targetPath, kind: "layer", effect: "unknown" }
        ]);
      }
    }
    await options.publishImage(temporary, targetImagePath, receipt => { createdFiles.push({ ...receipt, kind: "image" }); });
    const releasedIndex = createdFiles.findIndex(entry => entry.kind === "staging" && entry.filePath === temporaryImagePath);
    if (releasedIndex >= 0) createdFiles.splice(releasedIndex, 1);
    previewRequested = true;
    const previewPath = await options.createPreview(
      targetImagePath,
      options.previewRootForFolder(payload.folderPath), false, receipt => { preview = receipt; }
    );
    options.assertPathInsideFolder(payload.folderPath, previewPath);
    if (!preview) throw new Error("Preview writer returned without an effect receipt");
    await preview.commit();
    return {
      ...payload,
      imagePath: targetImagePath,
      fileName: path.basename(targetImagePath),
      previewPath
    };
  } catch (error) {
    const known = (): RetainedCopyEffect[] => createdFiles.map(item => ({ filePath: item.filePath, kind: item.kind, effect: "committed" }));
    if (error instanceof CopyCleanupIncompleteError) throw error;
    // An unreceipted preview or incomplete shared-cache restore blocks dependent
    // source deletion. Keep known assets, not a misleading ordinary failure.
    if (previewRequested && !preview) throw new CopyCleanupIncompleteError(error, [], [
      ...known(), { filePath: options.previewRootForFolder(payload.folderPath), kind: "preview", effect: "unknown" }
    ]);
    try { await preview?.rollback(); }
    catch (recoveryError) { throw new CopyCleanupIncompleteError(error, [recoveryError], [
      ...known(), ...[preview!.previewPath, ...preview!.retainedPaths].map(filePath => ({ filePath, kind: "preview" as const, effect: "unknown" as const }))
    ]); }
    if (hasUnresolvedProtectedWrite(error) || error instanceof FileReplacementRecoveryIncompleteError) {
      throw new CopyCleanupIncompleteError(error, [], [
        ...known(), ...(error instanceof ProtectedLayerWriteError ? [
          { filePath: error.filePath, kind: "layer" as const, effect: error.effect === "committed" ? "committed" as const : "unknown" as const },
          ...(error.retainedTemporary ? [{ filePath: error.retainedTemporary, kind: "staging" as const, effect: "unknown" as const }] : [])
        ] : [])
      ]);
    }
    const attempted = await Promise.allSettled(createdFiles.map(item => options.removeOwnedFile(item)));
    const failures: unknown[] = [], retained: RetainedCopyEffect[] = [];
    attempted.forEach((result, index) => {
      if (result.status === "rejected") {
        failures.push(result.reason); retained.push({ filePath: createdFiles[index].filePath, kind: createdFiles[index].kind, effect: "committed" });
      }
    });
    if (failures.length) throw new CopyCleanupIncompleteError(error, failures, retained);
    throw error;
  }
};
