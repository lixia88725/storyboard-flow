export type ShortcutAction =
  | "brush"
  | "eraser"
  | "select"
  | "clearLayer"
  | "mergeDown"
  | "save"
  | "addShot"
  | "onionSkin"
  | "decreaseBrushSize"
  | "increaseBrushSize"
  | "decreaseBrushOpacity"
  | "increaseBrushOpacity"
  | "previousShot"
  | "nextShot"
  | "undo"
  | "redo";

export type KeyboardShortcuts = Record<ShortcutAction, string>;

type ShortcutPlatform = "darwin" | "win32" | "linux" | string;

const detectedPlatform = (): ShortcutPlatform => {
  const platform = globalThis.navigator?.platform.toLowerCase() ?? "";
  if (platform.includes("mac")) {
    return "darwin";
  }
  if (platform.includes("win")) {
    return "win32";
  }
  if (platform.includes("linux")) {
    return "linux";
  }
  return "darwin";
};

export const defaultKeyboardShortcutsForPlatform = (
  platform: ShortcutPlatform = detectedPlatform()
): KeyboardShortcuts => {
  const primaryModifier = platform === "darwin" ? "Cmd" : "Ctrl";

  return {
    brush: "B",
    eraser: "E",
    select: "V",
    clearLayer: "Escape",
    mergeDown: `${primaryModifier}+E`,
    save: `${primaryModifier}+S`,
    addShot: "A",
    onionSkin: "O",
    decreaseBrushSize: "1",
    increaseBrushSize: "2",
    decreaseBrushOpacity: "3",
    increaseBrushOpacity: "4",
    previousShot: "ArrowLeft",
    nextShot: "ArrowRight",
    undo: `${primaryModifier}+Z`,
    redo: `Shift+${primaryModifier}+Z`
  };
};

export const defaultKeyboardShortcuts: KeyboardShortcuts = defaultKeyboardShortcutsForPlatform();

export const shortcutActions = Object.keys(defaultKeyboardShortcuts) as ShortcutAction[];

export const adjustSketchShortcutValue = (
  value: number,
  direction: "decrease" | "increase",
  amount: number,
  min: number,
  max: number
): number => {
  const isUnitValue = max <= 1;
  const rawValue = isUnitValue
    ? direction === "decrease"
      ? value - amount
      : value + amount
    : direction === "decrease"
      ? Math.floor(value * (1 - amount))
      : Math.ceil(value * (1 + amount));
  const precision = isUnitValue ? 100 : 1;
  const roundedValue = Math.round(rawValue * precision) / precision;
  return Math.min(max, Math.max(min, roundedValue));
};

const keyLabel = (key: string): string => {
  if (key.length === 1) {
    return key.toUpperCase();
  }

  if (key === " ") {
    return "Space";
  }

  return key;
};

export const formatShortcutFromKeyboardEvent = (event: KeyboardEvent): string => {
  const key = keyLabel(event.key);
  if (["Shift", "Meta", "Control", "Alt"].includes(key)) {
    return "";
  }

  const parts = [
    event.shiftKey ? "Shift" : undefined,
    event.metaKey ? "Cmd" : undefined,
    event.ctrlKey ? "Ctrl" : undefined,
    event.altKey ? "Alt" : undefined,
    key
  ].filter((part): part is string => Boolean(part));

  return parts.join("+");
};

export const normalizeShortcutValue = (shortcut: string): string => {
  const parts = shortcut
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts.at(-1);

  if (!key) {
    return "";
  }

  const modifiers = new Set(parts.slice(0, -1).map((part) => part.toLowerCase()));
  return [
    modifiers.has("shift") ? "Shift" : undefined,
    modifiers.has("cmd") || modifiers.has("meta") ? "Cmd" : undefined,
    modifiers.has("ctrl") || modifiers.has("control") ? "Ctrl" : undefined,
    modifiers.has("alt") || modifiers.has("option") ? "Alt" : undefined,
    keyLabel(key)
  ]
    .filter(Boolean)
    .join("+");
};

export const keyboardEventMatchesShortcut = (event: KeyboardEvent, shortcut: string | undefined): boolean => {
  if (typeof shortcut !== "string") {
    return false;
  }

  const normalized = normalizeShortcutValue(shortcut);
  return normalized !== "" && formatShortcutFromKeyboardEvent(event) === normalized;
};

export const historyActionFromKeyboardEvent = (
  event: KeyboardEvent
): "undo" | "redo" | undefined => {
  if (event.key.toLowerCase() !== "z" || (!event.metaKey && !event.ctrlKey) || event.altKey) {
    return undefined;
  }

  return event.shiftKey ? "redo" : "undo";
};

export const clipboardActionFromKeyboardEvent = (
  event: KeyboardEvent
): "copy" | "paste" | undefined => {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.shiftKey) {
    return undefined;
  }

  const key = event.key.toLowerCase();
  if (key === "c") {
    return "copy";
  }
  if (key === "v") {
    return "paste";
  }
  return undefined;
};
