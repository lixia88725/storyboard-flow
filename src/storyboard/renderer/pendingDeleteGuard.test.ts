import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createFlowSession } from '../../session/core';
import { pendingDeleteDecision } from './pendingSelection';
import type { FlowPixelOutput, FlowResult, FlowSession, FlowSessionOptions, FlowSessionOutcome } from '../../platform/contracts/flowWave2';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = Uint8Array.of(1, 2, 3), assetId = hash(bytes);
const project = (): ProjectV1 => ({
  schema: 'storyboard-flow.project', version: 1, id: 'project', revision: 0, name: 'Pending guard',
  shots: [{ id: 'a', imageId: 'i_a', name: 'a', scriptText: '' }],
  parkedShots: [{ id: 'p', imageId: 'i_p', name: 'p', scriptText: '' }, { id: 'q', imageId: 'i_q', name: 'q', scriptText: '' }],
  dialogues: [],
  images: Object.fromEntries(['a', 'p', 'q'].map(id => [`i_${id}`, { id: `i_${id}`, revision: 0, width: 4, height: 3,
    layers: [{ id: 'layer', name: 'Image', kind: 'image' as const, visible: true, locked: false, opacity: 1,
      blendMode: 'normal' as const, width: 4, height: 3, assetId }] }]))
});
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
};
const ticks = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const success = async (pending: Promise<FlowResult<FlowSessionOutcome>>) => {
  const result = await pending; expect(result.ok).toBe(true); if (!result.ok) throw Error(result.error.message); return result.value;
};
function setup(pixels: { produce: () => Promise<FlowResult<FlowPixelOutput>> }): FlowSession {
  const options: FlowSessionOptions = {
    sessionId: 'session', incarnation: 'open_1', project: project(), maxHistoryEntries: 4, maxPendingRequests: 8,
    clock: { setTimeout: () => 1, clearTimeout: () => undefined },
    assets: {
      async read() { return { ok: true, value: bytes.slice() }; },
      async put(input) {
        return { ok: true, value: { sessionId: 'session', operationId: input.operationId, assetId, width: input.width,
          height: input.height, byteLength: input.png.byteLength, directorySync: 'synced' as const } };
      }
    },
    pixels: { produce: pixels.produce },
    async checkpoint(snapshot) { return { ok: true, value: { projectId: snapshot.id, revision: snapshot.revision, manifestPath: '/synthetic' } }; }
  };
  const created = createFlowSession(options); expect(created.ok).toBe(true);
  if (!created.ok) throw Error(created.error.message);
  return created.value;
}
const stroke = { tool: 'brush' as const, color: '#abc', size: 2, opacity: 1, softness: 0, points: [1, 1, 2, 2] };
const parkedIds = (session: FlowSession) => session.snapshot().project.parkedShots.map(shot => shot.id);
const decision = (session: FlowSession, shotIds: string[]) => pendingDeleteDecision(
  { pending: session.snapshot().pending, parked: parkedIds(session) }, shotIds);

describe('Pending delete guard against a queued Restore', () => {
  it('refuses while work is in flight, then refuses the stale IDs once the Restore lands, and still deletes an idle Pending shot', async () => {
    const slow = deferred<FlowResult<FlowPixelOutput>>();
    const session = setup({ produce: () => slow.promise });
    const painting = session.request({ kind: 'paint', shotId: 'a', layerId: 'layer', stroke });
    const restoring = session.request({ kind: 'board', command: { kind: 'moveShots', shotIds: ['p'], destination: 'active' } });
    await ticks();

    // The Restore is still queued: membership alone would look deletable, so live work must refuse.
    expect(session.snapshot().pending).toBeGreaterThan(0);
    expect(parkedIds(session)).toEqual(['p', 'q']);
    expect(session.snapshot().project.shots.map(shot => shot.id)).toEqual(['a']);
    expect(decision(session, ['p', 'q'])).toBe('busy');

    slow.resolve({ ok: true, value: { png: Uint8Array.of(9, 8, 7), width: 4, height: 3 } });
    await success(painting); await success(restoring); await ticks();

    // The queued Restore became active membership; the old selection is now stale as a whole.
    expect(session.snapshot().pending).toBe(0);
    expect(session.snapshot().project.shots.map(shot => shot.id)).toEqual(['a', 'p']);
    expect(parkedIds(session)).toEqual(['q']);
    expect(decision(session, ['p', 'q'])).toBe('stale');
    expect(decision(session, ['p'])).toBe('stale');

    // Idle, still-parked selection keeps the ordinary path.
    expect(decision(session, ['q'])).toBe('delete');
    await success(session.request({ kind: 'board', command: { kind: 'removeShots', shotIds: ['q'] } }));
    expect(parkedIds(session)).toEqual([]);
    expect(session.snapshot().project.shots.map(shot => shot.id)).toEqual(['a', 'p']);
    expect(decision(session, [])).toBe('empty');
  });
});
