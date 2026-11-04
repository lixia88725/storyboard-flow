import type {ProjectEditResultV1, ProjectV1, ResultV1} from '../../platform/contracts/refactorV1';
import {copy, fail, ok, same, validProject} from '../../project-files/contracts/projectModel';

/** Only the verified Main result can reach this edit. Build its permitted shape from
 * before to reject unrelated changes, including extra unowned images. */
export function pendingAddEdit(before: ProjectV1, after: ProjectV1): ResultV1<ProjectEditResultV1> {
  if (!validProject(after) || after.revision !== before.revision + 1)
    return fail('conflict', 'Pending append baseline or revision changed');
  const shots = after.parkedShots.slice(before.parkedShots.length);
  const ids = new Set(shots.map(s => s.id));
  const dialogues = after.dialogues.slice(before.dialogues.length);
  if (!shots.length || shots.some(s => Object.hasOwn(before.images, s.imageId)) || dialogues.some(d => !ids.has(d.shotId)))
    return fail('conflict', 'Pending append requires new shots and their own images/dialogues');
  const expected: ProjectV1 = {...before, revision: before.revision + 1, parkedShots: [...before.parkedShots, ...shots],
    dialogues: [...before.dialogues, ...dialogues],
    images: {...before.images, ...Object.fromEntries(shots.map(s => [s.imageId, after.images[s.imageId]]))}};
  if (!same(expected, after)) return fail('conflict', 'Pending append changed other project content');
  const changes = {imageIds: shots.map(s => s.imageId), shotIds: [...ids], membership:true, order:true,
    text:!!dialogues.length || shots.some(s => !!s.scriptText)};
  return ok(copy({before, after, changed:true, changes}));
}
