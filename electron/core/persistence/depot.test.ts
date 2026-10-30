import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { FlowAssetDepotOptions, FlowResult } from '../../shared/flowWave2.js';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import * as platform from '../platform/index';
import { openFlowAssetDepot } from './depot';
import { createProjectStore } from './index';
import { withRootLock } from './lock';
import { clone, picture, readerFor, scene, sha256, storePaths, type Picture } from './store.fixture';

afterEach(() => vi.restoreAllMocks());
const value = <T>(result: FlowResult<T>): T => {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const open = async (root: string, extra: Partial<FlowAssetDepotOptions> = {}) => value(await openFlowAssetDepot({
  root, sessionId: 'session', maxPngBytes: 1024 * 1024, maxPixels: 10000, ...extra
}));
const input = (source: Picture, operationId = 'op-1') => ({ operationId, png: source.bytes, width: source.width, height: source.height });
const file = (root: string, id: string) => path.join(storePaths(root).assets, `${id}.png`);
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
};

describe('Flow asset depot admission and lifetime', () => {
  it('opens a fresh root without writing and puts only an immutable PNG, never head/versions', async () => {
    const root = await temporaryWorkspace('depot-fresh-');
    const depot = await open(root);
    expect(await fs.readdir(root)).toEqual([]);
    const source = await picture(40);
    const receipt = value(await depot.put(input(source)));
    expect(receipt).toEqual({ sessionId: 'session', operationId: 'op-1', assetId: source.id,
      width: 8, height: 6, byteLength: source.bytes.length,
      directorySync: platform.currentPlatformKind === 'win32' ? 'skipped' : 'synced' });
    expect(await fs.readFile(file(root, source.id))).toEqual(source.bytes);
    expect(await fs.readdir(storePaths(root).store)).toEqual(['assets']);
    const read = value(await depot.read(source.id));
    read.fill(0);
    receipt.assetId = 'mutated';
    expect(value(await depot.read(source.id))).toEqual(new Uint8Array(source.bytes));
    expect(value(await depot.put(input(source))).assetId).toBe(source.id);
  });

  it('does not treat a corrupt/unsupported/unreadable checkpoint or missing reference as a new root', async () => {
    const root = await temporaryWorkspace('depot-bad-head-');
    const paths = storePaths(root);
    await fs.mkdir(paths.store, { recursive: true });
    await fs.writeFile(paths.manifest, '{broken');
    expect(await openFlowAssetDepot({ root, sessionId: 's', maxPixels: 100, maxPngBytes: 1000 })).toMatchObject({ ok: false, error: { effect: 'none' } });
    expect(await fs.readFile(paths.manifest, 'utf8')).toBe('{broken');
    await fs.writeFile(paths.manifest, JSON.stringify({ schema: 'storyboard-flow.project', version: 99 }));
    expect(await openFlowAssetDepot({ root, sessionId: 's', maxPixels: 100, maxPngBytes: 1000 })).toMatchObject({ ok: false, error: { code: 'unsupported-version' } });
    const other = await temporaryWorkspace('depot-missing-ref-');
    const { project, assets } = await scene();
    expect((await createProjectStore().saveCheckpoint(other, project, readerFor(assets))).ok).toBe(true);
    await fs.unlink(file(other, [...assets.keys()][0]));
    expect(await openFlowAssetDepot({ root: other, sessionId: 's', maxPixels: 100, maxPngBytes: 1000 })).toMatchObject({ ok: false, error: { code: 'missing-asset' } });
    if (process.getuid?.() !== 0) {
      await fs.chmod(paths.manifest, 0o000);
      try {
        expect(await openFlowAssetDepot({ root, sessionId: 's', maxPixels: 100, maxPngBytes: 1000 })).toMatchObject({ ok: false, error: { code: 'io-failure', effect: 'none' } });
      } finally { await fs.chmod(paths.manifest, 0o600); }
    }
  });

  it.each([0, -1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid limits %s without writing', async limit => {
    const root = await temporaryWorkspace('depot-limits-');
    for (const extra of [{ maxPixels: limit }, { maxPngBytes: limit }]) {
      expect(await openFlowAssetDepot({ root, sessionId: 's', maxPixels: 100, maxPngBytes: 1000, ...extra })).toMatchObject({ ok: false, error: { code: 'invalid-input', effect: 'none' } });
    }
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('checks input ids, bytes, dimensions, metadata and full pixels before publication', async () => {
    const root = await temporaryWorkspace('depot-admission-');
    const source = await picture(10);
    const depot = await open(root, { maxPixels: 48, maxPngBytes: source.bytes.length });
    for (const patch of [{ operationId: '' }, { operationId: '\0' }, { width: 0 }, { height: 1.2 }, { png: new Uint8Array() }]) {
      expect(await depot.put({ ...input(source), ...patch })).toMatchObject({ ok: false, error: { code: 'invalid-input', effect: 'none' } });
    }
    expect(await depot.put({ ...input(source), width: 100 })).toMatchObject({ ok: false, error: { code: 'resource-limit', effect: 'none' } });
    expect(await depot.put({ ...input(source), png: Buffer.alloc(source.bytes.length + 1) })).toMatchObject({ ok: false, error: { code: 'resource-limit', effect: 'none' } });
    expect(await depot.put({ ...input(source, 'wrong-size'), width: 7 })).toMatchObject({ ok: false, error: { code: 'invalid-input', effect: 'none' } });
    const jpeg = await sharp(source.bytes).jpeg().toBuffer();
    const roomy = await open(root);
    expect(await roomy.put({ ...input(source, 'jpeg'), png: jpeg })).toMatchObject({ ok: false, error: { code: 'invalid-input', effect: 'none' } });
    expect(await roomy.put({ ...input(source, 'truncated'), png: source.bytes.subarray(0, 48) })).toMatchObject({ ok: false, error: { code: 'invalid-input', effect: 'none' } });
    expect(await fs.readdir(root)).toEqual([]);
    value(await depot.put(input(source, 'valid')));
  });

  it('snapshots options and input before await, and keeps operation identity across failed retries', async () => {
    const root = await temporaryWorkspace('depot-snapshot-');
    const options = { root, sessionId: 'first', maxPixels: 100, maxPngBytes: 10000 };
    const opening = openFlowAssetDepot(options);
    options.sessionId = 'changed'; options.root = '/not-used'; options.maxPixels = 1;
    const depot = value(await opening);
    const source = await picture(70);
    const request = input(source);
    const copied = Buffer.from(source.bytes);
    const putting = depot.put(request);
    request.png.fill(0); request.width = 1; request.operationId = 'other';
    expect(value(await putting)).toMatchObject({ sessionId: 'first', operationId: 'op-1', assetId: sha256(copied), width: 8 });
    expect(value(await depot.read(sha256(copied)))).toEqual(new Uint8Array(copied));
    const different = await picture(71);
    expect(await depot.put(input(different))).toMatchObject({ ok: false, error: { code: 'conflict', effect: 'none' } });
    expect(await depot.put({ ...input(different, 'dimensions'), width: 7 })).toMatchObject({ ok: false });
    expect(await depot.put(input(different, 'dimensions'))).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('idempotent success re-verifies blobs and refuses tampering/deletion instead of replaying a receipt', async () => {
    const root = await temporaryWorkspace('depot-idempotence-');
    const depot = await open(root);
    const source = await picture(15);
    value(await depot.put(input(source)));
    value(await depot.put(input(source)));
    await fs.writeFile(file(root, source.id), 'tampered');
    expect(await depot.put(input(source))).toMatchObject({ ok: false, error: { code: 'conflict', effect: 'none' } });
    expect(await depot.read(source.id)).toMatchObject({ ok: false, error: { code: 'conflict', effect: 'none' } });
    expect(await fs.readFile(file(root, source.id), 'utf8')).toBe('tampered');
    await fs.unlink(file(root, source.id));
    expect(await depot.put(input(source))).toMatchObject({ ok: false, error: { code: 'missing-asset', effect: 'none' } });
    await expect(fs.lstat(file(root, source.id))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('restricts each depot to initial checkpoint references plus its successful puts, retaining old ids after a new head', async () => {
    const root = await temporaryWorkspace('depot-eligibility-');
    const { project, assets } = await scene();
    const store = createProjectStore();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    const depot = await open(root);
    const oldId = [...assets.keys()][0];
    expect(value(await depot.read(oldId))).toEqual(new Uint8Array(assets.get(oldId)!));
    expect(await depot.read('../escape')).toMatchObject({ ok: false, error: { code: 'invalid-input', effect: 'none' } });
    expect(await depot.read('a'.repeat(64))).toMatchObject({ ok: false, error: { code: 'not-found', effect: 'none' } });
    const fresh = await picture(200);
    value(await depot.put(input(fresh)));
    const other = await open(root);
    expect(await other.read(fresh.id)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    const next = clone(project); next.revision++;
    next.images['image-1'].layers[0].assetId = fresh.id;
    expect((await store.saveCheckpoint(root, next, async id => value(await depot.read(id)))).ok).toBe(true);
    value(await depot.read(oldId));
    value(await depot.read(fresh.id));
    value(await (await open(root)).read(fresh.id));
    const orphan = await picture(201);
    value(await depot.put(input(orphan, 'orphan')));
    expect(await (await open(root)).read(orphan.id)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await fs.readFile(file(root, orphan.id))).toEqual(orphan.bytes);
  });

  it('shares the checkpoint root queue, bounds waiting inputs, and serializes competing depots', async () => {
    const root = await temporaryWorkspace('depot-concurrent-');
    const depot = await open(root), other = await open(root);
    const source = await picture(22);
    const waiting = gate(), entered = gate();
    const locked = withRootLock(root, async () => { entered.release(); await waiting.promise; });
    await entered.promise;
    const puts = Array.from({ length: 8 }, (_, i) => depot.put(input(source, `op-${i}`)));
    expect(await depot.put(input(source, 'excess'))).toMatchObject({ ok: false, error: { code: 'busy', effect: 'none' } });
    const competitor = other.put(input(source));
    expect(await fs.readdir(root)).toEqual([]);
    waiting.release(); await locked;
    for (const result of await Promise.all([...puts, competitor])) value(result);
    expect(await fs.readdir(storePaths(root).assets)).toEqual([`${source.id}.png`]);
  });

  it('refuses linked roots, linked directories/blob entries and a replaced root binding', async () => {
    const root = await temporaryWorkspace('depot-paths-');
    const alias = root + '-alias'; await fs.symlink(root, alias);
    expect(await openFlowAssetDepot({ root: alias, sessionId: 's', maxPixels: 100, maxPngBytes: 1000 })).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    const depot = await open(root), source = await picture(30);
    const outside = root + '-outside'; await fs.mkdir(outside);
    await fs.mkdir(storePaths(root).store, { recursive: true });
    await fs.symlink(outside, storePaths(root).assets);
    expect(await depot.put(input(source))).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await fs.readdir(outside)).toEqual([]);
    await fs.unlink(storePaths(root).assets); await fs.mkdir(storePaths(root).assets);
    const target = path.join(outside, 'original.png'); await fs.writeFile(target, source.bytes);
    await fs.symlink(target, file(root, source.id));
    expect(await depot.put(input(source))).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await fs.readFile(target)).toEqual(source.bytes);
    await fs.unlink(file(root, source.id)); value(await depot.put(input(source)));
    await fs.rename(root, root + '-old'); await fs.mkdir(root);
    expect(await depot.read(source.id)).toMatchObject({ ok: false, error: { code: 'conflict', effect: 'none' } });
    expect(await depot.put(input(source, 'replacement'))).toMatchObject({ ok: false, error: { code: 'conflict', effect: 'none' } });
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('reports denied writes without widening permissions and never gives failed puts read eligibility', async () => {
    const root = await temporaryWorkspace('depot-permission-');
    const depot = await open(root), source = await picture(38);
    await fs.mkdir(storePaths(root).assets, { recursive: true });
    if (process.getuid?.() === 0) return; // Root bypasses this real permission fixture.
    await fs.chmod(storePaths(root).assets, 0o500);
    try {
      expect(await depot.put(input(source))).toMatchObject({ ok: false, error: { code: 'io-failure', effect: 'unknown' } });
      expect((await fs.stat(storePaths(root).assets)).mode & 0o777).toBe(0o500);
      expect(await depot.read(source.id)).toMatchObject({ ok: false, error: { code: 'not-found', effect: 'none' } });
    } finally { await fs.chmod(storePaths(root).assets, 0o700); }
    value(await depot.put(input(source)));
  });
});

describe('asset directory publication flush', () => {
  it('keeps an uncertain link effect without granting reads, and retries only its original input', async () => {
    const root = await temporaryWorkspace('depot-unknown-link-');
    const depot = await open(root), source = await picture(45);
    const realLink = platform.linkExclusive;
    vi.spyOn(platform, 'linkExclusive').mockImplementationOnce(async (from, to) => {
      await realLink(from, to);
      throw new Error('completion lost after link');
    });
    expect(await depot.put(input(source))).toMatchObject({ ok: false, error: { code: 'io-failure', effect: 'unknown' } });
    expect(await fs.readFile(file(root, source.id))).toEqual(source.bytes);
    expect(await depot.read(source.id)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await depot.put(input(await picture(46)))).toMatchObject({ ok: false, error: { code: 'conflict', effect: 'none' } });
    value(await depot.put(input(source)));
    expect(value(await depot.read(source.id))).toEqual(new Uint8Array(source.bytes));
  });

  it('verifies a raced EEXIST blob and flushes before issuing its receipt', async () => {
    const root = await temporaryWorkspace('depot-raced-blob-');
    const depot = await open(root), source = await picture(48);
    const realLink = platform.linkExclusive;
    vi.spyOn(platform, 'linkExclusive').mockImplementationOnce(async (from, to) => {
      await realLink(from, to);
      throw Object.assign(new Error('raced immutable publication'), { code: 'EEXIST' });
    });
    const sync = vi.spyOn(platform, 'syncDirectory');
    value(await depot.put(input(source)));
    expect(sync).toHaveBeenCalledWith(storePaths(root).assets);
    expect(await fs.readdir(storePaths(root).assets)).toEqual([`${source.id}.png`]);
  });

  it('retries a retained blob after flush failure, including existing-blob and idempotent paths', async () => {
    const root = await temporaryWorkspace('depot-flush-');
    const depot = await open(root), source = await picture(50);
    const sync = vi.spyOn(platform, 'syncDirectory').mockRejectedValueOnce(new Error('asset flush failed'));
    expect(await depot.put(input(source))).toMatchObject({ ok: false, error: { code: 'io-failure', effect: 'retained' } });
    expect(await fs.readFile(file(root, source.id))).toEqual(source.bytes);
    expect(await depot.read(source.id)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(sync).toHaveBeenCalledWith(storePaths(root).assets);
    value(await depot.put(input(source)));
    sync.mockRejectedValueOnce(new Error('reuse flush failed'));
    expect(await depot.put(input(source))).toMatchObject({ ok: false, error: { code: 'io-failure', effect: 'none' } });
    value(await depot.put(input(source)));
    expect(sync).toHaveBeenCalledTimes(4);
    expect(await fs.readdir(storePaths(root).store)).toEqual(['assets']);
  });

  it('reports a skipped platform flush explicitly without claiming POSIX durability', async () => {
    const root = await temporaryWorkspace('depot-skipped-flush-');
    const depot = await open(root), source = await picture(53);
    vi.spyOn(platform, 'syncDirectory').mockResolvedValue('skipped');
    expect(value(await depot.put(input(source))).directorySync).toBe('skipped');
  });

  it('flushes checkpoint assets before version/head and retries reuse after a failed flush', async () => {
    const root = await temporaryWorkspace('depot-checkpoint-flush-');
    const { project, assets } = await scene();
    const store = createProjectStore();
    const sync = vi.spyOn(platform, 'syncDirectory').mockRejectedValueOnce(new Error('flush fault'));
    expect(await store.saveCheckpoint(root, project, readerFor(assets))).toMatchObject({ ok: false, error: { code: 'io-failure' } });
    await expect(fs.stat(storePaths(root).manifest)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    const calls = sync.mock.calls.map(([directory]) => directory);
    expect(calls.slice(0, 1 + assets.size)).toEqual(Array(1 + assets.size).fill(storePaths(root).assets));
    expect(calls.slice(-2)).toEqual([storePaths(root).versions, storePaths(root).store]);
    sync.mockClear();
    expect((await store.saveCheckpoint(root, project, readerFor(assets))).ok).toBe(true);
    expect(sync.mock.calls.map(([directory]) => directory)).toEqual(Array(assets.size).fill(storePaths(root).assets));
  });
});
