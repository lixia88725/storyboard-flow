import {CanvasPresentationContext,PresentationBars} from './canvasPresentation';
import { selectionMatrix, transformSelectionPoints, type SelectionTransformIntent } from './selectionTransform';
import { useMediaSource } from './mediaSource';
import {
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent
} from "react";
import { Circle, Image as KonvaImage, Layer, Line, Stage } from "react-konva";
import { registerMountedCanvasCheckpoint } from "./mountedCanvasRecoveryCapture";
import { WorkspaceCanvasSlotContext } from './workspaceCanvasSlotContext';
import { bitmapLayersForShot, imageBitmapLayerId } from "../contracts/projectOps";
import type {
  BitmapLayer,
  BitmapSelectionMode,
  Shot,
  SketchStroke,
  SketchTool,
  StrokeBrush,
  StrokeTool
} from "../contracts/types";
import {
  bitmapSelectionBounds,
  bitmapSelectionBoundsCorners,
  bitmapSelectionCenter,
  bitmapSelectionHandleRadiusForStage,
  bitmapSelectionHitTarget,
  bitmapSelectionRotationHandlePoint,
  liveStrokePreviewOpacity,
  scaleBitmapSelectionBounds,
  rotatePointAroundCenter,
  rotatedBitmapSelectionBounds,
  rotationRadiansBetweenPoints,
  shouldAppendStrokePoint,
  shouldCloseRadialMenuForSketchPointer,
  shouldClearBitmapSelectionForTool,
  shouldCommitStroke,
  shouldHandleSketchPointer,
  shouldKeepCommittedStrokePreview,
  shouldRenderLiveStroke,
  shouldRestartStrokeForToolChange,
  shouldStartSketchPointer,
  shouldUseRenderedEraserDataUrl,
  sketchCanvasSize,
  sketchPointFromClientPoint,
  sketchPointsFromClientPoints,
  strokeSegmentsFromPointOffset,
  type Bounds,
  type CanvasSize,
  type Point,
  type SelectionCorner
} from "./sketchGeometry";
import {
  brushCursorPreviewDiameter,
  brushCursorPreviewToolSize,
  canvasSizeForShot,
  cssBlendMode,
  drawBitmapLayerImageUrl,
  drawImageUrl,
  drawStrokePathOnCanvas,
  sampleImageDataColorAtPoint,
  sketchCursorForTool,
  shouldShowBrushCursorPreviewForTool
} from "./sketchRendering";
import { nextStageResizeDecision, sameStageSize } from "./stageResize";
import { dabBounds, dabsForStroke } from "./brushStroke";
import { canFillBitmapLayer, editableBitmapLayerForShot } from "./activeTargets";
import { ShotLayerImageStack, bitmapLayerAssetSource } from "../../storyboard/renderer/ShotStaticMedia";

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
  type: "move" | "scale" | "rotate";
  startPoint: Point;
  startBounds: Bounds;
  currentBounds: Bounds;
  corner?: SelectionCorner;
  rotationRadians?: number;
};
type PreparedBitmapTransform = {
  sourcePath: string;
  layerId: string;
  selection: BitmapSelection;
  sourceCanvas: HTMLCanvasElement;
  patchCanvas: HTMLCanvasElement;
};
type PendingCommittedStroke = {
  layerId: string;
  stroke: SketchStroke;
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
  transform,
  stageSize,
  canvasSize
}: {
  selection?: BitmapSelection;
  draft?: BitmapSelectionDraft;
  transform?: BitmapTransformDraft;
  stageSize: CanvasSize;
  canvasSize: CanvasSize;
}) => {
  const scaleX = stageSize.width / canvasSize.width;
  const scaleY = stageSize.height / canvasSize.height;
  const activeBounds = transform?.currentBounds ?? selection?.bounds;
  const draftSelection = draft ? buildOverlaySelection(draft) : undefined;
  const rotationRadians = transform?.type === "rotate" ? transform.rotationRadians ?? 0 : 0;
  const rotationCenter =
    transform?.type === "rotate" ? bitmapSelectionCenter(transform.startBounds) : undefined;
  const points =
    draftSelection?.points ??
    (selection?.points && rotationCenter
      ? selection.points.map((point) =>
          rotatePointAroundCenter(point, rotationCenter, rotationRadians)
        )
      : selection?.points);
  const pathPoints = points?.map((point) => `${point.x * scaleX},${point.y * scaleY}`).join(" ");
  const framePoints =
    transform?.type === "rotate"
      ? rotatedBitmapSelectionBounds(transform.startBounds, rotationRadians).points
      : activeBounds
        ? bitmapSelectionBoundsCorners(activeBounds)
        : undefined;
  const framePathPoints = framePoints
    ?.map((point) => `${point.x * scaleX},${point.y * scaleY}`)
    .join(" ");
  const rotationOffset = scaleY > 0 ? 26 / scaleY : 26;
  const baseRotationBounds = transform?.type === "rotate" ? transform.startBounds : activeBounds;
  const baseRotationHandle = baseRotationBounds
    ? bitmapSelectionRotationHandlePoint(baseRotationBounds, rotationOffset, canvasSize.height)
    : undefined;
  const baseRotationAnchor =
    baseRotationBounds && baseRotationHandle
      ? {
          x: baseRotationBounds.x + baseRotationBounds.width / 2,
          y:
            Math.abs(baseRotationHandle.y - baseRotationBounds.y) <=
            Math.abs(
              baseRotationHandle.y - (baseRotationBounds.y + baseRotationBounds.height)
            )
              ? baseRotationBounds.y
              : baseRotationBounds.y + baseRotationBounds.height
        }
      : undefined;
  const rotationHandle =
    baseRotationHandle && rotationCenter
      ? rotatePointAroundCenter(baseRotationHandle, rotationCenter, rotationRadians)
      : baseRotationHandle;
  const rotationAnchor =
    baseRotationAnchor && rotationCenter
      ? rotatePointAroundCenter(baseRotationAnchor, rotationCenter, rotationRadians)
      : baseRotationAnchor;

  return (
    <svg className="bitmap-selection-overlay" viewBox={`0 0 ${stageSize.width} ${stageSize.height}`}>
      {pathPoints ? <polygon className="bitmap-selection-outline" points={pathPoints} /> : null}
      {framePoints && framePathPoints ? (
        <>
          <polygon className="bitmap-selection-bounds" points={framePathPoints} />
          {framePoints.map(({ x, y }) => (
            <rect
              key={`${x}-${y}`}
              className="bitmap-selection-handle"
              x={x * scaleX - 4}
              y={y * scaleY - 4}
              width={8}
              height={8}
            />
          ))}
          {rotationHandle && rotationAnchor ? (
            <>
              <line
                className="bitmap-selection-rotation-stem"
                x1={rotationAnchor.x * scaleX}
                y1={rotationAnchor.y * scaleY}
                x2={rotationHandle.x * scaleX}
                y2={rotationHandle.y * scaleY}
              />
              <circle
                className="bitmap-selection-rotation-handle"
                cx={rotationHandle.x * scaleX}
                cy={rotationHandle.y * scaleY}
                r={5}
              />
            </>
          ) : null}
        </>
      ) : null}
    </svg>
  );
};

const buildOverlaySelection = (draft: BitmapSelectionDraft): BitmapSelection | undefined => {
  const points = draft.points;
  const bounds = bitmapSelectionBounds(points);
  return bounds ? { mode: draft.mode, points, bounds } : undefined;
};

export type SketchPadProps = {
  respectActiveLayer?: boolean;
  shot: Shot;
  folderPath?: string;
  bitmapRevision: number;
  tool: SketchTool;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  brushSoftness: number;
  eraserOpacity: number;
  eraserSize: number;
  eraserSoftness: number;
  /** Tip and dynamics for the active brush preset; absent keeps the legacy round stroke. */
  brush?: StrokeBrush;
  /** Same for the eraser preset. */
  eraserBrush?: StrokeBrush;
  /** Global pressure switch; when off, every sample is treated as full pressure. */
  pressureEnabled?: boolean;
  /** Right-click on a drawable surface asks the host to open the brush panel. */
  onOpenBrushPanel?: (anchor: { x: number; y: number }) => void;
  onionSkinPreviousShot?: Shot;
  onionSkinNextShot?: Shot;
  onionSkinPreviousRevision?: number;
  onionSkinNextRevision?: number;
  isZoomScrubbing: boolean;
  onStroke: (
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string,
    pendingStrokes?: SketchStroke[]
  ) => Promise<string | undefined>;
  onSelectionTransform: (layerId: string, dataUrl: string, intent?: SelectionTransformIntent) => Promise<string | undefined>;
  onBitmapSelectionChange?: (
    shotId: string,
    layerId: string | undefined,
    points: Point[] | undefined
  ) => void;
  onFill: (layerId: string, point: Point, color: string) => Promise<string | undefined>;
  onPickColor: (color: string) => void;
  onFocusShot: () => void;
  onBeginInteraction?: () => void;
  onInteractionActiveChange?: (active: boolean) => void;
};

/**
 * A preset stroke, drawn by the committing renderer into an offscreen canvas and shown as
 * an image. The canvas is reused per stroke and remounted per redraw: Konva only repaints
 * when the image prop changes identity, so mutating one canvas in place would freeze the
 * preview at its first frame.
 */
const BrushStrokeImage = ({ stroke, width, height, layerOpacity }: {
  stroke: SketchStroke; width: number; height: number; layerOpacity?: number;
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    // paintBrushStroke already composites at the stroke's own opacity, so the canvas carries
    // it; the node must not multiply it again. The eraser only needs a mask here: erasing
    // happens against the real layers when the node composites with destination-out.
    drawStrokePathOnCanvas(context, stroke.tool === "eraser" ? { ...stroke, tool: "brush", color: "#000000" } : stroke);
    setVersion(current => current + 1);
  }, [stroke, width, height]);
  if (!canvasRef.current) return null;
  return <KonvaImage key={version} image={canvasRef.current} listening={false} perfectDrawEnabled={false}
    opacity={layerOpacity ?? 1}
    globalCompositeOperation={stroke.tool === "eraser" ? "destination-out" : "source-over"} />;
};

export const SketchPad = memo(({
  respectActiveLayer = false,
  shot,
  folderPath,
  bitmapRevision,
  tool,
  brushColor,
  brushOpacity,
  brushSize,
  brushSoftness,
  eraserOpacity,
  eraserSize,
  eraserSoftness,
  brush,
  eraserBrush,
  pressureEnabled = true,
  onOpenBrushPanel,
  onionSkinPreviousShot,
  onionSkinNextShot,
  onionSkinPreviousRevision = 0,
  onionSkinNextRevision = 0,
  isZoomScrubbing,
  onStroke,
  onSelectionTransform,
  onBitmapSelectionChange,
  onFill,
  onPickColor,
  onFocusShot,
  onBeginInteraction,
  onInteractionActiveChange
}: SketchPadProps) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [draftStroke, setDraftStroke] = useState<SketchStroke | undefined>();

  const [pendingCommittedStrokes, setPendingCommittedStrokes] = useState<PendingCommittedStroke[]>([]);
  const [stageSize, setStageSize] = useState(sketchCanvasSize);
  const imageStageRef = useRef<HTMLDivElement | null>(null);
  const stageSizeRef = useRef(sketchCanvasSize);
  const pendingStageSizeRef = useRef<CanvasSize | undefined>(undefined);
  const stageSizeFrameRef = useRef<number | undefined>(undefined);
  const isDrawingRef = useRef(false);
  const draftStrokeRef = useRef<SketchStroke | undefined>(undefined);
  const draftStrokeRenderFrameRef = useRef<number | undefined>(undefined);
  const pendingDraftStrokeRef = useRef<SketchStroke | undefined>(undefined);
  const stageRectRef = useRef<DOMRect | undefined>(undefined);
  const brushCursorPreviewRef = useRef<HTMLDivElement | null>(null);
  const brushCursorFrameRef = useRef<number | undefined>(undefined);
  const pendingBrushCursorPointRef = useRef<Point | undefined>(undefined);
  const pendingCommittedStrokesRef = useRef<PendingCommittedStroke[]>([]);
  const liveBitmapCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  // Pixels of the layer at the start of an eraser stroke. Restoring from them lets the
  // live view re-render the whole stroke each frame, so what is shown is exactly the
  // capped result that will be committed instead of an accumulating approximation.
  const liveBitmapBaseRef = useRef<{ layerId: string; pixels: ImageData } | undefined>(undefined);
  // Which layer asset the live canvas currently reflects. A second stroke that starts
  // before the first one's PNG echoes back must not reload the canvas from the stale
  // asset: that would drop the pending stroke for a frame or two.
  const liveCanvasAssetRef = useRef<{ layerId: string; assetId: string } | undefined>(undefined);
  const liveBitmapLayerIdRef = useRef<string | undefined>(undefined);
  const liveBitmapEditRunRef = useRef(0);
  const liveBitmapEditCanCommitRenderedDataUrlRef = useRef(false);
  const committingStrokeIdsRef = useRef<Set<string>>(new Set());
  const activePointerIdRef = useRef<number | undefined>(undefined);
  const transformPreviewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapSelectionRef = useRef<BitmapSelection | undefined>(undefined);
  const selectionDraftRef = useRef<BitmapSelectionDraft | undefined>(undefined);
  const transformDraftRef = useRef<BitmapTransformDraft | undefined>(undefined);
  const preparedTransformRef = useRef<PreparedBitmapTransform | undefined>(undefined);
  const transformPrepareRunRef = useRef(0);
  const canvasSlot = useContext(WorkspaceCanvasSlotContext);
  const heldCheckpoint = canvasSlot?.checkpoints?.find(c => c.shotId === shot.id);
  useLayoutEffect(() => registerMountedCanvasCheckpoint(() => ({
    folderPath, shotId: shot.id, pointerId: activePointerIdRef.current,
    draft: draftStrokeRef.current ?? null, selection: selectionDraftRef.current ?? bitmapSelectionRef.current ?? null,
    transform: transformDraftRef.current ?? null, pendingCommitted: pendingCommittedStrokesRef.current,
    liveLayers: Object.entries(liveBitmapCanvasRefs.current).flatMap(([layerId, canvas]) =>
      canvas && liveBitmapLayerIdRef.current === layerId ? [{ layerId, dataUrl: canvas.toDataURL("image/png") }] : []),
    transformPixels: transformPreviewCanvasRef.current?.toDataURL("image/png"),
    hasUnsettledGesture: isDrawingRef.current || !!draftStrokeRef.current || !!pendingDraftStrokeRef.current ||
      !!selectionDraftRef.current || !!transformDraftRef.current || committingStrokeIdsRef.current.size > 0 ||
      pendingCommittedStrokesRef.current.length > 0
  }), canvasSlot?.incarnation), [folderPath, shot.id, canvasSlot?.incarnation]);
  const media = useMediaSource();
  const imageSrc = media.assetUrl(shot.previewPath ?? shot.imagePath);
  const canvasSize = useMemo(() => canvasSizeForShot(shot), [shot]);
  const bitmapLayers = useMemo(() => bitmapLayersForShot(shot), [shot]);
  const activeLayer = useMemo(
    () =>
      bitmapLayers.find((layer) => layer.id === shot.activeLayerId && layer.visible) ??
      (respectActiveLayer ? undefined : [...bitmapLayers].reverse().find((layer) => layer.visible)),
    [bitmapLayers, shot.activeLayerId, respectActiveLayer]
  );
  const editableLayer = useMemo(() => editableBitmapLayerForShot(shot), [shot]);
  const activeDrawingLayer = respectActiveLayer
    ? activeLayer && !activeLayer.locked ? activeLayer : undefined
    : tool === "select" ? activeLayer : editableLayer;
  const activeDrawingLayerId = activeDrawingLayer?.id ?? imageBitmapLayerId;
  const [layerDataUrls, setLayerDataUrls] = useState<Record<string, string>>({});
  const [liveBitmapLayerId, setLiveBitmapLayerId] = useState<string | undefined>();
  const [bitmapSelection, setBitmapSelection] = useState<BitmapSelection | undefined>();
  const [selectionDraft, setSelectionDraft] = useState<BitmapSelectionDraft | undefined>();
  const [transformDraft, setTransformDraft] = useState<BitmapTransformDraft | undefined>();
  const [isTransformPreviewReady, setIsTransformPreviewReady] = useState(false);
  const sketchCursor = sketchCursorForTool(tool);
  const isBrushCursorPreviewTool = shouldShowBrushCursorPreviewForTool(tool);
  const cursorPreviewToolSize = brushCursorPreviewToolSize(tool, { brushSize, eraserSize });
  const cursorPreviewDiameter = brushCursorPreviewDiameter({
    toolSize: cursorPreviewToolSize ?? brushSize,
    stageSize
  });

  const setStageSizeSynced = useCallback((size: CanvasSize) => {
    if (sameStageSize(stageSizeRef.current, size)) {
      return;
    }

    stageSizeRef.current = size;
    setStageSize(size);
  }, []);

  const refreshStageRect = () => {
    const rect = imageStageRef.current?.getBoundingClientRect();
    if (rect) {
      stageRectRef.current = rect;
    }
    return rect;
  };

  useEffect(
    () => () => {
      if (draftStrokeRenderFrameRef.current !== undefined) {
        window.cancelAnimationFrame(draftStrokeRenderFrameRef.current);
      }
      if (brushCursorFrameRef.current !== undefined) {
        window.cancelAnimationFrame(brushCursorFrameRef.current);
      }
      onInteractionActiveChange?.(false);
    },
    [onInteractionActiveChange]
  );

  useEffect(() => {
    clearBitmapSelectionState();
  }, [activeDrawingLayerId, shot.id]);

  useEffect(() => {
    if (shouldClearBitmapSelectionForTool(tool)) {
      clearBitmapSelectionState();
    }

    if (!isBrushCursorPreviewTool) {
      hideBrushCursorPreview();
    }
  }, [tool]);

  useEffect(
    () => () => {
      onBitmapSelectionChange?.(shot.id, undefined, undefined);
    },
    [onBitmapSelectionChange, shot.id]
  );

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
    setLayerDataUrls({});
  }, [bitmapRevision, shot.id]);

  useEffect(() => {
    const element = imageStageRef.current;
    if (!element) {
      return;
    }

    const updateStageSize = () => {
      if (stageSizeFrameRef.current !== undefined) {
        return;
      }

      stageSizeFrameRef.current = window.requestAnimationFrame(() => {
        stageSizeFrameRef.current = undefined;
        const rect = element.getBoundingClientRect();
        stageRectRef.current = rect;
        const decision = nextStageResizeDecision({
          currentSize: stageSizeRef.current,
          measuredSize: { width: rect.width, height: rect.height },
          shouldDefer: isZoomScrubbing
        });

        if (decision.type === "apply") {
          pendingStageSizeRef.current = undefined;
          setStageSizeSynced(decision.size);
        } else if (decision.type === "defer") {
          pendingStageSizeRef.current = decision.size;
        }
      });
    };

    updateStageSize();
    const resizeObserver = new ResizeObserver(updateStageSize);
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
      if (stageSizeFrameRef.current !== undefined) {
        window.cancelAnimationFrame(stageSizeFrameRef.current);
        stageSizeFrameRef.current = undefined;
      }
    };
  }, [isZoomScrubbing, setStageSizeSynced]);

  useEffect(() => {
    if (isZoomScrubbing) {
      return;
    }

    const pendingSize = pendingStageSizeRef.current;
    if (!pendingSize) {
      return;
    }

    pendingStageSizeRef.current = undefined;
    setStageSizeSynced(pendingSize);
  }, [isZoomScrubbing, setStageSizeSynced]);

  useEffect(() => {
    if (!isDrawing) {
      return;
    }

    const finishGlobalStroke = (event: globalThis.PointerEvent) => {
      if (!shouldHandleSketchPointer(event, activePointerIdRef.current)) {
        return;
      }

      if (tool === "select") {
        void finishBitmapSelection();
        updateDrawingState(false);
        activePointerIdRef.current = undefined;
        return;
      }

      const currentStroke = draftStrokeRef.current;
      if (currentStroke && shouldCommitStroke(currentStroke)) {
        void commitStroke(activeDrawingLayerId, currentStroke);
      } else {
        clearDraftStroke();
      }

      updateDrawingState(false);
      activePointerIdRef.current = undefined;
    };

    window.addEventListener("pointerup", finishGlobalStroke, { once: true });
    window.addEventListener("pointercancel", finishGlobalStroke, { once: true });
    window.addEventListener("pointermove", extendGlobalStroke);

    return () => {
      window.removeEventListener("pointerup", finishGlobalStroke);
      window.removeEventListener("pointercancel", finishGlobalStroke);
      window.removeEventListener("pointermove", extendGlobalStroke);
    };
  }, [activeDrawingLayerId, isDrawing, onStroke, tool, selectionDraft, transformDraft, bitmapSelection]);

  const commitStroke = async (layerId: string, stroke: SketchStroke) => {
    if (committingStrokeIdsRef.current.has(stroke.id)) {
      return;
    }

    committingStrokeIdsRef.current.add(stroke.id);
    if (shouldKeepCommittedStrokePreview(stroke)) {
      if (!pendingCommittedStrokesRef.current.some((item) => item.stroke.id === stroke.id)) {
        pendingCommittedStrokesRef.current = [...pendingCommittedStrokesRef.current, { layerId, stroke }];
        setPendingCommittedStrokes(pendingCommittedStrokesRef.current);
      }
      if (draftStrokeRef.current?.id === stroke.id) {
        clearDraftStroke();
      }
    }
    try {
      const renderedDataUrl =
        (stroke.tool === "eraser" || stroke.brush) &&
        liveBitmapLayerIdRef.current === layerId &&
        liveBitmapEditCanCommitRenderedDataUrlRef.current
          ? liveBitmapCanvasRefs.current[layerId]?.toDataURL("image/png")
          : undefined;
      const pendingStrokesForLayer =
        stroke.tool === "brush"
          ? pendingCommittedStrokesRef.current
              .filter((item) => item.layerId === layerId && item.stroke.id !== stroke.id)
              .map((item) => item.stroke)
          : [];
      const dataUrl = await onStroke(layerId, stroke, renderedDataUrl, pendingStrokesForLayer);
      if (dataUrl) {
        setLayerDataUrls((current) => ({ ...current, [layerId]: dataUrl }));
      }
    } finally {
      if (draftStrokeRef.current?.id === stroke.id) {
        clearDraftStroke();
      }
      clearLiveBitmapEdit();
      committingStrokeIdsRef.current.delete(stroke.id);
      pendingCommittedStrokesRef.current = pendingCommittedStrokesRef.current.filter(
        (item) => item.stroke.id !== stroke.id
      );
      setPendingCommittedStrokes(pendingCommittedStrokesRef.current);
    }
  };

  const scheduleDraftStrokeRender = (stroke: SketchStroke) => {
    pendingDraftStrokeRef.current = stroke;
    if (draftStrokeRenderFrameRef.current !== undefined) {
      return;
    }

    draftStrokeRenderFrameRef.current = window.requestAnimationFrame(() => {
      draftStrokeRenderFrameRef.current = undefined;
      const pendingStroke = pendingDraftStrokeRef.current;
      setDraftStroke(
        pendingStroke
          ? { ...pendingStroke, points: [...pendingStroke.points] }
          : undefined
      );
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
    if (isDrawingRef.current === drawing) {
      return;
    }
    isDrawingRef.current = drawing;
    setIsDrawing(drawing);
    onInteractionActiveChange?.(drawing);
  };

  const updateBitmapSelectionState = (selection: BitmapSelection | undefined) => {
    bitmapSelectionRef.current = selection;
    setBitmapSelection(selection);
    onBitmapSelectionChange?.(shot.id, activeLayer?.id, selection?.points);
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
    canvasSlot?.readonly ? (heldCheckpoint?.liveLayers.find(v => v.layerId === layer.id)?.dataUrl ??
      canvasSlot.pins?.find(v => v.role === `desired/${shot.id}/${layer.id}`)?.dataUrl ??
      canvasSlot.pins?.find(v => v.role === `original/${shot.id}/${layer.id}`)?.dataUrl) : layerDataUrls[layer.id] ??
    (!layer.cleared
      ? bitmapLayerAssetSource({ folderPath, layer, revision: bitmapRevision, media })
      : undefined) ??
    (layer.kind === "image" && !layer.cleared ? imageSrc : undefined);

  const pickVisibleColor = async (position: Point) => {
    const canvas = document.createElement("canvas");
    canvas.width = canvasSize.width;
    canvas.height = canvasSize.height;
    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    try {
      if (bitmapLayers.length === 0) {
        await drawImageUrl(context, imageSrc, canvas.width, canvas.height);
      } else {
        for (const layer of bitmapLayers.filter((item) => item.visible)) {
          const sourceUrl = layerSourceUrl(layer);
          if (!sourceUrl) {
            continue;
          }
          await drawBitmapLayerImageUrl(context, layer, sourceUrl, canvas.width, canvas.height).catch(
            () => undefined
          );
        }
      }

      const color = sampleImageDataColorAtPoint(
        context.getImageData(0, 0, canvas.width, canvas.height),
        position
      );
      if (color) {
        onPickColor(color);
      }
    } catch {
      return;
    }
  };

  const prepareLiveBitmapEdit = async (layer: BitmapLayer) => {
    const editRun = liveBitmapEditRunRef.current + 1;
    liveBitmapEditRunRef.current = editRun;
    liveBitmapEditCanCommitRenderedDataUrlRef.current = false;
    const canvas = liveBitmapCanvasRefs.current[layer.id];
    const context = canvas?.getContext("2d");

    if (!canvas || !context) {
      return;
    }

    const cached = liveCanvasAssetRef.current;
    const reusable =
      cached?.layerId === layer.id &&
      cached.assetId === layer.bitmapPath &&
      canvas.width === Math.max(1, Math.round(layer.width)) &&
      canvas.height === Math.max(1, Math.round(layer.height));

    if (!reusable) {
      canvas.width = Math.max(1, Math.round(layer.width));
      canvas.height = Math.max(1, Math.round(layer.height));
      context.clearRect(0, 0, canvas.width, canvas.height);

      const sourceUrl = layerSourceUrl(layer);
      if (sourceUrl) {
        await drawImageUrl(context, sourceUrl, canvas.width, canvas.height).catch(() => {
          context.clearRect(0, 0, canvas.width, canvas.height);
        });
      }
    }
    liveCanvasAssetRef.current = { layerId: layer.id, assetId: layer.bitmapPath };

    if (liveBitmapEditRunRef.current !== editRun || !draftStrokeRef.current) {
      return;
    }

    liveBitmapLayerIdRef.current = layer.id;
    liveBitmapBaseRef.current = { layerId: layer.id, pixels: context.getImageData(0, 0, canvas.width, canvas.height) };
    liveBitmapEditCanCommitRenderedDataUrlRef.current = shouldUseRenderedEraserDataUrl({
      layerId: layer.id,
      pendingCommittedStrokes: pendingCommittedStrokesRef.current
    });
    setLiveBitmapLayerId(layer.id);

    const currentStroke = draftStrokeRef.current;
    if (currentStroke && shouldCommitStroke(currentStroke)) {
      drawStrokePathOnCanvas(context, currentStroke);
    }
  };

  const drawLiveBitmapSegments = (stroke: SketchStroke, previousPointOffset: number) => {
    if (
      (stroke.tool !== "eraser" && !stroke.brush) ||
      !activeDrawingLayer ||
      liveBitmapLayerIdRef.current !== activeDrawingLayer.id
    ) {
      return;
    }

    const segments = strokeSegmentsFromPointOffset(stroke, previousPointOffset);
    const canvas = liveBitmapCanvasRefs.current[activeDrawingLayer.id];
    const context = canvas?.getContext("2d");

    if (segments.length === 0 || !context || !canvas) {
      return;
    }

    // A preset eraser re-renders the whole stroke over the pixels captured at stroke
    // start: segment-by-segment erasing would accumulate past the stroke opacity, and
    // the committed raster (one composite) would then look lighter than the preview.
    const base = liveBitmapBaseRef.current;
    if (stroke.brush && base?.layerId === activeDrawingLayer.id) {
      const bounds = dabBounds(dabsForStroke({
        tool: stroke.tool,
        color: stroke.color,
        size: stroke.size,
        opacity: stroke.opacity ?? 1,
        points: stroke.points,
        pressures: stroke.pressures,
        brush: stroke.brush,
      }), canvas.width, canvas.height);
      if (!bounds) {
        return;
      }
      context.putImageData(base.pixels, 0, 0, bounds.x, bounds.y, bounds.width, bounds.height);
      drawStrokePathOnCanvas(context, stroke);
      return;
    }

    for (const segment of segments) {
      drawStrokePathOnCanvas(context, stroke, segment);
    }
  };

  const clearLiveBitmapEdit = () => {
    liveBitmapEditRunRef.current += 1;
    liveBitmapLayerIdRef.current = undefined;
    liveBitmapBaseRef.current = undefined;
    liveBitmapEditCanCommitRenderedDataUrlRef.current = false;
    setLiveBitmapLayerId(undefined);
  };

  const buildBitmapSelection = (draft: BitmapSelectionDraft): BitmapSelection | undefined => {
    const points = draft.points;
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
      sourcePath: activeLayer.bitmapPath,
      selection,
      sourceCanvas,
      patchCanvas: sourcePatch
    };
    const currentTransform = transformDraftRef.current;
    drawPreparedTransformPreview(
      currentTransform.currentBounds,
      currentTransform.rotationRadians ?? 0
    );
    setIsTransformPreviewReady(true);
  };

  const drawPreparedTransformPreview = (
    targetBounds: Bounds,
    rotationRadians = 0,
    encode = false
  ): string | undefined => {
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
    if (rotationRadians !== 0) {
      const center = bitmapSelectionCenter(preparedTransform.selection.bounds);
      previewContext.save();
      previewContext.translate(center.x, center.y);
      previewContext.rotate(rotationRadians);
      previewContext.drawImage(
        preparedTransform.patchCanvas,
        -preparedTransform.selection.bounds.width / 2,
        -preparedTransform.selection.bounds.height / 2,
        preparedTransform.selection.bounds.width,
        preparedTransform.selection.bounds.height
      );
      previewContext.restore();
    } else {
      previewContext.drawImage(
        preparedTransform.patchCanvas,
        targetBounds.x,
        targetBounds.y,
        targetBounds.width,
        targetBounds.height
      );
    }

    return encode ? previewCanvas.toDataURL("image/png") : undefined;
  };

  const commitSelectionTransform = async (transform: BitmapTransformDraft) => {
    const currentSelection = bitmapSelectionRef.current;
    if (!currentSelection || !activeLayer || activeLayer.locked || transformDraftRef.current !== transform) {
      return;
    }

    if (!preparedTransformRef.current) {
      await prepareTransformPreview(currentSelection);
    }
    if (transformDraftRef.current !== transform || bitmapSelectionRef.current !== currentSelection) return;

    const dataUrl = drawPreparedTransformPreview(
      transform.currentBounds,
      transform.rotationRadians ?? 0,
      true
    );
    if (!dataUrl) {
      return;
    }

    const prepared = preparedTransformRef.current;
    if (!prepared || prepared.layerId !== activeLayer.id) return;
    const matrix = selectionMatrix(prepared.selection.bounds, transform.currentBounds, transform.rotationRadians ?? 0);
    const preparedRun = transformPrepareRunRef.current;
    const writtenDataUrl = await onSelectionTransform(activeLayer.id, dataUrl, {
      sourcePath: prepared.sourcePath, selection: prepared.selection.points.map(p=>({...p})), matrix
    });
    // Absence includes completed original writes whose UI generation revoked.
    // Do not continue publishing an old selection after that control-flow exit.
    if (!writtenDataUrl || preparedRun !== transformPrepareRunRef.current || transformDraftRef.current !== transform) return;
    setLayerDataUrls((current) => ({ ...current, [activeLayer.id]: writtenDataUrl }));

    const points = transformSelectionPoints(currentSelection.points, matrix);
    updateBitmapSelectionState({ ...currentSelection, points, bounds: bitmapSelectionBounds(points) ?? transform.currentBounds });
  };

  const getSketchPoints = (event: {
    evt?: globalThis.PointerEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    const rect = stageRectRef.current ?? refreshStageRect();

    if (!rect) {
      return [];
    }

    const pointerEvent = event.evt;
    if (!pointerEvent) {
      return [];
    }

    const coalescedEvents =
      typeof pointerEvent.getCoalescedEvents === "function"
        ? pointerEvent.getCoalescedEvents()
        : [];
    const points = coalescedEvents.length > 0 ? [...coalescedEvents, pointerEvent] : [pointerEvent];
    return sketchPointsFromClientPoints(points, rect, canvasSize);
  };

  const getSketchPointsFromPointerEvent = (pointerEvent: globalThis.PointerEvent) => {
    const rect = stageRectRef.current ?? refreshStageRect();

    if (!rect) {
      return [];
    }

    const coalescedEvents =
      typeof pointerEvent.getCoalescedEvents === "function"
        ? pointerEvent.getCoalescedEvents()
        : [];
    const points = coalescedEvents.length > 0 ? [...coalescedEvents, pointerEvent] : [pointerEvent];
    return sketchPointsFromClientPoints(points, rect, canvasSize);
  };

  /**
   * Pen pressure for one sample. Mouse and touch report a constant 0.5 (or 0) and must
   * behave exactly like a full-pressure tap, so they resolve to 1 instead of half ink.
   */
  const pressureOf = (pointerEvent: globalThis.PointerEvent): number => {
    if (!pressureEnabled || pointerEvent.pointerType !== "pen") {
      return 1;
    }
    const value = pointerEvent.pressure;
    if (!Number.isFinite(value) || value <= 0) {
      return 1;
    }
    return Math.min(1, Math.max(0.02, value));
  };

  /** Points and their pressures from the same coalesced samples, so indexes always align. */
  const sketchSamples = (pointerEvent: globalThis.PointerEvent) => {
    const rect = stageRectRef.current ?? refreshStageRect();
    if (!rect) {
      return { points: [] as Point[], pressures: [] as number[] };
    }
    const coalescedEvents =
      typeof pointerEvent.getCoalescedEvents === "function"
        ? pointerEvent.getCoalescedEvents()
        : [];
    const samples = coalescedEvents.length > 0 ? [...coalescedEvents, pointerEvent] : [pointerEvent];
    return {
      points: sketchPointsFromClientPoints(samples, rect, canvasSize),
      pressures: samples.map(pressureOf)
    };
  };

  const updateBrushCursorPreview = (pointerEvent: globalThis.PointerEvent) => {
    if (!isBrushCursorPreviewTool) {
      return;
    }

    const rect = stageRectRef.current ?? refreshStageRect();
    if (!rect) {
      return;
    }

    pendingBrushCursorPointRef.current = {
      x: pointerEvent.clientX - rect.left,
      y: pointerEvent.clientY - rect.top
    };
    if (brushCursorFrameRef.current !== undefined) {
      return;
    }

    brushCursorFrameRef.current = window.requestAnimationFrame(() => {
      brushCursorFrameRef.current = undefined;
      const point = pendingBrushCursorPointRef.current;
      const cursor = brushCursorPreviewRef.current;
      if (!point || !cursor) {
        return;
      }
      cursor.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%)`;
      cursor.style.opacity = "1";
    });
  };

  const hideBrushCursorPreview = () => {
    pendingBrushCursorPointRef.current = undefined;
    if (brushCursorFrameRef.current !== undefined) {
      window.cancelAnimationFrame(brushCursorFrameRef.current);
      brushCursorFrameRef.current = undefined;
    }
    if (brushCursorPreviewRef.current) {
      brushCursorPreviewRef.current.style.opacity = "0";
    }
  };

  const createStroke = (strokeTool: StrokeTool, position: Point, pressure = 1): SketchStroke => {
    const toolSize = strokeTool === "eraser" ? eraserSize : brushSize;
    const canvasScale = canvasSize.width / sketchCanvasSize.width;
    const preset = strokeTool === "eraser" ? eraserBrush : brush;
    // Fresh seed per stroke: grain differs between strokes, but the whole stroke — and
    // therefore its preview and its committed pixels — uses one seed.
    const seed = (Math.random() * 0xffffffff) >>> 0;
    return {
      id: crypto.randomUUID(),
      tool: strokeTool,
      color: strokeTool === "eraser" ? "#ffffff" : brushColor,
      opacity: strokeTool === "eraser" ? eraserOpacity : brushOpacity,
      size: toolSize * canvasScale,
      softness: strokeTool === "eraser" ? eraserSoftness : brushSoftness,
      points: [position.x, position.y],
      ...(preset ? { brush: { ...preset, seed }, pressures: [pressure] } : {})
    };
  };

  const beginStroke = (event: {
    evt?: globalThis.PointerEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    blurActiveFormControl();
    onFocusShot();
    event.evt?.preventDefault();
    event.evt?.stopPropagation();
    refreshStageRect();
    if (event.evt) {
      updateBrushCursorPreview(event.evt);
    }
    const stage = event.target.getStage();
    const pointerEvent = event.evt;
    if (!pointerEvent || !shouldStartSketchPointer(pointerEvent)) {
      return;
    }

    activePointerIdRef.current = pointerEvent.pointerId;
    if (stage && pointerEvent && pointerEvent.pointerId !== undefined) {
      try {
        stage.container().setPointerCapture?.(pointerEvent.pointerId);
      } catch {
        // Some embedded WebViews can reject capture during synthetic pointer transitions.
      }
    }
    const samples = event.evt ? sketchSamples(event.evt) : { points: [], pressures: [] };
    const position = samples.points[0];
    const startPressure = samples.pressures[0] ?? 1;

    if (!position) {
      return;
    }

    if (shouldCloseRadialMenuForSketchPointer(pointerEvent)) {
      onBeginInteraction?.();
    }

    if (tool === "eyedropper") {
      void pickVisibleColor(position);
      return;
    }

    if (tool === "select") {
      if (!activeLayer || activeLayer.locked) {
        return;
      }
      beginBitmapSelection(position);
      return;
    }

    if (tool === "blur") {
      return;
    }

    if (!activeDrawingLayer) {
      return;
    }

    updateDrawingState(true);
    const strokeTool: StrokeTool = tool;
    const nextStroke = createStroke(strokeTool, position, startPressure);
    draftStrokeRef.current = nextStroke;
    if (shouldRenderLiveStroke(nextStroke)) {
      setDraftStroke(nextStroke);
    } else {
      // Everything that is not drawn on the overlay — the eraser and preset brushes —
      // previews inside the layer's own pixels.
      void prepareLiveBitmapEdit(activeDrawingLayer);
    }
  };

  const beginBitmapSelection = (position: Point) => {
    const currentSelection = bitmapSelectionRef.current;
    if (currentSelection) {
      const handleRadius = bitmapSelectionHandleRadiusForStage(canvasSize, stageSize, 12);
      const rotationHandleOffset = bitmapSelectionHandleRadiusForStage(
        canvasSize,
        stageSize,
        26
      );
      const hit = bitmapSelectionHitTarget(
        position,
        currentSelection.bounds,
        handleRadius,
        rotationHandleOffset,
        canvasSize.height
      );
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

      if (hit.type === "rotate") {
        const nextTransform = {
          type: "rotate",
          startPoint: position,
          startBounds: currentSelection.bounds,
          currentBounds: currentSelection.bounds,
          rotationRadians: 0
        } satisfies BitmapTransformDraft;
        updateTransformDraftState(nextTransform);
        updateDrawingState(true);
        void prepareTransformPreview(currentSelection);
        return;
      }

      updateBitmapSelectionState(undefined);
    }

    const nextDraft = { mode: "lasso" as const, points: [position] };
    updateSelectionDraftState(nextDraft);
    updateTransformDraftState(undefined);
    updateDrawingState(true);
  };

  const extendStroke = (event: {
    evt?: globalThis.PointerEvent;
    target: { getStage: () => { container: () => HTMLDivElement } | null };
  }) => {
    event.evt?.preventDefault();
    event.evt?.stopPropagation();
    if (event.evt) {
      updateBrushCursorPreview(event.evt);
    }

    if (event.evt && !shouldHandleSketchPointer(event.evt, activePointerIdRef.current)) {
      return;
    }

    if (!isDrawingRef.current || (tool !== "select" && !draftStrokeRef.current)) {
      return;
    }

    const samples = event.evt ? sketchSamples(event.evt) : { points: [], pressures: [] };
    const positions = samples.points;

    if (positions.length === 0) {
      return;
    }

    if (tool === "select") {
      extendBitmapSelection(positions[positions.length - 1]);
      return;
    }

    extendBitmapStroke(positions, samples.pressures);
  };

  const extendGlobalStroke = (event: globalThis.PointerEvent) => {
    if (!shouldHandleSketchPointer(event, activePointerIdRef.current)) {
      return;
    }

    // Konva binds its pointer listeners to the inner .konvajs-content node, while the
    // stroke captures the pointer on its parent container. A captured pointer is
    // retargeted to that container, so Konva's own pointermove never runs mid-stroke;
    // this window listener is the only live path. Follow the pen here as well, or the
    // brush outline stays frozen at the pen-down point until release.
    updateBrushCursorPreview(event);

    if (!isDrawingRef.current || (tool !== "select" && !draftStrokeRef.current)) {
      return;
    }

    const samples = sketchSamples(event);
    const positions = samples.points;

    if (positions.length === 0) {
      return;
    }

    if (tool === "select") {
      extendBitmapSelection(positions[positions.length - 1]);
      return;
    }

    extendBitmapStroke(positions, samples.pressures);
  };

  const extendBitmapStroke = (positions: Point[], pressures: number[] = []) => {
    if (positions.length === 0) {
      return;
    }

    let currentStroke = draftStrokeRef.current;
    if (!currentStroke) {
      return;
    }

    if (shouldRestartStrokeForToolChange(currentStroke, tool)) {
      if (shouldCommitStroke(currentStroke)) {
        void commitStroke(activeDrawingLayerId, currentStroke);
      } else {
        clearDraftStroke();
      }

      if (!activeDrawingLayer || (tool !== "brush" && tool !== "eraser")) {
        return;
      }

      const nextStroke = createStroke(tool, positions[0], pressures[0] ?? 1);
      draftStrokeRef.current = nextStroke;
      currentStroke = nextStroke;
      if (shouldRenderLiveStroke(nextStroke)) {
        setDraftStroke(nextStroke);
      } else {
        void prepareLiveBitmapEdit(activeDrawingLayer);
      }
    }

    const previousPointOffset = currentStroke.points.length / 2;
    const previousPointLength = currentStroke.points.length;
    const toolSize = currentStroke.tool === "eraser" ? eraserSize : brushSize;
    const canvasScale = canvasSize.width / sketchCanvasSize.width;
    const minPointDistance =
      currentStroke.tool === "eraser" ? Math.max(3, toolSize * canvasScale * 0.25) : 1;
    const nextPoints = currentStroke.points;
    const nextPressures = currentStroke.pressures ?? [];
    currentStroke.pressures = nextPressures;
    for (let index = 0; index < positions.length; index++) {
      const position = positions[index];
      if (!shouldAppendStrokePoint(currentStroke, position, minPointDistance)) {
        continue;
      }

      nextPoints.push(position.x, position.y);
      nextPressures.push(pressures[index] ?? 1);
    }

    if (nextPoints.length === previousPointLength) {
      return;
    }

    const nextStroke = {
      ...currentStroke,
      points: nextPoints
    };
    draftStrokeRef.current = nextStroke;
    if (shouldRenderLiveStroke(nextStroke)) {
      scheduleDraftStrokeRender(nextStroke);
    } else {
      drawLiveBitmapSegments(nextStroke, previousPointOffset);
    }
  };

  const extendBitmapSelection = (position: Point) => {
    const currentTransform = transformDraftRef.current;
    if (currentTransform) {
      if (currentTransform.type === "rotate") {
        const rotationRadians = rotationRadiansBetweenPoints(
          bitmapSelectionCenter(currentTransform.startBounds),
          currentTransform.startPoint,
          position
        );
        const nextBounds = rotatedBitmapSelectionBounds(
          currentTransform.startBounds,
          rotationRadians
        ).bounds;
        const nextTransform = {
          ...currentTransform,
          currentBounds: nextBounds,
          rotationRadians
        };
        updateTransformDraftState(nextTransform);
        if (bitmapSelectionRef.current && preparedTransformRef.current) {
          drawPreparedTransformPreview(nextBounds, rotationRadians);
        }
        return;
      }

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

    const nextDraft = { ...currentDraft, points: [...currentDraft.points, position] };
    updateSelectionDraftState(nextDraft);
  };

  const finishStroke = (event?: { evt?: globalThis.PointerEvent }) => {
    if (event?.evt && !shouldHandleSketchPointer(event.evt, activePointerIdRef.current)) {
      return;
    }

    if (tool === "select") {
      void finishBitmapSelection();
      updateDrawingState(false);
      activePointerIdRef.current = undefined;
      return;
    }

    const currentStroke = draftStrokeRef.current;
    if (currentStroke && shouldCommitStroke(currentStroke)) {
      void commitStroke(activeDrawingLayerId, currentStroke);
    } else {
      clearDraftStroke();
    }

    updateDrawingState(false);
    activePointerIdRef.current = undefined;
  };

  const finishBitmapSelection = async () => {
    const currentTransform = transformDraftRef.current;
    if (currentTransform) {
      await commitSelectionTransform(currentTransform);
      if (transformDraftRef.current !== currentTransform) return;
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

  const fillDragDataType = "application/x-storyboard-fill-color";
  const fillColorFromDrag = (event: ReactDragEvent<HTMLElement>): string | undefined => {
    const color = event.dataTransfer.getData(fillDragDataType);
    return /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
  };

  const hasFillDragData = (event: ReactDragEvent<HTMLElement>): boolean =>
    Array.from(event.dataTransfer.types).includes(fillDragDataType);

  const canFillActiveLayer = () => canFillBitmapLayer(activeDrawingLayer);

  const handleFillDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!hasFillDragData(event) || !canFillActiveLayer()) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleFillDrop = (event: ReactDragEvent<HTMLElement>) => {
    const color = fillColorFromDrag(event);
    if (!color || !activeDrawingLayer || !canFillActiveLayer()) {
      return;
    }

    const rect = imageStageRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    blurActiveFormControl();
    onFocusShot();

    const point = sketchPointFromClientPoint(event.clientX, event.clientY, rect, canvasSize);
    void onFill(activeDrawingLayer.id, point, color).then((dataUrl) => {
      if (dataUrl) {
        setLayerDataUrls((current) => ({ ...current, [activeDrawingLayer.id]: dataUrl }));
      }
    });
  };

  const presentation=useContext(CanvasPresentationContext)[shot.id];
  return (
    <div
      style={presentation?{position:"relative",background:"#000",paddingBlock:presentation.mode==='expanded'?`${75/canvasSize.width*100}%`:undefined}:undefined}
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
        style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}`, cursor: sketchCursor }}
        onPointerEnter={(event) => {
          refreshStageRect();
          updateBrushCursorPreview(event.nativeEvent);
        }}
        onPointerLeave={hideBrushCursorPreview}
        onPointerCancel={hideBrushCursorPreview}
        onDragOver={handleFillDragOver}
        onDrop={handleFillDrop}
        onContextMenu={(event) => {
          if (!onOpenBrushPanel) return;
          // Right-click opens the panel and never becomes part of a stroke.
          event.preventDefault();
          event.stopPropagation();
          onOpenBrushPanel({ x: event.clientX, y: event.clientY });
        }}
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
                  <img
                    src={layerSrc}
                    alt=""
                    draggable={false}
                    style={layerStyle}
                    onLoad={(event) => {
                      event.currentTarget.style.display = "";
                      delete event.currentTarget.dataset.fallbackApplied;
                    }}
                    onError={(event) => {
                      if (
                        layer.kind === "image" &&
                        !layer.cleared &&
                        event.currentTarget.dataset.fallbackApplied !== "true"
                      ) {
                        event.currentTarget.dataset.fallbackApplied = "true";
                        event.currentTarget.src = imageSrc;
                      } else {
                        event.currentTarget.style.display = "none";
                      }
                    }}
                  />
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
          transform={transformDraft}
          stageSize={stageSize}
          canvasSize={canvasSize}
        />
        <OnionSkinOverlay
          previousShot={onionSkinPreviousShot}
          nextShot={onionSkinNextShot}
          previousRevision={onionSkinPreviousRevision}
          nextRevision={onionSkinNextRevision}
          stageSize={stageSize}
          folderPath={folderPath}
        />
        <Stage
          className="stage-overlay"
          style={{ cursor: sketchCursor }}
          width={stageSize.width}
          height={stageSize.height}
          onPointerDown={beginStroke}
          onPointerMove={extendStroke}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onLostPointerCapture={finishStroke}
        >
          {pendingCommittedStrokes.length > 0 || draftStroke ? (
            <Layer
              listening={false}
              scaleX={stageSize.width / canvasSize.width}
              scaleY={stageSize.height / canvasSize.height}
            >
              {[
                ...pendingCommittedStrokes,
                ...(draftStroke && activeDrawingLayer
                  ? [{ layerId: activeDrawingLayer.id, stroke: draftStroke }]
                  : [])
              ].map(({ layerId, stroke }) => {
                const previewLayer = bitmapLayers.find((layer) => layer.id === layerId) ?? activeDrawingLayer;
                if (stroke.brush) {
                  return <BrushStrokeImage key={stroke.id} stroke={stroke} width={canvasSize.width} height={canvasSize.height}
                    layerOpacity={previewLayer?.opacity} />;
                }
                return stroke.points.length === 2 ? (
                  <Circle
                    key={stroke.id}
                    x={stroke.points[0]}
                    y={stroke.points[1]}
                    radius={stroke.size / 2}
                    fill={stroke.color}
                    opacity={liveStrokePreviewOpacity(stroke, previewLayer?.opacity)}
                    listening={false}
                    perfectDrawEnabled={false}
                    shadowBlur={Math.max(0, stroke.size * (stroke.softness ?? 0))}
                    shadowColor={stroke.color}
                    globalCompositeOperation={
                      stroke.tool === "eraser" ? "destination-out" : "source-over"
                    }
                  />
                ) : (
                  <Line
                    key={stroke.id}
                    points={stroke.points}
                    stroke={stroke.color}
                    opacity={liveStrokePreviewOpacity(stroke, previewLayer?.opacity)}
                    strokeWidth={stroke.size}
                    lineCap="round"
                    lineJoin="round"
                    listening={false}
                    perfectDrawEnabled={false}
                    shadowBlur={Math.max(0, stroke.size * (stroke.softness ?? 0))}
                    shadowColor={stroke.color}
                    globalCompositeOperation={
                      stroke.tool === "eraser" ? "destination-out" : "source-over"
                    }
                  />
                );
              })}
            </Layer>
          ) : null}
        </Stage>
        {isBrushCursorPreviewTool ? (
          <div
            ref={brushCursorPreviewRef}
            className="brush-cursor-preview"
            style={{
              left: 0,
              top: 0,
              width: cursorPreviewDiameter,
              height: cursorPreviewDiameter,
              opacity: 0
            }}
          />
        ) : null}
      </div>
      {presentation&&<PresentationBars value={presentation} width={stageSize.width/canvasSize.width}/>}
    </div>
  );
});

SketchPad.displayName = "SketchPad";

type OnionSkinOverlayProps = {
  previousShot?: Shot;
  nextShot?: Shot;
  previousRevision: number;
  nextRevision: number;
  stageSize: CanvasSize;
  folderPath?: string;
};

const OnionSkinOverlay = ({
  previousShot,
  nextShot,
  previousRevision,
  nextRevision,
  stageSize,
  folderPath
}: OnionSkinOverlayProps) => {
  if (!previousShot && !nextShot) {
    return null;
  }

  return (
    <div className="onion-skin-overlay" aria-hidden="true">
      {previousShot ? (
        <OnionSkinGhost
          shot={previousShot}
          tone="previous"
          revision={previousRevision}
          stageSize={stageSize}
          folderPath={folderPath}
        />
      ) : null}
      {nextShot ? (
        <OnionSkinGhost
          shot={nextShot}
          tone="next"
          revision={nextRevision}
          stageSize={stageSize}
          folderPath={folderPath}
        />
      ) : null}
    </div>
  );
};

const OnionSkinGhost = ({
  shot,
  tone,
  revision,
  stageSize,
  folderPath
}: {
  shot: Shot;
  tone: "previous" | "next";
  revision: number;
  stageSize: CanvasSize;
  folderPath?: string;
}) => {
  return (
    <div className={`onion-skin-ghost onion-skin-ghost-${tone}`}>
      <ShotLayerImageStack
        shot={shot}
        folderPath={folderPath}
        revision={revision}
        className="onion-skin-image"
      />
    </div>
  );
};
