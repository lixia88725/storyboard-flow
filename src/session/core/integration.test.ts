import { createProjectHistory } from './history';
import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import type { ProjectV1, ResultV1 } from '../../platform/contracts/refactorV1';
import { createProjectStore } from '../../project-files/main/persistence';
import { applyImageEdit } from '../../drawing/core';
import { applyStoryboardEdit } from '../../storyboard/core';

const value = <T>(r: ResultV1<T>): T => {
  expect(r.ok).toBe(true);
  if (!r.ok) throw Error(`${r.error.code}: ${r.error.message}`);
  return r.value;
};
async function fixture(imageId = 'image') {
  const buffers = await Promise.all(['#ff0000', '#0000ff'].map(background =>
    sharp({ create: { width: 4, height: 3, channels: 4, background } }).png().toBuffer()));
  const ids = buffers.map(b => createHash('sha256').update(b).digest('hex'));
  const assets = new Map(ids.map((id, index) => [id, buffers[index]]));
  const readAsset = async (id: string) => {
    const bytes = assets.get(id);
    if (!bytes) throw Error('Missing synthetic asset');
    return bytes;
  };
  const project: ProjectV1 = { schema: 'storyboard-flow.project', version: 1, id: 'project', revision: 0,
    name: 'Storyboard Flow', shots: [{ id: 'shot', imageId, name: '镜头', scriptText: '原稿' }],
    parkedShots: [], dialogues: [{ id: 'dialogue', shotId: 'shot', text: '你好 🎬' }],
    images: Object.fromEntries([[imageId, { id: imageId, revision: 0, width: 4, height: 3,
      layers: [{ id: 'layer', name: 'Image', kind: 'image', visible: true, locked: false, opacity: 1,
        blendMode: 'normal', width: 4, height: 3, assetId: ids[0] }] }]]) };
  return { project, buffers, ids, readAsset };
}

describe('wave-one public interfaces composed with real checkpoint files', () => {
  it('persists real drawing results, undo and redo at increasing project revisions', async () => {
    const f = await fixture(); const root = await temporaryWorkspace('core-composition-');
    const store = createProjectStore(); const history = value(createProjectHistory(f.project, { maxEntries: 8 }));
    value(await store.saveCheckpoint(root, f.project, f.readAsset));
    const edit = value(applyImageEdit(f.project.images.image, { kind: 'replacePixels', layerId: 'layer', assetId: f.ids[1] }));
    const changed = value(history.apply({ kind: 'applyImageEdit', result: edit })).after;
    value(await store.saveCheckpoint(root, changed, f.readAsset));
    const loaded = value(await createProjectStore().loadCheckpoint(root));
    expect(loaded.project).toEqual(changed);
    expect(Buffer.from(await loaded.readAsset(f.ids[1]))).toEqual(f.buffers[1]);
    const undone = value(history.undo()).after;
    expect(undone.revision).toBe(2);
    expect(undone.images.image).toEqual(f.project.images.image);
    value(await store.saveCheckpoint(root, undone, f.readAsset));
    expect(value(await store.loadCheckpoint(root)).project).toEqual(undone);
    const redone = value(history.redo()).after;
    expect(redone.revision).toBe(3);
    value(await store.saveCheckpoint(root, redone, f.readAsset));
    expect(value(await store.loadCheckpoint(root)).project).toEqual(redone);
    expect(value(history.current()).dialogues).toEqual(f.project.dialogues);
  });

  it('moves a project folder with Pending and a prototype-named editable image without the old path', async () => {
    const f = await fixture('__proto__'); const root = await temporaryWorkspace('core-portability-');
    const h = value(createProjectHistory(f.project, { maxEntries: 8 }));
    value(h.apply({ kind: 'setScriptText', shotId: 'shot', text: '雨\n台詞 ☔️' }));
    const image = value(h.current()).images.__proto__;
    value(h.apply({ kind: 'applyImageEdit', result: value(applyImageEdit(image, { kind: 'setLayer', layerId: 'layer', patch: { opacity: 0.5 } })) }));
    const parked = value(h.apply({ kind: 'moveShots', shotIds: ['shot'], destination: 'pending' })).after;
    value(await createProjectStore().saveCheckpoint(root, parked, f.readAsset));
    const movedRoot = root + '-moved'; await fs.rename(root, movedRoot);
    const loaded = value(await createProjectStore().loadCheckpoint(movedRoot));
    expect(loaded.project).toEqual(parked);
    expect(Object.hasOwn(loaded.project.images, '__proto__')).toBe(true);
    expect(Buffer.from(await loaded.readAsset(f.ids[0]))).toEqual(f.buffers[0]);
    const restored = value(applyStoryboardEdit(loaded.project, { kind: 'moveShots', shotIds: ['shot'], destination: 'active' })).after;
    expect(restored.shots[0].scriptText).toBe('雨\n台詞 ☔️');
    value(await createProjectStore().saveCheckpoint(movedRoot, restored, loaded.readAsset));
    expect(value(await createProjectStore().loadCheckpoint(movedRoot)).project).toEqual(restored);
  });

  it('keeps the last checkpoint after a missing new asset, then retries the same revision', async () => {
    const f = await fixture(); const root = await temporaryWorkspace('core-missing-'); const store = createProjectStore();
    value(await store.saveCheckpoint(root, f.project, f.readAsset));
    const r = value(applyImageEdit(f.project.images.image, { kind: 'replacePixels', layerId: 'layer', assetId: f.ids[1] }));
    const next = value(applyStoryboardEdit(f.project, { kind: 'applyImageEdit', result: r })).after;
    const failed = await store.saveCheckpoint(root, next, async () => { throw Error('Controlled missing asset'); });
    expect(failed).toMatchObject({ ok: false, error: { code: 'missing-asset' } });
    expect(value(await store.loadCheckpoint(root)).project).toEqual(f.project);
    value(await store.saveCheckpoint(root, next, f.readAsset));
    expect(value(await store.loadCheckpoint(root)).project).toEqual(next);
    expect(await fs.readdir(root)).toEqual(['.storyboard-flow']);
  });

  it('rejects a stale image baseline after branching history without publishing it', async () => {
    const f = await fixture(); const h = value(createProjectHistory(f.project, { maxEntries: 8 }));
    const original = f.project.images.image;
    const first = value(applyImageEdit(original, { kind: 'replacePixels', layerId: 'layer', assetId: f.ids[1] }));
    value(h.apply({ kind: 'applyImageEdit', result: first }));
    const stale = value(applyImageEdit(first.after, { kind: 'setLayer', layerId: 'layer', patch: { opacity: 0.4 } }));
    value(h.undo());
    const branch = value(applyImageEdit(original, { kind: 'setLayer', layerId: 'layer', patch: { name: 'Different branch' } }));
    value(h.apply({ kind: 'applyImageEdit', result: branch }));
    const before = value(h.current());
    expect(h.apply({ kind: 'applyImageEdit', result: stale })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(value(h.current())).toEqual(before);
    expect(h.redo()).toMatchObject({ ok: false });
  });
});
