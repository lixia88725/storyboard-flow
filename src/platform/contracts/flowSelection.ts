/** Temporary pixel-tool geometry; never part of the persisted project format. */
export type FlowSelection = readonly { x: number; y: number }[];
export type FlowTransform = readonly [number, number, number, number, number, number];
const coordinate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1_000_000;
export function validSelection(value: unknown): value is FlowSelection {
  if (!Array.isArray(value) || value.length < 3 || value.length > 4096) return false;
  const points = Array.from(value);
  if (!points.every(p => p && Object.keys(p).length === 2 && coordinate(p.x) && coordinate(p.y))) return false;
  return Math.max(...points.map(p => p.x)) > Math.min(...points.map(p => p.x)) &&
    Math.max(...points.map(p => p.y)) > Math.min(...points.map(p => p.y));
}
export function validTransform(value: unknown): value is FlowTransform {
  return Array.isArray(value) && value.length === 6 && Array.from(value).every(coordinate) &&
    Math.abs(value[0] * value[3] - value[1] * value[2]) > 1e-12;
}
