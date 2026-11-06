import {validPresentationReceipt,type PresentationReceipt} from './presentation.js';
import type {FlowPresentation} from '../../../platform/contracts/flowPresentation.js';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import type { AssetReaderV1, DialogueV1, ImageDocumentV1, LayerV1, ProjectV1 } from '../../../platform/contracts/refactorV1.js';
import type { FlowAssetDepot } from '../../../platform/contracts/flowWave2.js';
import { snapshotProject } from '../persistence/validate.js';

export type TiffFailureCode = 'invalid-input' | 'unsupported-input' | 'resource-limit' | 'missing-asset' | 'codec-failure' | 'busy';
export type TiffResult<T> = { ok: true; value: T } | { ok: false; error: { code: TiffFailureCode; message: string } };
/** Per-shot portable text/identity, deliberately not a general Photoshop metadata bag. */
export type TiffText = {
  projectId: string; projectName: string; shotId: string; shotName: string;
  scriptText: string; dialogues: DialogueV1[]; presentation?: PresentationReceipt;
};
export type TiffCandidate = {
  identity: 'portable' | 'native' | 'unverified';
  kind: 'plain' | 'layered'; image: Omit<ImageDocumentV1, 'layers'> & {
    layers: Array<Omit<LayerV1, 'assetId'> & { png: Uint8Array }>
  }; text: TiffText | null;
};
export type TiffLimits = {
  maxTiffBytes: number; maxPngBytes: number; maxTotalPixels: number;
  maxLayers: number; maxDimension: number; maxMetadataBytes: number; timeoutMs: number;
};
const CAPS: TiffLimits = Object.freeze({ maxTiffBytes: 128 * 1024 * 1024, maxPngBytes: 32 * 1024 * 1024,
  maxTotalPixels: 16 * 1024 * 1024, maxLayers: 64, maxDimension: 8192, maxMetadataBytes: 1024 * 1024, timeoutMs: 60_000 });
export const defaultTiffLimits = CAPS;
export type TiffCodec = {
  decode(tiff: Uint8Array): Promise<TiffResult<TiffCandidate>>;
  encode(input: { image: ImageDocumentV1; text: TiffText | null; presentation?: FlowPresentation }, readAsset: AssetReaderV1): Promise<TiffResult<Uint8Array>>;
};
class Refusal extends Error {
  constructor(readonly code: TiffFailureCode, message: string) { super(message); }
}
function refuse(code: TiffFailureCode, message: string): never { throw new Refusal(code, message); }
const failed = <T>(e: unknown): TiffResult<T> => ({ ok: false, error: {
  code: e instanceof Refusal ? e.code : 'codec-failure', message: e instanceof Error ? e.message : String(e)
} });
function exact(value: unknown, keys: string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length ||
    keys.some(k => !Object.hasOwn(value, k))) refuse('unsupported-input', `${label}: unsupported or missing fields`);
}
function checkDimensions(image: { width: number; height: number; layers: unknown[] }, limits: TiffLimits) {
  if (!Number.isSafeInteger(image.width) || !Number.isSafeInteger(image.height) || image.width < 1 || image.height < 1 ||
    image.width > limits.maxDimension || image.height > limits.maxDimension || image.layers.length < 1 ||
    image.layers.length > limits.maxLayers || image.width * image.height * image.layers.length > limits.maxTotalPixels) {
    refuse('resource-limit', 'Canvas dimensions, layer count or aggregate layer pixels exceed limits');
  }
}
function snapshot(input: { image: ImageDocumentV1; text: TiffText | null }, limits: TiffLimits) {
  let copied: typeof input;
  try {
    // Refuse excessive data before cloning. JSON is the interchange metadata, not pixels.
    const encoded = JSON.stringify(input);
    if (Buffer.byteLength(encoded) > limits.maxMetadataBytes) refuse('resource-limit', 'TIFF metadata exceeds limit');
    copied = JSON.parse(encoded);
    exact(copied, ['image', 'text'], 'TIFF input');
    if (copied.text !== null) exact(copied.text, ['projectId', 'projectName', 'shotId', 'shotName', 'scriptText', 'dialogues',...(Object.hasOwn(copied.text,'presentation')?['presentation']:[])], 'TIFF text');
    const t = copied.text;
    if(t && Object.hasOwn(t,'presentation')&&!validPresentationReceipt(t.presentation))refuse('invalid-input','Invalid presentation receipt');
    const project: ProjectV1 = { schema: 'storyboard-flow.project', version: 1, id: t?.projectId ?? 'tiff',
      name: t?.projectName ?? '', revision: 0, shots: [{ id: t?.shotId ?? 'shot', imageId: copied.image.id,
        name: t?.shotName ?? '', scriptText: t?.scriptText ?? '' }], parkedShots: [], dialogues: t?.dialogues ?? [],
      images: { [copied.image.id]: copied.image } };
    snapshotProject(project);
  } catch (e) {
    if (e instanceof Refusal) throw e;
    refuse('invalid-input', `Invalid image/text snapshot: ${e instanceof Error ? e.message : e}`);
  }
  checkDimensions(copied.image, limits);
  if (copied.image.layers.some(layer => layer.name.includes('\0'))) refuse('unsupported-input', 'NUL in TIFF layer names cannot be preserved');
  return copied;
}
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function pngBytes(input: Uint8Array, width: number, height: number, limits: TiffLimits) {
  if (!(input instanceof Uint8Array) || input.length < 1) refuse('invalid-input', 'Missing PNG bytes');
  if (input.length > limits.maxPngBytes) refuse('resource-limit', 'PNG exceeds encoded-byte limit');
  const bytes = Buffer.from(input);
  try {
    const source = sharp(bytes, { failOn: 'error', limitInputPixels: limits.maxTotalPixels });
    const meta = await source.metadata();
    if (meta.format !== 'png' || meta.width !== width || meta.height !== height || meta.depth !== 'uchar' || (meta.pages ?? 1) !== 1) {
      refuse('invalid-input', 'Asset must be a single 8-bit PNG with matching canvas dimensions');
    }
    await source.raw().toBuffer();
  } catch (e) {
    if (e instanceof Refusal) throw e;
    refuse('invalid-input', `PNG decode failed: ${e instanceof Error ? e.message : e}`);
  }
  return bytes;
}

/** No source/output paths are accepted. Only private temporary files are written.
 * Caller selects the installed Python/deps and source worker; packaged worker copying
 * remains a coordinator integration gate. One in-flight conversion per codec, no queue. */
export function createTiffCodec(options: { scriptPath: string; depsDir: string; pythonPath?: string | (() => Promise<string>); limits?: Partial<TiffLimits> }): TiffCodec {
  const limits = { ...CAPS, ...options.limits };
  for (const key of Object.keys(limits) as Array<keyof TiffLimits>) {
    if (!(key in CAPS) || !Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > CAPS[key]) {
      throw new Error(`Invalid TIFF limit ${key}; limits may only reduce hard caps`);
    }
  }
  const scriptPath = path.resolve(options.scriptPath), depsDir = path.resolve(options.depsDir);
  const pythonPath = options.pythonPath ?? process.env.FLOW_PYTHON_BIN ?? 'python3';
  let running = false;
  async function worker<T>(job: (root: string) => Promise<T>): Promise<TiffResult<T>> {
    if (running) return failed(new Refusal('busy', 'TIFF codec already has an in-flight conversion'));
    running = true;
    let root: string | undefined;
    let outcome: TiffResult<T>;
    try {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'flow-tiff-'));
      outcome = { ok: true, value: await job(root) };
    } catch (e) { outcome = failed(e); }
    // The owned child has settled before cleanup; timeout never means it can
    // continue writing after the conversion promise returns.
    try { if (root) await fs.rm(root, { recursive: true }); }
    catch (e) { outcome = failed(new Refusal('codec-failure', `TIFF temporary cleanup failed at ${root}: ${String(e)}`)); }
    finally { running = false; }
    return outcome;
  }
  async function run(root: string, operation: 'decode' | 'encode', request: object) {
    await fs.writeFile(path.join(root, 'request.json'), JSON.stringify({ ...request, limits }), { flag: 'wx' });
    const interpreter = typeof pythonPath === 'function' ? await pythonPath() : pythonPath;
    await new Promise<void>((resolve, reject) => {
      execFile(interpreter, [...(typeof pythonPath === 'function' ? ['-I', '-B', '-S'] : []), scriptPath, operation, root], {
        env: { ...process.env, FLOW_PYTHON_DEPS_DIR: depsDir, PYTHONDONTWRITEBYTECODE: '1' },
        timeout: limits.timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024
      }, (error, _stdout, stderr) => error ? reject(new Refusal('codec-failure', `TIFF worker failed: ${error.message}; ${stderr.slice(0, 4096)}`)) : resolve());
    });
    const responsePath = path.join(root, 'response.json');
    if ((await fs.stat(responsePath)).size > limits.maxMetadataBytes) refuse('resource-limit', 'Worker metadata exceeds limit');
    const response = JSON.parse(await fs.readFile(responsePath, 'utf8'));
    if (!response.ok) refuse(response.error.code, response.error.message);
    return response.value;
  }
  return {
    decode(tiff) {
      let bytes: Buffer;
      try {
        if (!(tiff instanceof Uint8Array) || !tiff.length) refuse('invalid-input', 'Nonempty TIFF bytes are required');
        if (tiff.length > limits.maxTiffBytes) refuse('resource-limit', 'TIFF exceeds encoded-byte limit');
        bytes = Buffer.from(tiff); // snapshot source before first await
      } catch (e) { return Promise.resolve(failed(e)); }
      return worker(async root => {
        await fs.writeFile(path.join(root, 'source.tiff'), bytes, { flag: 'wx' });
        const result = await run(root, 'decode', {});
        const env = result.envelope;
        const layers = result.layers as Array<{ nativeId?: number | null; name: string; visible: boolean; locked: boolean; opacity: number; blendMode: LayerV1['blendMode'] }>;
        if (env !== null) {
          exact(env, ['app', 'format', 'rasterVersion', 'image', 'text'], 'Flow TIFF envelope');
          exact(env.image, ['id', 'revision', 'layers'], 'Flow TIFF image');
          if (!Array.isArray(env.image.layers) || env.image.layers.length !== layers.length) refuse('invalid-input', 'Flow layer identity count differs from TIFF');
        }
        const portable = env?.rasterVersion === 2 || env?.rasterVersion === 3;
        const identities = new Map<number, { id: string; kind: LayerV1['kind']; opacity: number; sourceReference?: LayerV1['sourceReference'] }>();
        if (portable) {
          for (const identity of env.image.layers) {
            exact(identity, ['id', 'kind', 'opacity', 'nativeId', ...(Object.hasOwn(identity,'sourceReference')?['sourceReference']:[])], 'Flow native layer identity');
            if (!Number.isSafeInteger(identity.nativeId) || Number(identity.nativeId) < 1 || Number(identity.nativeId) > 0x7fffffff || identities.has(Number(identity.nativeId)))
              refuse('invalid-input', 'Invalid or duplicate portable layer identity');
            identities.set(Number(identity.nativeId), identity as unknown as { id: string; kind: LayerV1['kind']; opacity: number; sourceReference?: LayerV1['sourceReference'] });
          }
          if (layers.some(layer => !identities.has(layer.nativeId!))) refuse('unsupported-input', 'Missing or unknown native layer identity; cannot match Flow layers');
        }
        const native = layers.every(layer => Number.isSafeInteger(layer.nativeId) && layer.nativeId! > 0);
        const image: ImageDocumentV1 = { id: env?.image.id ?? 'tiff-image', revision: env?.image.revision ?? 0,
          width: result.width, height: result.height, layers: layers.map((layer, i) => {
            const identity = portable ? identities.get(layer.nativeId!) : env?.image.layers[i];
            if (identity) {
              if (!portable) exact(identity, ['id', 'kind', 'opacity'], 'Flow layer identity');
              if (Math.round(Number(identity.opacity) * 255) !== Math.round(layer.opacity * 255)) refuse('unsupported-input', 'Flow opacity conflicts with TIFF record; resolve external metadata before importing');
            }
            const { nativeId, ...raster } = layer;
            return { ...raster, ...(identity?.sourceReference ? {sourceReference: identity.sourceReference} : {}), id: identity?.id ?? (nativeId ? `native-${nativeId}` : `layer-${i}`), kind: identity?.kind ?? 'image',
              opacity: identity?.opacity ?? layer.opacity, width: result.width, height: result.height, assetId: '0'.repeat(64) };
          }) };
        const checked = snapshot({ image, text: env?.text ?? null }, limits);
        const candidates: TiffCandidate['image']['layers'] = [];
        for (const [i, layer] of checked.image.layers.entries()) {
          const file = path.join(root, `${i}.png`);
          if ((await fs.stat(file)).size > limits.maxPngBytes) refuse('resource-limit', 'Worker PNG exceeds limit');
          const png = await pngBytes(await fs.readFile(file), image.width, image.height, limits);
          const { assetId: _untrusted, ...properties } = layer;
          candidates.push({ ...properties, png });
        }
        return { identity: portable ? 'portable' : env === null && native ? 'native' : 'unverified', kind: result.kind, image: { ...checked.image, layers: candidates }, text: checked.text };
      });
    },
    encode(input, readAsset) {
      let copied: ReturnType<typeof snapshot>;
      try { copied = snapshot(input, limits); } catch (e) { return Promise.resolve(failed(e)); }
      return worker(async root => {
        for (const [i, layer] of copied.image.layers.entries()) {
          let provided: Uint8Array;
          try { provided = await readAsset(layer.assetId); }
          catch (e) { refuse('missing-asset', `Could not read ${layer.assetId}: ${e instanceof Error ? e.message : e}`); }
          // Copy immediately on resolution, before any further await.
          if (!(provided! instanceof Uint8Array) || provided!.length === 0) refuse('invalid-input', `Missing PNG bytes for ${layer.id}`);
          if (provided!.length > limits.maxPngBytes) refuse('resource-limit', 'PNG exceeds encoded-byte limit');
          const png = Buffer.from(provided!);
          if (digest(png) !== layer.assetId) refuse('invalid-input', `Immutable asset digest mismatch for ${layer.id}`);
          await pngBytes(png, copied.image.width, copied.image.height, limits);
          await fs.writeFile(path.join(root, `${i}.png`), png, { flag: 'wx' });
        }
        const envelope = { app: 'Storyboard Flow', format: 'flow-tiff', rasterVersion: copied.image.layers.some(l=>l.sourceReference) ? 3 : 2,
          image: { id: copied.image.id, revision: copied.image.revision,
            layers: copied.image.layers.map(({ id, kind, opacity, sourceReference }) => ({ id, kind, opacity, ...(sourceReference ? {sourceReference} : {}), nativeId: (createHash('sha256').update(id).digest().readUInt32BE(0) & 0x7fffffff) || 1 })) }, text: copied.text };
        if (new Set(envelope.image.layers.map(l => l.nativeId)).size !== envelope.image.layers.length) refuse('invalid-input', 'Native layer identity collision');
        await run(root, 'encode', { image: copied.image, envelope });
        const file = path.join(root, 'output.tiff');
        if ((await fs.stat(file)).size > limits.maxTiffBytes) refuse('resource-limit', 'Encoded TIFF exceeds limit');
        return new Uint8Array(await fs.readFile(file));
      });
    }
  };
}

/** Admission example seam. Candidate PNGs gain asset IDs only from the depot's
 * receipts. Partial immutable admissions can remain on failure; no head is published. */
export async function admitTiffCandidate(candidate: TiffCandidate, depot: FlowAssetDepot, operationId: string): Promise<TiffResult<ImageDocumentV1>> {
  try {
    exact(candidate, ['identity', 'kind', 'image', 'text'], 'TIFF candidate');
    if (!['portable', 'native', 'unverified'].includes(candidate.identity)) refuse('invalid-input', 'Invalid identity confidence');
    if (candidate.kind !== 'plain' && candidate.kind !== 'layered') refuse('invalid-input', 'Invalid TIFF candidate kind');
    checkDimensions(candidate.image, CAPS);
    for (const layer of candidate.image.layers) {
      exact(layer, ['id', 'name', 'kind', 'visible', 'locked', 'opacity', 'blendMode', 'width', 'height', 'png', ...(Object.hasOwn(layer,'sourceReference')?['sourceReference']:[])], 'TIFF candidate layer');
      if (!(layer.png instanceof Uint8Array) || layer.png.length === 0) refuse('invalid-input', 'Candidate requires PNG bytes');
      if (layer.png.length > CAPS.maxPngBytes) refuse('resource-limit', 'Candidate PNG exceeds limit');
    }
    const input = structuredClone(candidate);
    snapshot({ image: { ...input.image, layers: input.image.layers.map(({ png: _png, ...layer }) => ({ ...layer, assetId: '0'.repeat(64) })) }, text: input.text }, CAPS);
    const layers: LayerV1[] = [];
    for (const [index, layer] of input.image.layers.entries()) {
      const receipt = await depot.put({ operationId: `${operationId}:${index}`, png: layer.png, width: layer.width, height: layer.height });
      if (!receipt.ok) refuse('missing-asset', `Asset admission failed: ${receipt.error.code}: ${receipt.error.message}`);
      const { png: _bytes, ...properties } = layer;
      layers.push({ ...properties, assetId: receipt.value.assetId });
    }
    return { ok: true, value: { ...input.image, layers } };
  } catch (e) { return failed(e); }
}
