import type { FlowFailure, FlowResult, FlowSessionRequest } from '../../../electron/shared/flowWave2';

export const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value);
export const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
export const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const shape = (value: unknown, keys: string[], optional: string[] = []): value is Record<string, unknown> =>
  record(value) && keys.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => keys.includes(key) || optional.includes(key));
export const failure = <T>(code: FlowFailure['code'], message: string, effect: FlowFailure['effect'] = 'none'): FlowResult<T> =>
  ({ ok: false, error: { code, message, effect } });
export const copy = <T>(value: T): T => structuredClone(value);
export const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  if (!record(a) || !record(b)) return false;
  return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};
export const codes = ['invalid-input', 'not-found', 'locked', 'conflict', 'unsupported-version', 'missing-asset', 'io-failure', 'resource-limit', 'unavailable', 'busy', 'closed'];
export const validFailure = (value: unknown): value is FlowFailure => shape(value, ['code', 'message', 'effect']) &&
  typeof value.code === 'string' && codes.includes(value.code) && typeof value.message === 'string' && ['none', 'retained', 'unknown'].includes(value.effect as string);

export const snapshotRequest = (input: unknown): FlowResult<FlowSessionRequest> => {
  try {
    const value: unknown = copy(input);
    if (!record(value)) return failure('invalid-input', 'Request must be an object');
    switch (value.kind) {
      case 'board': {
        if (!shape(value, ['kind', 'command'])) break;
        const command = value.command;
        if (shape(command, ['kind', 'shotId', 'text']) && command.kind === 'setScriptText' && id(command.shotId) && typeof command.text === 'string')
          return { ok: true, value: value as FlowSessionRequest };
        if (shape(command, ['kind', 'shotId', 'dialogues']) && command.kind === 'setDialogues' && id(command.shotId) && Array.isArray(command.dialogues))
          return { ok: true, value: value as FlowSessionRequest };
        if (shape(command, ['kind', 'shotIds', 'destination'], ['beforeId']) && command.kind === 'moveShots' && command.destination === 'active' &&
            Array.isArray(command.shotIds) && command.shotIds.length > 0 && Array.from(command.shotIds).every(id) && new Set(command.shotIds).size === command.shotIds.length &&
            (!Object.hasOwn(command, 'beforeId') || id(command.beforeId))) return { ok: true, value: value as FlowSessionRequest };
        break;
      }
      case 'layer':
        if (shape(value, ['kind', 'shotId', 'edit']) && id(value.shotId) && record(value.edit) &&
            ['insertLayer', 'removeLayer', 'moveLayer', 'setLayer'].includes(value.edit.kind as string)) return { ok: true, value: value as FlowSessionRequest };
        break; // The real drawing Interface validates the full edit at execution.
      case 'paint': {
        if (!shape(value, ['kind', 'shotId', 'layerId', 'stroke']) || !id(value.shotId) || !id(value.layerId)) break;
        const stroke = value.stroke;
        if (!shape(stroke, ['tool', 'color', 'size', 'opacity', 'softness', 'points']) || !['brush', 'eraser'].includes(stroke.tool as string) ||
            typeof stroke.color !== 'string' || !/^#(?:[a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/.test(stroke.color) ||
            typeof stroke.size !== 'number' || !Number.isFinite(stroke.size) || stroke.size <= 0 ||
            typeof stroke.opacity !== 'number' || !Number.isFinite(stroke.opacity) || stroke.opacity < 0 || stroke.opacity > 1 ||
            typeof stroke.softness !== 'number' || !Number.isFinite(stroke.softness) || stroke.softness < 0 || stroke.softness > 1 ||
            !Array.isArray(stroke.points) || stroke.points.length < 2 || stroke.points.length % 2 !== 0 ||
            !Array.from(stroke.points).every(point => typeof point === 'number' && Number.isFinite(point))) break;
        return { ok: true, value: value as FlowSessionRequest };
      }
      case 'undo': case 'redo': case 'checkpoint': case 'freeze': case 'resume':
        if (shape(value, ['kind'])) return { ok: true, value: value as FlowSessionRequest };
    }
    return failure('invalid-input', 'Unsupported or malformed session request');
  } catch {
    return failure('invalid-input', 'Request could not be snapshotted');
  }
};
