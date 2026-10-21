import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { observeLayerFileOperations } from './layerFileEffectObservation';
import { withLayerFileOperation } from './layerFileOperationQueue';
const gate = () => { let release!: () => void; const promise = new Promise<void>(r => { release = r; }); return { promise, release }; };
// Real exclusive queue + synthetic filesystem effects. Not native writer authority.
test('a failed callback cannot release the queue before every started sibling settles', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinary-effect-drain-'));
  const entered = gate(), pending = gate(), original = new Error('first exact failure');
  let finished = false, successor = false;
  let slow!: Promise<void>;
  const result = withLayerFileOperation(() => observeLayerFileOperations(async () => {
    const fast = withLayerFileOperation(async () => { throw original; });
    slow = withLayerFileOperation(async () => { entered.release(); await pending.promise; await fs.writeFile(path.join(root, 'completed'), 'actual sibling'); });
    await Promise.all([fast, slow]);
  })).then(r => { finished = true; return r; });
  await entered.promise;
  const next = withLayerFileOperation(async () => { successor = true; });
  try {
    await new Promise(r => setImmediate(r));
    expect(finished).toBe(false); expect(successor).toBe(false);
  } finally { pending.release(); await slow; await result; await next; }
  const settled = await result;
  expect(await fs.readFile(path.join(root, 'completed'), 'utf8')).toBe('actual sibling');
  expect(settled.started).toBe(2);
  expect(settled.outcome).toEqual({ ok: false, error: original });
  expect(settled.errors).toEqual([original]);
});
test('an inherited callback cannot start an operation after its observation has closed', async () => {
  const held = gate(); let late!: Promise<unknown>, wrote = false;
  const result = await withLayerFileOperation(() => observeLayerFileOperations(async () => {
    late = held.promise.then(() => withLayerFileOperation(async () => { wrote = true; }));
    return 'done';
  }));
  held.release();
  await expect(late).rejects.toThrow('closed');
  expect(wrote).toBe(false); expect(result.started).toBe(0);
});

test('a draining inner observation cannot borrow an outer active invocation for new effects', async () => {
  const entered = gate(), slow = gate(), lateGate = gate();
  let late!: Promise<unknown>, wrote = false;
  const outer = withLayerFileOperation(() => observeLayerFileOperations(() => withLayerFileOperation(async () => {
    const inner = observeLayerFileOperations(async () => {
      void withLayerFileOperation(async () => { entered.release(); await slow.promise; });
      late = lateGate.promise.then(() => withLayerFileOperation(async () => { wrote = true; }));
      throw new Error('inner callback has ended');
    });
    await entered.promise; await new Promise(r => setImmediate(r));
    try { lateGate.release(); await expect(late).rejects.toThrow('closed'); expect(wrote).toBe(false); }
    finally { slow.release(); await inner; }
  })));
  const result = await outer;
  if (!result.outcome.ok) throw result.outcome.error;
});
