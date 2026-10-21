import { AsyncLocalStorage } from 'node:async_hooks';

export type LayerFileObservation = { started: number; errors: unknown[] };
export type ObservedLayerResult<T> = LayerFileObservation & { outcome: { ok: true; value: T } | { ok: false; error: unknown } };
type Scope = LayerFileObservation & { accepting: boolean; closed: boolean; pending: Set<Promise<unknown>> };
const observations = new AsyncLocalStorage<Scope>();
const invocations = new AsyncLocalStorage<{ active: boolean; scope: Scope }>();

/** Main-owned operation observation, not permission or a producer ACK. Drain
 * every already-started child before returning either callback outcome. */
export const observeLayerFileOperations = async <T>(run: () => Promise<T>): Promise<ObservedLayerResult<T>> => {
  const scope: Scope = { accepting: true, closed: false, started: 0, errors: [], pending: new Set() };
  return observations.run(scope, async () => {
    let outcome: ObservedLayerResult<T>['outcome'];
    try { outcome = { ok: true, value: await run() }; }
    catch (error) { outcome = { ok: false, error }; }
    scope.accepting = false;
    while (scope.pending.size) await Promise.allSettled([...scope.pending]);
    scope.closed = true;
    return { started: scope.started, errors: [...scope.errors], outcome };
  });
};
export const trackLayerFileOperation = <T>(run: () => Promise<T>): Promise<T> => {
  const scope = observations.getStore();
  if (!scope) return run();
  const parent = invocations.getStore();
  if (scope.closed || !scope.accepting && !(parent?.active && parent.scope === scope)) return Promise.reject(new Error('Original layer effect observation closed'));
  const invocation = { active: true, scope };
  scope.started++;
  const promise = invocations.run(invocation, async () => {
    try { return await run(); } finally { invocation.active = false; }
  });
  scope.pending.add(promise);
  void promise.then(() => { scope.pending.delete(promise); }, error => { scope.errors.push(error); scope.pending.delete(promise); });
  return promise;
};
