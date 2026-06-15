export const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<R>,
  onItemComplete?: () => void
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = await run(items[index]);
        } finally {
          onItemComplete?.();
        }
      }
    })
  );

  return results;
};
