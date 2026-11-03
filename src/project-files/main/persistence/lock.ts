/** Process-wide serialization of writes to one project root.
 *
 * The key is the canonical root path, so two store instances (createProjectStore
 * is cheap) still queue behind each other, while independent roots run in
 * parallel. This is an in-process queue only: it makes no claim about two
 * processes writing the same root. */
function rootQueue() {
  const queues = new Map<string, Promise<void>>();
  function run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(key) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    queues.set(key, tail);
    void tail.then(() => {
      if (queues.get(key) === tail) queues.delete(key);
    });
    return result;
  }
  return { run, size: () => queues.size };
}

// Checkpoints publish in order. Asset operations share the shorter queue so a
// new stroke can publish its immutable PNG between two checkpoint asset checks.
const checkpoints = rootQueue();
const writes = rootQueue();
export const withCheckpointLock = checkpoints.run;
export const withRootLock = writes.run;
export const pendingRootCount = checkpoints.size;
