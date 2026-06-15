import type { StrokeTool } from "../shared/types";
import {
  normalizeToolRadialMenuConfig,
  type RadialDragKind,
  type RadialToolSlot,
  type SketchToolSettings,
  type ToolRadialMenuConfig
} from "./toolRadialMenu";

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
