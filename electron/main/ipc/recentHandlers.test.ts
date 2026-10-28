import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { registerRecentIpcHandlers } from './recentHandlers';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
it('remembers an existing directory only for the current window, without touching workspace files', async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'recent-activation-'))); roots.push(root);
  const file = path.join(root, 'image.png'); await writeFile(file, 'retained');
  const handlers = new Map<string, Function>(), rememberFolder = vi.fn(async () => {}), frame = {};
  registerRecentIpcHandlers({ handle: (name: string, handler: Function) => { handlers.set(name, handler); } } as any, { getFolders: () => [], rememberFolder });
  const remember = handlers.get('recent:rememberOpenedFolder')!, event = { sender: { mainFrame: frame }, senderFrame: frame };
  await expect(remember({ ...event, senderFrame: {} }, root)).rejects.toThrow('current window');
  await expect(remember(event, 'relative')).rejects.toThrow('Invalid');
  await expect(remember(event, file)).rejects.toThrow('directory');
  expect(rememberFolder).not.toHaveBeenCalled();
  await remember(event, root); expect(rememberFolder).toHaveBeenCalledExactlyOnceWith(root);
});
