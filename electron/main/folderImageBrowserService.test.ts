import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { inspectFolderImages, readFolderImagePreview, copyFolderImagesForImport } from './folderImageBrowserService';
import { registerFolderImageBrowserHandlers } from './ipc/folderImageBrowserHandlers';

const temporary: string[] = [];
afterEach(async () => { for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true }); });
const fixture = async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'browse-images-')); temporary.push(parent);
  const source = path.join(parent, 'source'); await mkdir(source);
  const png = await sharp({ create: { width: 12, height: 8, channels: 4, background: '#ee5511' } }).png().toBuffer();
  await writeFile(path.join(source, '2.png'), png);
  await sharp(png).tiff().toFile(path.join(source, '10.tiff'));
  const internal = path.join(source, '.storyboard-workbench'); await mkdir(internal);
  const json = JSON.stringify({ shots: [{ id: 'old', imagePath: path.join(source, '10.tiff'), swb: { status: 'owned' }, layers: [{ bitmapPath: '.storyboard-workbench/old.png' }] }], dialogues: [{ text: 'retained dialogue' }] });
  await writeFile(path.join(internal, 'storyboard.project.json'), json);
  await writeFile(path.join(internal, 'old.png'), png);
  await writeFile(path.join(source, 'storyboard-script.md'), 'retained script');
  const snapshot = async (): Promise<Record<string, string>> => {
    const result: Record<string, string> = {};
    const visit = async (relative: string) => {
      for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
        const p = path.join(relative, entry.name);
        if (entry.isDirectory()) await visit(p);
        else if (entry.isFile()) result[p] = (await readFile(path.join(source, p))).toString('base64');
      }
    }; await visit(''); return result;
  };
  return { parent, source, internal, png, snapshot };
};
it('lists and previews ordinary images despite legacy metadata without writing any source file or cache', async () => {
  const f = await fixture(), before = await f.snapshot();
  const inspection = await inspectFolderImages(f.source);
  expect(inspection).toEqual({ folderPath: f.source, files: ['2.png', '10.tiff'], browse: true });
  for (const fileName of inspection.files) {
    const preview = await readFolderImagePreview({ folderPath: f.source, fileName });
    expect(preview.width).toBe(12); expect(preview.height).toBe(8); expect(preview.dataUrl).toMatch(/^data:image\/png;base64,/);
  }
  expect(await f.snapshot()).toEqual(before);
});
it('copies only visible image pixels to a unique new folder; all old metadata and images remain exact', async () => {
  const f = await fixture(), before = await f.snapshot(), guard = vi.fn(async () => {});
  const first = await copyFolderImagesForImport(f.source, f.parent, guard);
  const second = await copyFolderImagesForImport(f.source, f.parent, guard);
  expect(first.count).toBe(2); expect(first.folderPath).not.toBe(second.folderPath);
  expect(guard).toHaveBeenCalledWith([f.parent]);
  expect(await readdir(first.folderPath)).toEqual(['0001-2.png', '0002-10.png']);
  const decoded = async (p: string) => sharp(p).ensureAlpha().raw().toBuffer();
  expect(await decoded(path.join(first.folderPath, '0002-10.png'))).toEqual(await decoded(path.join(f.source, '10.tiff')));
  expect(await f.snapshot()).toEqual(before);
});
it('no destination writes on guard refusal or choosing a child of the original folder', async () => {
  const f = await fixture(), before = await f.snapshot(), listing = await readdir(f.parent);
  await expect(copyFolderImagesForImport(f.source, f.parent, async () => { throw Error('protected destination'); })).rejects.toThrow('protected destination');
  await expect(copyFolderImagesForImport(f.source, f.source, async () => {})).rejects.toThrow('outside');
  expect(await readdir(f.parent)).toEqual(listing); expect(await f.snapshot()).toEqual(before);
});
it('bad images do not hide good previews, and failed conversion retains only new partial copies', async () => {
  const f = await fixture(); await writeFile(path.join(f.source, '99.png'), 'not an image');
  const before = await f.snapshot();
  expect((await inspectFolderImages(f.source)).files).toHaveLength(3);
  await expect(readFolderImagePreview({ folderPath: f.source, fileName: '99.png' })).rejects.toThrow();
  expect((await readFolderImagePreview({ folderPath: f.source, fileName: '2.png' })).width).toBe(12);
  await expect(copyFolderImagesForImport(f.source, f.parent, async () => {})).rejects.toThrow('after 2 images');
  expect(await f.snapshot()).toEqual(before);
});
it('never scans hidden directories or follows image aliases and rejects path traversal', async () => {
  const f = await fixture();
  await symlink(path.join(f.source, '2.png'), path.join(f.source, 'alias.png'));
  await mkdir(path.join(f.source, 'directory.png'));
  expect((await inspectFolderImages(f.source)).files).toEqual(['2.png', '10.tiff']);
  await expect(readFolderImagePreview({ folderPath: f.source, fileName: '../outside.png' })).rejects.toThrow('Unsupported');
  await expect(readFolderImagePreview({ folderPath: f.source, fileName: 'alias.png' })).rejects.toThrow();
});
it('current format opens normally; unsupported/corrupt metadata still permits browsing', async () => {
  const f = await fixture(), metadata = path.join(f.internal, 'storyboard.project.json');
  await writeFile(metadata, JSON.stringify({ shots: [], pendingBake: { version: 1, shots: {} } }));
  expect((await inspectFolderImages(f.source)).browse).toBe(false);
  for (const bytes of ['{broken', JSON.stringify({ shots: [], pendingBake: { version: 99 } })]) {
    await writeFile(metadata, bytes); expect((await inspectFolderImages(f.source)).browse).toBe(true);
  }
});
it('keeps ordinary fresh folders on the existing import flow and decodes additional formats through the browser', async () => {
  const f = await fixture();
  await rm(path.join(f.internal, 'storyboard.project.json'));
  expect((await inspectFolderImages(f.source)).browse).toBe(false);
  for (const format of ['jpeg', 'webp', 'gif', 'avif'] as const) {
    const fileName = `image.${format}`;
    await sharp(f.png).toFormat(format).toFile(path.join(f.source, fileName));
    const preview = await readFolderImagePreview({ folderPath: f.source, fileName });
    expect([preview.width, preview.height]).toEqual([12, 8]);
  }
  expect((await inspectFolderImages(f.source)).browse).toBe(true);
  const copy = await copyFolderImagesForImport(f.source, f.parent, async () => {});
  expect(copy.count).toBe(6);
  for (const name of await readdir(copy.folderPath)) expect((await sharp(path.join(copy.folderPath, name)).metadata()).format).toBe('png');
});
it('cancelled destination dialog does not create a folder; stale callers cannot browse or copy', async () => {
  const f = await fixture(), handlers = new Map<string, Function>(), choose = vi.fn(async () => undefined);
  registerFolderImageBrowserHandlers({ handle: (channel: string, fn: Function) => { handlers.set(channel, fn); } } as any, choose);
  const frame = {}, event = { sender: { mainFrame: frame }, senderFrame: frame }, before = await readdir(f.parent);
  expect(await handlers.get('folderImages:importCopy')!(event, f.source)).toBeUndefined();
  expect(await readdir(f.parent)).toEqual(before);
  expect(() => handlers.get('folderImages:inspect')!({ ...event, senderFrame: {} }, f.source)).toThrow('current window');
});
