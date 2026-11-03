import {validPresentation} from '../../platform/contracts/flowPresentation';
import { validRefreshTransition } from '../../platform/contracts/flowRefresh';
import type {
  ChangeSetV1, ImageDocumentV1, ImageEditResultV1, ProjectEditResultV1,
  ProjectV1, ResultV1, ShotV1, StoryboardEditV1
} from '../../platform/contracts/refactorV1';

import { own, record, shape, id, revision, text, fail, ok, copy, same, validImage, validProject, positionChanges } from '../../project-files/contracts/projectModel';
import { withPresentation, imageVisual, emptyChanges, result, validIds } from './internal';

export function applyStoryboardEdit(project: ProjectV1, edit: StoryboardEditV1): ResultV1<ProjectEditResultV1> {
  if (!record(project)) return fail('invalid-input', 'Invalid project');
  if (project.version !== 1 || project.schema !== 'storyboard-flow.project') return fail('unsupported-version', 'Unsupported project schema/version');
  if (!validProject(project) || !record(edit) || typeof edit.kind !== 'string') return fail('invalid-input', 'Invalid project or edit');
  const all = [...project.shots, ...project.parkedShots];
  const shot = (shotId: string) => all.find(s => s.id === shotId);
  const change = emptyChanges();
  switch (edit.kind) {
    case 'refreshImages': {
      if (!shape(edit, ['kind','before','after']) || !validProject(edit.before) || !validProject(edit.after) ||
          !same(project,edit.before) || !validRefreshTransition(project,edit.after)) return fail('conflict','Refresh baseline or transition is invalid');
      const after=copy(edit.after); after.revision=project.revision;
      change.imageIds=Object.keys(after.images).filter(id=>!same(project.images[id],after.images[id]));
      change.shotIds=[...after.shots,...after.parkedShots].filter(s=>change.imageIds.includes(s.imageId)).map(s=>s.id);
      change.membership=after.parkedShots.length!==project.parkedShots.length; change.order=change.membership;
      return result(project,after,change);
    }
    case 'insertShot': {
      if (!shape(edit, ['kind', 'shot', 'image', 'index']) ||
          !shape(edit.shot, ['id', 'imageId', 'name', 'scriptText']) || !id(edit.shot.id) || !id(edit.shot.imageId) ||
          !text(edit.shot.name) || !text(edit.shot.scriptText) || !validImage(edit.image) ||
          edit.image.id !== edit.shot.imageId || !Number.isSafeInteger(edit.index) || edit.index < 0 || edit.index > project.shots.length ||
          shot(edit.shot.id) || own(project.images, edit.image.id)) return fail('invalid-input', 'Invalid or duplicate shot/image or index');
      change.shotIds = [edit.shot.id]; change.imageIds = [edit.image.id]; change.membership = true; change.order = true;
      const shots = [...project.shots]; shots.splice(edit.index, 0, withPresentation(copy(edit.shot), project.presentation));
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
      destination.splice(index, 0, ...moving.map(s=>edit.destination==='active'?withPresentation(s,project.presentation):s));
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
    case 'setPresentation': {
      if(!shape(edit,['kind','presentation']) || (edit.presentation!==null && !validPresentation(edit.presentation)))return fail('invalid-input','Invalid presentation');
      const {presentation:_previous,...rest}=project;
      const presentation=edit.presentation??undefined;
      change.shotIds=project.shots.map(s=>s.id);
      return result(project,{...rest,...(presentation?{presentation:copy(presentation)}:{}),shots:project.shots.map(s=>withPresentation(s,presentation))},change);
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
