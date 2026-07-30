import { sortedShots } from "../shared/projectOps";
import type { Project, Shot, SketchStroke, SketchTool } from "../shared/types";
import { shotDialogueText } from "./editableDialogueText";
import { SketchPad } from "./SketchPad";
import { ShotStaticMedia } from "./ShotStaticMedia";
import { useSortable } from "@dnd-kit/sortable";
import { CSS as DndCss } from "@dnd-kit/utilities";
import {
  forwardRef,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEventHandler,
  type ReactNode
} from "react";
import type { DragData } from "./storyboardDnd";
import {
  shouldMountStoryboardEditor,
  useStoryboardMediaWindow
} from "./storyboardMediaWindow";

export type JapaneseStoryboardRow = {
  shot: Shot;
  shotNumber: string;
  actionText: string;
  dialogueText: string;
};

export const japaneseStoryboardRows = (project: Project): JapaneseStoryboardRow[] =>
  sortedShots(project.shots).map((shot, index) => ({
    shot,
    shotNumber: String(index + 1).padStart(3, "0"),
    actionText: shot.scriptText ?? "",
    dialogueText: shotDialogueText(project, shot.id)
  }));

export const japaneseStoryboardRowClassName = ({
  isSelected,
  isDragging
}: {
  isSelected: boolean;
  isDragging: boolean;
}): string =>
  [
    "japanese-storyboard-row",
    isSelected ? "is-selected" : "",
    isDragging ? "is-dragging" : ""
  ]
    .filter(Boolean)
    .join(" ");

export const japaneseStoryboardZoomScale = (zoomLevel: number): number => Math.max(0.01, zoomLevel / 100);

export const japaneseStoryboardZoomStyle = (zoomLevel: number): CSSProperties => {
  const scale = japaneseStoryboardZoomScale(zoomLevel);
  return {
    "--japanese-storyboard-zoom": String(scale)
  } as CSSProperties;
};

type JapaneseStoryboardViewProps = {
  activeSketchTool: SketchTool;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  brushSoftness: number;
  eraserOpacity: number;
  eraserSize: number;
  eraserSoftness: number;
  folderPath?: string;
  bitmapRevisionByShotId: Readonly<Record<string, number>>;
  isZoomScrubbing: boolean;
  marquee?: ReactNode;
  onPointerDown?: PointerEventHandler<HTMLElement>;
  project: Project;
  selectedShotIds: string[];
  zoomLevel: number;
  onActionText: (shotId: string, actionText: string) => void;
  onDialogueText: (shotId: string, dialogueText: string) => void;
  onFill: (
    shot: Shot,
    layerId: string,
    point: { x: number; y: number },
    color: string
  ) => Promise<string | undefined>;
  onFocusShot: (shotId: string) => void;
  onPickColor: (color: string) => void;
  onSelectShot: (shotId: string, event: MouseEvent<HTMLElement>) => void;
  onSelectionTransform: (shot: Shot, layerId: string, dataUrl: string) => Promise<string | undefined>;
  onBitmapSelectionChange?: (
    shotId: string,
    layerId: string | undefined,
    points: { x: number; y: number }[] | undefined
  ) => void;
  onSketchBeginInteraction?: () => void;
  onSketchStroke: (
    shot: Shot,
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string,
    pendingStrokes?: SketchStroke[]
  ) => Promise<string | undefined>;
};

export type JapaneseStoryboardRowViewProps = {
  activeSketchTool: SketchTool;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  brushSoftness: number;
  eraserOpacity: number;
  eraserSize: number;
  eraserSoftness: number;
  folderPath?: string;
  bitmapRevision: number;
  isZoomScrubbing: boolean;
  isPrimarySelected: boolean;
  isSelected: boolean;
  row: JapaneseStoryboardRow;
  onActionText: (shotId: string, actionText: string) => void;
  onDialogueText: (shotId: string, dialogueText: string) => void;
  onFill: (
    shot: Shot,
    layerId: string,
    point: { x: number; y: number },
    color: string
  ) => Promise<string | undefined>;
  onFocusShot: (shotId: string) => void;
  onPickColor: (color: string) => void;
  onSelectShot: (shotId: string, event: MouseEvent<HTMLElement>) => void;
  onSelectionTransform: (shot: Shot, layerId: string, dataUrl: string) => Promise<string | undefined>;
  onBitmapSelectionChange?: (
    shotId: string,
    layerId: string | undefined,
    points: { x: number; y: number }[] | undefined
  ) => void;
  onSketchBeginInteraction?: () => void;
  onSketchStroke: (
    shot: Shot,
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string,
    pendingStrokes?: SketchStroke[]
  ) => Promise<string | undefined>;
};

export const sameJapaneseStoryboardRowViewProps = (
  previous: JapaneseStoryboardRowViewProps,
  next: JapaneseStoryboardRowViewProps
): boolean =>
  previous.activeSketchTool === next.activeSketchTool &&
  previous.brushColor === next.brushColor &&
  previous.brushOpacity === next.brushOpacity &&
  previous.brushSize === next.brushSize &&
  previous.brushSoftness === next.brushSoftness &&
  previous.eraserOpacity === next.eraserOpacity &&
  previous.eraserSize === next.eraserSize &&
  previous.eraserSoftness === next.eraserSoftness &&
  previous.folderPath === next.folderPath &&
  previous.bitmapRevision === next.bitmapRevision &&
  previous.isZoomScrubbing === next.isZoomScrubbing &&
  previous.isPrimarySelected === next.isPrimarySelected &&
  previous.isSelected === next.isSelected &&
  previous.row.shot === next.row.shot &&
  previous.row.shotNumber === next.row.shotNumber &&
  previous.row.actionText === next.row.actionText &&
  previous.row.dialogueText === next.row.dialogueText &&
  previous.onActionText === next.onActionText &&
  previous.onDialogueText === next.onDialogueText &&
  previous.onFill === next.onFill &&
  previous.onFocusShot === next.onFocusShot &&
  previous.onPickColor === next.onPickColor &&
  previous.onSelectShot === next.onSelectShot &&
  previous.onSelectionTransform === next.onSelectionTransform &&
  previous.onBitmapSelectionChange === next.onBitmapSelectionChange &&
  previous.onSketchBeginInteraction === next.onSketchBeginInteraction &&
  previous.onSketchStroke === next.onSketchStroke;

const JapaneseStoryboardRowView = memo(({
  activeSketchTool,
  brushColor,
  brushOpacity,
  brushSize,
  brushSoftness,
  eraserOpacity,
  eraserSize,
  eraserSoftness,
  folderPath,
  bitmapRevision,
  isZoomScrubbing,
  isPrimarySelected,
  isSelected,
  row,
  onActionText,
  onDialogueText,
  onFill,
  onFocusShot,
  onPickColor,
  onSelectShot,
  onSelectionTransform,
  onBitmapSelectionChange,
  onSketchBeginInteraction,
  onSketchStroke
}: JapaneseStoryboardRowViewProps) => {
  const rowRef = useRef<HTMLElement | null>(null);
  const [isSketchInteracting, setIsSketchInteracting] = useState(false);
  const {
    attributes,
    isDragging,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition
  } = useSortable({
    id: row.shot.id,
    data: { type: "shot", shotId: row.shot.id } satisfies DragData
  });
  const style: CSSProperties = {
    transform: DndCss.Transform.toString(transform),
    transition
  };
  const setRowNodeRef = useCallback(
    (element: HTMLElement | null) => {
      rowRef.current = element;
      setNodeRef(element);
    },
    [setNodeRef]
  );
  const mediaTier = useStoryboardMediaWindow(
    rowRef,
    isPrimarySelected || isSketchInteracting
  );
  const shouldRenderMedia = shouldMountStoryboardEditor(mediaTier);
  const handleSketchStroke = useCallback(
    (
      layerId: string,
      stroke: SketchStroke,
      renderedDataUrl?: string,
      pendingStrokes?: SketchStroke[]
    ) => onSketchStroke(row.shot, layerId, stroke, renderedDataUrl, pendingStrokes),
    [onSketchStroke, row.shot]
  );
  const handleSelectionTransform = useCallback(
    (layerId: string, dataUrl: string) =>
      onSelectionTransform(row.shot, layerId, dataUrl),
    [onSelectionTransform, row.shot]
  );
  const handleFill = useCallback(
    (layerId: string, point: { x: number; y: number }, color: string) =>
      onFill(row.shot, layerId, point, color),
    [onFill, row.shot]
  );
  const handleFocusShot = useCallback(
    () => onFocusShot(row.shot.id),
    [onFocusShot, row.shot.id]
  );

  return (
    <article
      ref={setRowNodeRef}
      className={japaneseStoryboardRowClassName({ isSelected, isDragging })}
      data-shot-id={row.shot.id}
      data-media-tier={mediaTier}
      style={style}
      onClick={(event) => onSelectShot(row.shot.id, event)}
    >
      <button
        type="button"
        className="japanese-storyboard-cut"
        ref={setActivatorNodeRef}
        aria-label={`Drag shot ${row.shotNumber} to reorder`}
        title="Drag to reorder shot"
        {...attributes}
        {...listeners}
      >
        {row.shotNumber}
      </button>
      <div className="japanese-storyboard-picture">
        {shouldRenderMedia ? (
          <SketchPad
            shot={row.shot}
            folderPath={folderPath}
            bitmapRevision={bitmapRevision}
            tool={activeSketchTool}
            brushColor={brushColor}
            brushOpacity={brushOpacity}
            brushSize={brushSize}
            brushSoftness={brushSoftness}
            eraserOpacity={eraserOpacity}
            eraserSize={eraserSize}
            eraserSoftness={eraserSoftness}
            isZoomScrubbing={isZoomScrubbing}
            onStroke={handleSketchStroke}
            onSelectionTransform={handleSelectionTransform}
            onBitmapSelectionChange={onBitmapSelectionChange}
            onFill={handleFill}
            onPickColor={onPickColor}
            onFocusShot={handleFocusShot}
            onBeginInteraction={onSketchBeginInteraction}
            onInteractionActiveChange={setIsSketchInteracting}
          />
        ) : (
          <ShotStaticMedia
            shot={row.shot}
            folderPath={folderPath}
            revision={bitmapRevision}
            preload={mediaTier === "warm"}
          />
        )}
      </div>
      <label className="japanese-storyboard-cell">
        <span>Action Notes</span>
        <textarea
          aria-label={`Shot ${row.shotNumber} action notes`}
          value={row.actionText}
          onChange={(event) => onActionText(row.shot.id, event.target.value)}
        />
      </label>
      <label className="japanese-storyboard-cell">
        <span>Dialog</span>
        <textarea
          aria-label={`Shot ${row.shotNumber} dialogue`}
          value={row.dialogueText}
          onChange={(event) => onDialogueText(row.shot.id, event.target.value)}
        />
      </label>
    </article>
  );
}, sameJapaneseStoryboardRowViewProps);

JapaneseStoryboardRowView.displayName = "JapaneseStoryboardRowView";

export const JapaneseStoryboardView = forwardRef<HTMLElement, JapaneseStoryboardViewProps>(({
  activeSketchTool,
  brushColor,
  brushOpacity,
  brushSize,
  brushSoftness,
  eraserOpacity,
  eraserSize,
  eraserSoftness,
  folderPath,
  bitmapRevisionByShotId,
  isZoomScrubbing,
  marquee,
  onPointerDown,
  project,
  selectedShotIds,
  zoomLevel,
  onActionText,
  onDialogueText,
  onFill,
  onFocusShot,
  onPickColor,
  onSelectShot,
  onSelectionTransform,
  onBitmapSelectionChange,
  onSketchBeginInteraction,
  onSketchStroke
}, ref) => {
  const rows = useMemo(() => japaneseStoryboardRows(project), [project]);
  const selectedShotIdSet = useMemo(() => new Set(selectedShotIds), [selectedShotIds]);
  const primarySelectedShotId = selectedShotIds[0];

  return (
    <section
      ref={ref}
      className="japanese-storyboard-view"
      style={japaneseStoryboardZoomStyle(zoomLevel)}
      data-marquee-mode="rows"
      aria-label="Japanese storyboard sheet"
      onPointerDown={onPointerDown}
    >
      <div className="japanese-storyboard-sheet">
        <div className="japanese-storyboard-header" aria-hidden="true">
          <span>Cut</span>
          <span>Picture</span>
          <span>Action</span>
          <span>Dialogue</span>
        </div>
        {rows.map((row) => (
          <JapaneseStoryboardRowView
            key={row.shot.id}
            activeSketchTool={activeSketchTool}
            brushColor={brushColor}
            brushOpacity={brushOpacity}
            brushSize={brushSize}
            brushSoftness={brushSoftness}
            eraserOpacity={eraserOpacity}
            eraserSize={eraserSize}
            eraserSoftness={eraserSoftness}
            folderPath={folderPath}
            bitmapRevision={bitmapRevisionByShotId[row.shot.id] ?? 0}
            isZoomScrubbing={isZoomScrubbing}
            isPrimarySelected={primarySelectedShotId === row.shot.id}
            isSelected={selectedShotIdSet.has(row.shot.id)}
            row={row}
            onActionText={onActionText}
            onDialogueText={onDialogueText}
            onFill={onFill}
            onFocusShot={onFocusShot}
            onPickColor={onPickColor}
            onSelectShot={onSelectShot}
            onSelectionTransform={onSelectionTransform}
            onBitmapSelectionChange={onBitmapSelectionChange}
            onSketchBeginInteraction={onSketchBeginInteraction}
            onSketchStroke={onSketchStroke}
          />
        ))}
      </div>
      {marquee}
    </section>
  );
});
JapaneseStoryboardView.displayName = "JapaneseStoryboardView";
