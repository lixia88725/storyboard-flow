import { describe, expect, it } from "vitest";
import {
  defaultKeyboardShortcuts,
  duplicateShortcutValues,
  formatShortcutFromKeyboardEvent,
  keyboardEventMatchesShortcut,
  normalizeKeyboardShortcuts
} from "./keyboardShortcuts";

const keyboardEvent = (key: string, options: Partial<KeyboardEvent> = {}) =>
  ({
    key,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    ...options
  }) as KeyboardEvent;

describe("keyboardShortcuts", () => {
  it("defaults clear layer to Escape", () => {
    expect(defaultKeyboardShortcuts.clearLayer).toBe("Escape");
  });

  it("normalizes persisted shortcut settings onto defaults", () => {
    expect(
      normalizeKeyboardShortcuts({
        brush: "P",
        unknown: "X",
        save: ""
      })
    ).toEqual({
      ...defaultKeyboardShortcuts,
      brush: "P",
      save: ""
    });
  });

  it("formats keyboard events into stable shortcut strings", () => {
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("b"))).toBe("B");
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("s", { metaKey: true }))).toBe("Cmd+S");
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("Z", { metaKey: true, shiftKey: true }))).toBe(
      "Shift+Cmd+Z"
    );
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("ArrowLeft"))).toBe("ArrowLeft");
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("Escape"))).toBe("Escape");
  });

  it("matches keyboard events against shortcut strings", () => {
    expect(keyboardEventMatchesShortcut(keyboardEvent("b"), "B")).toBe(true);
    expect(keyboardEventMatchesShortcut(keyboardEvent("s", { metaKey: true }), "Cmd+S")).toBe(true);
    expect(keyboardEventMatchesShortcut(keyboardEvent("z", { metaKey: true }), "Shift+Cmd+Z")).toBe(false);
    expect(keyboardEventMatchesShortcut(keyboardEvent("ArrowRight"), "ArrowRight")).toBe(true);
    expect(keyboardEventMatchesShortcut(keyboardEvent("Escape"), "Escape")).toBe(true);
  });

  it("detects duplicate assigned shortcuts while ignoring disabled shortcuts", () => {
    expect(
      duplicateShortcutValues({
        ...defaultKeyboardShortcuts,
        brush: "E",
        clearLayer: ""
      })
    ).toEqual(["E"]);
  });

  it("detects duplicate Escape assignments", () => {
    expect(
      duplicateShortcutValues({
        ...defaultKeyboardShortcuts,
        brush: "Escape"
      })
    ).toEqual(["Escape"]);
  });
});
