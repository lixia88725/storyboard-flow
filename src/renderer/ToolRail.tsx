import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type { SketchTool } from "../shared/types";
import { ShortcutMenuButton } from "./ShortcutMenuButton";
import {
  BrushIcon,
  ClearIcon,
  EraserIcon,
  EyedropperIcon,
  SelectIcon,
  SwatchIcon
} from "./icons";

type ToolRailProps = {
  activeSketchTool: SketchTool;
  brushColor: string;
  closeRadialToolMenu: () => void;
  onClearCurrentLayer: () => void;
  setActiveSketchTool: Dispatch<SetStateAction<SketchTool>>;
  setBrushColor: Dispatch<SetStateAction<string>>;
};

export const ToolRail = ({
  activeSketchTool,
  brushColor,
  closeRadialToolMenu,
  onClearCurrentLayer,
  setActiveSketchTool,
  setBrushColor
}: ToolRailProps) => (
  <aside className="tool-rail" aria-label="Sketch tools">
    <ShortcutMenuButton />
    <button
      type="button"
      className={activeSketchTool === "brush" ? "selected" : ""}
      onClick={() => {
        setActiveSketchTool("brush");
        closeRadialToolMenu();
      }}
      onContextMenu={(event) => event.preventDefault()}
      title="Brush"
      aria-label="Brush"
    >
      <BrushIcon />
    </button>
    <button
      type="button"
      className={activeSketchTool === "eraser" ? "selected" : ""}
      onClick={() => {
        setActiveSketchTool("eraser");
        closeRadialToolMenu();
      }}
      onContextMenu={(event) => event.preventDefault()}
      title="Eraser"
      aria-label="Eraser"
    >
      <EraserIcon />
    </button>
    <button
      type="button"
      className={activeSketchTool === "eyedropper" ? "selected" : ""}
      onClick={() => {
        setActiveSketchTool("eyedropper");
        closeRadialToolMenu();
      }}
      title="Eyedropper"
      aria-label="Eyedropper"
    >
      <EyedropperIcon />
    </button>
    <button
      type="button"
      className={activeSketchTool === "select" ? "selected" : ""}
      onClick={() => {
        setActiveSketchTool("select");
        closeRadialToolMenu();
      }}
      title="Select"
      aria-label="Select"
    >
      <SelectIcon />
    </button>
    <button
      type="button"
      onClick={onClearCurrentLayer}
      title="Clear current layer"
      aria-label="Clear current layer"
    >
      <ClearIcon />
    </button>
    <label
      className="color-control"
      title="Brush color"
      style={{ "--brush-swatch-color": brushColor } as CSSProperties}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-storyboard-fill-color", brushColor);
      }}
    >
      <input
        aria-label="Brush color"
        type="color"
        value={brushColor}
        onChange={(event) => setBrushColor(event.target.value)}
      />
      <SwatchIcon />
    </label>
  </aside>
);
