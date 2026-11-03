/**
 * Shape rules for grouping a run of dialogue keystrokes into one undo step.
 *
 * The renderer says "this commit is a typing run `token`", but it never decides whether the
 * edit may join a run. That is derived here from the persisted before/after alone, so a
 * split, a reorder, a cross-board move or a programmatic `setDialogues` can never fold even
 * when it carries a token.
 */
import type { ProjectV1 } from '../../platform/contracts/refactorV1';

/**
 * One adjustable pause. It is deliberately unrelated to the checkpoint debounce: this number
 * only decides where an undo group ends. Tune from real use: if one sentence needs several
 * undos the value is too small; if two sentences undo together it is too large.
 */
export const dialogueTypingGroupWindowMs = 800;

const typingGroupPattern = /^[A-Za-z0-9_-]{1,64}$/;

/** A single-source predicate shared by request validation and the history itself. */
export function validTypingGroup(value: unknown): value is string {
  return typeof value === 'string' && typingGroupPattern.test(value);
}

export type TypingGroupTarget = { shotId: string; dialogueId: string };

/**
 * Everything a `setDialogues` edit must leave alone. Compared by reference so a keystroke costs
 * one cheap check instead of a second walk over every shot and layer: the domain replaces only
 * `dialogues` (and the revision) on the project it was given. A caller that deep-cloned the
 * project in between therefore never folds, which is the safe direction.
 */
const untouchedOutsideDialogues = (before: ProjectV1, after: ProjectV1): boolean =>
  before.id === after.id && before.schema === after.schema && before.version === after.version &&
  before.name === after.name && before.shots === after.shots && before.parkedShots === after.parkedShots &&
  before.images === after.images && before.naming === after.naming && before.presentation === after.presentation;

const textChanged = (row: { text: string }): boolean => row.text.trim() !== '';

/**
 * The single dialogue a typing commit rewrote, or null.
 *
 * Legal shapes:
 * - one existing row's text changed, every id/binding/order untouched;
 * - the board's first dialogue was created non-blank, i.e. the previous state had no row at
 *   all for that board (the first keystroke into an empty block, which starts as a local
 *   draft). A split also adds a row, but it always leaves the original row in place, so it
 *   never matches: structure commands stay their own step even if they arrive with a token.
 * Blank text is excluded: emptying a row removes it from the payload, which is a structure
 * change and must stand alone.
 */
export function typingFoldKey(before: ProjectV1, after: ProjectV1): TypingGroupTarget | null {
  if (!Array.isArray(before?.dialogues) || !Array.isArray(after?.dialogues)) return null;
  if (!untouchedOutsideDialogues(before, after)) return null;
  const previous = before.dialogues, next = after.dialogues;
  if (next.length === previous.length) {
    let changed = -1;
    for (let index = 0; index < previous.length; index += 1) {
      const oldRow = previous[index], newRow = next[index];
      if (oldRow.id !== newRow.id || oldRow.shotId !== newRow.shotId) return null;
      if (oldRow.text === newRow.text) continue;
      if (changed >= 0) return null;
      changed = index;
    }
    if (changed < 0 || !textChanged(next[changed])) return null;
    return { shotId: next[changed].shotId, dialogueId: next[changed].id };
  }
  if (next.length !== previous.length + 1) return null;
  // One inserted row: find the first divergence, then require the untouched suffix. Linear in
  // the row count — this runs on every keystroke of a board.
  let at = 0;
  while (at < previous.length && previous[at].id === next[at].id &&
    previous[at].shotId === next[at].shotId && previous[at].text === next[at].text) at += 1;
  for (let index = at; index < previous.length; index += 1) {
    const kept = next[index + 1];
    if (previous[index].id !== kept.id || previous[index].shotId !== kept.shotId || previous[index].text !== kept.text) return null;
  }
  const added = next[at];
  if (!textChanged(added)) return null;
  if (previous.some(row => row.shotId === added.shotId)) return null;
  return { shotId: added.shotId, dialogueId: added.id };
}
