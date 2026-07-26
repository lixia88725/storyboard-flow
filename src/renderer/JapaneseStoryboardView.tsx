import { sortedShots } from "../shared/projectOps";
import type { Project, Shot, SketchStroke, SketchTool } from "../shared/types";
import { shotDialogueText } from "./editableDialogueText";
import { SketchPad } from "./SketchPad";
import { useSortable } from "@dnd-kit/sortable";
import { CSS as DndCss } from "@dnd-kit/utilities";
import {
  forwardRef,
  type CSSProperties,
  type MouseEvent,
  type PointerEventHandler,
  type ReactNode
} from "react";
import type { DragData } from "./storyboardDnd";

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

type JapaneseStoryboardRowViewProps = {
  activeSketchTool: SketchTool;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  brushSoftness: number;
  eraserOpacity: number;
  eraserSize: number;
  eraserSoftness: number;
  folderPath?: string;
  isZoomScrubbing: boolean;
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

const JapaneseStoryboardRowView = ({
  activeSketchTool,
  brushColor,
  brushOpacity,
  brushSize,
  brushSoftness,
  eraserOpacity,
  eraserSize,
  eraserSoftness,
  folderPath,
  isZoomScrubbing,
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

  return (
    <article
      ref={setNodeRef}
      className={japaneseStoryboardRowClassName({ isSelected, isDragging })}
      data-shot-id={row.shot.id}
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
        <SketchPad
          shot={row.shot}
          folderPath={folderPath}
          tool={activeSketchTool}
          brushColor={brushColor}
          brushOpacity={brushOpacity}
          brushSize={brushSize}
          brushSoftness={brushSoftness}
          eraserOpacity={eraserOpacity}
          eraserSize={eraserSize}
          eraserSoftness={eraserSoftness}
          isZoomScrubbing={isZoomScrubbing}
          onStroke={(layerId, stroke, renderedDataUrl, pendingStrokes) =>
            onSketchStroke(row.shot, layerId, stroke, renderedDataUrl, pendingStrokes)
          }
          onSelectionTransform={(layerId, dataUrl) =>
            onSelectionTransform(row.shot, layerId, dataUrl)
          }
          onBitmapSelectionChange={onBitmapSelectionChange}
          onFill={(layerId, point, color) => onFill(row.shot, layerId, point, color)}
          onPickColor={onPickColor}
          onFocusShot={() => onFocusShot(row.shot.id)}
          onBeginInteraction={onSketchBeginInteraction}
        />
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
};

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
        {japaneseStoryboardRows(project).map((row) => (
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
            isZoomScrubbing={isZoomScrubbing}
            isSelected={selectedShotIds.includes(row.shot.id)}
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
