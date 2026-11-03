import { describe, expect, it, vi } from "vitest";
import {
  captureStoryboardZoomAnchor,
  restoreStoryboardZoomAnchor,
  storyboardZoomAnchorSafeScrollDelta,
  storyboardZoomAnchorScrollDelta
} from "./storyboardZoomAnchorController";

type TestRect = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

const rect = (left: number, top: number, width: number, height: number): TestRect => ({
  bottom: top + height,
  height,
  left,
  right: left + width,
  top,
  width
});

const shot = (shotId: string, getRect: () => TestRect) => ({
  dataset: { shotId },
  getBoundingClientRect: getRect,
  querySelector: () => ({ getBoundingClientRect: getRect })
});

const harness = ({
  clientPoint,
  selectedShotIds = ["shot-20"],
  shotRects
}: {
  clientPoint?: { x: number; y: number };
  selectedShotIds?: string[];
  shotRects: Array<{ id: string; value: TestRect }>;
}) => {
  const items = shotRects.map((item) => shot(item.id, () => item.value));
  const scrollBy = vi.fn();
  const board = {
    querySelectorAll: () => items
  };
  const scrollContainer = {
    getBoundingClientRect: () => rect(0, 0, 1000, 700),
    scrollBy
  };
  const anchor = captureStoryboardZoomAnchor({
    board,
    clientPoint,
    scrollContainer,
    selectedShotIds
  });
  return { anchor, board, scrollBy, scrollContainer };
};

describe("storyboard zoom anchor controller", () => {
  it("keeps the pointed detail inside any selected storyboard", () => {
    const { anchor } = harness({
      clientPoint: { x: 650, y: 250 },
      selectedShotIds: ["shot-20", "shot-21"],
      shotRects: [
        { id: "shot-20", value: rect(100, 100, 300, 200) },
        { id: "shot-21", value: rect(500, 100, 300, 200) }
      ]
    });

    expect(anchor).toEqual({
      shotId: "shot-21",
      localXRatio: 0.5,
      localYRatio: 0.75,
      clientX: 650,
      clientY: 250
    });
  });

  it("uses the primary selected picture center when the pointer is elsewhere", () => {
    const { anchor } = harness({
      clientPoint: { x: 900, y: 650 },
      shotRects: [
        { id: "shot-19", value: rect(100, 100, 300, 200) },
        { id: "shot-20", value: rect(500, 300, 300, 200) }
      ]
    });

    expect(anchor).toEqual({
      shotId: "shot-20",
      localXRatio: 0.5,
      localYRatio: 0.5,
      clientX: 650,
      clientY: 400
    });
  });

  it("falls back to the picture under the pointer when the old selection is offscreen", () => {
    const { anchor } = harness({
      clientPoint: { x: 250, y: 200 },
      shotRects: [
        { id: "shot-20", value: rect(100, 1400, 300, 200) },
        { id: "shot-8", value: rect(100, 100, 300, 200) }
      ]
    });

    expect(anchor?.shotId).toBe("shot-8");
    expect(anchor?.clientX).toBe(250);
    expect(anchor?.clientY).toBe(200);
  });

  it("falls back to the visible picture nearest the viewport center", () => {
    const { anchor } = harness({
      selectedShotIds: [],
      shotRects: [
        { id: "shot-1", value: rect(20, 20, 160, 100) },
        { id: "shot-12", value: rect(420, 280, 160, 100) },
        { id: "shot-30", value: rect(800, 580, 160, 100) }
      ]
    });

    expect(anchor?.shotId).toBe("shot-12");
  });

  it("computes both grid-reflow and row-height scroll compensation", () => {
    const anchor = {
      shotId: "shot-20",
      localXRatio: 0.25,
      localYRatio: 0.75,
      clientX: 300,
      clientY: 400
    };

    expect(storyboardZoomAnchorScrollDelta(anchor, rect(500, 700, 400, 300))).toEqual({
      left: 300,
      top: 525
    });
  });

  it("restores the same normalized picture point after consecutive layout changes", () => {
    let targetRect = rect(200, 160, 300, 200);
    const item = shot("shot-20", () => targetRect);
    const scrollBy = vi.fn(({ left = 0, top = 0 }: ScrollToOptions) => {
      targetRect = rect(
        targetRect.left - Number(left),
        targetRect.top - Number(top),
        targetRect.width,
        targetRect.height
      );
    });
    const board = { querySelectorAll: () => [item] };
    const scrollContainer = {
      getBoundingClientRect: () => rect(0, 0, 1000, 700),
      scrollBy
    };
    const anchor = captureStoryboardZoomAnchor({
      board,
      clientPoint: { x: 350, y: 260 },
      scrollContainer,
      selectedShotIds: ["shot-20"]
    });

    targetRect = rect(420, 480, 450, 300);
    restoreStoryboardZoomAnchor({ anchor, board, scrollContainer });
    targetRect = rect(60, 90, 225, 150);
    restoreStoryboardZoomAnchor({ anchor, board, scrollContainer });

    const finalDelta = anchor ? storyboardZoomAnchorScrollDelta(anchor, targetRect) : undefined;
    expect(scrollBy).toHaveBeenCalledTimes(2);
    expect(finalDelta?.left).toBeCloseTo(0);
    expect(finalDelta?.top).toBeCloseTo(0);
  });

  it("measures only the anchored picture while restoring a large board", () => {
    const targetRect = rect(240, 180, 300, 200);
    const target = shot("shot-20", vi.fn(() => targetRect));
    const unrelatedRect = vi.fn(() => rect(0, 0, 100, 100));
    const unrelatedShots = Array.from({ length: 100 }, (_, index) =>
      shot(`shot-${index + 100}`, unrelatedRect)
    );
    const querySelector = vi.fn(() => target);
    const board = {
      querySelector,
      querySelectorAll: vi.fn(() => unrelatedShots)
    };
    const scrollContainer = {
      getBoundingClientRect: () => rect(0, 0, 1000, 700),
      scrollBy: vi.fn()
    };

    restoreStoryboardZoomAnchor({
      anchor: {
        shotId: "shot-20",
        localXRatio: 0.5,
        localYRatio: 0.5,
        clientX: 390,
        clientY: 280
      },
      board,
      scrollContainer
    });

    expect(querySelector).toHaveBeenCalledTimes(2);
    expect(board.querySelectorAll).not.toHaveBeenCalled();
    expect(unrelatedRect).not.toHaveBeenCalled();
  });

  it("does not scroll for a missing anchor or subpixel drift", () => {
    const { board, scrollBy, scrollContainer } = harness({
      shotRects: [{ id: "shot-20", value: rect(100, 100, 300, 200) }]
    });

    expect(
      restoreStoryboardZoomAnchor({ anchor: undefined, board, scrollContainer })
    ).toBeUndefined();
    restoreStoryboardZoomAnchor({
      anchor: {
        shotId: "shot-20",
        localXRatio: 0.5,
        localYRatio: 0.5,
        clientX: 250.1,
        clientY: 200.1
      },
      board,
      scrollContainer
    });
    expect(scrollBy).not.toHaveBeenCalled();
  });

  it("clamps an unreachable anchor to the scroll viewport safe area", () => {
    const anchor = {
      shotId: "shot-20",
      localXRatio: 0.5,
      localYRatio: 0.5,
      clientX: 500,
      clientY: 350
    };
    expect(
      storyboardZoomAnchorSafeScrollDelta(
        anchor,
        rect(-120, 680, 200, 100),
        rect(0, 0, 1000, 700)
      )
    ).toEqual({ left: -36, top: 46 });
  });

  it("uses native scrolling twice when exact compensation is clamped outside the safe area", () => {
    const targetRect = rect(-120, 680, 200, 100);
    const item = shot("shot-20", () => targetRect);
    const scrollBy = vi.fn();
    const board = { querySelectorAll: () => [item] };
    const scrollContainer = {
      getBoundingClientRect: () => rect(0, 0, 1000, 700),
      scrollBy
    };

    restoreStoryboardZoomAnchor({
      anchor: {
        shotId: "shot-20",
        localXRatio: 0.5,
        localYRatio: 0.5,
        clientX: 500,
        clientY: 350
      },
      board,
      scrollContainer
    });

    expect(scrollBy).toHaveBeenNthCalledWith(1, {
      left: -520,
      top: 380,
      behavior: "auto"
    });
    expect(scrollBy).toHaveBeenNthCalledWith(2, {
      left: -36,
      top: 46,
      behavior: "auto"
    });
  });
});
