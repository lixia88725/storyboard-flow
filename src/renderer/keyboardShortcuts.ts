export type ShortcutAction =
  | "brush"
  | "eraser"
  | "select"
  | "clearLayer"
  | "mergeDown"
  | "save"
  | "addShot"
  | "onionSkin"
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
): KeyboardShortcuts => ({
  brush: "B",
  eraser: "E",
  select: "V",
  clearLayer: "Escape",
  mergeDown: platform === "darwin" ? "Cmd+E" : "Ctrl+E",
  save: "Cmd+S",
  addShot: "A",
  onionSkin: "O",
  previousShot: "ArrowLeft",
  nextShot: "ArrowRight",
  undo: "Cmd+Z",
  redo: "Shift+Cmd+Z"
});

export const defaultKeyboardShortcuts: KeyboardShortcuts = defaultKeyboardShortcutsForPlatform();

export const shortcutActions = Object.keys(defaultKeyboardShortcuts) as ShortcutAction[];

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

export const normalizeKeyboardShortcuts = (shortcuts: unknown): KeyboardShortcuts => {
  if (!shortcuts || typeof shortcuts !== "object") {
    return defaultKeyboardShortcuts;
  }

  const input = shortcuts as Record<string, unknown>;
  return shortcutActions.reduce<KeyboardShortcuts>(
    (next, action) => ({
      ...next,
      [action]:
        typeof input[action] === "string"
          ? normalizeShortcutValue(input[action])
          : defaultKeyboardShortcuts[action]
    }),
    { ...defaultKeyboardShortcuts }
  );
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

export const duplicateShortcutValues = (shortcuts: KeyboardShortcuts): string[] => {
  const counts = new Map<string, number>();

  for (const shortcut of Object.values(shortcuts)) {
    const normalized = normalizeShortcutValue(shortcut);
    if (!normalized) {
      continue;
    }

    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .map(([shortcut]) => shortcut)
    .sort();
};
