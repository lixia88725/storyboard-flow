import { expect, it } from 'vitest';
import path from 'node:path';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { startImageEngine } from './imageEngineConnection';
import { createImageFrameStore, type ImageFrameHeader } from '../../drawing/renderer/image-engine/frames';

it('connects decimal layer context and transient floating frames through the real Node boundary', async () => {
  const binary = process.env.FLOW_IMAGE_HOST;
  if (!binary) throw Error('Real context-capable native component required');
  const root = await temporaryWorkspace('native-context-node-');
  const client = startImageEngine({ binary, store: path.join(root, 'native'), sessionId: 'context-node',
    incarnation: 'one', budgetBytes: 32 << 20 });
  let version: string | null = null, sequence = 0;
  const call = async (body: Record<string, unknown>) => {
    const response = await client.request(`context-${++sequence}`, body, version);
    const reply = response.header.body as Record<string, any>;
    expect(reply.kind, JSON.stringify(reply)).not.toBe('failure');
    return { reply, pixels: response.payload };
  };
  const edit = async (body: Record<string, unknown>) => {
    const p = await call(body);
    expect(p.reply.kind).toBe('prepared');
    const accepted = await call({ kind: 'accept', candidateId: p.reply.candidateId });
    version = accepted.reply.receipt.versionId;
  };
  try {
    await client.ready;
    for (const cap of ['toolContextSummaryV1', 'contextLayerSelectionV1', 'floatingGestureV1', 'decimalLayerIdsV1'] as const)
      expect(client.supports(cap)).toBe(true);
    await edit({ kind: 'new', width: 32, height: 24 });
    await edit({ kind: 'edit', edit: { kind: 'newLayer', name: 'paint' } });
    await edit({ kind: 'edit', edit: { kind: 'fill', color: '#ff0000' } });
    await edit({ kind: 'edit', edit: { kind: 'rect', x: 4, y: 5, width: 8, height: 7 } });
    const summary = async () => (await call({ kind: 'summary', maxBytes: 49152 })).reply;
    const s = await summary();
    expect(s.kind).toBe('contextSummary');
    expect(s.layers).toHaveLength(2);
    for (const layer of s.layers) expect(layer.layerId).toMatch(/^(0|[1-9][0-9]*)$/);
    const firstVersion = version, top = s.activeLayerId, bottom = s.layers[1].layerId;
    const chosen = await call({ kind: 'selectLayerContext', layerId: bottom, expectedContextGeneration: s.contextGeneration });
    expect(chosen.reply.activeLayerId).toBe(bottom);
    expect(chosen.reply.imageVersionRef).toBe(firstVersion);
    const back = await summary();
    await call({ kind: 'selectLayerContext', layerId: top, expectedContextGeneration: back.contextGeneration });
    const initial = await call({ kind: 'capture' });
    const frames = createImageFrameStore(initial.reply.frame as ImageFrameHeader);
    expect(frames.accept(initial.reply.frame, initial.pixels).ok).toBe(true);
    const original = frames.snapshot().frame!.pixels;
    const floating = async (action: Record<string, unknown>) => {
      const state = await summary();
      return call({ kind: 'floating', previewId: 'piece', expectedContextGeneration: state.contextGeneration, action });
    };
    await floating({ kind: 'begin', dx: 3, dy: 2 });
    await floating({ kind: 'move', fromSeq: 2, dx: 2, dy: -1 });
    const moved = await call({ kind: 'capture' });
    expect(moved.reply.frame.previewId).toBe('piece');
    expect(frames.accept(moved.reply.frame, moved.pixels).ok).toBe(true);
    expect(frames.snapshot().frame!.pixels).not.toEqual(original);
    expect((await summary()).floating.sourceLayerId).toBe(top);
    const cancel = await floating({ kind: 'cancel', throughSeq: 2 });
    const cancelled = await call({ kind: 'capture' });
    expect(cancelled.reply.frame.epoch).toBe(cancel.reply.epoch);
    expect(cancelled.reply.frame.epoch).toBeGreaterThan(moved.reply.frame.epoch);
    expect(frames.accept(cancelled.reply.frame, cancelled.pixels)).toMatchObject({ code: 'wrong-identity' });
    expect(frames.reset(cancelled.reply.frame).ok).toBe(true);
    expect(frames.accept(cancelled.reply.frame, cancelled.pixels).ok).toBe(true);
    expect(frames.snapshot().frame!.pixels).toEqual(original);
    expect((await summary()).imageVersionRef).toBe(firstVersion);
    await call({ kind: 'freeze' }); await call({ kind: 'close' });
    expect((await client.exited).code).toBe(0);
  } finally { client.terminateOwnedProcess(); await client.exited; }
}, 15000);
