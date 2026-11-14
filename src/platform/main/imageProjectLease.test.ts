import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { acquireImageProjectLease } from './imageProjectLease';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';

const binary = process.env.FLOW_PROJECT_LEASE_BINARY!;
const windows = process.platform === 'win32';
let harness: string;
beforeAll(async () => {
  if (!binary || !path.isAbsolute(binary)) throw Error('Build real native lease guard and set FLOW_PROJECT_LEASE_BINARY; no fake fallback');
  harness = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'flow-project-lease-harness-'));
  await build({ entryPoints: [path.resolve('src/platform/main/imageProjectLease.ts')], outfile: path.join(harness, 'adapter.cjs'), bundle: true, platform: 'node', format: 'cjs' });
  await fs.writeFile(path.join(harness, 'owner.cjs'), `
const {acquireImageProjectLease}=require('./adapter.cjs');
let lease, loss, lost, resolveLoss;const reply=(id,result)=>process.send({id,...result});
process.on('message',async m=>{try{
 if(m.kind==='acquire'){lost=new Promise(r=>resolveLoss=r);lease=await acquireImageProjectLease({root:process.env.LEASE_ROOT,binary:process.env.FLOW_PROJECT_LEASE_BINARY,onInvalidated:v=>{loss=v;resolveLoss(v)}});reply(m.id,{ok:true,guardPid:lease.guardPid,ownerPid:process.pid});}
 else if(m.kind==='check'){await lease.assertHeld();reply(m.id,{ok:true});}
 else if(m.kind==='release'){await lease.release();reply(m.id,{ok:true});}
 else if(m.kind==='killGuard'){process.kill(lease.guardPid,'SIGKILL');await lost;reply(m.id,{ok:true,held:lease.held,loss});}
 else if(m.kind==='quit'){if(lease?.held)await lease.release();reply(m.id,{ok:true});process.exit(0);}
}catch(e){reply(m.id,{ok:false,error:String(e),held:lease?.held,loss});}});
`);
});
afterAll(async () => { if (harness) await fs.rm(harness, { recursive: true }); });
async function fixture(root: string) {
  const child = fork(path.join(harness, 'owner.cjs'), [], { env: { ...process.env, LEASE_ROOT: root }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const pending = new Map<number, (v: any) => void>(); let seq = 0, output = '';
  child.stdout?.on('data', b => { output = (output + b).slice(-4096); }); child.stderr?.on('data', b => { output = (output + b).slice(-4096); });
  child.on('message', (v: any) => { const fn = pending.get(v.id); pending.delete(v.id); fn?.(v); });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  return {
    child, closed,
    request(kind: string): Promise<any> {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { pending.delete(id); reject(Error('Main fixture timeout: ' + kind + ' ' + output)); }, 8000);
        pending.set(id, result => { clearTimeout(timeout); resolve(result); }); child.send({ id, kind });
      });
    },
    async stop() { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await closed; },
  };
}
const namespace = (root: string) => path.join(root, '.storyboard-flow', 'image-project-v2');
const owner = (root: string) => path.join(namespace(root), 'owner.json');
const lock = (root: string) => path.join(namespace(root), 'writer.lock');
async function waitForGone(pid: number) {
  const deadline = Date.now() + 4000;
  for (;;) {
    try { process.kill(pid, 0); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return; throw error; }
    if (Date.now() > deadline) throw Error('Owned guard did not exit');
    // This waits for observed process exit; it never grants ownership by elapsed time.
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

describe('real project OS lock and durable Main owner', () => {
  it('makes two independent Main processes contend, preserves lock inode, and releases normally', async () => {
    const root = await temporaryWorkspace('project-lease-contention-'), a = await fixture(root), b = await fixture(root);
    try {
      const first = await a.request('acquire'); expect(first.ok).toBe(true); const inode = (await fs.stat(lock(root))).ino;
      expect((await b.request('acquire')).ok).toBe(false); expect((await a.request('check')).ok).toBe(true);
      expect((await a.request('release')).ok).toBe(true); expect(JSON.parse(await fs.readFile(owner(root), 'utf8')).state).toBe('released');
      expect((await b.request('acquire')).ok).toBe(true); expect((await b.request('release')).ok).toBe(true);
      expect((await fs.stat(lock(root))).ino).toBe(inode); expect((await fs.stat(lock(root))).nlink).toBe(1);
    } finally { await a.stop(); await b.stop(); }
  });
  it('fails closed on guard-only SIGKILL while Main lives; another writer waits until that Main exits', async () => {
    const root = await temporaryWorkspace('project-lease-guard-loss-'), a = await fixture(root), b = await fixture(root);
    try {
      const acquired = await a.request('acquire'); expect(acquired.ok).toBe(true);
      const killed = await a.request('killGuard'); expect(killed).toMatchObject({ ok: true, held: false, loss: { effect: 'unknown' } });
      expect((await a.request('check')).ok).toBe(false); expect((await a.request('release')).ok).toBe(false);
      const marker = JSON.parse(await fs.readFile(owner(root), 'utf8')); expect(marker.state).toBe('held'); expect(marker.mainPid).toBe(a.child.pid);
      const refused = await b.request('acquire'); expect(refused.ok).toBe(false); expect(refused.error).toContain('previous Main owner');
      // Only our explicit Main fixture is killed, never an inferred PID from an arbitrary project.
      await a.stop(); expect((await b.request('acquire')).ok).toBe(true); expect((await b.request('release')).ok).toBe(true);
    } finally { await a.stop(); await b.stop(); }
  });
  it('reopens after the whole owned Main fixture dies; EOF never writes a released marker', async () => {
    const root = await temporaryWorkspace('project-lease-main-crash-'), a = await fixture(root), b = await fixture(root);
    try {
      const acquired = await a.request('acquire'); expect(acquired.ok).toBe(true);
      await a.stop(); await waitForGone(acquired.guardPid);
      expect(JSON.parse(await fs.readFile(owner(root), 'utf8')).state).toBe('held');
      expect((await b.request('acquire')).ok).toBe(true); expect((await b.request('release')).ok).toBe(true);
    } finally { await a.stop(); await b.stop(); }
  });
  it('refuses a live/reused PID marker and preserves unknown marker evidence', async () => {
    const root = await temporaryWorkspace('project-lease-unknown-owner-'); const lease = await acquireImageProjectLease({ root, binary }); await lease.release();
    const marker = JSON.parse(await fs.readFile(owner(root), 'utf8')); marker.state = 'held'; marker.mainPid = process.pid;
    await fs.writeFile(owner(root), JSON.stringify(marker)); await expect(acquireImageProjectLease({ root, binary })).rejects.toThrow('previous Main owner');
    const corrupt = '{unknown partial owner'; await fs.writeFile(owner(root), corrupt);
    await expect(acquireImageProjectLease({ root, binary })).rejects.toThrow(); expect(await fs.readFile(owner(root), 'utf8')).toBe(corrupt);
  });
  it('binds the authority to the precise project path/device/inode, not just a live guard', async () => {
    const root = await temporaryWorkspace('project-lease-binding-'), other = root + '-other'; await fs.mkdir(other);
    const stat = await fs.lstat(root, { bigint: true }), binding = { path: root, dev: String(stat.dev), ino: String(stat.ino) };
    const lease = await acquireImageProjectLease({ root, binary });
    try {
      await lease.assertHeld(binding);
      await expect(lease.assertHeld(null as never)).rejects.toThrow('root binding mismatch');
      await expect(lease.assertHeld({ ...binding, path: other })).rejects.toThrow('root binding mismatch');
      await expect(lease.assertHeld({ ...binding, ino: '0' })).rejects.toThrow('root binding mismatch');
      await expect(lease.assertHeld({ ...binding, dev: '0' })).rejects.toThrow('root binding mismatch');
      await lease.assertHeld(binding); expect(lease.held).toBe(true);
    } finally { await lease.release(); }
  });
  it('coalesces ownership checks, requires them drained before release, and makes release idempotent', async () => {
    const root = await temporaryWorkspace('project-lease-check-order-'); const lease = await acquireImageProjectLease({ root, binary });
    try {
      const a = lease.assertHeld(), b = lease.assertHeld(); expect(a).toBe(b);
      await expect(lease.release()).rejects.toThrow('pending ownership checks'); await a;
      const release = lease.release(); await expect(lease.assertHeld()).rejects.toThrow(); await release; await lease.release(); expect(lease.held).toBe(false);
    } finally { if (lease.held) await lease.release(); }
  });
});

describe('lease path and identity admission', () => {
  it('refuses a symbolic root or directory without creating a lock in its target', async () => {
    const root = await temporaryWorkspace('project-lease-symbolic-'), alias = root + '-alias'; await fs.symlink(root, alias, windows ? 'junction' : 'dir');
    await expect(acquireImageProjectLease({ root: alias, binary })).rejects.toThrow();
    const target = root + '-outside'; await fs.mkdir(target); await fs.symlink(target, path.join(root, '.storyboard-flow'), windows ? 'junction' : 'dir');
    await expect(acquireImageProjectLease({ root, binary })).rejects.toThrow(); expect(await fs.readdir(target)).toEqual([]);
  });
  it.each(['symlink', 'hardlink', 'directory'] as const)('refuses a %s writer.lock', async kind => {
    const root = await temporaryWorkspace('project-lease-file-kind-'); await fs.mkdir(namespace(root), { recursive: true });
    const target = root + '-target'; await fs.writeFile(target, 'preserve');
    if (kind === 'symlink') await fs.symlink(target, lock(root));
    else if (kind === 'hardlink') await fs.link(target, lock(root));
    else await fs.mkdir(lock(root));
    await expect(acquireImageProjectLease({ root, binary })).rejects.toThrow(); expect(await fs.readFile(target, 'utf8')).toBe('preserve');
  });
  it.each(['root', 'namespace', 'lock', 'owner'] as const)('protects an already-held guard when %s identity is replaced', async kind => {
    const root = await temporaryWorkspace('project-lease-path-change-'); let resolveLoss!: (v: unknown) => void;
    const lost = new Promise(resolve => { resolveLoss = resolve; }); const lease = await acquireImageProjectLease({ root, binary, onInvalidated: resolveLoss });
    if (windows && kind !== 'owner') {
      const target = kind === 'root' ? root : kind === 'namespace' ? namespace(root) : lock(root);
      try {
        await expect(fs.rename(target, target + '-preserved')).rejects.toThrow();
        await lease.assertHeld();
      } finally {
        if (lease.held) await lease.release();
      }
      return;
    }
    if (kind === 'root') { await fs.rename(root, root + '-preserved'); await fs.mkdir(root); }
    else if (kind === 'namespace') { await fs.rename(namespace(root), namespace(root) + '-preserved'); await fs.mkdir(namespace(root)); }
    else if (kind === 'lock') { await fs.rename(lock(root), lock(root) + '-preserved'); await fs.writeFile(lock(root), ''); }
    else { const bytes = await fs.readFile(owner(root)); await fs.rename(owner(root), owner(root) + '-preserved'); await fs.writeFile(owner(root), bytes); }
    await expect(lease.assertHeld()).rejects.toThrow(); expect(lease.held).toBe(false);
    expect(await lost).toMatchObject({ effect: 'unknown' }); await expect(lease.release()).rejects.toThrow('Invalidated');
    await waitForGone(lease.guardPid);
  });
  it.runIf(windows)('locks a Unicode path without changing its identity or invoking a shell', async () => {
    const parent = await temporaryWorkspace('project-lease-unicode-');
    const root = path.join(parent, '分镜 测试');
    await fs.mkdir(root);
    const a = await fixture(root), b = await fixture(root);
    try {
      expect((await a.request('acquire')).ok).toBe(true);
      expect((await b.request('acquire')).ok).toBe(false);
      expect((await a.request('release')).ok).toBe(true);
      expect((await b.request('acquire')).ok).toBe(true);
      expect((await b.request('release')).ok).toBe(true);
    } finally { await a.stop(); await b.stop(); }
  });
  it.each(['symlink', 'hardlink', 'directory'] as const)('refuses a %s owner marker without changing its target', async kind => {
    const root = await temporaryWorkspace('project-lease-owner-kind-'); const lease = await acquireImageProjectLease({ root, binary }); await lease.release();
    const target = root + '-owner-preserved'; await fs.rename(owner(root), target);
    if (kind === 'symlink') await fs.symlink(target, owner(root));
    else if (kind === 'hardlink') await fs.link(target, owner(root));
    else await fs.mkdir(owner(root));
    const before = await fs.readFile(target); await expect(acquireImageProjectLease({ root, binary })).rejects.toThrow();
    expect(await fs.readFile(target)).toEqual(before);
  });
  it('refuses copied ownership identity even if the previous marker says released', async () => {
    const root = await temporaryWorkspace('project-lease-copy-'); const lease = await acquireImageProjectLease({ root, binary }); await lease.release();
    const copy = root + '-copy'; await fs.cp(root, copy, { recursive: true });
    await expect(acquireImageProjectLease({ root: copy, binary })).rejects.toThrow('foreign, copied');
  });
});
