import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { alive, recoverProfile, acquireGuard, releaseGuard, transferGuard } from './launch-locks.mjs';
const dead = () => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }); };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-launch-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = path.join(root, 'profile'); fs.mkdirSync(profile);
  const link = (name, target) => fs.symlinkSync(target, path.join(profile, name));
  return { root, profile, link, lock: path.join(profile, 'SingletonLock') };
}
test('ESRCH is dead, permissions are unknown', () => {
  assert.equal(alive(123, dead), false);
  assert.throws(() => alive(123, () => { throw Object.assign(new Error(), { code:'EPERM' }); }));
  assert.equal(alive(process.pid), true);
});
test('dead local instance: preserve links in backup, never touch their targets or project', t => {
  const f = fixture(t); const target = path.join(f.root, 'target'); fs.writeFileSync(target, 'keep');
  f.link('SingletonLock', `${os.hostname()}-123`); f.link('SingletonSocket', target); f.link('SingletonCookie', 'cookie');
  recoverProfile(f.profile, f.root, dead);
  assert.equal(fs.existsSync(f.lock), false);
  assert.equal(fs.readFileSync(target, 'utf8'), 'keep');
  const backup = fs.readdirSync(f.root).find(n => n.startsWith('stale-lock-'));
  assert.equal(fs.readlinkSync(path.join(f.root, backup, 'SingletonLock')), `${os.hostname()}-123`);
  assert.equal(fs.readdirSync(f.profile).length, 0);
});
test('live instance is untouched', t => {
  const f = fixture(t); f.link('SingletonLock', `${os.hostname()}-${process.pid}`);
  recoverProfile(f.profile, f.root); assert.equal(fs.lstatSync(f.lock).isSymbolicLink(), true);
});
test('foreign host and malformed lock are preserved', t => {
  const f = fixture(t); f.link('SingletonLock', 'other-host-123');
  assert.throws(() => recoverProfile(f.profile, f.root, dead)); assert.ok(fs.lstatSync(f.lock));
});
test('unexpected cookie file prevents any cleanup', t => {
  const f = fixture(t); f.link('SingletonLock', `${os.hostname()}-123`);
  fs.writeFileSync(path.join(f.profile, 'SingletonCookie'), 'keep');
  assert.throws(() => recoverProfile(f.profile, f.root, dead)); assert.ok(fs.lstatSync(f.lock));
});
test('changed lock prevents cleanup', t => {
  const f = fixture(t); f.link('SingletonLock', `${os.hostname()}-123`); let calls = 0;
  assert.throws(() => recoverProfile(f.profile, f.root, () => {
    if (++calls === 2) { fs.unlinkSync(f.lock); f.link('SingletonLock', `${os.hostname()}-${process.pid}`); }
    dead();
  }));
  assert.equal(fs.readlinkSync(f.lock), `${os.hostname()}-${process.pid}`);
});
test('guard refuses concurrent launch and only owner may release', t => {
  const f = fixture(t); const guard = path.join(f.root, 'guard');
  acquireGuard(guard, process.pid, f.root);
  assert.throws(() => acquireGuard(guard, 123, f.root));
  releaseGuard(guard, 123); assert.ok(fs.lstatSync(guard));
  releaseGuard(guard, process.pid); assert.equal(fs.existsSync(guard), false);
});
test('dead launcher guard recovered with evidence', t => {
  const f = fixture(t); const guard = path.join(f.root, 'guard'); fs.symlinkSync(`${os.hostname()}-123`, guard);
  acquireGuard(guard, process.pid, f.root, dead);
  assert.equal(fs.readlinkSync(guard), `${os.hostname()}-${process.pid}`);
  assert.ok(fs.readdirSync(f.root).some(n => n.startsWith('stale-launch-')));
});
test('legacy ambiguous directory guard is not removed', t => {
  const f = fixture(t); const guard = path.join(f.root, 'guard'); fs.mkdirSync(guard);
  assert.throws(() => acquireGuard(guard, process.pid, f.root, dead)); assert.ok(fs.statSync(guard).isDirectory());
});

test('startup child retains guard when launcher exits before ready', t => {
  const f = fixture(t); const guard = path.join(f.root, 'guard');
  acquireGuard(guard, 123, f.root);
  transferGuard(guard, 123, process.pid);
  releaseGuard(guard, 123);
  assert.throws(() => acquireGuard(guard, 456, f.root));
  releaseGuard(guard, process.pid);
  assert.equal(fs.existsSync(guard), false);
});

test('real shell launcher recovers dead lock, builds, launches and releases guard', async t => {
  const { spawnSync } = await import('node:child_process');
  const f = fixture(t);
  fs.copyFileSync(new URL('../启动 Storyboard Flow.command', import.meta.url), path.join(f.root, 'start.command'));
  fs.mkdirSync(path.join(f.root, 'scripts'));
  fs.copyFileSync(new URL('./launch-locks.mjs', import.meta.url), path.join(f.root, 'scripts/launch-locks.mjs'));
  for (const file of ['package.json','node_modules/typescript/bin/tsc','node_modules/vite/bin/vite.js']) {
    fs.mkdirSync(path.dirname(path.join(f.root, file)), { recursive:true }); fs.writeFileSync(path.join(f.root, file), '{}');
  }
  const electron = path.join(f.root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
  fs.mkdirSync(path.dirname(electron), { recursive:true });
  fs.writeFileSync(electron, '#!/bin/bash\nln -s "$(hostname)-$$" "$FLOW_USER_DATA_DIR/SingletonLock"\nsleep 1\nrm "$FLOW_USER_DATA_DIR/SingletonLock"\n', { mode:0o755 });
  const gone = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], {encoding:'utf8'});
  assert.equal(gone.status, 0);
  f.link('SingletonLock', `${os.hostname()}-${gone.stdout.trim()}`);
  const r = spawnSync('/bin/bash', ['-c', 'npm() { echo synthetic-build-ok; }; export -f npm; bash "$1"', 'test', path.join(f.root, 'start.command')], { env:{...process.env,FLOW_USER_DATA_DIR:f.profile}, encoding:'utf8', timeout:15000 });
  assert.equal(r.status, 0, r.stdout+r.stderr);
  assert.match(r.stdout, /已恢复异常退出/); assert.match(r.stdout, /synthetic-build-ok/); assert.match(r.stdout, /Storyboard Flow 已退出/);
  assert.equal(fs.existsSync(path.join(f.root,'.hermes/launch/start-in-progress')), false);
  // Failed builds also leave a complete log and release the guard.
  const failed = spawnSync('/bin/bash', ['-c', 'npm() { echo synthetic-build-failure; return 7; }; export -f npm; bash "$1"', 'test', path.join(f.root,'start.command')], { env:{...process.env,FLOW_USER_DATA_DIR:f.profile}, encoding:'utf8', timeout:15000 });
  assert.equal(failed.status, 7);
  const logs = fs.readdirSync(path.join(f.root,'.hermes/launch')).filter(n=>n.endsWith('.log'));
  assert.ok(logs.some(n=>fs.readFileSync(path.join(f.root,'.hermes/launch',n),'utf8').includes('synthetic-build-failure')));
  assert.equal(fs.existsSync(path.join(f.root,'.hermes/launch/start-in-progress')), false);
});
