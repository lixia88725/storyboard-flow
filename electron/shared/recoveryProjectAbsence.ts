/** JSON/Markdown and History use omission for these known optional schema
 * paths. Transport must not erase unknown fields or reinterpret non-undefined
 * values (including null and malformed Pending state). Always clone privately. */
export const recoveryProjectAbsence = (raw: unknown, clone: (value: unknown) => unknown = structuredClone): unknown => {
  const project = clone(raw) as any;
  const omit = (object: any, keys: readonly string[]) => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) return;
    for (const key of keys) if (Object.prototype.hasOwnProperty.call(object, key) && object[key] === undefined) delete object[key];
  };
  omit(project, ['parkedShots', 'pendingDeletedShots']);
  for (const collection of ['shots', 'parkedShots']) {
    if (!Array.isArray(project?.[collection])) continue;
    for (const shot of project[collection]) {
      omit(shot, ['presentation', 'imageLayerEdits']);
      omit(shot?.swb, ['sourceKind']);
    }
  }
  return project;
};
