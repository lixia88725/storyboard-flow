import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CompositionEvent, DragEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import { dialogueTypingGroupWindowMs } from "../../../session/core/grouping";
import {
  DIALOGUE_DRAG_MIME,
  anchorBeforeId,
  boardBlocks,
  caretJumped,
  caretRange,
  commitPayload,
  createDialogueId,
  createTypingGroup,
  decodeDragPayload,
  dialogueKeyAction,
  dropIndexFromPoint,
  encodeDragPayload,
  hardLineCount,
  insertSoftBreak,
  moveCommit,
  nextId,
  publishesTyping,
  reconcileBlocks,
  reorderBlocks,
  sameBlocks,
  sameDialogues,
  sameOrder,
  splitBlock,
  type DialogueBlock,
  type DialogueBlocksCommit,
  type DraftBlock,
  type TextSelection
} from "./model";
import "./dialogueBlocks.css";
import { createCommitQueue } from "./commitQueue";

/** Local edit lifecycle the host needs to keep unconfirmed text safe. */
import type { DialogueEditState } from "../dialogueCommitState";

export type DialogueBlocksProps = {
  /** Stable board identity. Rows are picked from `dialogues` by this id and ids are never rebuilt. */
  shotId: string;
  /** Project dialogues (`DialogueV1[]`); this board's rows keep the host's order. */
  dialogues: readonly DialogueBlock[];
  disabled?: boolean;
  /** `compact` is the dense letterbox/subtitle presentation; `full` is the card editor. */
  variant?: "full" | "compact";
  /** Focus the first block on mount so the first click on blank space can type straight away. */
  autoFocus?: boolean;
  /**
   * Focus on demand without touching identities. `token` must change monotonically
   * (a counter); `id` picks the block, otherwise the first one is focused.
   */
  focusRequest?: { token: unknown; id?: string };
  /**
   * Once per user action: this board's ordered id/text, or a cross-board move. The second
   * argument identifies this editor instance, so the host can attribute the commit; two editors
   * of the same board must never clear each other's unsaved text. Returning the host's promise
   * is optional; when provided it reports text the host has not confirmed yet.
   */
  onCommit: (commit: DialogueBlocksCommit, owner: string) => void | Promise<unknown>;
  /** Session selection only — never a request for new ids. */
  onSelect?: (id: string) => void;
  /** Optional settle hook for hosts that switch editors on a single click. No save rules here. */
  onBlur?: () => void;
  /**
   * Reorder/cross-board drag. Default `false`: no handle is rendered and this container accepts
   * no drops, so plain storyboards, the canvas track and the info column keep native text
   * selection dragging. Only the Japanese storyboard view turns it on.
   */
  allowDrag?: boolean;
  createId?: () => string;
  ariaLabel?: string;
  /** Composition and unconfirmed commits, reported per mounted editor instance. */
  onEditState?: (instanceId: string, state: DialogueEditState | null) => void;
  /** Host Undo/Redo admission. When omitted the textarea keeps its native undo. */
  onUndo?: () => void;
  onRedo?: () => void;
  /** Changes whenever the host navigated history; local drafts adopt the host's text. */
  authority?: unknown;
};

export function DialogueBlocks(props: DialogueBlocksProps) {
  return <BoardEditor key={props.shotId} {...props} />;
}

function BoardEditor({
  shotId,
  dialogues,
  disabled = false,
  variant = "full",
  autoFocus = false,
  focusRequest,
  onCommit,
  onSelect,
  onBlur,
  allowDrag = false,
  createId,
  ariaLabel,
  onEditState,
  onUndo,
  onRedo,
  authority
}: DialogueBlocksProps) {
  const generateId = createId ?? createDialogueId;
  const incoming = useMemo(() => boardBlocks(dialogues, shotId), [dialogues, shotId]);
  const [draft, setDraft] = useState<DraftBlock[]>(() => reconcileBlocks([], incoming));
  const seenIncoming = useRef(incoming);
  if (seenIncoming.current !== incoming) {
    seenIncoming.current = incoming;
    const next = reconcileBlocks(draft, incoming);
    if (!sameBlocks(next, draft)) setDraft(next);
  }

  // This mounted editor's identity and the token of its current typing run. A run ends on
  // focus, a caret jump, a paste, a structure action, history navigation and the pause timer;
  // the host never relies on this component staying mounted for grouping.
  const ids = useRef<{ instance: string; group: string } | null>(null);
  if (ids.current === null) ids.current = { instance: createTypingGroup(), group: createTypingGroup() };
  const instanceId = ids.current.instance;
  const composition = useRef(false);
  const pasted = useRef(false);
  const selection = useRef<(TextSelection & { id: string }) | null>(null);
  const pause = useRef<number | undefined>(undefined);
  const [composing, setComposing] = useState(false);
  // Latest draft for handlers that run outside the render that produced their closure
  // (compositionend in particular).
  const latest = useRef<DraftBlock[]>([]);
  latest.current = draft;
  // The payload the host has not confirmed yet, plus the reply it is waiting for. A rejected
  // commit stays retryable; it is never treated as saved, and an older reply never clears a
  // newer payload.
  const queue = useRef(createCommitQueue<DialogueBlock[]>(sameDialogues));

  const emptyId = useRef<string | null>(null);
  if (emptyId.current === null) emptyId.current = nextId(generateId);
  // An empty board still shows one editable block, so the board is never a dead end. It stays
  // a local draft: `commitPayload` drops blank blocks, so no empty dialogue reaches Session.
  const blank = draft.length === 0;
  const blocks: DraftBlock[] = blank ? [{ id: emptyId.current, shotId, text: "", pending: false }] : draft;

  const textareas = useRef(new Map<string, HTMLTextAreaElement>());
  const focusQueue = useRef<{ id: string; caret?: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  useEffect(() => {
    onEditState?.(instanceId, { shotId, composing });
  }, [onEditState, instanceId, shotId, composing]);
  useEffect(() => () => onEditState?.(instanceId, null), [onEditState, instanceId]);
  useEffect(() => () => window.clearTimeout(pause.current), []);

  // History navigation is authoritative: a stale pending draft must never be written back over
  // the restored snapshot. The host bumps `authority` only after a successful undo/redo.
  const lastAuthority = useRef(authority);
  if (lastAuthority.current !== authority) {
    lastAuthority.current = authority;
    queue.current.reset();
    const adopted = reconcileBlocks([], incoming);
    if (!sameBlocks(adopted, draft)) setDraft(adopted);
  }

  const rollGroup = () => {
    ids.current!.group = createTypingGroup();
    window.clearTimeout(pause.current);
    pause.current = undefined;
  };
  const armPause = () => {
    window.clearTimeout(pause.current);
    pause.current = window.setTimeout(rollGroup, dialogueTypingGroupWindowMs);
  };

  useEffect(() => {
    const queued = focusQueue.current;
    if (!queued) return;
    focusQueue.current = null;
    const element = textareas.current.get(queued.id);
    if (!element) return;
    if (document.activeElement !== element) element.focus();
    if (queued.caret === undefined) return;
    try {
      element.setSelectionRange(queued.caret, queued.caret);
    } catch {
      // A host without selection support keeps its own caret.
    }
  });

  useEffect(() => {
    if (!autoFocus || disabled) return;
    const first = blocks[0];
    if (!first) return;
    const element = textareas.current.get(first.id);
    if (!element) return;
    element.focus();
    try {
      element.setSelectionRange(0, 0);
    } catch {
      // Ignore hosts without selection support.
    }
    // Mount only; later focus changes arrive through `focusRequest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const focusToken = focusRequest?.token;
  const focusId = focusRequest?.id;
  // A defined token is the host's focus intent, including on mount: a shot switch remounts this
  // subtree (see the keyed wrapper), so skipping the first token would drop the click that opened
  // the card. Hosts mount one editor at a time — the card being edited — not one per shot.
  useEffect(() => {
    if (focusToken === undefined || disabled) return;
    const element = (focusId ? textareas.current.get(focusId) : undefined) ?? textareas.current.get(blocks[0]?.id ?? "");
    if (!element) return;
    element.focus();
    try {
      element.setSelectionRange(0, 0);
    } catch {
      // Ignore hosts without selection support.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken, disabled]);

  // A drag that ends anywhere else must leave no insertion line behind and no commit.
  useEffect(() => {
    if (dropIndex === null) return;
    const clear = () => setDropIndex(null);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [dropIndex]);

  // Revoking drag permission mid-drag must also drop the feedback the drag already produced.
  useEffect(() => {
    if (!allowDrag) setDropIndex(null);
  }, [allowDrag]);

  const remember = (id: string, element: HTMLTextAreaElement) => {
    selection.current = {
      id,
      value: element.value,
      start: element.selectionStart ?? element.value.length,
      end: element.selectionEnd ?? element.value.length
    };
  };

  /** A navigation event: only unchanged text with a moved selection ends the run. */
  const moved = (id: string, element: HTMLTextAreaElement) => {
    const current = { id, value: element.value, start: element.selectionStart ?? 0, end: element.selectionEnd ?? 0 };
    const previous = selection.current;
    if (previous && previous.id === id && caretJumped(previous, current) && !composition.current) rollGroup();
    selection.current = current;
  };

  /** One delivery attempt. The queue decides which payload is current and what a reply clears. */
  const send = (payload: DialogueBlock[], typing: boolean) => {
    if (typing) armPause();
    return onCommit({
      kind: "setDialogues",
      shotId,
      dialogues: payload,
      ...(typing ? { edit: { kind: "typing" as const, group: ids.current!.group } } : {})
    }, instanceId);
  };

  const publish = (next: DraftBlock[], typing: boolean) => {
    setDraft(next);
    const wasPaste = pasted.current;
    pasted.current = false;
    // One outstanding payload: the trailing compositionend input is not sent twice, and a newer
    // intent (including a revert to the host's text) supersedes an older in-flight/failed one.
    queue.current.publish(commitPayload(shotId, next), typing && !wasPaste, commitPayload(shotId, incoming), send);
  };

  /** Re-offer text the host never acknowledged. Never sends while composing or awaiting a reply. */
  const retry = () => {
    if (composition.current) return;
    queue.current.retry(commitPayload(shotId, incoming), send);
  };

  const change = (event: ChangeEvent<HTMLTextAreaElement>, block: DraftBlock) => {
    const value = event.target.value;
    remember(block.id, event.currentTarget);
    const next = blocks.map(item => (item.id === block.id ? { ...item, text: value, pending: true } : item));
    // IME candidates stay local; compositionend publishes the final text.
    if (!publishesTyping(Boolean((event.nativeEvent as InputEvent).isComposing), composition.current)) {
      setDraft(next);
      return;
    }
    publish(next, true);
  };

  const compositionStart = () => {
    composition.current = true;
    setComposing(true);
    // Reported synchronously: the host must know before any effect runs, so a Close in the
    // same tick cannot be treated as settled.
    onEditState?.(instanceId, { shotId, composing: true });
  };

  const compositionEnd = (event: CompositionEvent<HTMLTextAreaElement>) => {
    composition.current = false;
    setComposing(false);
    onEditState?.(instanceId, { shotId, composing: false });
    const id = event.currentTarget.dataset.dialogueId;
    if (!id) return;
    remember(id, event.currentTarget);
    const value = event.currentTarget.value;
    const rows: DraftBlock[] = latest.current.some(item => item.id === id) ? latest.current : [{ id, shotId, text: "", pending: true }];
    publish(rows.map(item => (item.id === id ? { ...item, text: value, pending: true } : item)), true);
  };

  const pasteText = () => {
    // Paste is its own step on both sides: roll before it (so it cannot join the previous run)
    // and mark the commit so it carries no typing token (typing after it starts a new run).
    rollGroup();
    pasted.current = true;
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>, block: DraftBlock) => {
    const native = event.nativeEvent;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !composition.current && !native.isComposing && onUndo) {
      // Non-composition only: inside an IME session the native candidate undo stays intact.
      event.preventDefault();
      rollGroup();
      if (event.shiftKey && onRedo) onRedo();
      else onUndo();
      return;
    }
    const action = dialogueKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: native.isComposing,
      keyCode: native.keyCode
    });
    if (action === "none") return;
    event.preventDefault();
    if (disabled) return;
    const caret = caretRange(block.text, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
    if (action === "softBreak") {
      const next = insertSoftBreak(block.text, caret);
      focusQueue.current = { id: block.id, caret: next.caret };
      publish(blocks.map(item => (item.id === block.id ? { ...item, text: next.text, pending: true } : item)), true);
      return;
    }
    if (!block.text) return; // An empty draft stays a single block.
    const split = splitBlock(block, caret, generateId);
    const at = blocks.findIndex((item) => item.id === block.id);
    focusQueue.current = { id: split[split.length - 1].id, caret: 0 };
    // A split is a structure step: no typing token, and the next run starts fresh.
    publish([...blocks.slice(0, at), ...split.map((item) => ({ ...item, pending: true })), ...blocks.slice(at + 1)], false);
    rollGroup();
  };

  const dragStart = (event: DragEvent, block: DraftBlock) => {
    // A blank draft has no dialogue yet, so it has nothing the core could move.
    if (!allowDrag || disabled || block.text.trim() === "") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DIALOGUE_DRAG_MIME, encodeDragPayload({ id: block.id, shotId }));
  };

  const dragOver = (event: DragEvent) => {
    if (!allowDrag || disabled) return;
    if (!event.dataTransfer.types.includes(DIALOGUE_DRAG_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rects = blocks
      .map((block) => textareas.current.get(block.id)?.parentElement?.getBoundingClientRect())
      .filter((rect): rect is DOMRect => Boolean(rect));
    setDropIndex(dropIndexFromPoint(rects, event.clientY));
  };

  const dragLeave = (event: DragEvent) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDropIndex(null);
  };

  const drop = (event: DragEvent) => {
    if (!allowDrag || disabled) return;
    // Only our own block drag is a gesture here; dragging selected text keeps its native drop.
    if (!event.dataTransfer.types.includes(DIALOGUE_DRAG_MIME)) return;
    event.preventDefault();
    event.stopPropagation();
    const index = dropIndex;
    setDropIndex(null);
    const payload = decodeDragPayload(event.dataTransfer.getData(DIALOGUE_DRAG_MIME));
    if (!payload?.id) return;
    const clamped = Math.min(index ?? draft.length, draft.length);
    if (payload.shotId !== shotId && !draft.some(block => block.id === payload.id)) {
      rollGroup();
      // The host reports a failed move itself; this only keeps a rejected commit — or a host that
      // throws synchronously — from escaping as an unhandled rejection. No additional protocol.
      void (async () => { await onCommit(moveCommit(shotId, payload.id, anchorBeforeId(draft, clamped)), instanceId); })().catch(() => {});
      return;
    }
    const next = reorderBlocks(draft, payload.id, clamped);
    if (sameOrder(next, draft)) return; // Dropped onto itself: no side effect.
    publish(next.map((block) => ({ ...block, pending: true })), false);
    rollGroup();
  };

  const blur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    // Leaving the editor is the natural retry point for text the host never acknowledged
    // (for example a rejected commit); it never sends while composing or already in flight.
    retry();
    onBlur?.();
  };

  const locate = (event: MouseEvent, block: DraftBlock) => {
    // The body keeps native text selection; clicking the row's empty space positions the caret.
    if (disabled || (event.target as HTMLElement).closest("textarea, button")) return;
    event.preventDefault();
    const element = textareas.current.get(block.id);
    if (!element) return;
    element.focus();
    rollGroup();
    try {
      element.setSelectionRange(element.value.length, element.value.length);
    } catch {
      // Ignore hosts without selection support.
    }
    onSelect?.(block.id);
  };

  const dropBefore = dropIndex !== null && dropIndex < blocks.length ? dropIndex : null;
  const dropAfter = dropIndex !== null && dropIndex === blocks.length && !blank ? blocks.length - 1 : null;

  return (
    <div
      className={`flow-dialogue-blocks${variant === "compact" ? " is-compact" : ""}${dropIndex !== null && blank ? " is-drop-empty" : ""}${disabled ? " is-disabled" : ""}`}
      aria-label={ariaLabel ?? `Dialogue blocks ${shotId}`}
      data-dialogue-count={draft.length}
      data-allow-drag={allowDrag ? "true" : "false"}
      data-drop-index={dropIndex === null ? undefined : dropIndex}
      onDragOver={allowDrag ? dragOver : undefined}
      onDragLeave={allowDrag ? dragLeave : undefined}
      onDrop={allowDrag ? drop : undefined}
      onDragEnd={allowDrag ? () => setDropIndex(null) : undefined}
      onBlurCapture={blur}
    >
      {variant === "full" && <div className="flow-dialogue-heading">台词</div>}
      {blocks.map((block, index) => (
        <div
          key={block.id}
          className={`flow-dialogue-block${dropBefore === index ? " is-drop-before" : ""}${dropAfter === index ? " is-drop-after" : ""}${block.text.trim() === "" ? " is-blank" : ""}`}
          data-block-id={block.id}
          onMouseDown={(event) => locate(event, block)}
        >
          {allowDrag && (
            <button
              type="button"
              className="flow-dialogue-handle"
              aria-label={`Drag dialogue ${block.id}`}
              disabled={disabled}
              draggable={!disabled && block.text.trim() !== ""}
              onDragStart={(event) => dragStart(event, block)}
              onDragEnd={() => setDropIndex(null)}
              onMouseDown={(event) => event.stopPropagation()}
            >
              {/* Six dots: a grip, not a filled pill. Decorative, the button carries the name. */}
              <svg className="flow-dialogue-grip" viewBox="0 0 8 12" width="8" height="12" aria-hidden="true" focusable="false">
                {[2, 6].map((x) => [2, 6, 10].map((y) => (
                  <circle key={`${x}:${y}`} cx={x} cy={y} r="1.1" fill="currentColor" />
                )))}
              </svg>
            </button>
          )}
          <textarea
            className="flow-dialogue-text"
            rows={hardLineCount(block.text)}
            value={block.text}
            placeholder="写台词"
            disabled={disabled}
            aria-label={`Dialogue ${block.id}`}
            data-dialogue-id={block.id}
            ref={(element) => {
              if (element) textareas.current.set(block.id, element);
              else textareas.current.delete(block.id);
            }}
            onChange={(event) => change(event, block)}
            onKeyDown={(event) => keyDown(event, block)}
            onCompositionStart={compositionStart}
            onCompositionEnd={compositionEnd}
            onPaste={pasteText}
            onSelect={(event) => moved(block.id, event.currentTarget)}
            onKeyUp={(event) => moved(block.id, event.currentTarget)}
            onMouseUp={(event) => moved(block.id, event.currentTarget)}
            onClick={(event) => moved(block.id, event.currentTarget)}
            onFocus={(event) => {
              rollGroup();
              remember(block.id, event.currentTarget);
              onSelect?.(block.id);
            }}
            onMouseDown={() => onSelect?.(block.id)}
          />
        </div>
      ))}
    </div>
  );
}
