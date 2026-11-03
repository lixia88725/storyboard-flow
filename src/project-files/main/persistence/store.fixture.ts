import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import type {
  AssetReaderV1,
  DialogueV1,
  ImageDocumentV1,
  LayerV1,
  ProjectV1,
  ShotV1
} from '../../../platform/contracts/refactorV1.js';
import { STORE_DIRECTORY } from './layout.js';

/** Synthetic fixture data only: small solid-colour PNGs written with the
 * project's existing sharp dependency. No personal media is involved. */
export type Picture = { id: string; width: number; height: number; bytes: Buffer };

export const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const picture = async (shade: number, width = 8, height = 6): Promise<Picture> => {
  const bytes = await sharp({
    create: { width, height, channels: 4, background: { r: shade, g: (shade + 85) % 256, b: (shade + 170) % 256, alpha: 1 } }
  })
    .png()
    .toBuffer();
  return { id: sha256(bytes), width, height, bytes };
};

export const layerOf = (id: string, source: Picture, overrides: Partial<LayerV1> = {}): LayerV1 => ({
  id,
  name: `layer ${id}`,
  kind: 'image',
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: 'normal',
  width: source.width,
  height: source.height,
  assetId: source.id,
  ...overrides
});

export const imageOf = (id: string, sources: Picture[], overrides: Partial<ImageDocumentV1> = {}): ImageDocumentV1 => ({
  id,
  revision: 1,
  width: sources[0].width,
  height: sources[0].height,
  layers: sources.map((source, index) => layerOf(`layer-${index + 1}`, source)),
  ...overrides
});

export const shotOf = (id: string, imageId: string, overrides: Partial<ShotV1> = {}): ShotV1 => ({
  id,
  imageId,
  name: `shot ${id}`,
  scriptText: '',
  ...overrides
});

export const dialogueOf = (id: string, shotId: string, text: string): DialogueV1 => ({ id, shotId, text });

export type Scene = { project: ProjectV1; assets: Map<string, Buffer> };

/**
 * A small multi-shot, multilayer scene that covers the shapes wave 1 must keep:
 * active and parked shots, a deleted-but-retained image no shot references,
 * two layers in one image, a reused asset, and Unicode text.
 */
export const scene = async (): Promise<Scene> => {
  const [sky, ink, paper, spare, reused] = await Promise.all([10, 60, 110, 160, 210].map((shade) => picture(shade)));
  const project: ProjectV1 = {
    schema: 'storyboard-flow.project',
    version: 1,
    id: 'project-scene',
    revision: 1,
    name: '故事板 · Storyboard ✂️',
    shots: [
      shotOf('shot-1', 'image-1', { name: '黎明 — dawn', scriptText: '镜头一\nINT. 教室 — 清晨\n\n孩子们走进来。' }),
      shotOf('shot-2', 'image-2', { name: '镜头二', scriptText: 'Ünïcode: naïve café — 🎬' })
    ],
    parkedShots: [shotOf('shot-parked', 'image-3', { name: '备用镜头', scriptText: 'parked' })],
    dialogues: [
      dialogueOf('dialogue-1', 'shot-1', '「静かな朝」'),
      dialogueOf('dialogue-2', 'shot-1', '— 老师：早上好。'),
      dialogueOf('dialogue-3', 'shot-parked', '备用台词 🎞')
    ],
    images: {
      'image-1': imageOf('image-1', [sky, ink]),
      'image-2': imageOf('image-2', [paper]),
      'image-3': imageOf('image-3', [reused], { revision: 3 }),
      // Deleted but retained: no shot points at it, the checkpoint must still keep it.
      'image-4': imageOf('image-4', [reused, spare], { revision: 2 })
    }
  };
  const assets = new Map<string, Buffer>();
  for (const source of [sky, ink, paper, spare, reused]) assets.set(source.id, source.bytes);
  return { project, assets };
};

export const readerFor = (assets: Map<string, Buffer>): AssetReaderV1 => async (id) => {
  const bytes = assets.get(id);
  if (!bytes) throw new Error(`fixture has no asset ${id}`);
  return bytes;
};

export const missingReader = (): AssetReaderV1 => async (id) => {
  throw new Error(`fixture reader refuses ${id}`);
};

export const storePaths = (root: string) => {
  const store = path.join(root, STORE_DIRECTORY);
  return {
    store,
    assets: path.join(store, 'assets'),
    versions: path.join(store, 'versions'),
    manifest: path.join(store, 'project.json')
  };
};

/** Every entry below `directory`, as sorted relative paths. */
export const listTree = async (directory: string, prefix = ''): Promise<string[]> => {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const found: string[] = [];
  for (const entry of entries.sort((left, right) => (left.name < right.name ? -1 : 1))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    found.push(relative);
    if (entry.isDirectory()) found.push(...(await listTree(path.join(directory, entry.name), relative)));
  }
  return found;
};

export const readJson = async (file: string): Promise<unknown> =>
  JSON.parse(await fs.readFile(file, 'utf8')) as unknown;

/** Copy a project so a test can submit a variant without touching the original. */
export const clone = (project: ProjectV1): ProjectV1 => structuredClone(project);
