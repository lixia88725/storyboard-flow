import { describe, expect, it, vi } from "vitest";
import {
  registerWorkbenchWheelZoomListener,
  registerZoomScrubEndListeners
} from "./zoomInteractionController";

describe("zoomInteractionController", () => {
  it("registers zoom scrub end listeners until cleanup", () => {
    const listeners = new Map<string, (event: PointerEvent) => void>();
    const target = {
      addEventListener: vi.fn(
        (type: string, listener: (event: PointerEvent) => void, _options?: AddEventListenerOptions | boolean) => {
          listeners.set(type, listener);
        }
      ),
      removeEventListener: vi.fn((type: string, listener: (event: PointerEvent) => void) => {
        if (listeners.get(type) === listener) {
          listeners.delete(type);
        }
      })
    };
    const endZoomScrubbing = vi.fn();

    const cleanup = registerZoomScrubEndListeners(target, endZoomScrubbing);
    listeners.get("pointerup")?.({} as PointerEvent);
    listeners.get("pointercancel")?.({} as PointerEvent);

    expect(endZoomScrubbing).toHaveBeenCalledTimes(2);
    expect(target.addEventListener).toHaveBeenCalledWith("pointerup", expect.any(Function), { once: true });
    expect(target.addEventListener).toHaveBeenCalledWith("pointercancel", expect.any(Function), { once: true });

    cleanup();

    expect(listeners.size).toBe(0);
  });

  it("schedules wheel zoom for non-ignored workbench targets", () => {
    const listeners = new Map<string, (event: WheelEvent) => void>();
    const element = {
      addEventListener: vi.fn(
        (type: string, listener: (event: WheelEvent) => void, _options?: AddEventListenerOptions | boolean) => {
          listeners.set(type, listener);
        }
      ),
      removeEventListener: vi.fn((type: string, listener: (event: WheelEvent) => void) => {
        if (listeners.get(type) === listener) {
          listeners.delete(type);
        }
      })
    };
    const scheduleZoomLevel = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    const cleanup = registerWorkbenchWheelZoomListener(element, {
      currentZoomLevel: () => 100,
      nextWheelZoom: (currentZoom, deltaY) => currentZoom + deltaY,
      scheduleZoomLevel,
      shouldIgnoreTarget: () => false
    });

    listeners.get("wheel")?.({
      deltaY: -10,
      preventDefault,
      stopPropagation,
      target: {}
    } as unknown as WheelEvent);

    expect(preventDefault).toHaveBeenCalledOnce();
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(scheduleZoomLevel).toHaveBeenCalledWith(90);
    expect(element.addEventListener).toHaveBeenCalledWith("wheel", expect.any(Function), { passive: false });

    cleanup();

    expect(listeners.size).toBe(0);
  });

  it("leaves ignored wheel targets alone", () => {
    const listeners = new Map<string, (event: WheelEvent) => void>();
    const element = {
      addEventListener: vi.fn((type: string, listener: (event: WheelEvent) => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn()
    };
    const scheduleZoomLevel = vi.fn();
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();

    registerWorkbenchWheelZoomListener(element, {
      currentZoomLevel: () => 100,
      nextWheelZoom: (currentZoom, deltaY) => currentZoom + deltaY,
      scheduleZoomLevel,
      shouldIgnoreTarget: () => true
    });

    listeners.get("wheel")?.({
      deltaY: -10,
      preventDefault,
      stopPropagation,
      target: {}
    } as unknown as WheelEvent);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(stopPropagation).not.toHaveBeenCalled();
    expect(scheduleZoomLevel).not.toHaveBeenCalled();
  });
});
