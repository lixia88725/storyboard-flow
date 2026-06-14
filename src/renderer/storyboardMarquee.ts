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
  rect: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
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

export const sameMarqueeSelection = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

export const marqueeDisplayedSelectionIds = (shotIds: string[]) => (shotIds.length > 1 ? shotIds : []);

export const marqueeSelectionClassChanges = (previousShotIds: string[], nextShotIds: string[]) => {
  const previousDisplayedShotIds = marqueeDisplayedSelectionIds(previousShotIds);
  const nextDisplayedShotIds = marqueeDisplayedSelectionIds(nextShotIds);
  const nextDisplayedShotIdSet = new Set(nextDisplayedShotIds);
  const previousDisplayedShotIdSet = new Set(previousDisplayedShotIds);

  return {
    add: nextDisplayedShotIds.filter((shotId) => !previousDisplayedShotIdSet.has(shotId)),
    remove: previousDisplayedShotIds.filter((shotId) => !nextDisplayedShotIdSet.has(shotId))
  };
};
