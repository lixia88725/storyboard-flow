import { describe, expect, it } from "vitest";
import {
  createMarqueeBox,
  marqueeViewportRect,
  marqueeDisplayedSelectionIds,
  marqueeSelectionClassChanges,
  marqueeEdgeScrollDelta,
  sameMarqueeSelection,
  shotIdsInMarqueeBox,
  updateMarqueeBox
} from "./storyboardMarquee";

describe("storyboard marquee helpers", () => {
  it("scrolls only when the pointer is near the viewport edge", () => {
    expect(marqueeEdgeScrollDelta({ pointerY: 20, viewportHeight: 800 })).toBe(-32);
    expect(marqueeEdgeScrollDelta({ pointerY: 400, viewportHeight: 800 })).toBe(0);
    expect(marqueeEdgeScrollDelta({ pointerY: 780, viewportHeight: 800 })).toBe(32);
  });

  it("keeps marquee hit testing in document coordinates after scrolling", () => {
    const started = createMarqueeBox({ clientX: 100, clientY: 100, scrollX: 0, scrollY: 0 });
    const moved = updateMarqueeBox(started, {
      clientX: 320,
      clientY: 760,
      scrollX: 0,
      scrollY: 520
    });

    expect(
      shotIdsInMarqueeBox(moved, [
        {
          shotId: "shot-above-original-viewport",
          rect: { left: 120, right: 300, top: 140, bottom: 300 }
        },
        {
          shotId: "shot-after-scroll",
          rect: { left: 120, right: 300, top: 980, bottom: 1140 }
        },
        {
          shotId: "outside-horizontal-range",
          rect: { left: 380, right: 520, top: 980, bottom: 1140 }
        }
      ])
    ).toEqual(["shot-above-original-viewport", "shot-after-scroll"]);
  });

  it("keeps the fixed marquee rectangle aligned with document coordinates after scrolling", () => {
    const started = createMarqueeBox({ clientX: 100, clientY: 100, scrollX: 0, scrollY: 0 });
    const moved = updateMarqueeBox(started, {
      clientX: 320,
      clientY: 760,
      scrollX: 0,
      scrollY: 520
    });

    expect(marqueeViewportRect(moved)).toEqual({
      left: 100,
      top: -420,
      width: 220,
      height: 1180
    });
  });

  it("compares marquee selections by ordered ids", () => {
    expect(sameMarqueeSelection(["shot-a", "shot-b"], ["shot-a", "shot-b"])).toBe(true);
    expect(sameMarqueeSelection(["shot-a", "shot-b"], ["shot-b", "shot-a"])).toBe(false);
    expect(sameMarqueeSelection(["shot-a"], ["shot-a", "shot-b"])).toBe(false);
  });

  it("matches storyboard card selection styling for marquee selections", () => {
    expect(marqueeDisplayedSelectionIds([])).toEqual([]);
    expect(marqueeDisplayedSelectionIds(["shot-a"])).toEqual([]);
    expect(marqueeDisplayedSelectionIds(["shot-a", "shot-b"])).toEqual(["shot-a", "shot-b"]);
  });

  it("returns only the storyboard card selection classes that changed", () => {
    expect(marqueeSelectionClassChanges(["shot-a", "shot-b"], ["shot-b", "shot-c"])).toEqual({
      add: ["shot-c"],
      remove: ["shot-a"]
    });
    expect(marqueeSelectionClassChanges(["shot-a"], ["shot-a", "shot-b"])).toEqual({
      add: ["shot-a", "shot-b"],
      remove: []
    });
    expect(marqueeSelectionClassChanges(["shot-a", "shot-b"], ["shot-c"])).toEqual({
      add: [],
      remove: ["shot-a", "shot-b"]
    });
  });
});
