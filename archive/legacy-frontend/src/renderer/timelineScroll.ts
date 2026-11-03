type TimelineScrollRect = {
  left: number;
  right: number;
  width: number;
};

type TimelineScrollTargetOptions = {
  containerRect: TimelineScrollRect;
  itemRect: TimelineScrollRect;
  scrollLeft: number;
  maxScrollLeft?: number;
  margin?: number;
};

export const timelineScrollTarget = ({
  containerRect,
  itemRect,
  scrollLeft,
  maxScrollLeft = Number.POSITIVE_INFINITY,
  margin = 8
}: TimelineScrollTargetOptions): number | undefined => {
  const visibleLeft = containerRect.left + margin;
  const visibleRight = containerRect.right - margin;

  if (itemRect.left >= visibleLeft && itemRect.right <= visibleRight) {
    return undefined;
  }

  const containerCenter = containerRect.left + containerRect.width / 2;
  const itemCenter = itemRect.left + itemRect.width / 2;
  const target = Math.round(scrollLeft + itemCenter - containerCenter);

  return Math.min(maxScrollLeft, Math.max(0, target));
};
