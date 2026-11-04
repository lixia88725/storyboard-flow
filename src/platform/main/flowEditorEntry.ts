/** Workbench entry. No arguments opens the project launcher; a project is only
 * loaded after the user creates one from images or strictly opens an existing
 * Flow project. Synthetic drivers may pass <project-root|--choose> <isolated-userData>
 * [--workbench]; a root is opened strictly and a TIFF-only folder is refused. */
import { app, BrowserWindow, ipcMain, session, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createFlowWorkspace, type FlowWorkspaceTarget } from '../../project-files/main/flowWorkspace.js';
import { openFlowEditorRuntime } from '../../project-files/main/flowEditorRuntime.js';
import { createProjectStore } from '../../project-files/main/persistence/index.js';
import type { FlowCreatePatch, FlowEditorBootstrap, FlowPendingBridgeRequest, FlowProjectTarget } from '../contracts/flowEditor.js';
import type { CreateImageProject, CreateImageProjectIssue } from '../contracts/flowProjectCreation.js';
import type { FlowResult } from '../contracts/flowWave2.js';
import type { ProjectV1 } from '../contracts/refactorV1.js';
import { createFlowProjectLauncher, isProjectCreationCanceled } from './flowProjectLauncher.js';
import { createPendingAddCoordinator, supportsPendingAdd, type PendingAddSource, type PendingAppendOptions } from './pendingAddCoordinator.js';

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
  const win = new BrowserWindow({ width: 1280, height: 900, webPreferences: {
    preload: path.join(repo, 'src/platform/preload/flowEditor.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false
  } });
  let workspace: ReturnType<typeof createFlowWorkspace> | null = null;
  let currentRoot: string | null = null;
  let launching = false;
  let activeLaunch: Promise<unknown> | null = null;
  let closeId: string | null = null, closing = false;
  const issueRequests = new Map<string, { draftId: string; resolve: (decision: 'continue' | 'cancel') => void }>();
  const pendingIssueRequests = new Map<string, { operationId: string; resolve: (decision: 'continue' | 'cancel') => void }>();

  const send = (channel: string, payload: unknown) => {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
  };
  /** The renderer shows a label, never the Main-owned absolute source path. */
  const displayIssues = (issues: CreateImageProjectIssue[]) => {
    const labels = issues.map(issue => path.basename(issue.file));
    const duplicated = new Set(labels.filter((label, index) => labels.indexOf(label) !== index));
    return issues.map(issue => ({ ...issue,
      file: duplicated.has(path.basename(issue.file))
        ? `${path.basename(path.dirname(issue.file))}/${path.basename(issue.file)}`
        : path.basename(issue.file) }));
  };
  const settleDraftIssues = (draftId: string, decision: 'continue' | 'cancel') => {
    for (const [requestId, pending] of issueRequests) {
      if (pending.draftId !== draftId) continue;
      issueRequests.delete(requestId);
      pending.resolve(decision);
    }
  };
  const settleAllIssues = () => {
    for (const pending of issueRequests.values()) pending.resolve('cancel');
    issueRequests.clear();
    for (const pending of pendingIssueRequests.values()) pending.resolve('cancel');
    pendingIssueRequests.clear();
  };

  let createProject: Promise<CreateImageProject> | null = null;
  const loadCreateProject = () => createProject ??= (async () => {
    // The file module is owned by the project-files module. The non-literal import keeps
    // this entry buildable on its own; a missing implementation fails with a clear error
    // instead of silently doing nothing.
    const specifier = '../../project-files/main/createImageProject.js';
    const implementation = await import(specifier) as { createImageProject?: unknown };
    if (typeof implementation.createImageProject !== 'function')
      throw Error('当前构建缺少从图片创建项目的组件');
    return implementation.createImageProject as CreateImageProject;
  })();

  const prepare = async (root: string): Promise<FlowWorkspaceTarget> => {
    const canonical = await fs.realpath(root);
    return { root: canonical, runtime: await openFlowEditorRuntime(canonical, file => shell.trashItem(file)) };
  };

  const launcher = createFlowProjectLauncher({
    userData,
    prepare,
    createProject: (input, options) => loadCreateProject().then(implementation => implementation(input, options)),
    onProgress: (draftId, progress) => {
      if (!Number.isFinite(progress?.done) || !Number.isFinite(progress?.total) || progress.total < 0) return;
      send('flow-editor:create-progress', { draftId, done: Math.max(0, Math.min(progress.done, progress.total)), total: progress.total,
        ...(progress.phase === 'read' || progress.phase === 'write' ? { phase: progress.phase } : {}) });
    },
    decideIssues: (draftId, issues: CreateImageProjectIssue[]) => new Promise<'continue' | 'cancel'>(resolve => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) { resolve('cancel'); return; }
      const requestId = randomUUID();
      issueRequests.set(requestId, { draftId, resolve });
      send('flow-editor:create-issues', { requestId, draftId, issues: displayIssues(issues) });
    })
  });

  const withFolder = (bootstrap: Pick<FlowEditorBootstrap, 'project' | 'sessionId'>): FlowEditorBootstrap =>
    ({ ...bootstrap, folderName: currentRoot ? path.basename(currentRoot) : '' });

  const selectProject = async (): Promise<string | null> => {
    const selection = await dialog.showOpenDialog(win, { title: '打开 Storyboard Flow 项目', buttonLabel: '打开', properties: ['openDirectory'] });
    if (selection.canceled) return null;
    return fs.realpath(selection.filePaths[0]);
  };

  const resolveTarget = async (target: FlowProjectTarget): Promise<FlowWorkspaceTarget | null> => {
    if (!target || typeof target !== 'object') throw Error('Unsupported project target');
    if (target.kind === 'dialog') {
      const root = await selectProject();
      return root ? launcher.openRoot(root) : null;
    }
    if (target.kind === 'recent' && typeof target.id === 'string' && target.id)
      return launcher.openRecent(target.id);
    if (target.kind === 'create' && typeof target.draftId === 'string' && target.draftId)
      return launcher.createAndPrepare(target.draftId);
    throw Error('Unsupported project target');
  };

  const installInitial = async () => {
    if (requestedRoot === '--choose') return;
    const target = await launcher.openRoot(requestedRoot);
    workspace = createFlowWorkspace(target);
    currentRoot = target.root;
  };

  const entry = path.join(repo, 'dist/index.html');
  const viewHash = 'flow-workbench';
  const dev = !app.isPackaged && process.env.VITE_DEV_SERVER_URL ? new URL(process.env.VITE_DEV_SERVER_URL) : null;
  if (dev && (dev.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(dev.hostname))) throw Error('Development server must be local HTTP');
  if (dev) dev.hash = viewHash;
  const documentUrl = dev ? dev.href : pathToFileURL(entry).href + '#' + viewHash;
  const caller = (event: Electron.IpcMainInvokeEvent) => {
    if (!documentUrl || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== documentUrl)
      throw new Error('Current editor document required');
  };
  const requireWorkspace = () => {
    if (!workspace) throw Error('尚未打开项目');
    return workspace;
  };

  type PendingRuntime = {
    appendPending?: (token: string, project: ProjectV1, input: { source?: PendingAddSource; recover?: boolean; operationId: string },
      options: PendingAppendOptions) => Promise<FlowResult<{ project: ProjectV1 }>>;
  };
  const appendPending = async (owner: { sessionId: string; windowId: number; projectId: string; mode: 'files' | 'folder' },
    project: ProjectV1, input: { source?: PendingAddSource; recover?: boolean; operationId: string }, options: PendingAppendOptions): Promise<FlowResult<ProjectV1>> => {
    const active = workspace as (ReturnType<typeof createFlowWorkspace> & PendingRuntime) | null;
    if (!active || typeof active.appendPending !== 'function')
      return { ok: false, error: { code: 'unavailable', message: 'Pending import is not connected', effect: 'none' } };
    const result = await active.appendPending(owner.sessionId, project, input, options);
    return result.ok ? { ok: true, value: result.value.project } : result;
  };
  const currentSessionId = () => {
    try { return workspace?.open().sessionId ?? null; } catch { return null; }
  };
  const pickPendingSource = async (mode: 'files' | 'folder'): Promise<PendingAddSource | null> => {
    if (mode === 'files') {
      const selection = await dialog.showOpenDialog(win, { title: '添加到 Pending：选择图片', buttonLabel: '选择',
        properties: ['openFile', 'multiSelections'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff'] }] });
      if (selection.canceled) return null;
      const files = await Promise.all(selection.filePaths.map(file => fs.realpath(file)));
      return { kind: 'files', files };
    }
    const selection = await dialog.showOpenDialog(win, { title: '添加到 Pending：选择文件夹', buttonLabel: '选择', properties: ['openDirectory'] });
    if (selection.canceled) return null;
    return { kind: 'folder', folder: await fs.realpath(selection.filePaths[0]) };
  };
  const askPendingIssues = (operationId: string, issues: CreateImageProjectIssue[], signal: AbortSignal) =>
    new Promise<'continue' | 'cancel'>(resolve => {
      if (win.isDestroyed() || win.webContents.isDestroyed() || signal.aborted) { resolve('cancel'); return; }
      const requestId = randomUUID();
      const finish = (decision: 'continue' | 'cancel') => {
        if (!pendingIssueRequests.delete(requestId)) return;
        signal.removeEventListener('abort', abort);
        resolve(decision);
      };
      const abort = () => finish('cancel');
      pendingIssueRequests.set(requestId, { operationId, resolve: finish });
      signal.addEventListener('abort', abort, { once: true });
      send('flow-editor:pending-issues', { requestId, operationId, issues: displayIssues(issues) });
    });
  const pendingAvailable = () => supportsPendingAdd(process.platform, workspace?.appendPending);
  const pending = createPendingAddCoordinator({
    available: pendingAvailable,
    currentSessionId,
    pick: pickPendingSource,
    append: appendPending,
    onProgress: (operationId, progress) => {
      if (!Number.isFinite(progress?.done) || !Number.isFinite(progress?.total) || progress.total < 0) return;
      send('flow-editor:pending-progress', { operationId, done: Math.max(0, Math.min(progress.done, progress.total)), total: progress.total,
        ...(progress.phase === 'read' || progress.phase === 'write' ? { phase: progress.phase } : {}) });
    },
    askIssues: askPendingIssues
  });

  ipcMain.handle('flow-editor:launcher-state', async event => {
    caller(event);
    const state = await launcher.state();
    return { ...state, open: Boolean(workspace), currentId: currentRoot ? await launcher.idFor(currentRoot) : null };
  });
  ipcMain.handle('flow-editor:remove-recent', async (event, id: string) => {
    caller(event);
    if (typeof id !== 'string' || !id) throw Error('Invalid recent project id');
    await launcher.forget(id);
  });
  ipcMain.handle('flow-editor:relocate-recent', async (event, id: string) => {
    caller(event);
    if (typeof id !== 'string' || !id) return { ok: false as const, message: '最近项目记录无效' };
    const entry = await launcher.recentProject(id);
    if (!entry) return { ok: false as const, message: '这条最近项目记录已不存在' };
    const selection = await dialog.showOpenDialog(win, { title: '重新定位最近项目', buttonLabel: '选择', properties: ['openDirectory'] });
    if (selection.canceled) return { canceled: true as const };
    try {
      const root = await fs.realpath(selection.filePaths[0]);
      const loaded = await createProjectStore().loadCheckpoint(root);
      if (!loaded.ok) return { ok: false as const, message: '所选文件夹不是可用的 Flow 项目' };
      if (loaded.value.project.id !== entry.projectId)
        return { ok: false as const, message: '这个文件夹里的项目与最近记录不一致' };
      await launcher.relocate(id, root, entry.projectId, loaded.value.project.name);
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, message: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('flow-editor:update-recent-name', async (event, token: string, name: string) => {
    caller(event);
    const active = requireWorkspace();
    if (typeof token !== 'string' || token !== active.open().sessionId) throw Error('Stale editor session');
    if (typeof name !== 'string' || !name.trim() || name.length > 200 || name.includes('\0')) throw Error('Invalid project name');
    if (currentRoot) await launcher.updateName(currentRoot, name);
  });
  ipcMain.handle('flow-editor:launch', async (event, target: FlowProjectTarget) => {
    caller(event);
    if (workspace) throw Error('项目已经打开');
    if (launching) throw Error('项目正在打开');
    launching = true;
    const work = (async () => {
      let candidate: FlowWorkspaceTarget | null;
      try { candidate = await resolveTarget(target); }
      catch (error) { if (isProjectCreationCanceled(error)) return { canceled: true as const }; throw error; }
      if (!candidate) return { canceled: true as const };
      workspace = createFlowWorkspace(candidate);
      currentRoot = candidate.root;
      return { canceled: false as const, bootstrap: withFolder(workspace.open()) };
    })();
    activeLaunch = work;
    try { return await work; }
    finally { launching = false; if (activeLaunch === work) activeLaunch = null; }
  });
  ipcMain.handle('flow-editor:open', event => { caller(event); return withFolder(requireWorkspace().open()); });
  for (const name of ['read', 'put', 'checkpoint', 'saveTiff', 'refresh', 'folderStatus', 'outputNames'] as const) {
    ipcMain.handle(`flow-editor:${name}`, (event, token, input) => { caller(event); return (requireWorkspace()[name] as (token: string, value: unknown) => unknown)(token, input); });
  }
  ipcMain.handle('flow-editor:switch-project', async (event, token, project, target: FlowProjectTarget) => {
    caller(event);
    if (closing) throw Error('Window is closing');
    if (!workspace) throw Error('尚未打开项目');
    let candidateRoot: string | null = null;
    let bootstrap: Pick<FlowEditorBootstrap, 'project' | 'sessionId'> | null;
    const previousRoot = currentRoot;
    try {
      bootstrap = await workspace.switchProject(token, project, async () => {
        const candidate = await resolveTarget(target);
        if (!candidate || candidate.root === currentRoot) return null;
        candidateRoot = candidate.root;
        return candidate;
      });
    } catch (error) {
      if (previousRoot && project) await launcher.updateName(previousRoot, project.name).catch(() => {});
      if (isProjectCreationCanceled(error)) return null;
      throw error;
    }
    if (previousRoot && project) await launcher.updateName(previousRoot, project.name).catch(() => {});
    if (!bootstrap) return null;
    pending.cancelAll(); // Previous owner is retired only after successful switch.
    currentRoot = candidateRoot;
    return withFolder(bootstrap);
  });
  ipcMain.handle('flow-editor:finish-close', async (event, token, id, project) => {
    caller(event);
    if (!closeId || id !== closeId || closing) return { ok: false, message: 'Stale close request' };
    closing = true;
    let accepted = false;
    try {
      const active = requireWorkspace();
      accepted = await active.certifyClose(token, project);
    } catch { /* Refuse stale/transitioning close, permit retry. */ }
    if (!accepted) { closing = false; closeId = null; return { ok: false, message: 'Checkpoint verification failed; window retained' }; }
    if (currentRoot && project) await launcher.updateName(currentRoot, project.name).catch(() => {});
    setImmediate(() => win.destroy());
    return { ok: true };
  });
  ipcMain.handle('flow-editor:create-draft', event => { caller(event); return launcher.begin(); });
  ipcMain.handle('flow-editor:create-choose-source', async (event, draftId: string, kind: 'files' | 'folder') => {
    caller(event);
    launcher.view(draftId);
    if (kind === 'files') {
      const selection = await dialog.showOpenDialog(win, { title: '选择故事板图片', buttonLabel: '选择', properties: ['openFile', 'multiSelections'],
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'tif', 'tiff'] }] });
      if (selection.canceled) return { canceled: true as const };
      const files = await Promise.all(selection.filePaths.map(file => fs.realpath(file)));
      return launcher.setSource(draftId, { kind: 'files', files });
    }
    if (kind === 'folder') {
      const selection = await dialog.showOpenDialog(win, { title: '选择图片来源文件夹', buttonLabel: '选择', properties: ['openDirectory'] });
      if (selection.canceled) return { canceled: true as const };
      return launcher.setSource(draftId, { kind: 'folder', folder: await fs.realpath(selection.filePaths[0]) });
    }
    throw Error('不支持的图片来源');
  });
  ipcMain.handle('flow-editor:create-choose-destination', async (event, draftId: string) => {
    caller(event);
    launcher.view(draftId);
    const selection = await dialog.showOpenDialog(win, { title: '选择项目保存位置', buttonLabel: '选择', properties: ['openDirectory', 'createDirectory'] });
    if (selection.canceled) return { canceled: true as const };
    return launcher.setDestination(draftId, await fs.realpath(selection.filePaths[0]));
  });
  ipcMain.handle('flow-editor:create-update', (event, draftId: string, patch: FlowCreatePatch) => { caller(event); return launcher.update(draftId, patch); });
  ipcMain.handle('flow-editor:create-abort', (event, draftId: string) => {
    caller(event);
    launcher.abort(draftId);
    settleDraftIssues(draftId, 'cancel');
  });
  ipcMain.handle('flow-editor:create-discard', async (event, draftId: string) => { caller(event); await launcher.discard(draftId); });
  ipcMain.handle('flow-editor:create-issues-response', (event, requestId: string, decision: 'continue' | 'cancel') => {
    caller(event);
    if (typeof requestId !== 'string' || (decision !== 'continue' && decision !== 'cancel')) throw Error('Invalid issue decision');
    const request = issueRequests.get(requestId);
    if (!request) return false;
    issueRequests.delete(requestId);
    request.resolve(decision);
    return true;
  });
  ipcMain.handle('flow-editor:pending-capability', event => {
    caller(event);
    return pendingAvailable();
  });
  ipcMain.handle('flow-editor:pending-add', (event, token: string, project: ProjectV1, request: FlowPendingBridgeRequest) => {
    caller(event);
    return pending.add(event.sender.id, token, project, request);
  });
  ipcMain.handle('flow-editor:pending-cancel', (event, token: string, operationId: string) => {
    caller(event);
    pending.cancel(event.sender.id, token, operationId);
  });
  ipcMain.handle('flow-editor:pending-issues-response', (event, requestId: string, decision: 'continue' | 'cancel') => {
    caller(event);
    if (typeof requestId !== 'string' || (decision !== 'continue' && decision !== 'cancel')) throw Error('Invalid Pending issue decision');
    const request = pendingIssueRequests.get(requestId);
    if (!request) return false;
    request.resolve(decision);
    return true;
  });

  win.once('closed', () => pending.cancelAll());
  win.on('close', event => {
    // A veto before certification leaves this window as the writable owner.
    // Abort the picker, but keep the operation identity available for recovery.
    pending.abortInFlight();
    if (!workspace) {
      if (activeLaunch || [...issueRequests.keys()].length) {
        event.preventDefault();
        launcher.abortAll();
        settleAllIssues();
        void (activeLaunch ?? Promise.resolve()).catch(() => {}).finally(() => { if (!win.isDestroyed()) win.destroy(); });
      }
      return; // No project: nothing to checkpoint.
    }
    event.preventDefault();
    if (!closeId) { closeId = randomUUID(); win.webContents.send('flow-editor:close', closeId); }
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  // Reload is not a substitute for a certified Close; the renderer guards beforeunload.
  win.webContents.on('will-prevent-unload', () => {});
  session.defaultSession.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*','https://*/*','ws://*/*','wss://*/*'] }, (details, cb) => { const url = new URL(details.url); const localDev = dev && url.host === dev.host && (url.protocol === 'http:' || url.protocol === 'ws:'); cb({ cancel: !localDev }); });
  await installInitial();
  if (dev) await win.loadURL(documentUrl); else await win.loadFile(entry, { hash: viewHash });
}).catch(error => { console.error(error); if (requestedRoot === '--choose') dialog.showErrorBox('Could not open Storyboard Flow', String(error)); app.exit(1); });
app.on('window-all-closed', () => app.quit());
