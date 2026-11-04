import {pendingAddEdit} from './pendingAdd';
import type { ChangeSetV1, ProjectEditResultV1, ProjectV1, ResultV1, StoryboardEditV1 } from '../../platform/contracts/refactorV1';
import { applyStoryboardEdit } from '../../storyboard/core';
import { validProject, revision, fail, ok, copy, same, positionChanges } from '../../project-files/contracts/projectModel';
import { typingFoldKey, validTypingGroup, type TypingGroupTarget } from './grouping';

export interface ProjectHistoryV1 {
  current(): ResultV1<ProjectV1>;
  /** `typing` is non-persistent metadata: it may only join an existing undo group. */
  apply(edit: StoryboardEditV1, typing?: { group: string }): ResultV1<ProjectEditResultV1>;
  /** Private installation of a verified durable Pending append, never a public board command. */
  insertParkedShots(before: ProjectV1, after: ProjectV1): ResultV1<ProjectEditResultV1>;
  undo(): ResultV1<ProjectEditResultV1>;
  redo(): ResultV1<ProjectEditResultV1>;
  undoDepth(): number;
  redoDepth(): number;
}

export type ProjectHistoryGrouping = { now: () => number; windowMs: number };
export type ProjectHistoryOptions = { maxEntries: number; group?: ProjectHistoryGrouping };

export function createProjectHistory(project: ProjectV1, options: ProjectHistoryOptions): ResultV1<ProjectHistoryV1> {
  if (!validProject(project) || !options || !Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1)
    return fail('invalid-input', 'Invalid initial project or history capacity');
  const grouping = options.group as ProjectHistoryGrouping | null | undefined;
  if (grouping !== undefined && (!grouping || typeof grouping.now !== 'function' || typeof grouping.windowMs !== 'number' ||
      !Number.isFinite(grouping.windowMs) || grouping.windowMs <= 0))
    return fail('invalid-input', 'Invalid history grouping option');
  let state = copy(project);
  let serial = state.revision;
  const undoStack: ProjectV1[] = [];
  const redoStack: ProjectV1[] = [];
  // Open typing group. Cleared by Undo/Redo and by every committed edit that is not typing,
  // so a structure or drawing step can never be a folding base.
  let typingGroup: { key: string; token: string; at: number } | null = null;
  const stamp = (): number | null => {
    if (!grouping) return null;
    try {
      const value = grouping.now();
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch { return null; }
  };
  const push = (stack: ProjectV1[], snapshot: ProjectV1) => {
    stack.push(snapshot);
    if (stack.length > options.maxEntries) stack.shift();
  };
  const restore = (from: ProjectV1[], to: ProjectV1[]): ResultV1<ProjectEditResultV1> => {
    if (!from.length) return fail('not-found', 'No history entry');
    if (!revision(serial + 1)) return fail('invalid-input', 'Project revision overflow');
    const before = state;
    const next = from.pop()!;
    push(to, before);
    serial += 1;
    state = { ...next, revision: serial };
    const movedPositions = new Set(positionChanges(before, state));
    const changes: ChangeSetV1 = {
      imageIds: Object.keys({ ...before.images, ...state.images }).filter(key => !same(before.images[key], state.images[key])),
      shotIds: [...new Set([...state.shots, ...state.parkedShots, ...before.shots, ...before.parkedShots].map(s => s.id))]
        .filter(key => movedPositions.has(key) ||
          !same([...before.shots, ...before.parkedShots].find(s => s.id === key), [...state.shots, ...state.parkedShots].find(s => s.id === key)) ||
          !same(before.dialogues.filter(d => d.shotId === key), state.dialogues.filter(d => d.shotId === key)) ||
          !same(before.images[[...before.shots, ...before.parkedShots].find(s => s.id === key)?.imageId ?? ''],
            state.images[[...state.shots, ...state.parkedShots].find(s => s.id === key)?.imageId ?? '']) ||
          before.shots.some(s => s.id === key) !== state.shots.some(s => s.id === key)),
      text: !same(before.dialogues, state.dialogues) || [...before.shots, ...before.parkedShots].some(s => s.scriptText !== [...state.shots, ...state.parkedShots].find(t => t.id === s.id)?.scriptText),
      order: !same(before.shots.map(s => s.id), state.shots.map(s => s.id)) || !same(before.parkedShots.map(s => s.id), state.parkedShots.map(s => s.id)),
      membership: !same([...before.shots, ...before.parkedShots].map(s => s.id).sort(), [...state.shots, ...state.parkedShots].map(s => s.id).sort()) ||
        before.shots.some(s => state.parkedShots.some(t => t.id === s.id)) || before.parkedShots.some(s => state.shots.some(t => t.id === s.id))
    };
    return ok(copy({ before, after: state, changed: true, changes }));
  };
  return ok({
    current: () => ok(copy(state)),
    apply: (edit, typing) => {
      const applied = applyStoryboardEdit(state, edit);
      if (!applied.ok || !applied.value.changed) return applied.ok ? ok(copy(applied.value)) : applied;
      // Fold only a shape-legal single-dialogue text edit that declares a typing run. The
      // token alone never authorises a fold: structure edits, blank deletions and
      // programmatic replacements are pushed as their own step and close the run.
      const target: TypingGroupTarget | null = typing && validTypingGroup(typing.group)
        ? typingFoldKey(applied.value.before, applied.value.after) : null;
      const at = target ? stamp() : null;
      const token = target ? typing!.group : null;
      const key = target ? `${target.shotId}/${target.dialogueId}` : null;
      // A clock that moved backwards cannot order this edit against the open run: keep the
      // step and close the run instead of re-seeding a base the next edit could rejoin.
      const backwards = at !== null && typingGroup !== null && at < typingGroup.at;
      // The same target and a fresh token is a new run: the renderer rolls the token on a
      // pause, a focus change, a caret jump or a paste, and only the run that owns it folds.
      const fold = !backwards && key !== null && at !== null && token !== null && typingGroup !== null &&
        typingGroup.key === key && typingGroup.token === token &&
        at >= typingGroup.at && at - typingGroup.at < grouping!.windowMs && undoStack.length > 0;
      // A folded edit still installs its whole result, clears Redo and advances the revision;
      // only the undo snapshot is shared with the run it joins.
      if (!fold) push(undoStack, state);
      redoStack.length = 0;
      state = applied.value.after;
      serial = state.revision;
      typingGroup = !backwards && key !== null && at !== null && token !== null ? { key, token, at } : null;
      return ok(copy(applied.value));
    },
    insertParkedShots: (before, after) => {
      if (!same(state, before)) return fail('conflict', 'Pending append baseline changed');
      const result = pendingAddEdit(before, after);
      if (!result.ok) return result;
      push(undoStack, state);
      redoStack.length = 0; typingGroup = null;
      state = copy(after); serial = state.revision;
      return result;
    },
    undo: () => { typingGroup = null; return restore(undoStack, redoStack); },
    redo: () => { typingGroup = null; return restore(redoStack, undoStack); },
    undoDepth: () => undoStack.length,
    redoDepth: () => redoStack.length
  });
}
