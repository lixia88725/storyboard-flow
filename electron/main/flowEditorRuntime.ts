import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TrashItem } from './flowOutputTrash.js';
import { openFlowTiffSave } from './flowTiffSave.js';
import { createTiffCodec } from '../core/formats/index.js';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { openFlowAssetDepot } from '../core/persistence/depot.js';
import { createProjectStore } from '../core/persistence/index.js';
import type { ProjectV1 } from '../shared/refactorV1.js';
/** One root, one renderer owner. Not used by the normal TIFF/legacy runtime. */
export async function openFlowEditorRuntime(root: string, trashItem?: TrashItem) {
  const store = createProjectStore();
  let loaded = await store.loadCheckpoint(root);
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
  }), trashItem);
  const checkpointAccess={
    load:async()=>{const value=await store.loadCheckpoint(root);if(!value.ok)throw Error(value.error.message);return value.value.project;},
    save:async(project:ProjectV1)=>{const result=await store.saveCheckpoint(root,project,async id=>{const r=await depot.value.read(id);if(!r.ok)throw Error(r.error.message);return r.value;});if(!result.ok)throw Error(result.error.message);}
  };
  if(await output.hasPendingRefresh()){
    await output.refresh(loaded.value.project,depot.value,checkpointAccess);
    loaded=await store.loadCheckpoint(root);if(!loaded.ok)throw Error(loaded.error.message);
  }
  const bootstrap=structuredClone(loaded.value.project);
  let sealed = false, pending = 0, refreshing = false;
  const busy = () => ({ ok: false as const, error: { code: 'busy' as const, message: 'Editor is closing', effect: 'none' as const } });
  return {
    open: () => ({ sessionId, project: structuredClone(bootstrap) }),
    read: depot.value.read,
    folderStatus: output.folderStatus,
    async put(input: Parameters<typeof depot.value.put>[0]) {
      if (sealed || refreshing) return busy();
      pending++;
      try { return await depot.value.put(input); } finally { pending--; }
    },
    async refresh(project:ProjectV1){
      if(sealed||pending)return {ok:false as const,error:{code:'busy' as const,message:'Editor has pending work',effect:'none' as const}};
      pending++;refreshing=true;
      try{return {ok:true as const,value:await output.refresh(project,depot.value,checkpointAccess)};}
      catch(error){return {ok:false as const,error:{code:'io-failure' as const,message:error instanceof Error?error.message:String(error),effect:(error as {refreshPending?:boolean})?.refreshPending?'unknown' as const:'retained' as const}};}
      finally{pending--;refreshing=false;}
    },
    async saveTiff(project: ProjectV1) {
      if (sealed || refreshing) return busy();
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
      if (sealed || refreshing) return busy();
      if (project?.id !== projectId) return { ok: false as const, error: { code: 'conflict' as const, message: 'Different project identity' } };
      pending++;
      try {
        if(await output.hasPendingRefresh())return {ok:false as const,error:{code:'conflict' as const,message:'Retry Refresh before checkpoint'}};
        return await store.saveCheckpoint(root, project, async id => {
        const asset = await depot.value.read(id);
        if (!asset.ok) throw new Error(asset.error.message);
        return asset.value;
      }); } finally { pending--; }
    },
    async certifyClose(project: ProjectV1 | null) {
      if (sealed || pending || output.hasPendingTrashAcknowledgements() || !project || project.id !== projectId) return false;
      sealed = true;
      try {
        if(await output.hasPendingRefresh()){sealed=false;return false;}
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
