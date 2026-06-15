import { useEffect, useRef, useState } from "react";
import type { ShortcutAction } from "./keyboardShortcuts";

export const shortcutMenuItems: Array<{ action: ShortcutAction; label: string }> = [
  { action: "brush", label: "Brush" },
  { action: "eraser", label: "Eraser" },
  { action: "select", label: "Select" },
  { action: "clearLayer", label: "Clear layer" },
  { action: "mergeDown", label: "Merge" },
  { action: "save", label: "Save" },
  { action: "addShot", label: "Add Shot" },
  { action: "onionSkin", label: "Onion Skin" },
  { action: "decreaseBrushSize", label: "Brush size -10%" },
  { action: "increaseBrushSize", label: "Brush size +10%" },
  { action: "decreaseBrushOpacity", label: "Opacity -25%" },
  { action: "increaseBrushOpacity", label: "Opacity +25%" },
  { action: "previousShot", label: "Previous shot" },
  { action: "nextShot", label: "Next shot" },
  { action: "undo", label: "Undo" },
  { action: "redo", label: "Redo" }
];

type ShortcutBlockingMenuRoot = Pick<Document, "querySelector">;

export const hasOpenShortcutBlockingMenu = (
  root: ShortcutBlockingMenuRoot = document
): boolean =>
  Boolean(
    root.querySelector(
      ".shortcut-menu, .save-menu, .recent-menu, .add-shot-menu, .radial-tool-menu"
    )
  );

export const useShortcutMenuController = () => {
  const [isShortcutMenuOpen, setIsShortcutMenuOpen] = useState(false);
  const shortcutMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isShortcutMenuOpen) {
      return;
    }

    const handlePointerDown = (event: globalThis.PointerEvent | globalThis.MouseEvent) => {
      if (!shortcutMenuRef.current?.contains(event.target as Node)) {
        setIsShortcutMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsShortcutMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isShortcutMenuOpen]);

  return {
    isShortcutMenuOpen,
    setIsShortcutMenuOpen,
    shortcutMenuRef,
    shortcutMenuItems
  };
};
