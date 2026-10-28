import { expect, it, vi } from 'vitest';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import ts from 'typescript';
import { assertEditableWorkspaceFormat, legacyWorkspaceMessage } from '../shared/workspaceFormat';
import { readProjectMetadata } from './projectMetadataService';
import { createProject } from '../../src/shared/projectOps';
import { createWorkspaceSlots } from '../../src/renderer/workspaceSlots';
import { createBitmapLayerWriteQueue } from '../../src/renderer/bitmapLayerWriteQueue';

it('allows empty/current projects and pristine external images without legacy migration', () => {
  for (const p of [undefined, createProject('empty'), { shots: [{ id: 's', imagePath: '/s.png', swb: { status: 'non-swb' } }] },
    { shots: [{ id: 's', imagePath: '/s.tiff' }], pendingBake: { version: 1, shots: {} } }]) {
    expect(() => assertEditableWorkspaceFormat(p)).not.toThrow();
  }
  expect(() => assertEditableWorkspaceFormat({ shots: [], pendingBake: { version: 99 } })).not.toThrow();
});

it('rejects legacy editable content, including parked shots, without changing metadata', () => {
  for (const key of ['shots', 'parkedShots'] as const) {
    const p = { shots: [], [key]: [{ id: 'old', imagePath: '/old.tiff', swb: { status: 'owned' } }] };
    const before = JSON.stringify(p);
    expect(() => assertEditableWorkspaceFormat(p)).toThrow(legacyWorkspaceMessage);
    expect(JSON.stringify(p)).toBe(before);
  }
});

it('actual Main editing preflight rejects before observation and slot freezing; recovery reads remain available', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'workspace-format-'));
  try {
    const metadataPathForFolder = (folder: string) => path.join(folder, '.storyboard-workbench/storyboard.project.json');
    await mkdir(path.dirname(metadataPathForFolder(root)));
    const original = JSON.stringify({ ...createProject('old'), shots: [{ id: 'old', imagePath: path.join(root, 'old.tiff'), swb: { status: 'owned' } }] });
    await writeFile(metadataPathForFolder(root), original);
    const source = await readFile(new URL('./main.ts', import.meta.url), 'utf8');
    const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
    let callback = '';
    const visit = (n: ts.Node) => {
      if (ts.isCallExpression(n) && n.expression.getText(ast) === 'ipcMain.handle' && n.arguments[0]?.getText(ast) === '"recovery:observeWorkspace"') callback = n.arguments[1].getText(ast);
      ts.forEachChild(n, visit);
    }; visit(ast);
    expect(callback).not.toBe('');
    const preparedSave = { observeWorkspace: vi.fn(async (_event, folderPath: string) => ({ binding: folderPath, folderPath, metadataPath: metadataPathForFolder(folderPath) })) };
    const bindings = { preparedSave, path, readProjectMetadata, metadataPathForFolder, assertEditableWorkspaceFormat };
    const handler = new Function(...Object.keys(bindings), ts.transpile('return (' + callback + ');', { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
    const queue = createBitmapLayerWriteQueue(), retain = vi.fn(async () => true), load = vi.fn();
    const slots = createWorkspaceSlots({ initialProject: createProject('new'),
      adapterPorts: () => ({ queue, freshToken: () => 'token', api: () => ({ readOutputIdentity: vi.fn(), autosaveWorkspace: vi.fn(), saveWorkspace: vi.fn() }), onError: vi.fn(), onSave: vi.fn() }),
      publishProject: vi.fn(), observe: folder => handler({}, folder, { forEditing: true }), captureView: vi.fn(),
      certifyHandoff: retain, drain: () => queue.drain(), publishActive: vi.fn() });
    const healthy = path.join(root, 'healthy');
    await slots.requestOpen(healthy, async () => ({ folderPath: healthy, metadataPath: metadataPathForFolder(healthy), folderName: 'healthy', images: [] }));
    const active = slots.active;
    preparedSave.observeWorkspace.mockClear();
    await expect(slots.requestOpen(root, load)).rejects.toThrow(legacyWorkspaceMessage);
    expect(preparedSave.observeWorkspace).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled(); expect(retain).not.toHaveBeenCalled();
    expect(slots.active).toBe(active); expect(active.readonly).toBe(false); expect(active.lifecycle).toBe('active');
    expect(slots.hasHiddenRecovery()).toBe(false); expect(slots.wholeCapture().slots).toHaveLength(1);
    expect(await readFile(metadataPathForFolder(root), 'utf8')).toBe(original);
    await handler({}, root); expect(preparedSave.observeWorkspace).toHaveBeenCalledOnce();
  } finally { await rm(root, { recursive: true, force: true }); }
});
