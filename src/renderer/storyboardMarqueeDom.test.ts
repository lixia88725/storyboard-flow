import { describe, expect, it, vi } from "vitest";
import {
  applyMarqueeShotSelection,
  hideSelectionMarquee,
  showSelectionMarquee,
  storyboardMarqueeShotElementsFromDom,
  storyboardMarqueeShotRectsFromDom
} from "./storyboardMarqueeDom";
import type { MarqueeBox } from "./storyboardMarquee";

const fakeShotElement = (
  shotId: string | undefined,
  rect: { left: number; right: number; top: number; bottom: number }
) => ({
  dataset: { shotId },
  getBoundingClientRect: () => rect,
  classList: {
    add: vi.fn(),
    remove: vi.fn()
  }
});

describe("storyboardMarqueeDom", () => {
  it("reads marquee hit-test rects from storyboard DOM elements in document coordinates", () => {
    const shotA = fakeShotElement("shot-a", { left: 10, right: 110, top: 20, bottom: 120 });
    const shotWithoutId = fakeShotElement(undefined, { left: 0, right: 1, top: 0, bottom: 1 });
    const board = {
      querySelectorAll: vi.fn(() => [shotA, shotWithoutId])
    };

    expect(storyboardMarqueeShotRectsFromDom(board as unknown as HTMLElement, { x: 5, y: 7 })).toEqual([
      {
        shotId: "shot-a",
        rect: { left: 15, right: 115, top: 27, bottom: 127 }
      }
    ]);
  });

  it("indexes marquee shot elements by shot id", () => {
    const shotA = fakeShotElement("shot-a", { left: 0, right: 1, top: 0, bottom: 1 });
    const shotB = fakeShotElement("shot-b", { left: 0, right: 1, top: 0, bottom: 1 });
    const board = {
      querySelectorAll: vi.fn(() => [shotA, shotB])
    };

    expect(
      [...storyboardMarqueeShotElementsFromDom(board as unknown as HTMLElement).entries()].map(
        ([shotId, element]) => [shotId, element]
      )
    ).toEqual([
      ["shot-a", shotA],
      ["shot-b", shotB]
    ]);
  });

  it("applies only changed marquee selection classes", () => {
    const shotA = fakeShotElement("shot-a", { left: 0, right: 1, top: 0, bottom: 1 });
    const shotB = fakeShotElement("shot-b", { left: 0, right: 1, top: 0, bottom: 1 });
    const shotC = fakeShotElement("shot-c", { left: 0, right: 1, top: 0, bottom: 1 });
    const elements = new Map<string, HTMLElement>([
      ["shot-a", shotA as unknown as HTMLElement],
      ["shot-b", shotB as unknown as HTMLElement],
      ["shot-c", shotC as unknown as HTMLElement]
    ]);

    applyMarqueeShotSelection(elements, ["shot-a", "shot-b"], ["shot-b", "shot-c"]);

    expect(shotA.classList.remove).toHaveBeenCalledWith("is-marquee-selected");
    expect(shotB.classList.add).not.toHaveBeenCalled();
    expect(shotB.classList.remove).not.toHaveBeenCalled();
    expect(shotC.classList.add).toHaveBeenCalledWith("is-marquee-selected");
  });

  it("shows and hides the marquee overlay styles", () => {
    const classNames = new Set<string>();
    const style = new Map<string, string>();
    const element = {
      classList: {
        add: (className: string) => classNames.add(className),
        remove: (className: string) => classNames.delete(className)
      },
      style: {
        set transform(value: string) {
          style.set("transform", value);
        },
        get transform() {
          return style.get("transform") ?? "";
        },
        set width(value: string) {
          style.set("width", value);
        },
        get width() {
          return style.get("width") ?? "";
        },
        set height(value: string) {
          style.set("height", value);
        },
        get height() {
          return style.get("height") ?? "";
        },
        removeProperty: (property: string) => style.delete(property)
      }
    };
    const box: MarqueeBox = {
      startX: 10,
      startY: 20,
      currentX: 50,
      currentY: 70,
      startScrollX: 0,
      startScrollY: 0,
      currentScrollX: 0,
      currentScrollY: 0
    };

    showSelectionMarquee(element as unknown as HTMLDivElement, box);
    expect(classNames.has("is-active")).toBe(true);
    expect(style.get("transform")).toBe("translate3d(10px, 20px, 0)");
    expect(style.get("width")).toBe("40px");
    expect(style.get("height")).toBe("50px");

    hideSelectionMarquee(element as unknown as HTMLDivElement);
    expect(classNames.has("is-active")).toBe(false);
    expect(style.has("transform")).toBe(false);
    expect(style.has("width")).toBe(false);
    expect(style.has("height")).toBe(false);
  });
});
