import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { inspectProjectFolder } from '../../project-files/main/projectFolderEntry';
import { createFlowProjectLauncher, type FlowProjectLauncherDeps } from './flowProjectLauncher';
import type { FlowWorkspaceTarget } from '../../project-files/main/flowWorkspace';

const target = (root: string): FlowWorkspaceTarget =>
  ({ root, runtime: { open: () => ({ sessionId: 'session', project: { id: 'project-a', name: '项目甲' } }) } }) as unknown as FlowWorkspaceTarget;

async function fixture(overrides: Partial<FlowProjectLauncherDeps> = {}) {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'flow-entry-user-'));
  const destination = await mkdtemp(path.join(os.tmpdir(), 'flow-entry-dest-'));
  const createProject = vi.fn(async (input: { destinationParent: string; folderName: string; source: unknown }) => {
    const root = path.join(input.destinationParent, input.folderName);
    await mkdir(path.join(root, '.storyboard-flow'), { recursive: true });
    return { root };
  });
  const createBlankProject = vi.fn(async (input: { destinationParent: string; folderName: string }) => {
    const root = path.join(input.destinationParent, input.folderName);
    await mkdir(path.join(root, '.storyboard-flow'), { recursive: true });
    return { root };
  });
  const launcher = createFlowProjectLauncher({
    userData,
    prepare: async root => target(root),
    createProject: createProject as unknown as FlowProjectLauncherDeps['createProject'],
    createBlankProject: createBlankProject as unknown as FlowProjectLauncherDeps['createBlankProject'],
    onProgress: vi.fn(),
    decideIssues: async () => 'continue',
    now: () => 1,
    randomId: () => 'draft-' + Math.random().toString(36).slice(2),
    ...overrides
  });
  return { launcher, destination, createProject, createBlankProject };
}

const folderWith = async (files: string[], marker?: string) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'flow-entry-folder-'));
  if (marker) await mkdir(path.join(root, marker));
  for (const file of files) await writeFile(path.join(root, file), 'x');
  return root;
};

describe('entry folder classification', () => {
  it('recognises a Flow project before anything else', async () => {
    const root = await folderWith(['a.png'], '.storyboard-flow');
    expect(await inspectProjectFolder(root)).toEqual({ kind: 'flow' });
  });

  it('refuses a Flow marker that is not a usable directory', async () => {
    const root = await folderWith(['a.png']);
    await writeFile(path.join(root, '.storyboard-flow'), 'not a directory');
    expect(await inspectProjectFolder(root)).toEqual({ kind: 'damaged', reason: expect.stringContaining('.storyboard-flow') });
  });

  it('counts direct supported images only', async () => {
    const root = await folderWith(['1.png', '10.JPG', 'b.tif', 'notes.txt', '.hidden.png']);
    await mkdir(path.join(root, 'nested.tiff'));
    expect(await inspectProjectFolder(root)).toEqual({ kind: 'images', imageCount: 3, legacy: false });
  });

  it('treats a retired workbench folder as images with the legacy notice', async () => {
    const root = await folderWith(['a.png', 'b.tiff'], '.storyboard-workbench');
    expect(await inspectProjectFolder(root)).toEqual({ kind: 'images', imageCount: 2, legacy: true });
  });

  it('reports an empty folder and an empty legacy folder apart', async () => {
    expect(await inspectProjectFolder(await folderWith([]))).toEqual({ kind: 'empty', legacy: false });
    expect(await inspectProjectFolder(await folderWith([], '.storyboard-workbench'))).toEqual({ kind: 'empty', legacy: true });
  });
});

describe('simplified entry drafts', () => {
  it('turns an image folder into a draft named after it, with a distinct folder', async () => {
    const { launcher } = await fixture();
    const folder = await folderWith(['a.png', 'b.png']);
    const draft = launcher.draftFromFolder(folder, { imageCount: 2, legacy: false });
    expect(draft).toMatchObject({
      mode: 'images', legacy: false, imageCount: 2, name: path.basename(folder),
      folderName: path.basename(folder) + ' 分镜', destination: null
    });
    expect(draft.source).toMatchObject({ kind: 'folder', label: path.basename(folder) });
    expect(launcher.problem(draft.id)).toBe('请先选择保存位置');
  });

  it('keeps the legacy flag on a retired workbench draft', async () => {
    const { launcher } = await fixture();
    const folder = await folderWith(['a.png'], '.storyboard-workbench');
    expect(launcher.draftFromFolder(folder, { imageCount: 1, legacy: true }).legacy).toBe(true);
  });

  it('refuses a folder draft without images', async () => {
    const { launcher } = await fixture();
    const folder = await folderWith([]);
    expect(() => launcher.draftFromFolder(folder, { imageCount: 0, legacy: false })).toThrow('没有可导入的图片');
  });

  it('starts a blank draft that asks for a location, not a source', async () => {
    const { launcher } = await fixture();
    const draft = launcher.begin('blank');
    expect(draft).toMatchObject({ mode: 'blank', legacy: false, imageCount: 0, source: { kind: 'none' } });
    expect(launcher.problem(draft.id)).toBe('请先选择保存位置');
    expect(() => launcher.setSource(draft.id, { kind: 'folder', folder: '/tmp' })).toThrow('空白项目');
  });

  it('creates a blank project through the blank transaction', async () => {
    const { launcher, destination, createProject, createBlankProject } = await fixture();
    const draft = launcher.begin('blank');
    expect(launcher.update(draft.id, { name: '空白故事' }).folderName).toBe('空白故事');
    launcher.setDestination(draft.id, destination);
    const opened = await launcher.createAndPrepare(draft.id);
    expect(opened.root).toBe(path.join(destination, '空白故事'));
    expect(createBlankProject).toHaveBeenCalledWith({
      destinationParent: destination, folderName: '空白故事', name: '空白故事',
      naming: { sceneCode: 'scene', artistName: 'artist', version: 'v001' }
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(createProject).not.toHaveBeenCalled();
  });

  it('creates from an image folder through the image transaction', async () => {
    const { launcher, destination, createProject, createBlankProject } = await fixture();
    const folder = await folderWith(['a.png', 'b.png']);
    const draft = launcher.draftFromFolder(folder, { imageCount: 2, legacy: false });
    launcher.setDestination(draft.id, destination);
    const opened = await launcher.createAndPrepare(draft.id);
    expect(opened.root).toBe(path.join(destination, path.basename(folder) + ' 分镜'));
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      source: { kind: 'folder', folder }, folderName: path.basename(folder) + ' 分镜', name: path.basename(folder)
    }), expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(createBlankProject).not.toHaveBeenCalled();
  });
});
