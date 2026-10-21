/** Wait without revoking the original producer's scope or draining its own queue.
 * Main owns the deadline; cancellation never cancels/replays original effects. */
export const waitForRefreshSettlement = async <T>(ports: {
  isBusy: () => boolean;
  isCurrent: () => boolean;
  waiting: () => void;
  capture: () => Promise<T>;
}): Promise<T | undefined> => {
  if (ports.isBusy()) ports.waiting();
  while (ports.isCurrent() && ports.isBusy()) await new Promise(resolve => setTimeout(resolve, 50));
  if (!ports.isCurrent()) return undefined;
  return ports.capture();
};
