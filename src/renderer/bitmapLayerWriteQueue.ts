export type BitmapLayerWriteQueue = {
  enqueue: <T>(bitmapPath: string, task: () => Promise<T>) => Promise<T>;
  drain: (bitmapPath?: string) => Promise<void>;
  runExclusive: <T>(task: () => Promise<T>) => Promise<T>;
  isBusy?: () => boolean;
};

export const createBitmapLayerWriteQueue = ({ onBusyChange }: {
  // Main acknowledges protection synchronously before any task is scheduled.
  // Queue lifetime, not React effect lifetime, owns this callback.
  onBusyChange?: (busy: boolean) => void;
} = {}): BitmapLayerWriteQueue => {
  const queues = new Map<string, Promise<unknown>>();
  let exclusiveTail: Promise<unknown> | undefined;
  const isBusy = () => !!exclusiveTail || queues.size > 0;
  const admit = () => { if (!isBusy()) onBusyChange?.(true); };
  const releaseIfIdle = () => { if (!isBusy()) onBusyChange?.(false); };

  const enqueue = async <T>(bitmapPath: string, task: () => Promise<T>): Promise<T> => {
    admit();
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
        releaseIfIdle();
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
    try { admit(); } catch (error) { return Promise.reject(error); }
    const previousExclusive = exclusiveTail;
    const pendingWrites = [...queues.values()];
    const action = (previousExclusive ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => Promise.all(pendingWrites))
      .then(task);
    const tracked = action.catch(() => undefined);
    exclusiveTail = tracked;
    const completed = action.finally(() => {
      if (exclusiveTail === tracked) {
        exclusiveTail = undefined;
        releaseIfIdle();
      }
    });
    return completed;
  };

  return { enqueue, drain, runExclusive, isBusy };
};
