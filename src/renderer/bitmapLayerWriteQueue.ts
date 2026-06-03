export type BitmapLayerWriteQueue = {
  enqueue: <T>(bitmapPath: string, task: () => Promise<T>) => Promise<T>;
  drain: (bitmapPath?: string) => Promise<void>;
};

export const createBitmapLayerWriteQueue = (): BitmapLayerWriteQueue => {
  const queues = new Map<string, Promise<unknown>>();

  const enqueue = async <T>(bitmapPath: string, task: () => Promise<T>): Promise<T> => {
    const previous = queues.get(bitmapPath) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
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
    if (bitmapPath) {
      await queues.get(bitmapPath);
      return;
    }

    await Promise.all([...queues.values()]);
  };

  return { enqueue, drain };
};
