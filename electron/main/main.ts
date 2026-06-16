import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  protocol,
  safeStorage,
  shell
} from "electron";
import { copyFile, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import {
  applyFileMoves,
  applyFileRenamePlan,
  applyFileReplacements,
  atomicWriteTextFile,
  replaceFileWithTemp,
  type AppliedFileMoves,
  type AppliedFileRenamePlan,
  type AppliedFileReplacements
} from "./fileRenames.js";
import {
  copyBitmapLayerFile,
  flattenBitmapLayerBuffersToTiff,
  shouldEnsureLayerAssetsForShot,
  type BitmapLayerComposite
} from "./bitmapLayers.js";
import { bitmapLayersForShot } from "./bitmapLayerOrdering.js";
import {
  exportPhotoshopLayeredTiffs,
  writePhotoshopLayeredTiffsForInPlaceSave
} from "./photoshopTiffExport.js";
import { withSuccessfulSaveArtifactCleanup } from "./saveArtifacts.js";
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
import { createPreview } from "./previewService.js";
import { createRecentFoldersAppRuntime } from "./recentFoldersAppRuntime.js";
import { assertPathInsideFolder, ensureDirectory, pathExists } from "./pathSafety.js";
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
  inspectStoryboardScriptMarkdownFile
} from "./storyboardScriptProject.js";
import {
  finishSaveAndClose as finishSaveAndCloseRequest,
  getAppInfoForRenderer,
  openExternalUrl,
  respondToStoryboardImageRequest,
  selectFolderPathForEvent,
  updateCloseGuard as updateCloseGuardForWebContents
} from "./appShellService.js";
import {
  attachStoryboardWindowHandlers,
  loadStoryboardWindowEntry,
  storyboardWindowOptions
} from "./appWindowService.js";
import {
  isWorkspaceTemporaryImagePath,
  workspaceCopyTemporaryFileName
} from "./workspaceTemporaryPaths.js";
import {
  copyShotAssets,
  type CopyShotAssetsPayload
} from "./copyShotAssetsService.js";
import { scanWorkspaceFolder } from "./folderScanService.js";
import { createImageRecords as createImportedImageRecords } from "./imageRecordsService.js";
import { changedKnownImagePaths as findChangedKnownImagePaths } from "./knownImageChangesService.js";
import { readProjectMetadata } from "./projectMetadataService.js";
import { createBlankShot, type BlankShotPreset } from "./blankShotService.js";
import { createWorkspaceFolderWatchService } from "./workspaceFolderWatchService.js";
import {
  createWorkspaceTaskProgressReporter,
  type WorkspaceTaskProgressReporter
} from "./workspaceTaskProgress.js";
import { collectImagePaths, metadataPathForFolder } from "./imageDiscoveryService.js";
import { pixelFingerprint } from "./imageFingerprintService.js";
import { createImageAppHandlers } from "./imageAppRuntime.js";
import { createSettingsAppHandlers } from "./settingsAppRuntime.js";
import { createWorkspaceExternalChangesAppHandlers } from "./workspaceExternalChangesAppRuntime.js";
import { createWorkspaceOpenAppHandlers } from "./workspaceOpenAppRuntime.js";
import { createWorkspaceScriptAppHandlers } from "./workspaceScriptAppRuntime.js";
import { createWorkspaceWatchAppHandlers } from "./workspaceWatchAppRuntime.js";
import { createAiAppHandlers } from "./ai/appRuntime.js";
import { registerAiIpcHandlers } from "./ipc/aiHandlers.js";
import { registerAppIpcHandlers } from "./ipc/appHandlers.js";
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
  copyLayerPng,
  deleteLayerPng,
  mergeLayerDown,
  mergeVisibleLayers,
  readLayerPng,
  resolveLayerAssetPath,
  sharpBlendMode,
  writeLayerPng,
  type CopyLayerPngPayload,
  type LayerAssetPayload,
  type MergeLayerDownPayload,
  type MergeVisibleLayersPayload,
  type WriteLayerAssetPayload
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
  id: string;
  name: string;
  naming?: {
    sceneCode: string;
    artistName: string;
    version: string;
  };
  ai?: {
    projectContext?: string;
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

type ProjectPayload = {
  project: Project;
  folderPath: string;
  metadataPath: string;
  renamePlan?: RenamePlanItem[];
  blankShotPreset?: BlankShotPreset;
  dirtyShotIds?: string[];
  preserveDirtyShotLayers?: boolean;
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

type FolderScanPayload = {
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
  project: Project;
  importedShotIds: string[];
  tiffWriteShotIds: string[];
  rollback: () => Promise<void>;
};

type StoryboardScriptImportResult = {
  project: Project;
  rollback: () => Promise<void>;
};

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

const createWindow = async () => {
  mainWindow = new BrowserWindow(storyboardWindowOptions(app.getAppPath()));
  attachStoryboardWindowHandlers(mainWindow, {
    closeGuardWebContentsIds,
    createRequestId: randomUUID,
    saveAndCloseRequests,
    showMessageBoxSync: (owner, options) => dialog.showMessageBoxSync(owner, options)
  });

  await loadStoryboardWindowEntry(mainWindow, {
    appPath: app.getAppPath(),
    devServerUrl: process.env.VITE_DEV_SERVER_URL
  });
};

app.whenReady().then(async () => {
  protocol.handle("storyboard-img", (request) => {
    return respondToStoryboardImageRequest(request.url, (url) => net.fetch(url));
  });

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
  if (process.platform !== "darwin") {
    app.quit();
  }
});

const registerIpcHandlers = () => {
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

  registerAppIpcHandlers(ipcMain, {
    selectFolder: (event) =>
      selectFolderPathForEvent({
        event,
        ownerFromSender: (sender) => BrowserWindow.fromWebContents(sender) ?? undefined,
        showOpenDialog: dialog.showOpenDialog.bind(dialog)
      }),
    finishSaveAndClose: (payload) => finishSaveAndCloseRequest(saveAndCloseRequests, payload),
    updateCloseGuard: (event, payload) =>
      updateCloseGuardForWebContents(closeGuardWebContentsIds, event, payload),
    getInfo: () =>
      getAppInfoForRenderer({
        version: app.getVersion(),
        platform: process.platform,
        arch: process.arch,
        updateManifestUrl:
          process.env.STORYBOARD_FLOW_UPDATE_MANIFEST_URL ??
          "https://raw.githubusercontent.com/lixia88725/storyboard-flow-releases/main/update.json"
      }),
    openExternal: (url) => openExternalUrl(url, shell.openExternal)
  });

  registerWorkspaceScriptIpcHandlers<ProjectPayload, CreateProjectFromStoryboardScriptPayload>(
    ipcMain,
    createWorkspaceScriptAppHandlers({
      inspectStoryboardScript: inspectStoryboardScriptMarkdownFile,
      createFromStoryboardScript: createProjectFromStoryboardScriptMarkdown,
      addRecentFolder,
      ensureStoryboardScriptMarkdown
    })
  );

  registerWorkspacePersistenceIpcHandlers<ProjectPayload>(ipcMain, {
    ensureProjectLayerAssets,
    writeProjectFiles
  });

  ipcMain.handle("workspace:save", async (event, payload: ProjectPayload) => {
    return saveWorkspace(payload, createWorkspaceTaskProgressReporter(event.sender, "save"));
  });

  ipcMain.handle("workspace:exportPhotoshopTiffs", async (_event, payload: ProjectPayload) => {
    await ensureProjectLayerAssets(payload.project, payload.folderPath);
    return exportPhotoshopLayeredTiffs(payload.project, payload.folderPath, {
      scriptPath: path.join(app.getAppPath(), "scripts/photoshop-layered-tiff-export.py"),
      env: {
        ...process.env,
        SWB_PYTHON_DEPS_DIR: resolvePhotoshopTiffPythonDepsDir({ appPath: app.getAppPath() })
      }
    });
  });

  ipcMain.handle("workspace:importSwbFormat", async (event, payload: ProjectPayload) => {
    let scriptImport: StoryboardScriptImportResult | undefined;
    let swbImport: SwbImportResult | undefined;
    try {
      const imageImportNeeded = projectNeedsSwbImport(payload.project);
      scriptImport = await importStoryboardScriptMarkdown(
        payload.project,
        payload.folderPath,
        payload.blankShotPreset ?? "16:9"
      );

      if (!imageImportNeeded) {
        await writeProjectFiles(payload.metadataPath, payload.folderPath, scriptImport.project);
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
          dirtyShotIds: new Set(payload.dirtyShotIds ?? []),
          preserveDirtyShotLayers: payload.preserveDirtyShotLayers
        }
      );
      await writeSwbMetadataToTiffs(
        swbImport.project,
        payload.folderPath,
        undefined,
        { shotIds: new Set(swbImport.tiffWriteShotIds) }
      );
      const importedProject = await createProjectPreviewsForShots(
        swbImport.project,
        payload.folderPath,
        new Set(swbImport.importedShotIds)
      );
      await writeProjectFiles(payload.metadataPath, payload.folderPath, importedProject);
      return {
        folderPath: payload.folderPath,
        folderName: path.basename(payload.folderPath),
        metadataPath: payload.metadataPath,
        project: importedProject,
        images: [],
        scriptImportNeeded: false,
        preserveProjectWithoutImageMerge: true
      } satisfies FolderScanPayload;
    } catch (error) {
      await swbImport?.rollback();
      await scriptImport?.rollback();
      throw error;
    }
  });

  registerWorkspaceExternalChangesIpcHandlers(
    ipcMain,
    createWorkspaceExternalChangesAppHandlers<Project>({
      changedKnownImagePaths,
      createImageRecords,
      ensureStoryboardScriptMarkdown
    })
  );

  registerWorkspaceWatchIpcHandlers(
    ipcMain,
    createWorkspaceWatchAppHandlers({ workspaceFolderWatchService })
  );

  registerLayerIpcHandlers(ipcMain, {
    writePng: (payload) => writeLayerPng(payload as WriteLayerAssetPayload),
    readPng: (payload) => readLayerPng(payload as LayerAssetPayload),
    deletePng: (payload) => deleteLayerPng(payload as LayerAssetPayload),
    copyPng: (payload) => copyLayerPng(payload as CopyLayerPngPayload),
    mergeDown: (payload) => mergeLayerDown(payload as MergeLayerDownPayload),
    mergeVisible: (payload) => mergeVisibleLayers(payload as MergeVisibleLayersPayload)
  });

  registerWorkspaceAssetIpcHandlers(ipcMain, {
    copyShotAssets: (payload) =>
      copyShotAssets(payload as CopyShotAssetsPayload, {
        assertPathInsideFolder,
        copyBitmapLayerFile,
        copyFile,
        createId: randomUUID,
        createPreview,
        previewRootForFolder,
        rename,
        resolveLayerAssetPath,
        unlink,
        uniquePath,
        workspaceCopyTemporaryFileName
      })
  });

  registerImageIpcHandlers(ipcMain, createImageAppHandlers({ createImageRecords }));

  registerRecentIpcHandlers(ipcMain, {
    getFolders: async () => {
      const folders = await readRecentFolders();
      recentFoldersRuntime.flushChangedFolders();
      return folders;
    }
  });

  registerSettingsIpcHandlers(ipcMain, createSettingsAppHandlers(userDataRuntime));

  registerAiIpcHandlers(
    ipcMain,
    createAiAppHandlers({
      aiCredentialStore: userDataRuntime.aiCredentialStore,
      aiSettingsStore: userDataRuntime.aiSettingsStore,
      clipboardWriteText: (text) => clipboard.writeText(text),
    })
  );

};

const saveWorkspace = async (
  payload: ProjectPayload,
  onProgress?: WorkspaceTaskProgressReporter
): Promise<ProjectPayload> => {
  let appliedRenamePlan: AppliedFileRenamePlan | undefined;
  let stagedPendingDeletedFiles: AppliedFileMoves | undefined;
  let swbImport: SwbImportResult | undefined;
  let appliedTiffReplacements: AppliedFileReplacements | undefined;
  let savedProject: Project | undefined;
  let projectToSave = payload.project;
  let savedShots = 0;
  let totalShots = payload.project.shots.length;
  const reportShotSaved = () => {
    savedShots = Math.min(totalShots, savedShots + 1);
    onProgress?.({ kind: "save", current: savedShots, total: totalShots });
  };

  try {
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
    const saveShotIds = saveProgressShotIds(payload.dirtyShotIds, swbImport.tiffWriteShotIds);
    totalShots = countSaveProgressShots(swbProject, saveShotIds);
    savedShots = 0;
    onProgress?.({ kind: "save", current: 0, total: totalShots });
    appliedTiffReplacements = await writeSwbMetadataToTiffs(
      swbProject,
      payload.folderPath,
      reportShotSaved,
      { shotIds: saveShotIds }
    );
    savedProject = await syncSavedSwbBaseFingerprints(
      clearSavedImageLayerEdits(
        swbProject,
        saveShotIds ? { shotIds: saveShotIds } : undefined
      ),
      saveShotIds
    );
    await writeProjectFiles(payload.metadataPath, payload.folderPath, savedProject);
    await appliedTiffReplacements?.commit();
  } catch (error) {
    await appliedTiffReplacements?.rollback();
    await swbImport?.rollback();
    await appliedRenamePlan?.rollback();
    await stagedPendingDeletedFiles?.rollback();
    throw error;
  }

  if (!savedProject) {
    throw new Error("Save did not produce a project");
  }

  const pendingBeforeTrash = savedProject.pendingDeletedShots ?? [];
  const trashResult = await trashPendingDeletedShotFiles(savedProject);
  if (trashResult.project !== savedProject) {
    await writeProjectFiles(payload.metadataPath, payload.folderPath, trashResult.project);
  }
  await cleanupDeletedShotLayerDirectories({
    folderPath: payload.folderPath,
    previousPendingDeletedShots: pendingBeforeTrash,
    nextPendingDeletedShots: trashResult.project.pendingDeletedShots ?? []
  });
  if (trashResult.error) {
    throw trashResult.error;
  }

  return { ...payload, project: trashResult.project };
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
  options: { includeExternalShots?: boolean; shotIds?: Set<string> } = {}
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

      await mkdir(path.dirname(filePath), { recursive: true });

      if (layer.kind === "image" && !layer.cleared) {
        await createImageBitmapLayerPng(shot, filePath, layer.width, layer.height);
        continue;
      }

      const legacySketchLayer = sketchLayersForShot(shot).find((item) => item.id === layer.id);
      if (legacySketchLayer && legacySketchLayer.strokes.length > 0) {
        await createPaintBitmapLayerPng(filePath, layer.width, layer.height, legacySketchLayer.strokes);
        continue;
      }

      await createTransparentLayerPng(filePath, layer.width, layer.height);
    }
  }
};

const createImageBitmapLayerPng = async (
  shot: Project["shots"][number],
  filePath: string,
  width: number,
  height: number
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

  await composited.png().toFile(filePath);
};

const createPaintBitmapLayerPng = async (
  filePath: string,
  width: number,
  height: number,
  strokes: NonNullable<Project["shots"][number]["sketchLayers"]>[number]["strokes"]
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

  await writeFile(filePath, layerBuffer);
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
  height: number
): Promise<void> => {
  await sharp({
    create: {
      width: Math.max(1, Math.round(width)),
      height: Math.max(1, Math.round(height)),
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 }
    }
  })
    .png()
    .toFile(filePath);
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
  project: Project
): Promise<void> => {
  await writeProjectMetadata(metadataPath, project);
  await writeStoryboardScriptMarkdown(folderPath, project);
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
  project?: Project
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
      await writeStoryboardScriptMarkdown(folderPath, project);
      return false;
    }

    throw error;
  }
};

const userDataPath = (): string => app.getPath("userData");

const userDataRuntime = createUserDataRuntime({
  crypto: safeStorage,
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
  options: { dirtyShotIds?: Set<string>; preserveDirtyShotLayers?: boolean } = {}
): Promise<SwbImportResult> => {
  const archiveRoot = path.join(folderPath, "Archive", archiveStamp());
  const tempRoot = path.join(folderPath, ".storyboard-workbench", "import-tmp", archiveStamp());
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
  await mkdir(tempRoot, { recursive: true });

  const prepared = await Promise.all(
    importableShots.map(async (shot) => {
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
        : await uniquePath(
            path.dirname(shot.imagePath),
            `${baseName}${duplicateExternalEdit ? "-photoshop" : ""}.tiff`
          );
      const archivePath = compatibleExternalEdit
        ? undefined
        : await uniquePath(archiveRoot, path.basename(shot.imagePath));
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
    })
  );

  let archivedOriginals: AppliedFileMoves | undefined;
  let importedTargets: AppliedFileMoves | undefined;
  let importedLayerTargets: AppliedFileMoves | undefined;
  let replacedLayerTargets: AppliedFileReplacements | undefined;
  const rollbackImportMoves = async () => {
    await replacedLayerTargets?.rollback();
    await importedLayerTargets?.rollback();
    await importedTargets?.rollback();
    await archivedOriginals?.rollback();
  };

  try {
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
        if (item.compatibleExternalEdit && !item.duplicateExternalEdit && (await pathExists(move.toPath))) {
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
      await ensureLayerMoveDestinationsAvailable(layerMoves, pathExists);
      importedLayerTargets = await applyFileMoves(layerMoves, moveOps);
    }
  } catch (error) {
    await rollbackImportMoves();
    throw error;
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
    tiffWriteShotIds: prepared
      .filter((item) => !item.compatibleExternalEdit || item.duplicateExternalEdit)
      .map((item) => item.importShotId),
    rollback: rollbackImportMoves
  };
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
  blankShotPreset: BlankShotPreset
): Promise<StoryboardScriptImportResult> => {
  let markdown: string;
  try {
    markdown = await readFile(storyboardScriptPathForFolder(folderPath), "utf8");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      await writeStoryboardScriptMarkdown(folderPath, project);
      return { project, rollback: async () => undefined };
    }
    throw error;
  }

  if (!storyboardScriptNeedsImport(project, markdown)) {
    return { project, rollback: async () => undefined };
  }

  const plan = planStoryboardScriptImport(project, parseStoryboardScriptMarkdown(markdown));
  const previewRoot = previewRootForFolder(folderPath);
  const createdPaths: string[] = [];
  const newShots: Project["shots"] = [];
  const rollbackCreatedPaths = async () => {
    await Promise.all(
      createdPaths.map((filePath) =>
        unlink(filePath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") {
            throw error;
          }
        })
      )
    );
  };

  try {
    for (const item of plan) {
      if (item.type !== "new") {
        continue;
      }

      const imagePath = await createBlankShot(folderPath, blankShotPreset);
      createdPaths.push(imagePath);
      const [image] = await createImageRecords([imagePath], previewRoot);
      if (!image) {
        throw new Error("Blank storyboard script shot did not produce an image record");
      }
      if (image.previewPath) {
        createdPaths.push(image.previewPath);
      }
      newShots.push(createGeneratedShotFromImage(image, 0, item.scriptText));
    }
  } catch (error) {
    await rollbackCreatedPaths().catch(() => undefined);
    throw error;
  }

  return {
    project: applyStoryboardScriptImportPlan(project, plan, newShots),
    rollback: rollbackCreatedPaths
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
  options: { shotIds?: Set<string> } = {}
): Promise<AppliedFileReplacements | undefined> => {
  await ensureProjectLayerAssets(project, folderPath, { shotIds: options.shotIds });
  const shouldProcessShot = (shot: Project["shots"][number]) =>
    !options.shotIds || options.shotIds.has(shot.id);
  const layeredShotIds = new Set(
    project.shots
      .filter((shot) => shouldProcessShot(shot) && shouldWritePhotoshopLayeredTiffOnSave(shot))
      .map((shot) => shot.id)
  );

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

    const bakedPath = await bakeShotToWorkingTiff(shot, folderPath);
    const imagePath = bakedPath ?? shot.imagePath;
    const metadata = await sharp(imagePath, sharpSourceOptions).metadata();
    const fingerprint = await pixelFingerprint(imagePath);
    const canvasWidth = shot.swb?.canvasWidth || metadata.width || 0;
    const canvasHeight = shot.swb?.canvasHeight || metadata.height || 0;
    const swbMetadata = swbMetadataForShot(project.id, shot, canvasWidth, canvasHeight, fingerprint);

    const tempPath = path.join(
      path.dirname(imagePath),
      `.storyboard-metadata-${shot.id}${path.extname(imagePath)}`
    );
    try {
      await sharp(imagePath, sharpSourceOptions).withXmp(swbMetadataXmp(swbMetadata)).tiff().toFile(tempPath);
      await replaceFileWithTemp(tempPath, shot.imagePath, { rename, unlink });
    } finally {
      await unlink(tempPath).catch(() => undefined);
      if (bakedPath) {
        await unlink(bakedPath).catch(() => undefined);
      }
    }
    onShotWritten?.();
  }

  if (layeredShotIds.size === 0) {
    return undefined;
  }

  return writePhotoshopLayeredTiffsForSave(
    {
      ...project,
      shots: project.shots.filter((shot) => layeredShotIds.has(shot.id))
    },
    folderPath,
    onShotWritten
  );
};

const writePhotoshopLayeredTiffsForSave = async (
  project: Project,
  folderPath: string,
  onShotWritten?: () => void
): Promise<AppliedFileReplacements> => {
  const saveStamp = archiveStamp();
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

  const backupFolderPath = path.join(folderPath, ".storyboard-workbench", "save-backup", saveStamp);
  const applied = await applyFileReplacements(
    finalWrite.replacements.map((replacement) => ({
      tempPath: replacement.fromPath,
      targetPath: replacement.toPath,
      backupPath: path.join(backupFolderPath, path.basename(replacement.toPath))
    })),
    { mkdir: ensureDirectory, rename, unlink }
  );

  return withSuccessfulSaveArtifactCleanup(applied, {
    tempFolderPath: finalWrite.tempFolderPath,
    backupFolderPath,
    remove: rm
  });
};

const createProjectPreviewsForShots = async (
  project: Project,
  folderPath: string,
  shotIds: Set<string>
): Promise<Project> => {
  if (shotIds.size === 0) {
    return project;
  }

  const previewRoot = previewRootForFolder(folderPath);
  const previewByShotId = new Map<string, string>();

  await Promise.all(
    project.shots.map(async (shot) => {
      if (!shotIds.has(shot.id) || !isLikelyTiffPath(shot.imagePath)) {
        return;
      }

      previewByShotId.set(shot.id, await createPreview(shot.imagePath, previewRoot));
    })
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
  folderPath: string
): Promise<string | undefined> => {
  return bitmapLayersForShot(shot).length > 0
    ? bakeBitmapLayersToTiff(shot, folderPath)
    : bakeSketchOverlayToTiff(shot);
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
  shot: Project["shots"][number]
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

  const tempPath = path.join(
    path.dirname(shot.imagePath),
    `.storyboard-bake-${shot.id}${path.extname(shot.imagePath)}`
  );
  await composited.tiff().toFile(tempPath);
  return tempPath;
};

const bakeBitmapLayersToTiff = async (
  shot: Project["shots"][number],
  folderPath: string
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

  const tempPath = path.join(
    path.dirname(shot.imagePath),
    `.storyboard-bake-${shot.id}${path.extname(shot.imagePath)}`
  );
  await writeFile(tempPath, await flattenBitmapLayerBuffersToTiff(width, height, composites));
  return tempPath;
};

const scanFolder = async (
  folderPath: string,
  onProgress?: WorkspaceTaskProgressReporter
): Promise<FolderScanPayload> => {
  return scanWorkspaceFolder(folderPath, onProgress, {
    collectImagePaths,
    createImageRecords,
    ensureStoryboardScriptMarkdown,
    metadataPathForFolder,
    previewRootForFolder,
    readProject
  });
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
  } = {}
): Promise<ImportedImage[]> => {
  return createImportedImageRecords(imagePaths, previewRoot, {
    createPreview,
    onProgress: options.onProgress,
    pixelFingerprint,
    readImageMetadata: async (imagePath) => sharp(imagePath, sharpSourceOptions).metadata(),
    readSwbMetadata,
    label: options.label,
    concurrency: options.concurrency
  });
};

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

const uniquePath = async (directory: string, fileName: string): Promise<string> => {
  const extension = path.extname(fileName);
  const baseName = path.basename(fileName, extension);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidateName = attempt === 0 ? fileName : `${baseName}_${attempt}${extension}`;
    const candidate = path.join(directory, candidateName);
    if (!(await pathExists(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Could not create a unique path for ${fileName}`);
};
