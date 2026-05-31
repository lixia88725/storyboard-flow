import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent
} from "react";
import { dialoguesForShot } from "../shared/projectOps";
import type {
  BitmapLayer,
  BitmapSelectionMode,
  Dialogue,
  Project,
  Shot,
  SketchStroke,
  SketchTool
} from "../shared/types";
import { LayerPanel } from "./LayerPanel";
import { SketchPad } from "./SketchPad";
import { canvasSizeForShot } from "./sketchRendering";
import type { DragData } from "./storyboardDnd";

export type CardFace = "image" | "script";

const maxDialogueRows = 3;

const dialogueLines = (text: string) => text.replace(/\r\n?/g, "\n").split("\n");
const clampDialogueText = (text: string) => dialogueLines(text).slice(0, maxDialogueRows).join("\n");
const dialogueRowsForText = (text: string) =>
  Math.min(maxDialogueRows, Math.max(1, dialogueLines(text).length));

export type ShotCardProps = {
  shot: Shot;
  index: number;
  project: Project;
  folderPath?: string;
  isSelected: boolean;
  isPrimarySelected: boolean;
  isAnimationFocused: boolean;
  activeSketchTool: SketchTool;
  selectionMode: BitmapSelectionMode;
  brushColor: string;
  brushOpacity: number;
  brushSize: number;
  eraserOpacity: number;
  eraserSize: number;
  cardFace: CardFace;
  onionSkinPreviousShot?: Shot;
  onionSkinNextShot?: Shot;
  editingDialogueId?: string;
  isLayerPanelOpen: boolean;
  thumbnailRevision: number;
  onSelect: (event: MouseEvent) => void;
  onFocusShot: () => void;
  onToggleLayerPanel: () => void;
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
  onCreateDialogue: (shotId: string) => void;
  onDialogueText: (dialogueId: string, text: string) => void;
  onDialogueBlur: (dialogue: Dialogue) => void;
  onScriptText: (shotId: string, scriptText: string) => void;
  onSketchStroke: (
    layerId: string,
    stroke: SketchStroke,
    renderedDataUrl?: string
  ) => Promise<string | undefined>;
  onSelectionTransform: (layerId: string, dataUrl: string) => Promise<string | undefined>;
};

export const ShotCard = ({
  shot,
  index,
  project,
  folderPath,
  isSelected,
  isPrimarySelected,
  isAnimationFocused,
  activeSketchTool,
  selectionMode,
  brushColor,
  brushOpacity,
  brushSize,
  eraserOpacity,
  eraserSize,
  cardFace,
  onionSkinPreviousShot,
  onionSkinNextShot,
  editingDialogueId,
  isLayerPanelOpen,
  thumbnailRevision,
  onSelect,
  onFocusShot,
  onToggleLayerPanel,
  onAddLayer,
  onRemoveLayer,
  onClearLayer,
  onSelectLayer,
  onUpdateLayer,
  onMoveLayer,
  onCreateDialogue,
  onDialogueText,
  onDialogueBlur,
  onScriptText,
  onSketchStroke,
  onSelectionTransform
}: ShotCardProps) => {
  const cardRef = useRef<HTMLElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(index < 12);
  const [isLayerPanelRendered, setIsLayerPanelRendered] = useState(isLayerPanelOpen);
  const sortable = useSortable({
    id: shot.id,
    data: { type: "shot", shotId: shot.id } satisfies DragData
  });
  const dropZone = useDroppable({
    id: `dialogue-zone-${shot.id}`,
    data: { type: "drop-zone", shotId: shot.id } satisfies DragData
  });
  const dialogues = dialoguesForShot(project, shot.id);
  const isLayerPanelVisible = isLayerPanelOpen || isLayerPanelRendered;
  const shouldRenderMedia = isNearViewport || isPrimarySelected || isAnimationFocused || isLayerPanelVisible;
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition
  };
  const setCardNodeRef = useCallback(
    (element: HTMLElement | null) => {
      cardRef.current = element;
      sortable.setNodeRef(element);
    },
    [sortable.setNodeRef]
  );

  useEffect(() => {
    if (index < 12) {
      setIsNearViewport(true);
    }
  }, [index]);

  useEffect(() => {
    const element = cardRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsNearViewport(entry.isIntersecting);
      },
      { rootMargin: "1200px 0px" }
    );
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

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
      } ${cardFace === "script" ? "is-script-face" : ""}`}
      style={style}
      data-shot-id={shot.id}
      onClick={onSelect}
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
        <div className="shot-face shot-face-front" aria-hidden={cardFace === "script"}>
          <div className={`shot-image-shell ${isLayerPanelVisible ? "has-layer-panel" : ""}`}>
            {shouldRenderMedia ? (
              <>
                <SketchPad
                  shot={shot}
                  folderPath={folderPath}
                  tool={activeSketchTool}
                  selectionMode={selectionMode}
                  brushColor={brushColor}
                  brushOpacity={brushOpacity}
                  brushSize={brushSize}
                  eraserOpacity={eraserOpacity}
                  eraserSize={eraserSize}
                  onionSkinPreviousShot={onionSkinPreviousShot}
                  onionSkinNextShot={onionSkinNextShot}
                  onStroke={onSketchStroke}
                  onSelectionTransform={onSelectionTransform}
                  onFocusShot={onFocusShot}
                />
                <LayerPanel
                  shot={shot}
                  folderPath={folderPath}
                  thumbnailRevision={thumbnailRevision}
                  isOpen={isLayerPanelOpen}
                  isRendered={isLayerPanelVisible}
                  onToggle={onToggleLayerPanel}
                  onAddLayer={onAddLayer}
                  onRemoveLayer={onRemoveLayer}
                  onClearLayer={onClearLayer}
                  onSelectLayer={onSelectLayer}
                  onUpdateLayer={onUpdateLayer}
                  onMoveLayer={onMoveLayer}
                />
              </>
            ) : (
              <DeferredShotMedia shot={shot} />
            )}
          </div>

          <div
            ref={dropZone.setNodeRef}
            className={`dialogue-zone ${dropZone.isOver ? "is-over" : ""}`}
            onDoubleClick={(event) => {
              if ((event.target as HTMLElement).closest(".dialogue-card")) {
                return;
              }
              onCreateDialogue(shot.id);
            }}
          >
            {dialogues.length === 0 ? (
              <p className="drop-hint">Double-click to type dialogue</p>
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

        <div className="shot-face shot-face-back" aria-hidden={cardFace === "image"}>
          <textarea
            className="shot-script-textarea"
            aria-label={`Shot ${index + 1} storyboard script`}
            value={shot.scriptText ?? ""}
            onChange={(event) => onScriptText(shot.id, event.target.value)}
            placeholder="分镜头脚本"
          />
        </div>
      </div>
    </article>
  );
};

const DeferredShotMedia = ({ shot }: { shot: Shot }) => {
  const canvasSize = canvasSizeForShot(shot);

  return (
    <div className="sketch-panel" aria-hidden="true">
      <div
        className="image-stage"
        style={{ aspectRatio: `${canvasSize.width} / ${canvasSize.height}` }}
      />
    </div>
  );
};

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
        ::
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
