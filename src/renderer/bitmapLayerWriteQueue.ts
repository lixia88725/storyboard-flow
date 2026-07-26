export type BitmapLayerWriteQueue = {
  enqueue: <T>(bitmapPath: string, task: () => Promise<T>) => Promise<T>;
  drain: (bitmapPath?: string) => Promise<void>;
  runExclusive: <T>(task: () => Promise<T>) => Promise<T>;
};

export const createBitmapLayerWriteQueue = (): BitmapLayerWriteQueue => {
  const queues = new Map<string, Promise<unknown>>();
  let exclusiveTail: Promise<unknown> | undefined;

  const enqueue = async <T>(bitmapPath: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(bitmapPath) ?? Promise.resolve();
    const exclusive = exclusiveTail;
    const next = exclusive
      ? Promise.all([
          previous.catch(() => undefined),
          exclusive.catch(() => undefined)
        ]).then(task)
      : previous.catch(() => undefined).then(task);
    const queued = next.catch(() => undefined);
    queues.set(bitmapPath, queued);

    try {
      return await next;
    } finally {
      if (queues.get(bitmapPath) === queued) {
        queues.delete(bitmapPath);
      }
    }
  };

  const drain = async (bitmapPath?: string) => {
    await exclusiveTail;
    if (bitmapPath) {
      await queues.get(bitmapPath);
      return;
    }

    await Promise.all([...queues.values()]);
  };

  const runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const previousExclusive = exclusiveTail;
    const pendingWrites = [...queues.values()];
    const action = (previousExclusive ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => Promise.all(pendingWrites))
      .then(task);
    const tracked = action.catch(() => undefined);
    exclusiveTail = tracked;
    void tracked.finally(() => {
      if (exclusiveTail === tracked) {
        exclusiveTail = undefined;
      }
    });
    return action;
  };

  return { enqueue, drain, runExclusive };
};
