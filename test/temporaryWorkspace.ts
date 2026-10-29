import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished } from 'vitest';

const inside = (parent: string, child: string) => {
  const relative = path.relative(parent, child);
  return relative === '' || !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep);
};

/** Own a whole temporary container, including sibling aliases/copies created by
 * recovery tests. Never scan or delete existing workspaces by name/prefix. */
export const allocateTemporaryWorkspace = async (prefix: string) => {
  if (!/^[a-z][a-z0-9-]*-$/.test(prefix)) throw Error('Fixture prefix must be a simple name ending in a dash');
  const temp = await fs.realpath(os.tmpdir());
  const repository = await fs.realpath(fileURLToPath(new URL('..', import.meta.url)));
  if (inside(repository, temp)) throw Error('Test temporary directory must be outside the source checkout');
  const container = await fs.mkdtemp(path.join(temp, 'storyboard-tests-'));
  const identity = await fs.lstat(container);
  const root = path.join(container, prefix + 'workspace');
  const finish = async (failed: boolean) => {
    if (failed) {
      console.warn(`Failed test fixture retained: ${container}`);
      return;
    }
    let current;
    try { current = await fs.lstat(container); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino)
      throw Error(`Fixture container identity changed; retained: ${container}`);
    await fs.rm(container, { recursive: true, force: true });
  };
  try { await fs.mkdir(root, { mode: 0o700 }); }
  catch (error) { console.warn(`Fixture preparation retained: ${container}`); throw error; }
  return { root, container, finish };
};

export const temporaryWorkspace = async (prefix: string): Promise<string> => {
  const scope = await allocateTemporaryWorkspace(prefix);
  onTestFinished(({ task }) => scope.finish(task.result?.state === 'fail'));
  return scope.root;
};
