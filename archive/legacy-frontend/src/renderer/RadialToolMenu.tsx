import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { StrokeTool } from "../shared/types";
import {
  clearRadialSlot,
  radialEditHoldDelayMs,
  radialEditMoveTolerancePx,
  radialDragPreviewState,
  radialDragValue,
  radialPresetApplyDelayMs,
  registerRadialDragListeners,
  shouldApplyRadialPresetClick,
  shouldEnterRadialEditMode,
  shouldCloseRadialMenuFromOutsidePointerDown,
  swapRadialSlots,
  type RadialDragKind,
  type RadialDragPreviewState,
  type RadialPresetSlot,
  type RadialToolMenu as RadialToolMenuConfig,
  type RadialToolSlot,
  type SketchToolSettings
} from "./toolRadialMenu";

type RadialToolMenuProps = {
  menu: RadialToolMenuConfig;
  tool: StrokeTool;
  x: number;
  y: number;
  isClosing?: boolean;
  settings: SketchToolSettings;
  onApplyPreset: (slot: RadialPresetSlot) => void;
  onAdjust: (kind: RadialDragKind, value: number) => void;
  onUpdateSlot: (index: number, slot: RadialToolSlot) => void;
  onUpdateSlots: (slots: RadialToolSlot[]) => void;
  onClose: () => void;
};

const radialSize = 218;
const radialItemSize = 44;
const radialRadius = 72;

const dragKindForSlot = (slot: RadialToolSlot): RadialDragKind | undefined => {
  if (slot.type === "size-drag") {
    return "size";
  }
  if (slot.type === "opacity-drag") {
    return "opacity";
  }
  if (slot.type === "softness-drag") {
    return "softness";
  }
  return undefined;
};

const activeValueForKind = (settings: SketchToolSettings, tool: StrokeTool, kind: RadialDragKind): number => {
  if (kind === "size") {
    return tool === "brush" ? settings.brushSize : settings.eraserSize;
  }
  if (kind === "opacity") {
    return tool === "brush" ? settings.brushOpacity : settings.eraserOpacity;
  }
  return tool === "brush" ? settings.brushSoftness : settings.eraserSoftness;
};

const dragRangeForKind = (tool: StrokeTool, kind: RadialDragKind) => {
  if (kind === "size") {
    return tool === "brush" ? { min: 1, max: 28 } : { min: 4, max: 64 };
  }
  if (kind === "opacity") {
    return { min: 0.2, max: 1 };
  }
  return { min: 0, max: 1 };
};

const slotPosition = (index: number) => {
  const angle = -Math.PI / 2 + (index * Math.PI * 2) / 8;
  return {
    left: radialSize / 2 + Math.cos(angle) * radialRadius - radialItemSize / 2,
    top: radialSize / 2 + Math.sin(angle) * radialRadius - radialItemSize / 2
  };
};

const dragHintPosition = (index: number) => {
  const position = slotPosition(index);
  const isLeftSide = position.left + radialItemSize / 2 < radialSize / 2;
  return {
    left: isLeftSide ? position.left - 6 : position.left + radialItemSize + 6,
    top: position.top + radialItemSize / 2,
    transform: isLeftSide ? "translate(-100%, -50%)" : "translateY(-50%)"
  };
};

const slotLabel = (slot: RadialToolSlot): string => {
  if (slot.type === "empty") {
    return "+";
  }
  return slot.label;
};

const slotDetail = (slot: RadialToolSlot): string => {
  if (slot.type === "preset") {
    const details = [
      slot.applySize && slot.size !== undefined ? `${Math.round(slot.size)}px` : undefined,
      slot.applyOpacity && slot.opacity !== undefined ? `${Math.round(slot.opacity * 100)}%` : undefined,
      slot.applySoftness && slot.softness !== undefined ? `S${Math.round(slot.softness * 100)}%` : undefined
    ].filter(Boolean);
    return details.length > 0 ? details.join(" ") : "preset";
  }
  if (slot.type === "empty") {
    return "edit";
  }
  return "drag";
};

const textColorForBackground = (color: string | undefined): string | undefined => {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) {
    return undefined;
  }

  const red = Number.parseInt(color.slice(1, 3), 16);
  const green = Number.parseInt(color.slice(3, 5), 16);
  const blue = Number.parseInt(color.slice(5, 7), 16);
  return red * 0.299 + green * 0.587 + blue * 0.114 > 180 ? "#151719" : undefined;
};

const defaultSlotForType = (type: RadialToolSlot["type"], tool: StrokeTool): RadialToolSlot => {
  if (type === "empty") {
    return { id: crypto.randomUUID(), type: "empty" };
  }
  if (type === "size-drag" || type === "opacity-drag" || type === "softness-drag") {
    return {
      id: crypto.randomUUID(),
      type,
      label: type === "size-drag" ? "Size" : type === "opacity-drag" ? "Opacity" : "Soft"
    };
  }
  return {
    id: crypto.randomUUID(),
    type: "preset",
    label: tool === "brush" ? "Brush" : "Eraser",
    tool,
    color: "#ff5a2a",
    applyColor: tool === "brush",
    size: tool === "brush" ? 8 : 24,
    applySize: false,
    opacity: 1,
    applyOpacity: false,
    softness: 0,
    applySoftness: false
  };
};

export const RadialToolMenu = ({
  menu,
  tool,
  x,
  y,
  isClosing = false,
  settings,
  onApplyPreset,
  onAdjust,
  onUpdateSlot,
  onUpdateSlots,
  onClose
}: RadialToolMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const clickTimerRef = useRef<number | undefined>(undefined);
  const activeDragCleanupRef = useRef<(() => void) | undefined>(undefined);
  const holdTimerRef = useRef<number | undefined>(undefined);
  const suppressNextClickRef = useRef(false);
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | undefined>();
  const [isEditMode, setIsEditMode] = useState(false);
  const [heldSlotIndex, setHeldSlotIndex] = useState<number | undefined>();
  const [draggingSlotIndex, setDraggingSlotIndex] = useState<number | undefined>();
  const [hoveredDropIndex, setHoveredDropIndex] = useState<number | undefined>();
  const [dragHint, setDragHint] = useState<
    { index: number; kind: RadialDragKind; label: string; preview: RadialDragPreviewState } | undefined
  >();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const handlePointerDown = (event: globalThis.PointerEvent) => {
      if (
        !menuRef.current?.contains(event.target as Node) &&
        shouldCloseRadialMenuFromOutsidePointerDown(event)
      ) {
        onCloseRef.current();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      if (clickTimerRef.current !== undefined) {
        window.clearTimeout(clickTimerRef.current);
      }
      if (holdTimerRef.current !== undefined) {
        window.clearTimeout(holdTimerRef.current);
      }
      activeDragCleanupRef.current?.();
      activeDragCleanupRef.current = undefined;
    };
  }, []);

  const editorSlot = editingSlotIndex === undefined ? undefined : menu.slots[editingSlotIndex];
  const menuStyle = useMemo(
    () => ({
      left: x,
      top: y,
      width: radialSize,
      height: radialSize
    }),
    [x, y]
  );

  const clearHoldTimer = () => {
    if (holdTimerRef.current !== undefined) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = undefined;
    }
  };

  const dropIndexFromPoint = (clientX: number, clientY: number): number | undefined => {
    const element = document.elementFromPoint(clientX, clientY);
    const slotElement = element?.closest("[data-radial-slot-index]");
    const index = slotElement?.getAttribute("data-radial-slot-index");
    return index === undefined || index === null ? undefined : Number(index);
  };

  const beginRadialValueDrag = ({
    index,
    kind,
    startX,
    pointerEvent
  }: {
    index: number;
    kind: RadialDragKind;
    startX: number;
    pointerEvent: PointerEvent;
  }) => {
    const initial = activeValueForKind(settings, tool, kind);
    const range = dragRangeForKind(tool, kind);
    const nextValue = radialDragValue({
      kind,
      initial,
      deltaX: pointerEvent.clientX - startX,
      min: range.min,
      max: range.max
    });
    setDragHint({
      index,
      kind,
      label: kind === "size" ? "调尺寸" : kind === "opacity" ? "调透明度" : "调软硬",
      preview: radialDragPreviewState({ kind, value: nextValue, min: range.min, max: range.max })
    });
    onAdjust(kind, nextValue);

    return { initial, range };
  };

  const handleEditDragPointerDown = (event: ReactPointerEvent<HTMLElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    setDraggingSlotIndex(index);
    setHoveredDropIndex(index);
    let currentDropIndex: number | undefined = index;
    let movedBetweenSlots = false;

    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = registerRadialDragListeners(window, (pointerEvent) => {
      currentDropIndex = dropIndexFromPoint(pointerEvent.clientX, pointerEvent.clientY);
      movedBetweenSlots = currentDropIndex !== index;
      setHoveredDropIndex(currentDropIndex);
    },
      () => {
        const dropIndex = currentDropIndex;
        if (dropIndex !== undefined && dropIndex !== index) {
          onUpdateSlots(swapRadialSlots(menu.slots, index, dropIndex));
        } else if (!movedBetweenSlots && menu.slots[index]?.type === "empty") {
          onEditEmptySlot(index);
        }
        activeDragCleanupRef.current = undefined;
        setDraggingSlotIndex(undefined);
        setHoveredDropIndex(undefined);
      }
    );
  };

  const handleEditDragDrop = (
    index: number,
    dropIndex: number | undefined,
    movedBetweenSlots: boolean
  ) => {
    if (dropIndex !== undefined && dropIndex !== index) {
      onUpdateSlots(swapRadialSlots(menu.slots, index, dropIndex));
    } else if (!movedBetweenSlots && menu.slots[index]?.type === "empty") {
      onEditEmptySlot(index);
    }
  };

  const handleSlotPointerDown = (
    event: ReactPointerEvent<HTMLElement>,
    slot: RadialToolSlot,
    index: number
  ) => {
    if (event.button !== 0) {
      return;
    }

    if (isEditMode) {
      handleEditDragPointerDown(event, index);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const kind = dragKindForSlot(slot);
    const startX = event.clientX;
    const startY = event.clientY;
    const startTime = performance.now();
    let currentX = startX;
    let currentY = startY;
    let radialValueDrag:
      | { kind: RadialDragKind; initial: number; range: { min: number; max: number } }
      | undefined;
    let editTriggered = false;
    let editDropIndex: number | undefined = index;
    let movedBetweenEditSlots = false;
    setHeldSlotIndex(index);

    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = undefined;
      if (
        shouldEnterRadialEditMode({
          elapsedMs: performance.now() - startTime,
          startX,
          startY,
          currentX,
          currentY
        })
      ) {
        editTriggered = true;
        suppressNextClickRef.current = true;
        if (clickTimerRef.current !== undefined) {
          window.clearTimeout(clickTimerRef.current);
          clickTimerRef.current = undefined;
        }
        setDragHint(undefined);
        setHeldSlotIndex(undefined);
        setDraggingSlotIndex(index);
        setHoveredDropIndex(index);
        setIsEditMode(true);
      }
    }, radialEditHoldDelayMs);

    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = registerRadialDragListeners(window, (pointerEvent) => {
      if (editTriggered) {
        editDropIndex = dropIndexFromPoint(pointerEvent.clientX, pointerEvent.clientY);
        movedBetweenEditSlots = editDropIndex !== index;
        setHoveredDropIndex(editDropIndex);
        return;
      }

      currentX = pointerEvent.clientX;
      currentY = pointerEvent.clientY;
      const movedEnough =
        Math.hypot(currentX - startX, currentY - startY) > radialEditMoveTolerancePx;

      if (!radialValueDrag && movedEnough) {
        clearHoldTimer();
        setHeldSlotIndex(undefined);
        if (kind) {
          const dragStart = beginRadialValueDrag({ index, kind, startX, pointerEvent });
          radialValueDrag = { kind, ...dragStart };
        } else {
          suppressNextClickRef.current = true;
        }
        return;
      }

      if (radialValueDrag) {
        const nextValue = radialDragValue({
          kind: radialValueDrag.kind,
          initial: radialValueDrag.initial,
          deltaX: pointerEvent.clientX - startX,
          min: radialValueDrag.range.min,
          max: radialValueDrag.range.max
        });
        onAdjust(radialValueDrag.kind, nextValue);
        setDragHint({
          index,
          kind: radialValueDrag.kind,
          label:
            radialValueDrag.kind === "size"
              ? "调尺寸"
              : radialValueDrag.kind === "opacity"
                ? "调透明度"
                : "调软硬",
          preview: radialDragPreviewState({
            kind: radialValueDrag.kind,
            value: nextValue,
            min: radialValueDrag.range.min,
            max: radialValueDrag.range.max
          })
        });
      }
    },
      () => {
        clearHoldTimer();
        activeDragCleanupRef.current = undefined;
        setHeldSlotIndex(undefined);
        if (editTriggered) {
          handleEditDragDrop(index, editDropIndex, movedBetweenEditSlots);
          setDraggingSlotIndex(undefined);
          setHoveredDropIndex(undefined);
        }
        setDragHint(undefined);
      }
    );
  };

  const handleSlotClick = (slot: RadialToolSlot, clickDetail: number) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }

    if (isEditMode) {
      if (slot.type === "empty") {
        onEditEmptySlot(menu.slots.indexOf(slot));
      }
      return;
    }

    if (slot.type !== "preset" || !shouldApplyRadialPresetClick(clickDetail)) {
      return;
    }

    if (clickTimerRef.current !== undefined) {
      window.clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = window.setTimeout(() => {
      onApplyPreset(slot);
      clickTimerRef.current = undefined;
    }, radialPresetApplyDelayMs);
  };

  const handleSlotDoubleClick = (index: number) => {
    if (clickTimerRef.current !== undefined) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = undefined;
    }
    setEditingSlotIndex(index);
  };

  const handleSlotKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    slot: RadialToolSlot,
    index: number
  ) => {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (isEditMode && slot.type === "empty") {
      onEditEmptySlot(index);
      return;
    }

    handleSlotClick(slot, 1);
  };

  const onEditEmptySlot = (index: number) => {
    setEditingSlotIndex(index);
  };

  const handleClearSlot = (event: ReactMouseEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    onUpdateSlots(clearRadialSlot(menu.slots, index));
    if (editingSlotIndex === index) {
      setEditingSlotIndex(undefined);
    }
  };

  const radialMenuClassName = [
    "radial-tool-menu",
    isClosing ? "is-closing" : "",
    isEditMode ? "is-editing" : ""
  ].filter(Boolean).join(" ");

  return (
    <div className="radial-tool-layer" onContextMenu={(event) => event.preventDefault()}>
      <div
        ref={menuRef}
        className={radialMenuClassName}
        style={menuStyle}
      >
        <button
          type="button"
          className="radial-tool-center"
          title="Close radial menu"
          aria-label="Close radial menu"
          onClick={onClose}
        />
        {menu.slots.map((slot, index) => {
          const position = slotPosition(index);
          const presetColor =
            slot.type === "preset" && slot.tool === "brush" && slot.applyColor ? slot.color : undefined;
          const lightPreset = textColorForBackground(presetColor) !== undefined;
          const isSlotDragging = draggingSlotIndex === index;
          const isDropTarget = hoveredDropIndex === index && draggingSlotIndex !== index;
          return (
            <div
              key={slot.id}
              className={`radial-tool-slot radial-tool-slot-${slot.type} ${
                lightPreset ? "is-light-preset" : ""
              } ${heldSlotIndex === index ? "is-held" : ""} ${
                isEditMode ? "is-editing" : ""
              } ${isSlotDragging ? "is-dragging" : ""} ${isDropTarget ? "is-drop-target" : ""}`}
              role="button"
              tabIndex={0}
              data-radial-slot-index={index}
              style={{
                left: position.left,
                top: position.top,
                backgroundColor: presetColor,
                color: textColorForBackground(presetColor)
              }}
              title="Click to use, double-click to edit"
              onClick={(event) => handleSlotClick(slot, event.detail)}
              onDoubleClick={() => handleSlotDoubleClick(index)}
              onKeyDown={(event) => handleSlotKeyDown(event, slot, index)}
              onPointerDown={(event) => handleSlotPointerDown(event, slot, index)}
            >
              <span>{slotLabel(slot)}</span>
              <small>{slotDetail(slot)}</small>
              {isEditMode && slot.type !== "empty" ? (
                <button
                  type="button"
                  className="radial-tool-slot-delete"
                  aria-label={`Remove radial shortcut ${index + 1}`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => handleClearSlot(event, index)}
                />
              ) : null}
            </div>
          );
        })}
        {dragHint ? (
          <div
            className={`radial-tool-hint radial-tool-hint-${dragHint.kind}`}
            style={dragHintPosition(dragHint.index)}
          >
            <span>{dragHint.label}</span>
            <div className="radial-tool-preview-wrap">
              <div
                className="radial-tool-preview-dot"
                style={{
                  width: dragHint.preview.diameter,
                  height: dragHint.preview.diameter,
                  backgroundColor: tool === "brush" ? settings.brushColor : "#f3efe4",
                  opacity: dragHint.preview.opacity,
                  filter:
                    dragHint.preview.softness > 0
                      ? `blur(${Math.round(1 + dragHint.preview.softness * 5)}px)`
                      : undefined
                }}
              />
            </div>
            <strong>{dragHint.preview.label}</strong>
          </div>
        ) : null}
        {editorSlot ? (
          <RadialToolSlotEditor
            slot={editorSlot}
            fallbackTool={tool}
            onCancel={() => setEditingSlotIndex(undefined)}
            onSave={(slot) => {
              if (editingSlotIndex === undefined) {
                return;
              }
              onUpdateSlot(editingSlotIndex, slot);
              setEditingSlotIndex(undefined);
            }}
          />
        ) : null}
      </div>
    </div>
  );
};

type RadialToolSlotEditorProps = {
  slot: RadialToolSlot;
  fallbackTool: StrokeTool;
  onCancel: () => void;
  onSave: (slot: RadialToolSlot) => void;
};

const RadialToolSlotEditor = ({ slot, fallbackTool, onCancel, onSave }: RadialToolSlotEditorProps) => {
  const [draft, setDraft] = useState<RadialToolSlot>(() =>
    slot.type === "empty" ? defaultSlotForType("preset", fallbackTool) : slot
  );

  const draftPreset = draft.type === "preset" ? draft : undefined;

  const replaceDraftType = (type: RadialToolSlot["type"]) => {
    setDraft(defaultSlotForType(type, fallbackTool));
  };

  const patchPreset = (patch: Partial<RadialPresetSlot>) => {
    setDraft((current) => (current.type === "preset" ? { ...current, ...patch } : current));
  };

  return (
    <div className="radial-slot-editor" role="dialog" aria-label="Edit radial shortcut">
      <div className="radial-slot-editor-head">
        <strong>Edit shortcut</strong>
        <span>Unchecked values keep the current tool setting.</span>
      </div>
      <label className="radial-editor-row">
        <span>Type</span>
        <select
          value={draft.type}
          onChange={(event) => replaceDraftType(event.target.value as RadialToolSlot["type"])}
        >
          <option value="preset">Preset</option>
          <option value="size-drag">Size drag</option>
          <option value="opacity-drag">Opacity drag</option>
          <option value="softness-drag">Softness drag</option>
          <option value="empty">Empty</option>
        </select>
      </label>
      {draft.type !== "empty" ? (
        <label className="radial-editor-row">
          <span>Label</span>
          <input
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
        </label>
      ) : null}
      {draftPreset ? (
        <>
          <label className="radial-editor-row">
            <span>Tool</span>
            <select
              value={draftPreset.tool}
              onChange={(event) => {
                const nextTool = event.target.value as StrokeTool;
                patchPreset(
                  nextTool === "eraser"
                    ? { tool: nextTool, color: undefined, applyColor: false }
                    : { tool: nextTool }
                );
              }}
            >
              <option value="brush">Brush</option>
              <option value="eraser">Eraser</option>
            </select>
          </label>
          <label className="radial-editor-row radial-editor-check">
            <span>
              <input
                type="checkbox"
                checked={draftPreset.applyColor === true}
                disabled={draftPreset.tool === "eraser"}
                onChange={(event) => patchPreset({ applyColor: event.target.checked })}
              />
              Color
            </span>
            <input
              type="color"
              value={draftPreset.color ?? "#ff5a2a"}
              disabled={draftPreset.tool === "eraser" || draftPreset.applyColor !== true}
              onChange={(event) => patchPreset({ color: event.target.value })}
            />
          </label>
          <label className="radial-editor-row radial-editor-check">
            <span>
              <input
                type="checkbox"
                checked={draftPreset.applySize === true}
                onChange={(event) => patchPreset({ applySize: event.target.checked })}
              />
              Size
            </span>
            <input
              type="range"
              min={draftPreset.tool === "brush" ? 1 : 4}
              max={draftPreset.tool === "brush" ? 28 : 64}
              value={draftPreset.size ?? (draftPreset.tool === "brush" ? 8 : 24)}
              disabled={draftPreset.applySize !== true}
              onChange={(event) => patchPreset({ size: Number(event.target.value) })}
            />
          </label>
          <label className="radial-editor-row radial-editor-check">
            <span>
              <input
                type="checkbox"
                checked={draftPreset.applyOpacity === true}
                onChange={(event) => patchPreset({ applyOpacity: event.target.checked })}
              />
              Opacity
            </span>
            <input
              type="range"
              min={20}
              max={100}
              step={5}
              value={Math.round((draftPreset.opacity ?? 1) * 100)}
              disabled={draftPreset.applyOpacity !== true}
              onChange={(event) => patchPreset({ opacity: Number(event.target.value) / 100 })}
            />
          </label>
          <label className="radial-editor-row radial-editor-check">
            <span>
              <input
                type="checkbox"
                checked={draftPreset.applySoftness === true}
                onChange={(event) => patchPreset({ applySoftness: event.target.checked })}
              />
              Softness
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round((draftPreset.softness ?? 0) * 100)}
              disabled={draftPreset.applySoftness !== true}
              onChange={(event) => patchPreset({ softness: Number(event.target.value) / 100 })}
            />
          </label>
        </>
      ) : null}
      <div className="radial-slot-editor-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" onClick={() => onSave(draft)}>
          OK
        </button>
      </div>
    </div>
  );
};
