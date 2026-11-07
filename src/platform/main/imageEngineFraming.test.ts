import { describe, expect, it } from 'vitest';
import { createNativeFrameDecoder, type NativeFrame } from './imageEngineFraming';

function wire(header: Uint8Array, payload = new Uint8Array()) {
  const result = new Uint8Array(8 + header.length + payload.length);
  const view = new DataView(result.buffer);
  view.setUint32(0, header.length, true); view.setUint32(4, payload.length, true);
  result.set(header, 8); result.set(payload, 8 + header.length); return result;
}
const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
describe('native image framing', () => {
  it('accepts every split point without exposing partial frames or pool bytes', () => {
    const input = wire(json({ kind: 'frame', label: '画面' }), new Uint8Array([0, 255, 3]));
    for (let split = 0; split < input.length; split++) {
      const seen: NativeFrame[] = [];
      const d = createNativeFrameDecoder({ maxPayloadBytes: 3, onFrame: f => seen.push(f) });
      d.push(input.subarray(0, split)); expect(seen).toHaveLength(0);
      d.push(input.subarray(split)); d.end();
      expect(seen).toHaveLength(1); expect([...seen[0].payload]).toEqual([0, 255, 3]);
      expect(seen[0].payload.buffer.byteLength).toBe(3);
      expect(seen[0].header.label).toBe('画面');
    }
  });
  it('accepts back-to-back frames including empty binary bodies', () => {
    const seen: NativeFrame[] = [];
    const a = wire(json({ n: 1 })), b = wire(json({ n: 2 }), new Uint8Array([7]));
    const all = new Uint8Array(a.length + b.length); all.set(a); all.set(b, a.length);
    const d = createNativeFrameDecoder({ maxPayloadBytes: 1, onFrame: f => seen.push(f) });
    for (const byte of all) d.push(new Uint8Array([byte]));
    d.end(); expect(seen.map(f => f.header.n)).toEqual([1, 2]);
  });
  it('rejects oversized declared lengths before receiving the body', () => {
    const prefix = new Uint8Array(8); const v = new DataView(prefix.buffer);
    v.setUint32(0, 2, true); v.setUint32(4, 0xffffffff, true);
    const d = createNativeFrameDecoder({ maxPayloadBytes: 32, onFrame: () => { throw Error('unexpected'); } });
    expect(() => d.push(prefix)).toThrow(/budget/);
    expect(() => d.push(wire(json({})))).toThrow(/closed/);
  });
  it('rejects malformed JSON, non-object headers and invalid UTF-8', () => {
    for (const header of [json([]), json(null), new Uint8Array([123, 255, 125]), new TextEncoder().encode('{oops}')]) {
      const d = createNativeFrameDecoder({ maxPayloadBytes: 0, onFrame: () => { throw Error('unexpected'); } });
      expect(() => d.push(wire(header))).toThrow();
    }
  });
  it('reports truncated EOF for each incomplete prefix/body position', () => {
    const input = wire(json({ a: 1 }), new Uint8Array([3]));
    for (let n = 1; n < input.length; n++) {
      const d = createNativeFrameDecoder({ maxPayloadBytes: 1, onFrame: () => {} });
      d.push(input.subarray(0, n)); expect(() => d.end()).toThrow(/inside/);
    }
  });
  it('terminates on consumer failure and refuses reentrant input', () => {
    const d = createNativeFrameDecoder({ maxPayloadBytes: 0, onFrame: () => d.push(wire(json({}))) });
    expect(() => d.push(wire(json({})))).toThrow(/Reentrant/);
    expect(() => d.push(new Uint8Array())).toThrow(/closed/);
  });
});
