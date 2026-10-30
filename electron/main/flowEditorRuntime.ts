import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openFlowTiffSave } from './flowTiffSave.js';
import { createTiffCodec } from '../core/formats/index.js';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { openFlowAssetDepot } from '../core/persistence/depot.js';
import { createProjectStore } from '../core/persistence/index.js';
import type { ProjectV1 } from '../shared/refactorV1.js';
/** One root, one renderer owner. Not used by the normal TIFF/legacy runtime. */
export async function openFlowEditorRuntime(root: string) {
  const store = createProjectStore();
  const loaded = await store.loadCheckpoint(root);
  if (!loaded.ok) throw new Error(loaded.error.message);
  const rootIdentity = await fs.lstat(root, { bigint: true });
  const projectId = loaded.value.project.id;
  const sessionId = randomUUID();
  const depot = await openFlowAssetDepot({ root, sessionId, maxPixels: 32_000_000, maxPngBytes: 64 * 1024 * 1024 });
  if (!depot.ok) throw new Error(depot.error.message);
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const output = await openFlowTiffSave(root, projectId, createTiffCodec({
    scriptPath: path.join(repo, 'electron/core/formats/codec.py'),
    depsDir: process.env.FLOW_PYTHON_DEPS_DIR ?? path.join(repo, 'vendor/python/photoshop-tiff')
  }));
  let sealed = false, pending = 0;
  const busy = () => ({ ok: false as const, error: { code: 'busy' as const, message: 'Editor is closing', effect: 'none' as const } });
  return {
    open: () => ({ sessionId, project: structuredClone(loaded.value.project) }),
    read: depot.value.read,
    async put(input: Parameters<typeof depot.value.put>[0]) {
      if (sealed) return busy();
      pending++;
      try { return await depot.value.put(input); } finally { pending--; }
    },
    async saveTiff(project: ProjectV1) {
      if (sealed) return busy();
      pending++;
      try {
        const value = await output.save(project, async id => {
          const asset = await depot.value.read(id); if (!asset.ok) throw Error(asset.error.message); return asset.value;
        });
        return { ok: true as const, value };
      } catch (error) { return { ok: false as const, error: { message: error instanceof Error ? error.message : String(error) } }; }
      finally { pending--; }
    },
    async checkpoint(project: ProjectV1) {
      if (sealed) return busy();
      if (project?.id !== projectId) return { ok: false as const, error: { code: 'conflict' as const, message: 'Different project identity' } };
      pending++;
      try { return await store.saveCheckpoint(root, project, async id => {
        const asset = await depot.value.read(id);
        if (!asset.ok) throw new Error(asset.error.message);
        return asset.value;
      }); } finally { pending--; }
    },
    async certifyClose(project: ProjectV1 | null) {
      if (sealed || pending || !project || project.id !== projectId) return false;
      sealed = true;
      try {
        const binding = await fs.lstat(root, { bigint: true });
        if (!binding.isDirectory() || binding.isSymbolicLink() || binding.dev !== rootIdentity.dev || binding.ino !== rootIdentity.ino) {
          sealed = false; return false;
        }
        const disk = await store.loadCheckpoint(root);
        // Full strict load checks every referenced asset before permission to close.
        if (!disk.ok || !isDeepStrictEqual(disk.value.project, project)) { sealed = false; return false; }
        const assets = new Set(Object.values(disk.value.project.images).flatMap(image => image.layers.map(layer => layer.assetId)));
        for (const id of assets) {
          const retained = await depot.value.read(id);
          if (!retained.ok) throw new Error(retained.error.message);
        }
        return true;
      } catch { sealed = false; return false; }
    }
  };
}
