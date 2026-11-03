export type ZoomClientPoint = {
  x: number;
  y: number;
};

export type ZoomAnchorSnapshot = {
  shotId: string;
  localXRatio: number;
  localYRatio: number;
  clientX: number;
  clientY: number;
};

type RectLike = {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
};

type PictureElementLike = {
  getBoundingClientRect: () => RectLike;
};

type ShotElementLike = {
  dataset: { shotId?: string };
  getBoundingClientRect: () => RectLike;
  querySelector: (selector: string) => PictureElementLike | null;
};

type BoardElementLike = {
  querySelector?: (selector: string) => ShotElementLike | null;
  querySelectorAll: (selector: string) => Iterable<ShotElementLike> | ArrayLike<ShotElementLike>;
};

type ScrollContainerLike = {
  getBoundingClientRect: () => RectLike;
  scrollBy: (options: ScrollToOptions) => void;
};

type CaptureStoryboardZoomAnchorOptions = {
  board: BoardElementLike | null;
  clientPoint?: ZoomClientPoint;
  scrollContainer: ScrollContainerLike | null;
  selectedShotIds: string[];
};

type RestoreStoryboardZoomAnchorOptions = {
  anchor: ZoomAnchorSnapshot | undefined;
  board: BoardElementLike | null;
  scrollContainer: ScrollContainerLike | null;
};

const pictureSelector = ".image-stage";
export const storyboardZoomSafeViewportInset = 16;

const toArray = <T>(items: Iterable<T> | ArrayLike<T>): T[] => Array.from(items);

const containsPoint = (rect: RectLike, point: ZoomClientPoint): boolean =>
  point.x >= rect.left &&
  point.x <= rect.right &&
  point.y >= rect.top &&
  point.y <= rect.bottom;

const intersectsRect = (rect: RectLike, viewport: RectLike): boolean =>
  rect.right > viewport.left &&
  rect.left < viewport.right &&
  rect.bottom > viewport.top &&
  rect.top < viewport.bottom;

const distanceSquaredToRectCenter = (rect: RectLike, point: ZoomClientPoint): number => {
  const dx = rect.left + rect.width / 2 - point.x;
  const dy = rect.top + rect.height / 2 - point.y;
  return dx * dx + dy * dy;
};

const clampRatio = (value: number): number => Math.min(1, Math.max(0, value));
const clampToSafeViewportAxis = (
  value: number,
  viewportStart: number,
  viewportEnd: number,
  inset: number
): number => {
  const safeStart = Math.min(viewportEnd, viewportStart + inset);
  const safeEnd = Math.max(safeStart, viewportEnd - inset);
  return Math.min(Math.max(value, safeStart), safeEnd);
};

const pictureEntryForShot = (shot: ShotElementLike) => {
  const picture = shot.querySelector(pictureSelector);
  const shotId = shot.dataset.shotId;
  if (!picture || !shotId) {
    return undefined;
  }

  const rect = picture.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return undefined;
  }

  return { picture, rect, shotId };
};

const snapshotFromEntry = (
  entry: NonNullable<ReturnType<typeof pictureEntryForShot>>,
  point?: ZoomClientPoint
): ZoomAnchorSnapshot => {
  const clientX = point?.x ?? entry.rect.left + entry.rect.width / 2;
  const clientY = point?.y ?? entry.rect.top + entry.rect.height / 2;
  return {
    shotId: entry.shotId,
    localXRatio: clampRatio((clientX - entry.rect.left) / entry.rect.width),
    localYRatio: clampRatio((clientY - entry.rect.top) / entry.rect.height),
    clientX,
    clientY
  };
};

const pictureEntryForAnchor = (
  board: BoardElementLike,
  anchor: ZoomAnchorSnapshot
) => {
  const escapedShotId = anchor.shotId.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const directShot = board.querySelector?.(`[data-shot-id="${escapedShotId}"]`);
  if (directShot) {
    return pictureEntryForShot(directShot);
  }

  const matchingShot = toArray(board.querySelectorAll("[data-shot-id]")).find(
    (shot) => shot.dataset.shotId === anchor.shotId
  );
  return matchingShot ? pictureEntryForShot(matchingShot) : undefined;
};

export const captureStoryboardZoomAnchor = ({
  board,
  clientPoint,
  scrollContainer,
  selectedShotIds
}: CaptureStoryboardZoomAnchorOptions): ZoomAnchorSnapshot | undefined => {
  if (!board || !scrollContainer) {
    return undefined;
  }

  const viewport = scrollContainer.getBoundingClientRect();
  const entries = toArray(board.querySelectorAll("[data-shot-id]"))
    .map(pictureEntryForShot)
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const selectedIds = new Set(selectedShotIds);

  if (clientPoint) {
    const pointedSelection = entries.find(
      (entry) => selectedIds.has(entry.shotId) && containsPoint(entry.rect, clientPoint)
    );
    if (pointedSelection) {
      return snapshotFromEntry(pointedSelection, clientPoint);
    }
  }

  const primarySelection = entries.find(
    (entry) => entry.shotId === selectedShotIds[0] && intersectsRect(entry.rect, viewport)
  );
  if (primarySelection) {
    return snapshotFromEntry(primarySelection);
  }

  if (clientPoint) {
    const pointedPicture = entries.find(
      (entry) => intersectsRect(entry.rect, viewport) && containsPoint(entry.rect, clientPoint)
    );
    if (pointedPicture) {
      return snapshotFromEntry(pointedPicture, clientPoint);
    }
  }

  const viewportCenter = {
    x: viewport.left + viewport.width / 2,
    y: viewport.top + viewport.height / 2
  };
  const nearestVisiblePicture = entries
    .filter((entry) => intersectsRect(entry.rect, viewport))
    .sort(
      (a, b) =>
        distanceSquaredToRectCenter(a.rect, viewportCenter) -
        distanceSquaredToRectCenter(b.rect, viewportCenter)
    )[0];

  return nearestVisiblePicture ? snapshotFromEntry(nearestVisiblePicture) : undefined;
};

export const storyboardZoomAnchorScrollDelta = (
  anchor: ZoomAnchorSnapshot,
  targetRect: RectLike
): { left: number; top: number } => ({
  left: targetRect.left + targetRect.width * anchor.localXRatio - anchor.clientX,
  top: targetRect.top + targetRect.height * anchor.localYRatio - anchor.clientY
});

export const storyboardZoomAnchorSafeScrollDelta = (
  anchor: ZoomAnchorSnapshot,
  targetRect: RectLike,
  viewport: RectLike,
  inset = storyboardZoomSafeViewportInset
): { left: number; top: number } => {
  const anchorX = targetRect.left + targetRect.width * anchor.localXRatio;
  const anchorY = targetRect.top + targetRect.height * anchor.localYRatio;
  return {
    left:
      anchorX -
      clampToSafeViewportAxis(anchorX, viewport.left, viewport.right, inset),
    top:
      anchorY -
      clampToSafeViewportAxis(anchorY, viewport.top, viewport.bottom, inset)
  };
};

export const restoreStoryboardZoomAnchor = ({
  anchor,
  board,
  scrollContainer
}: RestoreStoryboardZoomAnchorOptions): { left: number; top: number } | undefined => {
  if (!anchor || !board || !scrollContainer) {
    return undefined;
  }

  const target = pictureEntryForAnchor(board, anchor);
  if (!target) {
    return undefined;
  }

  const delta = storyboardZoomAnchorScrollDelta(anchor, target.rect);
  if (!Number.isFinite(delta.left) || !Number.isFinite(delta.top)) {
    return undefined;
  }

  if (Math.abs(delta.left) >= 0.25 || Math.abs(delta.top) >= 0.25) {
    scrollContainer.scrollBy({
      left: delta.left,
      top: delta.top,
      behavior: "auto"
    });
  }

  const restoredTarget = pictureEntryForAnchor(board, anchor);
  if (restoredTarget) {
    const safeDelta = storyboardZoomAnchorSafeScrollDelta(
      anchor,
      restoredTarget.rect,
      scrollContainer.getBoundingClientRect()
    );
    if (Math.abs(safeDelta.left) >= 0.25 || Math.abs(safeDelta.top) >= 0.25) {
      scrollContainer.scrollBy({
        left: safeDelta.left,
        top: safeDelta.top,
        behavior: "auto"
      });
    }
  }

  return delta;
};
