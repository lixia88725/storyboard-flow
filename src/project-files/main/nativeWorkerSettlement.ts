/** Unknown own native worker effects remain protected until its real close
 * event. A timeout is not settlement, not permission, and not an auto-retry. */
const unsettled = new Set<object>();
const waiters = new Set<() => void>();
export const markNativeWorkerUnsettled = (worker: object): void => { unsettled.add(worker); };
export const settleNativeWorker = (worker: object): void => {
  unsettled.delete(worker);
  if (!unsettled.size) { for (const resolve of waiters) resolve(); waiters.clear(); }
};
export const assertNativeWorkersSettled = (): void => {
  if (unsettled.size) throw new Error('Native worker terminal state unknown; new operations remain protected');
};
export const waitForNativeWorkersSettled = (): Promise<void> => unsettled.size ? new Promise(resolve => { waiters.add(resolve); }) : Promise.resolve();
