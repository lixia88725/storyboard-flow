import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type { DialogueV1, ImageDocumentV1 } from '../../platform/contracts/refactorV1.js';
import type { PresentationReceipt } from './formats/presentation.js';
import type { TiffCodec } from './formats/index.js';

/** Raster/TIFF source reading shared by project creation (and reusable by a later
 * import-into-session flow). Paths are always main-owned absolute paths; nothing
 * here writes a source file. */
export const SOURCE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.tif', '.tiff']);
export const SOURCE_BYTE_LIMIT = 128 * 1024 * 1024;
export const SOURCE_PNG_LIMIT = 32 * 1024 * 1024;
export const SOURCE_PIXEL_LIMIT = 16 * 1024 * 1024;
export const SOURCE_DIMENSION_LIMIT = 8192;

export type ImageSourceIssue = { file: string; reason: string; action: 'skip' | 'flatten' };
export type ScannedSource = { file: string; name: string };
export type ReadSource = { bytes: Buffer; digest: string };

type ConvertedLayer = Omit<ImageDocumentV1['layers'][number], 'assetId'> & { png: Uint8Array };
export type ConvertedSource = {
  kind: 'raster' | 'tiff';
  width: number;
  height: number;
  layers: ConvertedLayer[];
  text: { shotName: string; scriptText: string; dialogues: DialogueV1[]; presentation?: PresentationReceipt } | null;
};
export type ConversionResult =
  | { ok: true; value: ConvertedSource; degradations: string[] }
  | { ok: false; reason: string };

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const supported = (file: string) => SOURCE_EXTENSIONS.has(path.extname(file).toLowerCase());
const natural = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });
const order = (left: ScannedSource, right: ScannedSource) =>
  natural.compare(left.name, right.name) || (left.name < right.name ? -1 : left.name > right.name ? 1 : left.file < right.file ? -1 : left.file > right.file ? 1 : 0);

const isMissing = (error: unknown) => (error as NodeJS.ErrnoException)?.code === 'ENOENT';

/** Bind one caller-supplied source file. Aliases, links and non-files are refused
 * rather than resolved: a retargeted alias would move the read somewhere else. */
export async function bindImageSource(file: string): Promise<ScannedSource> {
  if (typeof file !== 'string' || !file || file.includes('\0') || !path.isAbsolute(file)) throw Error(`Image source must be an absolute path: ${file}`);
  if (!supported(file)) throw Error(`Unsupported image type: ${path.basename(file)}`);
  const entry = await fs.lstat(file).catch(error => { if (isMissing(error)) throw Error(`Image source is missing: ${file}`); throw error; });
  if (entry.isSymbolicLink() || !entry.isFile()) throw Error(`Image source must be a regular file, not a link: ${file}`);
  if (await fs.realpath(file) !== file) throw Error(`Image source is a path alias; use its canonical path: ${file}`);
  return { file, name: path.basename(file) };
}

/** Direct children only; a folder scan never descends. Non-image entries are not
 * candidates, so notes and sidecars do not become issues. */
export async function scanImageSources(source: { kind: 'files'; files: string[] } | { kind: 'folder'; folder: string }): Promise<ScannedSource[]> {
  let found: ScannedSource[];
  if (source?.kind === 'files') {
    if (!Array.isArray(source.files) || !source.files.length || source.files.length > 10_000) throw Error('Creating a project requires 1–10000 image files');
    found = [];
    for (const file of source.files) found.push(await bindImageSource(file));
  } else if (source?.kind === 'folder') {
    const folder = source.folder;
    if (typeof folder !== 'string' || !folder || folder.includes('\0') || !path.isAbsolute(folder)) throw Error('Image source folder must be an absolute path');
    const entry = await fs.lstat(folder).catch(error => { if (isMissing(error)) throw Error(`Image source folder is missing: ${folder}`); throw error; });
    if (!entry.isDirectory() || entry.isSymbolicLink() || await fs.realpath(folder) !== folder) throw Error(`Image source folder must be a real canonical directory: ${folder}`);
    found = [];
    for (const item of await fs.readdir(folder, { withFileTypes: true })) {
      if (item.name.startsWith('.') || !supported(item.name)) continue;
      if (!item.isFile()) throw Error(`Image source must be a regular file, not a link or folder: ${path.join(folder, item.name)}`);
      found.push({ file: path.join(folder, item.name), name: item.name });
    }
  } else throw Error('Unsupported image source kind');
  if (!found.length) throw Error('No supported images were found (JPEG, PNG, TIFF)');
  if (found.length > 10_000) throw Error('Creating a project requires at most 10000 images');
  if (new Set(found.map(entry => entry.file)).size !== found.length) throw Error('The same image source was listed twice');
  return found.sort(order);
}

/** Read the exact bytes a later verification will compare. No write, no rename. */
export async function readImageSource(source: ScannedSource): Promise<ReadSource> {
  const canonical = await fs.realpath(source.file).catch(error => {
    if (isMissing(error)) throw Error(`Image source is missing: ${source.name}`);
    throw error;
  });
  if (canonical !== source.file) throw Error(`Image source became a path alias: ${source.name}`);
  const handle = await fs.open(source.file, constants.O_RDONLY | constants.O_NOFOLLOW).catch(error => {
    if (isMissing(error)) throw Error(`Image source is missing: ${source.name}`);
    throw error;
  });
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(SOURCE_BYTE_LIMIT)) throw Error(`Unsupported image file: ${source.name}`);
    const bytes = await handle.readFile();
    if (bytes.length > SOURCE_BYTE_LIMIT) throw Error(`Image source exceeds the ${SOURCE_BYTE_LIMIT}-byte limit: ${source.name}`);
    const after = await handle.stat({ bigint: true });
    if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeNs !== before.mtimeNs)
      throw Error(`Image source changed while it was read: ${source.name}`);
    return { bytes, digest: digest(bytes) };
  } finally { await handle.close(); }
}

const pngLayer = (png: Uint8Array, width: number, height: number): ConvertedLayer => ({
  id: 'image', name: 'Image', kind: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', png, width, height
});

/** sharp does not expose APNG frame counts, so the animation-control chunk is
 * inspected directly. A multi-frame file has no reliable single-frame meaning. */
function animatedPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
    if (type === 'acTL') return true;
    if (type === 'IEND' || length > bytes.length) return false;
    offset += 12 + length;
  }
  return false;
}

/** JPEG Multi-Picture (MPO) files carry an APP2 MPF segment and several images;
 * only the first would be visible, so they are refused like animation. */
function multiPictureJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return false;
    const marker = bytes[offset + 1];
    if (marker === 0xd9 || marker === 0xda) return false;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) return false;
    if (marker === 0xe2 && length >= 7 && bytes[offset + 4] === 0x4d && bytes[offset + 5] === 0x50 &&
        bytes[offset + 6] === 0x46 && bytes[offset + 7] === 0x00) return true;
    offset += 2 + length;
  }
  return false;
}

/** Convert one source into canvas-sized RGBA layers. A refusal is a per-file defect
 * the caller may confirm as a skip; it is never a silent flatten. */
export async function convertImageSource(source: ScannedSource, read: ReadSource, codec: TiffCodec): Promise<ConversionResult> {
  const extension = path.extname(source.name).toLowerCase();
  if (extension === '.tif' || extension === '.tiff') {
    const decoded = await codec.decode(read.bytes);
    if (!decoded.ok) return { ok: false, reason: `${decoded.error.code}: ${decoded.error.message}` };
    const candidate = decoded.value;
    // Layer pixels and properties are authoritative; identity labels only say
    // whether a previous Flow baseline could be matched, which a new project
    // does not have. Unknown structures were already refused by the codec.
    return { ok: true, degradations: [], value: {
      kind: 'tiff', width: candidate.image.width, height: candidate.image.height,
      layers: candidate.image.layers.map(layer => ({ ...layer, width: candidate.image.width, height: candidate.image.height })),
      text: candidate.text ? { shotName: candidate.text.shotName, scriptText: candidate.text.scriptText,
        dialogues: candidate.text.dialogues, ...(candidate.text.presentation ? { presentation: candidate.text.presentation } : {}) } : null
    } };
  }
  let meta;
  try {
    meta = await sharp(read.bytes, { failOn: 'error', limitInputPixels: SOURCE_PIXEL_LIMIT }).metadata();
  } catch (error) {
    return { ok: false, reason: `unreadable image: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (meta.format !== 'png' && meta.format !== 'jpeg') return { ok: false, reason: `unsupported raster format: ${meta.format ?? 'unknown'}` };
  if ((meta.format === 'png' && animatedPng(read.bytes)) || (meta.format === 'jpeg' && multiPictureJpeg(read.bytes)))
    return { ok: false, reason: 'multi-frame image has no reliable single-frame composition; export a single frame' };
  const width = meta.autoOrient?.width ?? meta.width, height = meta.autoOrient?.height ?? meta.height;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      width > SOURCE_DIMENSION_LIMIT || height > SOURCE_DIMENSION_LIMIT || width * height > SOURCE_PIXEL_LIMIT) {
    return { ok: false, reason: `canvas ${width}x${height} exceeds the ${SOURCE_DIMENSION_LIMIT}px / ${SOURCE_PIXEL_LIMIT}-pixel project limit` };
  }
  if ((meta.pages ?? 1) > 1) return { ok: false, reason: 'multi-frame or animated image has no reliable single-frame composition; export a single frame' };
  const degradations: string[] = [];
  if (meta.depth !== 'uchar') degradations.push(`${meta.depth ?? 'unknown'}-bit samples are reduced to 8-bit`);
  if (meta.space === 'cmyk') degradations.push('CMYK is converted to sRGB');
  let png: Buffer;
  try {
    let pipeline = sharp(read.bytes, { failOn: 'error', limitInputPixels: SOURCE_PIXEL_LIMIT }).rotate();
    if (meta.space === 'cmyk') pipeline = pipeline.toColourspace('srgb');
    const { data, info } = await pipeline.ensureAlpha().raw({ depth: 'uchar' }).toBuffer({ resolveWithObject: true });
    if (info.channels !== 4 || info.width !== width || info.height !== height) throw Error('decoded RGBA geometry disagrees with its metadata');
    // Re-encode as a deterministic 8-bit RGBA PNG; depot admission binds bytes by digest.
    png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  } catch (error) {
    return { ok: false, reason: `unreadable image: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (png.length > SOURCE_PNG_LIMIT) return { ok: false, reason: `prepared PNG exceeds the ${SOURCE_PNG_LIMIT}-byte asset limit` };
  return { ok: true, degradations, value: { kind: 'raster', width, height, layers: [pngLayer(png, width, height)], text: null } };
}
