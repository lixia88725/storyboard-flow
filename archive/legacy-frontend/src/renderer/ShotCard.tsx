import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent
} from "react";
import type {
  BitmapLayer,
  Dialogue,
  Shot,
  SketchStroke,
  SketchTool
} from "../shared/types";
import { LayerPanel } from "./LayerPanel";
import { SketchPad } from "./SketchPad";
import { ShotStaticMedia } from "./ShotStaticMedia";
import { isDialogueDropZoneHighlighted, type DragData } from "./storyboardDnd";
import {
  shouldMountStoryboardEditor,
  useStoryboardMediaWindow
} from "./storyboardMediaWindow";

const maxDialogueRows = 3;
const dialogueGripDots = Array.from({ length: 9 }, (_item, index) => index);

const dialogueLines = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");
const clampDialogueText = (text: string) => dialogueLines(text).slice(0, maxDialogueRows).join("\n");
const dialogueRowsForText = (text: string) =>
  Math.min(maxDialogueRows, Math.max(1, dialogueLines(text).length));

export type ShotCardProps = {
  shot: Shot;
  index: number;
  dialogues: Dialogue[];
  folderPath?: string;
  isSelected: boolean;
  isPrimarySelected: boolean;
  isAnimationFocused: boolean;
  isZoomScrubbing: boolean;
  disableSortableTransform: boolean;
  keepDraggingSourceVisible: boolean;
  activeDragType?: DragData["type"];
  activeSketchTool: SketchTool;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  brushSoftness: number;
  eraserOpacity: number;
  eraserSize: number;
  eraserSoftness: number;
  onionSkinPreviousShot?: Shot;
  onionSkinNextShot?: Shot;
  onionSkinPreviousRevision?: number;
  onionSkinNextRevision?: number;
  editingDialogueId?: string;
  isLayerPanelOpen: boolean;
  bitmapRevision: number;
  onSelect: (shotId: string, event: MouseEvent<HTMLElement>) => void;
  onFocusShot: (shotId: string) => void;
  onToggleLayerPanel: (shotId: string) => void;
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
  onCreateDialogue: (shotId: string) => void;
  onDialogueText: (dialogueId: string, text: string) => void;
  onDialogueBlur: (dialogue: Dialogue) => void;
  onSketchStroke: (
    shot: Shot,
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string,
    pendingStrokes?: SketchStroke[]
  ) => Promise<string | undefined>;
  onSelectionTransform: (
    shot: Shot,
    layerId: string,
    dataUrl: string
  ) => Promise<string | undefined>;
  onBitmapSelectionChange?: (
    shotId: string,
    layerId: string | undefined,
    points: { x: number; y: number }[] | undefined
  ) => void;
  onFill: (
    shot: Shot,
    layerId: string,
    point: { x: number; y: number },
    color: string
  ) => Promise<string | undefined>;
  onPickColor: (color: string) => void;
  onSketchBeginInteraction?: () => void;
};

export const ShotCard = memo(({
  shot,
  index,
  dialogues,
  folderPath,
  isSelected,
  isPrimarySelected,
  isAnimationFocused,
  isZoomScrubbing,
  disableSortableTransform,
  keepDraggingSourceVisible,
  activeDragType,
  activeSketchTool,
  brushColor,
  brushOpacity,
  brushSize,
  brushSoftness,
  eraserOpacity,
  eraserSize,
  eraserSoftness,
  onionSkinPreviousShot,
  onionSkinNextShot,
  onionSkinPreviousRevision,
  onionSkinNextRevision,
  editingDialogueId,
  isLayerPanelOpen,
  bitmapRevision,
  onSelect,
  onFocusShot,
  onToggleLayerPanel,
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
  onUpdateLayerGroupOpacity,
  onCreateDialogue,
  onDialogueText,
  onDialogueBlur,
  onSketchStroke,
  onSelectionTransform,
  onBitmapSelectionChange,
  onFill,
  onPickColor,
  onSketchBeginInteraction
}: ShotCardProps) => {
  const cardRef = useRef<HTMLElement | null>(null);
  const [isLayerPanelRendered, setIsLayerPanelRendered] = useState(isLayerPanelOpen);
  const [isSketchInteracting, setIsSketchInteracting] = useState(false);
  const sortable = useSortable({
    id: shot.id,
    data: { type: "shot", shotId: shot.id } satisfies DragData
  });
  const dropZone = useDroppable({
    id: `dialogue-zone-${shot.id}`,
    data: { type: "drop-zone", shotId: shot.id } satisfies DragData
  });
  const isDialogueDropZoneOver = isDialogueDropZoneHighlighted({
    isOver: dropZone.isOver,
    activeDragType
  });
  const isLayerPanelVisible = isLayerPanelOpen || isLayerPanelRendered;
  const mediaTier = useStoryboardMediaWindow(
    cardRef,
    isPrimarySelected || isAnimationFocused || isLayerPanelVisible || isSketchInteracting
  );
  const shouldRenderMedia = shouldMountStoryboardEditor(mediaTier);
  const style = {
    transform: disableSortableTransform ? undefined : CSS.Transform.toString(sortable.transform),
    transition: disableSortableTransform ? undefined : sortable.transition
  };
  const setCardNodeRef = useCallback(
    (element: HTMLElement | null) => {
      cardRef.current = element;
      sortable.setNodeRef(element);
    },
    [sortable.setNodeRef]
  );
  const handleSketchStroke = useCallback(
    (
      layerId: string,
      stroke: SketchStroke,
      renderedDataUrl?: string,
      pendingStrokes?: SketchStroke[]
    ) => onSketchStroke(shot, layerId, stroke, renderedDataUrl, pendingStrokes),
    [onSketchStroke, shot]
  );
  const handleSelectionTransform = useCallback(
    (layerId: string, dataUrl: string) => onSelectionTransform(shot, layerId, dataUrl),
    [onSelectionTransform, shot]
  );
  const handleFill = useCallback(
    (layerId: string, point: { x: number; y: number }, color: string) =>
      onFill(shot, layerId, point, color),
    [onFill, shot]
  );
  const handleFocusShot = useCallback(() => onFocusShot(shot.id), [onFocusShot, shot.id]);

  useEffect(() => {
    if (isLayerPanelOpen) {
      setIsLayerPanelRendered(true);
      return;
    }

    const timeout = window.setTimeout(() => setIsLayerPanelRendered(false), 140);
    return () => window.clearTimeout(timeout);
  }, [isLayerPanelOpen]);

  return (
    <article
      ref={setCardNodeRef}
      className={`shot-card ${sortable.isDragging ? "is-dragging" : ""} ${
        isSelected ? "is-selected" : ""
      } ${isAnimationFocused ? "is-animation-focus" : ""} ${
        isLayerPanelVisible ? "has-layer-panel-open" : ""
      } ${keepDraggingSourceVisible ? "keep-dragging-source-visible" : ""}`}
      style={style}
      data-shot-id={shot.id}
      data-media-tier={mediaTier}
      onClick={(event) => onSelect(shot.id, event)}
    >
      <div
        className="shot-head"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        title="Drag to reorder shot"
      >
        <span className="shot-index">{String(index + 1).padStart(3, "0")}</span>
        <span className="shot-head-grip" aria-hidden="true" />
      </div>

      <div className="shot-flip-shell">
        <div className="shot-face shot-face-front">
          <div className={`shot-image-shell ${isLayerPanelVisible ? "has-layer-panel" : ""}`}>
            {shouldRenderMedia ? (
              <>
                <SketchPad
                  shot={shot}
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
                  onionSkinPreviousShot={onionSkinPreviousShot}
                  onionSkinNextShot={onionSkinNextShot}
                  onionSkinPreviousRevision={onionSkinPreviousRevision}
                  onionSkinNextRevision={onionSkinNextRevision}
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
                <LayerPanel
                  shot={shot}
                  folderPath={folderPath}
                  thumbnailRevision={bitmapRevision}
                  isOpen={isLayerPanelOpen}
                  isRendered={isLayerPanelVisible}
                  onToggle={() => onToggleLayerPanel(shot.id)}
                  onAddLayer={onAddLayer}
                  onRemoveLayer={onRemoveLayer}
                  onMergeLayers={onMergeLayers}
                  onMergeVisibleLayers={onMergeVisibleLayers}
                  onClearLayer={onClearLayer}
                  onSelectLayer={onSelectLayer}
                  onUpdateLayer={onUpdateLayer}
                  onMoveLayer={onMoveLayer}
                  onMoveLayerGroup={onMoveLayerGroup}
                  onSelectedLayerIdsChange={onSelectedLayerIdsChange}
                  onUpdateLayerGroupOpacity={onUpdateLayerGroupOpacity}
                />
              </>
            ) : (
              <ShotStaticMedia
                shot={shot}
                folderPath={folderPath}
                revision={bitmapRevision}
                preload={mediaTier === "warm"}
              />
            )}
          </div>

          <div
            ref={dropZone.setNodeRef}
            className={`dialogue-zone ${isDialogueDropZoneOver ? "is-over" : ""}`}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest(".dialogue-card")) {
                return;
              }
              onCreateDialogue(shot.id);
            }}
          >
            {dialogues.length === 0 ? (
              <p className="drop-hint">Click to type dialogue</p>
            ) : null}
            {dialogues.map((dialogue) => (
              <DialogueCard
                key={dialogue.id}
                dialogue={dialogue}
                isEditing={dialogue.id === editingDialogueId}
                onChange={(text) => onDialogueText(dialogue.id, text)}
                onBlur={() => onDialogueBlur(dialogue)}
              />
            ))}
          </div>
        </div>
      </div>
    </article>
  );
});

ShotCard.displayName = "ShotCard";

type DialogueCardProps = {
  dialogue: Dialogue;
  isEditing: boolean;
  onChange: (text: string) => void;
  onBlur: () => void;
};

const DialogueCard = ({ dialogue, isEditing, onChange, onBlur }: DialogueCardProps) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const rows = dialogueRowsForText(dialogue.text);
  const sortable = useSortable({
    id: dialogue.id,
    data: {
      type: "dialogue",
      dialogueId: dialogue.id,
      shotId: dialogue.shotId
    } satisfies DragData
  });

  useEffect(() => {
    if (isEditing) {
      textareaRef.current?.focus();
    }
  }, [isEditing]);

  return (
    <div
      ref={sortable.setNodeRef}
      className="dialogue-card"
      style={{
        transform: CSS.Transform.toString(sortable.transform),
        transition: sortable.transition
      }}
    >
      <button
        type="button"
        className="dialogue-grip"
        ref={sortable.setActivatorNodeRef}
        {...sortable.attributes}
        {...sortable.listeners}
        title="Drag dialogue to another shot"
      >
        <span className="dialogue-grip-dots" aria-hidden="true">
          {dialogueGripDots.map((dot) => (
            <span key={dot} />
          ))}
        </span>
      </button>
      <textarea
        ref={textareaRef}
        rows={rows}
        value={dialogue.text}
        onChange={(event) => onChange(clampDialogueText(event.target.value))}
        onBlur={onBlur}
      />
    </div>
  );
};
