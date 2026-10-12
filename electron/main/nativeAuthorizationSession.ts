import { AsyncLocalStorage } from 'node:async_hooks';
import { spawn } from 'node:child_process';

// One interpreter per fixed Main operation, not a policy/result cache. Every
// request still executes the original adapter and all its native inspections.
export const createNativeAuthorizationSession = (python: string, script: string, byteLimit: () => number) => {
  const sessions = new AsyncLocalStorage<{ request: (input: unknown) => Promise<any>; close: () => Promise<void> }>();
  const start = () => {
    const code = `import importlib.util,json,sys\ns=importlib.util.spec_from_file_location('adapter',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\nfor line in sys.stdin:\n try: result=m.authorize(json.loads(line))\n except Exception as e: result={'authorized':False,'reason':str(e)}\n print(json.dumps(result,sort_keys=True),flush=True)\n`;
    const child = spawn(python, ['-u', '-c', code, script], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    let buffer = '', stderr = '', failure: Error | undefined;
    const pending: { resolve: (value: any) => void; reject: (error: Error) => void }[] = [];
    const fail = (error: Error) => { failure = error; for (const p of pending.splice(0)) p.reject(error); };
    child.on('error', fail);
    const exited = new Promise<void>(resolve => child.on('close', code => { if (code !== 0 || pending.length) fail(new Error(stderr || 'Native authorization worker exited')); resolve(); }));
    child.stderr.on('data', b => { stderr += b; if (stderr.length > 65536) { fail(new Error('Native stderr budget')); child.kill(); } });
    child.stdout.on('data', b => {
      buffer += b;
      if (buffer.length > byteLimit()) { fail(new Error('Native response budget')); child.kill(); return; }
      for (;;) {
        const end = buffer.indexOf('\n'); if (end < 0) break;
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        const p = pending.shift(); if (!p) { fail(new Error('Unsolicited native response')); child.kill(); return; }
        try { const result = JSON.parse(line); if (result.authorized !== true) throw new Error(result.reason || 'Native policy refused'); p.resolve(result); } catch (e) { p.reject(e instanceof Error ? e : new Error(String(e))); }
      }
    });
    return {
      request: (input: unknown): Promise<any> => new Promise((resolve, reject) => {
        if (failure) { reject(failure); return; }
        pending.push({ resolve, reject });
        child.stdin.write(JSON.stringify(input) + '\n', error => { if (error) fail(error); });
      }),
      close: async () => { child.stdin.end(); await exited; }
    };
  };
  return {
    run: async <T>(fn: () => Promise<T>): Promise<T> => {
      if (sessions.getStore()) return fn();
      const session = start();
      try { return await sessions.run(session, fn); } finally { await session.close(); }
    },
    request: async (input: unknown) => {
      const session = sessions.getStore();
      if (session) return session.request(input);
      const own = start(); try { return await own.request(input); } finally { await own.close(); }
    }
  };
};
