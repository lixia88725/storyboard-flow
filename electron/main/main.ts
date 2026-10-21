import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  protocol,
  shell,
  type WebContents
} from "electron";
import { copyFile, link, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { mkdirObserved as mkdir } from './workspaceInitialization.js';
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { automaticImageImportAdmission, manualImageImportAdmission } from "../shared/manualImageImportRules.js";
import { isCertifiedPendingBakeEntry } from "../shared/pendingBakeRules.js";
import sharp from "sharp";
import {
  applyFileMoves,
  applyFileRenamePlan,
  applyFileReplacements,
  applyFileCreateOnlyMoves,
  atomicWriteTextFile,
  type AppliedFileMoves,
  type AppliedFileRenamePlan,
  type AppliedFileReplacements
} from "./fileRenames.js";
import { recoverFailedSave } from "./saveRecovery.js";
import { workspaceEffectFailure } from "./workspaceEffectFailure.js";
import { recoverFailedImport, ImportRecoveryIncompleteError } from "./importRecovery.js";
import { normalSaveImportFailure } from "./normalSaveImportFailure.js";
import { createImportPathReservation } from "./importPaths.js";
import { prepareImportStaging } from "./importPreparation.js";
import {
  flattenBitmapLayerBuffersToTiff,
  shouldEnsureLayerAssetsForShot,
  type BitmapLayerComposite
} from "./bitmapLayers.js";
import { writeProtectedLayerFile } from "./protectedLayerFileWriter.js";
import { createOwnedStageRetryService } from './ownedStageRetryService.js';
import { prepareProtectedLayerReplacement } from "./protectedLayerReplacementPreparation.js";
import { withLayerFileOperation } from "./layerFileOperationQueue.js";
import { bitmapLayersForShot } from "./bitmapLayerOrdering.js";
import { readTrustedLegacyOutputIdentity } from "./trustedLegacyOutputIdentity.js";
import {
  exportPhotoshopLayeredTiffs,
  writePhotoshopLayeredTiffsForInPlaceSave
} from "./photoshopTiffExport.js";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts.js";
import {
  createSavePreparationDirectory,
  removeSavePreparationDirectory,
  hasIncompleteTiffPreparationEffect,
  retainedTiffPreparationPaths,
  TiffPreparationRecoveryIncompleteError,
  type SavePreparationDirectoryReceipt
} from "./tiffPreparation.js";
import {
  buildPhotoshopTiffImportAssetPlan,
  compatibleExternalEditImportMode,
  ensureLayerMoveDestinationsAvailable,
  importedLayerMovesForImportMode,
  isPhotoshopTiffNoLayersError,
  isLikelyTiffPath,
  runPhotoshopTiffImporter,
  topmostImportedLayerId,
  writeSwbImportWorkingTiff,
  type ImportedPhotoshopTiffManifest
} from "./photoshopTiffImport.js";
import { resolvePhotoshopTiffPythonDepsDir } from "./photoshopTiffDeps.js";
import { previewRootForFolder } from "./previewPaths.js";
import { createPreview, type PreviewReceipt } from "./previewService.js";
import { initializeNormalOpenPreviews } from "./normalOpenPreviewService.js";
import {
  createRecentFoldersAppHandlers,
  createRecentFoldersAppRuntime
} from "./recentFoldersAppRuntime.js";
import { assertPathInsideFolder, ensureDirectory, pathEntryExists, pathExists } from "./pathSafety.js";
import { cleanupDeletedShotLayerDirectories } from "./deletedShotLayers.js";
import {
  stagePendingDeletedShotFiles,
  trashPendingDeletedShotFiles
} from "./deletedShotFiles.js";
import { countSaveProgressShots, saveProgressShotIds } from "./saveProgress.js";
import {
  applyStoryboardScriptImportPlan,
  parseStoryboardScriptMarkdown,
  planStoryboardScriptImport,
  serializeStoryboardScriptMarkdown,
  storyboardScriptFileName,
  storyboardScriptNeedsImport
} from "./storyboardScript.js";
import {
  createProjectFromStoryboardScriptMarkdown,
  type CreateProjectFromStoryboardScriptOptions,
  inspectStoryboardScriptMarkdownFile
} from "./storyboardScriptProject.js";
import { createStoryboardImageProtocolHandler } from "./appProtocolRuntime.js";
import {
  attachStoryboardWindowHandlers,
  loadStoryboardWindowEntry,
  storyboardWindowOptions
} from "./appWindowService.js";
import { shouldQuitAfterLastWindow } from "./appLifecycle.js";
import { isWorkspaceTemporaryImagePath } from "./workspaceTemporaryPaths.js";
import { createImageRecords as createImportedImageRecords } from "./imageRecordsService.js";
import { mapWithConcurrency } from "./mapWithConcurrency.js";
import { changedKnownImagePaths as findChangedKnownImagePaths } from "./knownImageChangesService.js";
import { readProjectMetadata } from "./projectMetadataService.js";
import { createBlankShot, type BlankShotPreset } from "./blankShotService.js";
import { removeOwnedFile, type OwnedFileReceipt } from "./ownedFileCreation.js";
import { createWorkspaceFolderWatchService } from "./workspaceFolderWatchService.js";
import {
  createWorkspaceTaskProgressReporter,
  type WorkspaceTaskProgressReporter
} from "./workspaceTaskProgress.js";
import { collectImagePaths, metadataPathForFolder } from "./imageDiscoveryService.js";
import { pixelFingerprint } from "./imageFingerprintService.js";
import { createAppAppHandlers } from "./appAppRuntime.js";
import { createRecoveryCloseBarrier } from "./recoveryCloseBarrier.js";
import { createWorkspaceRetainedCloseService } from "./workspaceRetainedCloseService.js";
import { createPreparedWorkspaceSave } from "./preparedWorkspaceSave.js";
import { getMainMemoryBudget } from "./memoryPolicy.js";
import { createOriginWorkspaceAccounting } from './originWorkspaceAccounting.js';
import { createRecoveryClaimRecords } from './recoveryClaimRecords.js';
import { createOriginEnrollment } from './originEnrollment.js';
import { resolveRecoveryBudget } from "./recoveryBudget.js";
import { createWorkspacePhysicalWriterGate, assertPhysicalWorkspaceWriterTargets } from "./workspacePhysicalWriterGate.js";
import { createImageAppHandlers } from "./imageAppRuntime.js";
import { createLayerAppHandlers } from "./layerAppRuntime.js";
import { createSettingsAppHandlers } from "./settingsAppRuntime.js";
import { createWorkspaceAssetAppHandlers } from "./workspaceAssetAppRuntime.js";
import { createWorkspaceExternalChangesAppHandlers } from "./workspaceExternalChangesAppRuntime.js";
import { createWorkspaceOpenAppHandlers } from "./workspaceOpenAppRuntime.js";
import { createWorkspaceScriptAppHandlers } from "./workspaceScriptAppRuntime.js";
import { createWorkspaceFolderScanner } from "./workspaceScanService.js";
import { createWorkspaceWatchAppHandlers } from "./workspaceWatchAppRuntime.js";
import { createWorkspacePendingAppHandlers } from "./workspacePendingAppRuntime.js";
import {
  beginPendingFileTransaction,
  recoverPendingFileTransaction,
  hasPendingFileTransaction,
  recoverAdmittedNormalPendingFileTransaction
} from "./pendingFileTransactionService.js";
import { registerWorkspacePendingIpcHandlers } from "./ipc/workspacePendingHandlers.js";
import { registerAppIpcHandlers, registerAppCloseGuardBarriers } from "./ipc/appHandlers.js";
import { registerImageIpcHandlers } from "./ipc/imageHandlers.js";
import { registerLayerIpcHandlers } from "./ipc/layerHandlers.js";
import { registerRecentIpcHandlers } from "./ipc/recentHandlers.js";
import { registerSettingsIpcHandlers } from "./ipc/settingsHandlers.js";
import { registerWorkspaceAssetIpcHandlers } from "./ipc/workspaceAssetHandlers.js";
import { registerWorkspaceExternalChangesIpcHandlers } from "./ipc/workspaceExternalChangesHandlers.js";
import { registerWorkspaceOpenIpcHandlers } from "./ipc/workspaceOpenHandlers.js";
import { registerWorkspacePersistenceIpcHandlers } from "./ipc/workspacePersistenceHandlers.js";
import { registerWorkspaceScriptIpcHandlers } from "./ipc/workspaceScriptHandlers.js";
import { registerWorkspaceWatchIpcHandlers } from "./ipc/workspaceWatchHandlers.js";
import {
  resolveLayerAssetPath,
  sharpBlendMode
} from "./layerAssetService.js";
import {
  readRecentFoldersWithRecovery,
  readToolRadialMenu as readToolRadialMenuFromUserData,
  writeRecentFolders as writeRecentFoldersToUserData,
  writeToolRadialMenu as writeToolRadialMenuToUserData
} from "./userSettingsService.js";
import { createUserDataRuntime } from "./userDataRuntime.js";

const swbFormatVersion = 1;
const swbXmpTag = "swb:metadata";
const sharpSourceOptions = { unlimited: true } as const;
type PendingDeletedShot = {
  id: string;
  imagePath: string;
  fileName: string;
};

type Project = {
  pendingBake?: {
    version: 1;
    shots: Record<string, { state: "pending" | "synced" | "unknown"; editToken?: string; acceptedOutputIdentity?: string }>;
  };
  id: string;
  name: string;
  naming?: {
    sceneCode: string;
    artistName: string;
    version: string;
  };
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
      cleared?: boolean;
    }>;
    activeLayerId?: string;
    sketchLayers?: Array<{
      id: string;
      name: string;
      visible: boolean;
      locked: boolean;
      opacity: number;
      blendMode?: "normal" | "multiply" | "screen";
      order: number;
      strokes: Array<{
        id: string;
        tool: "brush" | "eraser";
        color: string;
        size: number;
        opacity?: number;
        points: number[];
      }>;
    }>;
    activeLayerTarget?: "image" | "sketch";
    imageLayerEdits?: Array<{
      id: string;
      tool: "brush" | "eraser";
      color: string;
      size: number;
      opacity?: number;
      points: number[];
    }>;
    baseVisible?: boolean;
    swb?: {
      version: number;
      status: "owned" | "non-swb" | "compatible-external-edit" | "incompatible-external-edit";
      canvasWidth: number;
      canvasHeight: number;
      baseFingerprint?: string;
      sourcePath?: string;
      archivePath?: string;
      statusMessage?: string;
      acceptedExternalEditAt?: string;
      sourceKind?: "photoshop-layered-tiff";
    };
    presentation?: {
      matte?: {
        mode: "expanded" | "embedded";
        top: number;
        bottom: number;
        sourceHeight?: number;
      };
    };
    importWarnings?: string[];
  }>;
  parkedShots?: Project["shots"];
  dialogues: Array<{
    id: string;
    shotId: string;
    text: string;
    order: number;
  }>;
  pendingDeletedShots?: PendingDeletedShot[];
  createdAt: string;
  updatedAt: string;
};

type ProjectPayload = import("../normalSaveTransport.js").NormalSaveTransport & {
  project: Project;
  folderPath: string;
  metadataPath: string;
  renamePlan?: RenamePlanItem[];
  blankShotPreset?: BlankShotPreset;
  dirtyShotIds?: string[];
  preserveDirtyShotLayers?: boolean;
  // Explicit opt-in; App must wait for every producer/admission adapter.
};

type CreateProjectFromStoryboardScriptPayload = {
  sourceMarkdownPath: string;
  targetFolderPath: string;
  blankShotPreset: BlankShotPreset;
};

type ImportedImage = {
  imagePath: string;
  previewPath?: string;
  fileName: string;
  width?: number;
  height?: number;
  fingerprint?: string;
  swbMetadata?: SwbImageMetadata;
};

type SwbImageMetadata = {
  app: "Storyboard Flow" | "Storyboard Workbench";
  format: "swb-tiff";
  version: number;
  projectId?: string;
  shotId: string;
  canvasWidth: number;
  canvasHeight: number;
  baseFingerprint: string;
  updatedAt: string;
  sourcePath?: string;
  archivePath?: string;
  presentation?: Project["shots"][number]["presentation"];
  imageLayerEdits?: Project["shots"][number]["imageLayerEdits"];
  sketchLayers?: Project["shots"][number]["sketchLayers"];
  layers: Array<{
    id: string;
    kind?: "image" | "paint";
    name: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    blendMode?: "normal" | "multiply" | "screen";
    order: number;
    bitmapPath?: string;
    width?: number;
    height?: number;
    strokeCount: number;
  }>;
};

type FolderScanPayload = import("../normalSaveTransport.js").NormalSaveTransport & {
  folderPath: string;
  folderName: string;
  metadataPath: string;
  project?: Project;
  images: ImportedImage[];
  importWarnings?: string[];
  scriptImportNeeded?: boolean;
  preserveProjectWithoutImageMerge?: boolean;
};

type RenamePlanItem = {
  shotId: string;
  fromPath: string;
  temporaryPath: string;
  finalPath: string;
  finalFileName: string;
};

type SwbImportResult = {
  normalSaveImportEffects?: import("../normalSaveTransport.js").NormalSaveImportEffect[];
  project: Project;
  importedShotIds: string[];
  tiffWriteShotIds: string[];
  rollback: () => Promise<void>;
  commit?: () => Promise<void>;
};

type StoryboardScriptImportResult = {
  project: Project;
  rollback: () => Promise<void>;
  rollbackPreviews?: () => Promise<void>;
  rollbackCreatedFiles?: () => Promise<void>;
  commit?: () => Promise<void>;
};

// User-approved finite production capacity; explicit test limits may only reduce it.
const recoveryBudget = resolveRecoveryBudget(process.env.SWB_RECOVERY_LIMITS);
const originAccounting = createOriginWorkspaceAccounting({
  userData: () => app.getPath('userData'),
  python: process.env.SWB_PYTHON_PATH || 'python3',
  script: path.join(app.getAppPath(), 'scripts/recovery-origin-permissions.py'),
  claimRecords: () => createRecoveryClaimRecords({
    userData: () => app.getPath('userData'), python: process.env.SWB_PYTHON_PATH || 'python3',
    script: path.join(app.getAppPath(), 'scripts/recovery-claim-records.py')
  }),
  claimWriter: (_root, restrictions) => createRecoveryClaimRecords({
    userData: () => app.getPath('userData'), python: process.env.SWB_PYTHON_PATH || 'python3',
    script: path.join(app.getAppPath(), 'scripts/recovery-claim-records.py'), restrictions: () => restrictions
  })
});
const retainedCloseService = createWorkspaceRetainedCloseService({
  budget: recoveryBudget,
  accounting: originAccounting,
  python: process.env.SWB_PYTHON_PATH || "python3",
  script: path.join(app.getAppPath(), "scripts/recovery-content-permissions.py")
});
const originEnrollment = createOriginEnrollment({
  userData: () => app.getPath('userData'),
  accounting: originAccounting,
  budget: () => recoveryBudget,
  python: process.env.SWB_PYTHON_PATH || 'python3',
  script: path.join(app.getAppPath(), 'scripts/recovery-origin-enrollment.py')
});
// One Main-wide controlled backing pool shared by the recovery/save service and
// the layer-file handlers, admitted against the measured policy in memoryPolicy.ts.
const mainMemoryBudget = getMainMemoryBudget();
const preparedSave = createPreparedWorkspaceSave({
  ownerFromSender: sender => BrowserWindow.fromWebContents(sender) ?? undefined,
  budget: recoveryBudget,
  memoryBudget: mainMemoryBudget,
  accounting: originAccounting,
  originEnrollment,
  python: process.env.SWB_PYTHON_PATH || "python3",
  script: path.join(app.getAppPath(), "scripts/recovery-content-permissions.py")
});
const ownedStageRetryService = createOwnedStageRetryService<Parameters<typeof preparedSave.verifyFailedOrigin>[0]>({
  verify: (event, selector) => preparedSave.verifyFailedOrigin(event, selector),
  confirm: async (event, selector) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    if (!owner || owner.isDestroyed() || owner.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) throw new Error('Current recovery confirmation window unavailable');
    const answer = await dialog.showMessageBox(owner, {
      type: 'warning',
      title: 'Storyboard Flow — Confirm temporary-link cleanup',
      message: 'Remove only this failed operation’s verified temporary link?',
      detail: `Failed version: ${selector.failedVersion}\nThe published image, recovery history and original failure remain unchanged. This does not complete Save or grant editing permission.`,
      buttons: ['Clean verified temporary link', 'Cancel'], defaultId: 1, cancelId: 1, noLink: true
    });
    if (owner.isDestroyed() || owner.webContents !== event.sender || event.senderFrame !== event.sender.mainFrame) throw new Error('Recovery caller changed during confirmation');
    return answer.response === 0;
  },
  cleanup: (event, selector, onDispatch) => preparedSave.retryFailedOrigin(event, selector, onDispatch)
});
const recoveryCloseBarrier = createRecoveryCloseBarrier({
  // Only the explicitly prepared finite Save domain can certify this close.
  // Unsupported producer inventories stay protected in RAM; no writer unlock.
  certifyRetained: preparedSave.certifyRetained,
  certifyRetainedSet: preparedSave.certifyRetainedSet,
  requestId: randomUUID,
  showMessageBox: (owner, options) => dialog.showMessageBox(owner as BrowserWindow, options),
  cancelled: (owner, reason) => owner.webContents.send("app:closeCancelled", { reason })
});
const saveAndCloseRequests = new Map<string, BrowserWindow>();
const closeGuardWebContentsIds = new Set<number>();
const workspaceFolderWatchService = createWorkspaceFolderWatchService();

let mainWindow: BrowserWindow | undefined;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "storyboard-img",
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true
    }
  }
]);

if (process.env.SWB_USER_DATA_DIR) {
  app.setPath("userData", process.env.SWB_USER_DATA_DIR);
}

app.setName("Storyboard Flow");

// One instance per workspace: a second instance would be a second writer on the
// same files. A late launch only focuses the existing window.
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) app.exit(0);

// The window close handler always defers to the recovery close barrier, which
// cancels Electron's own quit sequence. Remember an explicit Quit so it can be
// re-issued once the barrier has finished and the last window is gone.
let quitRequested = false;
app.on("before-quit", () => { quitRequested = true; });
app.on("second-instance", () => {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.focus();
});

const createWindow = async () => {
  mainWindow = new BrowserWindow(storyboardWindowOptions(app.getAppPath()));
  attachStoryboardWindowHandlers(mainWindow, {
    closeGuardWebContentsIds,
    createRequestId: randomUUID,
    closeProtection: recoveryCloseBarrier,
    saveAndCloseRequests,
    showMessageBoxSync: (owner, options) => dialog.showMessageBoxSync(owner, options)
  });

  const closingWindow = mainWindow;
  closingWindow.webContents.on('will-prevent-unload', event => {
    if (recoveryCloseBarrier.consumeReloadPermission(closingWindow)) event.preventDefault();
    else recoveryCloseBarrier.beginReload(closingWindow);
  });
  closingWindow.webContents.on("did-start-navigation", (_event, _url, _inPlace, isMainFrame) => {
    if (isMainFrame) { recoveryCloseBarrier.invalidateDocument(closingWindow); preparedSave.invalidateDocument(closingWindow.webContents); }
  });
  await loadStoryboardWindowEntry(mainWindow, {
    appPath: app.getAppPath(),
    devServerUrl: process.env.VITE_DEV_SERVER_URL
  });
};

app.whenReady().then(async () => {
  protocol.handle(
    "storyboard-img",
    createStoryboardImageProtocolHandler({
      fetchFileUrl: (url) => net.fetch(url),
      resolveLayerAssetPath
    })
  );

  registerIpcHandlers();
  await updateRecentFoldersMenu();
  await createWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  workspaceFolderWatchService.closeAll();
  if (shouldQuitAfterLastWindow(process.platform === "darwin", quitRequested)) {
    quitRequested = true;
    app.quit();
  }
});

const physicalWriterIpcMain = createWorkspacePhysicalWriterGate(ipcMain, { save: preparedSave.runIpc, persist: preparedSave.persist, ordinary: preparedSave.ordinary });
const registerIpcHandlers = () => {
  const ipcMain = physicalWriterIpcMain;
  ipcMain.handle("recovery:readReadonly", (event, folderPath: string) => {
    if (event.senderFrame !== event.sender.mainFrame) throw new Error("Recovery read requires current top frame");
    return preparedSave.readReadonly(folderPath);
  });
  ipcMain.handle("recovery:inspectPartialSaveContinuation", (event, selector) => preparedSave.inspectPartialSaveContinuation(event, selector));
  ipcMain.handle("recovery:beginPartialSaveContinuation", (event, selector) => preparedSave.beginPartialSaveContinuation(event, selector));
  ipcMain.handle("recovery:persistPartialSaveContinuation", (event, payload) => preparedSave.persistPartialSaveContinuation(event, payload));
  ipcMain.handle("recovery:beginHistoryAssets", (event,payload)=>preparedSave.beginHistoryAssets(event,payload));
  ipcMain.handle("recovery:stepHistoryAssets", (event,payload)=>preparedSave.stepHistoryAssets(event,payload));
  ipcMain.handle("recovery:compensateHistoryAssets", (event,payload)=>preparedSave.compensateHistoryAssets(event,payload));
  ipcMain.handle("recovery:ackSave", (event, payload) => preparedSave.acknowledge(event, payload));
  ipcMain.handle("recovery:observeWorkspace", (event, folderPath) => preparedSave.observeWorkspace(event, folderPath));
  ipcMain.handle("recovery:retryOwnedStage", (event, selector) => ownedStageRetryService.request(event, selector));
  ipcMain.handle("recovery:certifyHandoff", (event, capture) => preparedSave.certifyHandoff(event, capture));
  registerWorkspaceOpenIpcHandlers(
    ipcMain,
    createWorkspaceOpenAppHandlers({
      pathExists,
      removeRecentFolder,
      createProgressReporter: createWorkspaceTaskProgressReporter,
      scanFolder,
      addRecentFolder
    })
  );

  const appHandlers = createAppAppHandlers({
      arch: process.arch,
      closeGuardWebContentsIds,
      recoveryCloseBarrier,
      getVersion: () => app.getVersion(),
      openExternal: shell.openExternal,
      ownerFromSender: (sender: WebContents) => BrowserWindow.fromWebContents(sender) ?? undefined,
      platform: process.platform,
      saveAndCloseRequests,
      showOpenDialog: dialog.showOpenDialog.bind(dialog),
      updateManifestUrl: process.env.STORYBOARD_FLOW_UPDATE_MANIFEST_URL
    });
  registerAppIpcHandlers(ipcMain, appHandlers);
  registerAppCloseGuardBarriers(ipcMain, appHandlers);

  registerWorkspaceScriptIpcHandlers<ProjectPayload, CreateProjectFromStoryboardScriptPayload>(
    ipcMain,
    createWorkspaceScriptAppHandlers({
      inspectStoryboardScript: inspectStoryboardScriptMarkdownFile,
      createFromStoryboardScript: async (payload: CreateProjectFromStoryboardScriptOptions) => {
        if (payload.normalSave && payload.normalSaveSource) {
          const source = payload.normalSaveSource as ProjectPayload;
          if (await hasPendingFileTransaction(source.folderPath)) throw new Error("New storyboard creation refused: retained Pending transaction requires recovery");
          await assertNormalSaveAdmission(source, false);
        }
        return createProjectFromStoryboardScriptMarkdown(payload);
      },
      addRecentFolder,
      ensureStoryboardScriptMarkdown
    })
  );

  registerWorkspacePersistenceIpcHandlers<ProjectPayload>(
    ipcMain,
    {
      assertEnsureAdmission: async payload => {
        if (payload.normalSave && await hasPendingFileTransaction(payload.folderPath)) throw new Error("Pending transaction prevents asset initialization; assets retained");
      },
      assertAdmission: payload => payload.normalSave ? assertNormalSaveAdmission(payload, false) : undefined,
        ensureProjectLayerAssets,
      writeProjectFiles
    }
  );

  ipcMain.handle("workspace:readOutputIdentity", async (_event, imagePath: string, legacy?: { project: Project; folderPath: string; shotId: string }) => {
    if (typeof imagePath !== "string" || !path.isAbsolute(imagePath) || !/\.tiff?$/iu.test(imagePath)) throw new Error("Invalid working TIFF path");
    if (legacy !== undefined) {
      if (!legacy || typeof legacy.folderPath !== "string" || typeof legacy.shotId !== "string" ||
          !legacy.project || !Array.isArray(legacy.project.shots) ||
          legacy.project.shots.find(s => s.id === legacy.shotId)?.imagePath !== imagePath) throw new Error("Invalid legacy output proof request");
      const identity = await readTrustedLegacyOutputIdentity(legacy.project, legacy.shotId, legacy.folderPath, {
        exportScriptPath: path.join(app.getAppPath(), "scripts/photoshop-layered-tiff-export.py"),
        importScriptPath: path.join(app.getAppPath(), "scripts/photoshop-layered-tiff-import.py"),
        probeScriptPath: path.join(app.getAppPath(), "scripts/legacy-single-layer-proof.py"),
        env: { ...process.env, SWB_PYTHON_DEPS_DIR: resolvePhotoshopTiffPythonDepsDir({ appPath: app.getAppPath() }) }
      });
      if (!identity) throw new Error("Legacy output equivalence is unknown; original assets retained");
      return identity;
    }
    return createHash("sha256").update(await readFile(imagePath)).digest("hex");
  });

  ipcMain.handle("workspace:save", async (event, payload: ProjectPayload) => {
    try { return await saveWorkspace(payload, createWorkspaceTaskProgressReporter(event.sender, "save")); }
    catch (error) { return workspaceEffectFailure(error, "save"); }
  });

  ipcMain.handle("workspace:exportPhotoshopTiffs", async (_event, payload: ProjectPayload) => {
    if (payload.normalSave) await assertNormalSaveAdmission(payload, false);
    if (payload.normalSave && await hasPendingFileTransaction(payload.folderPath)) throw new Error("Pending transaction prevents export; assets retained");
    await ensureProjectLayerAssets(payload.project, payload.folderPath);
    return exportPhotoshopLayeredTiffs(payload.project, payload.folderPath, {
      scriptPath: path.join(app.getAppPath(), "scripts/photoshop-layered-tiff-export.py"),
      env: {
        ...process.env,
        SWB_PYTHON_DEPS_DIR: resolvePhotoshopTiffPythonDepsDir({ appPath: app.getAppPath() })
      }
    });
  });

  ipcMain.handle("workspace:importSwbFormat", async (event, payload: ProjectPayload) => withLayerFileOperation(async () => {
    const normalSaveImageOperation = payload.normalSaveImageImport || payload.normalSaveAutoImageImport;
    // Script text Import under normal Save: main may only materialize genuinely new blank
    // assets and return the parsed Project. The renderer owner is the sole writer of the final
    // JSON/MD (after a merge onto the latest Project); main must never install the captured P.
    const normalSaveScriptOperation = Boolean(payload.normalSave) && !normalSaveImageOperation;
    if (normalSaveImageOperation && !payload.normalSave) throw new Error("Image Import opt-in requires normal Save");
    if (payload.normalSaveAutoImageImport && (payload.normalSaveImageImport || payload.preserveDirtyShotLayers)) throw new Error("Automatic Import cannot request manual preserve/duplicate permission");
    if (payload.normalSaveAutoImageImport) automaticImageImportAdmission(payload.project, payload.dirtyShotIds);
    if (normalSaveImageOperation) await assertManualImageImportAdmission(payload);
    else if (payload.normalSave) await assertNormalSaveAdmission(payload, false);
    // The schema admission is not enough: an in-flight Pending file transaction must be refused
    // BEFORE the first asset effect so a new blank is never materialized into a moving namespace.
    if (payload.normalSave && await hasPendingFileTransaction(payload.folderPath)) {
      throw new Error("Pending transaction prevents Import; assets retained");
    }
    // Read and validate BEFORE the first image effect. Never reread the image writer's MD as a new input.
    let normalSaveScriptExpectedInput: string | null | undefined;
    let normalSaveScriptInput: string | undefined;
    let normalSaveScriptPlan: import("./storyboardScript.js").StoryboardScriptImportPlanItem[] | undefined;
    if (normalSaveImageOperation) {
      try {
        const markdown = await readFile(storyboardScriptPathForFolder(payload.folderPath), "utf8");
        normalSaveScriptExpectedInput = markdown;
        if (storyboardScriptNeedsImport(payload.project, markdown)) {
          normalSaveScriptPlan = planStoryboardScriptImport(payload.project, parseStoryboardScriptMarkdown(markdown));
          normalSaveScriptInput = markdown;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        normalSaveScriptExpectedInput = null; // observed absent, not an unrequested check
      }
    }
    if (!normalSaveImageOperation && payload.normalSaveScriptInput !== undefined &&
      await readFile(storyboardScriptPathForFolder(payload.folderPath), "utf8") !== payload.normalSaveScriptInput) {
      throw new Error("Script Import external input changed; both inputs retained");
    }
    let scriptImport: StoryboardScriptImportResult | undefined;
    let swbImport: SwbImportResult | undefined;
    let appliedTiffReplacements: AppliedFileReplacements | undefined;
    const previewReceipts: PreviewReceipt[] = [];
    let metadataPublicationStarted = false, irreversibleCommitStarted = false;
    const commitImport = async () => {
      irreversibleCommitStarted = true;
      for (const preview of previewReceipts) await preview.commit();
      await appliedTiffReplacements?.commit();
      await swbImport?.commit?.();
      await scriptImport?.commit?.();
    };
    try {
      const imageImportNeeded = projectNeedsSwbImport(payload.project);
      scriptImport = normalSaveImageOperation ? { project: payload.project, rollback: async () => undefined } : await importStoryboardScriptMarkdown(
        payload.project,
        payload.folderPath,
        payload.blankShotPreset ?? "16:9",
        payload.normalSaveScriptInput,
        payload.normalSaveScriptPlan
      );

      if (!imageImportNeeded) {
        if (normalSaveImageOperation) throw new Error("Image Import has no actual image work");
        if (!normalSaveScriptOperation) {
          // Legacy direct script Import is unchanged: main writes JSON/MD and the App rescans.
          metadataPublicationStarted = true;
          await writeProjectFiles(payload.metadataPath, payload.folderPath, scriptImport.project);
          await commitImport();
          return {
            folderPath: payload.folderPath,
            folderName: path.basename(payload.folderPath),
            metadataPath: payload.metadataPath,
            project: scriptImport.project,
            images: [],
            scriptImportNeeded: false,
            preserveProjectWithoutImageMerge: true
          } satisfies FolderScanPayload;
        }
        // NormalSave script Import: a controlled new-asset operation materializes each genuinely
        // new blank shot's real internal PNG (path taken from the real shot, not a guess). The
        // general unknown/pending ensure gate is NOT relaxed: only THIS operation's new shot ids
        // are initialized, and the owner remains the sole JSON/MD writer.
        const capturedIds = new Set([...payload.project.shots, ...(payload.project.parkedShots ?? [])].map(shot => shot.id));
        const newIds = scriptImport.project.shots.filter(shot => !capturedIds.has(shot.id)).map(shot => shot.id);
        if (newIds.length) {
          // Cleanup authority comes from actual native create-only receipts,
          // never from a planned name or a stat-based absence observation.
          const ownedLayerFiles: OwnedFileReceipt[] = [];
          const previousRollback = scriptImport.rollback;
          const rollbackPreviews = scriptImport.rollbackPreviews;
          const rollbackCreatedFiles = scriptImport.rollbackCreatedFiles;
          scriptImport = { ...scriptImport, rollback: async () => {
            await rollbackPreviews?.();
            // ENOENT is success (the file was never created or was already removed). Any other
            // failure is a real recovery error: do NOT swallow it, and do NOT continue to the
            // dependent TIFF/preview rollback as if cleanup had succeeded. Throwing here makes
            // recoverFailedImport surface the original error + this recovery error.
            const results = await Promise.allSettled(ownedLayerFiles.map(receipt => removeOwnedFile(receipt)));
            const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
            if (failed.length) throw new AggregateError(failed.map(result => result.reason),
              "Script Import internal layer rollback failed; dependent TIFF/preview recovery stopped");
            await (rollbackCreatedFiles ?? previousRollback)();
          } };
          await ensureProjectLayerAssets(scriptImport.project, payload.folderPath, {
            shotIds: new Set(newIds), onCreated: receipt => { ownedLayerFiles.push(receipt); }
          });
        }
        await commitImport();
        return {
          folderPath: payload.folderPath,
          folderName: path.basename(payload.folderPath),
          metadataPath: payload.metadataPath,
          project: scriptImport.project,
          images: [],
          scriptImportNeeded: false,
          preserveProjectWithoutImageMerge: true
        } satisfies FolderScanPayload;
      }

      swbImport = await importProjectToSwbFormat(
        scriptImport.project,
        payload.folderPath,
        createWorkspaceTaskProgressReporter(event.sender, "import"),
        {
          dirtyShotIds: new Set([...(payload.dirtyShotIds ?? []), ...(normalSaveImageOperation ? Object.entries(payload.project.pendingBake?.shots ?? {}).filter(([, e]) => e.state === "pending").map(([id]) => id) : [])]),
          preserveDirtyShotLayers: payload.preserveDirtyShotLayers,
          normalSaveImageImport: normalSaveImageOperation, normalSaveAutoImageImport: payload.normalSaveAutoImageImport
        }
      );
      appliedTiffReplacements = await writeSwbMetadataToTiffs(
        swbImport.project,
        payload.folderPath,
        undefined,
        { shotIds: new Set(swbImport.tiffWriteShotIds) }
      );
      const importedProject = await createProjectPreviewsForShots(
        swbImport.project,
        payload.folderPath,
        new Set(swbImport.importedShotIds), receipt => { previewReceipts.push(receipt); }
      );
      const normalSaveImportEffects = normalSaveImageOperation ? await Promise.all((swbImport.normalSaveImportEffects ?? []).map(async e => ({
        ...e, outputHash: createHash("sha256").update(await readFile(e.targetPath)).digest("hex")
      }))) : undefined;
      // Owner persists latest metadata + H0 after matte; main does not install captured P.
      if (!normalSaveImageOperation) {
        metadataPublicationStarted = true;
        await writeProjectFiles(payload.metadataPath, payload.folderPath, importedProject);
      }
      await commitImport();
      return {
        folderPath: payload.folderPath,
        folderName: path.basename(payload.folderPath),
        metadataPath: payload.metadataPath,
        project: importedProject,
        normalSaveImportEffects,
        normalSaveScriptInput,
        normalSaveScriptExpectedInput,
        normalSaveScriptPlan,
        images: [],
        scriptImportNeeded: false,
        preserveProjectWithoutImageMerge: true
      } satisfies FolderScanPayload;
    } catch (error) {
      if (metadataPublicationStarted || irreversibleCommitStarted) {
        return normalSaveImportFailure(new ImportRecoveryIncompleteError([error,
          new Error("Import metadata publication or backup cleanup began; current assets and remaining backups retained, automatic rollback stopped")
        ]));
      }
      // A recovery-incomplete Import is a business fact that must cross IPC as a RETURNED
      // serializable discriminant (a thrown custom Error loses its properties/name across the
      // Electron boundary). recoverFailedImport either rethrows the original error or an
      // ImportRecoveryIncompleteError; only the latter becomes the envelope.
      try {
        await recoverFailedImport(error, [{ rollback: async () => {
          for (const preview of [...previewReceipts].reverse()) await preview.rollback();
        } }, appliedTiffReplacements, swbImport, scriptImport]);
        throw error;
      } catch (recoveryError) {
        if (recoveryError instanceof ImportRecoveryIncompleteError) {
          return normalSaveImportFailure(recoveryError);
        }
        throw recoveryError;
      }
    }
  }));

  registerWorkspaceExternalChangesIpcHandlers(
    ipcMain,
    createWorkspaceExternalChangesAppHandlers<Project>({
      changedKnownImagePaths,
      createImageRecords,
      readStoryboardScriptImportState: (folder, project) => ensureStoryboardScriptMarkdown(folder, project, true),
      ensureStoryboardScriptMarkdown
    })
  );

  registerWorkspaceWatchIpcHandlers(
    ipcMain,
    createWorkspaceWatchAppHandlers({ workspaceFolderWatchService })
  );

  registerLayerIpcHandlers(ipcMain, createLayerAppHandlers({ memoryBudget: mainMemoryBudget }));

  registerWorkspaceAssetIpcHandlers(ipcMain, createWorkspaceAssetAppHandlers({ uniquePath }));

  registerWorkspacePendingIpcHandlers(
    ipcMain,
    createWorkspacePendingAppHandlers<Project>({
      assertAdmission: payload => payload.normalSave ? assertNormalSaveAdmission(payload, false) : undefined,
      beginTransaction: beginPendingFileTransaction,
      materializeShots: async (project, folderPath, shotIds) => {
        const selectedShots = [...project.shots, ...(project.parkedShots ?? [])].filter((shot) =>
          shotIds.has(shot.id)
        );
        const replacements = await writeSwbMetadataToTiffs(
          { ...project, shots: selectedShots, parkedShots: undefined },
          folderPath,
          undefined,
          { shotIds }
        );
        return replacements;
      },
      persistProject: writeProjectMetadata,
      uniquePath
    })
  );

  registerImageIpcHandlers(ipcMain, createImageAppHandlers({ createImageRecords }));

  registerRecentIpcHandlers(
    ipcMain,
    createRecentFoldersAppHandlers({
      read: readRecentFolders,
      flushChangedFolders: recentFoldersRuntime.flushChangedFolders
    })
  );

  registerSettingsIpcHandlers(ipcMain, createSettingsAppHandlers(userDataRuntime));


};

const saveWorkspace = async (
  payload: ProjectPayload,
  onProgress?: WorkspaceTaskProgressReporter
): Promise<ProjectPayload> => withLayerFileOperation(async () => {
  let appliedRenamePlan: AppliedFileRenamePlan | undefined;
  let stagedPendingDeletedFiles: AppliedFileMoves | undefined;
  let swbImport: SwbImportResult | undefined;
  let appliedTiffReplacements: AppliedFileReplacements | undefined;
  let savedProject: Project | undefined;
  let outputAcks: NonNullable<ProjectPayload["normalSaveOutputs"]> = [];
  let projectToSave = payload.project;
  let publicationOrCleanupStarted = false;
  let savedShots = 0;
  let totalShots = payload.project.shots.length;
  const reportShotSaved = () => {
    savedShots = Math.min(totalShots, savedShots + 1);
    onProgress?.({ kind: "save", current: savedShots, total: totalShots });
  };

  try {
    if (payload.normalSave) await assertNormalSaveAdmission(payload, false);
    const stagedPending = await stagePendingDeletedShotFiles(payload.project, payload.folderPath);
    stagedPendingDeletedFiles = stagedPending.appliedMoves;
    projectToSave = stagedPending.project;

    if (payload.renamePlan && payload.renamePlan.length > 0) {
      await assertRenamePlanSafe(payload.renamePlan);
      appliedRenamePlan = await applyFileRenamePlan(payload.renamePlan, {
        mkdir: ensureDirectory,
        rename
      });
    }

    swbImport = await importProjectToSwbFormat(projectToSave, payload.folderPath);
    const swbProject = swbImport.project;
    const pendingIds = payload.normalSave
      ? payload.project.shots.filter(s => payload.project.pendingBake?.shots[s.id]?.state === "pending").map(s => s.id)
      : [];
    const saveShotIds = saveProgressShotIds(
      payload.dirtyShotIds === undefined ? undefined : [...new Set([...payload.dirtyShotIds, ...pendingIds])],
      swbImport.tiffWriteShotIds
    );
    totalShots = countSaveProgressShots(swbProject, saveShotIds);
    savedShots = 0;
    onProgress?.({ kind: "save", current: 0, total: totalShots });
    appliedTiffReplacements = await writeSwbMetadataToTiffs(
      swbProject,
      payload.folderPath,
      reportShotSaved,
      { shotIds: saveShotIds,
        beforeInstall: payload.normalSave ? () => assertNormalSaveAdmission(payload, true) : undefined }
    );
    savedProject = await syncSavedSwbBaseFingerprints(
      clearSavedImageLayerEdits(
        swbProject,
        saveShotIds ? { shotIds: saveShotIds } : undefined
      ),
      saveShotIds
    );
    if (payload.normalSave) outputAcks = await normalSaveOutputAcks(payload, savedProject, saveShotIds);
    publicationOrCleanupStarted = true;
    await writeProjectFiles(payload.metadataPath, payload.folderPath, savedProject);
    await appliedTiffReplacements?.commit();
    await swbImport.commit?.();

  // Publication has begun: the remaining tail must retain installed assets
  // and report typed incomplete facts rather than ordinary IPC rejection.

  if (!savedProject) {
    throw new Error("Save did not produce a project");
  }

  const pendingBeforeTrash = savedProject.pendingDeletedShots ?? [];
  const trashResult = await trashPendingDeletedShotFiles(savedProject);
  if (trashResult.project !== savedProject) {
    await writeProjectFiles(payload.metadataPath, payload.folderPath, trashResult.project);
  }
  const cleanedDeletedIds: string[] = [];
  await cleanupDeletedShotLayerDirectories({
    folderPath: payload.folderPath,
    previousPendingDeletedShots: pendingBeforeTrash,
    nextPendingDeletedShots: trashResult.project.pendingDeletedShots ?? [],
    onCleaned: id => { cleanedDeletedIds.push(id); }
  });
  if (trashResult.error) {
    throw trashResult.error;
  }

  if (payload.normalSave) {
    for (const ack of outputAcks) {
      if (createHash("sha256").update(await readFile(ack.targetPath)).digest("hex") !== ack.outputHash) {
        throw new Error("Working TIFF changed after Save output; completion not accepted");
      }
    }
    const normalSaveDeletions = (payload.project.pendingDeletedShots ?? []).flatMap(captured => {
      const staged = pendingBeforeTrash.filter(s => s.id === captured.id);
      return staged.length === 1 && trashResult.trashed?.some(s => s.id === captured.id && s.imagePath === staged[0].imagePath) &&
        cleanedDeletedIds?.includes(captured.id) ? [{ shotId: captured.id, sourcePath: captured.imagePath }] : [];
    });
    return { ...payload, project: trashResult.project, normalSaveOutputs: outputAcks, normalSaveDeletions };
  }
  return { ...payload, project: trashResult.project };
  } catch (error) {
    return recoverFailedSave(error, {
      publicationOrCleanupStarted,
      appliedTiffReplacements,
      swbImport,
      appliedRenamePlan,
      stagedPendingDeletedFiles
    });
  }
});

const assertManualImageImportAdmission = async (payload: ProjectPayload) => {
  const admitted = manualImageImportAdmission(payload.project);
  for (const a of admitted) {
    assertPathInsideFolder(payload.folderPath, a.shot.imagePath);
    const hash = createHash("sha256").update(await readFile(a.shot.imagePath)).digest("hex");
    if (payload.normalSaveAutoImageImport && a.external) {
      const metadata = await readSwbMetadata(a.shot.imagePath);
      const size = await sharp(a.shot.imagePath, sharpSourceOptions).metadata();
      if (!metadata || metadata.shotId !== a.shot.id || size.width !== a.shot.swb?.canvasWidth || size.height !== a.shot.swb?.canvasHeight) {
        throw new Error("Automatic Import TIFF identity is not compatible; both versions retained");
      }
    }
    if (!a.fresh && !a.external && hash !== a.entry!.acceptedOutputIdentity) throw new Error("Import source changed externally");
    for (const layer of a.fresh ? [{ bitmapPath: `.storyboard-workbench/layers/${a.shot.id}/layer-image.png` }] : a.shot.layers ?? []) {
      const file = resolveLayerAssetPath(payload.folderPath, (layer as { bitmapPath: string }).bitmapPath);
      if (!a.fresh) { await readFile(file); continue; }
      try { await readFile(file); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      throw new Error("Import compatibility is unknown; existing internal PNG was preserved");
    }
  }
};

// The main writer is not a token owner. This opt-in adapter is not enabled in App.
const assertNormalSaveAdmission = async (payload: ProjectPayload, renamed: boolean): Promise<void> => {
  if ("normalSaveAiPromotion" in payload) throw new Error("AI generation is no longer supported");
  const envelope = payload.project.pendingBake;
  const shots = [...payload.project.shots, ...(payload.project.parkedShots ?? [])];
  const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
  if ((envelope === undefined && shots.length) || (envelope !== undefined && (
    !record(envelope) || envelope.version !== 1 || !record(envelope.shots) ||
    !Object.values(envelope.shots).every(isCertifiedPendingBakeEntry)
  ))) throw new Error("Save compatibility is unknown; internal assets and working TIFFs were preserved");
  const plan = payload.renamePlan ?? [];
  if (!renamed) for (const deleted of payload.project.pendingDeletedShots ?? []) {
    const entry = envelope?.shots[deleted.id];
    if (payload.project.pendingDeletedShots!.filter(s => s.id === deleted.id).length !== 1 || shots.some(s => s.id === deleted.id) ||
        !entry || entry.state === "unknown") throw new Error("Deleted Save source is not certified");
    assertPathInsideFolder(payload.folderPath, deleted.imagePath);
    if (createHash("sha256").update(await readFile(deleted.imagePath)).digest("hex") !== entry.acceptedOutputIdentity) {
      throw new Error("Deleted working TIFF changed externally; deletion not admitted");
    }
  }
  if (new Set(plan.map(r => r.shotId)).size !== plan.length) throw new Error("Ambiguous Save source mapping");
  for (const shot of shots) {
    const entry = envelope?.shots[shot.id];
    const mapping = plan.find(r => r.shotId === shot.id);
    if (!entry || shot.swb?.status !== "owned" || !/\.tiff?$/iu.test(shot.imagePath) ||
        mapping && (mapping.finalPath !== shot.imagePath || mapping.finalFileName !== shot.fileName)) {
      throw new Error("Save source is not certified; Import/legacy initialization is required");
    }
    const imagePath = !renamed && mapping ? mapping.fromPath : shot.imagePath;
    assertPathInsideFolder(payload.folderPath, imagePath);
    if (createHash("sha256").update(await readFile(imagePath)).digest("hex") !== entry.acceptedOutputIdentity) {
      throw new Error("Working TIFF changed externally; internal assets and TIFF were preserved");
    }
    for (const layer of shot.layers ?? []) {
      await readFile(resolveLayerAssetPath(payload.folderPath, layer.bitmapPath));
    }
  }
};

const normalSaveOutputAcks = async (
  payload: ProjectPayload,
  actual: Project,
  selectedIds?: Set<string>
): Promise<NonNullable<ProjectPayload["normalSaveOutputs"]>> => {
  const acks: NonNullable<ProjectPayload["normalSaveOutputs"]> = [];
  for (const captured of payload.project.shots) {
    if (selectedIds && !selectedIds.has(captured.id) && !payload.renamePlan?.some(r => r.shotId === captured.id && r.fromPath !== r.finalPath)) continue;
    const entry = payload.project.pendingBake?.shots[captured.id];
    if (!entry || entry.state === "unknown" || !shouldWriteSwbMetadata(captured)) {
      throw new Error("Selected Save output is not certified");
    }
    const output = actual.shots.find(s => s.id === captured.id);
    if (!output || output.imagePath !== captured.imagePath || output.swb?.status !== "owned") {
      throw new Error("Save output/source mapping changed; completion not accepted");
    }
    acks.push({ shotId: captured.id, capturedToken: entry.editToken,
      sourcePath: payload.renamePlan?.find(r => r.shotId === captured.id)?.fromPath ?? captured.imagePath,
      targetPath: output.imagePath, fileName: output.fileName, baseFingerprint: output.swb?.baseFingerprint,
      outputHash: createHash("sha256").update(await readFile(output.imagePath)).digest("hex") });
  }
  return acks;
};

const assertRenamePlanSafe = async (renamePlan: RenamePlanItem[]): Promise<void> => {
  const sourcePaths = new Set(renamePlan.map((item) => item.fromPath));

  for (const item of renamePlan) {
    if (item.fromPath !== item.temporaryPath && (await pathExists(item.temporaryPath))) {
      throw new Error(`Temporary rename file already exists: ${item.temporaryPath}`);
    }

    if (
      item.fromPath !== item.finalPath &&
      !sourcePaths.has(item.finalPath) &&
      (await pathExists(item.finalPath))
    ) {
      throw new Error(`Target file already exists: ${item.finalPath}`);
    }
  }
};

const ensureProjectLayerAssets = async (
  project: Project,
  folderPath: string,
  options: { includeExternalShots?: boolean; shotIds?: Set<string>; onCreated?: (receipt: OwnedFileReceipt) => void } = {}
): Promise<void> => {
  for (const shot of project.shots) {
    if (options.shotIds && !options.shotIds.has(shot.id)) {
      continue;
    }

    if (!shouldEnsureLayerAssetsForShot(shot, options)) {
      continue;
    }

    for (const layer of shot.layers ?? []) {
      const filePath = resolveLayerAssetPath(folderPath, layer.bitmapPath);
      if (await pathExists(filePath)) {
        continue;
      }

      if (layer.kind === "image" && !layer.cleared) {
        await createImageBitmapLayerPng(shot, filePath, layer.width, layer.height, folderPath, options.onCreated);
        continue;
      }

      const legacySketchLayer = sketchLayersForShot(shot).find((item) => item.id === layer.id);
      if (legacySketchLayer && legacySketchLayer.strokes.length > 0) {
        await createPaintBitmapLayerPng(filePath, layer.width, layer.height, legacySketchLayer.strokes, folderPath, options.onCreated);
        continue;
      }

      await createTransparentLayerPng(filePath, layer.width, layer.height, folderPath, options.onCreated);
    }
  }
};

const createImageBitmapLayerPng = async (
  shot: Project["shots"][number],
  filePath: string,
  width: number,
  height: number,
  folderPath: string,
  onCreated?: (receipt: OwnedFileReceipt) => void
): Promise<void> => {
  let composited =
    shot.baseVisible === false
      ? sharp({
          create: {
            width: Math.max(1, Math.round(width)),
            height: Math.max(1, Math.round(height)),
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
          }
        })
      : sharp(shot.imagePath, sharpSourceOptions).rotate().resize({
          width: Math.max(1, Math.round(width)),
          height: Math.max(1, Math.round(height)),
          fit: "fill"
        });

  const edits = shot.imageLayerEdits ?? [];
  if (edits.length > 0) {
    let overlay = await transparentLayerBuffer(width, height);

    for (const stroke of edits) {
      if (stroke.points.length < 4) {
        continue;
      }

      overlay = await sharp(overlay)
        .composite([
          {
            input: strokeSvg(
              stroke.tool === "eraser"
                ? { ...stroke, tool: "brush", color: "#ffffff" }
                : stroke,
              width,
              height
            ),
            blend: "over"
          }
        ])
        .png()
        .toBuffer();
    }

    composited = composited.composite([{ input: overlay, blend: "over" }]);
  }

  await writeProtectedLayerFile(folderPath, filePath, await composited.png().toBuffer(), "create-only", onCreated);
};

const createPaintBitmapLayerPng = async (
  filePath: string,
  width: number,
  height: number,
  strokes: NonNullable<Project["shots"][number]["sketchLayers"]>[number]["strokes"],
  folderPath: string,
  onCreated?: (receipt: OwnedFileReceipt) => void
): Promise<void> => {
  let layerBuffer = await transparentLayerBuffer(width, height);

  for (const stroke of strokes) {
    if (stroke.points.length < 4) {
      continue;
    }

    layerBuffer = await sharp(layerBuffer)
      .composite([
        {
          input: strokeSvg(stroke, width, height),
          blend: stroke.tool === "eraser" ? "dest-out" : "over"
        }
      ])
      .png()
      .toBuffer();
  }

  await writeProtectedLayerFile(folderPath, filePath, layerBuffer, "create-only", onCreated);
};

const transparentLayerBuffer = async (width: number, height: number): Promise<Buffer> => {
  return sharp({
    create: {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .png()
    .toBuffer();
};

const createTransparentLayerPng = async (
  filePath: string,
  width: number,
  height: number,
  folderPath: string,
  onCreated?: (receipt: OwnedFileReceipt) => void
): Promise<void> => {
  const bytes = await sharp({
    create: {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .png()
    .toBuffer();
  await writeProtectedLayerFile(folderPath, filePath, bytes, "create-only", onCreated);
};

const writeProjectMetadata = async (metadataPath: string, project: Project): Promise<void> => {
  await atomicWriteTextFile(metadataPath, `${JSON.stringify(project, null, 2)}\n`, {
    mkdir: async (directoryPath) => {
      await mkdir(directoryPath, { recursive: true });
    },
    writeFile,
    rename,
    unlink
  });
};

const writeProjectFiles = async (
  metadataPath: string,
  folderPath: string,
  project: Project,
  normalSaveScriptInput?: string,
  normalSaveScriptExpectedInput?: string | null
): Promise<void> => {
  const verifyInput = async () => {
    const expected = normalSaveScriptExpectedInput === undefined ? normalSaveScriptInput : normalSaveScriptExpectedInput;
    if (expected === undefined) return; // ordinary persistence did not request observation protection
    let actual: string | null;
    try { actual = await readFile(storyboardScriptPathForFolder(folderPath), "utf8"); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      actual = null;
    }
    if (actual !== expected) {
      throw new Error("Script Import external input changed; both inputs retained");
    }
  };
  await verifyInput();
  await writeProjectMetadata(metadataPath, project);
  await verifyInput();
  if (normalSaveScriptInput !== undefined) {
    // Required MD ACK still exists; do not replace unconsumed external text with captured old text.
    await writeFile(storyboardScriptPathForFolder(folderPath), normalSaveScriptInput, "utf8");
  } else await writeStoryboardScriptMarkdown(folderPath, project);
};

const storyboardScriptPathForFolder = (folderPath: string): string =>
  path.join(folderPath, storyboardScriptFileName);

const projectNeedsSwbImport = (project: Project): boolean => {
  return [...project.shots, ...(project.parkedShots ?? [])].some(
    (shot) =>
      shot.swb?.status === "non-swb" ||
      shot.swb?.status === "compatible-external-edit" ||
      shot.swb?.status === "incompatible-external-edit"
  );
};

const writeStoryboardScriptMarkdown = async (folderPath: string, project: Project): Promise<void> => {
  await writeFile(storyboardScriptPathForFolder(folderPath), serializeStoryboardScriptMarkdown(project), "utf8");
};

const ensureStoryboardScriptMarkdown = async (
  folderPath: string,
  project?: Project,
  readOnly = false
): Promise<boolean> => {
  if (!project) {
    return false;
  }

  try {
    const markdown = await readFile(storyboardScriptPathForFolder(folderPath), "utf8");
    return storyboardScriptNeedsImport(project, markdown);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      if (readOnly) return true;
      await writeStoryboardScriptMarkdown(folderPath, project);
      return false;
    }

    throw error;
  }
};

const userDataPath = (): string => app.getPath("userData");

const userDataRuntime = createUserDataRuntime({
  readToolRadialMenu: readToolRadialMenuFromUserData,
  userDataPath,
  writeToolRadialMenu: writeToolRadialMenuToUserData
});

const recentFoldersRuntime = createRecentFoldersAppRuntime({
  getSender: () => mainWindow?.webContents,
  onOpenFolder: (folderPath) => {
    mainWindow?.webContents.send("recent:openFolder", folderPath);
  },
  readWithRecovery: readRecentFoldersWithRecovery,
  userDataPath,
  writeFolders: writeRecentFoldersToUserData
});

const readRecentFolders = async (): Promise<string[]> => {
  return recentFoldersRuntime.read();
};

const addRecentFolder = async (folderPath: string): Promise<void> => {
  await recentFoldersRuntime.add(folderPath);
};

const removeRecentFolder = async (folderPath: string): Promise<void> => {
  await recentFoldersRuntime.remove(folderPath);
};

const updateRecentFoldersMenu = recentFoldersRuntime.updateMenu;

const importProjectToSwbFormat = async (
  project: Project,
  folderPath: string,
  onProgress?: WorkspaceTaskProgressReporter,
  options: { dirtyShotIds?: Set<string>; preserveDirtyShotLayers?: boolean; normalSaveImageImport?: boolean; normalSaveAutoImageImport?: boolean } = {}
): Promise<SwbImportResult> => {
  return withLayerFileOperation(async () => {
  const archiveRoot = path.join(folderPath, "Archive", archiveStamp());
  const tempRoot = path.join(folderPath, ".storyboard-workbench", "import-tmp", `${archiveStamp()}-${randomUUID()}`);
  const photoshopLayerRoot = path.join(tempRoot, "photoshop-layers");
  const finalLayerRoot = path.join(folderPath, ".storyboard-workbench", "layers");
  const importableShots = [...project.shots, ...(project.parkedShots ?? [])].filter(
    (shot) => shot.swb?.status !== "owned"
  );
  let importedShots = 0;
  const reportShotImported = () => {
    importedShots = Math.min(importableShots.length, importedShots + 1);
    onProgress?.({ kind: "import", current: importedShots, total: importableShots.length });
  };

  if (importableShots.length === 0) {
    return {
      project,
      importedShotIds: [],
      tiffWriteShotIds: [],
      rollback: async () => undefined
    };
  }

  onProgress?.({ kind: "import", current: 0, total: importableShots.length });
  const prepared = await prepareImportStaging(tempRoot, async () => {
  const reserveImportPath = createImportPathReservation(uniquePath);
  const pathPlans = [];
  // Reserve the whole batch in shot order before concurrent TIFF preparation.
  for (const shot of importableShots) {
    const compatibleExternalEdit = shot.swb?.status === "compatible-external-edit";
    const dirtyCompatibleExternalEdit = compatibleExternalEdit && options.dirtyShotIds?.has(shot.id) === true;
    const importMode = compatibleExternalEditImportMode({
      compatibleExternalEdit,
      dirtyShot: dirtyCompatibleExternalEdit,
      preserveDirtyShotLayers: options.preserveDirtyShotLayers === true
    });
    const preserveDirtyLayers = importMode === "preserve-dirty-layers";
    const duplicateExternalEdit = importMode === "duplicate";
    const importShotId = duplicateExternalEdit ? randomUUID() : shot.id;
    const extension = path.extname(shot.imagePath).toLowerCase();
    const baseName = path.basename(shot.imagePath, extension);
    const targetPath = compatibleExternalEdit && !duplicateExternalEdit
      ? shot.imagePath
      : await reserveImportPath(
          path.dirname(shot.imagePath),
          `${baseName}${duplicateExternalEdit ? "-photoshop" : ""}.tiff`,
          shot.imagePath
        );
    const archivePath = compatibleExternalEdit
      ? undefined
      : await reserveImportPath(archiveRoot, path.basename(shot.imagePath));
    pathPlans.push({ shot, compatibleExternalEdit, importMode, preserveDirtyLayers, duplicateExternalEdit, importShotId, targetPath, archivePath });
  }

  return await mapWithConcurrency(
    pathPlans, pathPlans.length, async ({ shot, compatibleExternalEdit, importMode, preserveDirtyLayers, duplicateExternalEdit, importShotId, targetPath, archivePath }) => {
      const sourceHash = options.normalSaveImageImport ? createHash("sha256").update(await readFile(shot.imagePath)).digest("hex") : "";
      const tempPath = path.join(tempRoot, `${importShotId}.tiff`);
      let importedLayers: NonNullable<Project["shots"][number]["layers"]> | undefined;
      let importedLayerMoves: Array<{ fromPath: string; toPath: string }> = [];
      let importedCanvasSize: { width: number; height: number } | undefined;
      let importWarnings: string[] = [];

      if (!compatibleExternalEdit && (await pathExists(targetPath))) {
        throw new Error(`SWB import target already exists: ${targetPath}`);
      }

      if (isLikelyTiffPath(shot.imagePath)) {
        const extractedDir = path.join(photoshopLayerRoot, shot.id, "extracted");
        const manifestPath = path.join(photoshopLayerRoot, shot.id, "manifest.json");

        try {
          await runPhotoshopTiffImporter(
            undefined,
            path.join(app.getAppPath(), "scripts/photoshop-layered-tiff-import.py"),
            shot.imagePath,
            extractedDir,
            manifestPath,
            {
              ...process.env,
              SWB_PYTHON_DEPS_DIR: resolvePhotoshopTiffPythonDepsDir({ appPath: app.getAppPath() })
            }
          );
          const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ImportedPhotoshopTiffManifest;
          const layerPlan = buildPhotoshopTiffImportAssetPlan(manifest, importShotId, finalLayerRoot, extractedDir);
          importedLayers = preserveDirtyLayers ? undefined : layerPlan.layers;
          importedLayerMoves = importedLayerMovesForImportMode(layerPlan.moves, importMode);
          importedCanvasSize = { width: manifest.width, height: manifest.height };
          importWarnings = manifest.warnings;
        } catch (error) {
          if (!isPhotoshopTiffNoLayersError(error)) {
            throw error;
          }
        }
      }

      if (options.normalSaveAutoImageImport) {
        const shape = (layers: Project["shots"][number]["layers"]) => JSON.stringify(layers?.map(({ id, kind, name, visible, opacity, blendMode, order, width, height }) => ({ id, kind, name, visible, opacity, blendMode, order, width, height })));
        if (!importedLayers || importWarnings.length || shape(importedLayers) !== shape(shot.layers)) {
          throw new Error("External layer structure differs or is unproved; local layers and TIFF retained, explicit Import required");
        }
      }
      if (!compatibleExternalEdit || duplicateExternalEdit) {
        await writeSwbImportWorkingTiff({
          sourcePath: shot.imagePath,
          outputPath: tempPath,
          usePlaceholder: Boolean(importedLayers)
        });
      }
      const fingerprint = await pixelFingerprint(compatibleExternalEdit && !duplicateExternalEdit ? shot.imagePath : tempPath);
      const metadata = await sharp(
        compatibleExternalEdit && !duplicateExternalEdit ? shot.imagePath : tempPath,
        sharpSourceOptions
      ).metadata();
      reportShotImported();

      return {
        shot,
        importShotId,
        sourceHash,
        importMode,
        compatibleExternalEdit,
        duplicateExternalEdit,
        targetPath,
        archivePath,
        tempPath,
        fingerprint,
        width: importedCanvasSize?.width ?? metadata.width ?? 0,
        height: importedCanvasSize?.height ?? metadata.height ?? 0,
        importedLayers,
        importedLayerMoves,
        importWarnings
      };
    }
  );
  });

  let archivedOriginals: AppliedFileMoves | undefined;
  let importedTargets: AppliedFileMoves | undefined;
  let importedLayerTargets: AppliedFileMoves | undefined;
  let replacedLayerTargets: AppliedFileReplacements | undefined;
  let layerCommitStarted = false;
  // Shared paths have recovery prerequisites: a failed replacement or target
  // evacuation must stop Archive restoration and every later dependent stage.
  const rollbackImportMoves = async () => {
    if (layerCommitStarted) throw new ImportRecoveryIncompleteError([
      new Error(`Import PNG backup cleanup began; retained assets and remaining staging: ${tempRoot}`)
    ]);
    for (const applied of [replacedLayerTargets, importedLayerTargets, importedTargets, archivedOriginals]) {
      await applied?.rollback();
    }
  };

  try {
    if (options.normalSaveImageImport) for (const item of prepared) {
      if (createHash("sha256").update(await readFile(item.shot.imagePath)).digest("hex") !== item.sourceHash) throw new Error("Import source changed during preparation");
    }
    // Certify every old PNG before any archive/target move. A later protected
    // target must not be discovered only after earlier originals were moved.
    for (const item of prepared) {
      for (const move of item.importedLayerMoves) {
        if (item.compatibleExternalEdit && !item.duplicateExternalEdit && await pathEntryExists(move.toPath)) {
          await prepareProtectedLayerReplacement(folderPath, move.toPath, move.fromPath);
        }
      }
    }
    await mkdir(archiveRoot, { recursive: true });
    const moveOps = {
      mkdir: ensureDirectory,
      rename
    };
    const archiveMoves = prepared
      .filter((item) => item.archivePath)
      .map((item) => ({ fromPath: item.shot.imagePath, toPath: item.archivePath! }));
    if (archiveMoves.length > 0) {
      archivedOriginals = await applyFileMoves(archiveMoves, moveOps);
    }
    const targetMoves = prepared
      .filter((item) => !item.compatibleExternalEdit || item.duplicateExternalEdit)
      .map((item) => ({ fromPath: item.tempPath, toPath: item.targetPath }));
    if (targetMoves.length > 0) {
      importedTargets = await applyFileMoves(targetMoves, moveOps);
    }
    const replaceLayerMoves = [];
    const createLayerMoves = [];
    for (const item of prepared) {
      for (const move of item.importedLayerMoves) {
        if (item.compatibleExternalEdit && !item.duplicateExternalEdit && (await pathEntryExists(move.toPath))) {
          replaceLayerMoves.push(move);
        } else {
          createLayerMoves.push(move);
        }
      }
    }
    if (replaceLayerMoves.length > 0) {
      replacedLayerTargets = await applyFileReplacements(
        replaceLayerMoves.map((move) => ({
          tempPath: move.fromPath,
          targetPath: move.toPath,
          backupPath: path.join(tempRoot, "layer-backup", path.basename(path.dirname(move.toPath)), path.basename(move.toPath))
        })),
        { mkdir: ensureDirectory, rename, unlink }
      );
    }
    const layerMoves = createLayerMoves;
    if (layerMoves.length > 0) {
      await ensureLayerMoveDestinationsAvailable(layerMoves, pathEntryExists);
      // Publish new layer assets without replacing any directory entry that
      // appeared after the availability check; plain rename would clobber it.
      importedLayerTargets = await applyFileCreateOnlyMoves(layerMoves, { mkdir: ensureDirectory, link, unlink });
    }
  } catch (error) {
    return recoverFailedImport(error, [{ rollback: rollbackImportMoves }]);
  }

  const applyPreparedImports = (shots: Project["shots"]): Project["shots"] =>
    shots.flatMap((shot): Project["shots"] => {
      const item = prepared.find((candidate) => candidate.shot.id === shot.id);
      if (!item) {
        return [shot];
      }

      const updatedShot: Project["shots"][number] = {
        ...shot,
        imagePath: item.targetPath,
        previewPath: item.compatibleExternalEdit ? shot.previewPath : undefined,
        fileName: path.basename(item.targetPath),
        sourceFileName: item.compatibleExternalEdit ? shot.sourceFileName : shot.fileName,
        layers: item.importedLayers ?? shot.layers,
        sketchLayers: item.importedLayers ? [] : emptyDefaultSketchLayers(shot) ? [] : shot.sketchLayers,
        activeLayerTarget: "image" as const,
        ...(item.importedLayers ? { activeLayerId: topmostImportedLayerId(item.importedLayers) } : {}),
        importWarnings: item.importWarnings.length > 0 ? item.importWarnings : shot.importWarnings,
        swb: {
          version: swbFormatVersion,
          status: "owned" as const,
          canvasWidth: item.width,
          canvasHeight: item.height,
          baseFingerprint: item.fingerprint,
          sourcePath: item.compatibleExternalEdit ? shot.swb?.sourcePath : shot.imagePath,
          archivePath: item.compatibleExternalEdit ? shot.swb?.archivePath : item.archivePath,
          sourceKind: item.importedLayers ? "photoshop-layered-tiff" as const : shot.swb?.sourceKind
        }
      };
      if (!item.duplicateExternalEdit) {
        return [updatedShot];
      }

      return [
        {
          ...shot,
          swb: shot.swb
            ? {
                ...shot.swb,
                status: "owned" as const,
                baseFingerprint: item.fingerprint,
                statusMessage: undefined
              }
            : shot.swb
        },
        {
          ...updatedShot,
          id: item.importShotId,
          sourceFileName: shot.fileName,
          scriptText: shot.scriptText
        }
      ];
    });

  const nextProject: Project = {
    ...project,
    shots: applyPreparedImports(project.shots).map((shot, order) => ({ ...shot, order })),
    parkedShots: project.parkedShots
      ? applyPreparedImports(project.parkedShots).map((shot, order) => ({ ...shot, order }))
      : undefined,
    updatedAt: new Date().toISOString()
  };

  return {
    project: nextProject,
    importedShotIds: prepared.map((item) => item.importShotId),
    normalSaveImportEffects: options.normalSaveImageImport ? prepared.map(item => ({
      sourceShotId: item.shot.id, shotId: item.importShotId, sourcePath: item.shot.imagePath, sourceHash: item.sourceHash,
      targetPath: item.targetPath, outputHash: "", kind: item.importMode === "preserve-dirty-layers" ? "preserved" as const : item.compatibleExternalEdit ? "accepted" as const : "converted" as const
    })) : undefined,
    tiffWriteShotIds: prepared
      .filter((item) => !item.compatibleExternalEdit || item.duplicateExternalEdit)
      .map((item) => item.importShotId),
    rollback: () => withLayerFileOperation(rollbackImportMoves),
    commit: () => withLayerFileOperation(async () => {
      layerCommitStarted = true;
      await replacedLayerTargets?.commit();
    })
  };
  });
};

const createGeneratedShotFromImage = (
  image: ImportedImage,
  order: number,
  scriptText = ""
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

const importStoryboardScriptMarkdown = async (
  project: Project,
  folderPath: string,
  blankShotPreset: BlankShotPreset,
  frozenMarkdown?: string,
  frozenPlan?: import("./storyboardScript.js").StoryboardScriptImportPlanItem[]
): Promise<StoryboardScriptImportResult> => {
  let markdown: string;
  try {
    markdown = frozenMarkdown ?? await readFile(storyboardScriptPathForFolder(folderPath), "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      // The MD does not exist yet: this is not an import to apply. Do NOT secretly materialize
      // a markdown derived from the captured Project here — the renderer owner is the sole
      // JSON/MD writer after its latest-Project merge, and its required persistence creates the
      // MD from the latest Project (the legacy direct path writes it via writeProjectFiles).
      return { project, rollback: async () => undefined };
    }
    throw error;
  }

  if (!storyboardScriptNeedsImport(project, markdown)) {
    return { project, rollback: async () => undefined };
  }

  const plan = frozenPlan ?? planStoryboardScriptImport(project, parseStoryboardScriptMarkdown(markdown));
  const previewRoot = previewRootForFolder(folderPath);
  const createdFiles: OwnedFileReceipt[] = [];
  const previews: PreviewReceipt[] = [];
  const newShots: Project["shots"] = [];
  const rollbackPreviews = async () => {
    for (const preview of [...previews].reverse()) await preview.rollback();
  };
  const rollbackCreatedFiles = async () => {
    const results = await Promise.allSettled(
      createdFiles.map(receipt => removeOwnedFile(receipt))
    );
    const failed = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed.length) throw new AggregateError(failed.map(result => result.reason),
      `Script Import blank TIFF/preview rollback failed: ${failed.map(result => String(result.reason)).join("; ")}`);
  };
  const rollbackCreatedPaths = async () => {
    await rollbackPreviews();
    await rollbackCreatedFiles();
  };

  try {
    for (const item of plan) {
      if (item.type !== "new") {
        continue;
      }

      const imagePath = await createBlankShot(folderPath, blankShotPreset, receipt => { createdFiles.push(receipt); });
      const [image] = await createImageRecords([imagePath], previewRoot, {
        onPreviewReceipt: receipt => { previews.push(receipt); }
      });
      if (!image) {
        throw new Error("Blank storyboard script shot did not produce an image record");
      }
      newShots.push(createGeneratedShotFromImage(image, 0, item.scriptText));
    }
  } catch (error) {
    await recoverFailedImport(error, [{ rollback: rollbackCreatedPaths }]);
    throw error;
  }

  return {
    project: applyStoryboardScriptImportPlan(project, plan, newShots),
    rollback: rollbackCreatedPaths,
    rollbackPreviews,
    rollbackCreatedFiles,
    commit: async () => { for (const preview of previews) await preview.commit(); }
  };
};

const emptyDefaultSketchLayers = (shot: Project["shots"][number]): boolean => {
  return (
    shot.sketchLayers?.length === 1 &&
    shot.sketchLayers[0].id === "layer-default" &&
    shot.sketchLayers[0].name === "Drawing" &&
    shot.sketchLayers[0].strokes.length === 0
  );
};

const sketchLayersForShot = (
  shot: Project["shots"][number]
): NonNullable<Project["shots"][number]["sketchLayers"]> => {
  return shot.sketchLayers ?? [];
};

const writeSwbMetadataToTiffs = async (
  project: Project,
  folderPath: string,
  onShotWritten?: () => void,
  options: { shotIds?: Set<string>; beforeInstall?: () => Promise<void> } = {}
): Promise<AppliedFileReplacements | undefined> => {
  const createdLayerFiles: OwnedFileReceipt[] = [];
  let preparationDirectory: SavePreparationDirectoryReceipt | undefined;
  try {
    await ensureProjectLayerAssets(project, folderPath, {
      shotIds: options.shotIds, onCreated: receipt => { createdLayerFiles.push(receipt); }
    });
    const shouldProcessShot = (shot: Project["shots"][number]) =>
      !options.shotIds || options.shotIds.has(shot.id);
    const layeredShotIds = new Set(
      project.shots
        .filter((shot) => shouldProcessShot(shot) && shouldWritePhotoshopLayeredTiffOnSave(shot))
        .map((shot) => shot.id)
    );

    // One unique operation directory owns all preparation and recovery artifacts.
    // Layer count changes the encoder, never the installation guarantee.
    const saveStamp = `${archiveStamp()}-${randomUUID()}`;
    const tempFolderPath = path.join(folderPath, ".storyboard-workbench", "save-tmp", saveStamp);
    preparationDirectory = await createSavePreparationDirectory(tempFolderPath);
    // Layered outputs retain legal .tiff filenames at the operation root.
    // This internal directory has no TIFF extension and cannot be such an output.
    const ordinaryFolderPath = path.join(tempFolderPath, ".ordinary");
    const backupFolderPath = path.join(tempFolderPath, ".backups");
    const replacements: Array<{ fromPath: string; toPath: string }> = [];
    await mkdir(ordinaryFolderPath, { recursive: true });

    for (const shot of project.shots) {
      if (!shouldProcessShot(shot)) {
        continue;
      }

      if (!shouldWriteSwbMetadata(shot)) {
        onShotWritten?.();
        continue;
      }

      if (layeredShotIds.has(shot.id)) {
        continue;
      }

      const bakedPath = await bakeShotToWorkingTiff(shot, folderPath, path.join(ordinaryFolderPath, `${shot.id}-bake.tiff`));
      const imagePath = bakedPath ?? shot.imagePath;
      const metadata = await sharp(imagePath, sharpSourceOptions).metadata();
      const fingerprint = await pixelFingerprint(imagePath);
      const canvasWidth = shot.swb?.canvasWidth || metadata.width || 0;
      const canvasHeight = shot.swb?.canvasHeight || metadata.height || 0;
      const swbMetadata = swbMetadataForShot(project.id, shot, canvasWidth, canvasHeight, fingerprint);

      const tempPath = path.join(ordinaryFolderPath, `${shot.id}-metadata.tiff`);
      await sharp(imagePath, sharpSourceOptions).withXmp(swbMetadataXmp(swbMetadata)).tiff({ compression: "none" }).toFile(tempPath);
      replacements.push({ fromPath: tempPath, toPath: shot.imagePath });
      onShotWritten?.();
    }

    if (layeredShotIds.size > 0) {
      const layeredWrite = await preparePhotoshopLayeredTiffsForSave(
        { ...project, shots: project.shots.filter((shot) => layeredShotIds.has(shot.id)) },
        folderPath,
        saveStamp,
        onShotWritten
      );
      replacements.push(...layeredWrite.replacements);
    }

    if (replacements.length === 0) {
      await removeSavePreparationDirectory(preparationDirectory, rm);
      return undefined;
    }
    // Nothing above installs a root TIFF. All encoders must finish first.
    await options.beforeInstall?.();
    const applied = await applyFileReplacements(
      replacements.map((replacement, index) => ({
        tempPath: replacement.fromPath,
        targetPath: replacement.toPath,
        backupPath: path.join(backupFolderPath, `${index}.tiff`)
      })),
      { mkdir: ensureDirectory, rename, unlink }
    );
    return withSuccessfulSaveArtifactCleanup(applied, { tempFolderPath, backupFolderPath, preparationDirectory, remove: rm });
  } catch (error) {
    // Awaited codecs and the draining exporter have settled. Incomplete apply
    // may own old TIFF backups: never delete that namespace or its dependents.
    if (hasIncompleteTiffPreparationEffect(error)) {
      throw new TiffPreparationRecoveryIncompleteError([error], [...new Set([
        ...retainedTiffPreparationPaths(error),
        ...(preparationDirectory ? [preparationDirectory.directoryPath] : []),
        ...createdLayerFiles.map(receipt => receipt.filePath)
      ])]);
    }
    const failures: unknown[] = [], retainedPaths: string[] = [];
    if (preparationDirectory) {
      try { await removeSavePreparationDirectory(preparationDirectory, rm); }
      catch (cleanupError) { failures.push(cleanupError); retainedPaths.push(preparationDirectory.directoryPath); }
    }
    const results = await Promise.allSettled(createdLayerFiles.map(receipt => removeOwnedFile(receipt)));
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        failures.push(result.reason); retainedPaths.push(createdLayerFiles[index].filePath);
      }
    });
    if (failures.length) throw new TiffPreparationRecoveryIncompleteError([error, ...failures], retainedPaths);
    throw error;
  }
};

const preparePhotoshopLayeredTiffsForSave = async (
  project: Project,
  folderPath: string,
  saveStamp: string,
  onShotWritten?: () => void
) => {
  const scriptPath = path.join(app.getAppPath(), "scripts/photoshop-layered-tiff-export.py");
  const env = {
    ...process.env,
    SWB_PYTHON_DEPS_DIR: resolvePhotoshopTiffPythonDepsDir({ appPath: app.getAppPath() })
  };
  const swbMetadataByShotId: Record<string, SwbImageMetadata> = {};

  for (const shot of project.shots) {
    const layers = bitmapLayersForShot(shot);
    const canvasWidth = shot.swb?.canvasWidth || layers[0]?.width || 0;
    const canvasHeight = shot.swb?.canvasHeight || layers[0]?.height || 0;
    swbMetadataByShotId[shot.id] = swbMetadataForShot(project.id, shot, canvasWidth, canvasHeight, "");
  }

  const finalWrite = await writePhotoshopLayeredTiffsForInPlaceSave(project, folderPath, {
    scriptPath,
    saveStamp,
    env,
    swbMetadataByShotId,
    onJobWritten: onShotWritten
  });

  return finalWrite;
};

const createProjectPreviewsForShots = async (
  project: Project,
  folderPath: string,
  shotIds: Set<string>,
  onPreviewReceipt?: (receipt: PreviewReceipt) => void
): Promise<Project> => {
  if (shotIds.size === 0) {
    return project;
  }

  const previewRoot = previewRootForFolder(folderPath);
  const previewByShotId = new Map<string, string>();

  await mapWithConcurrency(
    project.shots, project.shots.length, async (shot) => {
      if (!shotIds.has(shot.id) || !isLikelyTiffPath(shot.imagePath)) {
        return;
      }

      previewByShotId.set(shot.id, await (onPreviewReceipt
        ? createPreview(shot.imagePath, previewRoot, false, onPreviewReceipt)
        : createPreview(shot.imagePath, previewRoot)));
    }
  );

  if (previewByShotId.size === 0) {
    return project;
  }

  return {
    ...project,
    shots: project.shots.map((shot) => {
      const previewPath = previewByShotId.get(shot.id);
      return previewPath ? { ...shot, previewPath } : shot;
    })
  };
};

const shouldWriteSwbMetadata = (shot: Project["shots"][number]): boolean => {
  const extension = path.extname(shot.imagePath).toLowerCase();
  return (
    (extension === ".tif" || extension === ".tiff") &&
    shot.swb?.status !== "non-swb" &&
    shot.swb?.status !== "incompatible-external-edit"
  );
};

const shouldWritePhotoshopLayeredTiffOnSave = (shot: Project["shots"][number]): boolean => {
  return shouldWriteSwbMetadata(shot) && bitmapLayersForShot(shot).length > 1;
};

const bakeShotToWorkingTiff = async (
  shot: Project["shots"][number],
  folderPath: string,
  tempPath: string
): Promise<string | undefined> => {
  return bitmapLayersForShot(shot).length > 0
    ? bakeBitmapLayersToTiff(shot, folderPath, tempPath)
    : bakeSketchOverlayToTiff(shot, tempPath);
};

const swbMetadataForShot = (
  projectId: string,
  shot: Project["shots"][number],
  canvasWidth: number,
  canvasHeight: number,
  baseFingerprint: string
): SwbImageMetadata => {
  const bitmapLayers = bitmapLayersForShot(shot);
  const sketchLayers = sketchLayersForShot(shot);

  return {
    app: "Storyboard Flow",
    format: "swb-tiff",
    version: swbFormatVersion,
    projectId,
    shotId: shot.id,
    canvasWidth,
    canvasHeight,
    baseFingerprint,
    updatedAt: new Date().toISOString(),
    sourcePath: shot.swb?.sourcePath,
    archivePath: shot.swb?.archivePath,
    presentation: shot.presentation,
    imageLayerEdits: [],
    sketchLayers,
    layers:
      bitmapLayers.length > 0
        ? bitmapLayers.map((layer) => ({
            id: layer.id,
            kind: layer.kind,
            name: layer.name,
            visible: layer.visible,
            locked: layer.locked,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
            order: layer.order,
            bitmapPath: layer.bitmapPath,
            width: layer.width,
            height: layer.height,
            strokeCount: 0
          }))
        : sketchLayers.map((layer) => ({
            id: layer.id,
            name: layer.name,
            visible: layer.visible,
            locked: layer.locked,
            opacity: layer.opacity,
            blendMode: layer.blendMode,
            order: layer.order,
            strokeCount: layer.strokes.length
          }))
  };
};

const clearSavedImageLayerEdits = (
  project: Project,
  options: { shotIds?: Set<string> } = {}
): Project => ({
  ...project,
  shots: project.shots.map((shot) => {
    if (options.shotIds && !options.shotIds.has(shot.id)) {
      return shot;
    }

    return {
      ...shot,
      baseVisible: shouldBakeShotImageEdits(shot) ? true : shot.baseVisible,
      imageLayerEdits:
        shouldBakeShotImageEdits(shot) && (shot.imageLayerEdits?.length ?? 0) > 0
          ? []
          : shot.imageLayerEdits
    };
  }),
  updatedAt: new Date().toISOString()
});

const syncSavedSwbBaseFingerprints = async (
  project: Project,
  shotIds?: Set<string>
): Promise<Project> => {
  const shots = await Promise.all(
    project.shots.map(async (shot) => {
      if ((shotIds && !shotIds.has(shot.id)) || !shouldWriteSwbMetadata(shot) || !shot.swb) {
        return shot;
      }

      return {
        ...shot,
        swb: {
          ...shot.swb,
          baseFingerprint: await pixelFingerprint(shot.imagePath)
        }
      };
    })
  );

  return {
    ...project,
    shots
  };
};

const shouldBakeShotImageEdits = (shot: Project["shots"][number]): boolean => {
  const extension = path.extname(shot.imagePath).toLowerCase();
  return (
    (extension === ".tif" || extension === ".tiff") &&
    shot.swb?.status !== "non-swb" &&
    shot.swb?.status !== "incompatible-external-edit" &&
    (shot.baseVisible === false || (shot.imageLayerEdits?.length ?? 0) > 0)
  );
};

const bakeSketchOverlayToTiff = async (
  shot: Project["shots"][number],
  tempPath: string
): Promise<string | undefined> => {
  const layers = sketchLayersForShot(shot);
  const visibleLayers = layers
    .filter((layer) => layer.visible)
    .sort((a, b) => a.order - b.order);
  const visibleImageEdits = shot.imageLayerEdits ?? [];

  if (
    shot.baseVisible !== false &&
    visibleImageEdits.length === 0 &&
    !visibleLayers.some((layer) => layer.strokes.length > 0)
  ) {
    return undefined;
  }

  const imageMetadata = await sharp(shot.imagePath, sharpSourceOptions).metadata();
  const width = imageMetadata.width;
  const height = imageMetadata.height;

  if (!width || !height) {
    return undefined;
  }

  let composited =
    shot.baseVisible === false
      ? sharp({
          create: {
            width,
            height,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 }
          }
        })
      : sharp(shot.imagePath, sharpSourceOptions);

  if (visibleImageEdits.length > 0) {
    let imageEditOverlay = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .png()
      .toBuffer();

    for (const stroke of visibleImageEdits) {
      if (stroke.points.length < 4) {
        continue;
      }

      imageEditOverlay = await sharp(imageEditOverlay)
        .composite([
          {
            input: strokeSvg(
              stroke.tool === "eraser"
                ? { ...stroke, tool: "brush", color: "#ffffff" }
                : stroke,
              width,
              height
            ),
            blend: "over"
          }
        ])
        .png()
        .toBuffer();
    }

    composited = composited.composite([{ input: imageEditOverlay, blend: "over" }]);
  }

  for (const layer of visibleLayers) {
    if (layer.strokes.length === 0) {
      continue;
    }

    let layerOverlay = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
      .png()
      .toBuffer();

    for (const stroke of layer.strokes) {
      if (stroke.points.length < 4) {
        continue;
      }

      layerOverlay = await sharp(layerOverlay)
        .composite([
          {
            input: strokeSvg(
              {
                ...stroke,
                opacity: (stroke.opacity ?? 1) * layer.opacity
              },
              width,
              height
            ),
            blend: stroke.tool === "eraser" ? "dest-out" : "over"
          }
        ])
        .png()
        .toBuffer();
    }

    composited = composited.composite([
      { input: layerOverlay, blend: sharpBlendMode(layer.blendMode) }
    ]);
  }

  await composited.tiff({ compression: "none" }).toFile(tempPath);
  return tempPath;
};

const bakeBitmapLayersToTiff = async (
  shot: Project["shots"][number],
  folderPath: string,
  tempPath: string
): Promise<string | undefined> => {
  const layers = bitmapLayersForShot(shot).filter((layer) => layer.visible);

  if (layers.length === 0) {
    return undefined;
  }

  const imageMetadata = await sharp(shot.imagePath, sharpSourceOptions).metadata();
  const width = shot.swb?.canvasWidth || imageMetadata.width;
  const height = shot.swb?.canvasHeight || imageMetadata.height;

  if (!width || !height) {
    return undefined;
  }

  const composites: BitmapLayerComposite[] = [];

  for (const layer of layers) {
    const layerPath = resolveLayerAssetPath(folderPath, layer.bitmapPath);
    if (!(await pathExists(layerPath))) {
      continue;
    }

    const input = await sharp(layerPath)
      .resize({ width, height, fit: "fill" })
      .ensureAlpha()
      .png()
      .toBuffer();
    composites.push({
      input,
      opacity: layer.opacity,
      blend: sharpBlendMode(layer.blendMode)
    });
  }

  if (composites.length === 0) {
    return undefined;
  }

  await writeFile(tempPath, await flattenBitmapLayerBuffersToTiff(width, height, composites));
  return tempPath;
};

const changedKnownImagePaths = async (
  project: Project,
  imagePaths: string[],
  pendingDeletedPaths: Set<string>,
  onProgress?: WorkspaceTaskProgressReporter
): Promise<string[]> => {
  return findChangedKnownImagePaths(project, imagePaths, pendingDeletedPaths, {
    pixelFingerprint,
    readSwbMetadata,
    onProgress
  });
};

const readProject = async (metadataPath: string): Promise<Project | undefined> => {
  return readProjectMetadata<Project>(metadataPath, { readFile });
};

const createImageRecords = async (
  imagePaths: string[],
  previewRoot: string,
  options: {
    onProgress?: WorkspaceTaskProgressReporter;
    label?: string;
    concurrency?: number;
    readOnly?: boolean;
    deferMissingPreviews?: boolean;
    onPreviewReceipt?: (receipt: PreviewReceipt) => void;
  } = {}
): Promise<ImportedImage[]> => {
  return createImportedImageRecords(imagePaths, previewRoot, {
    createPreview,
    readOnly: options.readOnly,
    deferMissingPreviews: options.deferMissingPreviews,
    onPreviewReceipt: options.onPreviewReceipt,
    onProgress: options.onProgress,
    pixelFingerprint,
    readImageMetadata: async (imagePath) => sharp(imagePath, sharpSourceOptions).metadata(),
    readSwbMetadata,
    label: options.label,
    concurrency: options.concurrency
  });
};

const scanWorkspaceFolder = createWorkspaceFolderScanner({
  collectImagePaths,
  createImageRecords,
  ensureStoryboardScriptMarkdown,
  metadataPathForFolder,
  previewRootForFolder,
  readProject
});

const scanFolder = async (
  folderPath: string,
  onProgress?: WorkspaceTaskProgressReporter,
  options?: import("../normalSaveTransport.js").NormalSaveOpenOptions
) => withLayerFileOperation(async () => {
  // Menu/dialog open reaches this function without a workspace invoke. It must
  // not run ordinary preview/Pending recovery against a protected namespace.
  await assertPhysicalWorkspaceWriterTargets([folderPath]);
  if (options?.normalSave === true) {
    const pendingTransaction = await hasPendingFileTransaction(folderPath);
    const scan = await scanWorkspaceFolder(folderPath, onProgress, true, options.initializePreviews === true);
    if (options.initializePreviews === true) {
      if (pendingTransaction || options.recoverPending === true) throw new Error("Pending recovery and preview initialization require separate admission");
      return initializeNormalOpenPreviews(scan, {
        createImageRecords,
        readLegacyIdentity: (project, shotId) => readTrustedLegacyOutputIdentity(project, shotId, folderPath, {
          exportScriptPath: path.join(app.getAppPath(), "scripts/photoshop-layered-tiff-export.py"),
          importScriptPath: path.join(app.getAppPath(), "scripts/photoshop-layered-tiff-import.py"),
          probeScriptPath: path.join(app.getAppPath(), "scripts/legacy-single-layer-proof.py"),
          env: { ...process.env, SWB_PYTHON_DEPS_DIR: resolvePhotoshopTiffPythonDepsDir({ appPath: app.getAppPath() }) }
        })
      });
    }
    if (!pendingTransaction) return scan;
    if (options.recoverPending === true) {
      await recoverAdmittedNormalPendingFileTransaction(folderPath, scan.project);
      return scan;
    }
    return { ...scan, normalSaveOpenRecoveryRequired: "Pending recovery requires explicit admission; assets and transaction retained" };
  }
  const metadataPath = metadataPathForFolder(folderPath);
  const project = await readProject(metadataPath);
  await recoverPendingFileTransaction(folderPath, project);
  return scanWorkspaceFolder(folderPath, onProgress);
});

const readSwbMetadata = async (imagePath: string): Promise<SwbImageMetadata | undefined> => {
  const metadata = await sharp(imagePath, sharpSourceOptions).metadata();
  const xmp = metadata.xmpAsString;
  if (!xmp) {
    return undefined;
  }

  const match = new RegExp(`<${swbXmpTag}>([^<]+)</${swbXmpTag}>`).exec(xmp);
  if (!match) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(Buffer.from(match[1], "base64").toString("utf8"));
    if (
      parsed &&
      (parsed.app === "Storyboard Flow" || parsed.app === "Storyboard Workbench") &&
      parsed.format === "swb-tiff" &&
      typeof parsed.shotId === "string"
    ) {
      return parsed as SwbImageMetadata;
    }
  } catch {
    return undefined;
  }

  return undefined;
};

const swbMetadataXmp = (metadata: SwbImageMetadata): string => {
  const encoded = Buffer.from(JSON.stringify(metadata), "utf8").toString("base64");
  return `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" xmlns:swb="https://storyboard-workbench.local/ns/1.0/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="">
      <${swbXmpTag}>${encoded}</${swbXmpTag}>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
};

const strokeSvg = (
  stroke: {
    tool: "brush" | "eraser";
    color: string;
    size: number;
    opacity?: number;
    points: number[];
  },
  width: number,
  height: number
): Buffer => {
  const [startX, startY, ...rest] = stroke.points;
  const commands = [
    `M ${svgNumber(startX)} ${svgNumber(startY)}`,
    ...Array.from({ length: Math.floor(rest.length / 2) }, (_item, index) => {
      const x = rest[index * 2];
      const y = rest[index * 2 + 1];
      return `L ${svgNumber(x)} ${svgNumber(y)}`;
    })
  ].join(" ");
  const color = stroke.tool === "eraser" ? "#000000" : safeSvgColor(stroke.color);
  const opacity = Math.max(0, Math.min(1, stroke.opacity ?? 1));
  const strokeWidth = Math.max(1, stroke.size);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <path d="${commands}" fill="none" stroke="${color}" stroke-width="${svgNumber(strokeWidth)}" stroke-opacity="${svgNumber(opacity)}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

  return Buffer.from(svg);
};

const svgNumber = (value: number): string => Number(value.toFixed(3)).toString();

const safeSvgColor = (color: string): string => {
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#000000";
};

const archiveStamp = (): string => {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "");
};

const uniquePath = async (
  directory: string,
  fileName: string,
  isReserved: (candidate: string) => boolean = () => false
): Promise<string> => {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidateName = attempt === 0 ? fileName : `${baseName}_${attempt}${extension}`;
    const candidate = path.join(directory, candidateName);
    if (!isReserved(candidate) && !(await pathEntryExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Could not create a unique path for ${fileName}`);
};
