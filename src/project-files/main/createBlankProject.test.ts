import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createProjectStore } from './persistence';
import { openFlowEditorRuntime } from './flowEditorRuntime';
import { createBlankProject } from './createBlankProject';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';

const NAMING = { sceneCode: 'S01', artistName: 'Li', version: 'v001' };
const options = (signal = new AbortController().signal) => ({ signal });
const load = async (root: string): Promise<ProjectV1> => {
  const result = await createProjectStore().loadCheckpoint(root);
  if (!result.ok) throw Error(result.error.message);
  return result.value.project;
};

async function destination() {
  const root = await temporaryWorkspace('flow-blank-project-');
  const out = path.join(root, 'out');
  await fs.mkdir(out);
  return out;
}

describe('blank project creation', () => {
  it('publishes an empty project that opens and stays empty', async () => {
    const out = await destination();
    const progress: { done: number; total: number; phase?: 'read' | 'write' }[] = [];
    const created = await createBlankProject({ destinationParent: out, folderName: '空白故事', name: '空白故事', naming: NAMING },
      { signal: new AbortController().signal, onProgress: value => progress.push(value) });

    expect(created.root).toBe(path.join(out, '空白故事'));
    const project = await load(created.root);
    expect(project.name).toBe('空白故事');
    expect(project.naming).toEqual(NAMING);
    expect(project.shots).toEqual([]);
    expect(project.parkedShots).toEqual([]);
    expect(project.images).toEqual({});
    expect(project.revision).toBe(0);

    const runtime = await openFlowEditorRuntime(created.root);
    expect(runtime.open().project).toEqual(project);
    const status = await runtime.folderStatus({ project, inspectDisk: true });
    expect(status).toBe('current');
    // Nothing but the checkpoint store was written into the new folder.
    const entries = await fs.readdir(created.root);
    expect(entries).toEqual(['.storyboard-flow']);
    expect(progress.at(-1)).toMatchObject({ done: 1, total: 1, phase: 'write' });
  });

  it('refuses an occupied destination and leaves the existing folder untouched', async () => {
    const out = await destination();
    await fs.mkdir(path.join(out, '空白故事'));
    await fs.writeFile(path.join(out, '空白故事', 'keep.txt'), 'user data');
    await expect(createBlankProject({ destinationParent: out, folderName: '空白故事', name: '空白故事', naming: NAMING }, options()))
      .rejects.toThrow('already exists');
    expect(await fs.readFile(path.join(out, '空白故事', 'keep.txt'), 'utf8')).toBe('user data');
  });

  it('refuses invalid names before creating anything', async () => {
    const out = await destination();
    await expect(createBlankProject({ destinationParent: out, folderName: '空白故事', name: '', naming: NAMING }, options()))
      .rejects.toThrow();
    await expect(createBlankProject({ destinationParent: out, folderName: '../escape', name: 'x', naming: NAMING }, options()))
      .rejects.toThrow();
    expect(await fs.readdir(out)).toEqual([]);
  });

  it('honours an aborted signal without publishing a folder', async () => {
    const out = await destination();
    const controller = new AbortController();
    controller.abort();
    await expect(createBlankProject({ destinationParent: out, folderName: '空白故事', name: '空白故事', naming: NAMING }, options(controller.signal)))
      .rejects.toThrow('创建已取消');
    expect(await fs.readdir(out)).toEqual([]);
  });
});
