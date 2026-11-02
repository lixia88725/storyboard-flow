import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FocusEvent, KeyboardEvent, MouseEvent } from "react";
import {
  DIALOGUE_DRAG_MIME,
  anchorBeforeId,
  boardBlocks,
  caretRange,
  commitPayload,
  createDialogueId,
  decodeDragPayload,
  dialogueKeyAction,
  dropIndexFromPoint,
  encodeDragPayload,
  hardLineCount,
  insertSoftBreak,
  moveCommit,
  nextId,
  reconcileBlocks,
  reorderBlocks,
  sameBlocks,
  sameDialogues,
  sameOrder,
  splitBlock,
  type DialogueBlock,
  type DialogueBlocksCommit,
  type DraftBlock
} from "./model";
import "./dialogueBlocks.css";

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
  /** Once per user action: this board's ordered id/text, or a cross-board move. */
  onCommit: (commit: DialogueBlocksCommit) => void;
  /** Session selection only — never a request for new ids. */
  onSelect?: (id: string) => void;
  /** Optional settle hook for hosts that switch editors on a single click. No save rules here. */
  onBlur?: () => void;
  createId?: () => string;
  ariaLabel?: string;
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
  createId,
  ariaLabel
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

  const submit = (next: DraftBlock[]) => {
    setDraft(next);
    const payload = commitPayload(shotId, next);
    if (!sameDialogues(payload, commitPayload(shotId, incoming))) onCommit({ kind: "setDialogues", shotId, dialogues: payload });
  };

  const edit = (id: string, text: string) => submit(blocks.map((block) => (block.id === id ? { ...block, text, pending: true } : block)));

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>, block: DraftBlock) => {
    const action = dialogueKeyAction({
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      keyCode: event.nativeEvent.keyCode
    });
    if (action === "none") return;
    event.preventDefault();
    if (disabled) return;
    const caret = caretRange(block.text, event.currentTarget.selectionStart, event.currentTarget.selectionEnd);
    if (action === "softBreak") {
      const next = insertSoftBreak(block.text, caret);
      focusQueue.current = { id: block.id, caret: next.caret };
      submit(blocks.map((item) => (item.id === block.id ? { ...item, text: next.text, pending: true } : item)));
      return;
    }
    if (!block.text) return; // An empty draft stays a single block.
    const split = splitBlock(block, caret, generateId);
    const at = blocks.findIndex((item) => item.id === block.id);
    focusQueue.current = { id: split[split.length - 1].id, caret: 0 };
    submit([...blocks.slice(0, at), ...split.map((item) => ({ ...item, pending: true })), ...blocks.slice(at + 1)]);
  };

  const dragStart = (event: DragEvent, block: DraftBlock) => {
    // A blank draft has no dialogue yet, so it has nothing the core could move.
    if (disabled || block.text.trim() === "") {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(DIALOGUE_DRAG_MIME, encodeDragPayload({ id: block.id, shotId }));
  };

  const dragOver = (event: DragEvent) => {
    if (disabled) return;
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
    event.preventDefault();
    event.stopPropagation();
    const index = dropIndex;
    setDropIndex(null);
    if (disabled) return;
    const payload = decodeDragPayload(event.dataTransfer.getData(DIALOGUE_DRAG_MIME));
    if (!payload?.id) return;
    const clamped = Math.min(index ?? draft.length, draft.length);
    if (payload.shotId !== shotId && !draft.some(block => block.id === payload.id)) {
      onCommit(moveCommit(shotId, payload.id, anchorBeforeId(draft, clamped)));
      return;
    }
    const next = reorderBlocks(draft, payload.id, clamped);
    if (sameOrder(next, draft)) return; // Dropped onto itself: no side effect.
    submit(next.map((block) => ({ ...block, pending: true })));
  };

  const blur = (event: FocusEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    onBlur?.();
  };

  const locate = (event: MouseEvent, block: DraftBlock) => {
    // The body keeps native text selection; clicking the row's empty space positions the caret.
    if (disabled || (event.target as HTMLElement).closest("textarea, button")) return;
    event.preventDefault();
    const element = textareas.current.get(block.id);
    if (!element) return;
    element.focus();
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
      data-drop-index={dropIndex === null ? undefined : dropIndex}
      onDragOver={dragOver}
      onDragLeave={dragLeave}
      onDrop={drop}
      onDragEnd={() => setDropIndex(null)}
      onBlurCapture={blur}
    >
      {blocks.map((block, index) => (
        <div
          key={block.id}
          className={`flow-dialogue-block${dropBefore === index ? " is-drop-before" : ""}${dropAfter === index ? " is-drop-after" : ""}${block.text.trim() === "" ? " is-blank" : ""}`}
          data-block-id={block.id}
          onMouseDown={(event) => locate(event, block)}
        >
          <button
            type="button"
            className="flow-dialogue-handle"
            aria-label={`Drag dialogue ${block.id}`}
            disabled={disabled}
            draggable={!disabled && block.text.trim() !== ""}
            onDragStart={(event) => dragStart(event, block)}
            onDragEnd={() => setDropIndex(null)}
            onMouseDown={(event) => event.stopPropagation()}
          />
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
            onChange={(event) => edit(block.id, event.target.value)}
            onKeyDown={(event) => keyDown(event, block)}
            onMouseDown={() => onSelect?.(block.id)}
            onFocus={() => onSelect?.(block.id)}
          />
        </div>
      ))}
    </div>
  );
}
