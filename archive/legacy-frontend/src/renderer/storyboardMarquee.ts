export type MarqueeBox = {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startScrollX: number;
  startScrollY: number;
  currentScrollX: number;
  currentScrollY: number;
};

type MarqueePoint = {
  clientX: number;
  clientY: number;
  scrollX: number;
  scrollY: number;
};

export type MarqueeShotRect = {
  shotId: string;
  rect: MarqueeBounds;
};

export type MarqueeBounds = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type MarqueeOverlayRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type MarqueeViewportRect = MarqueeOverlayRect;

export type MarqueeHitResult = {
  shotIds: string[];
  rects: MarqueeOverlayRect[];
};

const edgeThresholdPx = 64;
const edgeScrollStepPx = 32;

export const createMarqueeBox = (point: MarqueePoint): MarqueeBox => ({
  startX: point.clientX,
  startY: point.clientY,
  currentX: point.clientX,
  currentY: point.clientY,
  startScrollX: point.scrollX,
  startScrollY: point.scrollY,
  currentScrollX: point.scrollX,
  currentScrollY: point.scrollY
});

export const updateMarqueeBox = (box: MarqueeBox, point: MarqueePoint): MarqueeBox => ({
  ...box,
  currentX: point.clientX,
  currentY: point.clientY,
  currentScrollX: point.scrollX,
  currentScrollY: point.scrollY
});

export const marqueeViewportRect = (box: MarqueeBox) => {
  const left = Math.min(box.startX + box.startScrollX, box.currentX + box.currentScrollX);
  const right = Math.max(box.startX + box.startScrollX, box.currentX + box.currentScrollX);
  const top = Math.min(box.startY + box.startScrollY, box.currentY + box.currentScrollY);
  const bottom = Math.max(box.startY + box.startScrollY, box.currentY + box.currentScrollY);

  return {
    left: left - box.currentScrollX,
    top: top - box.currentScrollY,
    width: right - left,
    height: bottom - top
  };
};

export const marqueeOverlayBoxRect = (
  box: MarqueeBox,
  viewport: Pick<MarqueeViewportRect, "left" | "top">
): MarqueeOverlayRect => {
  const rect = marqueeViewportRect(box);
  return {
    left: rect.left - viewport.left,
    top: rect.top - viewport.top,
    width: rect.width,
    height: rect.height
  };
};

export const marqueeEdgeScrollDelta = ({
  pointerY,
  viewportTop = 0,
  viewportHeight
}: {
  pointerY: number;
  viewportTop?: number;
  viewportHeight: number;
}) => {
  const pointerViewportY = pointerY - viewportTop;
  if (pointerViewportY < edgeThresholdPx) {
    return -edgeScrollStepPx;
  }

  if (pointerViewportY > viewportHeight - edgeThresholdPx) {
    return edgeScrollStepPx;
  }

  return 0;
};

export const shotIdsInMarqueeBox = (box: MarqueeBox, shots: MarqueeShotRect[]) => {
  const left = Math.min(box.startX + box.startScrollX, box.currentX + box.currentScrollX);
  const right = Math.max(box.startX + box.startScrollX, box.currentX + box.currentScrollX);
  const top = Math.min(box.startY + box.startScrollY, box.currentY + box.currentScrollY);
  const bottom = Math.max(box.startY + box.startScrollY, box.currentY + box.currentScrollY);

  return shots
    .filter(({ rect }) => rect.left < right && rect.right > left && rect.top < bottom && rect.bottom > top)
    .map(({ shotId }) => shotId);
};

export const marqueeHitsInBox = (
  box: MarqueeBox,
  shots: readonly MarqueeShotRect[],
  currentScroll: { x: number; y: number },
  viewport: Pick<MarqueeViewportRect, "left" | "top">
): MarqueeHitResult => {
  const left = Math.min(box.startX + box.startScrollX, box.currentX + box.currentScrollX);
  const right = Math.max(box.startX + box.startScrollX, box.currentX + box.currentScrollX);
  const top = Math.min(box.startY + box.startScrollY, box.currentY + box.currentScrollY);
  const bottom = Math.max(box.startY + box.startScrollY, box.currentY + box.currentScrollY);
  const shotIds: string[] = [];
  const rects: MarqueeOverlayRect[] = [];

  for (const shot of shots) {
    const { rect } = shot;
    if (rect.left >= right || rect.right <= left || rect.top >= bottom || rect.bottom <= top) {
      continue;
    }
    shotIds.push(shot.shotId);
    rects.push({
      left: rect.left - currentScroll.x - viewport.left,
      top: rect.top - currentScroll.y - viewport.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top
    });
  }

  return { shotIds, rects };
};

export const sameMarqueeSelection = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);
