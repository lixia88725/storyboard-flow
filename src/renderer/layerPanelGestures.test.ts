import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layerMergeAllowed, layerRowGestureEndEffects } from "./layerPanelGestures";

const panelSource = readFileSync(new URL("./LayerPanel.tsx", import.meta.url), "utf8");

describe("layerRowGestureEndEffects", () => {
  it("commits a single-layer opacity on a normal release", () => {
    expect(
      layerRowGestureEndEffects({
        intent: "opacity",
        cancelled: false,
        groupCallback: false,
        opacityCallback: true,
        opacity: 0.42
      })
    ).toEqual({ opacityPhase: "commit", reorder: false });
  });

  it("cancels a single-layer opacity instead of committing it", () => {
    const effects = layerRowGestureEndEffects({
      intent: "opacity",
      cancelled: true,
      groupCallback: false,
      opacityCallback: true,
      opacity: 0.42
    });

    expect(effects).toEqual({ opacityPhase: "cancel", reorder: false });
    expect(effects.opacityPhase).not.toBe("commit");
  });

  it("cancels a group opacity preview", () => {
    expect(
      layerRowGestureEndEffects({
        intent: "opacity",
        cancelled: true,
        groupCallback: true,
        opacityCallback: true,
        deltaOpacity: -0.2
      })
    ).toEqual({ groupOpacityPhase: "cancel", reorder: false });
  });

  it("commits a group opacity preview when the gesture completes", () => {
    expect(
      layerRowGestureEndEffects({
        intent: "opacity",
        cancelled: false,
        groupCallback: true,
        opacityCallback: true,
        deltaOpacity: 0.15
      })
    ).toEqual({ groupOpacityPhase: "commit", reorder: false });
  });

  it("never moves layers after a cancelled reorder", () => {
    expect(
      layerRowGestureEndEffects({
        intent: "reorder",
        cancelled: true,
        groupCallback: false,
        opacityCallback: true
      })
    ).toEqual({ reorder: false });
  });

  it("moves layers only when the reorder completed", () => {
    expect(
      layerRowGestureEndEffects({
        intent: "reorder",
        cancelled: false,
        groupCallback: false,
        opacityCallback: true
      })
    ).toEqual({ reorder: true });
  });

  it("emits nothing when the pointer never left the drag threshold", () => {
    expect(
      layerRowGestureEndEffects({
        intent: undefined,
        cancelled: false,
        groupCallback: true,
        opacityCallback: true
      })
    ).toEqual({ reorder: false });
  });

  it("keeps legacy immediate-write gestures free of phase reports", () => {
    expect(
      layerRowGestureEndEffects({
        intent: "opacity",
        cancelled: true,
        groupCallback: false,
        opacityCallback: false,
        opacity: 0.5
      })
    ).toEqual({ reorder: false });
  });
});

describe("layerMergeAllowed", () => {
  it("keeps the historic visible/locked policy when the host supplies no rule", () => {
    expect(layerMergeAllowed(["base", "ink"])).toBe(true);
  });

  it("lets the host veto a merge", () => {
    const canMergeLayerIds = (ids: string[]) => !ids.includes("locked-by-session");

    expect(layerMergeAllowed(["base", "ink"], canMergeLayerIds)).toBe(true);
    expect(layerMergeAllowed(["base", "locked-by-session"], canMergeLayerIds)).toBe(false);
  });

  it("treats an empty list as nothing to veto and never calls the host", () => {
    let called = 0;
    const canMergeLayerIds = () => {
      called += 1;
      return false;
    };

    expect(layerMergeAllowed([], canMergeLayerIds)).toBe(true);
    expect(called).toBe(0);
  });
});

describe("LayerPanel wiring", () => {
  it("reports the computed opacity phase instead of a hardcoded commit", () => {
    expect(panelSource).toContain("effects.opacityPhase");
    expect(panelSource).not.toContain('onLayerOpacityGesture(shot.id, gesture.layerId, gesture.opacity, "commit")');
  });

  it("registers teardown for every live gesture and clears it on pointer end", () => {
    expect(panelSource).toContain("cancelRowGestureRef.current = handleCancel");
    expect(panelSource).toContain('window.addEventListener("blur", handleCancel)');
    expect(panelSource).toContain('window.removeEventListener("blur", handleCancel)');
    expect(panelSource).toContain("cancelVisibilityDragRef.current");
    expect(panelSource).toContain('window.addEventListener("pointercancel", endVisibilityDrag)');
  });

  it("resolves the active layer by shot.activeLayerId in the dual-panel route", () => {
    expect(panelSource).toContain("respectActiveLayer");
    expect(panelSource).toContain("layer.id === shot.activeLayerId");
  });

  it("gates both merge buttons through the host rule", () => {
    expect(panelSource).toContain("mergeVisibleAllowed");
    expect(panelSource).toContain("mergeSelectionAllowed");
    expect(panelSource.match(/layerMergeAllowed\(/g)?.length).toBe(2);
  });
});
