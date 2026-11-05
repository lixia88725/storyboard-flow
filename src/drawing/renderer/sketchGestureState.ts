/** The one definition of "this view still has an edit in flight". It is read on every gate
 * check, so it must stay a pure read of state - no canvases, no encoding. */
export type SketchGestureState = {
  isDrawing: boolean;
  draftStroke: boolean;
  pendingDraftStroke: boolean;
  selectionDraft: boolean;
  transformDraft: boolean;
  committingStrokes: number;
  pendingCommitted: number;
};

export const isSketchGestureUnsettled = (state: SketchGestureState) =>
  state.isDrawing || state.draftStroke || state.pendingDraftStroke || state.selectionDraft ||
  state.transformDraft || state.committingStrokes > 0 || state.pendingCommitted > 0;
