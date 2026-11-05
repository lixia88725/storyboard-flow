export type MountedCanvasCheckpoint = {
  folderPath?: string; shotId: string; pointerId?: number;
  draft: unknown; selection: unknown; transform: unknown; pendingCommitted: unknown;
  liveLayers: { layerId: string; dataUrl: string }[];
  transformPixels?: string;
  hasUnsettledGesture: boolean;
};
const mounted = new Map<object, { incarnation?: object; capture: () => MountedCanvasCheckpoint; unsettled?: () => boolean }>();
/** All mounted views register their actual refs. Captures are detached content only.
 * This does NOT certify off-mount coverage, composed brush pixels, or durable retention. */
export const registerMountedCanvasCheckpoint = (
  capture: () => MountedCanvasCheckpoint,
  incarnation?: object,
  unsettled?: () => boolean
) => {
  const id = {};
  mounted.set(id, { capture, incarnation, unsettled });
  return () => { mounted.delete(id); };
};
/** Cheap gate query: asks each mounted view for its gesture flag without capturing or
 * cloning anything. Full captures encode the live layer canvases, so they must stay on the
 * recovery path only - never on a boolean check that runs on every pointerdown. */
export const hasUnsettledMountedGesture = (incarnation?: object) => {
  for (const view of mounted.values()) {
    if (incarnation && view.incarnation !== incarnation) continue;
    const unsettled = view.unsettled ? view.unsettled() : view.capture().hasUnsettledGesture;
    if (unsettled) return true;
  }
  return false;
};

export const captureMountedCanvasCheckpoints = (incarnation?: object) => {
  const captures = [...mounted.values()].filter(v => !incarnation || v.incarnation === incarnation).map(v => structuredClone(v.capture()));
  return { captures, hasUnsettledGesture: captures.some(c => c.hasUnsettledGesture) };
};
