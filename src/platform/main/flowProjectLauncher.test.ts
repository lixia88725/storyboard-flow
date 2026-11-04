import { mkdtemp, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createFlowProjectLauncher, isProjectCreationCanceled, type FlowProjectLauncherDeps } from './flowProjectLauncher';
import type { CreateImageProject, CreateImageProjectOptions } from '../../platform/contracts/flowProjectCreation';
import type { FlowWorkspaceTarget } from '../../project-files/main/flowWorkspace';

const target = (root: string, id = 'project-a', name = '项目甲'): FlowWorkspaceTarget =>
  ({ root, runtime: { open: () => ({ sessionId: 'session', project: { id, name } }) } }) as unknown as FlowWorkspaceTarget;

async function fixture(overrides: Partial<FlowProjectLauncherDeps> = {}) {
  const userData = await mkdtemp(path.join(os.tmpdir(), 'flow-launcher-user-'));
  const destination = await mkdtemp(path.join(os.tmpdir(), 'flow-launcher-dest-'));
  const prepare = vi.fn(async (root: string) => target(root));
  const createProject = vi.fn<CreateImageProject>(async (input, options) => {
    const root = path.join(input.destinationParent, input.folderName);
    await mkdir(path.join(root, '.storyboard-flow'), { recursive: true });
    options.onProgress?.({ done: 1, total: 1 });
    return { root };
  });
  const onProgress = vi.fn();
  const decideIssues = vi.fn(async () => 'continue' as const);
  const launcher = createFlowProjectLauncher({
    userData, prepare, createProject, onProgress, decideIssues,
    now: () => 100, randomId: () => Math.random().toString(36).slice(2), ...overrides
  });
  return { launcher, userData, destination, prepare, createProject, onProgress, decideIssues };
}

const projectFolder = async (name = 'flow-project-') => {
  const root = await mkdtemp(path.join(os.tmpdir(), name));
  await mkdir(path.join(root, '.storyboard-flow'));
  return root;
};

describe('project launcher drafts', () => {
  it('starts with explicit, non-inherited defaults', async () => {
    const { launcher } = await fixture();
    const draft = launcher.begin();
    expect(draft.name).toBe('未命名项目');
    expect(draft.folderName).toBe('未命名项目');
    expect(draft.naming).toEqual({ sceneCode: 'scene', artistName: 'artist', version: 'v001' });
    expect(draft.source).toEqual({ kind: 'none' });
    expect(draft.destination).toBeNull();
  });

  it('takes the project name from a chosen folder but never guesses one from files', async () => {
    const { launcher, destination } = await fixture();
    const folder = await mkdtemp(path.join(os.tmpdir(), 'flow-source-'));
    const first = launcher.begin();
    const fromFolder = launcher.setSource(first.id, { kind: 'folder', folder });
    expect(fromFolder.name).toBe(path.basename(folder));
    expect(fromFolder.folderName).toBe(path.basename(folder));
    const second = launcher.begin();
    launcher.setSource(second.id, { kind: 'files', files: [path.join(folder, 'a.png'), path.join(folder, 'b.png')] });
    const view = launcher.setDestination(second.id, destination);
    expect(view.name).toBe('未命名项目');
    expect(view.folderName).toBe('未命名项目');
    expect(view.source).toEqual({ kind: 'files', label: '2 张图片', count: 2 });
  });

  it('never returns absolute paths in a draft view', async () => {
    const { launcher, destination } = await fixture();
    const folder = await mkdtemp(path.join(os.tmpdir(), 'flow-source-'));
    const draft = launcher.begin();
    launcher.setSource(draft.id, { kind: 'folder', folder });
    const view = launcher.setDestination(draft.id, destination);
    expect(JSON.stringify(view)).not.toContain(await realpath(folder));
    expect(JSON.stringify(view)).not.toContain(await realpath(destination));
  });

  it('rejects invalid folder names and keeps invalid naming editable', async () => {
    const { launcher } = await fixture();
    const draft = launcher.begin();
    expect(() => launcher.update(draft.id, { folderName: '../escape' })).toThrow();
    expect(() => launcher.update(draft.id, { folderName: '' })).toThrow();
    expect(() => launcher.update(draft.id, { name: '' })).not.toThrow();
    expect(launcher.problem(draft.id)).toBe('请先选择图片或文件夹');
  });
});

describe('project launcher recent targets', () => {
  it('remembers only a strictly opened Flow project and persists it', async () => {
    const { launcher, userData, prepare } = await fixture();
    const root = await projectFolder();
    const opened = await launcher.openRoot(root);
    expect(opened.root).toBe(root);
    expect(prepare).toHaveBeenCalledWith(root);
    const state = await launcher.state();
    expect(state.recent).toHaveLength(1);
    expect(state.recent[0]).toMatchObject({ name: '项目甲', available: true });
    expect(JSON.parse(await readFile(path.join(userData, 'recent-projects.json'), 'utf8')).projects[0].projectId).toBe('project-a');
  });

  it('refuses a plain TIFF folder instead of treating it as a source', async () => {
    const { launcher, prepare } = await fixture();
    const root = await mkdtemp(path.join(os.tmpdir(), 'flow-tiff-'));
    await expect(launcher.openRoot(root)).rejects.toThrow('不是 Storyboard Flow 项目');
    expect(prepare).not.toHaveBeenCalled();
    expect((await launcher.state()).recent).toEqual([]);
  });

  it('refuses to resolve a recent entry whose folder now holds another project', async () => {
    const { launcher, prepare } = await fixture();
    const root = await projectFolder();
    await launcher.openRoot(root);
    const id = (await launcher.state()).recent[0].id;
    prepare.mockResolvedValueOnce(target(root, 'project-b', '项目乙'));
    await expect(launcher.openRecent(id)).rejects.toThrow('与最近记录不一致');
  });

  it('reuses the stable recent id and moves the entry to the front', async () => {
    const { launcher } = await fixture();
    const first = await projectFolder();
    const second = await projectFolder();
    await launcher.openRoot(first);
    const firstId = (await launcher.state()).recent[0].id;
    await launcher.openRoot(second);
    await launcher.openRoot(first);
    const state = await launcher.state();
    expect(state.recent[0]).toMatchObject({ id: firstId, name: '项目甲' });
    expect(state.recent).toHaveLength(2);
  });

  it('ignores malformed recent records and drops entries without an identity', async () => {
    const { launcher, userData } = await fixture();
    await writeFile(path.join(userData, 'recent-projects.json'), JSON.stringify({ version: 1, projects: [
      { id: 'a', root: '/tmp/x', name: 'no identity', lastOpenedAt: 1 },
      { id: 'b', root: '/tmp/y', projectId: 'p', name: 'ok', lastOpenedAt: 2 }
    ] }));
    const state = await launcher.state();
    expect(state.recent.map(entry => entry.name)).toEqual(['ok']);
  });
});

describe('project launcher creation', () => {
  it('passes exactly the draft fields to the file module and remembers the result', async () => {
    const { launcher, destination, createProject, onProgress } = await fixture();
    const folder = await mkdtemp(path.join(os.tmpdir(), 'flow-source-'));
    const draft = launcher.begin();
    launcher.setSource(draft.id, { kind: 'folder', folder });
    launcher.setDestination(draft.id, destination);
    launcher.update(draft.id, { folderName: '分镜项目', name: '项目名', naming: { sceneCode: 'S01', artistName: 'A', version: 'v002' } });
    const opened = await launcher.createAndPrepare(draft.id);
    expect(opened.root).toBe(path.join(destination, '分镜项目'));
    expect(createProject).toHaveBeenCalledWith({
      source: { kind: 'folder', folder },
      destinationParent: destination,
      folderName: '分镜项目', name: '项目名', naming: { sceneCode: 'S01', artistName: 'A', version: 'v002' }
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onProgress).toHaveBeenCalledWith(draft.id, { done: 1, total: 1 });
    expect((await launcher.state()).recent[0].name).toBe('项目甲');
    expect(() => launcher.view(draft.id)).toThrow();
  });

  it('does not remember a failed creation and keeps the draft for a retry', async () => {
    const { launcher, destination, createProject } = await fixture();
    const folder = await mkdtemp(path.join(os.tmpdir(), 'flow-source-'));
    const draft = launcher.begin();
    launcher.setSource(draft.id, { kind: 'folder', folder });
    launcher.setDestination(draft.id, destination);
    createProject.mockRejectedValueOnce(new Error('disk full'));
    await expect(launcher.createAndPrepare(draft.id)).rejects.toThrow('disk full');
    expect((await launcher.state()).recent).toEqual([]);
    expect(launcher.view(draft.id).folderName).toBe(path.basename(folder));
  });

  it('forwards batched issues and honors cancel', async () => {
    const issues = [{ file: 'a.psd', reason: 'unsupported', action: 'skip' as const }];
    const createProject = vi.fn<CreateImageProject>(async (input, options: CreateImageProjectOptions) => {
      const decision = await options.decideIssues?.(issues);
      if (decision !== 'continue') throw Error('creation cancelled');
      const root = path.join(input.destinationParent, input.folderName);
      await mkdir(path.join(root, '.storyboard-flow'), { recursive: true });
      return { root };
    });
    const decideIssues = vi.fn(async () => 'cancel' as const);
    const { launcher, destination } = await fixture({ createProject, decideIssues });
    const folder = await mkdtemp(path.join(os.tmpdir(), 'flow-source-'));
    const draft = launcher.begin();
    launcher.setSource(draft.id, { kind: 'folder', folder });
    launcher.setDestination(draft.id, destination);
    await expect(launcher.createAndPrepare(draft.id)).rejects.toThrow('创建已取消');
    expect(decideIssues).toHaveBeenCalledWith(draft.id, issues);
  });

  it('stops with the abort signal while the file module is working', async () => {
    let started!: () => void;
    const running = new Promise<void>(resolve => { started = resolve; });
    const createProject = vi.fn<CreateImageProject>((_input, options) => new Promise((_, reject) => {
      started();
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    const { launcher, destination } = await fixture({ createProject });
    const folder = await mkdtemp(path.join(os.tmpdir(), 'flow-source-'));
    const draft = launcher.begin();
    launcher.setSource(draft.id, { kind: 'folder', folder });
    launcher.setDestination(draft.id, destination);
    const work = launcher.createAndPrepare(draft.id);
    await running;
    launcher.abort(draft.id);
    const error = await work.catch(value => value);
    expect(isProjectCreationCanceled(error)).toBe(true);
    expect(String(error)).toContain('创建已取消');
    expect(launcher.isCreating(draft.id)).toBe(false);
  });

  it('refuses a destination that already contains the folder', async () => {
    const { launcher, destination } = await fixture();
    const folder = await mkdtemp(path.join(os.tmpdir(), 'flow-source-'));
    const draft = launcher.begin();
    launcher.setSource(draft.id, { kind: 'folder', folder });
    launcher.setDestination(draft.id, destination);
    await mkdir(path.join(destination, path.basename(folder)));
    await expect(launcher.createAndPrepare(draft.id)).rejects.toThrow('已经有同名文件夹');
  });

  it('rejects a result that lands outside the requested destination', async () => {
    const { launcher, destination } = await fixture({
      createProject: (async () => ({ root: await mkdtemp(path.join(os.tmpdir(), 'flow-elsewhere-')) })) as CreateImageProject
    });
    const folder = await mkdtemp(path.join(os.tmpdir(), 'flow-source-'));
    const draft = launcher.begin();
    launcher.setSource(draft.id, { kind: 'folder', folder });
    launcher.setDestination(draft.id, destination);
    await expect(launcher.createAndPrepare(draft.id)).rejects.toThrow('位置与请求');
    expect((await launcher.state()).recent).toEqual([]);
  });
});
