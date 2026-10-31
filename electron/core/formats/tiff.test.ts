import { reconcileExternalImage } from '../../main/flowImageReconciliation';
import { describe, expect, it } from 'vitest';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createTiffCodec, admitTiffCandidate, type TiffResult, type TiffText } from './index';
import type { ImageDocumentV1, ProjectV1 } from '../../shared/refactorV1';
import { openFlowAssetDepot } from '../persistence/depot';
import { createProjectStore } from '../persistence/index';

const execute = promisify(execFile);
const depsDir = process.env.FLOW_PYTHON_DEPS_DIR ?? path.join(path.dirname(path.dirname(await fs.realpath('node_modules/sharp'))), 'vendor/python/photoshop-tiff');
const scriptPath = path.resolve('electron/core/formats/codec.py');
const codec = () => createTiffCodec({ scriptPath, depsDir });
function value<T>(r: TiffResult<T>): T { if (!r.ok) throw new Error(JSON.stringify(r.error)); return r.value; }
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const text: TiffText = { projectId: 'project', projectName: '场景 Ω', shotId: 'shot', shotName: '镜头 🎬', scriptText: '对白\n保持空格  ',
  dialogues: [{ id: 'line', shotId: 'shot', text: '你好\n世界！' }] };
async function pixels(bytes: Uint8Array) { return [...await sharp(bytes).ensureAlpha().raw().toBuffer()]; }
async function sample() {
  const assets = new Map<string, Uint8Array>();
  const raws = [[30, 90, 150, 255, 20, 40, 60, 0], [200, 100, 50, 128, 255, 20, 30, 0], Array(8).fill(0)];
  const image: ImageDocumentV1 = { id: 'image', revision: 7, width: 2, height: 1, layers: [] };
  for (const [i, raw] of raws.entries()) {
    const png = await sharp(Buffer.from(raw), { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer();
    assets.set(sha(png), png);
    image.layers.push({ id: `layer-${i}`, name: ['底图 中文', '隐藏 Ω 🎨', ''][i], kind: i === 0 ? 'image' : 'paint',
      width: 2, height: 1, assetId: sha(png), visible: i !== 1, locked: i === 0, opacity: [1, 0.345, 0][i],
      blendMode: ['normal', 'multiply', 'screen'][i] as 'normal' | 'multiply' | 'screen' });
  }
  return { image, assets, read: async (id: string) => { const b = assets.get(id); if (!b) throw new Error('missing'); return b; } };
}
async function fixture(mode: string, original?: Uint8Array) {
  const root = await temporaryWorkspace('tiff-fixture-');
  const source = path.join(root, 'source.tiff'), target = path.join(root, 'result.tiff');
  if (original) await fs.writeFile(source, original);
  await execute('python3', [path.resolve('electron/core/formats/fixtures.py'), mode, source, target], {
    env: { ...process.env, FLOW_PYTHON_DEPS_DIR: depsDir, PYTHONDONTWRITEBYTECODE: '1' }, maxBuffer: 64 * 1024
  });
  return new Uint8Array(await fs.readFile(target));
}
async function encodeSample() { const s = await sample(); return value(await codec().encode({ image: s.image, text }, s.read)); }

describe('isolated real TIFF raster codec', () => {
  it('preserves layered Unicode identities, order, raw pixels, hidden/transparent/empty-name layers, locks and exact opacity', async () => {
    const s = await sample(), c = codec();
    const bytes = value(await c.encode({ image: s.image, text }, s.read));
    const decoded = value(await c.decode(bytes));
    expect(decoded.kind).toBe('layered'); expect(decoded.text).toEqual(text);
    expect(decoded.image.id).toBe('image'); expect(decoded.image.revision).toBe(7);
    for (const [i, layer] of decoded.image.layers.entries()) {
      const { png, ...properties } = layer, { assetId, ...expected } = s.image.layers[i];
      expect(properties).toEqual(expected); expect(await pixels(png)).toEqual(await pixels(s.assets.get(assetId)!));
    }
    // Edit actual pixels and name through the decoded candidate, then admit to
    // real depot, checkpoint, reload, encode from immutable loaded assets.
    decoded.image.layers[1].name = '修改后的图层';
    decoded.image.layers[1].visible = true;
    const edit = await sharp({ create: { width: 2, height: 1, channels: 4, background: '#abcdef80' } }).png().toBuffer();
    decoded.image.layers[1].png = edit;
    const root = await temporaryWorkspace('tiff-checkpoint-');
    const opened = await openFlowAssetDepot({ root, sessionId: 'tiff', maxPixels: 100, maxPngBytes: 100000 });
    if (!opened.ok) throw new Error(opened.error.message);
    const admitted = value(await admitTiffCandidate(decoded, opened.value, 'import'));
    expect(admitted.layers[1].assetId).toBe(sha(edit));
    const project: ProjectV1 = { schema: 'storyboard-flow.project', version: 1, id: text.projectId, revision: 0, name: text.projectName,
      shots: [{ id: text.shotId, imageId: admitted.id, name: text.shotName, scriptText: text.scriptText }], parkedShots: [],
      dialogues: text.dialogues, images: { [admitted.id]: admitted } };
    const store = createProjectStore();
    const saved = await store.saveCheckpoint(root, project, async id => {
      const r = await opened.value.read(id); if (!r.ok) throw new Error(r.error.message); return r.value;
    });
    expect(saved.ok).toBe(true);
    const loaded = await store.loadCheckpoint(root); if (!loaded.ok) throw new Error(loaded.error.message);
    const output = value(await c.encode({ image: loaded.value.project.images.image, text }, loaded.value.readAsset));
    const again = value(await c.decode(output));
    expect(again.text).toEqual(text); expect(again.image.layers[1].name).toBe('修改后的图层');
    expect(await pixels(again.image.layers[1].png)).toEqual(await pixels(edit));
    expect(again.image.layers.map(l => [l.visible, l.opacity, l.blendMode])).toEqual(decoded.image.layers.map(l => [l.visible, l.opacity, l.blendMode]));
  }, 30000);

  it('decodes plain unassociated-alpha TIFF as one explicit candidate then encode/redecode preserves pixels', async () => {
    const c = codec(), source = await fixture('plain');
    const first = value(await c.decode(source));
    expect(first.kind).toBe('plain'); expect(first.text).toBeNull();
    expect(await pixels(first.image.layers[0].png)).toEqual([10, 30, 50, 0, 200, 100, 30, 128]);
    const { png, ...layer } = first.image.layers[0];
    const image = { ...first.image, layers: [{ ...layer, assetId: sha(png) }] };
    const result = value(await c.decode(value(await c.encode({ image, text: null }, async () => png))));
    expect(result.kind).toBe('layered'); expect(await pixels(result.image.layers[0].png)).toEqual(await pixels(png));
  });

  it.each(['normal', 'multiply', 'screen'] as const)('writes a real composite with %s and opacity without baking source pixels', async blendMode => {
    const s = await sample(), c = codec();
    s.image.layers = s.image.layers.slice(0, 2); s.image.layers[1] = { ...s.image.layers[1], visible: true, opacity: 0.5, blendMode };
    const out = value(await c.encode({ image: s.image, text: null }, s.read));
    const composite = await pixels(out);
    const ba = [30, 90, 150], src = [200, 100, 50], alpha = 128 / 255 * 0.5;
    const expected = ba.map((b, i) => Math.round(b*(1-alpha) + alpha*(blendMode === 'normal' ? src[i] : blendMode === 'multiply' ? b*src[i]/255 : b+src[i]-b*src[i]/255)));
    expect(composite.slice(0, 3)).toEqual(expected); expect(composite[3]).toBe(255);
    const decoded = value(await c.decode(out));
    expect(decoded.image.layers[1].opacity).toBe(0.5); expect(await pixels(decoded.image.layers[1].png)).toEqual(await pixels(s.assets.get(s.image.layers[1].assetId)!));
  });

  it('keeps all-hidden layers and emits a transparent composite', async () => {
    const s = await sample(), c = codec(); s.image.layers.forEach(l => l.visible = false);
    const bytes = value(await c.encode({ image: s.image, text: null }, s.read));
    expect((await pixels(bytes)).filter((_, i) => i % 4 === 3)).toEqual([0, 0]);
    expect(value(await c.decode(bytes)).image.layers.map(l => l.visible)).toEqual([false, false, false]);
  });

  it('supports generic supported layered TIFF and zero-area raster layers without hidden/empty loss', async () => {
    const source = await encodeSample(), c = codec();
    const generic = value(await c.decode(await fixture('generic', source)));
    expect(generic.text).toBeNull(); expect(generic.image.layers).toHaveLength(3);
    expect(generic.image.layers[1].visible).toBe(false);
    expect(generic.image.layers[1].opacity).toBe(Math.round(0.345*255)/255);
    const empty = value(await c.decode(await fixture('empty', source)));
    expect(await pixels(empty.image.layers[0].png)).toEqual(Array(8).fill(0));
  });

  it('refuses unsupported layered structures rather than flattening and leaves source bytes unchanged', async () => {
    const source = await encodeSample(), c = codec();
    for (const mode of ['blend', 'mask', 'group', 'channel', 'offcanvas', 'bigrect', 'opacity', 'version', 'field', 'zipbomb', 'rlebomb']) {
      const bytes = await fixture(mode, source), before = sha(bytes);
      const result = await c.decode(bytes);
      expect(result.ok, `${mode}: ${JSON.stringify(result)}`).toBe(false);
      expect(sha(bytes)).toBe(before);
      expect(await c.decode(bytes)).toEqual(result);
    }
  }, 30000);

  it('refuses malformed, 16-bit, grayscale, multipage, orientation and unknown-XMP input', async () => {
    const c = codec();
    for (const bytes of [Buffer.from('bad TIFF'), (await encodeSample()).slice(0, 60),
      ...await Promise.all(['sixteen', 'gray', 'pages', 'oriented', 'xmp'].map(m => fixture(m)))]) {
      const before = Buffer.from(bytes); expect((await c.decode(bytes)).ok).toBe(false); expect(Buffer.from(bytes)).toEqual(before);
    }
  }, 30000);

  it('bounds bytes, dimensions, total layer pixels, layer count, PNG output and metadata', async () => {
    const s = await sample();
    const encoded = await encodeSample();
    for (const limits of [{ maxTiffBytes: 8 }, { maxTotalPixels: 4 }, { maxLayers: 2 }, { maxDimension: 1 }, { maxPngBytes: 8 }, { maxMetadataBytes: 32 }]) {
      const c = createTiffCodec({ scriptPath, depsDir, limits });
      expect((await c.encode({ image: s.image, text }, s.read)).ok).toBe(false);
      expect((await c.decode(encoded)).ok).toBe(false);
    }
    expect((await createTiffCodec({ scriptPath, depsDir, limits: { maxDimension: 16 } }).decode(await fixture('large'))).ok).toBe(false);
    expect(() => createTiffCodec({ scriptPath, depsDir, limits: { maxLayers: 0 } })).toThrow();
  }, 30000);

  it('refuses missing, mismatched-hash, malformed, high-depth and mismatched-size PNG assets', async () => {
    const s = await sample(), c = codec();
    expect((await c.encode({ image: s.image, text }, async () => { throw new Error('missing'); }))).toMatchObject({ ok: false, error: { code: 'missing-asset' } });
    expect((await c.encode({ image: s.image, text }, async () => Buffer.from('bad')))).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    for (const png of [Buffer.from('bad'), await fixture('png16'), await sharp({ create: { width: 3, height: 1, channels: 4, background: 'red' } }).png().toBuffer()]) {
      const image = structuredClone(s.image); image.layers = [image.layers[0]]; image.layers[0].assetId = sha(png);
      expect((await c.encode({ image, text }, async () => png))).toMatchObject({ ok: false, error: { code: 'invalid-input' } });
    }
  });

  it('snapshots source bytes, metadata and layer descriptors before awaits and refuses concurrent work', async () => {
    const s = await sample(), c = codec(); const original = structuredClone(s.image), originalText = structuredClone(text);
    let release!: () => void;
    const gate = new Promise<void>(r => release = r);
    const provided = structuredClone(s.assets);
    const submissionText = structuredClone(text);
    const pending = c.encode({ image: s.image, text: submissionText }, async id => { await gate; return provided.get(id)!; });
    s.image.layers.reverse(); s.image.width = 100; s.image.layers[0].name = 'mutated'; submissionText.scriptText = 'mutated';
    expect(await c.decode(Buffer.from('anything'))).toMatchObject({ ok: false, error: { code: 'busy' } });
    release(); const bytes = value(await pending), source = Buffer.from(bytes);
    const decoding = c.decode(source); source.fill(0);
    const decoded = value(await decoding);
    expect(decoded.text).toEqual(originalText); expect(decoded.image.width).toBe(2);
    expect(decoded.image.layers.map(l => l.name)).toEqual(original.layers.map(l => l.name));
  });

  it('accepts RAW/ZIP/RLE raster channels after bounded expansion preflight', async () => {
    const source = await encodeSample(), c = codec();
    const reference = value(await c.decode(source));
    for (const mode of ['raw', 'zip', 'rle']) {
      const decoded = value(await c.decode(await fixture(mode, source)));
      expect(decoded.text).toEqual(reference.text);
      for (const [index, layer] of decoded.image.layers.entries()) {
        expect(await pixels(layer.png)).toEqual(await pixels(reference.image.layers[index].png));
      }
    }
  });

  it('preserves a read-only synthetic source file across success and deterministic refusal', async () => {
    const root = await temporaryWorkspace('tiff-source-');
    const file = path.join(root, 'original.tiff'), bytes = await encodeSample();
    await fs.writeFile(file, bytes, { mode: 0o400 });
    const original = await fs.readFile(file), c = codec();
    value(await c.decode(original));
    expect(await fs.readFile(file)).toEqual(Buffer.from(bytes));
    const unsupported = await fixture('blend', bytes), unsupportedFile = path.join(root, 'unsupported.tiff');
    await fs.writeFile(unsupportedFile, unsupported, { mode: 0o400 });
    const result = await c.decode(await fs.readFile(unsupportedFile));
    expect(result).toMatchObject({ ok: false, error: { code: 'unsupported-input' } });
    expect(await c.decode(await fs.readFile(unsupportedFile))).toEqual(result);
    expect(await fs.readFile(unsupportedFile)).toEqual(Buffer.from(unsupported));
  });

  it('rejects unknown image/text fields and NUL names without reading assets', async () => {
    const s = await sample(), c = codec(); let reads = 0;
    const reader = async (id: string) => { reads++; return s.read(id); };
    for (const image of [{ ...s.image, unknown: 1 }, { ...s.image, layers: [{ ...s.image.layers[0], name: 'null\0' }] }]) {
      expect((await c.encode({ image, text }, reader)).ok).toBe(false);
    }
    expect((await c.encode({ image: s.image, text: { ...text, extra: true } as TiffText }, reader)).ok).toBe(false);
    expect(reads).toBe(0);
  });

  it('snapshots candidate pixels before admission awaits; failed admission never creates a checkpoint', async () => {
    const candidate = value(await codec().decode(await fixture('plain')));
    const original = Buffer.from(candidate.image.layers[0].png);
    const root = await temporaryWorkspace('tiff-admit-');
    const opened = await openFlowAssetDepot({ root, sessionId: 'admit', maxPixels: 100, maxPngBytes: 100000 });
    if (!opened.ok) throw new Error(opened.error.message);
    let release!: () => void;
    const gate = new Promise<void>(r => release = r);
    const pending = admitTiffCandidate(candidate, { read: opened.value.read, put: async input => { await gate; return opened.value.put(input); } }, 'operation');
    candidate.image.layers[0].png.fill(0); candidate.image.layers[0].name = 'mutated'; release();
    const admitted = value(await pending);
    expect(admitted.layers[0].name).toBe('Image'); expect(admitted.layers[0].assetId).toBe(sha(original));
    expect((await createProjectStore().loadCheckpoint(root))).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await admitTiffCandidate(candidate, opened.value, 'bad')).toMatchObject({ ok: false });
    expect((await createProjectStore().loadCheckpoint(root))).toMatchObject({ ok: false, error: { code: 'not-found' } });
    const read = await opened.value.read(admitted.layers[0].assetId); if (!read.ok) throw new Error(read.error.message);
    expect(Buffer.from(read.value)).toEqual(original);
  });

  it('fails explicitly on worker startup and timeout, settles owned child and permits retry', async () => {
    const source = await fixture('plain');
    const absent = createTiffCodec({ scriptPath, depsDir, pythonPath: '/missing-flow-python' });
    expect(await absent.decode(source)).toMatchObject({ ok: false, error: { code: 'codec-failure' } });
    const short = createTiffCodec({ scriptPath, depsDir, limits: { timeoutMs: 1 } });
    expect(await short.decode(source)).toMatchObject({ ok: false, error: { code: 'codec-failure' } });
    expect(await short.decode(source)).toMatchObject({ ok: false, error: { code: 'codec-failure' } });
  });
});

it('matches reordered TIFF raster records by native layer ID, not stale XMP position', async()=>{
 const s=await sample(),c=codec();const source=value(await c.encode({image:s.image,text},s.read));
 const decoded=value(await c.decode(await fixture('reorder',source)));
 expect(decoded.identity).toBe('portable');
 expect(decoded.image.layers.map(l=>l.id)).toEqual([...s.image.layers].reverse().map(l=>l.id));
 for(const layer of decoded.image.layers){
  const expected=s.image.layers.find(l=>l.id===layer.id)!;
  expect(layer.name).toBe(expected.name);expect(layer.opacity).toBe(expected.opacity);
  expect(await pixels(layer.png)).toEqual(await pixels(s.assets.get(expected.assetId)!));
 }
 expect(decoded.text).toEqual(text);
});
it('refuses missing or duplicated native IDs instead of guessing correspondence',async()=>{
 const source=await encodeSample(),c=codec();
 for(const mode of ['missing-id','duplicate-id'])expect(await c.decode(await fixture(mode,source))).toMatchObject({ok:false});
});
it('reports native identity without XMP and unverified identity for plain input',async()=>{
 const source=await encodeSample(),c=codec();
 const generic=value(await c.decode(await fixture('generic',source)));
 const reordered=value(await c.decode(await fixture('generic',await fixture('reorder',source))));
 expect(generic.identity).toBe('native');expect(reordered.identity).toBe('native');
 expect(reordered.image.layers.map(l=>l.id)).toEqual([...generic.image.layers].reverse().map(l=>l.id));
 expect(value(await c.decode(await fixture('plain'))).identity).toBe('unverified');
});

it('keeps native-only layer kind stable so external reorder can coexist with local pixel edits',async()=>{
 const source=await encodeSample(),c=codec();
 const original=value(await c.decode(await fixture('generic',source)));
 const external=value(await c.decode(await fixture('generic',await fixture('reorder',source))));
 const admitted=(candidate:typeof original):ImageDocumentV1=>({...candidate.image,layers:candidate.image.layers.map(({png,...layer})=>({...layer,assetId:sha(png)}))});
 const b=admitted(original),l=structuredClone(b),e=admitted(external);
 l.layers[0].assetId='f'.repeat(64);
 expect(new Map(e.layers.map(l=>[l.id,l.kind]))).toEqual(new Map(b.layers.map(l=>[l.id,l.kind])));
 const plan=reconcileExternalImage(b,l,e,true);expect(plan.kind).toBe('replace');
 if(plan.kind==='replace'){
  expect(plan.image.layers.map(l=>l.id)).toEqual(e.layers.map(l=>l.id));
  expect(plan.image.layers.find(layer=>layer.id===l.layers[0].id)?.assetId).toBe(l.layers[0].assetId);
 }
});
