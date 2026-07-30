import { describe, expect, it, vi } from "vitest";
import {
  shouldStartStoryboardMarqueeSelection,
  startStoryboardMarqueeSelection
} from "./storyboardMarqueeController";
import type { DeleteTarget } from "./deleteTarget";
import type { MarqueeOverlayHandle } from "./SelectionMarquee";
import { createStoryboardMediaWindowInteractionController } from "./storyboardMediaWindowInteraction";

const fakeElement = (
  shotId: string,
  rect: { left: number; right: number; top: number; bottom: number }
) => ({
  dataset: { shotId },
  getBoundingClientRect: vi.fn(() => rect)
});

const fakeOverlay = (): MarqueeOverlayHandle => ({
  show: vi.fn(),
  renderBox: vi.fn(),
  renderSelection: vi.fn(),
  hide: vi.fn()
});

const fakeTarget = (blockedSelector?: string) => ({
  closest: (selector: string) =>
    blockedSelector && selector.includes(blockedSelector) ? {} : null
});

describe("storyboardMarqueeController", () => {
  it("starts from row background in Japanese storyboard mode but not from editing or drawing targets", () => {
    const board = {
      dataset: { marqueeMode: "rows" }
    };
    const rowBackground = fakeTarget();

    expect(
      shouldStartStoryboardMarqueeSelection({
        button: 0,
        currentTarget: board as unknown as HTMLElement,
        target: rowBackground as unknown as HTMLElement
      })
    ).toBe(true);
    expect(
      shouldStartStoryboardMarqueeSelection({
        button: 0,
        currentTarget: board as unknown as HTMLElement,
        target: fakeTarget("textarea") as unknown as HTMLElement
      })
    ).toBe(false);
    expect(
      shouldStartStoryboardMarqueeSelection({
        button: 0,
        currentTarget: board as unknown as HTMLElement,
        target: fakeTarget(".image-stage") as unknown as HTMLElement
      })
    ).toBe(false);
    expect(
      shouldStartStoryboardMarqueeSelection({
        button: 0,
        currentTarget: board as unknown as HTMLElement,
        target: fakeTarget("button") as unknown as HTMLElement
      })
    ).toBe(false);
  });

  it("keeps ordinary storyboard marquee starts limited to board whitespace", () => {
    const board = { dataset: {} };
    const child = fakeTarget();

    expect(
      shouldStartStoryboardMarqueeSelection({
        button: 0,
        currentTarget: board as unknown as HTMLElement,
        target: child as unknown as HTMLElement
      })
    ).toBe(false);
    expect(
      shouldStartStoryboardMarqueeSelection({
        button: 0,
        currentTarget: board as unknown as HTMLElement,
        target: board as unknown as HTMLElement
      })
    ).toBe(true);
  });

  it.each(["pointerup", "pointercancel"] as const)(
    "uses cached geometry, updates one overlay, and commits after the handoff frame on %s",
    (finishEvent) => {
    const shotA = fakeElement("shot-a", {
      left: 10,
      right: 110,
      top: 10,
      bottom: 110
    });
    const shotB = fakeElement("shot-b", {
      left: 10,
      right: 110,
      top: 120,
      bottom: 220
    });
    const boardClassNames = new Set<string>();
    const board = {
      dataset: {},
      classList: {
        add: (className: string) => boardClassNames.add(className),
        remove: (className: string) => boardClassNames.delete(className)
      },
      querySelectorAll: vi.fn(() => [shotA, shotB])
    };
    const label = { textContent: "" };
    const overlay = fakeOverlay();
    const selectedShotIdsRef = { current: ["shot-before"] };
    const shotSelectionAnchorIdRef = {
      current: "shot-before" as string | undefined
    };
    const deleteTargetRef = {
      current: {
        type: "layer",
        shotId: "shot-before",
        layerId: "layer-1"
      } as DeleteTarget
    };
    const setDeleteTarget = vi.fn((target) => {
      deleteTargetRef.current = target;
    });
    const committedSelections: string[][] = [];
    const selectShotsByIds = vi.fn((shotIds: string[]) => {
      if (
        selectedShotIdsRef.current.length === shotIds.length &&
        selectedShotIdsRef.current.every(
          (shotId, index) => shotId === shotIds[index]
        )
      ) {
        return;
      }
      selectedShotIdsRef.current = shotIds;
      committedSelections.push(shotIds);
    });
    const pointerListeners = new Map<
      string,
      (event: { clientX: number; clientY: number }) => void
    >();
    const resizeListeners = new Map<string, () => void>();
    const frames: FrameRequestCallback[] = [];
    const measureViewportRect = vi.fn(() => ({
      left: 0,
      top: 0,
      width: 500,
      height: 800
    }));
    const interactionController =
      createStoryboardMediaWindowInteractionController();

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
        addEventListener: (type, listener) =>
          pointerListeners.set(type, listener),
        removeEventListener: (type) => pointerListeners.delete(type)
      },
      interactionController,
      measureViewportRect,
      resizeTarget: {
        addEventListener: (type, listener) =>
          resizeListeners.set(type, listener),
        removeEventListener: (type) => resizeListeners.delete(type)
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
      selectedShotCountLabelRef: {
        current: label as HTMLSpanElement
      },
      selectedShotIdsRef,
      selectionMarqueeRef: { current: overlay },
      setDeleteTarget,
      shotSelectionAnchorIdRef
    });

    pointerListeners.get("pointermove")?.({ clientX: 140, clientY: 210 });
    frames.shift()?.(0);

    expect(measureViewportRect).toHaveBeenCalledTimes(1);
    expect(shotA.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(shotB.getBoundingClientRect).toHaveBeenCalledTimes(1);
    expect(boardClassNames.has("is-marquee-selecting")).toBe(true);
    expect(interactionController.isInteractionActive()).toBe(true);
    expect(selectedShotIdsRef.current).toEqual(["shot-a", "shot-b"]);
    expect(shotSelectionAnchorIdRef.current).toBe("shot-b");
    expect(label.textContent).toBe("Selecting…");
    expect(overlay.renderSelection).toHaveBeenLastCalledWith([
      { left: 10, top: 10, width: 100, height: 100 },
      { left: 10, top: 120, width: 100, height: 100 }
    ]);

    pointerListeners.get("pointermove")?.({ clientX: 145, clientY: 215 });
    frames.shift()?.(0);
    expect(overlay.renderSelection).toHaveBeenCalledTimes(2);
    expect(measureViewportRect).toHaveBeenCalledTimes(1);

    resizeListeners.get("resize")?.();
    expect(measureViewportRect).toHaveBeenCalledTimes(2);
    expect(shotA.getBoundingClientRect).toHaveBeenCalledTimes(2);
    frames.shift()?.(0);

    pointerListeners.get(finishEvent)?.({ clientX: 145, clientY: 215 });

    expect(selectShotsByIds).toHaveBeenCalledWith(["shot-a", "shot-b"]);
    expect(label.textContent).toBe("2 selected");
    expect(committedSelections).toEqual([["shot-a", "shot-b"]]);
    expect(selectedShotIdsRef.current).toEqual(["shot-a", "shot-b"]);
    expect(setDeleteTarget).toHaveBeenCalledWith({ type: "shot" });
    expect(boardClassNames.has("is-marquee-selecting")).toBe(true);
    expect(overlay.hide).not.toHaveBeenCalled();
    expect(interactionController.isInteractionActive()).toBe(true);
    expect(pointerListeners.has("pointermove")).toBe(false);

    frames.shift()?.(0);
    expect(boardClassNames.has("is-marquee-selecting")).toBe(false);
    expect(overlay.hide).toHaveBeenCalledTimes(1);
    expect(interactionController.isInteractionActive()).toBe(false);
    }
  );
});
