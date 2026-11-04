/**
 * Brush panel: the only place the six presets are chosen and tuned.
 *
 * Opened next to the pointer by right-click on a drawable surface, or reused by the
 * tool rail for the size field. Every thumbnail is drawn by the same renderer the
 * canvas uses, with fixed synthetic input, so it is a stroke sample and not a fake
 * pressure reading.
 */
import { useEffect, useRef, type CSSProperties } from "react";
import "./brushPanel.css";
import {
  BRUSH_PRESETS, BRUSH_PRESET_IDS, ERASER_PRESET_IDS, MAX_BRUSH_SIZE, MIN_BRUSH_OPACITY,
  preferenceFor, presetIdsForTool, strokeBrushFor, withFactoryPreference, withPreference,
  type BrushPreference, type BrushPreferences, type BrushPresetId,
} from "./brushPresets";
import { paintBrushStroke } from "./brushStroke";
import type { StrokeBrush } from "../contracts/types";

export type BrushPanelAnchor = { x: number; y: number };

type Props = {
  tool: "brush" | "eraser";
  preferences: BrushPreferences;
  disabled?: boolean;
  anchor?: BrushPanelAnchor;
  onChange: (next: BrushPreferences) => void;
  onClose: () => void;
};

/** Sample geometry: an S-curve so the eye reads the tip, not a straight smear. */
const samplePoints = (width: number): { points: number[]; pressures: number[] } => {
  const points: number[] = [], pressures: number[] = [];
  const count = 24;
  for (let index = 0; index < count; index++) {
    const t = index / (count - 1);
    points.push(t * width, width * 0.18 + Math.sin(t * Math.PI * 2) * width * 0.11);
    pressures.push(0.35 + 0.65 * Math.sin(t * Math.PI));
  }
  return { points, pressures };
};

const drawSample = (canvas: HTMLCanvasElement, brush: StrokeBrush, size: number, opacity: number, color: string) => {
  const context = canvas.getContext("2d");
  if (!context) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth || 180, height = canvas.clientHeight || 44;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  const { points, pressures } = samplePoints(width - 24);
  paintBrushStroke(context, {
    tool: "brush", color: color || "#e8ecf2",
    // Keep the sample inside the strip: large presets are drawn at a readable scale
    // rather than cropped, and the panel states the real size separately.
    size: Math.min(size, height * 0.55),
    opacity: Math.max(0.25, opacity),
    points: points.map((value, index) => (index % 2 === 0 ? value + 12 : value)),
    pressures,
    brush,
  });
};

const SampleStroke = (p: { brush: StrokeBrush; size: number; opacity: number; color: string; className?: string }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawSample(ref.current, p.brush, p.size, p.opacity, p.color);
  }, [p.brush, p.size, p.opacity, p.color]);
  return <canvas ref={ref} className={p.className ?? "wb-brush-sample"} aria-hidden="true" />;
};

const clampAnchor = (anchor: BrushPanelAnchor | undefined): CSSProperties => {
  if (!anchor) return { left: 24, top: 96 };
  const width = 268, height = 286;
  const left = Math.min(Math.max(8, anchor.x + 6), Math.max(8, window.innerWidth - width - 8));
  const top = Math.min(Math.max(8, anchor.y + 6), Math.max(8, window.innerHeight - height - 8));
  return { left, top };
};

export function BrushPanel({ tool, preferences, disabled, anchor, onChange, onClose }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const presetId = tool === "eraser" ? preferences.eraser : preferences.brush;
  const preset = BRUSH_PRESETS[presetId];
  const value = preferenceFor(preferences, presetId);
  const ids = presetIdsForTool(tool);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    };
    // A click anywhere outside closes without reaching the canvas, so closing the panel
    // never paints a stroke.
    const onPointer = (event: PointerEvent) => {
      if (root.current && event.target instanceof Node && !root.current.contains(event.target)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onPointer, true);
    };
  }, [onClose]);

  const update = (patch: Partial<BrushPreference>) => onChange(withPreference(preferences, presetId, patch));
  const select = (id: BrushPresetId) => onChange(tool === "eraser"
    ? { ...preferences, eraser: id }
    : { ...preferences, brush: id });

  return <div ref={root} className="wb-brush-panel" style={clampAnchor(anchor)} role="dialog" aria-label="画笔"
    onContextMenu={event => event.preventDefault()}>
    <header>
      <span>{tool === "eraser" ? "橡皮" : "画笔"}</span>
      <button type="button" aria-label="关闭画笔面板" onClick={onClose}>×</button>
    </header>

    <div className="wb-brush-panel-main">
      <div className="wb-brush-preview">
        <SampleStroke brush={strokeBrushFor(presetId, 11)} size={value.size} opacity={value.opacity} color="#e8ecf2" />
        <span>{preset.label}</span>
      </div>
      <div className="wb-brush-fields">
        <label>大小
          <input type="range" min={1} max={MAX_BRUSH_SIZE} value={value.size} disabled={disabled}
            onChange={event => update({ size: Number(event.target.value) })} aria-label="画笔大小" />
          <input type="number" min={1} max={MAX_BRUSH_SIZE} value={value.size} disabled={disabled}
            onChange={event => update({ size: Number(event.target.value) })} aria-label="画笔大小数值" />
        </label>
        <label>透明度
          <input type="range" min={MIN_BRUSH_OPACITY * 100} max={100} value={Math.round(value.opacity * 100)} disabled={disabled}
            onChange={event => update({ opacity: Number(event.target.value) / 100 })} aria-label="画笔透明度" />
          <input type="number" min={MIN_BRUSH_OPACITY * 100} max={100} value={Math.round(value.opacity * 100)} disabled={disabled}
            onChange={event => update({ opacity: Number(event.target.value) / 100 })} aria-label="画笔透明度数值" />
        </label>
      </div>
    </div>

    <div className="wb-brush-presets">
      {ids.map(id => <button key={id} type="button" aria-pressed={id === presetId} disabled={disabled}
        onClick={() => select(id)} title={BRUSH_PRESETS[id].label}>
        <SampleStroke brush={strokeBrushFor(id, 7)} size={Math.min(preferenceFor(preferences, id).size, 14)} opacity={1} color="#cfd6df" className="wb-brush-thumb" />
        <span>{BRUSH_PRESETS[id].label}</span>
      </button>)}
    </div>

    <footer>
      <label className="wb-brush-pressure">
        <input type="checkbox" checked={preferences.pressure} disabled={disabled}
          onChange={event => onChange({ ...preferences, pressure: event.target.checked })} />
        压感
      </label>
      <button type="button" className="wb-brush-reset" disabled={disabled}
        onClick={() => onChange(withFactoryPreference(preferences, presetId))}>恢复默认</button>
    </footer>
  </div>;
}

/** `[` shrinks and `]` grows the active preset; text fields and IME keep their keys. */
export const brushSizeShortcutDelta = (event: {
  key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean; isComposing?: boolean;
  target?: EventTarget | null;
}): number | undefined => {
  if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return undefined;
  const target = event.target as { tagName?: string; isContentEditable?: boolean } | null;
  if (target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName ?? ""))) return undefined;
  if (event.key === "[") return -1;
  if (event.key === "]") return 1;
  return undefined;
};

/** Small sizes step by one, large ones faster; the exact feel still needs a tablet test. */
export const nextBrushSize = (size: number, direction: number): number => {
  const step = size < 10 ? 1 : size < 40 ? 2 : size < 100 ? 5 : 10;
  return Math.min(MAX_BRUSH_SIZE, Math.max(1, Math.round(size) + step * direction));
};

export const BRUSH_PRESET_LABELS = Object.fromEntries(
  [...BRUSH_PRESET_IDS, ...ERASER_PRESET_IDS].map(id => [id, BRUSH_PRESETS[id].label])
) as Record<BrushPresetId, string>;
