import type { CSSProperties, Dispatch, SetStateAction } from "react";
import type { SketchTool } from "../shared/types";
import { ShortcutMenuButton } from "./ShortcutMenuButton";
import {
  BlurIcon,
  BrushIcon,
  ClearIcon,
  EraserIcon,
  EyedropperIcon,
  SelectIcon,
  SwatchIcon
} from "./icons";

type ToolRailProps = {
  activeSketchTool: SketchTool;
  blurRadius: number;
  brushColor: string;
  closeRadialToolMenu: () => void;
  onApplyBlur: () => void;
  onClearCurrentLayer: () => void;
  setActiveSketchTool: Dispatch<SetStateAction<SketchTool>>;
  setBlurRadius: Dispatch<SetStateAction<number>>;
  setBrushColor: Dispatch<SetStateAction<string>>;
};

export const ToolRail = ({
  activeSketchTool,
  blurRadius,
  brushColor,
  closeRadialToolMenu,
  onApplyBlur,
  onClearCurrentLayer,
  setActiveSketchTool,
  setBlurRadius,
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
    <div className="blur-tool-container">
      <button
        type="button"
        className={activeSketchTool === "blur" ? "selected" : ""}
        onClick={() => {
          setActiveSketchTool("blur");
          closeRadialToolMenu();
        }}
        title="Blur"
        aria-label="Blur"
      >
        <BlurIcon />
      </button>
      {activeSketchTool === "blur" ? (
        <div className="blur-tool-settings" aria-label="Blur settings">
          <div className="blur-tool-settings-heading">
            <span>Gaussian blur</span>
            <output htmlFor="blur-radius">{blurRadius}px</output>
          </div>
          <input
            id="blur-radius"
            aria-label="Gaussian blur radius"
            type="range"
            min={1}
            max={50}
            step={1}
            value={blurRadius}
            onChange={(event) => setBlurRadius(Number(event.target.value))}
          />
          <button type="button" className="blur-tool-apply" onClick={onApplyBlur}>
            Apply to current layer
          </button>
        </div>
      ) : null}
    </div>
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
