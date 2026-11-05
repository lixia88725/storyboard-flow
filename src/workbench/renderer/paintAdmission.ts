export type PaintTool = 'brush' | 'eraser' | 'select' | 'blur' | 'eyedropper';

export type ContinuationState = {
  active: boolean;
  tool: PaintTool;
  outputWork: boolean;
  savingTiff: boolean;
  gesture: boolean;
  otherRequests: number;
  /** `shotId/layerId` of every paint still in flight at this moment. */
  queuedTargets: string[];
  target: string;
};

/** A second stroke may start while the previous paint is still in flight only when it
 * targets exactly the layer that paint belongs to and no other request is queued: the
 * session then applies both strokes in order, so the new stroke never edits a stale asset.
 * Brush and eraser share this contract; structural tools never take the shortcut. */
const toolAllowed = (state: ContinuationState): boolean =>
  state.tool === 'brush' ? (!state.outputWork || state.savingTiff) : state.tool === 'eraser' ? !state.outputWork : false;

export const canContinuePaint = (state: ContinuationState): boolean =>
  state.active
  && toolAllowed(state)
  && !state.gesture
  && state.queuedTargets.length > 0
  && state.otherRequests === 0
  && state.queuedTargets.every(key => key === state.target);
