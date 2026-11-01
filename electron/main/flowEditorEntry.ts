/** Dedicated G2 entry: electron dist-electron/main/flowEditorEntry.js <project-root> <isolated-userData>.
 * Opens a new-format checkpoint or bootstraps a TIFF folder without changing originals.
 * Pass --choose instead of a root to select a folder through the native dialog. */
import { app, BrowserWindow, ipcMain, session, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { createPhotoshopCopy } from './flowPhotoshopCopy.js';
import { importFlowTiffFolder } from './flowTiffImport.js';
import { createTiffCodec } from '../core/formats/index.js';
import { randomUUID } from 'node:crypto';
import { createFlowWorkspace } from './flowWorkspace.js';
import { openFlowEditorRuntime } from './flowEditorRuntime.js';
const [requestedRoot, userData, viewMode] = process.argv.slice(2);
if (!requestedRoot || !userData || (requestedRoot !== '--choose' && !path.isAbsolute(requestedRoot)) || !path.isAbsolute(userData)) throw new Error('Absolute project and isolated userData paths required');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
app.setPath('userData', userData);
app.setPath('sessionData', userData);
app.setAppLogsPath(path.join(userData, 'logs'));
app.commandLine.appendSwitch('disable-background-networking');
app.whenReady().then(async () => {
  const selected = requestedRoot === '--choose' ? await dialog.showOpenDialog({ title: 'Open Storyboard Flow project or TIFF folder', properties: ['openDirectory'] }) : null;
  if (selected?.canceled) { app.quit(); return; }
  const root = await fs.realpath(selected ? selected.filePaths[0] : requestedRoot);
  const win = new BrowserWindow({ width: 1280, height: 900, webPreferences: {
    preload: path.join(repo, 'electron/preload/flowEditor.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false
  } });
  let importing = true;
  win.on('close', event => { if (importing) event.preventDefault(); });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><title>Storyboard Flow</title><body style="background:#222;color:#eee;font:18px system-ui;padding:40px">Opening Storyboard Flow project…</body>'));
  const prepare = async (selectedRoot: string) => {
    const root = await fs.realpath(selectedRoot);
    let metadataExists = true;
    try { await fs.lstat(path.join(root, '.storyboard-flow')); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') metadataExists = false; else throw error; }
    if (!metadataExists) await importFlowTiffFolder(root, createTiffCodec({
      scriptPath: path.join(repo, 'electron/core/formats/codec.py'),
      depsDir: process.env.FLOW_PYTHON_DEPS_DIR ?? path.join(repo, 'vendor/python/photoshop-tiff')
    }));
    return { root, runtime: await openFlowEditorRuntime(root, file => shell.trashItem(file)) };
  };
  const workspace = createFlowWorkspace(await prepare(root));
  const entry = path.join(repo, 'dist/index.html');
  const viewHash=viewMode==='--workbench'?'flow-workbench':'flow-editor';
  const documentUrl = pathToFileURL(entry).href + '#'+viewHash;
  let closeId: string | null = null, closing = false;
  const caller = (event: Electron.IpcMainInvokeEvent) => {
    if (!documentUrl || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== documentUrl)
      throw new Error('Current editor document required');
  };
  ipcMain.handle('flow-editor:open', event => { caller(event); return workspace.open(); });
  for (const name of ['read', 'put', 'checkpoint', 'saveTiff', 'refresh', 'folderStatus'] as const) {
    ipcMain.handle(`flow-editor:${name}`, (event, token, input) => { caller(event); return (workspace[name] as (token: string, value: unknown) => unknown)(token, input); });
  }
  ipcMain.handle('flow-editor:switch-project', async (event, token, project, mode) => {
    caller(event);
    if (closing) throw Error('Window is closing');
    return workspace.switchProject(token, project, async currentRoot => {
      if (mode === 'photoshop-copy') {
        const selected = await dialog.showOpenDialog(win, { title:'以合成底图创建工作副本（保存在原件旁的 -Flow 文件夹）',
          filters:[{name:'Photoshop TIFF',extensions:['tif','tiff']}], properties:['openFile'] });
        if (selected.canceled) return null;
        return prepare(await createPhotoshopCopy(selected.filePaths[0]));
      }
      const selection = await dialog.showOpenDialog(win, { title: 'Open Storyboard Flow project or TIFF folder', properties: ['openDirectory'] });
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
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*','ws://*/*','wss://*/*'] }, (_d, cb) => cb({ cancel: true }));
  importing = false;
  await win.loadFile(entry, { hash: viewHash });
}).catch(error => { console.error(error); if (requestedRoot === '--choose') dialog.showErrorBox('Could not open Storyboard Flow project', String(error)); app.exit(1); });
app.on('window-all-closed', () => app.quit());
