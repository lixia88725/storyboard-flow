import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from "react";
import type { StrokeTool } from "../shared/types";
import {
  radialDragPreviewState,
  radialDragValue,
  radialPresetApplyDelayMs,
  registerRadialDragListeners,
  shouldApplyRadialPresetClick,
  shouldCloseRadialMenuFromOutsidePointerDown,
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
  onClose
}: RadialToolMenuProps) => {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  const clickTimerRef = useRef<number | undefined>(undefined);
  const activeDragCleanupRef = useRef<(() => void) | undefined>(undefined);
  const [editingSlotIndex, setEditingSlotIndex] = useState<number | undefined>();
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

  const beginDrag = (event: ReactPointerEvent<HTMLButtonElement>, slot: RadialToolSlot, index: number) => {
    const kind = dragKindForSlot(slot);
    if (!kind) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const initial = activeValueForKind(settings, tool, kind);
    const range = dragRangeForKind(tool, kind);
    setDragHint({
      index,
      kind,
      label: kind === "size" ? "调尺寸" : kind === "opacity" ? "调透明度" : "调软硬",
      preview: radialDragPreviewState({ kind, value: initial, min: range.min, max: range.max })
    });

    activeDragCleanupRef.current?.();
    activeDragCleanupRef.current = registerRadialDragListeners(window, (pointerEvent) => {
      const nextValue = radialDragValue({
        kind,
        initial,
        deltaX: pointerEvent.clientX - startX,
        min: range.min,
        max: range.max
      });
      onAdjust(kind, nextValue);
      setDragHint({
        index,
        kind,
        label: kind === "size" ? "调尺寸" : kind === "opacity" ? "调透明度" : "调软硬",
          preview: radialDragPreviewState({ kind, value: nextValue, min: range.min, max: range.max })
        });
      },
      () => {
        activeDragCleanupRef.current = undefined;
        setDragHint(undefined);
      }
    );
  };

  const handleSlotClick = (slot: RadialToolSlot, clickDetail: number) => {
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

  return (
    <div className="radial-tool-layer" onContextMenu={(event) => event.preventDefault()}>
      <div
        ref={menuRef}
        className={`radial-tool-menu ${isClosing ? "is-closing" : ""}`}
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
          return (
            <button
              key={slot.id}
              type="button"
              className={`radial-tool-slot radial-tool-slot-${slot.type} ${
                lightPreset ? "is-light-preset" : ""
              }`}
              style={{
                left: position.left,
                top: position.top,
                backgroundColor: presetColor,
                color: textColorForBackground(presetColor)
              }}
              title="Click to use, double-click to edit"
              onClick={(event) => handleSlotClick(slot, event.detail)}
              onDoubleClick={() => handleSlotDoubleClick(index)}
              onPointerDown={(event) => beginDrag(event, slot, index)}
            >
              <span>{slotLabel(slot)}</span>
              <small>{slotDetail(slot)}</small>
            </button>
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
