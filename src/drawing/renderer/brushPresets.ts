/**
 * Brush presets and their user-level preferences.
 *
 * Five presets ship: three brushes (hard, soft, pencil) and two erasers (hard, soft).
 * Charcoal was removed: at shipped sizes it read as a rougher pencil rather than a
 * distinct tool, and a preset that behaves like another one only adds choices. Each remembers its own last size and opacity; that is a tool
 * preference of the person drawing, not project data, so it lives in localStorage
 * next to the workspace layout and never enters the project file.
 *
 * The factory values are starting points, not tuned numbers: the pressure response
 * has to be checked with a real tablet before it can be called good.
 */
import type { StrokeBrush } from "./brushStroke";
import type { BrushTipKind } from "./brushTips";

export type BrushPresetId = "hard" | "soft" | "pencil" | "eraser-hard" | "eraser-soft";

export type BrushPreset = {
  id: BrushPresetId;
  label: string;
  tool: "brush" | "eraser";
  tip: BrushTipKind;
  hardness: number;
  grain: number;
  spacing: number;
  pressureSize: number;
  pressureOpacity: number;
  factory: { size: number; opacity: number };
};

const preset = (value: BrushPreset): BrushPreset => value;

export const BRUSH_PRESETS: Record<BrushPresetId, BrushPreset> = {
  hard: preset({ id: "hard", label: "硬画笔", tool: "brush", tip: "hard", hardness: 0.95, grain: 0,
    spacing: 0.06, pressureSize: 0.55, pressureOpacity: 0.25, factory: { size: 8, opacity: 1 } }),
  soft: preset({ id: "soft", label: "软画笔", tool: "brush", tip: "soft", hardness: 0.06, grain: 0,
    spacing: 0.05, pressureSize: 0.3, pressureOpacity: 0.6, factory: { size: 36, opacity: 0.85 } }),
  pencil: preset({ id: "pencil", label: "铅笔", tool: "brush", tip: "pencil", hardness: 0.5, grain: 0.55,
    spacing: 0.035, pressureSize: 0.45, pressureOpacity: 0.6, factory: { size: 7, opacity: 1 } }),
  "eraser-hard": preset({ id: "eraser-hard", label: "硬橡皮", tool: "eraser", tip: "hard", hardness: 0.9, grain: 0,
    spacing: 0.06, pressureSize: 0.6, pressureOpacity: 0, factory: { size: 24, opacity: 1 } }),
  "eraser-soft": preset({ id: "eraser-soft", label: "软橡皮", tool: "eraser", tip: "soft", hardness: 0.1, grain: 0,
    spacing: 0.05, pressureSize: 0.2, pressureOpacity: 0.7, factory: { size: 44, opacity: 0.6 } }),
};

export const BRUSH_PRESET_IDS: readonly BrushPresetId[] = ["hard", "soft", "pencil"];
export const ERASER_PRESET_IDS: readonly BrushPresetId[] = ["eraser-hard", "eraser-soft"];
export const DEFAULT_BRUSH: BrushPresetId = "pencil";
export const DEFAULT_ERASER: BrushPresetId = "eraser-hard";

export const MIN_BRUSH_SIZE = 1;
export const MAX_BRUSH_SIZE = 240;
export const MIN_BRUSH_OPACITY = 0.02;

export const presetIdsForTool = (tool: "brush" | "eraser"): readonly BrushPresetId[] =>
  tool === "eraser" ? ERASER_PRESET_IDS : BRUSH_PRESET_IDS;

export const isBrushPresetId = (value: unknown): value is BrushPresetId =>
  typeof value === "string" && Object.hasOwn(BRUSH_PRESETS, value);

export const clampBrushSize = (size: number): number =>
  Math.min(MAX_BRUSH_SIZE, Math.max(MIN_BRUSH_SIZE, Math.round(Number.isFinite(size) ? size : MIN_BRUSH_SIZE)));

export const clampBrushOpacity = (opacity: number): number =>
  Math.min(1, Math.max(MIN_BRUSH_OPACITY, Number.isFinite(opacity) ? Math.round(opacity * 100) / 100 : 1));

/** Serialisable brush settings attached to a stroke; carries no UI state. */
export const strokeBrushFor = (id: BrushPresetId, seed: number): StrokeBrush => {
  const value = BRUSH_PRESETS[id];
  return { tip: value.tip, spacing: value.spacing, hardness: value.hardness, grain: value.grain,
    seed: seed >>> 0, pressureSize: value.pressureSize, pressureOpacity: value.pressureOpacity };
};

export type BrushPreference = { size: number; opacity: number };

export type BrushPreferences = {
  /** Global pressure switch; one state for every preset. */
  pressure: boolean;
  presets: Partial<Record<BrushPresetId, BrushPreference>>;
  brush: BrushPresetId;
  eraser: BrushPresetId;
};

export const brushPreferencesKey = "flow.brush.v1";

export const defaultBrushPreferences = (): BrushPreferences => ({
  pressure: true,
  presets: {},
  brush: DEFAULT_BRUSH,
  eraser: DEFAULT_ERASER,
});

const validPreference = (value: unknown): value is BrushPreference => {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { size?: unknown; opacity?: unknown };
  return typeof candidate.size === "number" && Number.isFinite(candidate.size) &&
    typeof candidate.opacity === "number" && Number.isFinite(candidate.opacity);
};

/** Strict parse with a silent fall back to defaults, like the workspace layout. */
export const parseBrushPreferences = (raw: string | null): BrushPreferences => {
  const fallback = defaultBrushPreferences();
  if (!raw) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return fallback;
    const candidate = value as Partial<BrushPreferences> & { version?: unknown };
    if (candidate.version !== undefined && candidate.version !== 1) return fallback;

    const presets: Partial<Record<BrushPresetId, BrushPreference>> = {};
    const source = candidate.presets;
    if (source && typeof source === "object") {
      for (const [id, entry] of Object.entries(source)) {
        if (!isBrushPresetId(id) || !validPreference(entry)) continue;
        presets[id] = { size: clampBrushSize(entry.size), opacity: clampBrushOpacity(entry.opacity) };
      }
    }

    return {
      pressure: typeof candidate.pressure === "boolean" ? candidate.pressure : true,
      presets,
      brush: isBrushPresetId(candidate.brush) && BRUSH_PRESETS[candidate.brush].tool === "brush" ? candidate.brush : DEFAULT_BRUSH,
      eraser: isBrushPresetId(candidate.eraser) && BRUSH_PRESETS[candidate.eraser].tool === "eraser" ? candidate.eraser : DEFAULT_ERASER,
    };
  } catch {
    return fallback;
  }
};

export const readBrushPreferences = (storage?: Pick<Storage, "getItem">): BrushPreferences => {
  try {
    const source = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    return parseBrushPreferences(source ? source.getItem(brushPreferencesKey) : null);
  } catch {
    return defaultBrushPreferences();
  }
};

export const writeBrushPreferences = (value: BrushPreferences, storage?: Pick<Storage, "setItem">): void => {
  try {
    const target = storage ?? (typeof localStorage === "undefined" ? undefined : localStorage);
    target?.setItem(brushPreferencesKey, JSON.stringify({ version: 1, ...value }));
  } catch {
    /* Preferences stay usable for this session when profile storage is unavailable. */
  }
};

export const preferenceFor = (preferences: BrushPreferences, id: BrushPresetId): BrushPreference => {
  const stored = preferences.presets[id];
  const factory = BRUSH_PRESETS[id].factory;
  return stored ? { size: stored.size, opacity: stored.opacity } : { size: factory.size, opacity: factory.opacity };
};

export const withPreference = (preferences: BrushPreferences, id: BrushPresetId, patch: Partial<BrushPreference>): BrushPreferences => {
  const current = preferenceFor(preferences, id);
  const next: BrushPreference = {
    size: patch.size === undefined ? current.size : clampBrushSize(patch.size),
    opacity: patch.opacity === undefined ? current.opacity : clampBrushOpacity(patch.opacity),
  };
  return { ...preferences, presets: { ...preferences.presets, [id]: next } };
};

/** "Restore defaults" clears only the preset the user is looking at. */
export const withFactoryPreference = (preferences: BrushPreferences, id: BrushPresetId): BrushPreferences => {
  const presets = { ...preferences.presets };
  delete presets[id];
  return { ...preferences, presets };
};
