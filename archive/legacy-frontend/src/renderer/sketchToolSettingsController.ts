import { useCallback, useState, type SetStateAction } from "react";
import type { StrokeTool } from "../shared/types";
import {
  applyRadialPresetSlot,
  type RadialDragKind,
  type RadialPresetSlot,
  type RadialToolSlot,
  type SketchToolSettings,
  type ToolRadialMenuConfig
} from "./toolRadialMenu";
import {
  nextRadialSlotConfig,
  nextRadialSlotsConfig,
  updateRadialDragSettings
} from "./radialToolMenuController";

export const defaultSketchToolSettings = (): SketchToolSettings => ({
  tool: "brush",
  brushColor: "#111111",
  brushSize: 4,
  brushOpacity: 1,
  brushSoftness: 0,
  eraserSize: 18,
  eraserOpacity: 1,
  eraserSoftness: 0
});

export const nextSketchToolSettingsForRadialPreset = (
  settings: SketchToolSettings,
  slot: RadialPresetSlot
): SketchToolSettings => applyRadialPresetSlot(settings, slot);

export const nextSketchToolSettingsForRadialDrag = (
  settings: SketchToolSettings,
  kind: RadialDragKind,
  value: number
): SketchToolSettings => updateRadialDragSettings(settings, kind, value);

export const nextToolRadialMenuConfig = (
  config: ToolRadialMenuConfig,
  tool: StrokeTool,
  index: number,
  slot: RadialToolSlot
): ToolRadialMenuConfig => nextRadialSlotConfig(config, tool, index, slot);

export const nextToolRadialMenuSlotsConfig = (
  config: ToolRadialMenuConfig,
  tool: StrokeTool,
  slots: RadialToolSlot[]
): ToolRadialMenuConfig => nextRadialSlotsConfig(config, tool, slots);

type UseSketchToolSettingsControllerOptions = {
  persistToolRadialMenuConfig: (config: ToolRadialMenuConfig) => void;
  toolRadialMenuConfig: ToolRadialMenuConfig;
};

export const useSketchToolSettingsController = ({
  persistToolRadialMenuConfig,
  toolRadialMenuConfig
}: UseSketchToolSettingsControllerOptions) => {
  const [settings, setSettings] = useState(defaultSketchToolSettings);
  const [blurRadius, setBlurRadius] = useState(8);
  const setSetting = useCallback(
    <Key extends keyof SketchToolSettings>(
      key: Key,
      value: SetStateAction<SketchToolSettings[Key]>
    ) => {
      setSettings((current) => ({
        ...current,
        [key]:
          typeof value === "function"
            ? (value as (currentValue: SketchToolSettings[Key]) => SketchToolSettings[Key])(current[key])
            : value
      }));
    },
    []
  );

  const applyRadialPreset = useCallback(
    (slot: RadialPresetSlot) => {
      setSettings((current) => nextSketchToolSettingsForRadialPreset(current, slot));
    },
    []
  );

  const adjustRadialToolValue = useCallback((kind: RadialDragKind, value: number) => {
    setSettings((current) => nextSketchToolSettingsForRadialDrag(current, kind, value));
  }, []);

  const updateRadialSlot = useCallback(
    (tool: StrokeTool, index: number, slot: RadialToolSlot) => {
      persistToolRadialMenuConfig(nextToolRadialMenuConfig(toolRadialMenuConfig, tool, index, slot));
    },
    [persistToolRadialMenuConfig, toolRadialMenuConfig]
  );

  const updateRadialSlots = useCallback(
    (tool: StrokeTool, slots: RadialToolSlot[]) => {
      persistToolRadialMenuConfig(nextToolRadialMenuSlotsConfig(toolRadialMenuConfig, tool, slots));
    },
    [persistToolRadialMenuConfig, toolRadialMenuConfig]
  );

  return {
    activeSketchTool: settings.tool,
    adjustRadialToolValue,
    applyRadialPreset,
    blurRadius,
    brushColor: settings.brushColor,
    brushOpacity: settings.brushOpacity,
    brushSize: settings.brushSize,
    brushSoftness: settings.brushSoftness,
    currentSketchToolSettings: settings,
    eraserOpacity: settings.eraserOpacity,
    eraserSize: settings.eraserSize,
    eraserSoftness: settings.eraserSoftness,
    setActiveSketchTool: (tool: SetStateAction<SketchToolSettings["tool"]>) =>
      setSetting("tool", tool),
    setBlurRadius,
    setBrushColor: (brushColor: SetStateAction<string>) => setSetting("brushColor", brushColor),
    setBrushOpacity: (brushOpacity: SetStateAction<number>) =>
      setSetting("brushOpacity", brushOpacity),
    setBrushSize: (brushSize: SetStateAction<number>) => setSetting("brushSize", brushSize),
    setEraserOpacity: (eraserOpacity: SetStateAction<number>) =>
      setSetting("eraserOpacity", eraserOpacity),
    setEraserSize: (eraserSize: SetStateAction<number>) => setSetting("eraserSize", eraserSize),
    updateRadialSlot,
    updateRadialSlots
  };
};
