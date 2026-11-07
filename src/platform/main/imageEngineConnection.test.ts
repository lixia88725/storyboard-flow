import { expect, it } from 'vitest';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import { createSourceBackedImport, openSourceBackedImport } from '../../project-files/main/image-engine/sourceStore';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { startImageEngine } from './imageEngineConnection';
import { createImageFrameStore, type ImageFrameHeader } from '../../drawing/renderer/image-engine/frames';

// Explicit native acceptance prerequisite. Never silently substitutes a fake worker.
it('connects real native pixels to the renderer FrameStore across strokes and history', async () => {
  const binary = process.env.FLOW_IMAGE_HOST;
  if (!binary) throw Error('Prepare native host and set FLOW_IMAGE_HOST before this acceptance test');
  const root = await temporaryWorkspace('native-connection-');
  const client = startImageEngine({ binary, store: path.join(root, 'native'), sessionId: 'integration', incarnation: 'one', budgetBytes: 32 * 1024 * 1024 });
  try {
    await client.ready;
    let version: string | null = null;
    const call = async (id: string, body: Record<string, unknown>, payload?: Uint8Array) => {
      const result = await client.request(id, body, version, payload);
      const reply = result.header.body as Record<string, any>;
      expect(reply.kind, JSON.stringify(reply)).not.toBe('failure');
      return { reply, pixels: result.payload };
    };
    const png = await sharp({ create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const sourcePath = path.join(root, 'source.png'); await fs.writeFile(sourcePath, png);
    const sources = await createSourceBackedImport({ root, importId: 'batch', sources: [{ id: 'one', sourcePath, formatHint: 'png' }] });
    try { await sources.retain('one'); } finally { await sources.close(); }
    await fs.unlink(sourcePath); // Only the synthetic source; retained data must be sufficient.
    const reopened = await openSourceBackedImport({ root, importId: 'batch' });
    let retainedBytes: Uint8Array;
    try {
      const ref = await reopened.object('one');
      expect(ref.digest).toBe(createHash('sha256').update(png).digest('hex'));
      retainedBytes = await reopened.readRange('one', 0, ref.byteLength);
    } finally { await reopened.close(); }
    const opened = await call('open', { kind: 'open', source: { digest: createHash('sha256').update(png).digest('hex'), byteLength: png.length, formatHint: 'png' } }, retainedBytes);
    expect(opened.reply.kind).toBe('prepared');
    version = (await call('accept-open', { kind: 'accept', candidateId: 'open' })).reply.receipt.versionId;
    const first = await call('capture-blank', { kind: 'capture' });
    const store = createImageFrameStore(first.reply.frame as ImageFrameHeader);
    expect(store.accept(first.reply.frame, first.pixels)).toEqual({ ok: true, value: first.reply.frame.frameSeq });
    const blank = store.snapshot().frame!.pixels;
    const originalVersion = version;
    for (let n = 0; n < 2; n++) {
      const id = `stroke${n}`;
      const begun = await call(`begin${n}`, { kind: 'strokeBegin', previewId: id, brush: { size: 10, opacity: 0.5, seed: 19, color: '#ff0000' }, points: [{ x: 12, y: 20 + n * 20, pressure: 1 }] });
      expect(store.accept(begun.reply.frame, begun.pixels)).toEqual({ ok: true, value: begun.reply.frame.frameSeq });
      const next = await call(`append${n}`, { kind: 'strokeAppend', previewId: id, fromSeq: 2, points: [{ x: 45, y: 20 + n * 20, pressure: 1 }] });
      expect(store.accept(next.reply.frame, next.pixels)).toEqual({ ok: true, value: next.reply.frame.frameSeq });
      const preview = store.snapshot().frame!.pixels;
      expect((await call(id, { kind: 'strokeFinish', previewId: id, throughSeq: 2 })).reply.kind).toBe('prepared');
      version = (await call(`accept${n}`, { kind: 'accept', candidateId: id })).reply.receipt.versionId;
      const captured = await call(`capture${n}`, { kind: 'capture' });
      expect(store.accept(captured.reply.frame, captured.pixels)).toEqual({ ok: true, value: captured.reply.frame.frameSeq });
      expect(Buffer.compare(Buffer.from(preview), Buffer.from(store.snapshot().frame!.pixels))).toBe(0);
    }
    expect(Buffer.compare(Buffer.from(blank), Buffer.from(store.snapshot().frame!.pixels))).not.toBe(0);
    await call('undo', { kind: 'install', versionId: originalVersion }); version = originalVersion;
    const restored = await call('capture-undo', { kind: 'capture' });
    expect(store.accept(restored.reply.frame, restored.pixels).ok).toBe(false);
    expect(store.reset(restored.reply.frame as ImageFrameHeader).ok).toBe(true);
    expect(store.accept(restored.reply.frame, restored.pixels).ok).toBe(true);
    expect(Buffer.compare(Buffer.from(blank), Buffer.from(store.snapshot().frame!.pixels))).toBe(0);
    await call('freeze', { kind: 'freeze' }); await call('close', { kind: 'close' });
    expect((await client.exited).code).toBe(0);
  } finally { client.terminateOwnedProcess(); await client.exited; }
}, 30000);
