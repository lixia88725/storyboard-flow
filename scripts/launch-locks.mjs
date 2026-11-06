import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export function alive(pid, probe = process.kill) {
  try { probe(pid, 0); return true; }
  catch (e) { if (e.code === 'ESRCH') return false; throw new Error(`无法确认进程 ${pid}（${e.code}），保留锁。`); }
}
function stat(file) {
  try { return fs.lstatSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
}
function snapshot(file) {
  const s = stat(file);
  if (!s) return null;
  if (!s.isSymbolicLink()) throw new Error(`锁类型异常，保留：${file}`);
  return { ino: s.ino, dev: s.dev, value: fs.readlinkSync(file) };
}
function same(file, before) {
  const now = snapshot(file);
  return JSON.stringify(now) === JSON.stringify(before);
}
function owner(value) {
  const match = /^(.*)-([1-9][0-9]*)$/.exec(value);
  if (!match || match[1] !== os.hostname() || !Number.isSafeInteger(Number(match[2]))) {
    throw new Error('无法确认锁属于本机，保留现场。');
  }
  return Number(match[2]);
}

// Move links themselves, never follow socket/cookie targets or delete profile data.
export function recoverProfile(profile, logs, probe) {
  const lock = path.join(profile, 'SingletonLock');
  const original = snapshot(lock);
  if (!original) return;
  const pid = owner(original.value);
  if (alive(pid, probe)) return;
  const entries = ['SingletonCookie', 'SingletonSocket', 'SingletonLock'].map(name => {
    const file = path.join(profile, name);
    return { name, file, state: snapshot(file) };
  });
  if (!same(lock, original) || alive(pid, probe)) throw new Error('实例状态已变化，取消锁恢复，请重试。');
  const backup = fs.mkdtempSync(path.join(logs, 'stale-lock-'));
  for (const entry of entries) {
    if (!same(lock, original) || alive(pid, probe) || !same(entry.file, entry.state)) {
      throw new Error(`锁在恢复期间变化，已停止；备份：${backup}`);
    }
    if (entry.state) fs.renameSync(entry.file, path.join(backup, entry.name));
  }
  console.log(`已恢复异常退出的实例锁；备份：${backup}`);
}

// A symlink is installed atomically: no empty-directory / missing-PID window.
export function acquireGuard(guard, pid, logs, probe) {
  const value = `${os.hostname()}-${pid}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { fs.symlinkSync(value, guard); return; }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    const before = snapshot(guard);
    if (!before) continue;
    if (alive(owner(before.value), probe)) throw new Error('已有启动流程正在运行，请等待它完成。');
    // Serialize stale takeover so another launcher cannot replace our inspected link.
    const recovery = `${guard}.recovering`;
    try { fs.mkdirSync(recovery); }
    catch (e) { if (e.code === 'EEXIST') throw new Error('其他启动流程正在恢复锁，请稍后重试。'); throw e; }
    try {
      if (!same(guard, before) || alive(owner(before.value), probe)) continue;
      const backup = fs.mkdtempSync(path.join(logs, 'stale-launch-'));
      fs.renameSync(guard, path.join(backup, 'owner'));
      console.log(`已恢复中断的启动流程；备份：${backup}`);
    } finally { fs.rmdirSync(recovery); }
  }
  throw new Error('启动锁持续变化，请稍后重试。');
}
export function transferGuard(guard, pid, child) {
  if (snapshot(guard)?.value !== `${os.hostname()}-${pid}`) throw new Error('启动锁已变化。');
  const next = `${guard}.${pid}.next`;
  fs.symlinkSync(`${os.hostname()}-${child}`, next);
  try { fs.renameSync(next, guard); } finally { if (stat(next)) fs.unlinkSync(next); }
}
export function releaseGuard(guard, pid) {
  const current = snapshot(guard);
  if (current?.value === `${os.hostname()}-${pid}`) fs.unlinkSync(guard);
}
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    const [action, a, b, c] = process.argv.slice(2);
    if (action === 'profile') recoverProfile(a, b);
    else if (action === 'acquire') acquireGuard(a, Number(b), c);
    else if (action === 'release') releaseGuard(a, Number(b));
    else if (action === 'transfer') transferGuard(a, Number(b), Number(c));
    else throw new Error('未知启动锁操作');
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}
