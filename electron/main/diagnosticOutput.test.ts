import { test, expect } from 'vitest';
import { Writable } from 'node:stream';
import { teeDiagnosticOutput } from './diagnosticOutput';

test('a disconnected launcher pipe does not crash or prevent subsequent file logging', async () => {
  const chunks: Buffer[] = [];
  const log = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  let terminalWrites = 0;
  const target = new Writable({ write(_chunk, _encoding, callback) {
    terminalWrites++; callback(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  } });
  teeDiagnosticOutput(target, log);
  target.write('first\n');
  await new Promise(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => { expect(target.write('second\n', resolve)).toBe(true); });
  expect(terminalWrites).toBe(1);
  expect(Buffer.concat(chunks).toString()).toBe('first\nsecond\n');
});

test('synchronous broken pipes are contained, while file encoding and callbacks remain correct', async () => {
  const chunks: Buffer[] = [];
  const log = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
  const target = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  target.write = () => { throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }); };
  teeDiagnosticOutput(target, log);
  expect(() => target.write('first\n')).not.toThrow();
  await new Promise<void>(resolve => { target.write('é', 'latin1', resolve); });
  expect(Buffer.concat(chunks)).toEqual(Buffer.concat([Buffer.from('first\n'), Buffer.from([0xe9])]));
});

test('a file logger failure does not stop a healthy terminal', () => {
  let text = '';
  const target = new Writable({ write(chunk, _encoding, callback) { text += chunk; callback(); } });
  const log = { write: (() => { throw new Error('log unavailable'); }) as Writable['write'] };
  teeDiagnosticOutput(target, log);
  expect(() => target.write('still running')).not.toThrow();
  expect(text).toBe('still running');
});
