import type { ChangeSetV1, ImageDocumentV1, ProjectEditResultV1, ProjectV1, ResultV1, ShotV1 } from '../../platform/contracts/refactorV1';
import { same, ok, revision, fail, positionChanges, copy, id } from '../../project-files/contracts/projectModel';

export const withPresentation=(shot:ShotV1,presentation:ShotV1['presentation']):ShotV1=>{const {presentation:_old,...rest}=shot;return {...rest,...(presentation?{presentation:copy(presentation)}:{})};};
export const imageVisual = (image: ImageDocumentV1): unknown => image.layers.map(({ id: layerId, kind, visible, opacity, blendMode, width, height, assetId }) =>
  ({ id: layerId, kind, visible, opacity, blendMode, width, height, assetId }));
export const emptyChanges = (): ChangeSetV1 => ({ imageIds: [], shotIds: [], text: false, order: false, membership: false });
export const result = (before: ProjectV1, after: ProjectV1, changes: ChangeSetV1): ResultV1<ProjectEditResultV1> => {
  const changed = !same(before, after);
  if (!changed) return ok({ before, after: before, changed: false, changes: emptyChanges() });
  if (!revision(before.revision + 1)) return fail('invalid-input', 'Project revision overflow');
  if (changes.order || changes.membership)
    changes.shotIds = positionChanges(before, after);
  return ok({ before, after: { ...after, revision: before.revision + 1 }, changed: true, changes });
};
export const validIds = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length > 0 &&
  Array.from(ids).every(id) && new Set(ids).size === ids.length;
