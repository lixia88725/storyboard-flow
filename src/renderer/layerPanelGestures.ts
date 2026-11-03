import type { LayerRowDragIntent } from "./sketchGeometry";

/** Single-layer opacity reporting gained a cancel phase alongside the group gesture's. */
export type LayerOpacityPhase = "preview" | "commit" | "cancel";

export type LayerRowGestureEndInput = {
  intent: LayerRowDragIntent | undefined;
  /** pointercancel, window blur, panel close, shot switch or unmount. */
  cancelled: boolean;
  /** A multi-layer opacity preview is live and owned by the group callback. */
  groupCallback: boolean;
  /** The single-layer opacity callback can roll a preview back on cancel. */
  opacityCallback: boolean;
  opacity?: number;
  deltaOpacity?: number;
};

export type LayerRowGestureEndEffects = {
  /** Emit preview rollback or commit for the single layer. */
  opacityPhase?: "commit" | "cancel";
  /** Emit preview rollback or commit for the whole selected group. */
  groupOpacityPhase?: "commit" | "cancel";
  /** Only a completed reorder may move layers; a cancelled one must stay put. */
  reorder: boolean;
};

/**
 * One rule set for pointer-up and for teardown (blur, close, shot switch, unmount),
 * so a cancelled gesture can never commit opacity or move layers.
 */
export const layerRowGestureEndEffects = (
  input: LayerRowGestureEndInput
): LayerRowGestureEndEffects => {
  const phase = input.cancelled ? "cancel" : "commit";

  if (input.intent === "opacity") {
    if (input.groupCallback && input.deltaOpacity !== undefined) {
      return { groupOpacityPhase: phase, reorder: false };
    }
    if (input.opacityCallback && input.opacity !== undefined) {
      return { opacityPhase: phase, reorder: false };
    }
    return { reorder: false };
  }

  if (input.intent === "reorder") {
    return { reorder: !input.cancelled };
  }

  return { reorder: false };
};

/**
 * Optional host gate for merge buttons. Without a rule the historic policy stands:
 * the existing visible/unlocked/selection conditions decide alone.
 */
export const layerMergeAllowed = (
  layerIds: readonly string[],
  canMergeLayerIds?: (layerIds: string[]) => boolean
): boolean => {
  if (layerIds.length === 0) {
    return true;
  }
  return canMergeLayerIds ? canMergeLayerIds([...layerIds]) : true;
};
