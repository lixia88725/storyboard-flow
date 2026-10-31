/** Document settings, independent of editable pixels. Omitted means off. */
export type FlowPresentation = { mode: 'expanded' | 'embedded'; dialogue: boolean };
export const MATTE_HEIGHT = 75;
export function validPresentation(value: unknown): value is FlowPresentation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v=value as Record<string,unknown>;
  return Object.keys(v).length===2 && Object.hasOwn(v,'mode') && Object.hasOwn(v,'dialogue') &&
    (v.mode==='expanded'||v.mode==='embedded') && typeof v.dialogue==='boolean';
}
