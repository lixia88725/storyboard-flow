export const mapWithConcurrency = async <T, R>(
  items: T[],
  concurrency: number,
  run: (item: T) => Promise<R>,
  onItemComplete?: () => void
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, Math.floor(concurrency)), items.length);
  const failures: unknown[] = [];

  // A worker rejection is not the end of its siblings' effects. Stop claiming
  // new work on the first observed failure, then drain all started tasks before
  // allowing callers to compensate files or release their exclusive queue.
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (failures.length === 0 && nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        try {
          results[index] = await run(items[index]);
        } catch (error) {
          failures.push(error);
        }
        try {
          onItemComplete?.();
        } catch (error) {
          failures.push(error);
        }
      }
    })
  );

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Parallel work failed after all started effects settled");
  return results;
};
