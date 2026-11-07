import { spawn } from 'node:child_process';
import { createNativeFrameDecoder, type NativeFrame } from './imageEngineFraming.js';

export type ImageEngineCapability = 'recoveredCandidateAcceptAtInstalledVersion' | 'strokePipelineV1' | 'immutableVersionExportV1' | 'settledResumeV1';

/** One explicitly owned native process. Transport failure means UNKNOWN, never cancellation.
 * At most one request is outstanding in protocol v1; caller owns operation reconciliation.
 */
export function startImageEngine(options: { binary: string; store: string; sessionId: string; incarnation: string; budgetBytes: number }) {
  options = { ...options }; // Bind process/session identity independently of the caller's mutable config.
  if (!Number.isSafeInteger(options.budgetBytes) || options.budgetBytes <= 0) throw Error('Invalid storage budget');
  const child = spawn(options.binary, ['--store', options.store, '--budget', String(options.budgetBytes)], { stdio: ['pipe', 'pipe', 'pipe'] });
  let workerEpoch: number | undefined, sequence = 0, stopped = false, requestActive = false, stderr = '';
  let capabilities = new Set<string>();
  let pending: { id: string; operationId: string; resolve(f: NativeFrame): void; reject(e: Error): void } | undefined;
  let readyResolve!: (epoch: number) => void, readyReject!: (e: Error) => void;
  const ready = new Promise<number>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  // Attach a rejection handler even if the caller has not yet awaited startup.
  void ready.catch(() => {});
  const fail = (reason: string) => {
    if (stopped) return;
    stopped = true;
    const error = Object.assign(Error(reason), { effect: 'unknown' as const });
    readyReject(error); pending?.reject(error); pending = undefined;
  };
  const decoder = createNativeFrameDecoder({ maxPayloadBytes: 64 * 1024 * 1024, onFrame(frame) {
    const h = frame.header;
    if (workerEpoch === undefined) {
      if (h.protocol !== 1 || h.kind !== 'hello' || !Number.isSafeInteger(h.workerEpoch) || (h.workerEpoch as number) < 0 || frame.payload.length)
        throw Error('Invalid native handshake');
      const offered = h.capabilities ?? [];
      if (!Array.isArray(offered) || offered.length > 32 ||
          offered.some(value => typeof value !== 'string' || !value.length || value.length > 128) ||
          new Set(offered).size !== offered.length) throw Error('Invalid native capabilities');
      capabilities = new Set(offered);
      workerEpoch = h.workerEpoch as number; readyResolve(workerEpoch); return;
    }
    if (!pending || h.protocol !== 1 || h.requestId !== pending.id || h.operationId !== pending.operationId ||
        h.sessionId !== options.sessionId || h.incarnation !== options.incarnation || h.workerEpoch !== workerEpoch)
      throw Error('Native response identity mismatch');
    const request = pending; pending = undefined; request.resolve(frame);
  } });
  child.stdout.on('data', chunk => { if (!stopped) try { decoder.push(chunk); } catch (e) { fail(String(e)); child.stdin.end(); } });
  child.stdout.on('end', () => { if (!stopped) try { decoder.end(); } catch (e) { fail(String(e)); } });
  child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-16 * 1024); });
  child.on('error', e => fail(String(e)));
  child.stdin.on('error', e => fail(String(e)));
  const exited = new Promise<{ code: number | null; signal: string | null }>(resolve => child.on('close', (code, signal) => {
    fail(`Native process exited (${code ?? signal})`); resolve({ code, signal });
  }));
  return {
    ready, exited, pid: child.pid,
    diagnostics: () => stderr,
    /** False until handshake; protocol=1 alone never opts into newer recovery semantics. */
    supports: (capability: ImageEngineCapability) => !stopped && capabilities.has(capability),
    async request(operationId: string, body: Record<string, unknown>, baseVersion: string | null = null, payload = new Uint8Array()): Promise<NativeFrame> {
      if (requestActive) throw Object.assign(Error('Native request is still in flight'), { effect: 'none' });
      requestActive = true;
      try {
        // Capture the request before startup yields: a caller may reuse its sample buffer.
        if (typeof operationId !== 'string' || !operationId.length || operationId.length > 256)
          throw Object.assign(Error('Invalid native operation identity'), { effect: 'none' });
        if (payload.byteLength > 64 * 1024 * 1024) throw Object.assign(Error('Native payload exceeds budget'), { effect: 'none' });
        const bodyJson = JSON.stringify(body);
        if (typeof bodyJson !== 'string' || Buffer.byteLength(bodyJson) > 65536)
          throw Object.assign(Error('Native body exceeds header budget'), { effect: 'none' });
        const capturedBody = JSON.parse(bodyJson), capturedPayload = new Uint8Array(payload);
        await ready;
        if (stopped) throw Object.assign(Error('Native process is unavailable'), { effect: 'unknown' });
        if (pending) throw Object.assign(Error('Native request is still in flight'), { effect: 'none' });
        const requestId = `request-${++sequence}`;
        const header = Buffer.from(JSON.stringify({ protocol: 1, requestId, sessionId: options.sessionId,
          incarnation: options.incarnation, workerEpoch, operationId, baseVersion, body: capturedBody }), 'utf8');
        if (header.length > 65536) throw Object.assign(Error('Native header exceeds budget'), { effect: 'none' });
        const message = Buffer.alloc(8 + header.length + capturedPayload.byteLength);
        message.writeUInt32LE(header.length, 0); message.writeUInt32LE(capturedPayload.byteLength, 4);
        header.copy(message, 8); message.set(capturedPayload, 8 + header.length);
        return await new Promise<NativeFrame>((resolve, reject) => {
          pending = { id: requestId, operationId, resolve, reject };
          child.stdin.write(message, error => { if (error) fail(String(error)); });
        });
      } finally { requestActive = false; }
    },
    /** Only for explicit owner shutdown/fault tests; does NOT certify project close. */
    terminateOwnedProcess() { child.kill('SIGKILL'); },
  };
}
