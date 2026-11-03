import { describe, expect, it } from "vitest";
import {
  measurePasteAnimationRects,
  pasteAnimationIdForElement,
  pasteAnimationSelector,
  queuePasteAnimation
} from "./pasteAnimationController";

const elementWithDataset = (
  dataset: { shotId?: string; layerId?: string },
  rect: DOMRect
): HTMLElement =>
  ({
    dataset,
    getBoundingClientRect: () => rect
  }) as HTMLElement;

const rect = (left = 0, top = 0, width = 0, height = 0): DOMRect =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height
  }) as DOMRect;

describe("pasteAnimationController", () => {
  it("targets storyboard cards and layer rows by paste animation kind", () => {
    expect(pasteAnimationSelector("shot")).toBe("[data-shot-id]");
    expect(pasteAnimationSelector("layer")).toBe("[data-layer-id]");
    expect(
      pasteAnimationIdForElement(elementWithDataset({ shotId: "shot-1", layerId: "layer-1" }, rect()), "shot")
    ).toBe("shot-1");
    expect(
      pasteAnimationIdForElement(elementWithDataset({ shotId: "shot-1", layerId: "layer-1" }, rect()), "layer")
    ).toBe("layer-1");
  });

  it("measures only elements with an id for the requested paste animation kind", () => {
    const shotRect = rect(10, 20, 100, 200);
    const root = {
      querySelectorAll: (selector: string) => {
        expect(selector).toBe("[data-shot-id]");
        return [
          elementWithDataset({ shotId: "shot-1" }, shotRect),
          elementWithDataset({}, rect())
        ];
      }
    };

    const rects = measurePasteAnimationRects("shot", root);
    expect(Array.from(rects.keys())).toEqual(["shot-1"]);
    expect(rects.get("shot-1")).toBe(shotRect);
  });

  it("queues a paste animation after clearing any pending animation state", () => {
    const beforeRects = new Map([["source-shot", rect(10, 20, 100, 200)]]);
    const animationRef = { current: undefined };
    const frameRef = { current: 12 };
    const timeoutRef = { current: 34 };
    const cleared: string[] = [];

    queuePasteAnimation({
      animationRef,
      clearAnimation: (frame, timeout) => {
        expect(frame).toBe(frameRef);
        expect(timeout).toBe(timeoutRef);
        cleared.push("cleared");
      },
      frameRef,
      kind: "shot",
      measureRects: (kind) => {
        expect(kind).toBe("shot");
        return beforeRects;
      },
      pastedId: "pasted-shot",
      sourceId: "source-shot",
      timeoutRef
    });

    expect(cleared).toEqual(["cleared"]);
    expect(animationRef.current).toEqual({
      kind: "shot",
      sourceId: "source-shot",
      pastedId: "pasted-shot",
      beforeRects
    });
  });
});
