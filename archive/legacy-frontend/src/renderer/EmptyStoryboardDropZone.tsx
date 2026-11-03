import { useDroppable } from "@dnd-kit/core";
import type { DragData } from "./storyboardDnd";

export const EmptyStoryboardDropZone = () => {
  const { setNodeRef, isOver } = useDroppable({
    id: "empty-storyboard-board",
    data: { type: "empty-board" } satisfies DragData
  });

  return (
    <div
      ref={setNodeRef}
      data-empty-board-drop-zone="true"
      aria-label="Restore storyboard from Pending"
      style={{
        gridColumn: "1 / -1",
        minHeight: 180,
        display: "grid",
        placeItems: "center",
        border: `2px dashed ${isOver ? "currentColor" : "#888"}`
      }}
    >
      Drag a storyboard from Pending here to restore it.
    </div>
  );
};
