/** Process-wide serialization of writes to one project root.
 *
 * The key is the canonical root path, so two store instances (createProjectStore
 * is cheap) still queue behind each other, while independent roots run in
 * parallel. This is an in-process queue only: it makes no claim about two
 * processes writing the same root. */
const queues = new Map<string, Promise<unknown>>();

export const withRootLock = <T>(key: string, operation: () => Promise<T>): Promise<T> => {
  const previous = queues.get(key) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const tail: Promise<unknown> = run.then(
    () => undefined,
    () => undefined
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) queues.delete(key);
  });
  return run;
};

/** Test-only visibility into the queue: how many roots currently have work. */
export const pendingRootCount = (): number => queues.size;
