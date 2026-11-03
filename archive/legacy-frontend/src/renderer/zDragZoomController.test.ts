import { describe, expect, it, vi } from "vitest";
import {
  shouldStartZDragZoom,
  startZDragZoom,
  zDragZoomLevel
} from "./zDragZoomController";

const target = (blockedSelector?: string) => ({
  closest: (selector: string) => (blockedSelector && selector.includes(blockedSelector) ? {} : null)
});

const pointerDown = (
  overrides: Partial<Parameters<typeof startZDragZoom>[0]["event"]> = {}
) => {
  const board = {} as HTMLElement;
  return {
    button: 0,
    clientX: 100,
    clientY: 240,
    currentTarget: board,
    isPrimary: true,
    pointerId: 7,
    pointerType: "mouse",
    target: board as EventTarget,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides
  };
};

const eventTargetHarness = () => {
  const listeners = new Map<string, EventListener>();
  const addEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(type, listener as EventListener);
    }
  );
  const removeEventListener = vi.fn(
    (type: string, listener: EventListenerOrEventListenerObject) => {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    }
  );
  const eventTarget = {
    addEventListener,
    removeEventListener
  } as unknown as EventTarget;
  const dispatch = (type: string, event: Event) => listeners.get(type)?.(event);

  return { addEventListener, dispatch, eventTarget, listeners, removeEventListener };
};

const pointerEvent = ({
  clientX = 100,
  pointerId = 7
}: {
  clientX?: number;
  pointerId?: number;
} = {}) =>
  ({
    clientX,
    pointerId,
    preventDefault: vi.fn()
  }) as unknown as PointerEvent;

const startHarness = (
  overrides: Partial<Parameters<typeof startZDragZoom>[0]> = {}
) => {
  const events = eventTargetHarness();
  const event = pointerDown();
  const options = {
    beginZoomScrubbing: vi.fn(),
    endZoomScrubbing: vi.fn(),
    event,
    eventTarget: events.eventTarget,
    getZoomLevel: vi.fn(() => 100),
    handleZoomInputChange: vi.fn(),
    isZZoomActive: true,
    shouldContinueZoom: vi.fn(() => true),
    ...overrides
  };

  return {
    consumed: startZDragZoom(options),
    event,
    events,
    options
  };
};

describe("zDragZoomController", () => {
  it("starts for primary mouse and pen input while Z zoom is active", () => {
    const board = {} as HTMLElement;
    const base = {
      button: 0,
      currentTarget: board,
      isPrimary: true,
      isZZoomActive: true,
      target: board as EventTarget
    };

    expect(shouldStartZDragZoom({ ...base, pointerType: "mouse" })).toBe(true);
    expect(shouldStartZDragZoom({ ...base, pointerType: "pen" })).toBe(true);
    expect(shouldStartZDragZoom({ ...base, pointerType: "touch" })).toBe(false);
    expect(shouldStartZDragZoom({ ...base, pointerType: "mouse", button: 2 })).toBe(false);
    expect(shouldStartZDragZoom({ ...base, pointerType: "mouse", isPrimary: false })).toBe(false);
    expect(shouldStartZDragZoom({ ...base, pointerType: "mouse", isZZoomActive: false })).toBe(
      false
    );
  });

  it("allows the board and shot canvas but excludes interactive controls", () => {
    const board = {} as HTMLElement;
    const base = {
      button: 0,
      currentTarget: board,
      isPrimary: true,
      isZZoomActive: true,
      pointerType: "pen"
    };

    expect(
      shouldStartZDragZoom({
        ...base,
        target: target() as unknown as EventTarget
      })
    ).toBe(true);
    expect(
      shouldStartZDragZoom({
        ...base,
        target: target("textarea") as unknown as EventTarget
      })
    ).toBe(false);
    expect(
      shouldStartZDragZoom({
        ...base,
        target: target(".layer-panel") as unknown as EventTarget
      })
    ).toBe(false);
    expect(
      shouldStartZDragZoom({
        ...base,
        target: target("button") as unknown as EventTarget
      })
    ).toBe(false);
  });

  it("maps each 10 horizontal pixels to a 5 percent zoom step and clamps the range", () => {
    expect(zDragZoomLevel({ currentX: 109, startX: 100, startZoom: 100 })).toBe(100);
    expect(zDragZoomLevel({ currentX: 110, startX: 100, startZoom: 100 })).toBe(105);
    expect(zDragZoomLevel({ currentX: 90, startX: 100, startZoom: 100 })).toBe(95);
    expect(zDragZoomLevel({ currentX: 1000, startX: 100, startZoom: 250 })).toBe(260);
    expect(zDragZoomLevel({ currentX: -1000, startX: 100, startZoom: 30 })).toBe(25);
  });

  it("consumes the pointer gesture, previews zoom, and finishes on pointerup", () => {
    const { consumed, event, events, options } = startHarness();
    const otherPointerMove = pointerEvent({ clientX: 150, pointerId: 8 });
    const activePointerMove = pointerEvent({ clientX: 130 });

    events.dispatch("pointermove", otherPointerMove);
    events.dispatch("pointermove", activePointerMove);

    expect(consumed).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(options.beginZoomScrubbing).toHaveBeenCalledTimes(1);
    expect(options.beginZoomScrubbing).toHaveBeenCalledWith({ x: 100, y: 240 });
    expect(events.addEventListener).toHaveBeenCalledWith("pointermove", expect.any(Function), {
      capture: true,
      passive: false
    });
    expect(otherPointerMove.preventDefault).not.toHaveBeenCalled();
    expect(activePointerMove.preventDefault).toHaveBeenCalled();
    expect(options.handleZoomInputChange).toHaveBeenCalledWith(115);

    events.dispatch("pointerup", pointerEvent());

    expect(options.endZoomScrubbing).toHaveBeenCalledTimes(1);
    expect(events.removeEventListener).toHaveBeenCalledWith(
      "pointermove",
      expect.any(Function),
      true
    );
    expect(events.listeners.size).toBe(0);
  });

  it("reads the drag baseline after pending wheel zoom is flushed", () => {
    let zoomLevel = 100;
    const beginZoomScrubbing = vi.fn(() => {
      zoomLevel = 105;
    });
    const getZoomLevel = vi.fn(() => zoomLevel);
    const { events, options } = startHarness({ beginZoomScrubbing, getZoomLevel });

    events.dispatch("pointermove", pointerEvent({ clientX: 110 }));

    expect(beginZoomScrubbing).toHaveBeenCalledTimes(1);
    expect(getZoomLevel).toHaveBeenCalledTimes(1);
    expect(options.handleZoomInputChange).toHaveBeenCalledWith(110);
  });

  it("ends on Z keyup, pointercancel, or window blur", () => {
    for (const ending of ["keyup", "pointercancel", "blur"] as const) {
      const { events, options } = startHarness();
      if (ending === "keyup") {
        events.dispatch("keyup", { key: "z" } as KeyboardEvent);
      } else if (ending === "pointercancel") {
        events.dispatch("pointercancel", pointerEvent());
      } else {
        events.dispatch("blur", {} as Event);
      }

      expect(options.endZoomScrubbing, ending).toHaveBeenCalledTimes(1);
      expect(events.listeners.size, ending).toBe(0);
    }
  });

  it("ends without another zoom update when Z is no longer held", () => {
    const shouldContinueZoom = vi.fn(() => false);
    const { events, options } = startHarness({ shouldContinueZoom });

    events.dispatch("pointermove", pointerEvent({ clientX: 140 }));

    expect(options.handleZoomInputChange).not.toHaveBeenCalled();
    expect(options.endZoomScrubbing).toHaveBeenCalledTimes(1);
    expect(events.listeners.size).toBe(0);
  });

  it("does not consume an ineligible pointerdown", () => {
    const event = pointerDown({ pointerType: "touch" });
    const { consumed, events, options } = startHarness({ event });

    expect(consumed).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(options.beginZoomScrubbing).not.toHaveBeenCalled();
    expect(events.listeners.size).toBe(0);
  });
});
