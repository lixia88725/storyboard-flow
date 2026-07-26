import {
  useCallback,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent
} from "react";
import { normalizeStoryboardZoom } from "./animationViewport";
import type { ZoomClientPoint } from "./storyboardZoomAnchorController";

type ZDragZoomPointerDown = {
  button: number;
  clientX: number;
  clientY: number;
  currentTarget: HTMLElement;
  isPrimary: boolean;
  pointerId: number;
  pointerType: string;
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
};

type ShouldStartZDragZoomOptions = Pick<
  ZDragZoomPointerDown,
  "button" | "currentTarget" | "isPrimary" | "pointerType" | "target"
> & {
  isZZoomActive: boolean;
};

type StartZDragZoomOptions = {
  beginZoomScrubbing: (clientPoint?: ZoomClientPoint) => void;
  endZoomScrubbing: () => void;
  event: ZDragZoomPointerDown;
  eventTarget: EventTarget;
  getZoomLevel: () => number;
  handleZoomInputChange: (zoom: number) => void;
  isZZoomActive: boolean;
  shouldContinueZoom?: () => boolean;
};

type UseZDragZoomControllerOptions = {
  beginZoomScrubbing: (clientPoint?: ZoomClientPoint) => void;
  endZoomScrubbing: () => void;
  handleZoomInputChange: (zoom: number) => void;
  zZoomActiveRef: MutableRefObject<boolean>;
  zoomLevelRef: MutableRefObject<number>;
};

const zDragZoomBlockedTargetSelector = [
  "input",
  "textarea",
  "select",
  "button",
  "a",
  "[contenteditable='true']",
  ".layer-panel",
  ".radial-tool-menu",
  ".bottom-bar",
  ".ai-draft-panel"
].join(", ");

export const zDragZoomPixelsPerStep = 10;
export const zDragZoomPercentPerStep = 5;

export const shouldStartZDragZoom = ({
  button,
  currentTarget,
  isPrimary,
  isZZoomActive,
  pointerType,
  target
}: ShouldStartZDragZoomOptions): boolean => {
  if (
    !isZZoomActive ||
    !isPrimary ||
    button !== 0 ||
    (pointerType !== "mouse" && pointerType !== "pen")
  ) {
    return false;
  }

  if (target === currentTarget) {
    return true;
  }

  const closest = (target as { closest?: (selector: string) => Element | null } | null)?.closest;
  return typeof closest === "function"
    ? !closest.call(target, zDragZoomBlockedTargetSelector)
    : true;
};

export const zDragZoomLevel = ({
  currentX,
  startX,
  startZoom
}: {
  currentX: number;
  startX: number;
  startZoom: number;
}): number => {
  const stepCount = Math.trunc((currentX - startX) / zDragZoomPixelsPerStep);
  return normalizeStoryboardZoom(startZoom + stepCount * zDragZoomPercentPerStep);
};

export const startZDragZoom = ({
  beginZoomScrubbing,
  endZoomScrubbing,
  event,
  eventTarget,
  getZoomLevel,
  handleZoomInputChange,
  isZZoomActive,
  shouldContinueZoom
}: StartZDragZoomOptions): boolean => {
  if (!shouldStartZDragZoom({ ...event, isZZoomActive })) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  beginZoomScrubbing({ x: event.clientX, y: event.clientY });

  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startZoom = normalizeStoryboardZoom(getZoomLevel());
  let isFinished = false;

  function finishZoom(): void {
    if (isFinished) {
      return;
    }

    isFinished = true;
    eventTarget.removeEventListener("pointermove", handlePointerMove, true);
    eventTarget.removeEventListener("pointerup", handlePointerEnd, true);
    eventTarget.removeEventListener("pointercancel", handlePointerEnd, true);
    eventTarget.removeEventListener("keyup", handleKeyUp);
    eventTarget.removeEventListener("blur", handleBlur);
    endZoomScrubbing();
  }

  function handlePointerMove(moveEvent: Event): void {
    const pointerEvent = moveEvent as PointerEvent;
    if (pointerEvent.pointerId !== pointerId) {
      return;
    }

    if (shouldContinueZoom && !shouldContinueZoom()) {
      finishZoom();
      return;
    }

    pointerEvent.preventDefault();
    handleZoomInputChange(
      zDragZoomLevel({
        currentX: pointerEvent.clientX,
        startX,
        startZoom
      })
    );
  }

  function handlePointerEnd(endEvent: Event): void {
    if ((endEvent as PointerEvent).pointerId === pointerId) {
      finishZoom();
    }
  }

  function handleKeyUp(keyEvent: Event): void {
    if ((keyEvent as KeyboardEvent).key.toLowerCase() === "z") {
      finishZoom();
    }
  }

  function handleBlur(): void {
    finishZoom();
  }

  eventTarget.addEventListener("pointermove", handlePointerMove, {
    capture: true,
    passive: false
  });
  eventTarget.addEventListener("pointerup", handlePointerEnd, true);
  eventTarget.addEventListener("pointercancel", handlePointerEnd, true);
  eventTarget.addEventListener("keyup", handleKeyUp);
  eventTarget.addEventListener("blur", handleBlur);

  return true;
};

export const useZDragZoomController = ({
  beginZoomScrubbing,
  endZoomScrubbing,
  handleZoomInputChange,
  zZoomActiveRef,
  zoomLevelRef
}: UseZDragZoomControllerOptions) => {
  const handleZDragZoomPointerDownCapture = useCallback(
    (event: ReactPointerEvent<HTMLElement>): boolean => {
      return startZDragZoom({
        beginZoomScrubbing,
        endZoomScrubbing,
        event: {
          button: event.button,
          clientX: event.clientX,
          clientY: event.clientY,
          currentTarget: event.currentTarget,
          isPrimary: event.isPrimary,
          pointerId: event.pointerId,
          pointerType: event.pointerType,
          target: event.target,
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation()
        },
        eventTarget: window,
        getZoomLevel: () => zoomLevelRef.current,
        handleZoomInputChange,
        isZZoomActive: zZoomActiveRef.current,
        shouldContinueZoom: () => zZoomActiveRef.current
      });
    },
    [
      beginZoomScrubbing,
      endZoomScrubbing,
      handleZoomInputChange,
      zZoomActiveRef,
      zoomLevelRef
    ]
  );

  return { handleZDragZoomPointerDownCapture };
};
