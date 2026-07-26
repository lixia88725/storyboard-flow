import { useCallback, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from "react";

type MutableRef<T> = {
  current: T;
};

type BoardPanPointerDown = {
  button: number;
  clientX: number;
  clientY: number;
  currentTarget: HTMLElement;
  target: EventTarget | null;
  preventDefault: () => void;
  stopPropagation: () => void;
};

type BoardPanPointerMove = {
  clientX: number;
  clientY: number;
  preventDefault?: () => void;
};

type BoardPanListenerOptions =
  | boolean
  | {
      capture?: boolean;
      once?: boolean;
      passive?: boolean;
    };

type BoardPanEventTarget = {
  addEventListener: (
    type: "pointermove" | "pointerup" | "pointercancel",
    listener: (event: BoardPanPointerMove) => void,
    options?: BoardPanListenerOptions
  ) => void;
  removeEventListener: (
    type: "pointermove" | "pointerup" | "pointercancel",
    listener: (event: BoardPanPointerMove) => void,
    options?: BoardPanListenerOptions
  ) => void;
};

type ShouldStartBoardPanOptions = Pick<BoardPanPointerDown, "button" | "currentTarget" | "target"> & {
  isSpacePanActive: boolean;
};

type StartBoardPanDragOptions = {
  event: BoardPanPointerDown;
  eventTarget: BoardPanEventTarget;
  isSpacePanActive: boolean;
  scrollBoardBy: (options: ScrollToOptions) => void;
  setIsBoardPanning: (isPanning: boolean) => void;
  shouldContinuePan?: () => boolean;
};

type UseBoardPanControllerOptions = {
  isSpacePanActiveRef: MutableRef<boolean>;
  scrollBoardBy: (options: ScrollToOptions) => void;
  setIsBoardPanning: Dispatch<SetStateAction<boolean>>;
  workspaceBoardScrollRef: RefObject<HTMLElement | null>;
};

const boardPanBlockedTargetSelector = [
  "input",
  "textarea",
  "select",
  "button",
  "[contenteditable='true']",
  ".layer-panel",
  ".radial-tool-menu",
  ".topbar",
  ".bottom-bar",
  ".ai-draft-panel"
].join(", ");

export const shouldStartBoardPan = ({
  button,
  currentTarget,
  isSpacePanActive,
  target
}: ShouldStartBoardPanOptions): boolean => {
  if (!isSpacePanActive || button !== 0) {
    return false;
  }

  if (target === currentTarget) {
    return true;
  }

  const closest = (target as { closest?: (selector: string) => Element | null } | null)?.closest;
  return typeof closest === "function" ? !closest.call(target, boardPanBlockedTargetSelector) : true;
};

export const boardPanScrollDelta = ({
  fromX,
  fromY,
  toX,
  toY
}: {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
}): { left: number; top: number } => ({
  left: fromX - toX,
  top: fromY - toY
});

export const startBoardPanDrag = ({
  event,
  eventTarget,
  isSpacePanActive,
  scrollBoardBy,
  setIsBoardPanning,
  shouldContinuePan
}: StartBoardPanDragOptions): void => {
  if (!shouldStartBoardPan({ ...event, isSpacePanActive })) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setIsBoardPanning(true);

  let previousPointer = { clientX: event.clientX, clientY: event.clientY };

  const handlePointerMove = (moveEvent: BoardPanPointerMove) => {
    if (shouldContinuePan && !shouldContinuePan()) {
      finishPan();
      return;
    }

    moveEvent.preventDefault?.();
    const delta = boardPanScrollDelta({
      fromX: previousPointer.clientX,
      fromY: previousPointer.clientY,
      toX: moveEvent.clientX,
      toY: moveEvent.clientY
    });
    previousPointer = { clientX: moveEvent.clientX, clientY: moveEvent.clientY };
    scrollBoardBy({ left: delta.left, top: delta.top, behavior: "auto" });
  };

  const finishPan = () => {
    setIsBoardPanning(false);
    eventTarget.removeEventListener("pointermove", handlePointerMove, true);
    eventTarget.removeEventListener("pointerup", finishPan, true);
    eventTarget.removeEventListener("pointercancel", finishPan, true);
  };

  eventTarget.addEventListener("pointermove", handlePointerMove, {
    capture: true,
    passive: false
  });
  eventTarget.addEventListener("pointerup", finishPan, { capture: true, once: true });
  eventTarget.addEventListener("pointercancel", finishPan, { capture: true, once: true });
};

export const useBoardPanController = ({
  isSpacePanActiveRef,
  scrollBoardBy,
  setIsBoardPanning,
  workspaceBoardScrollRef
}: UseBoardPanControllerOptions) => {
  const handleBoardPanPointerDownCapture = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      startBoardPanDrag({
        event: {
          button: event.button,
          clientX: event.clientX,
          clientY: event.clientY,
          currentTarget: event.currentTarget,
          target: event.target,
          preventDefault: () => event.preventDefault(),
          stopPropagation: () => event.stopPropagation()
        },
        eventTarget: window,
        isSpacePanActive: isSpacePanActiveRef.current,
        scrollBoardBy,
        setIsBoardPanning,
        shouldContinuePan: () => isSpacePanActiveRef.current
      });
      if (isSpacePanActiveRef.current) {
        workspaceBoardScrollRef.current?.focus?.();
      }
    },
    [isSpacePanActiveRef, scrollBoardBy, setIsBoardPanning, workspaceBoardScrollRef]
  );

  return { handleBoardPanPointerDownCapture };
};
