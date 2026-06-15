import { describe, expect, it } from "vitest";
import { hasOpenShortcutBlockingMenu, shortcutMenuItems } from "./shortcutMenuController";

describe("shortcutMenuController", () => {
  it("shows the fixed keyboard shortcut menu entries in toolbar order", () => {
    expect(shortcutMenuItems.map(({ action, label }) => [action, label])).toEqual([
      ["brush", "Brush"],
      ["eraser", "Eraser"],
      ["select", "Select"],
      ["clearLayer", "Clear layer"],
      ["mergeDown", "Merge"],
      ["save", "Save"],
      ["addShot", "Add Shot"],
      ["onionSkin", "Onion Skin"],
      ["decreaseBrushSize", "Brush size -10%"],
      ["increaseBrushSize", "Brush size +10%"],
      ["decreaseBrushOpacity", "Opacity -25%"],
      ["increaseBrushOpacity", "Opacity +25%"],
      ["previousShot", "Previous shot"],
      ["nextShot", "Next shot"],
      ["undo", "Undo"],
      ["redo", "Redo"]
    ]);
  });

  it("blocks global shortcuts when any shortcut-blocking menu is open", () => {
    const matches = new Set([".save-menu"]);
    const root = {
      querySelector: (selector: string) =>
        selector.split(", ").some((part) => matches.has(part)) ? {} : null
    };

    expect(hasOpenShortcutBlockingMenu(root)).toBe(true);
    matches.clear();
    expect(hasOpenShortcutBlockingMenu(root)).toBe(false);
  });
});
