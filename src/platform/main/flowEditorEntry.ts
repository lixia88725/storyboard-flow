/** Workbench entry. No arguments opens the native project picker.
 * Synthetic drivers may pass <project-root|--choose> <isolated-userData> [--workbench].
 * Opens a new-format checkpoint or bootstraps a TIFF folder without changing originals.
 * Pass --choose instead of a root to select a folder through the native dialog. */
import { app, BrowserWindow, ipcMain, session, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { importFlowTiffFolder } from '../../project-files/main/flowTiffImport.js';
import { createTiffCodec } from '../../project-files/main/formats/index.js';
import { randomUUID } from 'node:crypto';
import { createFlowWorkspace } from '../../project-files/main/flowWorkspace.js';
import { flowCodecOptions } from './flowRuntimePaths.js';
import { openFlowEditorRuntime } from '../../project-files/main/flowEditorRuntime.js';
const explicit = process.argv.slice(app.isPackaged ? 1 : 2).filter(arg => !arg.startsWith('--inspect'));
const [requestedRoot = '--choose', suppliedUserData, compatibilityView] = explicit;
const userData = suppliedUserData || process.env.FLOW_USER_DATA_DIR || path.join(app.getPath('appData'), 'Storyboard Flow Workbench');
if (compatibilityView && compatibilityView !== '--workbench') throw Error('Unknown editor launch option');
if (explicit.length > 3) throw Error('Unexpected editor launch arguments');
if (!requestedRoot || !userData || (requestedRoot !== '--choose' && !path.isAbsolute(requestedRoot)) || !path.isAbsolute(userData)) throw new Error('Absolute project and isolated userData paths required');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
app.setPath('userData', userData);
app.setPath('sessionData', userData);
app.setAppLogsPath(path.join(userData, 'logs'));
app.commandLine.appendSwitch('disable-background-networking');
// Explicit fixture launches own isolated profiles; studio-preview already owns its lock.
const ownsInstance = suppliedUserData ? true : app.requestSingleInstanceLock();
app.on('second-instance', () => { const win = BrowserWindow.getAllWindows()[0]; if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
if (!ownsInstance) app.quit();
else app.whenReady().then(async () => {
  const selected = requestedRoot === '--choose' ? await dialog.showOpenDialog({ title: '打开 Storyboard Flow 项目或 TIFF 文件夹', properties: ['openDirectory'] }) : null;
  if (selected?.canceled) { app.quit(); return; }
  const root = await fs.realpath(selected ? selected.filePaths[0] : requestedRoot);
  const win = new BrowserWindow({ width: 1280, height: 900, webPreferences: {
    preload: path.join(repo, 'src/platform/preload/flowEditor.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false
  } });
  let importing = true;
  win.on('close', event => { if (importing) event.preventDefault(); });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><title>Storyboard Flow</title><body style="background:#222;color:#eee;font:18px system-ui;padding:40px">Opening Storyboard Flow project…</body>'));
  const prepare = async (selectedRoot: string) => {
    const root = await fs.realpath(selectedRoot);
    let metadataExists = true;
    try { await fs.lstat(path.join(root, '.storyboard-flow')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') metadataExists = false; else throw error; }
    if (!metadataExists) await importFlowTiffFolder(root, createTiffCodec(flowCodecOptions()));
    return { root, runtime: await openFlowEditorRuntime(root, file => shell.trashItem(file)) };
  };
  const workspace = createFlowWorkspace(await prepare(root));
  const entry = path.join(repo, 'dist/index.html');
  const viewHash = 'flow-workbench';
  const dev = !app.isPackaged && process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL) : null;
  if (dev && (dev.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(dev.hostname))) throw Error('Development server must be local HTTP');
  if (dev) dev.hash = viewHash;
  const documentUrl = dev ? dev.href : pathToFileURL(entry).href + '#' + viewHash;
  let closeId: string | null = null, closing = false;
  const caller = (event: Electron.IpcMainInvokeEvent) => {
    if (!documentUrl || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== documentUrl)
      throw new Error('Current editor document required');
  };
  ipcMain.handle('flow-editor:open', event => { caller(event); return workspace.open(); });
  for (const name of ['read', 'put', 'checkpoint', 'saveTiff', 'refresh', 'folderStatus', 'outputNames'] as const) {
    ipcMain.handle(`flow-editor:${name}`, (event, token, input) => { caller(event); return (workspace[name] as (token: string, value: unknown) => unknown)(token, input); });
  }
  ipcMain.handle('flow-editor:switch-project', async (event, token, project) => {
    caller(event);
    if (closing) throw Error('Window is closing');
    return workspace.switchProject(token, project, async currentRoot => {
      const selection = await dialog.showOpenDialog(win, { title: '打开 Storyboard Flow 项目或 TIFF 文件夹', properties: ['openDirectory'] });
      if (selection.canceled) return null;
      const selectedRoot = await fs.realpath(selection.filePaths[0]);
      return selectedRoot === currentRoot ? null : prepare(selectedRoot);
    });
  });
  ipcMain.handle('flow-editor:finish-close', async (event, token, id, project) => {
    caller(event);
    if (!closeId || id !== closeId || closing) return { ok: false, message: 'Stale close request' };
    closing = true;
    let accepted = false;
    try { accepted = await workspace.certifyClose(token, project); } catch { /* Refuse stale/transitioning close, permit retry. */ }
    if (!accepted) { closing = false; closeId = null; return { ok: false, message: 'Checkpoint verification failed; window retained' }; }
    setImmediate(() => win.destroy());
    return { ok: true };
  });
  win.on('close', event => { event.preventDefault(); if (!closeId) { closeId = randomUUID(); win.webContents.send('flow-editor:close', closeId); } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  // Reload is not a substitute for a certified Close; the renderer guards beforeunload.
  win.webContents.on('will-prevent-unload', () => {});
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*','ws://*/*','wss://*/*'] }, (details, cb) => { const url = new URL(details.url); const localDev = dev && url.host === dev.host && (url.protocol === 'http:' || url.protocol === 'ws:'); cb({ cancel: !localDev }); });
  importing = false;
  if (dev) await win.loadURL(documentUrl); else await win.loadFile(entry, { hash: viewHash });
}).catch(error => { console.error(error); if (requestedRoot === '--choose') dialog.showErrorBox('Could not open Storyboard Flow project', String(error)); app.exit(1); });
app.on('window-all-closed', () => app.quit());
