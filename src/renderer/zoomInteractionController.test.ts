import { describe, expect, it, vi } from "vitest";
import { registerZoomScrubEndListeners } from "./zoomInteractionController";

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
});
