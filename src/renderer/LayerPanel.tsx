import {
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
  startX: number;
  startY: number;
  intent?: LayerRowDragIntent;
};
type LayerRowGestureVisual = {
  layerId: string;
  intent: LayerRowDragIntent;
  deltaY: number;
};
type BlendMenuState = {
  layerId: string;
  direction: "down" | "up";
};

export type LayerPanelProps = {
  shot?: Shot;
  folderPath?: string;
  thumbnailRevision: number;
  isOpen: boolean;
  isRendered: boolean;
  onToggle: () => void;
  onAddLayer: (shotId: string) => void;
  onRemoveLayer: (shotId: string, layerId: string) => void;
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
  onClearLayer,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer
}: LayerPanelProps) => {
  const layers = shot ? bitmapLayersForShot(shot) : [];
  const displayLayers = [...layers].reverse();
  const activeLayer = shot ? activeVisibleBitmapLayerForShot(shot) : undefined;
  const activeLayerId = activeLayer?.id;
  const [openBlendMenu, setOpenBlendMenu] = useState<BlendMenuState | undefined>();
  const [rowGestureVisual, setRowGestureVisual] = useState<LayerRowGestureVisual | undefined>();

  const interactiveLayerRowTarget = (target: EventTarget | null) => {
    return target instanceof HTMLElement
      ? target.closest("button, textarea, select, .layer-blend-menu")
      : null;
  };

  const layerRowFromPoint = (clientX: number, clientY: number, excludedLayerId?: string) => {
    const directRow = document
      .elementsFromPoint(clientX, clientY)
      .find((element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.classList.contains("layer-row") &&
        element.dataset.layerId !== excludedLayerId
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
      (row) => row.dataset.layerId !== excludedLayerId
    );
    return clientY < (rows[0]?.getBoundingClientRect().top ?? 0) ? rows[0] : rows.at(-1);
  };

  const beginLayerRowGesture = (event: PointerEvent<HTMLDivElement>, layer: BitmapLayer) => {
    if (!shot || layer.locked || event.button !== 0 || interactiveLayerRowTarget(event.target)) {
      return;
    }

    event.stopPropagation();
    onSelectLayer(shot.id, layer.id);
    setOpenBlendMenu(undefined);
    const initialTarget = event.target;

    const gesture: LayerRowGesture = {
      layerId: layer.id,
      startX: event.clientX,
      startY: event.clientY
    };

    const updateOpacity = (clientX: number) => {
      const row = document.querySelector<HTMLElement>(`[data-layer-id="${gesture.layerId}"]`);
      if (!row) {
        return;
      }

      const rect = row.getBoundingClientRect();
      onUpdateLayer(
        shot.id,
        gesture.layerId,
        { opacity: layerOpacityFromClientX(clientX, rect.left, rect.width) }
      );
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
        setRowGestureVisual({ layerId: gesture.layerId, intent, deltaY: intent === "reorder" ? deltaY : 0 });
      }

      if (gesture.intent === "opacity") {
        moveEvent.preventDefault();
        updateOpacity(moveEvent.clientX);
      } else if (gesture.intent === "reorder") {
        moveEvent.preventDefault();
        setRowGestureVisual({ layerId: gesture.layerId, intent: "reorder", deltaY });
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

      if (gesture.intent === "reorder") {
        const targetRow = layerRowFromPoint(upEvent.clientX, upEvent.clientY, gesture.layerId);
        const targetLayerId = targetRow?.dataset.layerId;
        if (targetRow && targetLayerId && targetLayerId !== gesture.layerId) {
          const rect = targetRow.getBoundingClientRect();
          onMoveLayer(
            shot.id,
            gesture.layerId,
            targetLayerId,
            layerDropPlacementFromClientY(upEvent.clientY, rect.top, rect.height)
          );
        }
      }
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });
  };

  const beginLayerVisibilityDrag = (event: MouseEvent<HTMLButtonElement>, layer: BitmapLayer) => {
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

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      moveEvent.preventDefault();
      const layerId = layerIdFromPoint(moveEvent.clientX, moveEvent.clientY);
      if (layerId) {
        applyToLayer(layerId);
      }
    };

    const handleMouseUp = (upEvent: globalThis.MouseEvent) => {
      upEvent.preventDefault();
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };

    applyToLayer(layer.id);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp, { once: true });
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
                  rowGestureVisual?.layerId === layer.id ? rowGestureVisual : undefined;
                return (
                  <div
                    key={layer.id}
                    data-layer-id={layer.id}
                    className={`layer-row ${rowVisual ? `is-${rowVisual.intent}-dragging is-dragging-layer` : ""} ${
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
                    onClick={() => onSelectLayer(shot.id, layer.id)}
                    onPointerDown={(event) => beginLayerRowGesture(event, layer)}
                  >
                    <button
                      type="button"
                      className="layer-select"
                      data-layer-id={layer.id}
                      draggable={false}
                      title={layer.visible ? "Hide layer" : "Show layer"}
                      aria-label={layer.visible ? "Hide layer" : "Show layer"}
                      onMouseDown={(event) => beginLayerVisibilityDrag(event, layer)}
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
