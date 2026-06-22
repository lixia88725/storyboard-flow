import { describe, expect, it, vi } from "vitest";
import {
  nextKeyboardShotSelection,
  registerGlobalKeyboardListener
} from "./globalKeyboardController";

describe("globalKeyboardController", () => {
  it("registers global keydown and keyup listeners until cleanup", () => {
    const listeners = new Map<string, (event: KeyboardEvent) => void>();
    const target = {
      addEventListener: vi.fn((type: string, listener: (event: KeyboardEvent) => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string, listener: (event: KeyboardEvent) => void) => {
        if (listeners.get(type) === listener) {
          listeners.delete(type);
        }
      })
    };
    const handleKeyDown = vi.fn();
    const handleKeyUp = vi.fn();

    const cleanup = registerGlobalKeyboardListener(target, handleKeyDown, handleKeyUp);
    listeners.get("keydown")?.({ key: "b" } as KeyboardEvent);
    listeners.get("keyup")?.({ key: "b" } as KeyboardEvent);

    expect(handleKeyDown).toHaveBeenCalledWith({ key: "b" });
    expect(handleKeyUp).toHaveBeenCalledWith({ key: "b" });
    expect(target.addEventListener).toHaveBeenCalledWith("keydown", handleKeyDown);
    expect(target.addEventListener).toHaveBeenCalledWith("keyup", handleKeyUp);

    cleanup();

    expect(listeners.size).toBe(0);
  });

  it("selects the next shot in the requested keyboard direction", () => {
    expect(
      nextKeyboardShotSelection({
        currentSelectedIds: ["shot-2"],
        direction: "right",
        gridColumns: 3,
        isAnimationMode: false,
        orderedShotIds: ["shot-1", "shot-2", "shot-3"]
      })
    ).toEqual({ anchorId: "shot-3", selectedIds: ["shot-3"] });
  });

  it("clears keyboard shot selection when there are no ordered shots", () => {
    expect(
      nextKeyboardShotSelection({
        currentSelectedIds: ["shot-2"],
        direction: "right",
        gridColumns: 3,
        isAnimationMode: false,
        orderedShotIds: []
      })
    ).toEqual({ anchorId: undefined, selectedIds: [] });
  });
});
