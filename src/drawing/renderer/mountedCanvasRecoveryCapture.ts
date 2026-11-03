export type MountedCanvasCheckpoint = {
  folderPath?: string; shotId: string; pointerId?: number;
  draft: unknown; selection: unknown; transform: unknown; pendingCommitted: unknown;
  liveLayers: { layerId: string; dataUrl: string }[];
  transformPixels?: string;
  hasUnsettledGesture: boolean;
};
const mounted = new Map<object, { incarnation?: object; capture: () => MountedCanvasCheckpoint }>();
/** All mounted views register their actual refs. Captures are detached content only.
 * This does NOT certify off-mount coverage, composed brush pixels, or durable retention. */
export const registerMountedCanvasCheckpoint = (capture: () => MountedCanvasCheckpoint, incarnation?: object) => {
  const id = {};
  mounted.set(id, { capture, incarnation });
  return () => { mounted.delete(id); };
};
export const captureMountedCanvasCheckpoints = (incarnation?: object) => {
  const captures = [...mounted.values()].filter(v => !incarnation || v.incarnation === incarnation).map(v => structuredClone(v.capture()));
  return { captures, hasUnsettledGesture: captures.some(c => c.hasUnsettledGesture) };
};
