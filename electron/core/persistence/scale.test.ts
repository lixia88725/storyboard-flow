import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import type { DialogueV1, ImageDocumentV1, ProjectV1, ShotV1 } from '../../shared/refactorV1.js';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createProjectStore } from './index';
import { layerOf, picture, readerFor, storePaths, type Picture } from './store.fixture';

const store = createProjectStore();

const IMAGE_COUNT = 1000;
const ACTIVE_SHOTS = 900;
const ASSET_COUNT = 8;
const WIDTH = 32;
const HEIGHT = 24;

/** Metadata-shaped workload: many documents, a bounded set of small immutable
 * images. It says nothing about large-raster or drawing performance. */
const scaleScene = async (): Promise<{ project: ProjectV1; assets: Map<string, Buffer> }> => {
  const pictures: Picture[] = await Promise.all(
    Array.from({ length: ASSET_COUNT }, (_, index) => picture((index * 31) % 256, WIDTH, HEIGHT))
  );
  const images: Record<string, ImageDocumentV1> = {};
  const shots: ShotV1[] = [];
  const parkedShots: ShotV1[] = [];
  const dialogues: DialogueV1[] = [];

  for (let index = 0; index < IMAGE_COUNT; index += 1) {
    const imageId = `image-${index}`;
    images[imageId] = {
      id: imageId,
      revision: 1,
      width: WIDTH,
      height: HEIGHT,
      layers: [
        layerOf('layer-base', pictures[index % ASSET_COUNT]),
        layerOf('layer-ink', pictures[(index + 3) % ASSET_COUNT], { opacity: 0.5, blendMode: 'multiply' })
      ]
    };
    const shot: ShotV1 = {
      id: `shot-${index}`,
      imageId,
      name: `镜头 ${index} — shot ${index}`,
      scriptText: `镜头描述 ${index}\nINT. 教室 — 傍晚\n\n孩子们收拾书包。🎬`
    };
    if (index < ACTIVE_SHOTS) {
      shots.push(shot);
      if (index < 250) {
        dialogues.push({ id: `dialogue-${index}-a`, shotId: shot.id, text: `台词 A ${index}「静か」` });
        dialogues.push({ id: `dialogue-${index}-b`, shotId: shot.id, text: `台词 B ${index} — 老师` });
      }
    } else {
      parkedShots.push({ ...shot, id: `shot-parked-${index}`, name: `备用 ${index}` });
    }
  }

  const assets = new Map<string, Buffer>();
  for (const source of pictures) assets.set(source.id, source.bytes);

  return {
    project: {
      schema: 'storyboard-flow.project',
      version: 1,
      id: 'project-scale',
      revision: 1,
      name: '1000 镜头测试项目',
      shots,
      parkedShots,
      dialogues,
      images
    },
    assets
  };
};

describe('1,000-shot metadata workload', () => {
  it('publishes and reopens 1,000 images over a bounded asset set', async () => {
    const root = await temporaryWorkspace('persistence-scale-');
    const { project, assets } = await scaleScene();

    const writeStarted = performance.now();
    const saved = await store.saveCheckpoint(root, project, readerFor(assets));
    const writeMs = performance.now() - writeStarted;
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.revision).toBe(1);

    const readStarted = performance.now();
    const loaded = await store.loadCheckpoint(root);
    const readMs = performance.now() - readStarted;
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;

    // Exact metadata equality, not a sampled comparison.
    expect(loaded.value.project).toEqual(project);
    expect(loaded.value.project.shots).toHaveLength(ACTIVE_SHOTS);
    expect(loaded.value.project.parkedShots).toHaveLength(IMAGE_COUNT - ACTIVE_SHOTS);
    expect(Object.keys(loaded.value.project.images)).toHaveLength(IMAGE_COUNT);
    expect(loaded.value.project.dialogues).toHaveLength(500);

    // Exactly the bounded asset set, each readable byte for byte.
    const stored = await fs.readdir(storePaths(root).assets);
    expect(stored.sort()).toEqual([...assets.keys()].map((id) => `${id}.png`).sort());
    for (const [id, bytes] of assets) {
      expect(Buffer.from(await loaded.value.readAsset(id)).equals(bytes)).toBe(true);
    }

    const manifest = await fs.stat(storePaths(root).manifest);
    console.log(
      `[scale] 1000 images / 1000 shots / 2000 layers / 500 dialogues / ${ASSET_COUNT} assets of ${WIDTH}x${HEIGHT}; ` +
        `manifest ${manifest.size} bytes; save ${writeMs.toFixed(0)} ms, load ${readMs.toFixed(0)} ms on ${process.platform}/${process.arch}`
    );
  });
});
