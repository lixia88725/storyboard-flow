import { describe, expect, it } from "vitest";
import { shortcutMenuItems } from "./shortcutMenuController";

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
});
