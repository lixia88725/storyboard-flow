import { useEffect, type MutableRefObject, type RefObject } from "react";
import { nextWheelStoryboardZoom } from "./animationViewport";
import { shouldIgnoreWorkbenchWheelTarget } from "./workbenchWheel";

type ListenerTarget<EventType extends Event> = {
  addEventListener: (
    type: string,
    listener: (event: EventType) => void,
    options?: AddEventListenerOptions | boolean
  ) => void;
  removeEventListener: (type: string, listener: (event: EventType) => void) => void;
};

export const registerZoomScrubEndListeners = (
  target: ListenerTarget<PointerEvent>,
  endZoomScrubbing: () => void
): (() => void) => {
  target.addEventListener("pointerup", endZoomScrubbing, { once: true });
  target.addEventListener("pointercancel", endZoomScrubbing, { once: true });

  return () => {
    target.removeEventListener("pointerup", endZoomScrubbing);
    target.removeEventListener("pointercancel", endZoomScrubbing);
  };
};

export type WorkbenchWheelZoomOptions = {
  currentZoomLevel: () => number;
  nextWheelZoom: (currentZoom: number, deltaY: number) => number;
  scheduleZoomLevel: (zoomLevel: number) => void;
  shouldIgnoreTarget: (target: EventTarget | null) => boolean;
};

export const registerWorkbenchWheelZoomListener = (
  element: ListenerTarget<WheelEvent>,
  options: WorkbenchWheelZoomOptions
): (() => void) => {
  const handleWheel = (event: WheelEvent) => {
    if (options.shouldIgnoreTarget(event.target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    options.scheduleZoomLevel(options.nextWheelZoom(options.currentZoomLevel(), event.deltaY));
  };

  element.addEventListener("wheel", handleWheel, { passive: false });
  return () => element.removeEventListener("wheel", handleWheel);
};

export type ZoomInteractionControllerOptions = {
  appShellRef: RefObject<HTMLElement | null>;
  endZoomScrubbing: () => void;
  isZoomScrubbing: boolean;
  pendingZoomLevelRef: MutableRefObject<number | undefined>;
  scheduleZoomLevel: (zoomLevel: number) => void;
  zoomLevelRef: MutableRefObject<number>;
};

export const useZoomInteractionController = ({
  appShellRef,
  endZoomScrubbing,
  isZoomScrubbing,
  pendingZoomLevelRef,
  scheduleZoomLevel,
  zoomLevelRef
}: ZoomInteractionControllerOptions): void => {
  useEffect(() => {
    if (!isZoomScrubbing) {
      return;
    }

    return registerZoomScrubEndListeners(window, endZoomScrubbing);
  }, [endZoomScrubbing, isZoomScrubbing]);

  useEffect(() => {
    const element = appShellRef.current;
    if (!element) {
      return;
    }

    return registerWorkbenchWheelZoomListener(element, {
      currentZoomLevel: () => pendingZoomLevelRef.current ?? zoomLevelRef.current,
      nextWheelZoom: nextWheelStoryboardZoom,
      scheduleZoomLevel,
      shouldIgnoreTarget: shouldIgnoreWorkbenchWheelTarget
    });
  }, [appShellRef, pendingZoomLevelRef, scheduleZoomLevel, zoomLevelRef]);
};
