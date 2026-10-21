import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createNativeAuthorizationSession, createBoundedNativeDiagnostic } from './nativeAuthorizationSession';
import { withLayerFileOperation } from './layerFileOperationQueue';
import { waitForNativeWorkersSettled } from './nativeWorkerSettlement';

test('native diagnostic retention stops at its byte ceiling while later chunks are drained', () => {
  const diagnostic = createBoundedNativeDiagnostic(6);
  expect(diagnostic.append(Buffer.from('abc'))).toBe(true);
  expect(diagnostic.append(Buffer.from('defg'))).toBe(false);
  for (let i = 0; i < 100; i++) expect(diagnostic.append(Buffer.alloc(4096, 'z'))).toBe(false);
  expect(diagnostic.message()).toBe('abcdef');
});

test('native request deadline reports unknown instead of accepting a late successful response', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-request-deadline-'));
  const script = path.join(root, 'slow.py');
  await fs.writeFile(script, `import time\ndef authorize(r):\n time.sleep(0.3)\n return {'authorized':True}\n`, { mode: 0o600 });
  // Finite slow fixture: RED finishes by itself, never strands an interpreter.
  const native = createNativeAuthorizationSession('python3', script, () => 65536, { requestTimeoutMs: 60, closeTimeoutMs: 1000 });
  await expect(native.request({})).rejects.toThrow('unknown');
}, 120000);

test('stderr overflow during a request refuses as unknown and never admits a late success', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-late-stderr-'));
  const script = path.join(root, 'late-stderr.py');
  // The worker ignores SIGTERM, floods diagnostics past the ceiling, then
  // returns success: an eventual clean exit must not retroactively admit it.
  await fs.writeFile(script, `import sys,signal,time\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\ndef authorize(r):\n for i in range(40):\n  sys.stderr.buffer.write(b'x'*4096)\n  sys.stderr.buffer.flush()\n  time.sleep(0.002)\n return {'authorized':True}\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', script, () => 65536, { requestTimeoutMs: 1000, closeTimeoutMs: 1000 });
  try {
    await expect(native.request({})).rejects.toThrow('Native stderr budget');
    await expect(native.request({})).rejects.toThrow('unknown');
  }
  finally { await waitForNativeWorkersSettled(); }
  // The reply was never surfaced; only a new explicit operation after real
  // settlement may run, and it starts nothing on its own.
  let startedAfter = false;
  await withLayerFileOperation(async () => { startedAfter = true; });
  expect(startedAfter).toBe(true);
}, 120000);

test.each(['request', 'run'] as const)('successful %s still refuses a subsequent terminal transport failure without undoing effects', async port => {
  for (const terminal of ['stderr', 'exit'] as const) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-post-reply-'));
    const script = path.join(root, 'terminal.py'), marker = path.join(root, 'effect');
    const finish = terminal === 'stderr' ? "sys.stderr.buffer.write(b'x'*70000);sys.stderr.buffer.flush()" : 'os._exit(7)';
    await fs.writeFile(script, `import atexit,sys,os,signal\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\ndef finish():\n ${finish}\natexit.register(finish)\ndef authorize(r):\n with open(${JSON.stringify(marker)},'w') as f:f.write('already happened')\n return {'authorized':True}\n`, { mode: 0o600 });
    const native = createNativeAuthorizationSession('python3', script, () => 65536);
    try {
      await expect(port === 'run' ? native.run(() => native.request({})) : native.request({})).rejects.toThrow(terminal === 'stderr' ? 'Native stderr budget' : 'worker exited');
      expect(await fs.readFile(marker, 'utf8')).toBe('already happened');
    } finally { await waitForNativeWorkersSettled(); }
  }
}, 120000);

test.each(['request', 'run'] as const)('successful %s refuses unterminated terminal stdout and preserves the effect fact', async port => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-terminal-tail-'));
  const script = path.join(root, 'tail.py'), marker = path.join(root, 'effect');
  await fs.writeFile(script, `import atexit,sys\natexit.register(lambda:(sys.stdout.write('extra-without-newline'),sys.stdout.flush()))\ndef authorize(r):\n with open(${JSON.stringify(marker)},'w') as f:f.write('already happened')\n return {'authorized':True}\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', script, () => 65536);
  await expect(port === 'run' ? native.run(() => native.request({})) : native.request({})).rejects.toThrow(/unterminated|unsolicited/i);
  expect(await fs.readFile(marker, 'utf8')).toBe('already happened');
}, 120000);

test('an original callback failure survives a later terminal failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-primary-error-')), script = path.join(root, 'terminal.py');
  await fs.writeFile(script, `import atexit,os\natexit.register(lambda:os._exit(7))\ndef authorize(r):return {'authorized':True}\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', script, () => 65536);
  const primary = new Error('original callback failure');
  await expect(native.run(async () => { await native.request({}); throw primary; })).rejects.toBe(primary);
});

test('close timeout is bounded but cannot admit another layer operation until the actual worker exits', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-close-deadline-'));
  const script = path.join(root, 'slow-exit.py'), marker = path.join(root, 'worker-terminal');
  await fs.writeFile(script, `import atexit,time,signal\nsignal.signal(signal.SIGTERM,signal.SIG_IGN)\ndef finish():\n time.sleep(0.4)\n with open(${JSON.stringify(marker)},'w') as f:f.write('terminal')\natexit.register(finish)\ndef authorize(r):return {'authorized':True}\n`, { mode: 0o600 });
  const native = createNativeAuthorizationSession('python3', script, () => 65536, { requestTimeoutMs: 1000, closeTimeoutMs: 20 });
  try {
    await expect(native.request({})).rejects.toThrow('terminal state unknown');
    let started = false;
    await expect(withLayerFileOperation(async () => { started = true; })).rejects.toThrow('unknown');
    expect(started).toBe(false);
  } finally { await waitForNativeWorkersSettled(); }
  expect(await fs.readFile(marker, 'utf8')).toBe('terminal');
  // Only a new explicit operation after actual settlement may start. No replay.
  let startedAfter = false;
  await withLayerFileOperation(async () => { startedAfter = true; });
  expect(startedAfter).toBe(true);
}, 120000);
