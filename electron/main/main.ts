import { app, BrowserWindow, ipcMain, Menu, net, protocol } from "electron";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

type Project = {
  id: string;
  name: string;
  shots: Array<{
    id: string;
    imagePath: string;
    previewPath?: string;
    fileName: string;
    order: number;
    sketchData: Array<{
      id: string;
      tool: "brush" | "eraser";
      color: string;
      size: number;
      opacity?: number;
      points: number[];
    }>;
  }>;
  dialogues: Array<{
    id: string;
    shotId: string;
    text: string;
    order: number;
  }>;
  createdAt: string;
  updatedAt: string;
};

type ProjectPayload = {
  project: Project;
  folderPath: string;
  metadataPath: string;
  renamePlan?: RenamePlanItem[];
};

type ImportedImage = {
  imagePath: string;
  previewPath?: string;
  fileName: string;
};

type FolderScanPayload = {
  folderPath: string;
  folderName: string;
  metadataPath: string;
  project?: Project;
  images: ImportedImage[];
};

type RenamePlanItem = {
  shotId: string;
  fromPath: string;
  temporaryPath: string;
  finalPath: string;
  finalFileName: string;
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
    await writeProjectMetadata(payload.metadataPath, payload.project);
    return payload;
  });

  ipcMain.handle("workspace:save", async (_event, payload: ProjectPayload) => {
    if (payload.renamePlan && payload.renamePlan.length > 0) {
      await assertRenamePlanSafe(payload.renamePlan);
      await applyFileRenamePlan(payload.renamePlan);
    }

    await writeProjectMetadata(payload.metadataPath, payload.project);

    return payload;
  });

  ipcMain.handle("images:createBlankShot", async (_event, folderPath: string) => {
    const imagePath = await createBlankShot(folderPath);
    const previewRoot = previewRootForFolder(folderPath);
    const [image] = await createImageRecords([imagePath], previewRoot);
    return image;
  });

  ipcMain.handle("recent:getFolders", async () => {
    return readRecentFolders();
  });
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

const writeProjectMetadata = async (metadataPath: string, project: Project): Promise<void> => {
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFile(metadataPath, `${JSON.stringify(project, null, 2)}\n`, "utf8");
};

const recentFoldersPath = (): string => {
  return path.join(app.getPath("userData"), "recent-folders.json");
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

const applyFileRenamePlan = async (renamePlan: RenamePlanItem[]): Promise<void> => {
  const renames = renamePlan.filter((item) => item.fromPath !== item.finalPath);

  for (const item of renames) {
    await mkdir(path.dirname(item.temporaryPath), { recursive: true });
    await rename(item.fromPath, item.temporaryPath);
  }

  for (const item of renames) {
    await mkdir(path.dirname(item.finalPath), { recursive: true });
    await rename(item.temporaryPath, item.finalPath);
  }
};

const createBlankShot = async (folderPath: string): Promise<string> => {
  await mkdir(folderPath, { recursive: true });

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const imagePath = path.join(folderPath, `new_shot_${Date.now()}_${attempt}.tiff`);
    try {
      await stat(imagePath);
    } catch (error) {
      const code = typeof error === "object" && error && "code" in error ? error.code : undefined;
      if (code === "ENOENT") {
        await sharp({
          create: {
            width: 1920,
            height: 1080,
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

  return {
    folderPath,
    folderName: path.basename(folderPath),
    metadataPath,
    project: await readProject(metadataPath),
    images: await createImageRecords(imagePaths, previewRoot)
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

      return {
        imagePath,
        previewPath,
        fileName: path.basename(imagePath)
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
