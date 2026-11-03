export type BoardViewMode = "storyboard" | "japaneseStoryboard";
export type VisibleBoardViewMode = BoardViewMode | "animation";

export const nextBoardViewMode = (mode: BoardViewMode): BoardViewMode =>
  mode === "storyboard" ? "japaneseStoryboard" : "storyboard";

export const visibleBoardViewMode = ({
  boardViewMode,
  isAnimationMode
}: {
  boardViewMode: BoardViewMode;
  isAnimationMode: boolean;
}): VisibleBoardViewMode => (isAnimationMode ? "animation" : boardViewMode);
