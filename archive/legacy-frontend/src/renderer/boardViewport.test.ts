import { afterEach, describe, expect, it, vi } from "vitest";
import { boardViewportHeight, currentBoardScroll, scrollBoardBy } from "./boardViewport";

describe("boardViewport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads scroll position from the board scroll container when available", () => {
    expect(currentBoardScroll({ scrollLeft: 12, scrollTop: 34 })).toEqual({ x: 12, y: 34 });
  });

  it("falls back to window scroll and viewport height when no board scroll container exists", () => {
    vi.stubGlobal("window", {
      innerHeight: 640,
      scrollX: 5,
      scrollY: 8,
      scrollBy: vi.fn()
    });

    expect(currentBoardScroll(null)).toEqual({ x: 5, y: 8 });
    expect(boardViewportHeight(null)).toBe(640);
  });

  it("scrolls the board container before falling back to window scrolling", () => {
    const container = {
      clientHeight: 420,
      scrollBy: vi.fn(),
      scrollLeft: 0,
      scrollTop: 0
    };
    const windowScrollBy = vi.fn();
    vi.stubGlobal("window", {
      innerHeight: 640,
      scrollX: 0,
      scrollY: 0,
      scrollBy: windowScrollBy
    });
    const options = { top: 20, behavior: "instant" } as ScrollToOptions;

    scrollBoardBy(container, options);
    scrollBoardBy(null, options);

    expect(container.scrollBy).toHaveBeenCalledWith(options);
    expect(windowScrollBy).toHaveBeenCalledWith(options);
  });
});
