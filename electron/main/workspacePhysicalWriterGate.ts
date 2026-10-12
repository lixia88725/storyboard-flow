import type { IpcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { withLayerFileOperation } from './layerFileOperationQueue.js';

// Ordinary IPC routes NEVER receive recovery execution authority. This guard
// deliberately does not interpret completed or payload.normalSave as permission.
const readonly = new Set(['layers:readPng', 'workspace:readOutputIdentity', 'workspace:inspectStoryboardScript', 'workspace:watchFolder', 'workspace:stopFolderWatch']);
// Installed only by Main's authenticated recovery service. Never derived from
// renderer payload flags. Unknown/partial inventory remains fail-closed.
let retiredRoot: ((root: string) => Promise<boolean>) | undefined;
export const installWorkspaceRetirementPredicate = (predicate: (root: string) => Promise<boolean>) => { retiredRoot = predicate; };
const writesWorkspace = (channel: string) => /^(workspace:|layers:|images:)/.test(channel) && !readonly.has(channel);
const pathsFrom = (value: unknown): string[] => {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Physical writer target missing');
  const result: string[] = [];
  // These are destination/source paths of actual IPC contracts, not Project.id,
  // renderer ids or flags. Paths inside Project are resolved by existing services.
  for (const [key, item] of Object.entries(value)) {
    if (/(?:Path|Folder)$/.test(key) && typeof item === 'string') {
      const folder = (value as { folderPath?: unknown }).folderPath;
      if (!path.isAbsolute(item) && (key === 'bitmapPath' || key === 'sourceBitmapPath' || key === 'targetBitmapPath') && typeof folder === 'string' && path.isAbsolute(folder)) result.push(path.resolve(folder, item));
      else result.push(item);
    }
    if (key === 'normalSaveSource' && item) result.push(...pathsFrom(item));
  }
  if (!result.length) throw new Error('Physical writer target missing');
  return result;
};
export const assertPhysicalWorkspaceWriterTargets = async (targets: readonly string[]): Promise<void> => {
  if (!targets.length) throw new Error('Physical writer target missing');
  for (const requested of targets) {
    if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0')) throw new Error('Invalid physical writer target');
    let existing = path.normalize(requested);
    // A fresh destination is bound through its real nearest existing parent.
    for (;;) {
      try { await fs.lstat(existing); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent=path.dirname(existing); if(parent===existing)throw error; existing=parent; }
    }
    let physical = await fs.realpath(existing);
    if (!(await fs.stat(physical)).isDirectory()) physical=path.dirname(physical);
    for (;;) {
      // lstat, not exists/stat: broken aliases, unknown files and empty partial
      // namespaces are all protection, never absence. No namespace bytes written.
      const marker=path.join(physical,'.storyboard-workbench','workspace-recovery-v1');
      try { await fs.lstat(marker); if (existing === marker || existing.startsWith(marker + path.sep) || !retiredRoot || !await retiredRoot(physical)) throw new Error('Physical workspace protected by recovery inventory; ordinary writer refused'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const parent=path.dirname(physical);if(parent===physical)break;physical=parent;
    }
  }
};
export const createWorkspacePhysicalWriterGate = <T extends Pick<IpcMain, 'handle'>>(ipc: T, authority?: {
  save: (event: any, payload: any, execute: () => Promise<any>) => Promise<any>;
  ordinary?: (event: any, channel: string, payload: any, targets: readonly string[], execute: () => Promise<any>) => Promise<any>;
  persist: (event: any, payload: any, execute: () => Promise<any>) => Promise<any>;
}): T => {
  const handle: IpcMain['handle'] = (channel, handler) => ipc.handle(channel, async (event, ...args) => {
    if (!writesWorkspace(channel)) return handler(event,...args);
    if (!event.sender || event.senderFrame !== event.sender.mainFrame) throw new Error('Physical writer requires current top frame');
    // Hold actual shared queue across admission AND the complete original handler,
    // preserving nested queue ALS behavior and original F2–F5 cleanup lifetimes.
    return withLayerFileOperation(async () => {
      if (channel === 'workspace:save' && authority) return authority.save(event,args[0],async()=>handler(event,...args));
      if (channel === 'workspace:autosave' && authority && args[0]?.recoverySaveNonce !== undefined) return authority.persist(event,args[0],async()=>handler(event,...args));
      const targets=pathsFrom(args[0]);
      if(authority?.ordinary)return authority.ordinary(event,channel,args[0],targets,async()=>handler(event,...args));
      await assertPhysicalWorkspaceWriterTargets(targets);
      return handler(event,...args);
    });
  });
  return new Proxy(ipc, { get: (target, key) => {
    if (key === 'handle') return handle;
    const value = Reflect.get(target, key);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
};
