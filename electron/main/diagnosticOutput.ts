import type { Writable } from 'node:stream';

/** A launcher may disappear while the desktop app stays alive. Loss of that
 * diagnostic pipe must not interrupt project operations or the file log. */
export const teeDiagnosticOutput = (target: Writable, log: Pick<Writable, 'write'>): void => {
  const original = target.write.bind(target);
  let connected = true;
  // Writable errors are asynchronous as well as synchronous. This handler is
  // limited to stdout/stderr; it does not suppress application or file errors.
  target.on('error', () => { connected = false; });
  target.write = ((chunk: any, ...rest: any[]) => {
    try {
      if (typeof rest[0] === 'string') log.write(chunk, rest[0] as BufferEncoding);
      else log.write(chunk);
    } catch { /* File logging is best effort. */ }
    const callback = rest.find(value => typeof value === 'function');
    if (!connected) {
      if (callback) queueMicrotask(() => callback());
      return true;
    }
    try { return original(chunk, ...rest as []); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'EPIPE' && code !== 'ERR_STREAM_DESTROYED' && code !== 'ERR_STREAM_WRITE_AFTER_END') throw error;
      connected = false;
      if (callback) queueMicrotask(() => callback(error));
      return true;
    }
  }) as Writable['write'];
};
