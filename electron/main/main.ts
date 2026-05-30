import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
  type IpcMainInvokeEvent
} from "electron";
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import {
  applyFileMoves,
  applyFileRenamePlan,
  applyFileReplacements,
  replaceFileWithTemp,
  type AppliedFileMoves,
  type AppliedFileRenamePlan,
  type AppliedFileReplacements
} from "./fileRenames.js";
import {
  flattenBitmapLayerBuffersToTiff,
  shouldEnsureLayerAssetsForShot,
  type BitmapLayerComposite
} from "./bitmapLayers.js";
import { bitmapLayersForShot } from "./bitmapLayerOrdering.js";
import {
  exportPhotoshopLayeredTiffs,
  writePhotoshopLayeredTiffsForInPlaceSave
} from "./photoshopTiffExport.js";
import {
  buildPhotoshopTiffImportAssetPlan,
  ensureLayerMoveDestinationsAvailable,
  isPhotoshopTiffNoLayersError,
  isLikelyTiffPath,
  runPhotoshopTiffImporter,
  topmostImportedLayerId,
  writeSwbImportWorkingTiff,
  type ImportedPhotoshopTiffManifest
} from "./photoshopTiffImport.js";
import { resolvePhotoshopTiffPythonDepsDir } from "./photoshopTiffDeps.js";
import {
  applyStoryboardScriptImportPlan,
  parseStoryboardScriptMarkdown,
  planStoryboardScriptImport,
  serializeStoryboardScriptMarkdown,
  storyboardScriptFileName,
  storyboardScriptNeedsImport
} from "./storyboardScript.js";

const swbFormatVersion = 1;
const swbXmpTag = "swb:metadata";
const blankShotPresets = {
  "16:9": { width: 1920, height: 1080 },
  "2.39:1": { width: 2581, height: 1080 },
  "1.43:1": { width: 1544, height: 1080 }
} as const;
type BlankShotPreset = keyof typeof blankShotPresets;
type WorkspaceTaskProgress = {
  kind: "save" | "import";
  current: number;
  total: number;
};
type WorkspaceTaskProgressReporter = (progress: WorkspaceTaskProgress) => void;

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
};

type LayerAssetPayload = {
  folderPath: string;
  bitmapPath: string;
};

type WriteLayerAssetPayload = LayerAssetPayload & {
  dataUrl: string;
};

type KeyboardShortcuts = Record<string, string>;

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
  app: "Storyboard Workbench";
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
  rollback: () => Promise<void>;
};

type StoryboardScriptImportResult = {
  project: Project;
  rollback: () => Promise<void>;
};

const supportedExtensions = new Set([".png", ".jpg", ".jpeg", ".tif", ".tiff"]);
let mainWindow: BrowserWindow | undefined;
const maxRecentFolders = 10;

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

const createWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "Storyboard Workbench",
    backgroundColor: "#f3f0e8",
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron/preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[preload-error] ${preloadPath}: ${error.message}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(path.join(app.getAppPath(), "dist/index.html"));
  }
};

app.whenReady().then(async () => {
  protocol.handle("storyboard-img", (request) => {
    const requestUrl = new URL(request.url);
    const filePath = requestUrl.searchParams.get("path");

    if (!filePath) {
      return new Response("Missing path", { status: 400 });
    }

    return net.fetch(pathToFileURL(filePath).toString());
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
  if (process.platform !== "darwin") {
    app.quit();
  }
});

const registerIpcHandlers = () => {
  ipcMain.handle("workspace:openFolderByPath", async (_event, folderPath: string) => {
    const scan = await scanFolder(folderPath);
    await addRecentFolder(scan.folderPath);
    return scan;
  });

  ipcMain.handle("workspace:autosave", async (_event, payload: ProjectPayload) => {
    await ensureProjectLayerAssets(payload.project, payload.folderPath, { includeExternalShots: false });
    await writeProjectFiles(payload.metadataPath, payload.folderPath, payload.project);
    return payload;
  });

  ipcMain.handle("workspace:save", async (event, payload: ProjectPayload) => {
    return saveWorkspace(payload, workspaceTaskProgressReporter(event, "save"));
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
        workspaceTaskProgressReporter(event, "import")
      );
      await writeSwbMetadataToTiffs(swbImport.project, payload.folderPath, undefined, {
        shotIds: new Set(swbImport.importedShotIds)
      });
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

  ipcMain.handle("workspace:checkStoryboardScript", async (_event, payload: ProjectPayload) => {
    return {
      scriptImportNeeded: await ensureStoryboardScriptMarkdown(payload.folderPath, payload.project)
    };
  });

  ipcMain.handle("workspace:checkExternalChanges", async (_event, payload: ProjectPayload) => {
    const previewRoot = previewRootForFolder(payload.folderPath);
    const imagePaths = await collectImagePaths([payload.folderPath]);
    const existingPaths = new Set(payload.project.shots.map((shot) => shot.imagePath));
    const pendingDeletedPaths = new Set(
      (payload.project.pendingDeletedShots ?? []).map((shot) => shot.imagePath)
    );
    const newImagePaths = imagePaths.filter(
      (imagePath) => !existingPaths.has(imagePath) && !pendingDeletedPaths.has(imagePath)
    );
    return {
      images: await createImageRecords(newImagePaths, previewRoot),
      scriptImportNeeded: await ensureStoryboardScriptMarkdown(payload.folderPath, payload.project)
    };
  });

  ipcMain.handle("layers:writePng", async (_event, payload: WriteLayerAssetPayload) => {
    const filePath = resolveLayerAssetPath(payload.folderPath, payload.bitmapPath);
    const pngBuffer = pngBufferFromDataUrl(payload.dataUrl);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, pngBuffer);
    return { ...payload, filePath };
  });

  ipcMain.handle("layers:readPng", async (_event, payload: LayerAssetPayload) => {
    const filePath = resolveLayerAssetPath(payload.folderPath, payload.bitmapPath);
    if (!(await pathExists(filePath))) {
      return undefined;
    }

    const pngBuffer = await readFile(filePath);
    return `data:image/png;base64,${pngBuffer.toString("base64")}`;
  });

  ipcMain.handle("layers:deletePng", async (_event, payload: LayerAssetPayload) => {
    const filePath = resolveLayerAssetPath(payload.folderPath, payload.bitmapPath);
    await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
    return payload;
  });

  ipcMain.handle(
    "images:createBlankShot",
    async (_event, folderPath: string, options?: { preset?: BlankShotPreset }) => {
      const imagePath = await createBlankShot(folderPath, options?.preset ?? "16:9");
      const previewRoot = previewRootForFolder(folderPath);
      const [image] = await createImageRecords([imagePath], previewRoot);
      return image;
    }
  );

  ipcMain.handle("recent:getFolders", async () => {
    return readRecentFolders();
  });

  ipcMain.handle("settings:getKeyboardShortcuts", async () => {
    return readKeyboardShortcuts();
  });

  ipcMain.handle("settings:setKeyboardShortcuts", async (_event, shortcuts: KeyboardShortcuts) => {
    await writeKeyboardShortcuts(shortcuts);
    return shortcuts;
  });
};

const workspaceTaskProgressReporter =
  (event: IpcMainInvokeEvent, kind: WorkspaceTaskProgress["kind"]): WorkspaceTaskProgressReporter =>
  (progress) => {
    event.sender.send("workspace:taskProgress", { ...progress, kind });
  };

const saveWorkspace = async (
  payload: ProjectPayload,
  onProgress?: WorkspaceTaskProgressReporter
): Promise<ProjectPayload> => {
  let appliedRenamePlan: AppliedFileRenamePlan | undefined;
  let swbImport: SwbImportResult | undefined;
  let appliedTiffReplacements: AppliedFileReplacements | undefined;
  let savedProject: Project | undefined;
  let savedShots = 0;
  const totalShots = payload.project.shots.length;
  const reportShotSaved = () => {
    savedShots = Math.min(totalShots, savedShots + 1);
    onProgress?.({ kind: "save", current: savedShots, total: totalShots });
  };

  try {
    onProgress?.({ kind: "save", current: 0, total: totalShots });
    if (payload.renamePlan && payload.renamePlan.length > 0) {
      await assertRenamePlanSafe(payload.renamePlan);
      appliedRenamePlan = await applyFileRenamePlan(payload.renamePlan, {
        mkdir: ensureDirectory,
        rename
      });
    }

    swbImport = await importProjectToSwbFormat(payload.project, payload.folderPath);
    const swbProject = swbImport.project;
    const saveShotIds = new Set([...(payload.dirtyShotIds ?? []), ...swbImport.importedShotIds]);
    appliedTiffReplacements = await writeSwbMetadataToTiffs(
      swbProject,
      payload.folderPath,
      reportShotSaved,
      { shotIds: payload.dirtyShotIds ? saveShotIds : undefined }
    );
    savedProject = clearSavedImageLayerEdits(
      swbProject,
      payload.dirtyShotIds ? { shotIds: saveShotIds } : undefined
    );
    await writeProjectFiles(payload.metadataPath, payload.folderPath, savedProject);
    await appliedTiffReplacements?.commit();
  } catch (error) {
    await appliedTiffReplacements?.rollback();
    await swbImport?.rollback();
    await appliedRenamePlan?.rollback();
    throw error;
  }

  if (!savedProject) {
    throw new Error("Save did not produce a project");
  }

  const trashResult = await trashPendingDeletedShotFiles(savedProject);
  if (trashResult.project !== savedProject) {
    await writeProjectFiles(payload.metadataPath, payload.folderPath, trashResult.project);
  }
  if (trashResult.error) {
    throw trashResult.error;
  }

  return { ...payload, project: trashResult.project };
};

const trashPendingDeletedShotFiles = async (
  project: Project
): Promise<{ project: Project; error?: Error }> => {
  const pending = project.pendingDeletedShots ?? [];

  if (pending.length === 0) {
    return { project };
  }

  const remaining: PendingDeletedShot[] = [];
  const failed: PendingDeletedShot[] = [];

  for (const shot of pending) {
    if (!(await pathExists(shot.imagePath))) {
      continue;
    }

    try {
      await shell.trashItem(shot.imagePath);
    } catch {
      remaining.push(shot);
      failed.push(shot);
    }
  }

  const nextProject: Project = {
    ...project,
    pendingDeletedShots: remaining.length > 0 ? remaining : undefined,
    updatedAt: new Date().toISOString()
  };

  if (failed.length === 0) {
    return { project: nextProject };
  }

  const fileList = failed.map((shot) => shot.fileName).join(", ");
  return {
    project: nextProject,
    error: new Error(`Could not move deleted storyboard files to Trash: ${fileList}`)
  };
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

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return false;
    }

    throw error;
  }
};

const ensureDirectory = async (directoryPath: string): Promise<void> => {
  await mkdir(directoryPath, { recursive: true });
};

const resolveLayerAssetPath = (folderPath: string, bitmapPath: string): string => {
  if (path.isAbsolute(bitmapPath)) {
    throw new Error("Layer bitmap path must be relative");
  }

  const normalized = path.normalize(bitmapPath);
  const expectedPrefix = path.join(".storyboard-workbench", "layers");

  if (
    normalized === expectedPrefix ||
    !normalized.startsWith(`${expectedPrefix}${path.sep}`) ||
    normalized.split(path.sep).includes("..")
  ) {
    throw new Error(`Layer bitmap path must stay under ${expectedPrefix}`);
  }

  return path.join(folderPath, normalized);
};

const pngBufferFromDataUrl = (dataUrl: string): Buffer => {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/u.exec(dataUrl);

  if (!match) {
    throw new Error("Layer asset must be a PNG data URL");
  }

  return Buffer.from(match[1], "base64");
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
      : sharp(shot.imagePath).rotate().resize({
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
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
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
  return project.shots.some(
    (shot) => shot.swb?.status === "non-swb" || shot.swb?.status === "incompatible-external-edit"
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

const recentFoldersPath = (): string => {
  return path.join(app.getPath("userData"), "recent-folders.json");
};

const keyboardShortcutsPath = (): string => {
  return path.join(app.getPath("userData"), "keyboard-shortcuts.json");
};

const readKeyboardShortcuts = async (): Promise<KeyboardShortcuts> => {
  try {
    const contents = await readFile(keyboardShortcutsPath(), "utf8");
    const parsed = JSON.parse(contents);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return {};
    }

    throw error;
  }
};

const writeKeyboardShortcuts = async (shortcuts: KeyboardShortcuts): Promise<void> => {
  await mkdir(path.dirname(keyboardShortcutsPath()), { recursive: true });
  await writeFile(keyboardShortcutsPath(), `${JSON.stringify(shortcuts, null, 2)}\n`, "utf8");
};

const readRecentFolders = async (): Promise<string[]> => {
  try {
    const contents = await readFile(recentFoldersPath(), "utf8");
    const parsed = JSON.parse(contents);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, maxRecentFolders)
      : [];
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return [];
    }

    throw error;
  }
};

const writeRecentFolders = async (folders: string[]): Promise<void> => {
  await mkdir(path.dirname(recentFoldersPath()), { recursive: true });
  await writeFile(recentFoldersPath(), `${JSON.stringify(folders.slice(0, maxRecentFolders), null, 2)}\n`, "utf8");
  await updateRecentFoldersMenu();
  mainWindow?.webContents.send("recent:foldersChanged", folders.slice(0, maxRecentFolders));
};

const addRecentFolder = async (folderPath: string): Promise<void> => {
  const existing = await readRecentFolders();
  const next = [folderPath, ...existing.filter((item) => item !== folderPath)].slice(
    0,
    maxRecentFolders
  );
  await writeRecentFolders(next);
};

const updateRecentFoldersMenu = async (): Promise<void> => {
  const recentFolders = await readRecentFolders();
  const submenu = [
    {
      label: "Open Recent",
      submenu:
        recentFolders.length > 0
          ? recentFolders.map((folderPath) => ({
              label: folderPath,
              click: () => {
                mainWindow?.webContents.send("recent:openFolder", folderPath);
              }
            }))
          : [{ label: "No Recent Folders", enabled: false }]
    }
  ];
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
};

const importProjectToSwbFormat = async (
  project: Project,
  folderPath: string,
  onProgress?: WorkspaceTaskProgressReporter
): Promise<SwbImportResult> => {
  const archiveRoot = path.join(folderPath, "Archive", archiveStamp());
  const tempRoot = path.join(folderPath, ".storyboard-workbench", "import-tmp", archiveStamp());
  const photoshopLayerRoot = path.join(tempRoot, "photoshop-layers");
  const finalLayerRoot = path.join(folderPath, ".storyboard-workbench", "layers");
  const importableShots = project.shots.filter((shot) => shot.swb?.status !== "owned");
  let importedShots = 0;
  const reportShotImported = () => {
    importedShots = Math.min(importableShots.length, importedShots + 1);
    onProgress?.({ kind: "import", current: importedShots, total: importableShots.length });
  };

    if (importableShots.length === 0) {
    return {
      project,
      importedShotIds: [],
      rollback: async () => undefined
    };
  }

  onProgress?.({ kind: "import", current: 0, total: importableShots.length });
  await mkdir(tempRoot, { recursive: true });

  const prepared = await Promise.all(
    importableShots.map(async (shot) => {
      const extension = path.extname(shot.imagePath).toLowerCase();
      const baseName = path.basename(shot.imagePath, extension);
      const targetPath = await uniquePath(path.dirname(shot.imagePath), `${baseName}.tiff`);
      const archivePath = await uniquePath(archiveRoot, path.basename(shot.imagePath));
      const tempPath = path.join(tempRoot, `${shot.id}.tiff`);
      let importedLayers: NonNullable<Project["shots"][number]["layers"]> | undefined;
      let importedLayerMoves: Array<{ fromPath: string; toPath: string }> = [];
      let importedCanvasSize: { width: number; height: number } | undefined;
      let importWarnings: string[] = [];

      if (await pathExists(targetPath)) {
        throw new Error(`SWB import target already exists: ${targetPath}`);
      }

      if (isLikelyTiffPath(shot.imagePath)) {
        const extractedDir = path.join(photoshopLayerRoot, shot.id, "extracted");
        const manifestPath = path.join(photoshopLayerRoot, shot.id, "manifest.json");

        try {
          await runPhotoshopTiffImporter(
            "python3",
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
          const layerPlan = buildPhotoshopTiffImportAssetPlan(manifest, shot.id, finalLayerRoot, extractedDir);
          importedLayers = layerPlan.layers;
          importedLayerMoves = layerPlan.moves;
          importedCanvasSize = { width: manifest.width, height: manifest.height };
          importWarnings = manifest.warnings;
        } catch (error) {
          if (!isPhotoshopTiffNoLayersError(error)) {
            throw error;
          }
        }
      }

      await writeSwbImportWorkingTiff({
        sourcePath: shot.imagePath,
        outputPath: tempPath,
        usePlaceholder: Boolean(importedLayers)
      });
      const fingerprint = await pixelFingerprint(tempPath);
      const metadata = await sharp(tempPath).metadata();
      reportShotImported();

      return {
        shot,
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
  const rollbackImportMoves = async () => {
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
    archivedOriginals = await applyFileMoves(
      prepared.map((item) => ({ fromPath: item.shot.imagePath, toPath: item.archivePath })),
      moveOps
    );
    importedTargets = await applyFileMoves(
      prepared.map((item) => ({ fromPath: item.tempPath, toPath: item.targetPath })),
      moveOps
    );
    const layerMoves = prepared.flatMap((item) => item.importedLayerMoves);
    if (layerMoves.length > 0) {
      await ensureLayerMoveDestinationsAvailable(layerMoves, pathExists);
      importedLayerTargets = await applyFileMoves(layerMoves, moveOps);
    }
  } catch (error) {
    await rollbackImportMoves();
    throw error;
  }

  const nextProject: Project = {
    ...project,
    shots: project.shots.map((shot) => {
      const item = prepared.find((candidate) => candidate.shot.id === shot.id);
      if (!item) {
        return shot;
      }

      return {
        ...shot,
        imagePath: item.targetPath,
        previewPath: undefined,
        fileName: path.basename(item.targetPath),
        sourceFileName: shot.fileName,
        layers: item.importedLayers ?? shot.layers,
        sketchLayers: item.importedLayers ? [] : emptyDefaultSketchLayers(shot) ? [] : shot.sketchLayers,
        activeLayerTarget: "image",
        ...(item.importedLayers ? { activeLayerId: topmostImportedLayerId(item.importedLayers) } : {}),
        importWarnings: item.importWarnings.length > 0 ? item.importWarnings : shot.importWarnings,
        swb: {
          version: swbFormatVersion,
          status: "owned",
          canvasWidth: item.width,
          canvasHeight: item.height,
          baseFingerprint: item.fingerprint,
          sourcePath: shot.imagePath,
          archivePath: item.archivePath,
          sourceKind: item.importedLayers ? "photoshop-layered-tiff" : undefined
        }
      };
    }),
    updatedAt: new Date().toISOString()
  };

  return {
    project: nextProject,
    importedShotIds: prepared.map((item) => item.shot.id),
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
    const metadata = await sharp(imagePath).metadata();
    const fingerprint = await pixelFingerprint(imagePath);
    const canvasWidth = shot.swb?.canvasWidth || metadata.width || 0;
    const canvasHeight = shot.swb?.canvasHeight || metadata.height || 0;
    const swbMetadata = swbMetadataForShot(project.id, shot, canvasWidth, canvasHeight, fingerprint);

    const tempPath = path.join(
      path.dirname(imagePath),
      `.storyboard-metadata-${shot.id}${path.extname(imagePath)}`
    );
    try {
      await sharp(imagePath).withXmp(swbMetadataXmp(swbMetadata)).tiff().toFile(tempPath);
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

  return applyFileReplacements(
    finalWrite.replacements.map((replacement) => ({
      tempPath: replacement.fromPath,
      targetPath: replacement.toPath,
      backupPath: path.join(
        folderPath,
        ".storyboard-workbench",
        "save-backup",
        saveStamp,
        path.basename(replacement.toPath)
      )
    })),
    { mkdir: ensureDirectory, rename, unlink }
  );
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
    app: "Storyboard Workbench",
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

  const imageMetadata = await sharp(shot.imagePath).metadata();
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
      : sharp(shot.imagePath);

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

  const imageMetadata = await sharp(shot.imagePath).metadata();
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

const sharpBlendMode = (blendMode: string | undefined): "over" | "multiply" | "screen" => {
  if (blendMode === "multiply" || blendMode === "screen") {
    return blendMode;
  }

  return "over";
};

const createBlankShot = async (
  folderPath: string,
  preset: BlankShotPreset = "16:9"
): Promise<string> => {
  await mkdir(folderPath, { recursive: true });
  const size = blankShotPresets[preset] ?? blankShotPresets["16:9"];

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const imagePath = path.join(folderPath, `new_shot_${Date.now()}_${attempt}.tiff`);
    try {
      await stat(imagePath);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        await sharp({
          create: {
            width: size.width,
            height: size.height,
            channels: 3,
            background: "#ffffff"
          }
        })
          .tiff()
          .toFile(imagePath);
        return imagePath;
      }

      throw error;
    }
  }

  throw new Error("Could not create a unique blank shot filename");
};

const scanFolder = async (folderPath: string): Promise<FolderScanPayload> => {
  const metadataPath = metadataPathForFolder(folderPath);
  const previewRoot = previewRootForFolder(folderPath);
  const imagePaths = await collectImagePaths([folderPath]);
  const project = await readProject(metadataPath);

  return {
    folderPath,
    folderName: path.basename(folderPath),
    metadataPath,
    project,
    images: await createImageRecords(imagePaths, previewRoot),
    scriptImportNeeded: await ensureStoryboardScriptMarkdown(folderPath, project)
  };
};

const collectImagePaths = async (filePaths: string[]): Promise<string[]> => {
  const collected = await Promise.all(
    filePaths.map(async (filePath) => {
      const fileStat = await stat(filePath);

      if (fileStat.isDirectory()) {
        const entries = await readdir(filePath);
        return entries
          .map((entry) => path.join(filePath, entry))
          .filter((entryPath) => supportedExtensions.has(path.extname(entryPath).toLowerCase()));
      }

      return supportedExtensions.has(path.extname(filePath).toLowerCase()) ? [filePath] : [];
    })
  );

  return [...new Set(collected.flat())].sort((a, b) => a.localeCompare(b));
};

const metadataPathForFolder = (folderPath: string): string => {
  return path.join(folderPath, ".storyboard-workbench", "storyboard.project.json");
};

const previewRootForFolder = (folderPath: string): string => {
  return path.join(folderPath, ".storyboard-workbench", "previews");
};

const readProject = async (metadataPath: string): Promise<Project | undefined> => {
  try {
    const contents = await readFile(metadataPath, "utf8");
    return JSON.parse(contents) as Project;
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
    if (code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

const createImageRecords = async (
  imagePaths: string[],
  previewRoot: string
): Promise<ImportedImage[]> => {
  return Promise.all(
    imagePaths.map(async (imagePath) => {
      const extension = path.extname(imagePath).toLowerCase();
      const previewPath =
        extension === ".tif" || extension === ".tiff"
          ? await createPreview(imagePath, previewRoot)
          : undefined;
      const metadata = await sharp(imagePath).metadata();
      const swbMetadata =
        extension === ".tif" || extension === ".tiff"
          ? await readSwbMetadata(imagePath)
          : undefined;

      return {
        imagePath,
        previewPath,
        fileName: path.basename(imagePath),
        width: metadata.width,
        height: metadata.height,
        fingerprint: await pixelFingerprint(imagePath),
        swbMetadata
      };
    })
  );
};

const createPreview = async (imagePath: string, previewRoot: string): Promise<string> => {
  const previewName = `${Buffer.from(imagePath).toString("hex")}.png`;
  const previewPath = path.join(previewRoot, previewName);

  await mkdir(previewRoot, { recursive: true });

  await sharp(imagePath)
    .rotate()
    .resize({ width: 1800, height: 1200, fit: "inside", withoutEnlargement: true })
    .png()
    .toFile(previewPath);

  return previewPath;
};

const pixelFingerprint = async (imagePath: string): Promise<string> => {
  const { data, info } = await sharp(imagePath)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const hash = createHash("sha256");
  hash.update(`${info.width}x${info.height}:${info.channels}:`);
  hash.update(data);
  return hash.digest("hex");
};

const readSwbMetadata = async (imagePath: string): Promise<SwbImageMetadata | undefined> => {
  const metadata = await sharp(imagePath).metadata();
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
      parsed.app === "Storyboard Workbench" &&
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
