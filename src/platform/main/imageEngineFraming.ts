/** Native stdout framing only. Operation identity and schema are checked by the caller.
 * Wire: u32le header length, u32le payload length, UTF-8 JSON object, binary bytes.
 * Exactly one bounded frame is assembled; consumers must not queue unbounded frames.
 */
export type NativeFrame = { header: Record<string, unknown>; payload: Uint8Array };
export function createNativeFrameDecoder(options: {
  maxHeaderBytes?: number;
  maxPayloadBytes: number;
  onFrame(frame: NativeFrame): void;
}) {
  const headerLimit = options.maxHeaderBytes ?? 64 * 1024;
  for (const value of [headerLimit, options.maxPayloadBytes]) {
    if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)
      throw new Error('Invalid native frame budget');
  }
  if (headerLimit < 2) throw new Error('Header budget must permit an object');
  const prefix = new Uint8Array(8);
  let prefixUsed = 0, body: Uint8Array | undefined, bodyUsed = 0, headerBytes = 0;
  let terminal = false, pushing = false;
  const reset = () => { prefixUsed = 0; body = undefined; bodyUsed = 0; headerBytes = 0; };
  return {
    push(chunk: Uint8Array) {
      if (terminal) throw new Error('Native frame decoder is closed');
      if (pushing) throw new Error('Reentrant native frame input');
      pushing = true;
      try {
        let cursor = 0;
        while (cursor < chunk.byteLength) {
          if (!body) {
            const n = Math.min(8 - prefixUsed, chunk.byteLength - cursor);
            prefix.set(chunk.subarray(cursor, cursor + n), prefixUsed);
            prefixUsed += n; cursor += n;
            if (prefixUsed < 8) continue;
            const view = new DataView(prefix.buffer);
            headerBytes = view.getUint32(0, true);
            const payloadBytes = view.getUint32(4, true);
            if (headerBytes < 2 || headerBytes > headerLimit || payloadBytes > options.maxPayloadBytes)
              throw new Error('Native frame exceeds budget or has no header');
            body = new Uint8Array(headerBytes + payloadBytes);
          }
          const n = Math.min(body.byteLength - bodyUsed, chunk.byteLength - cursor);
          body.set(chunk.subarray(cursor, cursor + n), bodyUsed);
          bodyUsed += n; cursor += n;
          if (bodyUsed !== body.byteLength) continue;
          const header: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, headerBytes)));
          if (!header || typeof header !== 'object' || Array.isArray(header))
            throw new Error('Native header must be an object');
          // Exact backing buffer: callers cannot accidentally forward header/pool bytes.
          const payload = body.slice(headerBytes);
          reset();
          options.onFrame({ header: header as Record<string, unknown>, payload });
        }
      } catch (error) {
        terminal = true; reset(); throw error;
      } finally { pushing = false; }
    },
    end() {
      if (terminal) throw new Error('Native frame decoder is closed');
      terminal = true;
      const incomplete = prefixUsed !== 0 || body !== undefined;
      reset();
      if (incomplete) throw new Error('Native stream ended inside a frame');
    },
    dispose() { terminal = true; reset(); }
  };
}
