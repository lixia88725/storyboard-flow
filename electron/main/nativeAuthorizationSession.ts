import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';
import { assertNativeWorkersSettled, markNativeWorkerUnsettled, settleNativeWorker } from './nativeWorkerSettlement.js';

// One interpreter per fixed Main operation, not a policy/result cache. Every
// request still executes the original adapter and all its native inspections.
// Transport is independently bounded: workspace disk quota is not a per-policy
// response RAM allowance. Oversized complete policies refuse; never truncate.
export const NATIVE_AUTHORIZATION_TRANSPORT_BYTES = 16 * 1024 * 1024;
// Diagnostic bytes are retained only up to the ceiling, even while a worker
// ignores SIGTERM. Its pipe remains drained; truncated text is never a policy.
export const createBoundedNativeDiagnostic = (limit = 65536) => {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 65536) throw new Error('Finite native diagnostic ceiling required');
  let retained: Buffer = Buffer.alloc(0), exceeded = false;
  return {
    append: (chunk: Buffer): boolean => {
      if (exceeded) return false;
      const remaining = limit - retained.length;
      exceeded = chunk.length > remaining;
      retained = Buffer.concat([retained, chunk.subarray(0, remaining)], Math.min(limit, retained.length + chunk.length));
      return !exceeded;
    },
    message: () => retained.toString('utf8')
  };
};
export const createNativeAuthorizationSession = (python: string, script: string, byteLimit: () => number, deadlines: { requestTimeoutMs?: number; closeTimeoutMs?: number } = {}) => {
  const requestTimeoutMs = deadlines.requestTimeoutMs ?? 30000, closeTimeoutMs = deadlines.closeTimeoutMs ?? 5000;
  if ([requestTimeoutMs, closeTimeoutMs].some(n => !Number.isSafeInteger(n) || n <= 0 || n > 2147483647)) throw new Error('Finite native worker deadlines required');
  const transportLimit = () => Math.min(byteLimit(), NATIVE_AUTHORIZATION_TRANSPORT_BYTES);
  type Session = { request: (input: unknown) => Promise<any>; close: () => Promise<void> };
  const sessions = new AsyncLocalStorage<{ worker?: Session }>();
  const finish = async <T>(operation: () => Promise<T>, close: () => Promise<void> | undefined): Promise<T> => {
    let failed = false;
    try { return await operation(); }
    catch (error) { failed = true; throw error; }
    finally {
      // Always await terminal handling, but never replace an original request
      // or callback failure with a secondary close failure. Existing effects
      // remain facts; neither failure nor actual close grants a replay.
      try { await close(); } catch (error) { if (!failed) throw error; }
    }
  };
  const start = () => {
    // Give executable adapters their original single-request stdin + EOF port.
    // Only library adapters expose authorize; CLI code is re-executed for each
    // request in this operation's interpreter, never imported against live stdin.
    const code = `import contextlib,importlib.util,io,json,sys
adapter=None
def load(request):
 original=sys.stdin
 output=io.StringIO()
 try:
  sys.stdin=io.StringIO(json.dumps(request))
  spec=importlib.util.spec_from_file_location('adapter',sys.argv[1])
  module=importlib.util.module_from_spec(spec)
  with contextlib.redirect_stdout(output):
   try: spec.loader.exec_module(module)
   except SystemExit: pass
  return module,output.getvalue()
 finally: sys.stdin=original
for line in sys.stdin:
 try:
  request=json.loads(line)
  if adapter is None:
   module,output=load(request)
   if callable(getattr(module,'authorize',None)):
    if output.strip(): raise ValueError('Unsolicited native adapter output')
    adapter=module
    result=adapter.authorize(request)
   else: result=json.loads(output)
  else: result=adapter.authorize(request)
 except Exception as e: result={'authorized':False,'reason':str(e)}
 print(json.dumps(result,sort_keys=True),flush=True)
`;
    const child = spawn(python, ['-u', '-c', code, script], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    let buffer = '', failure: Error | undefined, hasExited = false;
    const stderr = createBoundedNativeDiagnostic();
    const worker = {};
    const pending: { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }[] = [];
    const fail = (error: Error) => { failure ??= error; for (const p of pending.splice(0)) { clearTimeout(p.timer); p.reject(failure); } };
    const stopUnknown = (error: Error) => {
      if (!hasExited) { markNativeWorkerUnsettled(worker); child.kill(); }
      fail(error);
    };
    child.on('error', fail);
    child.stdin.on('error', error => stopUnknown(error));
    const exited = new Promise<void>(resolve => child.on('close', code => {
      hasExited = true; settleNativeWorker(worker);
      if (buffer.length) fail(new Error('Unterminated unsolicited native stdout; effect unknown'));
      if (code !== 0 || pending.length) fail(new Error(stderr.message() || 'Native authorization worker exited; effect unknown'));
      resolve();
    }));
    child.stderr.on('data', b => { if (!stderr.append(b) && !failure) stopUnknown(new Error('Native stderr budget; effect unknown')); });
    child.stdout.on('data', b => {
      if (failure) return; // Drain without parsing/retaining late unknown output.
      if (Buffer.byteLength(buffer) + b.length > transportLimit()) { stopUnknown(new Error('Native response budget; effect unknown')); return; }
      buffer += b;
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        const p = pending.shift(); if (!p) { stopUnknown(new Error('Unsolicited native response; effect unknown')); return; }
        clearTimeout(p.timer);
        try { const result = JSON.parse(line); if (result.authorized !== true) throw new Error(result.reason || 'Native policy refused'); p.resolve(result); } catch (e) { p.reject(e instanceof Error ? e : new Error(String(e))); }
      }
    });
    return {
      request: (input: unknown): Promise<any> => new Promise((resolve, reject) => {
        if (failure) { reject(failure); return; }
        const encoded = JSON.stringify(input) + '\n';
        if (Buffer.byteLength(encoded) > transportLimit()) { reject(new Error('Native request budget')); return; }
        const timer = setTimeout(() => stopUnknown(new Error('Native request deadline exceeded; effect unknown')), requestTimeoutMs);
        timer.unref();
        pending.push({ resolve, reject, timer });
        child.stdin.write(encoded, error => { if (error) stopUnknown(error); });
      }),
      close: async () => {
        child.stdin.end();
        let timer: NodeJS.Timeout | undefined;
        try {
          await Promise.race([exited, new Promise<void>((_, reject) => {
            timer = setTimeout(() => { const error = new Error('Native close deadline exceeded; terminal state unknown'); stopUnknown(error); reject(error); }, closeTimeoutMs);
            timer.unref();
          })]);
          if (failure) throw failure;
        } finally { clearTimeout(timer); }
      }
    };
  };
  return {
    run: async <T>(fn: () => Promise<T>): Promise<T> => {
      assertNativeWorkersSettled();
      if (sessions.getStore()) return fn();
      const scope: { worker?: Session } = {};
      return finish(() => sessions.run(scope, fn), () => scope.worker?.close());
    },
    request: async (input: unknown) => {
      assertNativeWorkersSettled();
      const session = sessions.getStore();
      if (session) return (session.worker ??= start()).request(input);
      const own = start(); return finish(() => own.request(input), () => own.close());
    }
  };
};
