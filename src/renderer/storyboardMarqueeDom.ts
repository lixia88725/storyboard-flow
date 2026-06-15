import {
  marqueeDisplayedSelectionIds,
  marqueeSelectionClassChanges,
  marqueeViewportRect,
  type MarqueeBox,
  type MarqueeShotRect
} from "./storyboardMarquee";

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

export const storyboardMarqueeShotElementsFromDom = (board: HTMLElement | null): Map<string, HTMLElement> => {
  if (!board) {
    return new Map();
  }

  return Array.from(board.querySelectorAll<HTMLElement>("[data-shot-id]")).reduce(
    (elements, element) => {
      const shotId = element.dataset.shotId;
      if (shotId) {
        elements.set(shotId, element);
      }
      return elements;
    },
    new Map<string, HTMLElement>()
  );
};

export const applyMarqueeShotSelection = (
  elements: ReadonlyMap<string, HTMLElement>,
  previousShotIds: string[],
  nextShotIds: string[]
) => {
  const changes = marqueeSelectionClassChanges(previousShotIds, nextShotIds);

  changes.remove.forEach((shotId) => {
    elements.get(shotId)?.classList.remove("is-marquee-selected");
  });
  changes.add.forEach((shotId) => {
    elements.get(shotId)?.classList.add("is-marquee-selected");
  });
};

export const clearCommittedMarqueeShotSelection = (
  elements: ReadonlyMap<string, HTMLElement>,
  selectedShotIds: string[]
) => {
  marqueeDisplayedSelectionIds(selectedShotIds).forEach((shotId) => {
    elements.get(shotId)?.classList.remove("is-selected");
  });
};

export const applySelectedShotCountLabel = (element: HTMLSpanElement | null, selectedCount: number) => {
  if (element) {
    element.textContent = `${selectedCount} selected`;
  }
};

export const applySelectionMarqueeStyle = (element: HTMLDivElement | null, box: MarqueeBox) => {
  if (!element) {
    return;
  }

  const rect = marqueeViewportRect(box);
  element.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
  element.style.width = `${rect.width}px`;
  element.style.height = `${rect.height}px`;
};

export const showSelectionMarquee = (element: HTMLDivElement | null, box: MarqueeBox) => {
  if (!element) {
    return;
  }

  applySelectionMarqueeStyle(element, box);
  element.classList.add("is-active");
};

export const hideSelectionMarquee = (element: HTMLDivElement | null) => {
  if (!element) {
    return;
  }

  element.classList.remove("is-active");
  element.style.removeProperty("transform");
  element.style.removeProperty("width");
  element.style.removeProperty("height");
};
