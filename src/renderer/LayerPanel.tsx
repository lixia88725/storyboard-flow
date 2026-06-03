import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent
} from "react";
import {
  bitmapLayersForShot,
  sketchBlendModes
} from "../shared/projectOps";
import type { BitmapLayer, Shot, SketchBlendMode } from "../shared/types";
import { activeVisibleBitmapLayerForShot } from "./activeTargets";
import { BitmapLayerThumbnail } from "./BitmapLayerThumbnail";
import {
  blendMenuDirectionFromRects,
  layerDropPlacementFromClientY,
  layerOpacityFromClientX,
  layerRowDragIntentFromDelta,
  type LayerRowDragIntent
} from "./sketchGeometry";

type LayerRowGesture = {
  layerId: string;
  layerIds: string[];
  movableLayerIds: string[];
  startX: number;
  startY: number;
  intent?: LayerRowDragIntent;
  initialOpacities: Record<string, number>;
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

export const copyLayerTargetShotIdFromCandidates = (
  candidateShotIds: Array<string | undefined>,
  sourceShotId: string
): string | undefined =>
  candidateShotIds.find((shotId): shotId is string => Boolean(shotId && shotId !== sourceShotId));

export type LayerPanelProps = {
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
  onCopyLayerToShot: (
    shotId: string,
    layerId: string,
    targetShotId: string,
    targetLayerId?: string,
    placement?: "before" | "after"
  ) => void;
  onUpdateLayerGroupOpacity: (
    shotId: string,
    layerIds: string[],
    deltaOpacity: number,
    initialOpacityByLayerId: Record<string, number>
  ) => void;
};

export const LayerPanel = ({
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
  onCopyLayerToShot,
  onUpdateLayerGroupOpacity
}: LayerPanelProps) => {
  const layers = shot ? bitmapLayersForShot(shot) : [];
  const displayLayers = [...layers].reverse();
  const activeLayer = shot ? activeVisibleBitmapLayerForShot(shot) : undefined;
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
  const [rowGestureVisual, setRowGestureVisual] = useState<LayerRowGestureVisual | undefined>();
  const [copyDragLayerId, setCopyDragLayerId] = useState<string | undefined>();
  const [selectedLayerIds, setSelectedLayerIds] = useState<string[]>([]);
  const suppressNextRowClickRef = useRef(false);
  const layerIdsKey = layers.map((layer) => layer.id).join("|");
  const selectedMergeLayers = layers.filter((layer) => selectedLayerIds.includes(layer.id));
  const isMultiLayerMerge =
    selectedMergeLayers.length >= 2 &&
    selectedMergeLayers.every((layer) => layer.visible && !layer.locked);

  useEffect(() => {
    if (!shot || !isOpen) {
      setSelectedLayerIds([]);
      return;
    }

    const existingLayerIds = new Set(layers.map((layer) => layer.id));
    setSelectedLayerIds((current) => {
      const next = current.filter((layerId) => existingLayerIds.has(layerId));
      return next.length === current.length ? current : next;
    });
  }, [shot?.id, isOpen, layerIdsKey, layers]);

  useEffect(() => {
    if (!shot || !isOpen) {
      return;
    }

    onSelectedLayerIdsChange(shot.id, selectedLayerIds);
  }, [isOpen, onSelectedLayerIdsChange, selectedLayerIds, shot?.id]);

  const interactiveLayerRowTarget = (target: EventTarget | null) => {
    return target instanceof HTMLElement
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
    if (shot && event.altKey && event.button === 0 && !interactiveLayerRowTarget(event.target)) {
      event.stopPropagation();
      event.preventDefault();
      setCopyDragLayerId(layer.id);

      const handlePointerUp = (upEvent: globalThis.PointerEvent) => {
        window.removeEventListener("pointerup", handlePointerUp);
        window.removeEventListener("pointercancel", handlePointerUp);
        setCopyDragLayerId(undefined);

        const targetLayerRow = layerRowFromPoint(upEvent.clientX, upEvent.clientY, new Set());
        const targetLayerId = targetLayerRow?.dataset.layerId;
        if (targetLayerId) {
          const targetRect = targetLayerRow.getBoundingClientRect();
          onCopyLayerToShot(
            shot.id,
            layer.id,
            shot.id,
            targetLayerId,
            layerDropPlacementFromClientY(upEvent.clientY, targetRect.top, targetRect.height)
          );
          return;
        }

        const targetShotId = copyLayerTargetShotIdFromCandidates(
          document
            .elementsFromPoint(upEvent.clientX, upEvent.clientY)
            .map((element) =>
              element instanceof HTMLElement
                ? element.closest<HTMLElement>("[data-shot-id]")?.dataset.shotId
                : undefined
            ),
          shot.id
        );
        if (targetShotId) {
          onCopyLayerToShot(shot.id, layer.id, targetShotId);
        }
      };

      window.addEventListener("pointerup", handlePointerUp, { once: true });
      window.addEventListener("pointercancel", handlePointerUp, { once: true });
      return;
    }

    if (!shot || layer.locked || event.shiftKey || event.button !== 0 || interactiveLayerRowTarget(event.target)) {
      return;
    }

    event.stopPropagation();
    const gestureLayerIds = selectedLayerIds.includes(layer.id) ? selectedLayerIds : [layer.id];
    const movableLayerIds = layers
      .filter((item) => gestureLayerIds.includes(item.id) && !item.locked)
      .map((item) => item.id);

    if (!selectedLayerIds.includes(layer.id)) {
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
        onUpdateLayerGroupOpacity(
          shot.id,
          gesture.movableLayerIds,
          (clientX - gesture.startX) / rect.width,
          gesture.initialOpacities
        );
      } else {
        onUpdateLayer(
          shot.id,
          gesture.layerId,
          { opacity: layerOpacityFromClientX(clientX, rect.left, rect.width) }
        );
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

    const handlePointerUp = (upEvent: globalThis.PointerEvent) => {
      if (gesture.intent) {
        upEvent.preventDefault();
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      setRowGestureVisual(undefined);
      suppressNextRowClickRef.current = Boolean(gesture.intent);
      if (gesture.intent) {
        window.setTimeout(() => {
          suppressNextRowClickRef.current = false;
        }, 0);
      }

      if (gesture.intent === "reorder") {
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
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
  };

  const handleLayerRowClick = (event: MouseEvent<HTMLDivElement>, layer: BitmapLayer) => {
    if (!shot) {
      return;
    }

    if (suppressNextRowClickRef.current) {
      suppressNextRowClickRef.current = false;
      return;
    }

    if (!event.shiftKey) {
      setSelectedLayerIds([layer.id]);
      onSelectLayer(shot.id, layer.id);
      return;
    }

    setOpenBlendMenu(undefined);
    setSelectedLayerIds((current) => {
      if (!current.includes(layer.id)) {
        onSelectLayer(shot.id, layer.id);
        return [...current, layer.id];
      }

      if (current.length <= 1) {
        onSelectLayer(shot.id, layer.id);
        return current;
      }

      const next = current.filter((layerId) => layerId !== layer.id);
      if (layer.id === activeLayerId) {
        const nextActiveLayer = displayLayers.find((item) => next.includes(item.id) && item.visible);
        if (nextActiveLayer) {
          onSelectLayer(shot.id, nextActiveLayer.id);
        }
      }
      return next;
    });
  };

  const beginLayerVisibilityDrag = (
    event: MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>,
    layer: BitmapLayer
  ) => {
    if (!shot || event.button > 0) {
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

    const handleMouseUp = (upEvent: globalThis.MouseEvent | globalThis.PointerEvent) => {
      upEvent.preventDefault();
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("pointermove", handleMouseMove);
      window.removeEventListener("pointerup", handleMouseUp);
    };

    applyToLayer(layer.id);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });
    window.addEventListener("pointermove", handleMouseMove);
    window.addEventListener("pointerup", handleMouseUp, { once: true });
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
                      copyDragLayerId === layer.id ? "is-copy-dragging" : ""
                    } ${
                      isSelectedLayer ? "is-selected" : ""
                    } ${
                      layer.id === activeLayerId ? "is-active" : ""
                    } ${
                      layer.visible ? "" : "is-hidden"
                    } ${
                      layer.locked ? "is-locked" : ""
                    }`}
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
                      <span className={layer.visible ? "layer-eye is-on" : "layer-eye"} />
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
                    <button
                      type="button"
                      className="layer-lock"
                      draggable={false}
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
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="layer-empty">Select a shot to edit layers.</p>
          )}
          <div className="layer-panel-footer">
            <div className="layer-panel-footer-group">
              <button
                type="button"
                onClick={() => {
                  if (shot) {
                    onMergeVisibleLayers(shot.id);
                  }
                }}
                disabled={!shot || visibleLayers.length < 2}
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
                  !shot ||
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
            </div>
            <div className="layer-panel-footer-group">
              <button
                type="button"
                onClick={() => {
                  if (shot) {
                    onAddLayer(shot.id);
                  }
                }}
                disabled={!shot}
                title="Add layer"
                aria-label="Add layer"
              >
                +
              </button>
              <button
                type="button"
                onClick={() => {
                  if (shot && activeLayer) {
                    onRemoveLayer(shot.id, activeLayer.id);
                  }
                }}
                disabled={!shot || !activeLayer || activeLayer.locked || layers.length <= 1}
                title="Delete current layer"
                aria-label="Delete current layer"
              >
                -
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
