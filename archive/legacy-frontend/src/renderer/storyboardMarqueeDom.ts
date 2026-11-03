import type { MarqueeShotRect } from "./storyboardMarquee";

export const storyboardMarqueeShotRectsFromDom = (
  board: HTMLElement | null,
  scroll: { x: number; y: number } = { x: window.scrollX, y: window.scrollY }
): MarqueeShotRect[] => {
  if (!board) {
    return [];
  }

  return Array.from(board.querySelectorAll<HTMLElement>("[data-shot-id]"))
    .map((element) => {
      const shotId = element.dataset.shotId;
      if (!shotId) {
        return undefined;
      }

      const rect = element.getBoundingClientRect();
      return {
        shotId,
        rect: {
          left: rect.left + scroll.x,
          right: rect.right + scroll.x,
          top: rect.top + scroll.y,
          bottom: rect.bottom + scroll.y
        }
      };
    })
    .filter((shotRect): shotRect is MarqueeShotRect => Boolean(shotRect));
};

export const applySelectedShotCountLabel = (element: HTMLSpanElement | null, selectedCount: number) => {
  if (element) {
    element.textContent = `${selectedCount} selected`;
  }
};
