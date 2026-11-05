import { describe, expect, it } from "vitest";
import { isSketchGestureUnsettled, type SketchGestureState } from "./sketchGestureState";
import {
  captureMountedCanvasCheckpoints, hasUnsettledMountedGesture, registerMountedCanvasCheckpoint
} from "./mountedCanvasRecoveryCapture";
import type { MountedCanvasCheckpoint } from "./mountedCanvasRecoveryCapture";

const idle: SketchGestureState = { isDrawing: false, draftStroke: false, pendingDraftStroke: false,
  selectionDraft: false, transformDraft: false, committingStrokes: 0, pendingCommitted: 0 };

describe("settled gesture predicate", () => {
  it("is settled only when every field is empty", () => {
    expect(isSketchGestureUnsettled(idle)).toBe(false);
  });

  // Each field on its own: the gate has to notice one in-flight edit, not just the common case.
  const flags: [keyof SketchGestureState, SketchGestureState][] = [
    ["isDrawing", { ...idle, isDrawing: true }],
    ["draftStroke", { ...idle, draftStroke: true }],
    ["pendingDraftStroke", { ...idle, pendingDraftStroke: true }],
    ["selectionDraft", { ...idle, selectionDraft: true }],
    ["transformDraft", { ...idle, transformDraft: true }],
    ["committingStrokes", { ...idle, committingStrokes: 1 }],
    ["pendingCommitted", { ...idle, pendingCommitted: 1 }]
  ];
  for (const [name, state] of flags) {
    it(`reports unsettled for ${name} alone`, () => {
      expect(isSketchGestureUnsettled(state)).toBe(true);
    });
  }
});

describe("mounted registry gate", () => {
  it("asks the cheap predicate and never builds a capture", () => {
    let captures = 0;
    const unregister = registerMountedCanvasCheckpoint(
      () => { captures++; throw new Error("capture must not run on a gate check"); },
      undefined,
      () => false
    );
    expect(hasUnsettledMountedGesture()).toBe(false);
    expect(captures).toBe(0);
    unregister();
  });

  it("reports unsettled from the predicate, and unregister stops asking", () => {
    let asked = 0;
    const unregister = registerMountedCanvasCheckpoint(
      () => { throw new Error("no capture"); },
      undefined,
      () => { asked++; return true; }
    );
    expect(hasUnsettledMountedGesture()).toBe(true);
    expect(asked).toBe(1);
    unregister();
    expect(hasUnsettledMountedGesture()).toBe(false);
    expect(asked).toBe(1);
  });

  it("filters by incarnation so another view's gesture does not block this one", () => {
    const first = {}, second = {};
    const off = registerMountedCanvasCheckpoint(
      () => { throw new Error("no capture"); }, first, () => true);
    const on = registerMountedCanvasCheckpoint(
      () => { throw new Error("no capture"); }, second, () => false);
    expect(hasUnsettledMountedGesture(first)).toBe(true);
    expect(hasUnsettledMountedGesture(second)).toBe(false);
    off(); on();
  });

  it("still builds a full capture for the recovery path", () => {
    const capture = (): MountedCanvasCheckpoint => ({ shotId: "shot", draft: null, selection: null,
      transform: null, pendingCommitted: null, liveLayers: [{ layerId: "ink", dataUrl: "data:image/png;base64,AA" }],
      hasUnsettledGesture: false });
    const unregister = registerMountedCanvasCheckpoint(capture);
    const { captures } = captureMountedCanvasCheckpoints();
    expect(captures).toHaveLength(1);
    expect(captures[0].liveLayers[0].layerId).toBe("ink");
    unregister();
  });
});
