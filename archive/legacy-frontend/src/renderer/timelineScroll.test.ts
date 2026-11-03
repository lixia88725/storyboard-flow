import { describe, expect, it } from "vitest";

import { timelineScrollTarget } from "./timelineScroll";

describe("timeline scroll", () => {
  const containerRect = { left: 0, right: 1000, width: 1000 };

  it("does not scroll when the selected item is already visible", () => {
    expect(
      timelineScrollTarget({
        containerRect,
        itemRect: { left: 120, right: 220, width: 100 },
        scrollLeft: 300
      })
    ).toBeUndefined();
  });

  it("scrolls right when the selected item is hidden past the right edge", () => {
    const target = timelineScrollTarget({
      containerRect,
      itemRect: { left: 1060, right: 1160, width: 100 },
      scrollLeft: 700
    });

    expect(target).toBeGreaterThan(700);
    expect(target).toBe(1310);
  });

  it("scrolls left when the selected item is hidden before the left edge", () => {
    const target = timelineScrollTarget({
      containerRect,
      itemRect: { left: -160, right: -60, width: 100 },
      scrollLeft: 700
    });

    expect(target).toBeLessThan(700);
    expect(target).toBe(90);
  });

  it("keeps far-right storyboard items inside the scrollable range", () => {
    expect(
      timelineScrollTarget({
        containerRect,
        itemRect: { left: 1880, right: 1980, width: 100 },
        scrollLeft: 1500,
        maxScrollLeft: 1600
      })
    ).toBe(1600);
  });
});
