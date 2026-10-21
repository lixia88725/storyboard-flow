import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';

const python = 'python3';

test('pure serialized observation does not resolve or start a native interpreter', async () => {
  const session = createNativeAuthorizationSession(undefined as any, undefined as any, () => { throw new Error('No native budget'); });
  expect(await session.run(async () => session.run(async () => 'observed'))).toBe('observed');
});

test('stdin EOF CLI adapters execute each immutable native policy request and preserve refusal without importing as a library', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-cli-session-'));
  try {
    const source = path.join(root, 'source.png'), script = path.join(root, 'adapter.py'), log = path.join(root, 'requests.jsonl');
    await fs.writeFile(source, await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).png().toBuffer(), { mode: 0o600 });
    // Same CLI-only stdin/EOF contract as the original native readback fault port.
    await fs.writeFile(script, `import sys,json,subprocess,os\nr=json.load(sys.stdin)\nwith open(${JSON.stringify(log)},'a') as f: f.write(json.dumps({'pid':os.getpid(),'phase':r['phase']})+'\\n')\np=subprocess.run([${JSON.stringify(python)},${JSON.stringify(path.resolve('scripts/recovery-content-permissions.py'))}],input=json.dumps(r),text=True,capture_output=True)\nsys.stdout.write(p.stdout);sys.stderr.write(p.stderr);sys.exit(p.returncode)\n`);
    const session = createNativeAuthorizationSession(python, script, () => 1048576);
    const request = { phase: 'capturePolicy', sources: [source], sourceByteLimit: 1048576 };
    await session.run(async () => {
      expect((await session.request(request)).sourcePolicy.expected.mode).toBe(0o600);
      await fs.chmod(source, 0o400);
      expect((await session.request(request)).sourcePolicy.expected.mode).toBe(0o400);
      await fs.chmod(source, 0o700);
      await expect(session.request(request)).rejects.toThrow(/executable|special/);
    });
    const calls = (await fs.readFile(log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map(call => call.pid)).size).toBe(1);
    expect(() => process.kill(calls[0].pid, 0)).toThrow();
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 120000);
