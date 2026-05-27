type ElementRectLike = {
  top: number;
  bottom: number;
  height: number;
};

type ElementTopLike = {
  top: number;
};

type ReservedViewport = {
  height: number;
  reservedBottom: number;
  margin: number;
};

export const scrollDeltaForReservedViewport = (
  rect: ElementRectLike,
  viewport: ReservedViewport
): number => {
  const usableBottom = viewport.height - viewport.reservedBottom - viewport.margin;
  const usableHeight = usableBottom - viewport.margin;

  if (rect.height > usableHeight) {
    return rect.top - viewport.margin;
  }

  if (rect.bottom > usableBottom) {
    return rect.bottom - usableBottom;
  }

  if (rect.top < viewport.margin) {
    return rect.top - viewport.margin;
  }

  return 0;
};

export const scrollDeltaToAlignTop = (rect: ElementTopLike, targetTop: number): number => {
  return rect.top - targetTop;
};

export const scrollDeltaToCenterInReservedViewport = (
  rect: ElementRectLike,
  viewport: ReservedViewport
): number => {
  const usableBottom = viewport.height - viewport.reservedBottom - viewport.margin;
  const usableHeight = usableBottom - viewport.margin;
  const centeredTop = viewport.margin + Math.max(0, (usableHeight - rect.height) / 2);

  return Math.round(rect.top - centeredTop);
};
