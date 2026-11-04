import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createTiffCodec } from './formats/index';
import { createProjectStore } from './persistence';
import { openFlowEditorRuntime } from './flowEditorRuntime';
import { openFlowTiffSave } from './flowTiffSave';
import { createImageProject, type CreateImageProjectOptions } from './createImageProject';
import type { ImageDocumentV1, ProjectV1 } from '../../platform/contracts/refactorV1';

const deps = path.resolve('vendor/python/photoshop-tiff');
const codec = () => createTiffCodec({ scriptPath: path.resolve('src/project-files/main/formats/codec.py'), depsDir: deps });
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const get = <T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!result.ok) throw Error(result.error.message);
  return result.value;
};
const NAMING = { sceneCode: 'S01', artistName: 'Li', version: '2' };
const signal = (controller = new AbortController()) => ({ controller, signal: controller.signal });
const options = (overrides: Partial<CreateImageProjectOptions> = {}): CreateImageProjectOptions => ({ signal: signal().signal, ...overrides });
const project = async (root: string): Promise<ProjectV1> => get(await createProjectStore().loadCheckpoint(root)).project;
type Rgba = { r: number; g: number; b: number; alpha: number };
const rgb = (width: number, height: number, background: Rgba) => sharp({ create: { width, height, channels: 4, background } });

async function layout() {
  const root = await temporaryWorkspace('flow-create-project-');
  const sources = path.join(root, 'sources');
  const destination = path.join(root, 'out');
  await fs.mkdir(sources);
  await fs.mkdir(destination);
  return { root, sources, destination };
}

async function python16(file: string) {
  const script = "import sys,os;sys.path.insert(0,os.environ['FLOW_PYTHON_DEPS_DIR']);import imagecodecs,numpy as np\n" +
    "open(sys.argv[1],'wb').write(imagecodecs.png_encode(np.array([[[1000,2000,3000,65535],[10,20,30,40000]]],np.uint16)))";
  await promisify(execFile)('python3', ['-c', script, file], { env: { ...process.env, FLOW_PYTHON_DEPS_DIR: deps, PYTHONDONTWRITEBYTECODE: '1' } });
}

async function animatedPng(file: string) {
  const script = "import sys,os;sys.path.insert(0,os.environ['FLOW_PYTHON_DEPS_DIR']);import imagecodecs,numpy as np\n" +
    "a=np.zeros((2,4,4,4),np.uint8);a[1,...,0]=255\n" +
    "open(sys.argv[1],'wb').write(imagecodecs.apng_encode(a,delay=100))";
  await promisify(execFile)('python3', ['-c', script, file], { env: { ...process.env, FLOW_PYTHON_DEPS_DIR: deps, PYTHONDONTWRITEBYTECODE: '1' } });
}

async function multipageTiff(file: string) {
  await promisify(execFile)('python3', [path.resolve('src/project-files/main/formats/fixtures.py'), 'pages', 'unused', file],
    { env: { ...process.env, FLOW_PYTHON_DEPS_DIR: deps, PYTHONDONTWRITEBYTECODE: '1' } });
}

const stages = async (parent: string) => (await fs.readdir(parent)).filter(name => name.startsWith('.flow-create-'));

describe('createImageProject', () => {
  it('creates a named project from a folder in natural order and saves without its sources', async () => {
    const { sources, destination } = await layout();
    const red = await rgb(4, 3, { r: 200, g: 10, b: 10, alpha: 1 }).png().toBuffer();
    const blue = await rgb(5, 2, { r: 10, g: 10, b: 200, alpha: 1 }).jpeg().toBuffer();
    await fs.writeFile(path.join(sources, '10.png'), red);
    await fs.writeFile(path.join(sources, '2.jpg'), blue);
    // Only direct children are candidates; a nested image is not imported.
    await fs.mkdir(path.join(sources, 'nested'));
    await fs.writeFile(path.join(sources, 'nested', '3.png'), red);
    const before = { red: hash(red), blue: hash(blue) };
    const progress: { done: number; total: number; phase?: 'read' | 'write' }[] = [];
    const { root } = await createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Proj', name: 'Proj', naming: NAMING },
      options({ onProgress: entry => progress.push(entry) }));
    expect(root).toBe(path.join(destination, 'Proj'));
    const created = await project(root);
    expect(created.name).toBe('Proj');
    expect(created.naming).toEqual(NAMING);
    expect(created.shots.map(shot => shot.name)).toEqual(['2', '10']);
    const files = (await fs.readdir(root)).sort();
    expect(files).toEqual(['.storyboard-flow', 'Proj_S01_stb_Li_v002_0010.tif', 'Proj_S01_stb_Li_v002_0020.tif']);
    expect(progress.filter(entry => entry.phase === 'read')).toEqual([
      { done: 1, total: 2, phase: 'read' }, { done: 2, total: 2, phase: 'read' }]);
    // The write pass reaches 100% only after the published project is verified.
    expect(progress.filter(entry => entry.phase === 'write')).toEqual([
      { done: 1, total: 2, phase: 'write' }, { done: 2, total: 2, phase: 'write' }]);
    expect(hash(await fs.readFile(path.join(sources, '10.png')))).toBe(before.red);
    expect(hash(await fs.readFile(path.join(sources, '2.jpg')))).toBe(before.blue);
    const ledger = JSON.parse(await fs.readFile(path.join(root, '.storyboard-flow/tiff-output.json'), 'utf8'));
    expect(ledger.entries.map((entry: { name: string }) => entry.name)).toEqual(['Proj_S01_stb_Li_v002_0010.tif', 'Proj_S01_stb_Li_v002_0020.tif']);
    for (const entry of ledger.entries as { shotId: string; name: string; current: string; original: string }[]) {
      expect(hash(await fs.readFile(path.join(root, entry.name)))).toBe(entry.current);
      // Raster sources have no TIFF original; the created output is the first original.
      expect(hash(await fs.readFile(path.join(root, '.storyboard-flow/originals', entry.shotId + '.tif')))).toBe(entry.original);
      expect(entry.original).toBe(entry.current);
    }
    await fs.rename(sources, sources + '-moved');
    const runtime = await openFlowEditorRuntime(root);
    const opened = runtime.open();
    expect(opened.project.shots).toHaveLength(2);
    expect(await runtime.folderStatus({ project: opened.project, inspectDisk: true })).toBe('current');
    const saved = await runtime.saveTiff(opened.project);
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.value.files.map(file => file.name).sort()).toEqual(files.filter(name => name.endsWith('.tif')));
    // Edit, save, checkpoint and reopen: the created project is a normal project.
    opened.project.revision += 1;
    opened.project.shots[0].scriptText = 'edited';
    const edited = await runtime.saveTiff(opened.project);
    expect(edited.ok).toBe(true);
    const decoded = await codec().decode(await fs.readFile(path.join(root, 'Proj_S01_stb_Li_v002_0010.tif')));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value.text?.scriptText).toBe('edited');
    expect(await runtime.folderStatus({ project: opened.project, inspectDisk: true })).toBe('current');
    expect((await runtime.checkpoint(opened.project)).ok).toBe(true);
    const reopened = await openFlowEditorRuntime(root);
    expect(reopened.open().project.shots[0].scriptText).toBe('edited');
    expect(await runtime.certifyClose(opened.project)).toBe(true);
  }, 60_000);

  it('preserves raster transparency through the working TIFF and the checkpoint asset', async () => {
    const { sources, destination } = await layout();
    const raw = Buffer.alloc(4 * 4 * 4);
    for (let pixel = 0; pixel < 16; pixel += 1) raw.set([255, 0, 0, pixel === 5 ? 255 : 0], pixel * 4);
    const png = await sharp(raw, { raw: { width: 4, height: 4, channels: 4 } }).png().toBuffer();
    await fs.writeFile(path.join(sources, 'alpha.png'), png);
    const { root } = await createImageProject(
      { source: { kind: 'files', files: [path.join(sources, 'alpha.png')] }, destinationParent: destination, folderName: 'Alpha', name: 'Alpha', naming: NAMING },
      options());
    const created = await project(root);
    const asset = await get(await createProjectStore().loadCheckpoint(root)).readAsset(created.images[created.shots[0].imageId].layers[0].assetId);
    const checkpointAlpha = (await sharp(asset).ensureAlpha().raw().toBuffer())[3];
    expect(checkpointAlpha).toBe(0);
    const output = path.join(root, 'Alpha_S01_stb_Li_v002_0010.tif');
    const decoded = await codec().decode(await fs.readFile(output));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.image.layers).toHaveLength(1);
    // Created outputs are managed Flow TIFFs from the first write, not copies.
    expect(decoded.value.identity).toBe('portable');
    expect(decoded.value.text?.projectId).toBe(created.id);
    const pixels = await sharp(decoded.value.image.layers[0].png).ensureAlpha().raw().toBuffer();
    expect(pixels[3]).toBe(0);
    expect(pixels[5 * 4 + 3]).toBe(255);
  }, 60_000);

  it('keeps reliable TIFF layers, remaps foreign identity and preserves the source TIFF bytes', async () => {
    const { sources, destination } = await layout();
    const code = codec();
    const bottom = await rgb(4, 3, { r: 10, g: 90, b: 10, alpha: 1 }).png().toBuffer();
    const top = await rgb(4, 3, { r: 0, g: 0, b: 0, alpha: 0 }).png().toBuffer();
    const assets = new Map([[hash(bottom), bottom], [hash(top), top]]);
    const image: ImageDocumentV1 = { id: 'foreign-image', revision: 3, width: 4, height: 3, layers: [
      { id: 'foreign-bottom', name: '底色', kind: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', width: 4, height: 3, assetId: hash(bottom) },
      { id: 'foreign-top', name: '线稿', kind: 'paint', visible: true, locked: false, opacity: 0.5, blendMode: 'multiply', width: 4, height: 3, assetId: hash(top) }
    ] };
    const source = get(await code.encode({ image, text: { projectId: 'foreign-project', projectName: 'foreign', shotId: 'foreign-shot',
      shotName: '外来镜头', scriptText: '台词', dialogues: [{ id: 'foreign-dialogue', shotId: 'foreign-shot', text: '对白' }] } },
      async id => assets.get(id)!));
    await fs.writeFile(path.join(sources, 'layered.tif'), source);
    const { root } = await createImageProject(
      { source: { kind: 'files', files: [path.join(sources, 'layered.tif')] }, destinationParent: destination, folderName: 'Layered', name: 'Layered', naming: NAMING },
      options());
    const created = await project(root);
    const shot = created.shots[0];
    const stored = created.images[shot.imageId];
    expect(shot.name).toBe('外来镜头');
    expect(stored.layers.map(layer => layer.name)).toEqual(['底色', '线稿']);
    expect(new Set(stored.layers.map(layer => layer.id)).size).toBe(2);
    expect(stored.layers[1].opacity).toBe(0.5);
    expect(created.dialogues.map(dialogue => dialogue.text)).toEqual(['对白']);
    expect(created.dialogues[0].shotId).toBe(shot.id);
    const originals = path.join(root, '.storyboard-flow/originals', shot.id + '.tif');
    expect(await fs.readFile(originals)).toEqual(Buffer.from(source));
    const ledger = JSON.parse(await fs.readFile(path.join(root, '.storyboard-flow/tiff-output.json'), 'utf8'));
    expect(ledger.entries[0].original).toBe(hash(source));
    const decoded = await code.decode(await fs.readFile(path.join(root, 'Layered_S01_stb_Li_v002_0010.tif')));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.identity).toBe('portable');
    expect(decoded.value.text?.projectId).toBe(created.id);
    expect(decoded.value.text?.shotId).toBe(shot.id);
    expect(decoded.value.image.layers.map(layer => layer.name)).toEqual(['底色', '线稿']);
  }, 60_000);

  it('confirms defects and accepted degradations once, then skips or flattens exactly those files', async () => {
    const { sources, destination } = await layout();
    await fs.writeFile(path.join(sources, 'good.png'), await rgb(4, 3, { r: 1, g: 2, b: 3, alpha: 1 }).png().toBuffer());
    await fs.writeFile(path.join(sources, 'broken.png'), 'not an image');
    await python16(path.join(sources, 'wide16.png'));
    const issues: { file: string; reason: string; action: string }[] = [];
    const { root } = await createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Mixed', name: 'Mixed', naming: NAMING },
      options({ decideIssues: async found => { issues.push(...found); return 'continue'; } }));
    expect(issues.map(issue => issue.action).sort()).toEqual(['flatten', 'skip']);
    expect(issues.find(issue => issue.action === 'skip')?.file).toBe(path.join(sources, 'broken.png'));
    expect(issues.find(issue => issue.action === 'flatten')?.reason).toContain('8-bit');
    const created = await project(root);
    expect(created.shots.map(shot => shot.name)).toEqual(['good', 'wide16']);
    const wide = created.images[created.shots.find(shot => shot.name === 'wide16')!.imageId];
    const widePixels = await sharp(await get(await createProjectStore().loadCheckpoint(root)).readAsset(wide.layers[0].assetId)).ensureAlpha().raw().toBuffer();
    expect(widePixels[0]).toBeLessThan(8);          // 1000/257, reduced from 16-bit
    expect(widePixels[3]).toBe(255);                // fully opaque 65535 sample
    expect((await stages(destination)).length).toBe(0);
    // Cancelling the same confirmation publishes nothing and leaves the sources intact.
    const cancelled = signal();
    await expect(createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Cancelled', name: 'Cancelled', naming: NAMING },
      options({ signal: cancelled.signal, decideIssues: async () => 'cancel' }))).rejects.toMatchObject({ name: 'AbortError' });
    expect((await fs.readdir(destination)).sort()).toEqual(['Mixed']);
    expect((await stages(destination)).length).toBe(0);
    expect(await fs.readFile(path.join(sources, 'broken.png'), 'utf8')).toBe('not an image');
  }, 60_000);

  it('refuses a defective source without a confirmation handler and publishes nothing', async () => {
    const { sources, destination } = await layout();
    await fs.writeFile(path.join(sources, 'broken.png'), 'not an image');
    await expect(createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Refused', name: 'Refused', naming: NAMING },
      options())).rejects.toThrow('need confirmation');
    expect(await fs.readdir(destination)).toEqual([]);
  }, 30_000);

  it('converts a CMYK JPEG only after a confirmed flatten reason', async () => {
    const { sources, destination } = await layout();
    const cmyk = await sharp({ create: { width: 4, height: 3, channels: 3, background: { r: 200, g: 30, b: 30 } } })
      .toColourspace('cmyk').jpeg().toBuffer();
    await fs.writeFile(path.join(sources, 'print.jpg'), cmyk);
    const reasons: string[] = [];
    const { root } = await createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Print', name: 'Print', naming: NAMING },
      options({ decideIssues: async issues => { reasons.push(...issues.map(issue => `${issue.action}:${issue.reason}`)); return 'continue'; } }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('flatten:');
    expect(reasons[0]).toContain('CMYK');
    const created = await project(root);
    const pixels = await sharp(await get(await createProjectStore().loadCheckpoint(root)).readAsset(created.images[created.shots[0].imageId].layers[0].assetId)).raw().toBuffer();
    expect(pixels[0]).toBeGreaterThan(pixels[1]);
    expect(pixels[0]).toBeGreaterThan(pixels[2]);
  }, 60_000);

  it('skips an oversized file after confirmation instead of aborting the batch', async () => {
    const { sources, destination } = await layout();
    await fs.writeFile(path.join(sources, 'good.png'), await rgb(4, 3, { r: 1, g: 2, b: 3, alpha: 1 }).png().toBuffer());
    const huge = path.join(sources, 'huge.png');
    const handle = await fs.open(huge, 'w');
    try { await handle.truncate(129 * 1024 * 1024); } finally { await handle.close(); }
    const reasons: string[] = [];
    const reads: { done: number; total: number; phase?: string }[] = [];
    const { root } = await createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Huge', name: 'Huge', naming: NAMING },
      options({ onProgress: entry => reads.push(entry),
        decideIssues: async issues => { reasons.push(...issues.map(issue => `${issue.action}:${issue.reason}`)); return 'continue'; } }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('skip:');
    expect(reasons[0]).toContain('134217728');
    expect((await project(root)).shots.map(shot => shot.name)).toEqual(['good']);
    // Both files still report decode progress, including the skipped one.
    expect(reads.filter(entry => entry.phase === 'read')).toEqual([
      { done: 1, total: 2, phase: 'read' }, { done: 2, total: 2, phase: 'read' }]);
    expect((await fs.stat(huge)).size).toBe(129 * 1024 * 1024);
  }, 60_000);

  const p3 = '/System/Library/ColorSync/Profiles/Display P3.icc';
  it.skipIf(!existsSync(p3))('skips a non-sRGB ICC profile that cannot be converted reliably', async () => {
    const { sources, destination } = await layout();
    const plain = await rgb(4, 3, { r: 1, g: 2, b: 3, alpha: 1 }).jpeg().toBuffer();
    await fs.writeFile(path.join(sources, 'p3.jpg'), await sharp(plain).withIccProfile(p3).jpeg().toBuffer());
    await fs.writeFile(path.join(sources, 'plain.png'), await rgb(4, 3, { r: 4, g: 5, b: 6, alpha: 1 }).png().toBuffer());
    const reasons: string[] = [];
    const { root } = await createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Profile', name: 'Profile', naming: NAMING },
      options({ decideIssues: async issues => { reasons.push(...issues.map(issue => `${issue.action}:${issue.reason}`)); return 'continue'; } }));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]).toContain('skip:');
    expect(reasons[0]).toContain('ICC');
    expect(reasons[0]).toContain('not confirmed sRGB');
    expect((await project(root)).shots.map(shot => shot.name)).toEqual(['plain']);
  }, 60_000);

  it('reports a multipage TIFF as a confirmed skip instead of silently flattening it', async () => {
    const { sources, destination } = await layout();
    await multipageTiff(path.join(sources, 'pages.tif'));
    const actions: string[] = [];
    await expect(createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Pages', name: 'Pages', naming: NAMING },
      options({ decideIssues: async issues => {
        actions.push(...issues.map(issue => `${issue.action}:${issue.reason}`));
        return 'continue';
      } }))).rejects.toThrow('No usable images remain');
    // The only candidate was a confirmed skip, so no project may be published.
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('skip:');
    expect(actions[0]).toContain('Multipage');
    expect(await fs.readdir(destination)).toEqual([]);
  }, 30_000);

  it('never uses the first frame of an animated PNG without confirmation', async () => {
    const { sources, destination } = await layout();
    await fs.writeFile(path.join(sources, 'still.png'), await rgb(4, 3, { r: 1, g: 2, b: 3, alpha: 1 }).png().toBuffer());
    await animatedPng(path.join(sources, 'animated.png'));
    const actions: string[] = [];
    const { root } = await createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Animated', name: 'Animated', naming: NAMING },
      options({ decideIssues: async issues => { actions.push(...issues.map(issue => `${issue.action}:${issue.reason}`)); return 'continue'; } }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('skip:');
    expect(actions[0]).toContain('multi-frame');
    expect((await project(root)).shots.map(shot => shot.name)).toEqual(['still']);
  }, 60_000);

  it('refuses an invalid destination that resembles a project folder', async () => {
    const { sources, destination } = await layout();
    const png = await rgb(4, 3, { r: 1, g: 2, b: 3, alpha: 1 }).png().toBuffer();
    await fs.writeFile(path.join(sources, 'good.png'), png);
    const input = { destinationParent: destination, folderName: 'New', name: 'New', naming: NAMING };
    await fs.mkdir(path.join(destination, 'New'));
    await fs.writeFile(path.join(destination, 'New', 'keep.txt'), 'keep');
    await expect(createImageProject({ ...input, source: { kind: 'folder', folder: sources } }, options())).rejects.toThrow('Destination already exists');
    expect(await fs.readFile(path.join(destination, 'New', 'keep.txt'), 'utf8')).toBe('keep');
    expect((await stages(destination)).length).toBe(0);
    await expect(createImageProject({ ...input, folderName: 'Empty', name: '', source: { kind: 'folder', folder: sources } }, options()))
      .rejects.toThrow('项目名称不能为空');
    await expect(createImageProject({ ...input, folderName: 'Blank', naming: { ...NAMING, artistName: '   ' }, source: { kind: 'folder', folder: sources } }, options()))
      .rejects.toThrow('作者不能为空');
    expect((await stages(destination)).length).toBe(0);
    await expect(createImageProject({ ...input, destinationParent: sources, folderName: 'Nested', source: { kind: 'folder', folder: sources } }, options()))
      .rejects.toThrow('outside the source folder');
    // A single selected file must not bypass the same rule, including a deeper parent.
    await expect(createImageProject({ ...input, destinationParent: sources, folderName: 'Single',
      source: { kind: 'files', files: [path.join(sources, 'good.png')] } }, options()))
      .rejects.toThrow('outside the source folder');
    await fs.mkdir(path.join(sources, 'deeper'));
    await expect(createImageProject({ ...input, destinationParent: path.join(sources, 'deeper'), folderName: 'Single',
      source: { kind: 'files', files: [path.join(sources, 'good.png')] } }, options()))
      .rejects.toThrow('outside the source folder');
    expect((await stages(destination)).length).toBe(0);
    await fs.symlink(path.join(sources, 'good.png'), path.join(sources, 'alias.png'));
    await expect(createImageProject({ ...input, folderName: 'Alias', source: { kind: 'folder', folder: sources } }, options()))
      .rejects.toThrow('regular file');
    expect((await stages(destination)).length).toBe(0);
  }, 30_000);

  it('cleans its private stage on abort and never publishes', async () => {
    const { sources, destination } = await layout();
    for (const name of ['a.png', 'b.png']) await fs.writeFile(path.join(sources, name), await rgb(4, 3, { r: 9, g: 9, b: 9, alpha: 1 }).png().toBuffer());
    const aborted = signal();
    aborted.controller.abort();
    await expect(createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Aborted', name: 'Aborted', naming: NAMING },
      options({ signal: aborted.signal }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(await fs.readdir(destination)).toEqual([]);
    const during = signal();
    await expect(createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'During', name: 'During', naming: NAMING },
      options({ signal: during.signal, onProgress: ({ done }) => { if (done === 1) during.controller.abort(); } }))).rejects.toMatchObject({ name: 'AbortError' });
    expect(await fs.readdir(destination)).toEqual([]);
    expect((await stages(destination)).length).toBe(0);
    expect(await fs.readdir(sources)).toEqual(['a.png', 'b.png']);
  }, 60_000);

  it('detects a source rewritten during creation and cleans its own stage only', async () => {
    const { sources, destination } = await layout();
    const file = path.join(sources, 'only.png');
    await fs.writeFile(file, await rgb(4, 3, { r: 1, g: 2, b: 3, alpha: 1 }).png().toBuffer());
    const replacement = await rgb(6, 5, { r: 200, g: 0, b: 0, alpha: 1 }).png().toBuffer();
    await expect(createImageProject(
      { source: { kind: 'files', files: [file] }, destinationParent: destination, folderName: 'Changed', name: 'Changed', naming: NAMING },
      options({ onProgress: ({ done }) => { if (done === 1) writeFileSync(file, replacement); } })))
      .rejects.toThrow(/changed/);
    expect(await fs.readdir(destination)).toEqual([]);
    expect(await fs.readFile(file)).toEqual(replacement);
  }, 60_000);

  it('retains its private stage instead of deleting files it did not create', async () => {
    const { sources, destination } = await layout();
    for (const name of ['a.png', 'b.png']) await fs.writeFile(path.join(sources, name), await rgb(4, 3, { r: 9, g: 9, b: 9, alpha: 1 }).png().toBuffer());
    const replacement = await rgb(6, 5, { r: 1, g: 2, b: 3, alpha: 1 }).png().toBuffer();
    const injected: string[] = [];
    await expect(createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Foreign', name: 'Foreign', naming: NAMING },
      options({ onProgress: ({ done, phase }) => {
        if (done !== 1 || phase !== 'write') return;
        const stage = readdirSync(destination).find(name => name.startsWith('.flow-create-'));
        if (!stage) throw Error('stage missing');
        const root = path.join(destination, stage);
        writeFileSync(path.join(root, 'intruder.txt'), 'from outside');
        writeFileSync(path.join(root, '.storyboard-flow', 'nested-intruder.txt'), 'from outside');
        injected.push(root);
        // Force the creation to fail after the foreign files exist.
        writeFileSync(path.join(sources, 'a.png'), replacement);
      } }))).rejects.toThrow(/content not created here/);
    expect(await fs.readdir(destination)).toHaveLength(1);
    expect(injected).toHaveLength(1);
    expect((await fs.readdir(destination))[0].startsWith('.flow-create-')).toBe(true);
    expect(await fs.readFile(path.join(injected[0], 'intruder.txt'), 'utf8')).toBe('from outside');
    expect(await fs.readFile(path.join(injected[0], '.storyboard-flow', 'nested-intruder.txt'), 'utf8')).toBe('from outside');
    expect(await fs.readFile(path.join(sources, 'a.png'))).toEqual(replacement);
  }, 60_000);

  it('retains a published project when verification fails, including files added there', async () => {
    const { sources, destination } = await layout();
    const width = 2000, height = 2000;
    const noise = randomBytes(width * height * 3);
    await fs.writeFile(path.join(sources, 'big.png'), await sharp(noise, { raw: { width, height, channels: 3 } }).png().toBuffer());
    const target = path.join(destination, 'Big');
    let tampered = false;
    const timer = setInterval(() => {
      if (tampered) return;
      try {
        const stage = readdirSync(destination).find(name => name.startsWith('.flow-create-'));
        if (!stage) return;
        const root = path.join(destination, stage);
        const checkpoint = path.join(root, '.storyboard-flow', 'checkpoints', 'project.json');
        if (!existsSync(checkpoint)) return;
        const output = readdirSync(root).find(name => name.endsWith('.tif'));
        if (!output) return;
        // Once the outputs are bound and the checkpoint is published, replace one
        // output with a symlink so the post-publication check must fail.
        rmSync(path.join(root, output));
        symlinkSync(checkpoint, path.join(root, output));
        writeFileSync(path.join(root, 'intruder.txt'), 'added after publication began');
        tampered = true;
      } catch { tampered = false; }
    }, 1);
    try {
      await expect(createImageProject(
        { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Big', name: 'Big', naming: NAMING },
        options())).rejects.toThrow(/published but verification failed.*retained at/i);
    } finally { clearInterval(timer); }
    expect(tampered).toBe(true);
    expect(existsSync(target)).toBe(true);
    expect(await fs.readFile(path.join(target, 'intruder.txt'), 'utf8')).toBe('added after publication began');
  }, 120_000);

  it('detects a source moved during creation, cleans its stage and leaves the moved file alone', async () => {
    const { sources, destination } = await layout();
    const file = path.join(sources, 'moved.png');
    const bytes = await rgb(4, 3, { r: 1, g: 2, b: 3, alpha: 1 }).png().toBuffer();
    await fs.writeFile(file, bytes);
    await expect(createImageProject(
      { source: { kind: 'files', files: [file] }, destinationParent: destination, folderName: 'Moved', name: 'Moved', naming: NAMING },
      options({ onProgress: ({ done }) => { if (done === 1) renameSync(file, file + '-away'); } })))
      .rejects.toThrow(/missing|changed/i);
    expect(await fs.readdir(destination)).toEqual([]);
    expect(await fs.readFile(file + '-away')).toEqual(bytes);
  }, 60_000);

  it('lists an unrepresentable layer structure as a confirmed skip instead of flattening it', async () => {
    const { sources, destination } = await layout();
    const png = await rgb(4, 3, { r: 1, g: 2, b: 3, alpha: 1 }).png().toBuffer();
    const image: ImageDocumentV1 = { id: 'base-image', revision: 0, width: 4, height: 3, layers: [
      { id: 'base-layer', name: 'base', kind: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', width: 4, height: 3, assetId: hash(png) }
    ] };
    const base = get(await codec().encode({ image, text: null }, async () => png));
    await fs.writeFile(path.join(sources, 'base.tif'), base);
    await promisify(execFile)('python3', [path.resolve('src/project-files/main/formats/fixtures.py'), 'blend', path.join(sources, 'base.tif'), path.join(sources, 'overlay.tif')],
      { env: { ...process.env, FLOW_PYTHON_DEPS_DIR: deps, PYTHONDONTWRITEBYTECODE: '1' } });
    const actions: string[] = [];
    const { root } = await createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Blend', name: 'Blend', naming: NAMING },
      options({ decideIssues: async issues => { actions.push(...issues.map(issue => `${issue.action}:${issue.reason}`)); return 'continue'; } }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toContain('skip:');
    expect(actions[0]).toContain('blend mode');
    expect((await project(root)).shots.map(shot => shot.name)).toEqual(['base']);
  }, 60_000);

  it('never replaces a destination that appears before publication', async () => {
    const { sources, destination } = await layout();
    await fs.writeFile(path.join(sources, 'one.png'), await rgb(4, 3, { r: 1, g: 2, b: 3, alpha: 1 }).png().toBuffer());
    const target = path.join(destination, 'Raced');
    await expect(createImageProject(
      { source: { kind: 'folder', folder: sources }, destinationParent: destination, folderName: 'Raced', name: 'Raced', naming: NAMING },
      options({ onProgress: ({ done }) => { if (done === 1) mkdirSync(target); } })))
      .rejects.toThrow('Destination appeared during creation');
    expect(await fs.readdir(target)).toEqual([]);
    expect((await stages(destination)).length).toBe(0);
  }, 60_000);
});
