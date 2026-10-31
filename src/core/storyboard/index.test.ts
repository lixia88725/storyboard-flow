import { describe, expect, it } from 'vitest';
import type { ImageDocumentV1, ProjectV1, StoryboardEditV1 } from '../../../electron/shared/refactorV1';
import { applyStoryboardEdit, createProjectHistory, precedingActiveImages } from './index';
const asset = (n: number) => n.toString(16).padStart(64, '0');
const image = (id: string, assetId = asset(1)): ImageDocumentV1 => ({ id, revision: 0, width: 16, height: 8,
  layers: [{ id: 'layer', name: 'Image', kind: 'image', visible: true, locked: false, opacity: 1,
    blendMode: 'normal', width: 16, height: 8, assetId }] });
const project = (n = 4): ProjectV1 => ({ schema: 'storyboard-flow.project', version: 1, id: 'project', revision: 0, name: 'Board',
  shots: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, imageId: `i${i}`, name: `Shot ${i}`, scriptText: `原稿 ${i}` })),
  parkedShots: [], dialogues: [{ id: 'd0', shotId: 's0', text: 'Hello 🎬' }, { id: 'd1', shotId: 's1', text: 'Next' }],
  images: Object.fromEntries(Array.from({ length: n }, (_, i) => [`i${i}`, image(`i${i}`, asset(i + 1))])) });
const history = (p = project(), maxEntries = 8) => {
  const r = createProjectHistory(p, { maxEntries }); expect(r.ok).toBe(true);
  if (!r.ok) throw Error(r.error.message);
  return r.value;
};
const ids = (p: ProjectV1) => p.shots.map(s => s.id);
const apply = (h: ReturnType<typeof history>, edit: StoryboardEditV1) => {
  const r = h.apply(edit); expect(r.ok).toBe(true); if (!r.ok) throw Error(r.error.message); return r.value;
};
const current = (h: ReturnType<typeof history>) => {
  const r = h.current(); if (!r.ok) throw Error(r.error.message); return r.value;
};
const error = (p: ProjectV1, edit: StoryboardEditV1, code: string) => {
  const r = applyStoryboardEdit(p, edit); expect(r).toMatchObject({ ok: false, error: { code } });
};
describe('storyboard public interface', () => {
  it('inserts, deletes, retains images and restores deleted dialogue with identity on undo', () => {
    const h = history(); const inserted = { id: 's4', imageId: 'i4', name: '插入', scriptText: '' };
    expect(apply(h, { kind: 'insertShot', shot: inserted, image: image('i4'), index: 2 }).changes).toMatchObject({ membership: true, order: true });
    expect(ids(current(h))).toEqual(['s0', 's1', 's4', 's2', 's3']);
    apply(h, { kind: 'removeShots', shotIds: ['s1', 's4'] });
    expect(ids(current(h))).toEqual(['s0', 's2', 's3']);
    expect(current(h).dialogues).toEqual([{ id: 'd0', shotId: 's0', text: 'Hello 🎬' }]);
    expect(current(h).images.i1.layers[0].assetId).toBe(asset(2));
    expect(h.undo()).toMatchObject({ ok: true, value: { changed: true } });
    expect(ids(current(h))).toEqual(['s0', 's1', 's4', 's2', 's3']);
    expect(current(h).dialogues[1]).toEqual({ id: 'd1', shotId: 's1', text: 'Next' });
    expect(current(h).images.i1).toEqual(image('i1', asset(2)));
  });
  it('moves noncontiguous and contiguous groups in authoritative active-then-pending order, including empty destinations and edges', () => {
    const h = history();
    apply(h, { kind: 'moveShots', shotIds: ['s3', 's1'], destination: 'pending' });
    expect(ids(current(h))).toEqual(['s0', 's2']);
    expect(current(h).parkedShots.map(s => s.id)).toEqual(['s1', 's3']);
    apply(h, { kind: 'moveShots', shotIds: ['s2'], destination: 'pending', beforeId: 's3' });
    expect(current(h).parkedShots.map(s => s.id)).toEqual(['s1', 's2', 's3']);
    apply(h, { kind: 'moveShots', shotIds: ['s1', 's2', 's3'], destination: 'active', beforeId: 's0' });
    expect(ids(current(h))).toEqual(['s1', 's2', 's3', 's0']);
    expect(current(h).parkedShots).toEqual([]);
    apply(h, { kind: 'moveShots', shotIds: ['s3', 's1'], destination: 'active' });
    expect(ids(current(h))).toEqual(['s2', 's0', 's1', 's3']);
    expect(current(h).dialogues).toHaveLength(2);
    expect(current(h).shots.find(s => s.id === 's1')?.imageId).toBe('i1');
    const allPending = history(); apply(allPending, { kind: 'moveShots', shotIds: ['s0','s1','s2','s3'], destination: 'pending' });
    expect(ids(current(allPending))).toEqual([]);
    apply(allPending, { kind: 'moveShots', shotIds: ['s0'], destination: 'active' });
    expect(ids(current(allPending))).toEqual(['s0']);
  });
  it('reports every position/membership-affected shot in deterministic post-state order through forward, undo and redo', () => {
    const h = history();
    const forward = apply(h, { kind: 'moveShots', shotIds: ['s0'], destination: 'active' });
    expect(forward.changes).toMatchObject({ order: true, membership: false, shotIds: ['s1', 's2', 's3', 's0'] });
    expect(h.undo()).toMatchObject({ ok: true, value: { changes: { order: true, membership: false,
      shotIds: ['s0', 's1', 's2', 's3'] } } });
    expect(h.redo()).toMatchObject({ ok: true, value: { changes: { order: true, membership: false,
      shotIds: ['s1', 's2', 's3', 's0'] } } });
    const parked = apply(h, { kind: 'moveShots', shotIds: ['s3', 's1'], destination: 'pending' });
    expect(parked.changes.shotIds).toEqual(['s2', 's0', 's1', 's3']);
    const pendingReorder = apply(h, { kind: 'moveShots', shotIds: ['s3'], destination: 'pending', beforeId: 's1' });
    expect(pendingReorder.changes.shotIds).toEqual(['s3', 's1']);
    expect(h.undo()).toMatchObject({ ok: true, value: { changes: { order: true, membership: false,
      shotIds: ['s1', 's3'] } } });
    expect(h.redo()).toMatchObject({ ok: true, value: { changes: { order: true, membership: false,
      shotIds: ['s3', 's1'] } } });
    const crossing = apply(h, { kind: 'moveShots', shotIds: ['s3'], destination: 'active', beforeId: 's0' });
    expect(crossing.changes.shotIds).toEqual(['s3', 's0', 's1']);
    expect(h.undo()).toMatchObject({ ok: true, value: { changes: { order: true, membership: true,
      shotIds: ['s0', 's3', 's1'] } } });
    expect(h.redo()).toMatchObject({ ok: true, value: { changes: { order: true, membership: true,
      shotIds: ['s3', 's0', 's1'] } } });
    const snapshot = current(h);
    const noop = apply(h, { kind: 'moveShots', shotIds: ['s1'], destination: 'pending' });
    expect(noop).toMatchObject({ changed: false, changes: { shotIds: [], order: false, membership: false } });
    expect(current(h)).toEqual(snapshot);
  });
  it('preserves Unicode and unrelated pixels/text, dialogue insertion position, and shared snapshot reading', () => {
    const h = history(); const pixel = current(h).images.i0;
    apply(h, { kind: 'setScriptText', shotId: 's1', text: '雨 ☔️\n台詞' });
    apply(h, { kind: 'setDialogues', shotId: 's0', dialogues: [{ id: 'd0', shotId: 's0', text: '你好🌙' }, { id: 'dx', shotId: 's0', text: '✨' }] });
    const snapshot = current(h);
    const grid = snapshot.shots.map(s => [s.id, s.scriptText]);
    const japanese = snapshot.shots.map(s => [s.id, s.scriptText]);
    expect(grid).toEqual(japanese);
    expect(snapshot.dialogues.map(d => d.id)).toEqual(['d0', 'dx', 'd1']);
    expect(snapshot.images.i0).toEqual(pixel);
    expect(snapshot.shots[0].scriptText).toBe('原稿 0');
    snapshot.shots[0].scriptText = 'external mutation';
    expect(current(h).shots[0].scriptText).toBe('原稿 0');
  });
  it('rejects unsupported structures, invalid IDs/references, collisions and bad indices without history or revision', () => {
    const p = project(), h = history(p);
    const cases: StoryboardEditV1[] = [
      { kind: 'moveShots', shotIds: ['s1', 's1'], destination: 'active' },
      { kind: 'moveShots', shotIds: ['missing'], destination: 'pending' },
      { kind: 'moveShots', shotIds: ['s1'], destination: 'pending', beforeId: 's0' },
      { kind: 'moveShots', shotIds: ['s1'], destination: 'active', beforeId: 's1' },
      { kind: 'removeShots', shotIds: ['missing'] },
      { kind: 'insertShot', shot: p.shots[0], image: image('i10'), index: 100 },
      { kind: 'setDialogues', shotId: 's1', dialogues: [{ id: 'd0', shotId: 's1', text: 'collision' }] },
      { kind: 'setDialogues', shotId: 's1', dialogues: [{ id: 'new', shotId: 'missing', text: 'bad binding' }] }
    ];
    for (const edit of cases) expect(h.apply(edit)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    error(p, { kind: 'setScriptText', shotId: 'missing', text: '' }, 'not-found');
    expect(apply(h, { kind: 'setScriptText', shotId: 's0', text: '原稿 0' }).changed).toBe(false);
    expect(apply(h, { kind: 'setDialogues', shotId: 's0', dialogues: p.dialogues.filter(d => d.shotId === 's0') }).changed).toBe(false);
    expect(apply(h, { kind: 'applyImageEdit', result: { before: p.images.i0, after: p.images.i0, changed: false, visualChanged: false } }).changed).toBe(false);
    expect(apply(h, { kind: 'moveShots', shotIds: ['s3'], destination: 'active' }).changed).toBe(false);
    expect(current(h)).toEqual(p);
    expect(h.undo()).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(applyStoryboardEdit({ ...p, version: 2 } as unknown as ProjectV1, { kind: 'removeShots', shotIds: ['s0'] })).toMatchObject({ ok: false, error: { code: 'unsupported-version' } });
    error({ ...p, extra: 'unsupported' } as ProjectV1, { kind: 'removeShots', shotIds: ['s0'] }, 'invalid-input');
    error({ ...p, shots: [p.shots[0], p.shots[0]] }, { kind: 'setScriptText', shotId: 's0', text: 'x' }, 'invalid-input');
    error({ ...p, images: { ...p.images, i0: { ...p.images.i0, layers: [{ ...p.images.i0.layers[0], assetId: 'wrong' }] } } },
      { kind: 'setScriptText', shotId: 's0', text: 'x' }, 'invalid-input');
  });
  it('accepts drawing envelopes by complete baseline, not revision ABA; rejects fabricated flags and after documents', () => {
    const h = history(); const before = current(h).images.i0;
    const after = { ...before, revision: 1, layers: [{ ...before.layers[0], assetId: asset(5) }] };
    const edit: StoryboardEditV1 = { kind: 'applyImageEdit', result: { before, after, changed: true, visualChanged: true } };
    expect(apply(h, edit).changes).toMatchObject({ imageIds: ['i0'], shotIds: ['s0'] });
    apply(h, { kind: 'setScriptText', shotId: 's0', text: 'changed' });
    expect(h.undo()).toMatchObject({ ok: true });
    expect(h.undo()).toMatchObject({ ok: true });
    expect(current(h).images.i0).toEqual(before);
    expect(h.redo()).toMatchObject({ ok: true });
    expect(current(h).images.i0).toEqual(after);
    // Revisions can match historical content after undo/redo, but full content cannot.
    const stale = { ...before, revision: 1 };
    expect(h.apply({ kind: 'applyImageEdit', result: { before: stale, after: { ...stale, revision: 2, layers: [{ ...stale.layers[0], assetId: asset(6) }] }, changed: true, visualChanged: true } }))
      .toMatchObject({ ok: false, error: { code: 'conflict' } });
    const p = current(h);
    error(p, { kind: 'applyImageEdit', result: { before: after, after: { ...after, revision: 2, layers: [{ ...after.layers[0], assetId: asset(6) }] }, changed: false, visualChanged: true } }, 'invalid-input');
    error(p, { kind: 'applyImageEdit', result: { before: after, after: { ...after, revision: 2, id: 'different' }, changed: true, visualChanged: false } }, 'invalid-input');
    expect(current(h)).toEqual(p);
  });
  it('undoes mixed edits in exact order, clears redo on new edit, bounds history and isolates input aliases', () => {
    const p = project(), h = history(p, 2);
    const before = structuredClone(p.images.i1);
    const after = { ...before, revision: 1, layers: [{ ...before.layers[0], assetId: asset(8) }] };
    apply(h, { kind: 'applyImageEdit', result: { before, after, changed: true, visualChanged: true } });
    apply(h, { kind: 'setScriptText', shotId: 's1', text: 'new' });
    apply(h, { kind: 'moveShots', shotIds: ['s0'], destination: 'active' });
    expect(ids(current(h))).toEqual(['s1','s2','s3','s0']);
    expect(current(h).revision).toBe(3);
    after.layers[0].assetId = asset(9);
    p.shots[0].scriptText = 'mutated';
    expect(current(h).images.i1.layers[0].assetId).toBe(asset(8));
    h.undo(); expect(ids(current(h))).toEqual(['s0','s1','s2','s3']);
    expect(current(h).revision).toBe(4);
    h.undo(); expect(current(h).shots[1].scriptText).toBe('原稿 1');
    expect(current(h).revision).toBe(5);
    expect(h.undo()).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(current(h).images.i1.layers[0].assetId).toBe(asset(8));
    h.redo(); expect(current(h).shots[1].scriptText).toBe('new');
    expect(current(h).revision).toBe(6);
    apply(h, { kind: 'setScriptText', shotId: 's2', text: 'branch' });
    expect(h.redo()).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(current(h).revision).toBe(7);
  });
  it('returns previous active image IDs closest-first, reacts to reorder and excludes pending', () => {
    const h = history();
    expect(precedingActiveImages(current(h), 's0', 5)).toEqual({ ok: true, value: [] });
    expect(precedingActiveImages(current(h), 's3', 2)).toEqual({ ok: true, value: ['i2', 'i1'] });
    apply(h, { kind: 'moveShots', shotIds: ['s2'], destination: 'pending' });
    expect(precedingActiveImages(current(h), 's3', 5)).toEqual({ ok: true, value: ['i1','i0'] });
    expect(precedingActiveImages(current(h), 's2', 1)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    apply(h, { kind: 'moveShots', shotIds: ['s3'], destination: 'active', beforeId: 's0' });
    expect(precedingActiveImages(current(h), 's1', 3)).toEqual({ ok: true, value: ['i0','i3'] });
    expect(precedingActiveImages(current(h), 'missing', 1)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(precedingActiveImages(current(h), 's1', -1)).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
  });
  it('handles 1,000 synthetic shots: metadata-only reorder/text/undo with measured workload', () => {
    const p = project(1000); const h = history(p, 8);
    const start = performance.now();
    apply(h, { kind: 'moveShots', shotIds: ['s999','s5','s500'], destination: 'active', beforeId: 's2' });
    apply(h, { kind: 'setScriptText', shotId: 's500', text: '一千镜头' });
    h.undo(); h.undo();
    const elapsed = performance.now() - start;
    expect(ids(current(h))).toEqual(ids(p));
    expect(current(h).shots[500].scriptText).toBe('原稿 500');
    expect(current(h).revision).toBe(4);
    console.info(`storyboard 1000 synthetic shots: reorder+text+2 undo ${elapsed.toFixed(1)} ms; heapUsed=${typeof process !== 'undefined' ? Math.round(process.memoryUsage().heapUsed / 1048576) : 'unavailable'} MiB (process-wide)`);
  });
});

it('naming settings are one undoable project edit and reject unknown fields',()=>{
 const ok = <T,>(r: {ok:true;value:T}|{ok:false;error:{message:string}}):T => {if(!r.ok)throw Error(r.error.message);return r.value;};
 const p=project();const h=history(p,10);
 const naming={sceneCode:'S01',artistName:'绘师',version:'2'};
 const changed=h.apply({kind:'setProjectNaming',name:'电影',naming});expect(changed.ok).toBe(true);
 expect(ok(h.current()).naming).toEqual(naming);expect(ok(h.current()).name).toBe('电影');
 expect(ok(h.undo()).after.name).toBe(p.name);expect(ok(h.current()).naming).toBeUndefined();
 expect(ok(h.redo()).after.naming).toEqual(naming);
 expect(applyStoryboardEdit(p,{kind:'setProjectNaming',name:'x',naming:{...naming,unknown:true}} as unknown as StoryboardEditV1).ok).toBe(false);
});

it('changes scene presentation without touching pixels and keeps Pending until restored',()=>{
 const h=history(),before=current(h).images;
 apply(h,{kind:'setPresentation',presentation:{mode:'expanded',dialogue:true}});
 expect(current(h).images).toEqual(before);expect(current(h).shots.every(s=>s.presentation?.dialogue)).toBe(true);
 apply(h,{kind:'moveShots',shotIds:['s0'],destination:'pending'});
 apply(h,{kind:'setPresentation',presentation:null});
 expect(current(h).parkedShots[0].presentation?.mode).toBe('expanded');expect(current(h).shots.every(s=>!s.presentation)).toBe(true);
 apply(h,{kind:'moveShots',shotIds:['s0'],destination:'active'});
 expect(current(h).shots.find(s=>s.id==='s0')?.presentation).toBeUndefined();
 expect(h.undo().ok).toBe(true);expect(current(h).parkedShots[0].presentation?.mode).toBe('expanded');expect(current(h).images).toEqual(before);
});

it('new shots inherit scene presentation and malformed settings are refused',()=>{
 const h=history();
 expect(h.apply({kind:'setPresentation',presentation:{mode:'other',dialogue:true}} as never).ok).toBe(false);
 apply(h,{kind:'setPresentation',presentation:{mode:'embedded',dialogue:false}});
 apply(h,{kind:'insertShot',shot:{id:'new',imageId:'new_image',name:'new',scriptText:''},image:image('new_image'),index:0});
 expect(current(h).shots[0].presentation).toEqual({mode:'embedded',dialogue:false});
 expect(h.undo().ok).toBe(true);expect(current(h).shots.some(s=>s.id==='new')).toBe(false);
});
