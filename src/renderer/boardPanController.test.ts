import { describe, expect, it, vi } from "vitest";
import {
  boardPanScrollDelta,
  shouldStartBoardPan,
  startBoardPanDrag
} from "./boardPanController";

const target = (blockedSelector?: string) => ({
  closest: (selector: string) => (blockedSelector && selector.includes(blockedSelector) ? {} : null)
});

describe("boardPanController", () => {
  it("starts only while Space pan is active with the primary pointer button", () => {
    const board = {};

    expect(
      shouldStartBoardPan({
        button: 0,
        isSpacePanActive: true,
        currentTarget: board as HTMLElement,
        target: board as EventTarget
      })
    ).toBe(true);
    expect(
      shouldStartBoardPan({
        button: 2,
        isSpacePanActive: true,
        currentTarget: board as HTMLElement,
        target: board as EventTarget
      })
    ).toBe(false);
    expect(
      shouldStartBoardPan({
        button: 0,
        isSpacePanActive: false,
        currentTarget: board as HTMLElement,
        target: board as EventTarget
      })
    ).toBe(false);
  });

  it("does not start from interactive targets", () => {
    const board = {};

    expect(
      shouldStartBoardPan({
        button: 0,
        isSpacePanActive: true,
        currentTarget: board as HTMLElement,
        target: target("button") as unknown as EventTarget
      })
    ).toBe(false);
    expect(
      shouldStartBoardPan({
        button: 0,
        isSpacePanActive: true,
        currentTarget: board as HTMLElement,
        target: target(".layer-panel") as unknown as EventTarget
      })
    ).toBe(false);
  });

  it("converts pointer movement into inverse scroll deltas", () => {
    expect(boardPanScrollDelta({ fromX: 100, fromY: 80, toX: 90, toY: 95 })).toEqual({
      left: 10,
      top: -15
    });
  });

  it("scrolls the board while dragging", () => {
    const listeners = new Map<string, (event: { clientX: number; clientY: number }) => void>();
    const scrollBoardBy = vi.fn();
    const setIsBoardPanning = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    startBoardPanDrag({
      event: {
        button: 0,
        clientX: 100,
        clientY: 80,
        currentTarget: {} as HTMLElement,
        target: {} as EventTarget,
        preventDefault,
        stopPropagation
      },
      eventTarget: {
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type) => listeners.delete(type)
      },
      isSpacePanActive: true,
      scrollBoardBy,
      setIsBoardPanning
    });

    listeners.get("pointermove")?.({ clientX: 82, clientY: 95 });

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(setIsBoardPanning).toHaveBeenCalledWith(true);
    expect(scrollBoardBy).toHaveBeenCalledWith({ left: 18, top: -15, behavior: "auto" });

    listeners.get("pointerup")?.({ clientX: 82, clientY: 95 });

    expect(setIsBoardPanning).toHaveBeenLastCalledWith(false);
    expect(listeners.has("pointermove")).toBe(false);
  });

  it("stops dragging when Space pan is no longer active", () => {
    const listeners = new Map<string, (event: { clientX: number; clientY: number }) => void>();
    const scrollBoardBy = vi.fn();
    const setIsBoardPanning = vi.fn();
    let shouldContinue = true;

    startBoardPanDrag({
      event: {
        button: 0,
        clientX: 100,
        clientY: 80,
        currentTarget: {} as HTMLElement,
        target: {} as EventTarget,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn()
      },
      eventTarget: {
        addEventListener: (type, listener) => listeners.set(type, listener),
        removeEventListener: (type) => listeners.delete(type)
      },
      isSpacePanActive: true,
      scrollBoardBy,
      setIsBoardPanning,
      shouldContinuePan: () => shouldContinue
    });

    shouldContinue = false;
    listeners.get("pointermove")?.({ clientX: 82, clientY: 95 });

    expect(scrollBoardBy).not.toHaveBeenCalled();
    expect(setIsBoardPanning).toHaveBeenLastCalledWith(false);
    expect(listeners.has("pointermove")).toBe(false);
  });
});
