import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Layer, Line, Stage } from "react-konva";
import { bitmapLayersForShot, imageBitmapLayerId } from "../shared/projectOps";
import type {
  BitmapLayer,
  BitmapSelectionMode,
  Shot,
  SketchStroke,
  SketchTool,
  StrokeTool
} from "../shared/types";
import {
  bitmapSelectionBounds,
  bitmapSelectionHandleRadiusForStage,
  bitmapSelectionHitTarget,
  latestStrokeSegment,
  liveStrokePreviewOpacity,
  scaleBitmapSelectionBounds,
  shouldAppendStrokePoint,
  shouldRenderLiveStroke,
  sketchCanvasSize,
  sketchPointFromClientPoint,
  type Bounds,
  type CanvasSize,
  type Point,
  type SelectionCorner
} from "./sketchGeometry";
import {
  canvasSizeForShot,
  cssBlendMode,
  drawImageUrl,
  drawStrokePathOnCanvas
} from "./sketchRendering";

type BitmapSelection = {
  mode: BitmapSelectionMode;
  points: Point[];
  bounds: Bounds;
};
type BitmapSelectionDraft = {
  mode: BitmapSelectionMode;
  points: Point[];
};
type BitmapTransformDraft = {
  type: "move" | "scale";
  startPoint: Point;
  startBounds: Bounds;
  currentBounds: Bounds;
  corner?: SelectionCorner;
};
type PreparedBitmapTransform = {
  layerId: string;
  selection: BitmapSelection;
  sourceCanvas: HTMLCanvasElement;
  patchCanvas: HTMLCanvasElement;
};
const blurActiveFormControl = () => {
  const activeElement = document.activeElement;
  if (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLSelectElement
  ) {
    activeElement.blur();
  }
};

const BitmapSelectionOverlay = ({
  selection,
  draft,
  transformBounds,
  stageSize,
  canvasSize
}: {
  selection?: BitmapSelection;
  draft?: BitmapSelectionDraft;
  transformBounds?: Bounds;
  stageSize: CanvasSize;
  canvasSize: CanvasSize;
}) => {
  const scaleX = stageSize.width / canvasSize.width;
  const scaleY = stageSize.height / canvasSize.height;
  const activeBounds = transformBounds ?? selection?.bounds;
  const draftSelection = draft ? buildOverlaySelection(draft) : undefined;
  const points = draftSelection?.points ?? selection?.points;
  const pathPoints = points?.map((point) => `${point.x * scaleX},${point.y * scaleY}`).join(" ");

  return (
    <svg className="bitmap-selection-overlay" viewBox={`0 0 ${stageSize.width} ${stageSize.height}`}>
      {pathPoints ? <polygon className="bitmap-selection-outline" points={pathPoints} /> : null}
      {activeBounds ? (
        <>
          <rect
            className="bitmap-selection-bounds"
            x={activeBounds.x * scaleX}
            y={activeBounds.y * scaleY}
            width={activeBounds.width * scaleX}
            height={activeBounds.height * scaleY}
          />
          {[
            [activeBounds.x, activeBounds.y],
            [activeBounds.x + activeBounds.width, activeBounds.y],
            [activeBounds.x, activeBounds.y + activeBounds.height],
            [activeBounds.x + activeBounds.width, activeBounds.y + activeBounds.height]
          ].map(([x, y]) => (
            <rect
              key={`${x}-${y}`}
              className="bitmap-selection-handle"
              x={x * scaleX - 4}
              y={y * scaleY - 4}
              width={8}
              height={8}
            />
          ))}
        </>
      ) : null}
    </svg>
  );
};

const buildOverlaySelection = (draft: BitmapSelectionDraft): BitmapSelection | undefined => {
  const points =
    draft.mode === "rectangle" && draft.points.length >= 2
      ? [
          draft.points[0],
          { x: draft.points[1].x, y: draft.points[0].y },
          draft.points[1],
          { x: draft.points[0].x, y: draft.points[1].y }
        ]
      : draft.points;
  const bounds = bitmapSelectionBounds(points);
  return bounds ? { mode: draft.mode, points, bounds } : undefined;
};

export type SketchPadProps = {
  shot: Shot;
  folderPath?: string;
  tool: SketchTool;
  selectionMode: BitmapSelectionMode;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  eraserOpacity: number;
  eraserSize: number;
  onionSkinPreviousShot?: Shot;
  onionSkinNextShot?: Shot;
  onStroke: (
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string
  ) => Promise<string | undefined>;
  onSelectionTransform: (layerId: string, dataUrl: string) => Promise<string | undefined>;
  onFocusShot: () => void;
};

export const SketchPad = ({
  shot,
  folderPath,
  tool,
  selectionMode,
  brushColor,
  brushOpacity,
  brushSize,
  eraserOpacity,
  eraserSize,
  onionSkinPreviousShot,
  onionSkinNextShot,
  onStroke,
  onSelectionTransform,
  onFocusShot
}: SketchPadProps) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftStroke, setDraftStroke] = useState<SketchStroke | undefined>();
  const [stageSize, setStageSize] = useState(sketchCanvasSize);
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const isDrawingRef = useRef(false);
  const draftStrokeRef = useRef<SketchStroke | undefined>(undefined);
  const draftStrokeRenderFrameRef = useRef<number | undefined>(undefined);
  const pendingDraftStrokeRef = useRef<SketchStroke | undefined>(undefined);
  const liveBitmapCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const liveBitmapLayerIdRef = useRef<string | undefined>(undefined);
  const liveBitmapEditRunRef = useRef(0);
  const transformPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapSelectionRef = useRef<BitmapSelection | undefined>(undefined);
  const selectionDraftRef = useRef<BitmapSelectionDraft | undefined>(undefined);
  const transformDraftRef = useRef<BitmapTransformDraft | undefined>(undefined);
  const preparedTransformRef = useRef<PreparedBitmapTransform | undefined>(undefined);
  const transformPrepareRunRef = useRef(0);
  const imageSrc = window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath);
  const canvasSize = useMemo(() => canvasSizeForShot(shot), [shot]);
  const bitmapLayers = useMemo(() => bitmapLayersForShot(shot), [shot]);
  const activeLayer = useMemo(
    () =>
      bitmapLayers.find((layer) => layer.id === shot.activeLayerId && layer.visible) ??
      [...bitmapLayers].reverse().find((layer) => layer.visible),
    [bitmapLayers, shot.activeLayerId]
  );
  const activeDrawingLayerId = activeLayer?.id ?? imageBitmapLayerId;
  const [layerDataUrls, setLayerDataUrls] = useState<Record<string, string>>({});
  const [liveBitmapLayerId, setLiveBitmapLayerId] = useState<string | undefined>();
  const [bitmapSelection, setBitmapSelection] = useState<BitmapSelection | undefined>();
  const [selectionDraft, setSelectionDraft] = useState<BitmapSelectionDraft | undefined>();
  const [transformDraft, setTransformDraft] = useState<BitmapTransformDraft | undefined>();
  const [isTransformPreviewReady, setIsTransformPreviewReady] = useState(false);

  useEffect(() => {
    draftStrokeRef.current = draftStroke;
  }, [draftStroke]);

  useEffect(
    () => () => {
      if (draftStrokeRenderFrameRef.current !== undefined) {
        window.cancelAnimationFrame(draftStrokeRenderFrameRef.current);
      }
    },
    []
  );

  useEffect(() => {
    clearBitmapSelectionState();
  }, [activeDrawingLayerId, selectionMode, shot.id]);

  useEffect(() => {
    if (tool !== "select") {
      clearBitmapSelectionState();
    }
  }, [tool]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        clearBitmapSelectionState();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadLayers = async () => {
      const entries = await Promise.all(
        bitmapLayers.map(async (layer) => {
          if (layer.cleared) {
            return [layer.id, undefined] as const;
          }

          const dataUrl = folderPath
            ? await window.storyboard
                .readLayerPng({ folderPath, bitmapPath: layer.bitmapPath })
                .catch(() => undefined)
            : undefined;
          return [layer.id, dataUrl] as const;
        })
      );

      if (!cancelled) {
        setLayerDataUrls(
          Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])))
        );
      }
    };

    void loadLayers();

    return () => {
      cancelled = true;
    };
  }, [bitmapLayers, folderPath, shot]);

  useEffect(() => {
    const element = imageStageRef.current;
    if (!element) {
      return;
    }

    const updateStageSize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize({ width: rect.width, height: rect.height });
      }
    };

    updateStageSize();
    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(element);

    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (!isDrawing) {
      return;
    }

    const finishGlobalStroke = () => {
      if (tool === "select") {
        void finishBitmapSelection();
        updateDrawingState(false);
        return;
      }

      const currentStroke = draftStrokeRef.current;
      if (currentStroke && currentStroke.points.length >= 4) {
        void commitStroke(activeDrawingLayerId, currentStroke);
      } else {
        clearDraftStroke();
      }

      updateDrawingState(false);
    };

    window.addEventListener("mouseup", finishGlobalStroke, { once: true });
    window.addEventListener("touchend", finishGlobalStroke, { once: true });

    return () => {
      window.removeEventListener("mouseup", finishGlobalStroke);
      window.removeEventListener("touchend", finishGlobalStroke);
    };
  }, [activeDrawingLayerId, isDrawing, onStroke, tool, selectionDraft, transformDraft, bitmapSelection]);

  const commitStroke = async (layerId: string, stroke: SketchStroke) => {
    try {
      const renderedDataUrl =
        stroke.tool === "eraser" && liveBitmapLayerIdRef.current === layerId
          ? liveBitmapCanvasRefs.current[layerId]?.toDataURL("image/png")
          : undefined;
      const dataUrl = await onStroke(layerId, stroke, renderedDataUrl);
      if (dataUrl) {
        setLayerDataUrls((current) => ({ ...current, [layerId]: dataUrl }));
      }
    } finally {
      if (draftStrokeRef.current?.id === stroke.id) {
        clearDraftStroke();
      }
      clearLiveBitmapEdit();
    }
  };

  const scheduleDraftStrokeRender = (stroke: SketchStroke) => {
    pendingDraftStrokeRef.current = stroke;
    if (draftStrokeRenderFrameRef.current !== undefined) {
      return;
    }

    draftStrokeRenderFrameRef.current = window.requestAnimationFrame(() => {
      draftStrokeRenderFrameRef.current = undefined;
      setDraftStroke(pendingDraftStrokeRef.current);
    });
  };

  const clearDraftStroke = () => {
    if (draftStrokeRenderFrameRef.current !== undefined) {
      window.cancelAnimationFrame(draftStrokeRenderFrameRef.current);
      draftStrokeRenderFrameRef.current = undefined;
    }

    pendingDraftStrokeRef.current = undefined;
    setDraftStroke(undefined);
    draftStrokeRef.current = undefined;
  };

  const updateDrawingState = (drawing: boolean) => {
    isDrawingRef.current = drawing;
    setIsDrawing(drawing);
  };

  const updateBitmapSelectionState = (selection: BitmapSelection | undefined) => {
    bitmapSelectionRef.current = selection;
    setBitmapSelection(selection);
  };

  const updateSelectionDraftState = (draft: BitmapSelectionDraft | undefined) => {
    selectionDraftRef.current = draft;
    setSelectionDraft(draft);
  };

  const updateTransformDraftState = (draft: BitmapTransformDraft | undefined) => {
    transformDraftRef.current = draft;
    setTransformDraft(draft);
  };

  const clearBitmapSelectionState = () => {
    updateBitmapSelectionState(undefined);
    updateSelectionDraftState(undefined);
    updateTransformDraftState(undefined);
    clearPreparedTransform();
  };

  const clearPreparedTransform = () => {
    transformPrepareRunRef.current += 1;
    preparedTransformRef.current = undefined;
    setIsTransformPreviewReady(false);
    const previewCanvas = transformPreviewCanvasRef.current;
    previewCanvas?.getContext("2d")?.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
  };

  const layerSourceUrl = (layer: BitmapLayer) =>
    layerDataUrls[layer.id] ?? (layer.kind === "image" && !layer.cleared ? imageSrc : undefined);

  const prepareLiveBitmapEdit = async (layer: BitmapLayer) => {
    const editRun = liveBitmapEditRunRef.current + 1;
    liveBitmapEditRunRef.current = editRun;
    const canvas = liveBitmapCanvasRefs.current[layer.id];
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    canvas.width = Math.max(1, Math.round(layer.width));
    canvas.height = Math.max(1, Math.round(layer.height));
    context.clearRect(0, 0, canvas.width, canvas.height);

    const sourceUrl = layerSourceUrl(layer);
    if (sourceUrl) {
      await drawImageUrl(context, sourceUrl, canvas.width, canvas.height).catch(() => {
        context.clearRect(0, 0, canvas.width, canvas.height);
      });
    }

    if (liveBitmapEditRunRef.current !== editRun || draftStrokeRef.current?.tool !== "eraser") {
      return;
    }

    liveBitmapLayerIdRef.current = layer.id;
    setLiveBitmapLayerId(layer.id);

    const currentStroke = draftStrokeRef.current;
    if (currentStroke?.tool === "eraser" && currentStroke.points.length >= 4) {
      drawStrokePathOnCanvas(context, currentStroke);
    }
  };

  const drawLiveBitmapSegment = (stroke: SketchStroke) => {
    if (stroke.tool !== "eraser" || !activeLayer || liveBitmapLayerIdRef.current !== activeLayer.id) {
      return;
    }

    const segment = latestStrokeSegment(stroke);
    const canvas = liveBitmapCanvasRefs.current[activeLayer.id];
    const context = canvas?.getContext("2d");

    if (!segment || !context) {
      return;
    }

    drawStrokePathOnCanvas(context, stroke, segment);
  };

  const clearLiveBitmapEdit = () => {
    liveBitmapEditRunRef.current += 1;
    liveBitmapLayerIdRef.current = undefined;
    setLiveBitmapLayerId(undefined);
  };

  const buildBitmapSelection = (draft: BitmapSelectionDraft): BitmapSelection | undefined => {
    const points =
      draft.mode === "rectangle" && draft.points.length >= 2
        ? [
            draft.points[0],
            { x: draft.points[1].x, y: draft.points[0].y },
            draft.points[1],
            { x: draft.points[0].x, y: draft.points[1].y }
          ]
        : draft.points;
    const bounds = bitmapSelectionBounds(points);

    if (!bounds || bounds.width < 2 || bounds.height < 2) {
      return undefined;
    }

    return { mode: draft.mode, points, bounds };
  };

  const drawSelectionMask = (
    context: CanvasRenderingContext2D,
    selection: BitmapSelection,
    offset: Point = { x: 0, y: 0 }
  ) => {
    context.beginPath();
    selection.points.forEach((point, index) => {
      const x = point.x - offset.x;
      const y = point.y - offset.y;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.closePath();
  };

  const prepareTransformPreview = async (selection: BitmapSelection) => {
    if (!activeLayer) {
      return;
    }

    const prepareRun = transformPrepareRunRef.current + 1;
    transformPrepareRunRef.current = prepareRun;
    setIsTransformPreviewReady(false);

    const previewCanvas = transformPreviewCanvasRef.current;
    const previewContext = previewCanvas?.getContext("2d");
    if (!previewCanvas || !previewContext) {
      return;
    }

    const canvasWidth = Math.max(1, Math.round(activeLayer.width));
    const canvasHeight = Math.max(1, Math.round(activeLayer.height));
    if (previewCanvas.width !== canvasWidth) {
      previewCanvas.width = canvasWidth;
    }
    if (previewCanvas.height !== canvasHeight) {
      previewCanvas.height = canvasHeight;
    }

    const sourceUrl = layerSourceUrl(activeLayer);
    const sourceCanvas = document.createElement("canvas");
    sourceCanvas.width = canvasWidth;
    sourceCanvas.height = canvasHeight;
    const sourceContext = sourceCanvas.getContext("2d");
    if (!sourceContext) {
      return;
    }

    if (sourceUrl) {
      await drawImageUrl(sourceContext, sourceUrl, sourceCanvas.width, sourceCanvas.height).catch(() => {
        sourceContext.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
      });
    }

    const sourcePatch = document.createElement("canvas");
    sourcePatch.width = Math.max(1, Math.round(selection.bounds.width));
    sourcePatch.height = Math.max(1, Math.round(selection.bounds.height));
    const sourcePatchContext = sourcePatch.getContext("2d");
    if (!sourcePatchContext) {
      return;
    }

    sourcePatchContext.save();
    drawSelectionMask(sourcePatchContext, selection, selection.bounds);
    sourcePatchContext.clip();
    sourcePatchContext.drawImage(
      sourceCanvas,
      selection.bounds.x,
      selection.bounds.y,
      selection.bounds.width,
      selection.bounds.height,
      0,
      0,
      sourcePatch.width,
      sourcePatch.height
    );
    sourcePatchContext.restore();

    if (transformPrepareRunRef.current !== prepareRun || !transformDraftRef.current) {
      return;
    }

    preparedTransformRef.current = {
      layerId: activeLayer.id,
      selection,
      sourceCanvas,
      patchCanvas: sourcePatch
    };
    drawPreparedTransformPreview(transformDraftRef.current.currentBounds);
    setIsTransformPreviewReady(true);
  };

  const drawPreparedTransformPreview = (targetBounds: Bounds): string | undefined => {
    const preparedTransform = preparedTransformRef.current;
    const previewCanvas = transformPreviewCanvasRef.current;
    const previewContext = previewCanvas?.getContext("2d");

    if (!preparedTransform || !previewCanvas || !previewContext) {
      return undefined;
    }

    previewContext.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    previewContext.drawImage(preparedTransform.sourceCanvas, 0, 0);
    previewContext.save();
    previewContext.globalCompositeOperation = "destination-out";
    drawSelectionMask(previewContext, preparedTransform.selection);
    previewContext.fill();
    previewContext.restore();
    previewContext.drawImage(
      preparedTransform.patchCanvas,
      targetBounds.x,
      targetBounds.y,
      targetBounds.width,
      targetBounds.height
    );

    return previewCanvas.toDataURL("image/png");
  };

  const commitSelectionTransform = async (targetBounds: Bounds) => {
    const currentSelection = bitmapSelectionRef.current;
    if (!currentSelection || !activeLayer || activeLayer.locked) {
      return;
    }

    if (!preparedTransformRef.current) {
      await prepareTransformPreview(currentSelection);
    }

    const dataUrl = drawPreparedTransformPreview(targetBounds);
    if (!dataUrl) {
      return;
    }

    const writtenDataUrl = await onSelectionTransform(activeLayer.id, dataUrl);
    if (writtenDataUrl) {
      setLayerDataUrls((current) => ({ ...current, [activeLayer.id]: writtenDataUrl }));
    }

    updateBitmapSelectionState({
      ...currentSelection,
      bounds: targetBounds,
      points: [
        { x: targetBounds.x, y: targetBounds.y },
        { x: targetBounds.x + targetBounds.width, y: targetBounds.y },
        { x: targetBounds.x + targetBounds.width, y: targetBounds.y + targetBounds.height },
        { x: targetBounds.x, y: targetBounds.y + targetBounds.height }
      ]
    });
  };

  const getSketchPoint = (event: {
    evt?: globalThis.MouseEvent | globalThis.TouchEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    const stage = event.target.getStage();
    const rect = stage?.container().getBoundingClientRect();

    if (!rect) {
      return undefined;
    }

    const pointerEvent = event.evt;
    const point =
      pointerEvent instanceof TouchEvent
        ? pointerEvent.touches[0] ?? pointerEvent.changedTouches[0]
        : pointerEvent;

    if (!point) {
      return undefined;
    }

    return sketchPointFromClientPoint(point.clientX, point.clientY, rect, canvasSize);
  };

  const beginStroke = (event: {
    evt?: globalThis.MouseEvent | globalThis.TouchEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    blurActiveFormControl();
    onFocusShot();
    event.evt?.preventDefault();
    event.evt?.stopPropagation();
    const position = getSketchPoint(event);

    if (!position) {
      return;
    }

    if (tool === "select") {
      if (!activeLayer || activeLayer.locked) {
        return;
      }
      beginBitmapSelection(position);
      return;
    }

    if (!activeLayer || activeLayer.locked) {
      return;
    }

    updateDrawingState(true);
    const strokeTool: StrokeTool = tool;
    const toolSize = tool === "eraser" ? eraserSize : brushSize;
    const canvasScale = canvasSize.width / sketchCanvasSize.width;
    const nextStroke = {
      id: crypto.randomUUID(),
      tool: strokeTool,
      color: tool === "eraser" ? "#ffffff" : brushColor,
      opacity: tool === "eraser" ? eraserOpacity : brushOpacity,
      size: toolSize * canvasScale,
      points: [position.x, position.y]
    };
    draftStrokeRef.current = nextStroke;
    if (shouldRenderLiveStroke(nextStroke)) {
      setDraftStroke(nextStroke);
    } else if (tool === "eraser" && activeLayer) {
      void prepareLiveBitmapEdit(activeLayer);
    }
  };

  const beginBitmapSelection = (position: Point) => {
    const currentSelection = bitmapSelectionRef.current;
    if (currentSelection) {
      const handleRadius = bitmapSelectionHandleRadiusForStage(canvasSize, stageSize, 12);
      const hit = bitmapSelectionHitTarget(position, currentSelection.bounds, handleRadius);
      if (hit.type === "move") {
        const nextTransform = {
          type: "move",
          startPoint: position,
          startBounds: currentSelection.bounds,
          currentBounds: currentSelection.bounds
        } satisfies BitmapTransformDraft;
        updateTransformDraftState(nextTransform);
        updateDrawingState(true);
        void prepareTransformPreview(currentSelection);
        return;
      }

      if (hit.type === "scale") {
        const nextTransform = {
          type: "scale",
          corner: hit.corner,
          startPoint: position,
          startBounds: currentSelection.bounds,
          currentBounds: currentSelection.bounds
        } satisfies BitmapTransformDraft;
        updateTransformDraftState(nextTransform);
        updateDrawingState(true);
        void prepareTransformPreview(currentSelection);
        return;
      }

      updateBitmapSelectionState(undefined);
    }

    const nextDraft = { mode: selectionMode, points: [position] };
    updateSelectionDraftState(nextDraft);
    updateTransformDraftState(undefined);
    updateDrawingState(true);
  };

  const extendStroke = (event: {
    evt?: globalThis.MouseEvent | globalThis.TouchEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    event.evt?.preventDefault();
    event.evt?.stopPropagation();

    if (!isDrawingRef.current || (tool !== "select" && !draftStrokeRef.current)) {
      return;
    }

    const position = getSketchPoint(event);

    if (!position) {
      return;
    }

    if (tool === "select") {
      extendBitmapSelection(position);
      return;
    }

    const currentStroke = draftStrokeRef.current;
    if (!currentStroke) {
      return;
    }

    const toolSize = currentStroke.tool === "eraser" ? eraserSize : brushSize;
    const canvasScale = canvasSize.width / sketchCanvasSize.width;
    const minPointDistance =
      currentStroke.tool === "eraser" ? Math.max(3, toolSize * canvasScale * 0.25) : 1;
    if (!shouldAppendStrokePoint(currentStroke, position, minPointDistance)) {
      return;
    }

    const nextStroke = {
      ...currentStroke,
      points: [...currentStroke.points, position.x, position.y]
    };
    draftStrokeRef.current = nextStroke;
    if (shouldRenderLiveStroke(nextStroke)) {
      scheduleDraftStrokeRender(nextStroke);
    } else {
      drawLiveBitmapSegment(nextStroke);
    }
  };

  const extendBitmapSelection = (position: Point) => {
    const currentTransform = transformDraftRef.current;
    if (currentTransform) {
      const nextBounds =
        currentTransform.type === "move"
          ? {
              ...currentTransform.startBounds,
              x: currentTransform.startBounds.x + position.x - currentTransform.startPoint.x,
              y: currentTransform.startBounds.y + position.y - currentTransform.startPoint.y
            }
          : scaleBitmapSelectionBounds(
              currentTransform.startBounds,
              currentTransform.corner ?? "se",
              position
            );
      updateTransformDraftState({ ...currentTransform, currentBounds: nextBounds });
      const currentSelection = bitmapSelectionRef.current;
      if (currentSelection && preparedTransformRef.current) {
        drawPreparedTransformPreview(nextBounds);
      }
      return;
    }

    const currentDraft = selectionDraftRef.current;
    if (!currentDraft) {
      return;
    }

    const nextDraft =
      currentDraft.mode === "rectangle"
        ? { ...currentDraft, points: [currentDraft.points[0], position] }
        : { ...currentDraft, points: [...currentDraft.points, position] };
    updateSelectionDraftState(nextDraft);
  };

  const finishStroke = () => {
    if (tool === "select") {
      void finishBitmapSelection();
      updateDrawingState(false);
      return;
    }

    const currentStroke = draftStrokeRef.current;
    if (currentStroke && currentStroke.points.length >= 4) {
      void commitStroke(activeDrawingLayerId, currentStroke);
    } else {
      clearDraftStroke();
    }

    updateDrawingState(false);
  };

  const finishBitmapSelection = async () => {
    const currentTransform = transformDraftRef.current;
    if (currentTransform) {
      await commitSelectionTransform(currentTransform.currentBounds);
      updateTransformDraftState(undefined);
      clearPreparedTransform();
      return;
    }

    const currentDraft = selectionDraftRef.current;
    if (currentDraft) {
      updateBitmapSelectionState(buildBitmapSelection(currentDraft));
      updateSelectionDraftState(undefined);
    }
  };

  return (
    <div
      className="sketch-panel"
      onMouseDown={(event) => {
        onFocusShot();
        event.stopPropagation();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        className="image-stage"
        ref={imageStageRef}
        style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
      >
        {bitmapLayers.length === 0 ? <img src={imageSrc} alt={shot.fileName} draggable={false} /> : null}
        {bitmapLayers
          .filter((layer) => layer.visible)
          .map((layer) => {
            const layerSrc = layerSourceUrl(layer);
            const isLiveBitmapLayer = liveBitmapLayerId === layer.id;
            const isTransformingLayer =
              transformDraft && isTransformPreviewReady && activeLayer?.id === layer.id;
            const layerStyle: CSSProperties = {
              opacity: layer.opacity,
              mixBlendMode: cssBlendMode(layer.blendMode)
            };

            return (
              <Fragment key={layer.id}>
                {layerSrc && !isLiveBitmapLayer && !isTransformingLayer ? (
                  <img src={layerSrc} alt="" draggable={false} style={layerStyle} />
                ) : null}
                <canvas
                  ref={(element) => {
                    liveBitmapCanvasRefs.current[layer.id] = element;
                  }}
                  className="live-bitmap-canvas"
                  style={{
                    ...layerStyle,
                    display: isLiveBitmapLayer ? "block" : "none"
                  }}
                />
              </Fragment>
            );
          })}
        <canvas
          ref={transformPreviewCanvasRef}
          className="selection-transform-canvas"
          style={{ display: transformDraft && isTransformPreviewReady ? "block" : "none" }}
        />
        <BitmapSelectionOverlay
          selection={bitmapSelection}
          draft={selectionDraft}
          transformBounds={transformDraft?.currentBounds}
          stageSize={stageSize}
          canvasSize={canvasSize}
        />
        <OnionSkinOverlay
          previousShot={onionSkinPreviousShot}
          nextShot={onionSkinNextShot}
          stageSize={stageSize}
          folderPath={folderPath}
        />
        <Stage
          className="stage-overlay"
          width={stageSize.width}
          height={stageSize.height}
          onMouseDown={beginStroke}
          onMouseMove={extendStroke}
          onMouseUp={finishStroke}
          onTouchStart={beginStroke}
          onTouchMove={extendStroke}
          onTouchEnd={finishStroke}
        >
          {draftStroke ? (
            <Layer
              scaleX={stageSize.width / canvasSize.width}
              scaleY={stageSize.height / canvasSize.height}
            >
              {[draftStroke].map((stroke) => (
                <Line
                  key={stroke.id}
                  points={stroke.points}
                  stroke={stroke.color}
                  opacity={liveStrokePreviewOpacity(stroke, activeLayer?.opacity)}
                  strokeWidth={stroke.size}
                  tension={0.35}
                  lineCap="round"
                  lineJoin="round"
                  globalCompositeOperation={
                    stroke.tool === "eraser" ? "destination-out" : "source-over"
                  }
                />
              ))}
            </Layer>
          ) : null}
        </Stage>
      </div>
    </div>
  );
};

type OnionSkinOverlayProps = {
  previousShot?: Shot;
  nextShot?: Shot;
  stageSize: CanvasSize;
  folderPath?: string;
};

const OnionSkinOverlay = ({ previousShot, nextShot, stageSize, folderPath }: OnionSkinOverlayProps) => {
  if (!previousShot && !nextShot) {
    return null;
  }

  return (
    <div className="onion-skin-overlay" aria-hidden="true">
      {previousShot ? (
        <OnionSkinGhost shot={previousShot} tone="previous" stageSize={stageSize} folderPath={folderPath} />
      ) : null}
      {nextShot ? (
        <OnionSkinGhost shot={nextShot} tone="next" stageSize={stageSize} folderPath={folderPath} />
      ) : null}
    </div>
  );
};

const OnionSkinGhost = ({
  shot,
  tone,
  stageSize,
  folderPath
}: {
  shot: Shot;
  tone: "previous" | "next";
  stageSize: CanvasSize;
  folderPath?: string;
}) => {
  const imageSrc = window.storyboard.assetUrl(shot.previewPath ?? shot.imagePath);
  const bitmapLayers = useMemo(() => bitmapLayersForShot(shot), [shot]);
  const [layerDataUrls, setLayerDataUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const loadLayers = async () => {
      if (!folderPath) {
        return;
      }

      const entries = await Promise.all(
        bitmapLayers.map(async (layer) => {
          if (layer.cleared) {
            return [layer.id, undefined] as const;
          }

          const dataUrl = await window.storyboard
            .readLayerPng({ folderPath, bitmapPath: layer.bitmapPath })
            .catch(() => undefined);
          return [layer.id, dataUrl] as const;
        })
      );

      if (!cancelled) {
        setLayerDataUrls(
          Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])))
        );
      }
    };

    void loadLayers();

    return () => {
      cancelled = true;
    };
  }, [bitmapLayers, folderPath]);

  return (
    <div className={`onion-skin-ghost onion-skin-ghost-${tone}`}>
      {bitmapLayers.length === 0 ? (
        <img src={imageSrc} alt="" draggable={false} className="onion-skin-image" />
      ) : null}
      {bitmapLayers
        .filter((layer) => layer.visible)
        .map((layer) => {
          const layerSrc =
            layerDataUrls[layer.id] ?? (layer.kind === "image" && !layer.cleared ? imageSrc : undefined);

          return layerSrc ? (
            <img
              key={layer.id}
              src={layerSrc}
              alt=""
              draggable={false}
              className="onion-skin-image"
              style={{
                opacity: layer.opacity,
                mixBlendMode: cssBlendMode(layer.blendMode)
              }}
            />
          ) : null;
        })}
    </div>
  );
};
