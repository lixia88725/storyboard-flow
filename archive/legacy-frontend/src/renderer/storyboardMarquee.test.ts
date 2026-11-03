import { describe, expect, it } from "vitest";
import {
  createMarqueeBox,
  marqueeEdgeScrollDelta,
  marqueeHitsInBox,
  marqueeOverlayBoxRect,
  marqueeViewportRect,
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

  it("scrolls against the storyboard scroll viewport instead of the whole window", () => {
    expect(marqueeEdgeScrollDelta({ pointerY: 145, viewportTop: 120, viewportHeight: 500 })).toBe(-32);
    expect(marqueeEdgeScrollDelta({ pointerY: 400, viewportTop: 120, viewportHeight: 500 })).toBe(0);
    expect(marqueeEdgeScrollDelta({ pointerY: 595, viewportTop: 120, viewportHeight: 500 })).toBe(32);
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

  it("keeps the SVG box relative to the clipped workspace viewport", () => {
    const started = createMarqueeBox({
      clientX: 310,
      clientY: 260,
      scrollX: 0,
      scrollY: 0
    });
    const moved = updateMarqueeBox(started, {
      clientX: 120,
      clientY: 100,
      scrollX: 0,
      scrollY: 0
    });

    expect(marqueeOverlayBoxRect(moved, { left: 80, top: 60 })).toEqual({
      left: 40,
      top: 40,
      width: 190,
      height: 160
    });
  });

  it("returns hit ids and viewport-relative SVG rectangles in one traversal", () => {
    const box = updateMarqueeBox(
      createMarqueeBox({
        clientX: 100,
        clientY: 100,
        scrollX: 0,
        scrollY: 0
      }),
      {
        clientX: 320,
        clientY: 760,
        scrollX: 0,
        scrollY: 500
      }
    );

    expect(
      marqueeHitsInBox(
        box,
        [
          {
            shotId: "shot-a",
            rect: { left: 120, right: 300, top: 980, bottom: 1140 }
          },
          {
            shotId: "shot-outside",
            rect: { left: 400, right: 520, top: 980, bottom: 1140 }
          }
        ],
        { x: 0, y: 500 },
        { left: 80, top: 60 }
      )
    ).toEqual({
      shotIds: ["shot-a"],
      rects: [{ left: 40, top: 420, width: 180, height: 160 }]
    });
  });

});
