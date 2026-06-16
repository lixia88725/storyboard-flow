import { describe, expect, it, vi } from "vitest";
import { startStoryboardMarqueeSelection } from "./storyboardMarqueeController";
import type { DeleteTarget } from "./deleteTarget";

const fakeElement = (shotId: string, rect: { left: number; right: number; top: number; bottom: number }) => ({
  dataset: { shotId },
  getBoundingClientRect: () => rect,
  classList: {
    add: vi.fn(),
    remove: vi.fn()
  }
});

const fakeMarqueeElement = () => {
  const classNames = new Set<string>();
  const styles = new Map<string, string>();
  return {
    classList: {
      add: (className: string) => classNames.add(className),
      remove: (className: string) => classNames.delete(className)
    },
    style: {
      set transform(value: string) {
        styles.set("transform", value);
      },
      get transform() {
        return styles.get("transform") ?? "";
      },
      set width(value: string) {
        styles.set("width", value);
      },
      get width() {
        return styles.get("width") ?? "";
      },
      set height(value: string) {
        styles.set("height", value);
      },
      get height() {
        return styles.get("height") ?? "";
      },
      removeProperty: (property: string) => styles.delete(property)
    },
    classNames,
    styles
  };
};

describe("storyboardMarqueeController", () => {
  it("tracks marquee selection during drag and commits it on pointer up", () => {
    const shotA = fakeElement("shot-a", { left: 10, right: 110, top: 10, bottom: 110 });
    const shotB = fakeElement("shot-b", { left: 10, right: 110, top: 120, bottom: 220 });
    const boardClassNames = new Set<string>();
    const board = {
      classList: {
        add: (className: string) => boardClassNames.add(className),
        remove: (className: string) => boardClassNames.delete(className)
      },
      querySelectorAll: vi.fn(() => [shotA, shotB])
    };
    const label = { textContent: "" };
    const marquee = fakeMarqueeElement();
    const selectedShotIdsRef = { current: ["shot-before"] };
    const shotSelectionAnchorIdRef = { current: "shot-before" as string | undefined };
    const deleteTargetRef = {
      current: { type: "layer", shotId: "shot-before", layerId: "layer-1" } as DeleteTarget
    };
    const setDeleteTarget = vi.fn((target) => {
      deleteTargetRef.current = target;
    });
    const selectShotsByIds = vi.fn();
    const listeners = new Map<string, (event: { clientX: number; clientY: number }) => void>();
    const frames: FrameRequestCallback[] = [];

    startStoryboardMarqueeSelection({
      currentBoardScroll: () => ({ x: 0, y: 0 }),
      event: {
        button: 0,
        clientX: 0,
        clientY: 0,
        currentTarget: board as unknown as HTMLElement,
        target: board as unknown as HTMLElement
      },
      eventTarget: {
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type) => listeners.delete(type)
      },
      deleteTargetRef,
      scheduler: {
        cancelAnimationFrame: vi.fn(),
        requestAnimationFrame: (callback) => {
          frames.push(callback);
          return frames.length;
        }
      },
      scrollBoardBy: vi.fn(),
      selectShotsByIds,
      selectedShotCountLabelRef: { current: label as HTMLSpanElement },
      selectedShotIdsRef,
      selectionMarqueeRef: { current: marquee as unknown as HTMLDivElement },
      setDeleteTarget,
      shotSelectionAnchorIdRef,
      viewportHeight: () => 800,
      workspaceBoardScrollRef: { current: null }
    });

    listeners.get("pointermove")?.({ clientX: 140, clientY: 210 });
    frames.shift()?.(0);

    expect(boardClassNames.has("is-marquee-selecting")).toBe(true);
    expect(selectedShotIdsRef.current).toEqual(["shot-a", "shot-b"]);
    expect(shotSelectionAnchorIdRef.current).toBe("shot-b");
    expect(label.textContent).toBe("2 selected");
    expect(shotA.classList.add).toHaveBeenCalledWith("is-marquee-selected");
    expect(shotB.classList.add).toHaveBeenCalledWith("is-marquee-selected");
    expect(marquee.classNames.has("is-active")).toBe(true);

    listeners.get("pointerup")?.({ clientX: 140, clientY: 210 });

    expect(selectShotsByIds).toHaveBeenCalledWith(["shot-a", "shot-b"]);
    expect(setDeleteTarget).toHaveBeenCalledWith({ type: "shot" });
    expect(boardClassNames.has("is-marquee-selecting")).toBe(false);
    expect(marquee.classNames.has("is-active")).toBe(false);
    expect(listeners.has("pointermove")).toBe(false);
  });
});
