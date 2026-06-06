import type { SketchTool, StrokeTool } from "../shared/types";

export type RadialDragKind = "size" | "opacity" | "softness";
export type RadialSlotType = "preset" | "size-drag" | "opacity-drag" | "softness-drag" | "empty";

export type RadialPresetSlot = {
  id: string;
  type: "preset";
  label: string;
  tool: StrokeTool;
  color?: string;
  applyColor?: boolean;
  size?: number;
  applySize?: boolean;
  opacity?: number;
  applyOpacity?: boolean;
  softness?: number;
  applySoftness?: boolean;
};

export type RadialDragSlot = {
  id: string;
  type: "size-drag" | "opacity-drag" | "softness-drag";
  label: string;
};

export type RadialEmptySlot = {
  id: string;
  type: "empty";
  label?: string;
};

export type RadialToolSlot = RadialPresetSlot | RadialDragSlot | RadialEmptySlot;

export type RadialToolMenu = {
  slots: RadialToolSlot[];
};

export type ToolRadialMenuConfig = {
  brush: RadialToolMenu;
  eraser: RadialToolMenu;
};

export type SketchToolSettings = {
  tool: SketchTool;
  brushColor: string;
  brushSize: number;
  brushOpacity: number;
  brushSoftness: number;
  eraserSize: number;
  eraserOpacity: number;
  eraserSoftness: number;
};

export type RadialDragListenerTarget = {
  addEventListener: (
    type: "pointermove" | "pointerup",
    listener: EventListener,
    options?: AddEventListenerOptions
  ) => void;
  removeEventListener: (type: "pointermove" | "pointerup", listener: EventListener) => void;
};

const radialSlotCount = 8;
export const radialPresetApplyDelayMs = 360;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const roundedUnit = (value: number): number => Math.round(value * 1000) / 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStrokeTool = (value: unknown): value is StrokeTool => value === "brush" || value === "eraser";

const normalizedString = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.trim() ? value : fallback;

const normalizedColor = (value: unknown): string | undefined =>
  typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value : undefined;

const normalizedOptionalNumber = (value: unknown, min: number, max: number): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : undefined;

const defaultBrushSlots = (): RadialToolSlot[] => [
  {
    id: "brush-red",
    type: "preset",
    label: "Red",
    tool: "brush",
    color: "#ff5a2a",
    applyColor: true,
    size: 12,
    applySize: true,
    opacity: 1,
    applyOpacity: true,
    softness: 0,
    applySoftness: false
  },
  { id: "brush-size", type: "size-drag", label: "Size" },
  {
    id: "brush-black",
    type: "preset",
    label: "Black",
    tool: "brush",
    color: "#111111",
    applyColor: true
  },
  { id: "brush-opacity", type: "opacity-drag", label: "Opacity" },
  {
    id: "brush-white",
    type: "preset",
    label: "White",
    tool: "brush",
    color: "#ffffff",
    applyColor: true
  },
  { id: "brush-softness", type: "softness-drag", label: "Soft" },
  { id: "brush-empty-7", type: "empty" },
  { id: "brush-empty-8", type: "empty" }
];

const defaultEraserSlots = (): RadialToolSlot[] => [
  {
    id: "eraser-soft",
    type: "preset",
    label: "Soft",
    tool: "eraser",
    softness: 0.75,
    applySoftness: true
  },
  { id: "eraser-size", type: "size-drag", label: "Size" },
  {
    id: "eraser-hard",
    type: "preset",
    label: "Hard",
    tool: "eraser",
    softness: 0,
    applySoftness: true
  },
  { id: "eraser-opacity", type: "opacity-drag", label: "Opacity" },
  {
    id: "eraser-light",
    type: "preset",
    label: "Light",
    tool: "eraser",
    opacity: 0.35,
    applyOpacity: true
  },
  { id: "eraser-softness", type: "softness-drag", label: "Soft" },
  { id: "eraser-empty-7", type: "empty" },
  { id: "eraser-empty-8", type: "empty" }
];

export const defaultToolRadialMenuConfig = (): ToolRadialMenuConfig => ({
  brush: { slots: defaultBrushSlots() },
  eraser: { slots: defaultEraserSlots() }
});

const normalizeSlot = (slot: unknown, fallback: RadialToolSlot): RadialToolSlot => {
  if (!isRecord(slot)) {
    return fallback;
  }

  const type = slot.type;
  const id = normalizedString(slot.id, fallback.id);

  if (type === "empty") {
    return { id, type: "empty", label: typeof slot.label === "string" ? slot.label : undefined };
  }

  if (type === "size-drag" || type === "opacity-drag" || type === "softness-drag") {
    return { id, type, label: normalizedString(slot.label, fallback.label ?? "Adjust") };
  }

  if (type !== "preset" || !isStrokeTool(slot.tool)) {
    return { id, type: "empty" };
  }

  const color = slot.tool === "brush" ? normalizedColor(slot.color) : undefined;

  return {
    id,
    type: "preset",
    label: normalizedString(slot.label, fallback.label ?? "Preset"),
    tool: slot.tool,
    color,
    applyColor: slot.tool === "brush" && color !== undefined && slot.applyColor === true,
    size: typeof slot.size === "number" && Number.isFinite(slot.size) && slot.size > 0 ? slot.size : undefined,
    applySize: slot.applySize === true,
    opacity: normalizedOptionalNumber(slot.opacity, 0.2, 1),
    applyOpacity: slot.applyOpacity === true,
    softness: normalizedOptionalNumber(slot.softness, 0, 1),
    applySoftness: slot.applySoftness === true
  };
};

const normalizeMenu = (menu: unknown, fallbackSlots: RadialToolSlot[]): RadialToolMenu => {
  const slots = isRecord(menu) && Array.isArray(menu.slots) ? menu.slots : [];
  return {
    slots: Array.from({ length: radialSlotCount }, (_value, index) =>
      normalizeSlot(slots[index], fallbackSlots[index] ?? { id: `empty-${index}`, type: "empty" })
    )
  };
};

export const normalizeToolRadialMenuConfig = (value: unknown): ToolRadialMenuConfig => {
  const defaults = defaultToolRadialMenuConfig();
  const root = isRecord(value) ? value : {};
  return {
    brush: normalizeMenu(root.brush, defaults.brush.slots),
    eraser: normalizeMenu(root.eraser, defaults.eraser.slots)
  };
};

export const applyRadialPresetSlot = (
  settings: SketchToolSettings,
  slot: RadialPresetSlot
): SketchToolSettings => {
  const next: SketchToolSettings = { ...settings, tool: slot.tool };

  if (slot.tool === "brush") {
    if (slot.applyColor && slot.color) {
      next.brushColor = slot.color;
    }
    if (slot.applySize && slot.size !== undefined) {
      next.brushSize = slot.size;
    }
    if (slot.applyOpacity && slot.opacity !== undefined) {
      next.brushOpacity = slot.opacity;
    }
    if (slot.applySoftness && slot.softness !== undefined) {
      next.brushSoftness = slot.softness;
    }
  } else {
    if (slot.applySize && slot.size !== undefined) {
      next.eraserSize = slot.size;
    }
    if (slot.applyOpacity && slot.opacity !== undefined) {
      next.eraserOpacity = slot.opacity;
    }
    if (slot.applySoftness && slot.softness !== undefined) {
      next.eraserSoftness = slot.softness;
    }
  }

  return next;
};

export const radialDragValue = ({
  kind,
  initial,
  deltaX,
  min,
  max
}: {
  kind: RadialDragKind;
  initial: number;
  deltaX: number;
  min: number;
  max: number;
}): number => {
  if (kind === "size") {
    return Math.round(clamp(initial + deltaX / 10, min, max));
  }

  return roundedUnit(clamp(initial + deltaX / 200, min, max));
};

export type RadialDragPreviewState = {
  label: string;
  diameter: number;
  opacity: number;
  softness: number;
};

export const radialDragPreviewState = ({
  kind,
  value,
  min,
  max
}: {
  kind: RadialDragKind;
  value: number;
  min: number;
  max: number;
}): RadialDragPreviewState => {
  const clampedValue = clamp(value, min, max);

  if (kind === "size") {
    const range = Math.max(1, max - min);
    const progress = (clampedValue - min) / range;
    return {
      label: `${Math.round(clampedValue)}px`,
      diameter: Math.round(22 + progress * 35),
      opacity: 1,
      softness: 0
    };
  }

  return {
    label: `${Math.round(clampedValue * 100)}%`,
    diameter: 34,
    opacity: kind === "opacity" ? roundedUnit(clampedValue) : 1,
    softness: kind === "softness" ? roundedUnit(clampedValue) : 0
  };
};

export const shouldApplyRadialPresetClick = (clickDetail: number): boolean => clickDetail === 1;

export const shouldCloseRadialMenuFromOutsidePointerDown = ({
  button,
  isPrimary
}: {
  button?: number;
  isPrimary?: boolean;
}): boolean => (button === undefined || button === 0) && isPrimary !== false;

export const registerRadialDragListeners = (
  target: RadialDragListenerTarget,
  onPointerMove: (event: PointerEvent) => void,
  onPointerUp: () => void
): (() => void) => {
  let cleanedUp = false;
  const handlePointerMove: EventListener = (event) => {
    onPointerMove(event as PointerEvent);
  };
  const handlePointerUp: EventListener = () => {
    onPointerUp();
    cleanup();
  };
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;
    target.removeEventListener("pointermove", handlePointerMove);
    target.removeEventListener("pointerup", handlePointerUp);
  };

  target.addEventListener("pointermove", handlePointerMove);
  target.addEventListener("pointerup", handlePointerUp, { once: true });
  return cleanup;
};

export type RadialCanvasContextMenuAction = "open" | "close" | "ignore";

export const radialCanvasContextMenuAction = ({
  isCanvasTarget,
  isInsideRadialMenu,
  hasOpenRadialMenu,
  activeTool
}: {
  isCanvasTarget: boolean;
  isInsideRadialMenu: boolean;
  hasOpenRadialMenu: boolean;
  activeTool: SketchTool;
}): RadialCanvasContextMenuAction => {
  if (!isCanvasTarget || isInsideRadialMenu) {
    return "ignore";
  }

  if (hasOpenRadialMenu || activeTool === "select") {
    return "close";
  }

  return "open";
};
