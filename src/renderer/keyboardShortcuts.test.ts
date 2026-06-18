import { describe, expect, it } from "vitest";
import {
  adjustSketchShortcutValue,
  clipboardActionFromKeyboardEvent,
  defaultKeyboardShortcuts,
  defaultKeyboardShortcutsForPlatform,
  formatShortcutFromKeyboardEvent,
  historyActionFromKeyboardEvent,
  keyboardEventMatchesShortcut,
  normalizeShortcutValue,
  shortcutActionFromKeyboardEvent,
  shouldIgnoreShortcutForTarget
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

const keyboardTarget = (options: {
  isContentEditable?: boolean;
  closestInputType?: string;
  closestTextareaOrSelect?: boolean;
}): EventTarget =>
  ({
    isContentEditable: options.isContentEditable ?? false,
    closest: (selector: string) => {
      if (selector === "textarea, select") {
        return options.closestTextareaOrSelect ? {} : null;
      }
      if (selector === "input") {
        return options.closestInputType ? { type: options.closestInputType } : null;
      }
      return null;
    }
  }) as unknown as EventTarget;

describe("keyboardShortcuts", () => {
  it("defaults clear layer to Escape", () => {
    expect(defaultKeyboardShortcuts.clearLayer).toBe("Escape");
  });

  it("defaults merge down to the platform primary modifier", () => {
    expect(defaultKeyboardShortcutsForPlatform("darwin").mergeDown).toBe("Cmd+E");
    expect(defaultKeyboardShortcutsForPlatform("win32").mergeDown).toBe("Ctrl+E");
    expect(defaultKeyboardShortcutsForPlatform("linux").mergeDown).toBe("Ctrl+E");
  });

  it("defaults fixed system shortcuts to the platform primary modifier", () => {
    expect(defaultKeyboardShortcutsForPlatform("darwin")).toMatchObject({
      save: "Cmd+S",
      undo: "Cmd+Z",
      redo: "Shift+Cmd+Z"
    });
    expect(defaultKeyboardShortcutsForPlatform("win32")).toMatchObject({
      save: "Ctrl+S",
      undo: "Ctrl+Z",
      redo: "Shift+Ctrl+Z"
    });
    expect(defaultKeyboardShortcutsForPlatform("linux")).toMatchObject({
      save: "Ctrl+S",
      undo: "Ctrl+Z",
      redo: "Shift+Ctrl+Z"
    });
  });

  it("defaults sketch adjustment shortcuts to number keys", () => {
    expect(defaultKeyboardShortcuts).toMatchObject({
      decreaseBrushSize: "1",
      increaseBrushSize: "2",
      decreaseBrushOpacity: "3",
      increaseBrushOpacity: "4"
    });
  });

  it("defaults eyedropper to the Photoshop-style I shortcut", () => {
    expect(defaultKeyboardShortcuts.eyedropper).toBe("I");
    expect(shortcutActionFromKeyboardEvent(keyboardEvent("i"))).toBe("eyedropper");
  });

  it("adjusts brush size by visible ten percent steps within bounds", () => {
    expect(adjustSketchShortcutValue(10, "decrease", 0.1, 1, 28)).toBe(9);
    expect(adjustSketchShortcutValue(10, "increase", 0.1, 1, 28)).toBe(11);
    expect(adjustSketchShortcutValue(4, "decrease", 0.1, 1, 28)).toBe(3);
    expect(adjustSketchShortcutValue(4, "increase", 0.1, 1, 28)).toBe(5);
    expect(adjustSketchShortcutValue(1, "decrease", 0.1, 1, 28)).toBe(1);
    expect(adjustSketchShortcutValue(28, "increase", 0.1, 1, 28)).toBe(28);
  });

  it("adjusts opacity by fixed twenty-five percent steps within bounds", () => {
    expect(adjustSketchShortcutValue(1, "decrease", 0.25, 0.2, 1)).toBe(0.75);
    expect(adjustSketchShortcutValue(0.75, "decrease", 0.25, 0.2, 1)).toBe(0.5);
    expect(adjustSketchShortcutValue(0.75, "increase", 0.25, 0.2, 1)).toBe(1);
    expect(adjustSketchShortcutValue(0.2, "decrease", 0.25, 0.2, 1)).toBe(0.2);
  });

  it("ignores stored shortcut overrides by using fixed defaults", () => {
    expect(normalizeShortcutValue("option+b")).toBe("Alt+B");
    expect(defaultKeyboardShortcuts.brush).toBe("B");
    expect(defaultKeyboardShortcuts.save).toBe("Cmd+S");
  });

  it("formats keyboard events into stable shortcut strings", () => {
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("b"))).toBe("B");
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("s", { metaKey: true }))).toBe("Cmd+S");
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("e", { ctrlKey: true }))).toBe("Ctrl+E");
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("Z", { metaKey: true, shiftKey: true }))).toBe(
      "Shift+Cmd+Z"
    );
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("ArrowLeft"))).toBe("ArrowLeft");
    expect(formatShortcutFromKeyboardEvent(keyboardEvent("Escape"))).toBe("Escape");
  });

  it("matches keyboard events against shortcut strings", () => {
    expect(keyboardEventMatchesShortcut(keyboardEvent("b"), "B")).toBe(true);
    expect(keyboardEventMatchesShortcut(keyboardEvent("s", { metaKey: true }), "Cmd+S")).toBe(true);
    expect(keyboardEventMatchesShortcut(keyboardEvent("e", { metaKey: true }), "Cmd+E")).toBe(true);
    expect(keyboardEventMatchesShortcut(keyboardEvent("e", { ctrlKey: true }), "Ctrl+E")).toBe(true);
    expect(keyboardEventMatchesShortcut(keyboardEvent("z", { metaKey: true }), "Shift+Cmd+Z")).toBe(false);
    expect(keyboardEventMatchesShortcut(keyboardEvent("ArrowRight"), "ArrowRight")).toBe(true);
    expect(keyboardEventMatchesShortcut(keyboardEvent("Escape"), "Escape")).toBe(true);
  });

  it("treats missing shortcut values as no match", () => {
    expect(keyboardEventMatchesShortcut(keyboardEvent("z", { metaKey: true }), undefined)).toBe(false);
  });

  it("keeps standard history shortcuts available as a fallback", () => {
    expect(historyActionFromKeyboardEvent(keyboardEvent("z", { metaKey: true }))).toBe("undo");
    expect(historyActionFromKeyboardEvent(keyboardEvent("z", { ctrlKey: true }))).toBe("undo");
    expect(historyActionFromKeyboardEvent(keyboardEvent("z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(historyActionFromKeyboardEvent(keyboardEvent("z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(historyActionFromKeyboardEvent(keyboardEvent("z"))).toBeUndefined();
  });

  it("keeps standard clipboard shortcuts available as a fallback", () => {
    expect(clipboardActionFromKeyboardEvent(keyboardEvent("c", { metaKey: true }))).toBe("copy");
    expect(clipboardActionFromKeyboardEvent(keyboardEvent("c", { ctrlKey: true }))).toBe("copy");
    expect(clipboardActionFromKeyboardEvent(keyboardEvent("v", { metaKey: true }))).toBe("paste");
    expect(clipboardActionFromKeyboardEvent(keyboardEvent("v", { ctrlKey: true }))).toBe("paste");
    expect(clipboardActionFromKeyboardEvent(keyboardEvent("v", { metaKey: true, shiftKey: true }))).toBeUndefined();
    expect(clipboardActionFromKeyboardEvent(keyboardEvent("c", { metaKey: true, altKey: true }))).toBeUndefined();
  });

  it("resolves configured shortcuts before history fallbacks", () => {
    expect(shortcutActionFromKeyboardEvent(keyboardEvent("b"))).toBe("brush");
    expect(shortcutActionFromKeyboardEvent(keyboardEvent("z", { metaKey: true }))).toBe("undo");
    expect(shortcutActionFromKeyboardEvent(keyboardEvent("z", { metaKey: true, shiftKey: true }))).toBe("redo");
  });

  it("ignores shortcuts in editable targets except timeline range navigation in animation mode", () => {
    const input = keyboardTarget({ closestInputType: "text" });
    const range = keyboardTarget({ closestInputType: "range" });
    const button = keyboardTarget({});

    expect(shouldIgnoreShortcutForTarget(input, "brush", true)).toBe(true);
    expect(shouldIgnoreShortcutForTarget(range, "previousShot", true)).toBe(false);
    expect(shouldIgnoreShortcutForTarget(range, "previousShot", false)).toBe(true);
    expect(shouldIgnoreShortcutForTarget(button, "brush", false)).toBe(false);
  });

  it("calls target closest with the original element receiver", () => {
    const target = {
      isContentEditable: false,
      closest(this: unknown, selector: string) {
        if (this !== target) {
          throw new Error("closest was called with a detached receiver");
        }
        return selector === "input" ? { type: "text" } : null;
      }
    } as unknown as EventTarget;

    expect(shouldIgnoreShortcutForTarget(target, "brush", false)).toBe(true);
  });

});
