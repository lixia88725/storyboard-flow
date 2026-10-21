import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

type Initialization = { parent: string; created: () => Promise<void> };
const scope = new AsyncLocalStorage<readonly Initialization[]>();
/** Main-only receipt seam. Pure observation never calls mkdir or binds a parent.
 * Recursive mkdir's returned first-created path is the original creator receipt;
 * mere later existence is not sufficient to consume a pinned parent absence. */
export const withWorkspaceInitialization = <T>(entries: readonly Initialization[], run: () => Promise<T>): Promise<T> => scope.run(entries, run);
export const mkdirObserved: typeof mkdir = (async (file: string, ...args: any[]) => {
  const result = await (mkdir as any)(file, ...args);
  const createdPath = typeof result === 'string' ? path.resolve(result) : args[0]?.recursive ? undefined : path.resolve(file);
  for (const entry of scope.getStore() ?? []) if (createdPath === entry.parent) await entry.created();
  return result;
}) as typeof mkdir;
