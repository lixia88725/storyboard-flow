import { describe, expect, it, vi } from 'vitest';
import { createPendingAddCoordinator, supportsPendingAdd, type PendingAddCoordinatorDeps, type PendingAddSource } from './pendingAddCoordinator';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';
import type { FlowResult } from '../../platform/contracts/flowWave2';

const project = { schema: 'storyboard-flow.project', version: 1, id: 'project-a', revision: 0, name: 'p',
  shots: [], parkedShots: [], dialogues: [], images: {} } as ProjectV1;
const files: PendingAddSource = { kind: 'files', files: ['/tmp/a.png'] };
const folder: PendingAddSource = { kind: 'folder', folder: '/tmp/source' };
const next = (before: ProjectV1): FlowResult<ProjectV1> => ({ ok: true, value: { ...before, revision: before.revision + 1 } });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolveValue => { resolve = resolveValue; });
  return { promise, resolve };
}

function setup(overrides: Partial<PendingAddCoordinatorDeps> = {}) {
  const pick = vi.fn(async (mode: 'files' | 'folder') => mode === 'files' ? files : folder);
  const append = vi.fn(async (_owner, before, input, options) => {
    options.onProgress?.({ done: 1, total: 1, phase: 'read' });
    if (await options.decideIssues?.([{ file: '/tmp/a.png', reason: 'test', action: 'skip' }]) === 'cancel')
      return { ok: false as const, error: { code: 'unavailable' as const, message: 'cancelled', effect: 'none' as const } };
    return next(before);
  });
  const askIssues = vi.fn(async () => 'continue' as const);
  const onProgress = vi.fn();
  const deps: PendingAddCoordinatorDeps = { available: () => true, currentSessionId: () => 'session', pick, append: append as never, askIssues, onProgress, ...overrides };
  return { coordinator: createPendingAddCoordinator(deps), pick, append, askIssues, onProgress };
}

const request = (mode: 'files' | 'folder' = 'files', operationId = 'op_1', recover = false) => ({ mode, operationId, recover });

describe('Pending add coordinator', () => {
  it('passes the picked source and progress and keeps a lost-reply operation addressable', async () => {
    const { coordinator, pick, append, onProgress } = setup();
    expect(await coordinator.add(7, 'session', project, request())).toMatchObject({ ok: true, value: { revision: 1 } });
    expect(pick).toHaveBeenCalledWith('files');
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session', windowId: 7, projectId: 'project-a', mode: 'files' }),
      project, { operationId: 'op_1', source: files }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(onProgress).toHaveBeenCalledWith('op_1', { done: 1, total: 1, phase: 'read' });
    expect(await coordinator.add(7, 'session', project, request())).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await coordinator.add(7, 'session', project, request('files', 'op_1', true))).toMatchObject({ ok: true });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[1][2]).toEqual({ operationId: 'op_1', recover: true });
  });

  it('refuses unsupported platforms/missing backend before a picker opens', async () => {
    expect(supportsPendingAdd('darwin', () => {})).toBe(true);
    for (const [platform, method] of [['win32', () => {}], ['darwin', null]] as const) {
      const {coordinator, pick, append} = setup({available: () => supportsPendingAdd(platform, method)});
      expect(await coordinator.add(7,'session',project,request())).toMatchObject({ok:false,error:{code:'unavailable',effect:'none'}});
      expect(pick).not.toHaveBeenCalled(); expect(append).not.toHaveBeenCalled();
    }
  });

  it('returns a known cancellation without opening an append', async () => {
    const { coordinator, append } = setup({ pick: async () => null });
    expect(await coordinator.add(7, 'session', project, request('folder', 'op_cancel'))).toMatchObject({
      ok: false, error: { code: 'unavailable', effect: 'none' }
    });
    expect(append).not.toHaveBeenCalled();
  });

  it('keeps an unknown operation for the same owner and recovers without a picker', async () => {
    const append = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: { code: 'io-failure', message: 'reply lost', effect: 'unknown' } })
      .mockResolvedValueOnce(next(project));
    const { coordinator, pick } = setup({ append: append as never });
    expect(await coordinator.add(7, 'session', project, request())).toMatchObject({ ok: false, error: { effect: 'unknown' } });
    expect(await coordinator.add(7, 'session', project, request('files', 'op_1', true))).toMatchObject({ ok: true });
    expect(pick).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[1][2]).toEqual({ operationId: 'op_1', recover: true });
  });

  it('rejects recovery from another window, session, project or mode', async () => {
    const append = vi.fn().mockResolvedValue({ ok: false, error: { code: 'io-failure', message: 'lost', effect: 'unknown' } });
    const { coordinator } = setup({ append: append as never });
    await coordinator.add(7, 'session', project, request());
    for (const call of [
      () => coordinator.add(8, 'session', project, request('files', 'op_1', true)),
      () => coordinator.add(7, 'other', project, request('files', 'op_1', true)),
      () => coordinator.add(7, 'session', { ...project, id: 'project-b' }, request('files', 'op_1', true)),
      () => coordinator.add(7, 'session', project, request('folder', 'op_1', true))
    ]) expect(await call()).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(append).toHaveBeenCalledTimes(1);
  });

  it('cancels a picker before any append and cannot reuse the operation id', async () => {
    const gate = deferred<PendingAddSource | null>();
    const { coordinator, append } = setup({ pick: async () => gate.promise });
    const work = coordinator.add(7, 'session', project, request('folder', 'op_pick'));
    await Promise.resolve();
    coordinator.cancel(7, 'session', 'op_pick');
    gate.resolve(folder);
    expect(await work).toMatchObject({ ok: false, error: { code: 'unavailable', effect: 'none' } });
    expect(append).not.toHaveBeenCalled();
    expect(await coordinator.add(7, 'session', project, request('folder', 'op_pick'))).toMatchObject({ ok: true });
  });

  it('aborts the append on cancel and keeps an unknown result addressable', async () => {
    const gate = deferred<FlowResult<ProjectV1>>();
    const append = vi.fn(async (_owner, _before, _input, options) => {
      options.signal.addEventListener('abort', () => gate.resolve({ ok: false, error: { code: 'io-failure', message: 'aborted', effect: 'unknown' } }));
      return gate.promise;
    });
    const { coordinator } = setup({ append: append as never });
    const work = coordinator.add(7, 'session', project, request());
    await Promise.resolve();
    coordinator.cancel(7, 'session', 'op_1');
    expect(await work).toMatchObject({ ok: false, error: { effect: 'unknown' } });
    expect(await coordinator.add(7, 'session', project, request('files', 'op_1', true))).toMatchObject({ ok: false, error: { effect: 'unknown' } });
  });

  it('forwards batched issues and honours cancel', async () => {
    const askIssues = vi.fn(async () => 'cancel' as const);
    const { coordinator } = setup({ askIssues });
    expect(await coordinator.add(7, 'session', project, request())).toMatchObject({ ok: false, error: { effect: 'none' } });
    expect(askIssues).toHaveBeenCalledWith('op_1', [{ file: '/tmp/a.png', reason: 'test', action: 'skip' }], expect.any(AbortSignal));
  });

  it('rejects stale sessions and malformed operation ids before Main work', async () => {
    const { coordinator, pick, append } = setup({ currentSessionId: () => 'new-session' });
    for (const [token, value] of [
      ['old-session', request()],
      ['new-session', request('files', '../bad')],
      ['new-session', { ...request(), recover: 'yes' } as never],
      ['new-session', { ...request(), mode: 'other' } as never]
    ] as const) {
      expect(await coordinator.add(7, token, project, value)).toMatchObject({ ok: false });
    }
    expect(pick).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });

  it('clears all operations on close so a later recovery is not accepted', async () => {
    const append = vi.fn().mockResolvedValue({ ok: false, error: { code: 'io-failure', message: 'lost', effect: 'unknown' } });
    const { coordinator } = setup({ append: append as never });
    await coordinator.add(7, 'session', project, request());
    coordinator.cancelAll();
    expect(await coordinator.add(7, 'session', project, request('files', 'op_1', true))).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });
});
