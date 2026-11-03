import type { DragEndEvent } from "@dnd-kit/core";
import { isPointerInsideRect } from "./storyboardDnd";

export const isPointerInsideElement = (
  element: HTMLElement | null,
  pointer: { x: number; y: number }
): boolean => {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return isPointerInsideRect(rect, pointer);
};

export const dragEndInsideSelector = (
  event: DragEndEvent,
  selector: string,
  pointerPosition?: { x: number; y: number }
): boolean => {
  const activeRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
  const target = document.querySelector<HTMLElement>(selector);
  if ((!activeRect && !pointerPosition) || !target) {
    return false;
  }

  const targetRect = target.getBoundingClientRect();
  if (pointerPosition) {
    const pointedElement = document.elementFromPoint(pointerPosition.x, pointerPosition.y);
    if (pointedElement instanceof HTMLElement && pointedElement.closest(selector)) {
      return true;
    }
  }

  if (
    activeRect &&
    activeRect.right >= targetRect.left &&
    activeRect.left <= targetRect.right &&
    activeRect.bottom >= targetRect.top &&
    activeRect.top <= targetRect.bottom
  ) {
    return true;
  }

  const point = pointerPosition ?? {
    x: activeRect!.left + activeRect!.width / 2,
    y: activeRect!.top + activeRect!.height / 2
  };
  return (
    point.x >= targetRect.left &&
    point.x <= targetRect.right &&
    point.y >= targetRect.top &&
    point.y <= targetRect.bottom
  );
};
