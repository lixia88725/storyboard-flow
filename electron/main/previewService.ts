import { link, lstat, mkdtemp, realpath, rename, rmdir, unlink, utimes } from "node:fs/promises";
import { mkdirObserved as mkdir } from './workspaceInitialization.js';
import path from "node:path";
import sharp from "sharp";
import { previewIsFresh } from "./previewCache.js";
import { previewPathForImage } from "./previewPaths.js";
import { pathEntryExists } from "./pathSafety.js";
import { withLayerFileOperation } from "./layerFileOperationQueue.js";
import { createOwnedFile, removeOwnedFile, type OwnedFileReceipt } from "./ownedFileCreation.js";
import { prepareProtectedLayerReplacement } from "./protectedLayerReplacementPreparation.js";
import { applyFileCreateOnlyMoves, applyFileReplacements, FileReplacementRecoveryIncompleteError,
  type AppliedFileMoves, type AppliedFileReplacements } from "./fileRenames.js";

const sharpSourceOptions = { unlimited: true } as const;

export type PreviewReceipt = {
  previewPath: string;
  effect: "unmodified" | "reused" | "created" | "replaced" | "unknown";
  retainedPaths: string[];
  rollback: () => Promise<void>;
  commit: () => Promise<void>;
};

const stagePreview = (imagePath: string, previewPath: string, onReceipt?: (receipt: PreviewReceipt) => void): Promise<void> =>
  withLayerFileOperation(async () => {
    const directory = path.dirname(previewPath);
    if (await realpath(directory) !== path.resolve(directory)) throw new Error("Unsafe preview directory alias; retained");
    let operationRoot: string | undefined, staging: OwnedFileReceipt | undefined;
    let applied: AppliedFileMoves | AppliedFileReplacements | undefined;
    let state: "rollbackable" | "restored" | "committed" | "unknown" = "rollbackable";
    const receipt: PreviewReceipt = {
      previewPath, effect: "unmodified", retainedPaths: [],
      rollback: async () => {
        if (state === "restored") return;
        if (state === "committed" || state === "unknown") throw new FileReplacementRecoveryIncompleteError([
          new Error(`Preview recovery is unsafe after ${state}; retained paths: ${receipt.retainedPaths.join(", ")}`)
        ]);
        await applied?.rollback();
        if (staging) await removeOwnedFile(staging);
        if (operationRoot) await rmdir(operationRoot);
        state = "restored"; receipt.effect = "unmodified"; receipt.retainedPaths = [];
      },
      commit: async () => {
        if (state === "committed") return;
        if (state !== "rollbackable") throw new FileReplacementRecoveryIncompleteError([new Error("Preview is not commit-ready")]);
        // Set the gate BEFORE the first backup deletion, including rmdir errors.
        state = "committed";
        try {
          if (applied && "commit" in applied) await applied.commit();
          if (operationRoot) await rmdir(operationRoot);
          receipt.retainedPaths = [];
        } catch (error) { throw new FileReplacementRecoveryIncompleteError([error]); }
      }
    };
    onReceipt?.(receipt);
    try {
      // Codec failures happen before a target name is touched. Native writes
      // use an operation-owned directory, not the final cache path.
      const bytes = await sharp(imagePath, sharpSourceOptions).rotate()
        .resize({ width: 1800, height: 1200, fit: "inside", withoutEnlargement: true }).png().toBuffer();
      operationRoot = await mkdtemp(path.join(directory, ".preview-operation-"));
      const tempPath = path.join(operationRoot, "preview.png"), backupPath = path.join(operationRoot, "previous.png");
      receipt.retainedPaths = [operationRoot, tempPath, backupPath];
      staging = await createOwnedFile(tempPath, bytes);
      const exists = await pathEntryExists(previewPath);
      if (exists) {
        const encodedTimes = await lstat(tempPath);
        await prepareProtectedLayerReplacement(directory, previewPath, tempPath);
        // fcopyfile preserves security metadata AND the old cache's timestamps.
        // Keep the actual new encoding time; never mark fresh pixels as stale.
        // Only this owned staging file changes, before reversible publication.
        await utimes(tempPath, encodedTimes.atime, encodedTimes.mtime);
        applied = await applyFileReplacements([{ tempPath, targetPath: previewPath, backupPath }], {
          mkdir: async folder => { await mkdir(folder, { recursive: true }); }, rename, unlink
        });
      } else {
        applied = await applyFileCreateOnlyMoves([{ fromPath: tempPath, toPath: previewPath }], {
          mkdir: async folder => { await mkdir(folder, { recursive: true }); }, link, unlink
        });
      }
      receipt.effect = exists ? "replaced" : "created";
      if (!onReceipt) await receipt.commit();
    } catch (error) {
      if (error instanceof FileReplacementRecoveryIncompleteError) {
        state = "unknown"; receipt.effect = "unknown";
        throw error;
      }
      try { await receipt.rollback(); }
      catch (recoveryError) {
        state = "unknown"; receipt.effect = "unknown";
        throw new FileReplacementRecoveryIncompleteError([error, recoveryError]);
      }
      throw error;
    }
  });

// Encoding contract shared by legacy cache creation and admitted normal-open.
export const writePreviewImage = (imagePath: string, previewPath: string, onReceipt?: (receipt: PreviewReceipt) => void): Promise<void> =>
  stagePreview(imagePath, previewPath, onReceipt);

export const createPreview = (imagePath: string, previewRoot: string, readOnly = false,
  onReceipt?: (receipt: PreviewReceipt) => void): Promise<string> => withLayerFileOperation(async () => {
  const previewPath = previewPathForImage(imagePath, previewRoot);

  if (readOnly) {
    // Discovery may reuse an existing browser-readable cache, never repair it.
    // Missing/stale/unsafe media is an incomplete open, not a successful shot
    // with an undefined path that the browser cannot display as TIFF.
    try {
      for (const directory of [path.dirname(previewRoot), previewRoot]) {
        if (!(await lstat(directory)).isDirectory()) throw new Error("unsafe directory");
      }
      if (!(await lstat(previewPath)).isFile() ||
          path.dirname(await realpath(previewPath)) !== await realpath(previewRoot) ||
          !await previewIsFresh(imagePath, previewPath)) throw new Error("missing or stale preview");
      const preview = sharp(previewPath, sharpSourceOptions);
      if ((await preview.metadata()).format !== "png") throw new Error("invalid preview");
      await preview.raw().toBuffer();
      return previewPath;
    } catch {
      throw new Error("TIFF preview unavailable for read-only open; existing files retained");
    }
  }

  await mkdir(previewRoot, { recursive: true });

  if (await previewIsFresh(imagePath, previewPath)) {
    if (!(await lstat(previewPath)).isFile() || await realpath(previewPath) !== path.resolve(previewPath)) {
      throw new Error("Unsafe existing preview directory item; retained");
    }
    onReceipt?.({ previewPath, effect: "reused", retainedPaths: [], rollback: async () => {}, commit: async () => {} });
    return previewPath;
  }

  await writePreviewImage(imagePath, previewPath, onReceipt);

  return previewPath;
});
