import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import type { StrokeTool } from "../shared/types";
import {
  radialCanvasContextMenuAction,
  normalizeToolRadialMenuConfig,
  type RadialDragKind,
  type RadialToolSlot,
  type SketchToolSettings,
  type ToolRadialMenuConfig
} from "./toolRadialMenu";

const defaultRadialToolMenuCloseAnimationMs = 140;

export type RadialToolMenuState = {
  tool: StrokeTool;
  x: number;
  y: number;
  isClosing?: boolean;
};

export const openRadialToolMenuState = (
  nextMenu: Omit<RadialToolMenuState, "isClosing">
): RadialToolMenuState => ({
  ...nextMenu,
  isClosing: false
});

export const closeRadialToolMenuState = (
  current: RadialToolMenuState | undefined,
  shouldReduceMotion: boolean
): RadialToolMenuState | undefined => {
  if (!current || shouldReduceMotion) {
    return undefined;
  }

  return { ...current, isClosing: true };
};

export const updateRadialDragSettings = (
  settings: SketchToolSettings,
  kind: RadialDragKind,
  value: number
): SketchToolSettings => {
  if (settings.tool === "brush") {
    if (kind === "size") {
      return { ...settings, brushSize: value };
    }
    if (kind === "opacity") {
      return { ...settings, brushOpacity: value };
    }
    return { ...settings, brushSoftness: value };
  }

  if (settings.tool === "eraser") {
    if (kind === "size") {
      return { ...settings, eraserSize: value };
    }
    if (kind === "opacity") {
      return { ...settings, eraserOpacity: value };
    }
    return { ...settings, eraserSoftness: value };
  }

  return settings;
};

export const nextRadialSlotConfig = (
  config: ToolRadialMenuConfig,
  tool: StrokeTool,
  index: number,
  slot: RadialToolSlot
): ToolRadialMenuConfig =>
  normalizeToolRadialMenuConfig({
    ...config,
    [tool]: {
      slots: config[tool].slots.map((currentSlot, slotIndex) =>
        slotIndex === index ? slot : currentSlot
      )
    }
  });

export const nextRadialSlotsConfig = (
  config: ToolRadialMenuConfig,
  tool: StrokeTool,
  slots: RadialToolSlot[]
): ToolRadialMenuConfig =>
  normalizeToolRadialMenuConfig({
    ...config,
    [tool]: {
      slots
    }
  });

type UseRadialToolMenuControllerOptions = {
  activeSketchTool: SketchToolSettings["tool"];
  needsSwbImport: boolean;
  setStatus: (status: string) => void;
  closeAnimationMs?: number;
};

export const useRadialToolMenuController = ({
  activeSketchTool,
  needsSwbImport,
  setStatus,
  closeAnimationMs = defaultRadialToolMenuCloseAnimationMs
}: UseRadialToolMenuControllerOptions) => {
  const [radialToolMenu, setRadialToolMenu] = useState<RadialToolMenuState | undefined>();
  const radialToolMenuCloseTimeoutRef = useRef<number | undefined>(undefined);

  const clearRadialToolMenuCloseTimeout = useCallback(() => {
    if (radialToolMenuCloseTimeoutRef.current !== undefined) {
      window.clearTimeout(radialToolMenuCloseTimeoutRef.current);
      radialToolMenuCloseTimeoutRef.current = undefined;
    }
  }, []);

  const openRadialToolMenu = useCallback(
    (nextMenu: Omit<RadialToolMenuState, "isClosing">) => {
      clearRadialToolMenuCloseTimeout();
      setRadialToolMenu(openRadialToolMenuState(nextMenu));
    },
    [clearRadialToolMenuCloseTimeout]
  );

  const closeRadialToolMenu = useCallback(() => {
    clearRadialToolMenuCloseTimeout();

    const shouldReduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (shouldReduceMotion) {
      setRadialToolMenu(undefined);
      return;
    }

    setRadialToolMenu((current) => closeRadialToolMenuState(current, false));
    radialToolMenuCloseTimeoutRef.current = window.setTimeout(() => {
      radialToolMenuCloseTimeoutRef.current = undefined;
      setRadialToolMenu(undefined);
    }, closeAnimationMs);
  }, [clearRadialToolMenuCloseTimeout, closeAnimationMs]);

  useEffect(() => clearRadialToolMenuCloseTimeout, [clearRadialToolMenuCloseTimeout]);

  const openSketchCanvasContextMenu = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, .save-menu")) {
        return;
      }

      const action = radialCanvasContextMenuAction({
        isCanvasTarget: Boolean(target.closest(".image-stage")),
        isInsideRadialMenu: Boolean(target.closest(".radial-tool-menu")),
        hasOpenRadialMenu: Boolean(radialToolMenu && !radialToolMenu.isClosing),
        activeTool: activeSketchTool
      });

      if (action === "ignore") {
        return;
      }

      event.preventDefault();
      if (action === "close") {
        closeRadialToolMenu();
        return;
      }

      if (needsSwbImport) {
        setStatus("Import external changes before editing");
        return;
      }

      if (activeSketchTool !== "brush" && activeSketchTool !== "eraser") {
        return;
      }

      openRadialToolMenu({
        tool: activeSketchTool,
        x: event.clientX,
        y: event.clientY
      });
    },
    [
      activeSketchTool,
      closeRadialToolMenu,
      needsSwbImport,
      openRadialToolMenu,
      radialToolMenu,
      setStatus
    ]
  );

  return {
    radialToolMenu,
    openRadialToolMenu,
    closeRadialToolMenu,
    openSketchCanvasContextMenu
  };
};
