import { Eye, EyeOff, LockKeyhole, LockKeyholeOpen, SquarePlus, Trash2 } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent
} from "react";
import {
  bitmapLayersForShot,
  sketchBlendModes
} from "../contracts/projectOps";
import type { BitmapLayer, Shot, SketchBlendMode } from "../contracts/types";
import { activeVisibleBitmapLayerForShot } from "./activeTargets";
import { BitmapLayerThumbnail } from "./BitmapLayerThumbnail";
import {
  blendMenuDirectionFromRects,
  layerDropPlacementFromClientY,
  layerOpacityFromClientX,
  layerRowDragIntentFromDelta,
  type LayerRowDragIntent
} from "./sketchGeometry";
import { nextRangeSelection, type RangeSelectionMode } from "../../storyboard/renderer/rangeSelection";
import { layerSelectionForPanelState } from "./layerPanelController";
import { layerMergeAllowed, layerRowGestureEndEffects, type LayerOpacityPhase } from "./layerPanelGestures";

type LayerRowGesture = {
  layerId: string;
  layerIds: string[];
  movableLayerIds: string[];
  startX: number;
  startY: number;
  intent?: LayerRowDragIntent;
  initialOpacities: Record<string, number>;
  opacity?: number;
  deltaOpacity?: number;
};
type LayerRowGestureVisual = {
  layerIds: string[];
  intent: LayerRowDragIntent;
  deltaY: number;
};
type BlendMenuState = {
  layerId: string;
  direction: "down" | "up";
};

export type LayerPanelProps = {
  canBeginLayerGesture?: () => boolean;
  structuralEditsEnabled?: boolean;
  mergeEditsEnabled?: boolean;
  onLayerGroupOpacityGesture?: (shotId:string, layerIds:string[], delta:number, initial:Record<string,number>, phase:'preview'|'commit'|'cancel')=>void;
  onLayerOpacityGesture?: (shotId: string, layerId: string, opacity: number, phase: LayerOpacityPhase) => void;
  /** Host/Session rule for M and V. Absent keeps the historic visible/unlocked policy. */
  canMergeLayerIds?: (layerIds: string[]) => boolean;
  /** Dual-panel route: honour shot.activeLayerId even when that layer is hidden. */
  respectActiveLayer?: boolean;
  docked?: boolean;
  shot?: Shot;
  folderPath?: string;
  thumbnailRevision: number;
  isOpen: boolean;
  isRendered: boolean;
  onToggle: () => void;
  onAddLayer: (shotId: string) => void;
  onRemoveLayer: (shotId: string, layerId: string) => void;
  onMergeLayers: (shotId: string, layerId: string, selectedLayerIds: string[]) => void;
  onMergeVisibleLayers: (shotId: string) => void;
  onClearLayer: (shotId: string, layerId: string) => void;
  onSelectLayer: (shotId: string, layerId: string) => void;
  onUpdateLayer: (
    shotId: string,
    layerId: string,
    patch: Partial<Pick<BitmapLayer, "name" | "visible" | "locked" | "opacity" | "blendMode">>
  ) => void;
  onMoveLayer: (
    shotId: string,
    layerId: string,
    targetLayerId: string,
    placement: "before" | "after"
  ) => void;
  onMoveLayerGroup: (
    shotId: string,
    layerIds: string[],
    targetLayerId: string,
    placement: "before" | "after"
  ) => void;
  onSelectedLayerIdsChange: (shotId: string, layerIds: string[]) => void;
  onUpdateLayerGroupOpacity: (
    shotId: string,
    layerIds: string[],
    deltaOpacity: number,
    initialOpacityByLayerId: Record<string, number>
  ) => void;
};

export const LayerPanel = ({
  structuralEditsEnabled = true,
  mergeEditsEnabled = structuralEditsEnabled,
  onLayerOpacityGesture,
  onLayerGroupOpacityGesture,
  canMergeLayerIds,
  respectActiveLayer,
  docked = false,
  canBeginLayerGesture,
  shot,
  folderPath,
  thumbnailRevision,
  isOpen,
  isRendered,
  onToggle,
  onAddLayer,
  onRemoveLayer,
  onMergeLayers,
  onMergeVisibleLayers,
  onClearLayer,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer,
  onMoveLayerGroup,
  onSelectedLayerIdsChange,
  onUpdateLayerGroupOpacity
}: LayerPanelProps) => {
  const layers = useMemo(() => (shot ? bitmapLayersForShot(shot) : []), [shot]);
  const displayLayers = [...layers].reverse();
  const activeLayer = useMemo(() => {
    if (!shot) {
      return undefined;
    }
    // The dual-panel workbench edits exactly the layer named by shot.activeLayerId, even a
    // hidden one, so panel operations cannot drift onto a different visible layer. The
    // classic editor keeps the historic visible-fallback resolution.
    return respectActiveLayer
      ? layers.find((layer) => layer.id === shot.activeLayerId)
      : activeVisibleBitmapLayerForShot(shot);
  }, [layers, respectActiveLayer, shot]);
  const activeLayerId = activeLayer?.id;
  const activeLayerIndex = activeLayer
    ? layers.findIndex((layer) => layer.id === activeLayer.id)
    : -1;
  const mergeTargetLayer =
    activeLayerIndex > 0
      ? [...layers.slice(0, activeLayerIndex)].reverse().find((layer) => layer.visible)
      : undefined;
  const visibleLayers = layers.filter((layer) => layer.visible);
  const [openBlendMenu, setOpenBlendMenu] = useState<BlendMenuState | undefined>();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const menuRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    el.showPopover();
    el.style.left = Math.max(4, Math.min(menu.x, innerWidth - el.offsetWidth - 4)) + "px";
    el.style.top = Math.max(4, Math.min(menu.y, innerHeight - el.offsetHeight - 4)) + "px";
    (el.querySelector<HTMLButtonElement>("button:not(:disabled)") ?? el).focus();
    const close = () => setMenu(undefined);
    const outside = (e: globalThis.PointerEvent) => { if (!e.composedPath().includes(el)) close(); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", close);
    return () => { document.removeEventListener("pointerdown", outside, true); window.removeEventListener("blur", close); };
  }, [menu]);
  useEffect(() => { setMenu(undefined); }, [isOpen, isRendered, shot?.id]);
  // Any live gesture (row opacity/reorder, visibility drag) registers a teardown here,
  // so closing the panel, switching boards, losing focus or unmounting cannot commit.
  const cancelRowGestureRef = useRef<(() => void) | undefined>(undefined);
  const cancelVisibilityDragRef = useRef<(() => void) | undefined>(undefined);
  const cancelLiveGestures = () => {
    cancelRowGestureRef.current?.();
    cancelVisibilityDragRef.current?.();
  };
  useEffect(() => {
    if (!isOpen || !isRendered) {
      cancelLiveGestures();
      // A popover left open would otherwise reappear the next time the panel opens.
      setOpenBlendMenu(undefined);
    }
  }, [isOpen, isRendered]);
  useEffect(() => () => cancelLiveGestures(), [shot?.id]);
  const [rowGestureVisual, setRowGestureVisual] = useState<LayerRowGestureVisual | undefined>();
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  useEffect(() => {
    if (!docked || !activeLayerId || !isOpen) return;
    setSelectedLayerIds(ids => ids.includes(activeLayerId) ? ids : [activeLayerId]);
  }, [activeLayerId, docked, isOpen]);
  const suppressNextRowClickRef = useRef(false);
  const layerSelectionAnchorIdRef = useRef<string | undefined>(undefined);
  const layerIds = useMemo(() => layers.map((layer) => layer.id), [layers]);
  const layerIdsKey = layerIds.join("|");
  const selectedMergeLayers = layers.filter((layer) => selectedLayerIds.includes(layer.id));
  const isMultiLayerMerge =
    selectedMergeLayers.length >= 2 &&
    selectedMergeLayers.every((layer) => layer.visible && !layer.locked);
  // Host rules (Session) may veto a merge the local visible/locked policy would allow.
  const mergeVisibleLayerIds = visibleLayers.map((layer) => layer.id);
  const mergeSelectionLayerIds =
    selectedMergeLayers.length >= 2
      ? selectedMergeLayers.map((layer) => layer.id)
      : [activeLayer?.id, mergeTargetLayer?.id].filter((id): id is string => Boolean(id));
  const mergeVisibleAllowed =
    mergeEditsEnabled && layerMergeAllowed(mergeVisibleLayerIds, canMergeLayerIds);
  const mergeSelectionAllowed =
    mergeEditsEnabled && layerMergeAllowed(mergeSelectionLayerIds, canMergeLayerIds);

  useEffect(() => {
    if (!shot || !isOpen) {
      layerSelectionAnchorIdRef.current = undefined;
      setSelectedLayerIds((current) =>
        layerSelectionForPanelState({
          availableLayerIds: layerIds,
          hasShot: Boolean(shot),
          isOpen,
          selectedLayerIds: current
        })
      );
      return;
    }

    setSelectedLayerIds((current) => {
      const next = layerSelectionForPanelState({
        availableLayerIds: layerIds,
        hasShot: true,
        isOpen: true,
        selectedLayerIds: current
      });
      if (layerSelectionAnchorIdRef.current && !layerIds.includes(layerSelectionAnchorIdRef.current)) {
        layerSelectionAnchorIdRef.current = next.at(-1);
      }
      return next;
    });
  }, [shot, shot?.id, isOpen, layerIds, layerIdsKey]);

  useEffect(() => {
    if (!shot || !isOpen) {
      return;
    }

    onSelectedLayerIdsChange(shot.id, selectedLayerIds);
  }, [isOpen, onSelectedLayerIdsChange, selectedLayerIds, shot?.id]);

  const openRowMenu = (layer: BitmapLayer, x: number, y: number) => {
    if (!shot) return;
    if (!selectedLayerIds.includes(layer.id)) {
      setSelectedLayerIds([layer.id]);
      layerSelectionAnchorIdRef.current = layer.id;
    }
    if (activeLayerId !== layer.id) onSelectLayer(shot.id, layer.id);
    setMenu({ id: layer.id, x, y });
  };
  const mergeDisabled = !mergeSelectionAllowed || !shot || !activeLayer ||
    (selectedMergeLayers.length >= 2 ? !isMultiLayerMerge : !mergeTargetLayer || activeLayer.locked || mergeTargetLayer.locked);

  const interactiveLayerRowTarget = (target: EventTarget | null) => {
    return target instanceof Element
      ? target.closest("button, textarea, select, .layer-blend-menu")
      : null;
  };

  const layerRowFromPoint = (clientX: number, clientY: number, excludedLayerIds: Set<string>) => {
    const directRow = document
      .elementsFromPoint(clientX, clientY)
      .find((element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.classList.contains("layer-row") &&
        !excludedLayerIds.has(element.dataset.layerId ?? "")
      );
    if (directRow) {
      return directRow;
    }

    const layerList = document
      .elementsFromPoint(clientX, clientY)
      .find((element): element is HTMLElement =>
        element instanceof HTMLElement && element.classList.contains("layer-list")
      );
    if (!layerList) {
      return undefined;
    }

    const rows = Array.from(layerList.querySelectorAll<HTMLElement>(".layer-row")).filter(
      (row) => !excludedLayerIds.has(row.dataset.layerId ?? "")
    );
    return clientY < (rows[0]?.getBoundingClientRect().top ?? 0) ? rows[0] : rows.at(-1);
  };

  const beginLayerRowGesture = (event: PointerEvent<HTMLDivElement>, layer: BitmapLayer) => {
    if (
      !shot ||
      canBeginLayerGesture?.() === false ||
      layer.locked ||
      event.shiftKey ||
      event.metaKey ||
      event.ctrlKey ||
      event.button !== 0 ||
      interactiveLayerRowTarget(event.target)
    ) {
      return;
    }

    cancelLiveGestures();
    event.stopPropagation();
    const gestureLayerIds = selectedLayerIds.includes(layer.id) ? selectedLayerIds : [layer.id];
    const movableLayerIds = layers
      .filter((item) => gestureLayerIds.includes(item.id) && !item.locked)
      .map((item) => item.id);

    if (!selectedLayerIds.includes(layer.id)) {
      layerSelectionAnchorIdRef.current = layer.id;
      setSelectedLayerIds([layer.id]);
      onSelectLayer(shot.id, layer.id);
    }
    setOpenBlendMenu(undefined);
    const initialTarget = event.target;

    const gesture: LayerRowGesture = {
      layerId: layer.id,
      layerIds: gestureLayerIds,
      movableLayerIds,
      startX: event.clientX,
      startY: event.clientY,
      initialOpacities: Object.fromEntries(
        layers
          .filter((item) => movableLayerIds.includes(item.id))
          .map((item) => [item.id, item.opacity ?? 1])
      )
    };

    const updateOpacity = (clientX: number) => {
      const row = document.querySelector<HTMLElement>(`[data-layer-id="${gesture.layerId}"]`);
      if (!row) {
        return;
      }

      const rect = row.getBoundingClientRect();
      if (gesture.movableLayerIds.length > 1) {
        gesture.deltaOpacity=(clientX-gesture.startX)/rect.width;
        if(onLayerGroupOpacityGesture)onLayerGroupOpacityGesture(shot.id,gesture.movableLayerIds,gesture.deltaOpacity,gesture.initialOpacities,'preview');
        else onUpdateLayerGroupOpacity(shot.id,gesture.movableLayerIds,gesture.deltaOpacity,gesture.initialOpacities);
      } else {
        const opacity = layerOpacityFromClientX(clientX, rect.left, rect.width);
        gesture.opacity = opacity;
        if (onLayerOpacityGesture) onLayerOpacityGesture(shot.id, gesture.layerId, opacity, "preview");
        else onUpdateLayer(shot.id, gesture.layerId, { opacity });
      }
    };

    const handlePointerMove = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      const deltaX = moveEvent.clientX - gesture.startX;
      const deltaY = moveEvent.clientY - gesture.startY;

      if (!gesture.intent) {
        const intent = layerRowDragIntentFromDelta(deltaX, deltaY);
        if (!intent) {
          return;
        }
        moveEvent.preventDefault();
        if (initialTarget instanceof HTMLInputElement) {
          initialTarget.blur();
        }
        if (intent === "reorder" && !structuralEditsEnabled) return;
        gesture.intent = intent;
        setRowGestureVisual({
          layerIds: gesture.movableLayerIds,
          intent,
          deltaY: intent === "reorder" ? deltaY : 0
        });
      }

      if (gesture.intent === "opacity") {
        moveEvent.preventDefault();
        updateOpacity(moveEvent.clientX);
      } else if (gesture.intent === "reorder") {
        moveEvent.preventDefault();
        setRowGestureVisual({ layerIds: gesture.movableLayerIds, intent: "reorder", deltaY });
      }
    };

    const gestureHasGroupCallback =
      Boolean(onLayerGroupOpacityGesture) && gesture.movableLayerIds.length > 1;
    const gestureHasOpacityCallback = Boolean(onLayerOpacityGesture);

    const detach = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("blur", handleCancel);
    };

    const emitEnd = (cancelled: boolean) => {
      const effects = layerRowGestureEndEffects({
        intent: gesture.intent,
        cancelled,
        groupCallback: gestureHasGroupCallback,
        opacityCallback: gestureHasOpacityCallback,
        opacity: gesture.opacity,
        deltaOpacity: gesture.deltaOpacity
      });
      if (effects.groupOpacityPhase && onLayerGroupOpacityGesture) {
        onLayerGroupOpacityGesture(
          shot.id,
          gesture.movableLayerIds,
          gesture.deltaOpacity ?? 0,
          gesture.initialOpacities,
          effects.groupOpacityPhase
        );
      }
      if (effects.opacityPhase && onLayerOpacityGesture) {
        onLayerOpacityGesture(shot.id, gesture.layerId, gesture.opacity ?? 1, effects.opacityPhase);
      }
      return effects;
    };

    const finish = (cancelled: boolean) => {
      detach();
      cancelRowGestureRef.current = undefined;
      setRowGestureVisual(undefined);
      suppressNextRowClickRef.current = Boolean(gesture.intent);
      if (gesture.intent) {
        window.setTimeout(() => {
          suppressNextRowClickRef.current = false;
        }, 0);
      }
      return emitEnd(cancelled);
    };

    // Pointercancel, window blur, panel close, board switch and unmount all cancel:
    // the host rolls the preview back and a pending reorder never moves a layer.
    const handleCancel = () => {
      finish(true);
    };

    const handlePointerUp = (upEvent: globalThis.PointerEvent) => {
      const cancelled = upEvent.type === "pointercancel";
      if (gesture.intent) {
        upEvent.preventDefault();
      }
      const effects = finish(cancelled);
      if (cancelled || !effects.reorder) {
        return;
      }

      const targetRow = layerRowFromPoint(upEvent.clientX, upEvent.clientY, new Set(gesture.movableLayerIds));
      const targetLayerId = targetRow?.dataset.layerId;
      if (targetRow && targetLayerId && targetLayerId !== gesture.layerId) {
        const rect = targetRow.getBoundingClientRect();
        const placement = layerDropPlacementFromClientY(upEvent.clientY, rect.top, rect.height);
        if (gesture.movableLayerIds.length > 1) {
          onMoveLayerGroup(shot.id, gesture.movableLayerIds, targetLayerId, placement);
        } else {
          onMoveLayer(shot.id, gesture.layerId, targetLayerId, placement);
        }
      }
    };

    cancelRowGestureRef.current = handleCancel;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
    window.addEventListener("blur", handleCancel);
  };

  const handleLayerRowClick = (event: MouseEvent<HTMLDivElement>, layer: BitmapLayer) => {
    if (!shot) {
      return;
    }

    if (suppressNextRowClickRef.current) {
      suppressNextRowClickRef.current = false;
      return;
    }

    setOpenBlendMenu(undefined);
    const mode: RangeSelectionMode = event.shiftKey
      ? "range"
      : event.metaKey || event.ctrlKey
        ? "toggle"
        : "single";
    const orderedLayerIds = displayLayers.map((item) => item.id);
    setSelectedLayerIds((current) => {
      const selection = nextRangeSelection({
        orderedIds: orderedLayerIds,
        selectedIds: current,
        clickedId: layer.id,
        anchorId: layerSelectionAnchorIdRef.current,
        mode
      });
      layerSelectionAnchorIdRef.current = selection.anchorId;
      const activeSelectionLayer =
        selection.selectedIds.includes(layer.id)
          ? layer
          : displayLayers.find((item) => selection.selectedIds.includes(item.id) && item.visible) ?? layer;
      onSelectLayer(shot.id, activeSelectionLayer.id);
      return selection.selectedIds;
    });
  };

  const beginLayerVisibilityDrag = (
    event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>,
    layer: BitmapLayer
  ) => {
    if (!shot || event.button > 0) {
      return;
    }
    // A pointerdown is followed by a compat mousedown for the same press. Keep one drag.
    if (cancelVisibilityDragRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    const targetVisible = !layer.visible;
    const gesture = {
      targetVisible,
      visitedLayerIds: new Set()
    };

    const applyToLayer = (layerId: string) => {
      if (!shot || gesture.visitedLayerIds.has(layerId)) {
        return;
      }
      const targetLayer = displayLayers.find((item) => item.id === layerId);
      if (!targetLayer || targetLayer.visible === gesture.targetVisible) {
        gesture.visitedLayerIds.add(layerId);
        return;
      }
      gesture.visitedLayerIds.add(layerId);
      onUpdateLayer(shot.id, layerId, { visible: gesture.targetVisible });
    };

    const layerIdFromPoint = (clientX: number, clientY: number) => {
      const button = document
        .elementsFromPoint(clientX, clientY)
        .find((element): element is HTMLElement =>
          element instanceof HTMLElement && Boolean(element.closest(".layer-select"))
        )
        ?.closest<HTMLElement>(".layer-select");
      return button?.dataset.layerId;
    };

    const handleMouseMove = (moveEvent: globalThis.MouseEvent | globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      const layerId = layerIdFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (layerId) {
        applyToLayer(layerId);
      }
    };

    const endVisibilityDrag = (upEvent?: Event) => {
      upEvent?.preventDefault();
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", endVisibilityDrag);
      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("pointerup", endVisibilityDrag);
      window.removeEventListener("pointercancel", endVisibilityDrag);
      window.removeEventListener("blur", endVisibilityDrag);
      cancelVisibilityDragRef.current = undefined;
    };

    applyToLayer(layer.id);
    cancelVisibilityDragRef.current = () => endVisibilityDrag();
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", endVisibilityDrag, { once: true });
    window.addEventListener("pointermove", handleMouseMove);
    window.addEventListener("pointerup", endVisibilityDrag, { once: true });
    window.addEventListener("pointercancel", endVisibilityDrag);
    window.addEventListener("blur", endVisibilityDrag);
  };

  return (
    <div
      className={`shot-layer-popover ${isRendered ? (isOpen ? "is-open" : "is-closing") : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDragStart={(event) => event.stopPropagation()}
      onDragOver={(event) => event.stopPropagation()}
      onDrop={(event) => event.stopPropagation()}
    >
      {isRendered ? (
        <section
          className="layer-panel"
          aria-label="Storyboard layers"
        >
          {docked && shot && <div className="dock-layer-properties">
            <label><span>混合模式</span><select aria-label="混合模式" value={activeLayer?.blendMode ?? "normal"} disabled={!activeLayer || activeLayer.locked}
              onChange={e => activeLayer && onUpdateLayer(shot.id, activeLayer.id, { blendMode: e.target.value as SketchBlendMode })}>
              {sketchBlendModes.map(mode => <option key={mode} value={mode}>{{normal:"正常",multiply:"正片叠底",screen:"滤色"}[mode]}</option>)}
            </select></label>
            <output title="左右拖动图层行可调整不透明度">不透明度 <b>{activeLayer ? Math.round((activeLayer.opacity ?? 1)*100)+"%" : "—"}</b></output>
            <button type="button" aria-label={activeLayer?.locked ? "解锁当前图层" : "锁定当前图层"} aria-pressed={!!activeLayer?.locked}
              disabled={!activeLayer || !!activeLayer.sourceReference} title={activeLayer?.locked ? "解锁当前图层" : "锁定当前图层"}
              onClick={() => activeLayer && onUpdateLayer(shot.id, activeLayer.id, {locked: !activeLayer.locked})}>
              {activeLayer?.locked ? <LockKeyhole size={15}/> : <LockKeyholeOpen size={15}/>}</button>
          </div>}
          {shot ? (
            <div className="layer-list">
              {displayLayers.map((layer) => {
                const layerBlendMode = layer.blendMode ?? "normal";
                const rowVisual =
                  rowGestureVisual?.layerIds.includes(layer.id) ? rowGestureVisual : undefined;
                const isSelectedLayer = selectedLayerIds.includes(layer.id);
                return (
                  <div
                    key={layer.id}
                    data-layer-id={layer.id}
                    className={`layer-row ${rowVisual ? `is-${rowVisual.intent}-dragging is-dragging-layer` : ""} ${
                      isSelectedLayer ? "is-selected" : ""
                    } ${
                      layer.id === activeLayerId ? "is-active" : ""
                    } ${
                      layer.visible ? "" : "is-hidden"
                    } ${
                      layer.locked ? "is-locked" : ""
                    }`}
                    tabIndex={docked ? 0 : undefined}
                    onContextMenu={docked ? e => {e.preventDefault(); e.stopPropagation(); openRowMenu(layer,e.clientX,e.clientY);} : undefined}
                    onKeyDown={docked ? e => {
                      if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                        e.preventDefault(); const r=e.currentTarget.getBoundingClientRect(); openRowMenu(layer,r.left+12,r.bottom);
                      }
                    } : undefined}
                    style={{
                      "--layer-opacity-width": `${Math.round((layer.opacity ?? 1) * 100)}%`,
                      transform:
                        rowVisual?.intent === "reorder"
                          ? `translateY(${rowVisual.deltaY}px)`
                          : undefined
                    } as CSSProperties}
                    onClick={(event) => handleLayerRowClick(event, layer)}
                    onPointerDown={(event) => beginLayerRowGesture(event, layer)}
                  >
                    <button
                      type="button"
                      className="layer-select"
                      data-layer-id={layer.id}
                      draggable={false}
	                      title={layer.visible ? "Hide layer" : "Show layer"}
	                      aria-label={layer.visible ? "Hide layer" : "Show layer"}
	                      onPointerDown={(event) => {
	                        event.stopPropagation();
	                        beginLayerVisibilityDrag(event, layer);
	                      }}
	                      onMouseDown={(event) => {
	                        event.stopPropagation();
	                        beginLayerVisibilityDrag(event, layer);
	                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (event.detail === 0) {
                          onUpdateLayer(shot.id, layer.id, { visible: !layer.visible });
                        }
                      }}
                    >
                      {docked ? (layer.visible ? <Eye size={16}/> : <EyeOff size={16}/>) : <span className={layer.visible ? "layer-eye is-on" : "layer-eye"} />}
                    </button>
                    <BitmapLayerThumbnail
                      layer={layer}
                      shot={shot}
                      folderPath={folderPath}
                      revision={thumbnailRevision}
                    />
                    <input
                      aria-label="Layer name"
                      value={layer.name}
                      draggable={false}
                      disabled={layer.locked}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) =>
                        onUpdateLayer(shot.id, layer.id, { name: event.target.value })
                      }
                    />
                    {docked ? (layer.locked && <LockKeyhole className="dock-row-lock" size={12} aria-label="已锁定"/>) : <>
                    <button
                      type="button"
                      className="layer-lock"
                      draggable={false}
                      disabled={!!layer.sourceReference}
                      title={layer.locked ? "Unlock layer" : "Lock layer"}
                      aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        onUpdateLayer(shot.id, layer.id, { locked: !layer.locked });
                      }}
                    >
                      {layer.locked ? "L" : ""}
                    </button>
                    <button
                      type="button"
                      className={`layer-blend-dot layer-blend-dot-${layerBlendMode}`}
                      draggable={false}
                      disabled={layer.locked}
                      title={`Blend mode: ${blendModeLabel(layerBlendMode)}`}
                      aria-label={`Layer blend mode: ${layerBlendMode}`}
                      aria-expanded={openBlendMenu?.layerId === layer.id}
                      onPointerDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        const rowRect = event.currentTarget
                          .closest(".layer-row")
                          ?.getBoundingClientRect();
                        const listRect = event.currentTarget
                          .closest(".layer-list")
                          ?.getBoundingClientRect();
                        const direction =
                          rowRect && listRect
                            ? blendMenuDirectionFromRects(
                                rowRect.top,
                                rowRect.bottom,
                                listRect.top,
                                listRect.bottom
                              )
                            : "down";
                        setOpenBlendMenu((current) => {
                          if (current?.layerId === layer.id) {
                            return undefined;
                          }

                          return {
                            layerId: layer.id,
                            direction
                          };
                        });
                      }}
                    />
                    {openBlendMenu?.layerId === layer.id ? (
                      <div
                        className={`layer-blend-menu layer-blend-menu-${openBlendMenu.direction}`}
                        role="menu"
                        aria-label="Layer blend mode options"
                      >
                        {sketchBlendModes.map((blendMode) => (
                          <button
                            key={blendMode}
                            type="button"
                            className={layerBlendMode === blendMode ? "is-selected" : ""}
                            role="menuitem"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              onUpdateLayer(shot.id, layer.id, { blendMode });
                              setOpenBlendMenu(undefined);
                            }}
                          >
                            <span className={`layer-blend-dot layer-blend-dot-${blendMode}`} />
                            {blendModeLabel(blendMode)}
                          </button>
                        ))}
                      </div>
                    ) : null}</>}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="layer-empty">Select a shot to edit layers.</p>
          )}
          {docked && menu && shot && <div ref={menuRef} className="dock-layer-menu" popover="manual" role="menu" aria-label="图层操作" tabIndex={-1}
            onKeyDown={e => {
              if(e.key === "Escape"){e.preventDefault(); setMenu(undefined); document.querySelector<HTMLElement>(".wb-panel-layers .layer-row.is-active")?.focus();}
              if(e.key === "ArrowDown" || e.key === "ArrowUp"){e.preventDefault(); e.stopPropagation(); const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")); const i=items.indexOf(document.activeElement as HTMLButtonElement); items[(i+(e.key==="ArrowDown"?1:-1)+items.length)%items.length]?.focus();}
            }}>
            <button role="menuitem" disabled={mergeDisabled || activeLayerId !== menu.id}
              onClick={() => {setMenu(undefined); onMergeLayers(shot.id, menu.id, mergeSelectionLayerIds);}}>
              {selectedMergeLayers.length >= 2 ? "合并所选图层" : "向下合并"}</button>
            <button role="menuitem" disabled={!mergeVisibleAllowed || visibleLayers.length < 2}
              onClick={() => {setMenu(undefined); onMergeVisibleLayers(shot.id);}}>合并可见图层</button>
          </div>}
          <div className="layer-panel-footer">
            {!docked && <div className="layer-panel-footer-group">
              <button
                type="button"
                onClick={() => {
                  if (shot) {
                    onMergeVisibleLayers(shot.id);
                  }
                }}
                disabled={!mergeVisibleAllowed || !shot || visibleLayers.length < 2}
                title="Merge visible layers"
                aria-label="Merge visible layers"
              >
                V
              </button>
              <button
                type="button"
                onClick={() => {
                  if (shot && activeLayer) {
                    onMergeLayers(shot.id, activeLayer.id, selectedLayerIds);
                  }
                }}
                disabled={
                  !mergeSelectionAllowed || !shot ||
                  !activeLayer ||
                  (selectedMergeLayers.length >= 2
                    ? !isMultiLayerMerge
                    : !mergeTargetLayer || activeLayer.locked || mergeTargetLayer.locked)
                }
                title="Merge"
                aria-label="Merge"
              >
                M
              </button>
            </div>}
            <div className="layer-panel-footer-group">
              <button
                type="button"
                onClick={() => {
                  if (shot) {
                    onAddLayer(shot.id);
                  }
                }}
                disabled={!structuralEditsEnabled || !shot}
                title={docked ? "新建图层" : "Add layer"}
                aria-label="Add layer"
              >
                {docked ? <SquarePlus size={16}/> : "+"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (shot && activeLayer) {
                    onRemoveLayer(shot.id, activeLayer.id);
                  }
                }}
                disabled={!structuralEditsEnabled || !shot || !activeLayer || activeLayer.locked || layers.length <= 1}
                title={docked ? "删除当前图层" : "Delete current layer"}
                aria-label="Delete current layer"
              >
                {docked ? <Trash2 size={16}/> : "-"}
              </button>
            </div>
          </div>
        </section>
      ) : null}
      <button
        type="button"
        className={`layer-toggle ${isOpen ? "is-open" : ""}`}
        onClick={onToggle}
        title="Layers"
        aria-label="Toggle shot layers"
        aria-expanded={isOpen}
      />
    </div>
  );
};

const blendModeLabel = (blendMode: SketchBlendMode): string => {
  if (blendMode === "multiply") {
    return "Multiply";
  }

  if (blendMode === "screen") {
    return "Screen";
  }

  return "Normal";
};
