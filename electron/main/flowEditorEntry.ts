/** Dedicated G2 entry: electron dist-electron/main/flowEditorEntry.js <project-root> <isolated-userData>.
 * Opens existing new-format checkpoints only; never converts or chooses a personal project. */
import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openFlowEditorRuntime } from './flowEditorRuntime.js';
const [root, userData] = process.argv.slice(2);
if (!root || !userData || !path.isAbsolute(root) || !path.isAbsolute(userData)) throw new Error('Absolute project and isolated userData paths required');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
app.setPath('userData', userData);
app.setPath('sessionData', userData);
app.setAppLogsPath(path.join(userData, 'logs'));
app.commandLine.appendSwitch('disable-background-networking');
app.whenReady().then(async () => {
  const runtime = await openFlowEditorRuntime(root);
  const win = new BrowserWindow({ width: 1280, height: 900, webPreferences: {
    preload: path.join(repo, 'electron/preload/flowEditor.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false
  } });
  const entry = path.join(repo, 'dist/index.html');
  const documentUrl = pathToFileURL(entry).href + '#flow-editor';
  let closeId: string | null = null, closing = false;
  const caller = (event: Electron.IpcMainInvokeEvent) => {
    if (!documentUrl || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== documentUrl)
      throw new Error('Current editor document required');
  };
  for (const name of ['open', 'read', 'put', 'checkpoint'] as const) {
    ipcMain.handle(`flow-editor:${name}`, (event, input) => { caller(event); return (runtime[name] as (value: unknown) => unknown)(input); });
  }
  ipcMain.handle('flow-editor:finish-close', async (event, id, project) => {
    caller(event);
    if (!closeId || id !== closeId || closing) return { ok: false, message: 'Stale close request' };
    closing = true;
    const accepted = await runtime.certifyClose(project);
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
  await win.loadFile(entry, { hash: 'flow-editor' });
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());
