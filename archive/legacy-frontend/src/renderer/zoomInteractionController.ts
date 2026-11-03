import { useEffect } from "react";

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

export type ZoomInteractionControllerOptions = {
  endZoomScrubbing: () => void;
  isZoomScrubbing: boolean;
};

export const useZoomInteractionController = ({
  endZoomScrubbing,
  isZoomScrubbing
}: ZoomInteractionControllerOptions): void => {
  useEffect(() => {
    if (!isZoomScrubbing) {
      return;
    }

    return registerZoomScrubEndListeners(window, endZoomScrubbing);
  }, [endZoomScrubbing, isZoomScrubbing]);
};
