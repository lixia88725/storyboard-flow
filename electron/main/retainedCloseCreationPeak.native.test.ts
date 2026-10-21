import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { createWorkspaceRetainedCloseService } from './workspaceRetainedCloseService.js';
import { createOriginWorkspaceAccounting } from './originWorkspaceAccounting.js';
import { fixtureAttributeBytes } from './nativeAttributeMeter.fixture.js';

// Public legacy close composition, real native policy/copy and joint allocator.
// The synthetic Electron caller is not mounted App/GUI or actual Close evidence.
test('legacy ordinary-close reserves actual copied source attributes without changing its v1 format or sources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-close-peak-root-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-close-peak-data-'));
  const metadata = path.join(root, '.storyboard-workbench');
  const bitmapPath = '.storyboard-workbench/layers/s/l.png';
  await fs.mkdir(path.dirname(path.join(root, bitmapPath)), { recursive: true, mode: 0o700 });
  const pixels = randomBytes(100 * 100 * 4);
  const png = await sharp(pixels, { raw: { width: 100, height: 100, channels: 4 } }).png().toBuffer();
  const image = path.join(root, 'synthetic.tiff');
  const tiff = await sharp(pixels, { raw: { width: 100, height: 100, channels: 4 } }).tiff({ compression: 'none' }).toBuffer();
  const project = { shots: [{ id: 's', imagePath: image, layers: [{ id: 'l', bitmapPath }] }], futureRaw: ['preserved'] };
  const sourceBodies = [[image, tiff], [path.join(root, bitmapPath), png], [path.join(metadata, 'storyboard.project.json'), Buffer.from(JSON.stringify(project))]] as const;
  const attributeHex = Buffer.alloc(16384, 0x61).toString('hex');
  for (const [file, bytes] of sourceBodies) {
    await fs.writeFile(file, bytes, { mode: 0o600 });
    execFileSync('/usr/bin/xattr', ['-w', '-x', 'org.storyboard.legacy-close-peak', attributeHex, file]);
    // Fixture construction only: establish readonly after adding its metadata.
    await fs.chmod(file, 0o400);
  }
  const python = 'python3';
  const budget = { bytes: 2 * 1024 * 1024, records: 100, assets: 16, jsonDepth: 80 };
  const accounting = createOriginWorkspaceAccounting({ userData: () => userData, python, script: path.resolve('scripts/recovery-origin-permissions.py') });
  const claims: number[] = [], reserve = accounting.reserve;
  accounting.reserve = async (r, b, bytes, records, operation) => {
    claims.push(bytes);
    return reserve(r, b, bytes, records, operation);
  };
  const options = { python, script: path.resolve('scripts/recovery-content-permissions.py'), budget, accounting };
  const frame = {}, sender = { mainFrame: frame };
  const capture = {
    folderPath: root,
    content: { projectRaw: project, sequence: 4, assetRevision: 2, desiredAssets: [], effectFacts: { unsettled: true, receipt: [], deletions: [], remainingScript: null, error: { message: 'original failure' } } },
    canvas: { captures: [], hasUnsettledGesture: false }, selectedShotIds: ['s'], dirtyShotIds: ['s'], fileNameSyncState: 'pending', workspaceSaveState: 'error'
  };
  expect(await createWorkspaceRetainedCloseService(options).certifyRetained({ sender, senderFrame: frame } as any, capture)).toBe(true);
  const base = path.join(metadata, 'workspace-recovery-v1');
  let minimum = 0, alias = 0;
  for (const relative of ['', ...await fs.readdir(base, { recursive: true })]) {
    const file = path.join(base, relative), stat = await fs.lstat(file);
    if (stat.isDirectory()) minimum += 32768;
    else {
      const floor = Math.max(32768, stat.size + fixtureAttributeBytes(file));
      minimum += floor; alias = Math.max(alias, floor);
    }
  }
  expect(claims).toHaveLength(1);
  expect(claims[0]).toBeGreaterThanOrEqual(minimum + alias);
  const namespace = JSON.parse(await fs.readFile(path.join(base, 'namespace.json'), 'utf8'));
  expect(namespace.version).toBe(1); expect(namespace).not.toHaveProperty('sourcePolicy');
  const cold = await createWorkspaceRetainedCloseService(options).readReadonly(root);
  expect(cold.projectRaw).toEqual(project); expect(cold.effectFacts).toEqual(capture.content.effectFacts);
  expect(cold.assets.map(a => a.dataUrl)).toEqual(['data:image/tiff;base64,' + tiff.toString('base64'), 'data:image/png;base64,' + png.toString('base64')]);
  for (const [file, bytes] of sourceBodies) {
    expect(await fs.readFile(file)).toEqual(bytes); expect((await fs.stat(file)).mode & 0o777).toBe(0o400);
    expect(execFileSync('/usr/bin/xattr', ['-p', '-x', 'org.storyboard.legacy-close-peak', file], { encoding: 'utf8' }).replace(/\s/g, '').toLowerCase()).toBe(attributeHex);
  }
}, 120000);

test('legacy close refuses fresh source attribute growth after reserving instead of copying an unquoted policy', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-close-growth-root-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'legacy-close-growth-data-'));
  const metadata = path.join(root, '.storyboard-workbench'), bitmapPath = '.storyboard-workbench/layers/s/l.png';
  await fs.mkdir(path.dirname(path.join(root, bitmapPath)), { recursive: true, mode: 0o700 });
  const png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#123456' } }).png().toBuffer();
  const image = path.join(root, 'synthetic.png'), project = { shots: [{ id: 's', imagePath: image, layers: [{ id: 'l', bitmapPath }] }] };
  const sources = [[image, png], [path.join(root, bitmapPath), png], [path.join(metadata, 'storyboard.project.json'), Buffer.from(JSON.stringify(project))]] as const;
  for (const [file, body] of sources) await fs.writeFile(file, body, { mode: 0o600 });
  const python = 'python3';
  const accounting = createOriginWorkspaceAccounting({ userData: () => userData, python, script: path.resolve('scripts/recovery-origin-permissions.py') });
  const reserve = accounting.reserve;
  accounting.reserve = (r, b, bytes, records, operation) => reserve(r, b, bytes, records, async () => {
    // Self-owned synthetic actor, not product metadata repair or permission cache.
    for (const [file] of sources) execFileSync('/usr/bin/xattr', ['-w', 'org.storyboard.quote-growth', 'new-material', file]);
    return operation();
  });
  const frame = {}, sender = { mainFrame: frame };
  const capture = { folderPath: root, content: { projectRaw: project, sequence: 1, assetRevision: 1, desiredAssets: [], effectFacts: { receipt: [], deletions: [], remainingScript: null } }, canvas: { captures: [], hasUnsettledGesture: false }, selectedShotIds: ['s'], dirtyShotIds: ['s'], fileNameSyncState: 'pending', workspaceSaveState: 'error' };
  const service = createWorkspaceRetainedCloseService({ python, script: path.resolve('scripts/recovery-content-permissions.py'), budget: { bytes: 2 * 1024 * 1024, records: 100, assets: 16, jsonDepth: 80 }, accounting });
  await expect(service.certifyRetained({ sender, senderFrame: frame } as any, capture)).rejects.toThrow('source material policy changed');
  const base = path.join(metadata, 'workspace-recovery-v1');
  for (const relative of await fs.readdir(base, { recursive: true })) {
    const file = path.join(base, relative), stat = await fs.lstat(file);
    if (stat.isFile()) expect(stat.size).toBe(0);
  }
  for (const [file, body] of sources) {
    expect(await fs.readFile(file)).toEqual(body); expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    expect(execFileSync('/usr/bin/xattr', ['-p', 'org.storyboard.quote-growth', file], { encoding: 'utf8' }).trim()).toBe('new-material');
  }
}, 120000);
