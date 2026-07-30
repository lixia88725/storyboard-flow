import { describe, expect, it, vi } from "vitest";
import {
  applySelectedShotCountLabel,
  storyboardMarqueeShotRectsFromDom
} from "./storyboardMarqueeDom";

const fakeShotElement = (
  shotId: string | undefined,
  rect: { left: number; right: number; top: number; bottom: number }
) => ({
  dataset: { shotId },
  getBoundingClientRect: vi.fn(() => rect)
});

describe("storyboardMarqueeDom", () => {
  it("reads each shot rect once and caches it in document coordinates", () => {
    const shotA = fakeShotElement("shot-a", {
      left: 10,
      right: 110,
      top: 20,
      bottom: 120
    });
    const shotWithoutId = fakeShotElement(undefined, {
      left: 0,
      right: 1,
      top: 0,
      bottom: 1
    });
    const board = {
      querySelectorAll: vi.fn(() => [shotA, shotWithoutId])
    };

    expect(
      storyboardMarqueeShotRectsFromDom(
        board as unknown as HTMLElement,
        { x: 5, y: 7 }
      )
    ).toEqual([
      {
        shotId: "shot-a",
        rect: { left: 15, right: 115, top: 27, bottom: 127 }
      }
    ]);
    expect(shotA.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(shotWithoutId.getBoundingClientRect).not.toHaveBeenCalled();
  });

  it("updates the selected count without a React board render", () => {
    const label = { textContent: "" };
    applySelectedShotCountLabel(label as HTMLSpanElement, 12);
    expect(label.textContent).toBe("12 selected");
  });
});
