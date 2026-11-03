import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export type PasteAnimationKind = "shot" | "layer";

export type PasteAnimationState = {
  kind: PasteAnimationKind;
  sourceId: string;
  pastedId: string;
  beforeRects: Map<string, DOMRect>;
};

type MutableRef<T> = {
  current: T;
};

type PasteAnimationQueryRoot = {
  querySelectorAll: (selector: string) => ArrayLike<HTMLElement> | Iterable<HTMLElement>;
};

type PasteAnimationScheduler = Pick<
  Window,
  "cancelAnimationFrame" | "clearTimeout" | "requestAnimationFrame" | "setTimeout"
>;

const pasteAnimationTransition = "transform 190ms cubic-bezier(0.2, 0.8, 0.2, 1)";
const pasteAnimationCleanupMs = 240;

export const pasteAnimationSelector = (kind: PasteAnimationKind): string =>
  kind === "shot" ? "[data-shot-id]" : "[data-layer-id]";

export const pasteAnimationIdForElement = (
  element: HTMLElement,
  kind: PasteAnimationKind
): string | undefined =>
  kind === "shot" ? element.dataset.shotId : element.dataset.layerId;

export const measurePasteAnimationRects = (
  kind: PasteAnimationKind,
  root: PasteAnimationQueryRoot = document
): Map<string, DOMRect> => {
  const rects = new Map<string, DOMRect>();
  for (const element of Array.from(root.querySelectorAll(pasteAnimationSelector(kind)))) {
    const id = pasteAnimationIdForElement(element, kind);
    if (id) {
      rects.set(id, element.getBoundingClientRect());
    }
  }
  return rects;
};

const resetPasteAnimationStyles = (root: PasteAnimationQueryRoot = document) => {
  for (const element of Array.from(root.querySelectorAll("[data-shot-id], [data-layer-id]"))) {
    element.style.removeProperty("transform");
    element.style.removeProperty("transition");
    element.style.removeProperty("will-change");
  }
};

export const clearPasteAnimation = (
  frameRef: { current: number | undefined },
  timeoutRef: { current: number | undefined },
  root: PasteAnimationQueryRoot = document,
  scheduler: PasteAnimationScheduler = window
) => {
  if (frameRef.current !== undefined) {
    scheduler.cancelAnimationFrame(frameRef.current);
    frameRef.current = undefined;
  }

  if (timeoutRef.current !== undefined) {
    scheduler.clearTimeout(timeoutRef.current);
    timeoutRef.current = undefined;
  }

  resetPasteAnimationStyles(root);
};

export const applyPasteAnimation = (
  animation: PasteAnimationState,
  frameRef: { current: number | undefined },
  timeoutRef: { current: number | undefined },
  root: PasteAnimationQueryRoot = document,
  scheduler: PasteAnimationScheduler = window
) => {
  clearPasteAnimation(frameRef, timeoutRef, root, scheduler);

  const sourceRect = animation.beforeRects.get(animation.sourceId);
  const movedElements: HTMLElement[] = [];
  for (const element of Array.from(root.querySelectorAll(pasteAnimationSelector(animation.kind)))) {
    const id = pasteAnimationIdForElement(element, animation.kind);
    const fromRect =
      id === animation.pastedId && sourceRect ? sourceRect : id ? animation.beforeRects.get(id) : undefined;
    if (!fromRect) {
      continue;
    }

    const afterRect = element.getBoundingClientRect();
    const deltaX = fromRect.left - afterRect.left;
    const deltaY = fromRect.top - afterRect.top;
    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      continue;
    }

    element.style.transition = "none";
    element.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    element.style.willChange = "transform";
    movedElements.push(element);
  }

  if (movedElements.length === 0) {
    return;
  }

  frameRef.current = scheduler.requestAnimationFrame(() => {
    frameRef.current = undefined;
    for (const element of movedElements) {
      element.style.transition = pasteAnimationTransition;
      element.style.transform = "";
    }

    timeoutRef.current = scheduler.setTimeout(() => {
      timeoutRef.current = undefined;
      for (const element of movedElements) {
        element.style.removeProperty("transform");
        element.style.removeProperty("transition");
        element.style.removeProperty("will-change");
      }
    }, pasteAnimationCleanupMs);
  });
};

export const queuePasteAnimation = ({
  animationRef,
  clearAnimation = clearPasteAnimation,
  frameRef,
  kind,
  measureRects = measurePasteAnimationRects,
  pastedId,
  sourceId,
  timeoutRef
}: {
  animationRef: MutableRef<PasteAnimationState | undefined>;
  clearAnimation?: (
    frameRef: MutableRef<number | undefined>,
    timeoutRef: MutableRef<number | undefined>
  ) => void;
  frameRef: MutableRef<number | undefined>;
  kind: PasteAnimationKind;
  measureRects?: (kind: PasteAnimationKind) => Map<string, DOMRect>;
  pastedId: string;
  sourceId: string;
  timeoutRef: MutableRef<number | undefined>;
}) => {
  clearAnimation(frameRef, timeoutRef);
  animationRef.current = {
    kind,
    sourceId,
    pastedId,
    beforeRects: measureRects(kind)
  };
};

export const usePasteAnimationController = (refreshKey: unknown) => {
  const animationRef = useRef<PasteAnimationState | undefined>(undefined);
  const frameRef = useRef<number | undefined>(undefined);
  const timeoutRef = useRef<number | undefined>(undefined);

  useLayoutEffect(() => {
    const animation = animationRef.current;
    if (!animation) {
      return;
    }

    animationRef.current = undefined;
    applyPasteAnimation(animation, frameRef, timeoutRef);
  }, [refreshKey]);

  useEffect(
    () => () => clearPasteAnimation(frameRef, timeoutRef),
    []
  );

  const queueAnimation = useCallback(
    (kind: PasteAnimationKind, sourceId: string, pastedId: string) => {
      queuePasteAnimation({
        animationRef,
        frameRef,
        kind,
        pastedId,
        sourceId,
        timeoutRef
      });
    },
    []
  );

  return { queueAnimation };
};
