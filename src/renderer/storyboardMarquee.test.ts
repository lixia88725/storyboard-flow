import { describe, expect, it } from "vitest";
import {
  createMarqueeBox,
  marqueeEdgeScrollDelta,
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
});
