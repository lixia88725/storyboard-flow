import type {
  ChangeSetV1, ImageDocumentV1, ImageEditResultV1, ProjectEditResultV1,
  ProjectV1, ResultV1, ShotV1, StoryboardEditV1
} from '../../../electron/shared/refactorV1';

const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
const assetPattern = /^[a-f0-9]{64}$/;
const own = (v: object, k: string) => Object.prototype.hasOwnProperty.call(v, k);
const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const shape = (v: unknown, keys: readonly string[], optional: readonly string[] = []): v is Record<string, unknown> =>
  record(v) && Object.keys(v).every(k => keys.includes(k) || optional.includes(k)) && keys.every(k => own(v, k));
const id = (v: unknown): v is string => typeof v === 'string' && idPattern.test(v);
const revision = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const dimension = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0;
const text = (v: unknown): v is string => typeof v === 'string';
const fail = <T>(code: 'invalid-input' | 'not-found' | 'conflict' | 'unsupported-version', message: string): ResultV1<T> =>
  ({ ok: false, error: { code, message } });
const ok = <T>(value: T): ResultV1<T> => ({ ok: true, value });
const copy = <T>(v: T): T => structuredClone(v);
// JSON-shaped domain values only. Key order is not part of image identity.
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (!record(a) || !record(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(k => own(b, k) && same(a[k], b[k]));
};
const validImage = (image: unknown): image is ImageDocumentV1 => {
  if (!shape(image, ['id', 'revision', 'width', 'height', 'layers']) || !id(image.id) || !revision(image.revision) ||
      !dimension(image.width) || !dimension(image.height) || !Array.isArray(image.layers) || image.layers.length === 0) return false;
  const ids = new Set<string>();
  return Array.from(image.layers).every(layer => {
    if (!shape(layer, ['id', 'name', 'kind', 'visible', 'locked', 'opacity', 'blendMode', 'width', 'height', 'assetId']) ||
        !id(layer.id) || ids.has(layer.id) || !text(layer.name) || !['image', 'paint'].includes(layer.kind as string) ||
        typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' ||
        typeof layer.opacity !== 'number' || !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 ||
        !['normal', 'multiply', 'screen'].includes(layer.blendMode as string) ||
        layer.width !== image.width || layer.height !== image.height ||
        typeof layer.assetId !== 'string' || !assetPattern.test(layer.assetId)) return false;
    ids.add(layer.id);
    return true;
  });
};
const validProject = (project: unknown): project is ProjectV1 => {
  if (!shape(project, ['schema', 'version', 'id', 'revision', 'name', 'shots', 'parkedShots', 'dialogues', 'images'], ['naming']) ||
      project.schema !== 'storyboard-flow.project' || project.version !== 1 || !id(project.id) ||
      !revision(project.revision) || !text(project.name) || !Array.isArray(project.shots) ||
      !Array.isArray(project.parkedShots) || !Array.isArray(project.dialogues) || !record(project.images)) return false;
  if (own(project, 'naming') && (!shape(project.naming, ['sceneCode', 'artistName', 'version']) || !Object.values(project.naming).every(text))) return false;
  const shotIds = new Set<string>();
  const imageIds = new Set<string>();
  for (const shot of [...project.shots, ...project.parkedShots]) {
    if (!shape(shot, ['id', 'imageId', 'name', 'scriptText']) || !id(shot.id) || shotIds.has(shot.id) ||
        !id(shot.imageId) || imageIds.has(shot.imageId) || !text(shot.name) || !text(shot.scriptText)) return false;
    shotIds.add(shot.id);
    imageIds.add(shot.imageId);
  }
  for (const [key, image] of Object.entries(project.images)) {
    if (!id(key) || !validImage(image) || image.id !== key) return false;
  }
  if ([...imageIds].some(imageId => !own(project.images as Record<string, unknown>, imageId))) return false;
  const dialogueIds = new Set<string>();
  for (const dialogue of project.dialogues) {
    if (!shape(dialogue, ['id', 'shotId', 'text']) || !id(dialogue.id) || dialogueIds.has(dialogue.id) ||
        !id(dialogue.shotId) || !shotIds.has(dialogue.shotId) || !text(dialogue.text)) return false;
    dialogueIds.add(dialogue.id);
  }
  return true;
};
const imageVisual = (image: ImageDocumentV1): unknown => image.layers.map(({ id: layerId, kind, visible, opacity, blendMode, width, height, assetId }) =>
  ({ id: layerId, kind, visible, opacity, blendMode, width, height, assetId }));
const emptyChanges = (): ChangeSetV1 => ({ imageIds: [], shotIds: [], text: false, order: false, membership: false });
// Affected order means the shot's (active|pending, index) changed. Enumerate the
// resulting active order then Pending order, followed by removed IDs in old order.
const positionChanges = (before: ProjectV1, after: ProjectV1): string[] => {
  const positions = (project: ProjectV1): Map<string, string> => new Map([
    ...project.shots.map((shot, index) => [shot.id, `active:${index}`] as const),
    ...project.parkedShots.map((shot, index) => [shot.id, `pending:${index}`] as const)
  ]);
  const old = positions(before), next = positions(after);
  return [...new Set([...next.keys(), ...old.keys()])].filter(shotId => old.get(shotId) !== next.get(shotId));
};
const result = (before: ProjectV1, after: ProjectV1, changes: ChangeSetV1): ResultV1<ProjectEditResultV1> => {
  const changed = !same(before, after);
  if (!changed) return ok({ before, after: before, changed: false, changes: emptyChanges() });
  if (!revision(before.revision + 1)) return fail('invalid-input', 'Project revision overflow');
  if (changes.order || changes.membership)
    changes.shotIds = positionChanges(before, after);
  return ok({ before, after: { ...after, revision: before.revision + 1 }, changed: true, changes });
};
const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length > 0 &&
  Array.from(ids).every(id) && new Set(ids).size === ids.length;

export function applyStoryboardEdit(project: ProjectV1, edit: StoryboardEditV1): ResultV1<ProjectEditResultV1> {
  if (!record(project)) return fail('invalid-input', 'Invalid project');
  if (project.version !== 1 || project.schema !== 'storyboard-flow.project') return fail('unsupported-version', 'Unsupported project schema/version');
  if (!validProject(project) || !record(edit) || typeof edit.kind !== 'string') return fail('invalid-input', 'Invalid project or edit');
  const all = [...project.shots, ...project.parkedShots];
  const shot = (shotId: string) => all.find(s => s.id === shotId);
  const change = emptyChanges();
  switch (edit.kind) {
    case 'insertShot': {
      if (!shape(edit, ['kind', 'shot', 'image', 'index']) ||
          !shape(edit.shot, ['id', 'imageId', 'name', 'scriptText']) || !id(edit.shot.id) || !id(edit.shot.imageId) ||
          !text(edit.shot.name) || !text(edit.shot.scriptText) || !validImage(edit.image) ||
          edit.image.id !== edit.shot.imageId || !Number.isSafeInteger(edit.index) || edit.index < 0 || edit.index > project.shots.length ||
          shot(edit.shot.id) || own(project.images, edit.image.id)) return fail('invalid-input', 'Invalid or duplicate shot/image or index');
      change.shotIds = [edit.shot.id]; change.imageIds = [edit.image.id]; change.membership = true; change.order = true;
      const shots = [...project.shots]; shots.splice(edit.index, 0, copy(edit.shot));
      return result(project, { ...project, shots, images: { ...project.images, [edit.image.id]: copy(edit.image) } }, change);
    }
    case 'moveShots': {
      if (!shape(edit, ['kind', 'shotIds', 'destination'], ['beforeId']) || !validIds(edit.shotIds) ||
          !['active', 'pending'].includes(edit.destination) || edit.shotIds.some(id => !shot(id))) return fail('invalid-input', 'Invalid shot selection/destination');
      const selected = new Set(edit.shotIds);
      const target = edit.destination === 'active' ? project.shots : project.parkedShots;
      if (own(edit, 'beforeId') && (!id(edit.beforeId) || selected.has(edit.beforeId) || !target.some(s => s.id === edit.beforeId)))
        return fail('invalid-input', 'Invalid destination anchor');
      const moving = all.filter(s => selected.has(s.id));
      const active = project.shots.filter(s => !selected.has(s.id));
      const pending = project.parkedShots.filter(s => !selected.has(s.id));
      const destination = edit.destination === 'active' ? active : pending;
      const index = edit.beforeId === undefined ? destination.length : destination.findIndex(s => s.id === edit.beforeId);
      destination.splice(index, 0, ...moving);
      change.shotIds = moving.map(s => s.id);
      change.membership = moving.some(s => (project.shots.includes(s)) !== (edit.destination === 'active'));
      change.order = !same(active.map(s => s.id), project.shots.map(s => s.id)) || !same(pending.map(s => s.id), project.parkedShots.map(s => s.id));
      return result(project, { ...project, shots: active, parkedShots: pending }, change);
    }
    case 'removeShots': {
      if (!shape(edit, ['kind', 'shotIds']) || !validIds(edit.shotIds) || edit.shotIds.some(id => !shot(id))) return fail('invalid-input', 'Invalid shot selection');
      const selected = new Set(edit.shotIds);
      change.shotIds = all.filter(s => selected.has(s.id)).map(s => s.id); change.membership = true; change.order = true;
      change.text = project.dialogues.some(d => selected.has(d.shotId));
      return result(project, { ...project, shots: project.shots.filter(s => !selected.has(s.id)),
        parkedShots: project.parkedShots.filter(s => !selected.has(s.id)),
        dialogues: project.dialogues.filter(d => !selected.has(d.shotId)) }, change);
    }
    case 'moveDialogues': {
      if (!shape(edit, ['kind', 'dialogueIds', 'targetShotId'], ['beforeId']) || !validIds(edit.dialogueIds) ||
          !id(edit.targetShotId) || !project.shots.some(s => s.id === edit.targetShotId))
        return fail('invalid-input', 'Invalid dialogue selection or active target');
      const selected = new Set(edit.dialogueIds);
      const moving = project.dialogues.filter(d => selected.has(d.id));
      if (moving.length !== selected.size || moving.some(d => !project.shots.some(s => s.id === d.shotId)))
        return fail('invalid-input', 'Dialogue selection must belong to active shots');
      const target = project.dialogues.filter(d => d.shotId === edit.targetShotId);
      if (own(edit, 'beforeId') && (!id(edit.beforeId) || selected.has(edit.beforeId) || !target.some(d => d.id === edit.beforeId)))
        return fail('invalid-input', 'Invalid dialogue destination anchor');
      const rest = project.dialogues.filter(d => !selected.has(d.id));
      const remainingTarget = rest.filter(d => d.shotId === edit.targetShotId);
      const ordered = moving.map(d => ({ ...d, shotId: edit.targetShotId }));
      const targetOrder = [...remainingTarget];
      targetOrder.splice(edit.beforeId === undefined ? targetOrder.length : targetOrder.findIndex(d => d.id === edit.beforeId), 0, ...ordered);
      if (moving.every(d => d.shotId === edit.targetShotId) && same(target, targetOrder)) return result(project, project, change);
      let index = edit.beforeId === undefined
        ? (remainingTarget.length ? rest.findIndex(d => d.id === remainingTarget[remainingTarget.length - 1].id) + 1 : rest.length)
        : rest.findIndex(d => d.id === edit.beforeId);
      rest.splice(index, 0, ...ordered);
      change.shotIds = [...new Set([...moving.map(d => d.shotId), edit.targetShotId])]; change.text = true;
      return result(project, { ...project, dialogues: rest }, change);
    }
    case 'setProjectNaming': {
      if (!shape(edit, ['kind', 'name', 'naming']) || !text(edit.name) || !shape(edit.naming, ['sceneCode', 'artistName', 'version']) || !Object.values(edit.naming).every(text)) return fail('invalid-input', 'Invalid naming settings');
      change.text = true;
      return result(project, { ...project, name: edit.name, naming: { ...edit.naming } }, change);
    }
    case 'setScriptText': {
      if (!shape(edit, ['kind', 'shotId', 'text']) || !id(edit.shotId) || !text(edit.text)) return fail('invalid-input', 'Invalid script edit');
      if (!shot(edit.shotId)) return fail('not-found', 'Shot not found');
      change.shotIds = [edit.shotId]; change.text = true;
      const update = (s: ShotV1) => s.id === edit.shotId && s.scriptText !== edit.text ? { ...s, scriptText: edit.text } : s;
      return result(project, { ...project, shots: project.shots.map(update), parkedShots: project.parkedShots.map(update) }, change);
    }
    case 'setDialogues': {
      if (!shape(edit, ['kind', 'shotId', 'dialogues']) || !id(edit.shotId) || !Array.isArray(edit.dialogues)) return fail('invalid-input', 'Invalid dialogue edit');
      if (!shot(edit.shotId)) return fail('not-found', 'Shot not found');
      const existing = new Set(project.dialogues.filter(d => d.shotId !== edit.shotId).map(d => d.id));
      const incoming = new Set<string>();
      for (const d of edit.dialogues) {
        if (!shape(d, ['id', 'shotId', 'text']) || !id(d.id) || d.shotId !== edit.shotId || !text(d.text) || existing.has(d.id) || incoming.has(d.id))
          return fail('invalid-input', 'Invalid or colliding dialogue ID');
        incoming.add(d.id);
      }
      if (same(project.dialogues.filter(d => d.shotId === edit.shotId), edit.dialogues))
        return result(project, project, emptyChanges());
      const first = project.dialogues.findIndex(d => d.shotId === edit.shotId);
      const dialogues = project.dialogues.filter(d => d.shotId !== edit.shotId);
      dialogues.splice(first < 0 ? dialogues.length : first, 0, ...copy(edit.dialogues));
      change.shotIds = [edit.shotId]; change.text = true;
      return result(project, { ...project, dialogues }, change);
    }
    case 'applyImageEdit': {
      if (!shape(edit, ['kind', 'result']) || !shape(edit.result, ['before', 'after', 'changed', 'visualChanged'])) return fail('invalid-input', 'Invalid image result');
      const r = edit.result as ImageEditResultV1;
      if (!validImage(r.before) || !validImage(r.after) || typeof r.changed !== 'boolean' || typeof r.visualChanged !== 'boolean' || r.before.id !== r.after.id)
        return fail('invalid-input', 'Invalid image result contents');
      const current = project.images[r.before.id];
      if (!current) return fail('not-found', 'Image not found');
      if (!same(current, r.before)) return fail('conflict', 'Image baseline differs from installed content');
      const changed = !same({ ...r.before, revision: 0 }, { ...r.after, revision: 0 });
      const visualChanged = !same(imageVisual(r.before), imageVisual(r.after));
      if (r.changed !== changed || r.visualChanged !== visualChanged || r.after.revision !== r.before.revision + (changed ? 1 : 0) ||
          !revision(r.after.revision)) return fail('invalid-input', 'Image flags or revision contradict content');
      const owners = all.filter(s => s.imageId === r.before.id);
      if (owners.length !== 1) return fail('invalid-input', 'Image must belong to exactly one shot');
      change.imageIds = [r.before.id]; change.shotIds = [owners[0].id];
      return result(project, changed ? { ...project, images: { ...project.images, [r.before.id]: copy(r.after) } } : project, change);
    }
    default: return fail('invalid-input', 'Unknown edit kind');
  }
}

/** Closest preceding active shot first; never includes parked shots or the current shot. */
export function precedingActiveImages(project: ProjectV1, shotId: string, count: number): ResultV1<string[]> {
  if (!validProject(project) || !id(shotId) || !Number.isSafeInteger(count) || count < 0) return fail('invalid-input', 'Invalid preview request');
  const index = project.shots.findIndex(s => s.id === shotId);
  if (index < 0) return fail('not-found', 'Active shot not found');
  return ok(project.shots.slice(Math.max(0, index - count), index).reverse().map(s => s.imageId));
}

export interface ProjectHistoryV1 {
  current(): ResultV1<ProjectV1>;
  apply(edit: StoryboardEditV1): ResultV1<ProjectEditResultV1>;
  undo(): ResultV1<ProjectEditResultV1>;
  redo(): ResultV1<ProjectEditResultV1>;
}

export function createProjectHistory(project: ProjectV1, options: { maxEntries: number }): ResultV1<ProjectHistoryV1> {
  if (!validProject(project) || !options || !Number.isSafeInteger(options.maxEntries) || options.maxEntries < 1)
    return fail('invalid-input', 'Invalid initial project or history capacity');
  let state = copy(project);
  let serial = state.revision;
  const undoStack: ProjectV1[] = [];
  const redoStack: ProjectV1[] = [];
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
    apply: edit => {
      const applied = applyStoryboardEdit(state, edit);
      if (!applied.ok || !applied.value.changed) return applied.ok ? ok(copy(applied.value)) : applied;
      push(undoStack, state);
      redoStack.length = 0;
      state = applied.value.after;
      serial = state.revision;
      return ok(copy(applied.value));
    },
    undo: () => restore(undoStack, redoStack),
    redo: () => restore(redoStack, undoStack)
  });
}
