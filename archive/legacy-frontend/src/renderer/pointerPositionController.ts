import { useEffect, type MutableRefObject } from "react";

export type PointerPosition = {
  x: number;
  y: number;
};

type PointerPositionEventTarget = {
  addEventListener: (
    type: string,
    listener: (event: globalThis.PointerEvent | globalThis.MouseEvent) => void
  ) => void;
  removeEventListener: (
    type: string,
    listener: (event: globalThis.PointerEvent | globalThis.MouseEvent) => void
  ) => void;
};

export const registerPointerPositionListeners = (
  target: PointerPositionEventTarget,
  lastPointerPositionRef: MutableRefObject<PointerPosition | undefined>
): (() => void) => {
  const handlePointerMove = (event: globalThis.PointerEvent | globalThis.MouseEvent) => {
    lastPointerPositionRef.current = { x: event.clientX, y: event.clientY };
  };

  target.addEventListener("pointermove", handlePointerMove);
  target.addEventListener("mousemove", handlePointerMove);
  target.addEventListener("pointerup", handlePointerMove);
  target.addEventListener("mouseup", handlePointerMove);

  return () => {
    target.removeEventListener("pointermove", handlePointerMove);
    target.removeEventListener("mousemove", handlePointerMove);
    target.removeEventListener("pointerup", handlePointerMove);
    target.removeEventListener("mouseup", handlePointerMove);
  };
};

export const usePointerPositionController = (
  lastPointerPositionRef: MutableRefObject<PointerPosition | undefined>
): void => {
  useEffect(() => registerPointerPositionListeners(window, lastPointerPositionRef), [lastPointerPositionRef]);
};
