import { describe, expect, it, vi } from "vitest";
import { registerPointerPositionListeners } from "./pointerPositionController";

describe("pointerPositionController", () => {
  it("tracks the latest pointer position until cleanup", () => {
    const listeners = new Map<string, (event: MouseEvent | PointerEvent) => void>();
    const target = {
      addEventListener: vi.fn((type: string, listener: (event: MouseEvent | PointerEvent) => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: (event: MouseEvent | PointerEvent) => void) => {
        if (listeners.get(type) === listener) {
          listeners.delete(type);
        }
      })
    };
    const lastPositionRef = { current: undefined as { x: number; y: number } | undefined };

    const cleanup = registerPointerPositionListeners(target, lastPositionRef);
    listeners.get("pointermove")?.({ clientX: 12, clientY: 34 } as MouseEvent);
    listeners.get("mouseup")?.({ clientX: 56, clientY: 78 } as MouseEvent);

    expect(lastPositionRef.current).toEqual({ x: 56, y: 78 });
    expect([...listeners.keys()].sort()).toEqual(["mousemove", "mouseup", "pointermove", "pointerup"]);

    cleanup();

    expect(listeners.size).toBe(0);
  });
});
