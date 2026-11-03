import { describe, expect, it } from 'vitest';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';
import { dialogueTypingGroupWindowMs, typingFoldKey, validTypingGroup } from './grouping';

const project = (): ProjectV1 => ({
  schema: 'storyboard-flow.project', version: 1, id: 'project', revision: 7, name: 'Board',
  shots: [{ id: 's0', imageId: 'i0', name: 'Shot 0', scriptText: '原稿 0' }, { id: 's1', imageId: 'i1', name: 'Shot 1', scriptText: '' }],
  parkedShots: [], dialogues: [{ id: 'd0', shotId: 's0', text: '第一段' }, { id: 'd1', shotId: 's1', text: '第二段' }],
  images: {
    i0: { id: 'i0', revision: 0, width: 16, height: 8, layers: [{ id: 'layer', name: 'Image', kind: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', width: 16, height: 8, assetId: '1'.repeat(64) }] },
    i1: { id: 'i1', revision: 0, width: 16, height: 8, layers: [{ id: 'layer', name: 'Image', kind: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', width: 16, height: 8, assetId: '2'.repeat(64) }] }
  }
});

/** The domain applies every committed edit with the next revision; that is not a content change. */
const committed = (base: ProjectV1, dialogues: ProjectV1['dialogues']): ProjectV1 =>
  ({ ...base, revision: base.revision + 1, dialogues });

const typeInto = (base: ProjectV1, text: string, id = 'd0', shotId = 's0'): ProjectV1 =>
  committed(base, base.dialogues.map(row => (row.id === id ? { ...row, text } : row)));

describe('typing fold key', () => {
  it('names the one dialogue whose text a typing commit rewrote', () => {
    const before = project();
    expect(typingFoldKey(before, typeInto(before, '第一段好'))).toEqual({ shotId: 's0', dialogueId: 'd0' });
  });

  it('ignores the top-level revision but nothing else', () => {
    const before = project();
    expect(typingFoldKey(before, typeInto(before, '第一段好'))).not.toBeNull();
    const bumped = { ...typeInto(before, '第一段好') };
    bumped.images = { ...bumped.images, i1: { ...bumped.images.i1, revision: 3 } };
    expect(typingFoldKey(before, bumped)).toBeNull();
    const renamed = { ...typeInto(before, '第一段好'), name: 'Other' };
    expect(typingFoldKey(before, renamed)).toBeNull();
  });

  it('refuses reorders, multi-row changes, removals and rebinding', () => {
    const before = project();
    const swapped = committed(before, [before.dialogues[1], before.dialogues[0]]);
    expect(typingFoldKey(before, swapped)).toBeNull();
    const both = typeInto(typeInto(before, 'A'), 'B', 'd1', 's1');
    expect(typingFoldKey(before, both)).toBeNull();
    expect(typingFoldKey(before, committed(before, [before.dialogues[0]]))).toBeNull();
    const rebound = committed(before, [{ ...before.dialogues[0], shotId: 's1' }, before.dialogues[1]]);
    expect(typingFoldKey(before, rebound)).toBeNull();
  });

  it('accepts the first dialogue of an empty board and refuses one added beside existing rows', () => {
    const empty = { ...project(), dialogues: [] };
    const created = committed(empty, [{ id: 'd1', shotId: 's0', text: '第一句' }]);
    expect(typingFoldKey(empty, created)).toEqual({ shotId: 's0', dialogueId: 'd1' });
    expect(typingFoldKey(empty, committed(empty, [{ id: 'd1', shotId: 's0', text: '   ' }]))).toBeNull();
    // A split keeps the original row in place, so it never matches a typing fold.
    const before = project();
    const split = committed(before, [before.dialogues[0], { id: 'd2', shotId: 's0', text: '后半' }, before.dialogues[1]]);
    expect(typingFoldKey(before, split)).toBeNull();
  });

  it('refuses emptying a row, since the payload then drops it as a structure change', () => {
    const before = project();
    const emptied = committed(before, [{ ...before.dialogues[0], text: '' }, before.dialogues[1]]);
    expect(typingFoldKey(before, emptied)).toBeNull();
    expect(typingFoldKey(before, committed(before, [before.dialogues[1]]))).toBeNull();
  });

  it('refuses an unchanged payload', () => {
    const before = project();
    expect(typingFoldKey(before, committed(before, before.dialogues))).toBeNull();
  });

  it('refuses a project that was deep-cloned between the two states', () => {
    const before = project();
    // Reference equality outside `dialogues` is the cheap proof that only dialogue text moved;
    // a cloned project cannot prove it, so it never folds.
    expect(typingFoldKey(before, structuredClone(typeInto(before, '第一段好')))).toBeNull();
  });
});

describe('typing group token contract', () => {
  it('accepts short id-safe tokens and refuses anything else', () => {
    for (const token of ['t1', 'A_b-9', 'x'.repeat(64)]) expect(validTypingGroup(token)).toBe(true);
    for (const token of ['', 'x'.repeat(65), 'has space', '中文', 'a/b', 7, null, undefined]) expect(validTypingGroup(token)).toBe(false);
  });

  it('keeps the adjustable window at the agreed initial value', () => {
    expect(dialogueTypingGroupWindowMs).toBe(800);
  });
});
