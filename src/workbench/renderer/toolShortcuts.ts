export type ShortcutTool = "brush" | "eraser" | "select" | "blur";

/** Photoshop's spring-loaded eraser: a tap keeps the eraser, a hold borrows it. */
export const TOOL_KEYS: Record<string, ShortcutTool> = { b: "brush", e: "eraser", l: "select", k: "blur" };
export const HOLD_MS = 200;

export type KeyLike = {
  key: string;
  repeat: boolean;
  isComposing?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
};

const typingTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element?.tagName) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  return element.isContentEditable === true;
};

export const shouldIgnoreShortcut = (event: KeyLike & { target?: EventTarget | null }, dialogOpen = false): boolean => {
  if (event.isComposing) return true;
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  if (dialogOpen) return true;
  return typingTarget(event.target ?? null);
};

export type Controller = {
  keyDown(event: KeyLike & { target?: EventTarget | null }): "handled" | "ignored" | "held" | "temporary";
  keyUp(event: KeyLike & { target?: EventTarget | null }): "restored" | "kept" | "ignored";
  /** A tool chosen by hand (rail click, mouse) - a pending hold must not undo it. */
  toolChosenByUser(tool: ShortcutTool): void;
  blur(): boolean;
  dispose(): void;
  state(): { holdTool: ShortcutTool | null; previous: ShortcutTool | null; holding: boolean };
};

/** Pure state machine. All effects go through the callbacks, so the timing can be tested
 * without a DOM: a tap (keyup before holdMs) keeps the tool, a hold returns to the tool that
 * was active before the key went down, and a manual choice wins over a late keyup. */
export const createController = (options: {
  apply: (tool: ShortcutTool) => void;
  current: () => ShortcutTool;
  holdMs?: number;
  now?: () => number;
  isBlocked?: () => boolean;
}): Controller => {
  const holdMs = options.holdMs ?? HOLD_MS;
  const now = options.now ?? (() => Date.now());
  let holdTool: ShortcutTool | null = null;
  let previous: ShortcutTool | null = null;
  let startedAt = 0;
  let override: ShortcutTool | null = null;   // set when the user picks a tool during a hold
  let disposed = false;

  const clear = () => { holdTool = null; previous = null; override = null; startedAt = 0; };

  const keyDown: Controller["keyDown"] = event => {
    if (disposed) return "ignored";
    if (options.isBlocked?.() || shouldIgnoreShortcut(event)) return "ignored";
    const tool = TOOL_KEYS[event.key.toLowerCase()];
    if (!tool) return "ignored";
    if (event.repeat) return holdTool ? "held" : "ignored";   // OS auto-repeat never re-enters
    if (tool === "eraser") {
      if (holdTool) return "held";
      holdTool = "eraser";
      previous = options.current();
      startedAt = now();
      override = null;
      options.apply("eraser");                              // visible immediately
      return "temporary";
    }
    // B or L while the eraser is borrowed: finish the borrow first, then honour the key.
    if (holdTool) { holdTool = null; previous = null; override = null; }
    options.apply(tool);
    return "handled";
  };

  const keyUp: Controller["keyUp"] = event => {
    if (disposed) return "ignored";
    // The release belongs to a keydown this controller captured: later focus in a text
    // field, IME state or a modifier must not strand the borrowed eraser.
    const tool = TOOL_KEYS[event.key.toLowerCase()];
    if (tool !== "eraser" || holdTool !== "eraser") return "ignored";
    const long = now() - startedAt >= holdMs;
    const restoreTo = override ?? previous;
    holdTool = null; previous = null;
    if (!long) { override = null; return "kept"; }           // tap: the eraser stays
    override = null;
    if (restoreTo) options.apply(restoreTo);
    return "restored";
  };

  const toolChosenByUser: Controller["toolChosenByUser"] = tool => {
    if (!holdTool) return;
    override = tool;                                        // keyup must not overwrite this
  };

  const blur: Controller["blur"] = () => {
    if (!holdTool) return false;
    const restoreTo = override ?? previous;
    holdTool = null; previous = null; override = null;
    if (restoreTo) options.apply(restoreTo);
    return true;
  };

  return {
    keyDown, keyUp, toolChosenByUser, blur,
    dispose() { disposed = true; clear(); },
    state: () => ({ holdTool, previous, holding: holdTool !== null })
  };
};
