export type OnionSkinNeighbor<T> = {
  previous?: T;
  next?: T;
};

export const getOnionSkinNeighbors = <T extends { id: string }>(
  items: T[],
  currentId: string | undefined,
  enabled: boolean
): OnionSkinNeighbor<T> => {
  if (!enabled || !currentId) {
    return {};
  }

  const currentIndex = items.findIndex((item) => item.id === currentId);
  if (currentIndex === -1) {
    return {};
  }

  return {
    previous: currentIndex > 0 ? items[currentIndex - 1] : undefined,
    next: currentIndex < items.length - 1 ? items[currentIndex + 1] : undefined
  };
};
