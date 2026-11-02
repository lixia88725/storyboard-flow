/**
 * Framework-free model for the reusable Notion-style dialogue blocks.
 *
 * The React component owns DOM wiring only. Caret, split, drop and reconciliation
 * rules live here so they can be exercised without a browser.
 *
 * Identity rules:
 * - A block carries the stable `DialogueV1.id` it came from. Position is never identity,
 *   and text is never re-derived by splitting a paragraph on newlines, so a surrounding
 *   Session selection (a focused card) can never rebuild block ids.
 * - Blank blocks are local drafts: Session only ever receives dialogues with visible text.
 * - One callback per user action carries the whole board (ordered id/text) or a cross-board
 *   `moveDialogues`. The host owns Session/history semantics; nothing is saved here.
 */

export type DialogueBlock = { id: string; shotId: string; text: string };

/** One commit per user action; the host decides how it reaches Session. */
export type DialogueBlocksCommit =
  | { kind: "setDialogues"; shotId: string; dialogues: DialogueBlock[] }
  | { kind: "moveDialogues"; dialogueIds: string[]; targetShotId: string; beforeId?: string };

export type DraftBlock = DialogueBlock & { pending: boolean };

/** Shared with the legacy transfer control so one drag can be accepted by both. */
export const DIALOGUE_DRAG_MIME = "application/x-flow-dialogue";

/** The V1 dialogue id contract in `src/core/storyboard`. */
const idPattern = /^[A-Za-z0-9_-]{1,80}$/;

export type DragPayload = { id: string; shotId: string };

export function encodeDragPayload(payload: DragPayload): string {
  return JSON.stringify({ id: payload.id, shotId: payload.shotId });
}

/**
 * Tolerates the legacy bare-id payload. An unknown source board still yields a movable
 * id; the caller then treats the drop as a cross-board move, which the core also accepts
 * for an id that already lives on the target board.
 */
export function decodeDragPayload(raw: string | null | undefined): DragPayload | null {
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && typeof (parsed as DragPayload).id === "string" && (parsed as DragPayload).id) {
        const shotId = (parsed as DragPayload).shotId;
        return { id: (parsed as DragPayload).id, shotId: typeof shotId === "string" ? shotId : "" };
      }
    } catch {
      // Not JSON: fall through to the legacy bare-id form.
    }
  }
  return { id: raw, shotId: "" };
}

/** Ids must satisfy the V1 contract; a generator that returns anything else falls back. */
export function nextId(createId: () => string): string {
  const candidate = createId();
  return idPattern.test(candidate) ? candidate : createDialogueId();
}

export function createDialogueId(): string {
  const source = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
  if (source && typeof source.randomUUID === "function") return source.randomUUID();
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** This board's rows, in host order. Never groups, splits or re-parses text. */
export function boardBlocks(rows: readonly DialogueBlock[], shotId: string): DialogueBlock[] {
  return rows.filter((row) => row.shotId === shotId).map((row) => ({ id: row.id, shotId, text: row.text }));
}

/** What Session may see: blank drafts stay local, so no empty dialogue is ever created. */
export function commitPayload(shotId: string, blocks: readonly DialogueBlock[]): DialogueBlock[] {
  return blocks.filter((block) => block.text.trim() !== "").map((block) => ({ id: block.id, shotId, text: block.text }));
}

export function sameDialogues(a: readonly DialogueBlock[], b: readonly DialogueBlock[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.shotId === b[i].shotId && x.text === b[i].text);
}

export function sameOrder(a: readonly { id: string }[], b: readonly { id: string }[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id);
}

export function sameBlocks(a: readonly DraftBlock[], b: readonly DraftBlock[]): boolean {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && x.text === b[i].text && x.pending === b[i].pending);
}

/** Caret offsets arrive as UTF-16 units; never land inside a surrogate pair. */
export function clampCaret(text: string, offset: number): number {
  if (!Number.isFinite(offset)) return text.length;
  const caret = Math.max(0, Math.min(text.length, Math.trunc(offset)));
  if (caret <= 0 || caret >= text.length) return caret;
  const before = text.charCodeAt(caret - 1);
  const at = text.charCodeAt(caret);
  const high = before >= 0xd800 && before <= 0xdbff;
  const low = at >= 0xdc00 && at <= 0xdfff;
  return high && low ? caret - 1 : caret;
}

export type CaretRange = { start: number; end: number };

/**
 * A textarea reports its selection in UTF-16 units; null means "no selection yet".
 * A selection replaces on split/soft-break, so both ends must be carried, not only the start.
 */
export function caretRange(value: string, start: number | null | undefined, end: number | null | undefined): CaretRange {
  const from = clampCaret(value, start ?? value.length);
  const to = clampCaret(value, end ?? from);
  return from <= to ? { start: from, end: to } : { start: to, end: from };
}

/**
 * Plain Enter inside one block. The selected range is replaced by the split, and the id
 * follows the half that keeps the caret, so the focused element is never remounted:
 * - nothing after the range: the id keeps the text and a new empty block follows;
 * - otherwise: the text after the range keeps the id and the text before it becomes a new
 *   block above, leaving the caret at the start of what the user just typed.
 * The caller focuses the last returned block.
 */
export function splitBlock(block: DialogueBlock, range: CaretRange, createId: () => string): DialogueBlock[] {
  const head = block.text.slice(0, range.start);
  const tail = block.text.slice(range.end);
  if (!tail) return [{ ...block, text: head }, { ...block, id: nextId(createId), text: "" }];
  return [{ ...block, id: nextId(createId), text: head }, { ...block, text: tail }];
}

/** Shift+Enter: a newline inside the same DialogueV1.text, replacing any selected range. */
export function insertSoftBreak(text: string, range: CaretRange): { text: string; caret: number } {
  return { text: `${text.slice(0, range.start)}\n${text.slice(range.end)}`, caret: range.start + 1 };
}

/** Soft wrapping must not add rows: only explicit newlines count. */
export function hardLineCount(text: string): number {
  return text.split("\n").length;
}

export type DialogueKeyEvent = {
  key?: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
};

export type DialogueKeyAction = "split" | "softBreak" | "none";

/** IME candidate confirmation arrives as Enter (often keyCode 229): never structural. */
export function isCompositionKey(event: DialogueKeyEvent): boolean {
  return Boolean(
    event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229
  );
}

/** Shift+Enter writes a newline inside one dialogue; plain Enter splits the block. */
export function dialogueKeyAction(event: DialogueKeyEvent): DialogueKeyAction {
  if (event.key !== "Enter") return "none";
  if (isCompositionKey(event)) return "none";
  return event.shiftKey ? "softBreak" : "split";
}

export type BlockRect = { top: number; bottom: number };

/** Insertion index from the pointer position: above a block's middle inserts before it. */
export function dropIndexFromPoint(rects: readonly BlockRect[], clientY: number): number {
  for (let index = 0; index < rects.length; index += 1) {
    const rect = rects[index];
    if (clientY < (rect.top + rect.bottom) / 2) return index;
  }
  return rects.length;
}

/** Insertion index to the core's anchor: undefined appends at the end of the board. */
export function anchorBeforeId(blocks: readonly { id: string }[], index: number): string | undefined {
  return index >= 0 && index < blocks.length ? blocks[index].id : undefined;
}

/** Dropping a block onto its own position changes nothing and must not commit. */
export function reorderBlocks(blocks: readonly DialogueBlock[], id: string, index: number): DialogueBlock[] {
  const from = blocks.findIndex((block) => block.id === id);
  if (from < 0) return blocks.slice();
  const anchor = index > blocks.length ? blocks.length : index < 0 ? 0 : index;
  const rest = blocks.filter((_, position) => position !== from);
  const to = Math.max(0, Math.min(rest.length, anchor > from ? anchor - 1 : anchor));
  if (to === from) return blocks.slice();
  rest.splice(to, 0, blocks[from]);
  return rest;
}

/** Cross-board drop. The target must be an active board; `beforeId` is a target dialogue. */
export function moveCommit(targetShotId: string, draggedId: string, beforeId: string | undefined): DialogueBlocksCommit {
  return { kind: "moveDialogues", dialogueIds: [draggedId], targetShotId, ...(beforeId === undefined ? {} : { beforeId }) };
}

/**
 * Adopt the host's order and text, but hold what the host has not echoed yet:
 * - a block whose text the host still disagrees on keeps the local text and stays pending;
 *   once the host echoes the same text the block settles and later host changes win again
 *   (so undo keeps working);
 * - a block that only exists locally (a split the host has not answered yet) keeps its place
 *   relative to its draft neighbours instead of disappearing or jumping to the end.
 */
export function reconcileBlocks(draft: readonly DraftBlock[], incoming: readonly DialogueBlock[]): DraftBlock[] {
  const held = new Map(draft.map((block) => [block.id, block]));
  const known = new Set(incoming.map((block) => block.id));
  const next: DraftBlock[] = incoming.map((block) => {
    const local = held.get(block.id);
    return local?.pending && local.text !== block.text
      ? { ...block, text: local.text, pending: true }
      : { id: block.id, shotId: block.shotId, text: block.text, pending: false };
  });
  const placed = (id: string) => next.some((item) => item.id === id);
  // Previous anchor first, as before, but the anchor must be a *placed* neighbour rather than a
  // host row: a run of drafts shares one host block, so anchoring every member on that row would
  // stack the run at one point and reverse it (A, B, C came back as A, C, B). Forward order plus
  // the placed set — which already holds the drafts inserted earlier in this walk — keeps the run
  // in draft order, and a draft with no previous anchor still falls back to the following one.
  draft.forEach((block, position) => {
    if (known.has(block.id) || !block.pending) return;
    const previous = draft.slice(0, position).reverse().find((candidate) => placed(candidate.id));
    if (previous) {
      next.splice(next.findIndex((item) => item.id === previous.id) + 1, 0, { ...block });
      return;
    }
    const following = draft.slice(position + 1).find((candidate) => placed(candidate.id));
    next.splice(following ? next.findIndex((item) => item.id === following.id) : next.length, 0, { ...block });
  });
  return next;
}
