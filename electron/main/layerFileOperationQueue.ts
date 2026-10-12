import { AsyncLocalStorage } from "node:async_hooks";

// One layer-file queue deliberately avoids multi-resource lock ordering. Hold it
// across reads, composition, commit and source cleanup, not just the final write.
const context = new AsyncLocalStorage<{ active: boolean; committed: boolean }>();
let pending: Promise<unknown> = Promise.resolve();

export const recordLayerFileCommit = (): void => {
  const scope = context.getStore();
  if (scope?.active) scope.committed = true;
};

export const layerFileOperationCommitted = (): boolean => Boolean(context.getStore()?.committed);

export const withLayerFileOperation = <T>(operation: () => Promise<T>): Promise<T> => {
  if (context.getStore()?.active) return operation();
  const run = pending.then(() => {
    const scope = { active: true, committed: false };
    return context.run(scope, async () => {
      try { return await operation(); } finally { scope.active = false; }
    });
  });
  pending = run.then(() => undefined, () => undefined);
  return run;
};
