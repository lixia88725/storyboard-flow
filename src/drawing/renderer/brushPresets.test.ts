import { describe, expect, it } from "vitest";
import {
  BRUSH_PRESET_IDS, DEFAULT_BRUSH, DEFAULT_ERASER, ERASER_PRESET_IDS, brushPreferencesKey,
  defaultBrushPreferences, parseBrushPreferences, preferenceFor, readBrushPreferences, strokeBrushFor,
  withFactoryPreference, withPreference, writeBrushPreferences,
} from "./brushPresets";

describe("brush presets", () => {
  it("ships four brushes and two erasers with distinct tips", () => {
    expect(BRUSH_PRESET_IDS).toHaveLength(4);
    expect(ERASER_PRESET_IDS).toHaveLength(2);
    const tips = BRUSH_PRESET_IDS.map(id => strokeBrushFor(id, 1).tip);
    expect(new Set(tips).size).toBe(4);
    expect(BRUSH_PRESET_IDS.includes(DEFAULT_BRUSH)).toBe(true);
    expect(ERASER_PRESET_IDS.includes(DEFAULT_ERASER)).toBe(true);
  });

  it("keeps spacing inside the renderer's usable range", () => {
    for (const id of [...BRUSH_PRESET_IDS, ...ERASER_PRESET_IDS]) {
      const brush = strokeBrushFor(id, 1);
      expect(brush.spacing).toBeGreaterThan(0);
      expect(brush.spacing).toBeLessThanOrEqual(0.25);
      expect(brush.seed).toBe(1);
    }
  });
});

describe("brush preferences", () => {
  const storage = () => {
    const map = new Map<string, string>();
    return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => void map.set(key, value) };
  };

  it("starts from factory values", () => {
    const preferences = defaultBrushPreferences();
    expect(preferences.pressure).toBe(true);
    expect(preferenceFor(preferences, "pencil")).toEqual({ size: 7, opacity: 1 });
  });

  it("remembers size and opacity per preset without touching the others", () => {
    let preferences = withPreference(defaultBrushPreferences(), "pencil", { size: 12 });
    preferences = withPreference(preferences, "charcoal", { opacity: 0.4 });
    expect(preferenceFor(preferences, "pencil")).toEqual({ size: 12, opacity: 1 });
    expect(preferenceFor(preferences, "charcoal")).toEqual({ size: 16, opacity: 0.4 });
    expect(preferenceFor(preferences, "hard")).toEqual({ size: 8, opacity: 1 });
  });

  it("restores only the current preset", () => {
    let preferences = withPreference(defaultBrushPreferences(), "pencil", { size: 40 });
    preferences = withPreference(preferences, "soft", { size: 60 });
    const restored = withFactoryPreference(preferences, "pencil");
    expect(preferenceFor(restored, "pencil")).toEqual({ size: 7, opacity: 1 });
    expect(preferenceFor(restored, "soft")).toEqual({ size: 60, opacity: 0.85 });
  });

  it("clamps instead of storing impossible values", () => {
    let preferences = withPreference(defaultBrushPreferences(), "hard", { size: 9999 });
    expect(preferenceFor(preferences, "hard").size).toBe(240);
    preferences = withPreference(preferences, "hard", { opacity: 0 });
    expect(preferenceFor(preferences, "hard").opacity).toBe(0.02);
  });

  it("falls back silently on damaged storage", () => {
    expect(parseBrushPreferences("{not json")).toEqual(defaultBrushPreferences());
    expect(parseBrushPreferences(JSON.stringify({ version: 99 }))).toEqual(defaultBrushPreferences());
    const parsed = parseBrushPreferences(JSON.stringify({ version: 1, pressure: false, presets: { pencil: { size: 9, opacity: 0.5 }, nope: { size: 1, opacity: 1 } } }));
    expect(parsed.pressure).toBe(false);
    expect(parsed.presets.pencil).toEqual({ size: 9, opacity: 0.5 });
    expect(Object.hasOwn(parsed.presets, "nope")).toBe(false);
  });

  it("round-trips through storage under its own key", () => {
    const store = storage();
    const written = withPreference(defaultBrushPreferences(), "pencil", { size: 15 });
    writeBrushPreferences(written, store);
    expect(store.map.has(brushPreferencesKey)).toBe(true);
    expect(readBrushPreferences(store)).toEqual(written);
  });

  it("keeps the pressure switch independent of the selected preset", () => {
    let preferences = withPreference(defaultBrushPreferences(), "charcoal", { size: 20 });
    preferences = { ...preferences, pressure: false };
    expect(preferenceFor(preferences, "pencil")).toEqual({ size: 7, opacity: 1 });
    expect(preferences.pressure).toBe(false);
  });
});

describe("brush size shortcuts", () => {
  it("maps [ and ] to one step and ignores modified or typing keys", async () => {
    const { brushSizeShortcutDelta, nextBrushSize } = await import("./brushPanel");
    expect(brushSizeShortcutDelta({ key: "[" })).toBe(-1);
    expect(brushSizeShortcutDelta({ key: "]" })).toBe(1);
    expect(brushSizeShortcutDelta({ key: "[", metaKey: true })).toBeUndefined();
    expect(brushSizeShortcutDelta({ key: "[", isComposing: true })).toBeUndefined();
    expect(brushSizeShortcutDelta({ key: "[", target: { tagName: "INPUT" } as unknown as EventTarget })).toBeUndefined();
    expect(brushSizeShortcutDelta({ key: "[", target: { tagName: "TEXTAREA" } as unknown as EventTarget })).toBeUndefined();
    expect(brushSizeShortcutDelta({ key: "a" })).toBeUndefined();
    expect(nextBrushSize(1, -1)).toBe(1);
    expect(nextBrushSize(9, 1)).toBe(10);
    expect(nextBrushSize(39, 1)).toBe(41);
    expect(nextBrushSize(99, 1)).toBe(104);
    expect(nextBrushSize(240, 1)).toBe(240);
  });
});
