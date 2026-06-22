export type ShortcutAction =
  | "brush"
  | "eraser"
  | "select"
  | "eyedropper"
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
    eyedropper: "I",
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

export const shortcutActionFromKeyboardEvent = (
  event: KeyboardEvent,
  shortcuts: KeyboardShortcuts = defaultKeyboardShortcuts
): ShortcutAction | undefined => {
  const configuredShortcutAction = shortcutActions.find((action) =>
    keyboardEventMatchesShortcut(event, shortcuts[action])
  );
  return configuredShortcutAction ?? historyActionFromKeyboardEvent(event);
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

export const storyboardZoomActionFromKeyboardEvent = (
  event: KeyboardEvent
): "in" | "out" | undefined => {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey) {
    return undefined;
  }

  if (event.key === "+" || event.key === "=") {
    return "in";
  }
  if (event.key === "-" || event.key === "_") {
    return "out";
  }
  return undefined;
};

type KeyboardTarget = {
  isContentEditable?: boolean;
  closest?: (selector: string) => { type?: string } | null;
};

type KeyboardTargetElement = {
  isContentEditable?: boolean;
  closest: (selector: string) => { type?: string } | null;
};

const keyboardTargetElement = (target: EventTarget | null): KeyboardTargetElement | undefined => {
  if (!target || typeof target !== "object") {
    return undefined;
  }

  const candidate = target as KeyboardTarget;
  return typeof candidate.closest === "function" ? (candidate as KeyboardTargetElement) : undefined;
};

export const isKeyboardEditableTarget = (target: EventTarget | null): boolean => {
  const element = keyboardTargetElement(target);
  if (!element) {
    return false;
  }

  if (element.isContentEditable || element.closest("textarea, select")) {
    return true;
  }

  const input = element.closest("input");
  if (!input) {
    return false;
  }

  return !["button", "checkbox", "color", "file", "radio", "submit"].includes(input.type ?? "");
};

const isRangeInputTarget = (target: EventTarget | null): boolean => {
  return keyboardTargetElement(target)?.closest("input")?.type === "range";
};

export const shouldIgnoreShortcutForTarget = (
  target: EventTarget | null,
  shortcutAction: ShortcutAction | undefined,
  isAnimationMode: boolean
): boolean => {
  const allowsRangeTarget =
    isAnimationMode &&
    isRangeInputTarget(target) &&
    (shortcutAction === "previousShot" || shortcutAction === "nextShot");

  return isKeyboardEditableTarget(target) && !allowsRangeTarget;
};
