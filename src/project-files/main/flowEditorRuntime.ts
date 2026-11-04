import { flowCodecOptions } from '../../platform/main/flowRuntimePaths.js';
import type { TrashItem } from './flowOutputTrash.js';
import { openFlowTiffSave } from './flowTiffSave.js';
import { createTiffCodec } from './formats/index.js';
import { createPresentationCodec } from './formats/presentation.js';
import { preparePendingAdd, type PendingAppendInput, type PendingAppendOptions } from './appendPendingImages.js';
import { readImageSource } from './imageSourceConversion.js';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { openFlowAssetDepot } from './persistence/depot.js';
import { createProjectStore } from './persistence/index.js';
import type { ProjectV1 } from '../../platform/contracts/refactorV1.js';
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
  const rawCodec = createTiffCodec(flowCodecOptions());
  const output = await openFlowTiffSave(root, projectId, rawCodec, trashItem);
  const checkpointAccess={
    load:async()=>{const value=await store.loadCheckpoint(root);if(!value.ok)throw Error(value.error.message);return value.value.project;},
    save:async(project:ProjectV1)=>{const result=await store.saveCheckpoint(root,project,async id=>{const r=await depot.value.read(id);if(!r.ok)throw Error(r.error.message);return r.value;});if(!result.ok)throw Error(result.error.message);}
  };
  // Finish an interrupted Pending append before exposing the project for editing.
  if(await output.hasPendingAdd()){
    await output.resumePendingAdd(depot.value,checkpointAccess);
    loaded=await store.loadCheckpoint(root);if(!loaded.ok)throw Error(loaded.error.message);
  }
  if(await output.hasPendingRefresh()){
    await output.refresh(loaded.value.project,depot.value,checkpointAccess);
    loaded=await store.loadCheckpoint(root);if(!loaded.ok)throw Error(loaded.error.message);
  }
  const bootstrap=structuredClone(loaded.value.project);
  let sealed = false, pending = 0, refreshing = false, pendingAddRetained = false;
  const retainedAdd = () => pendingAddRetained ? { ok: false as const, error: { code: 'busy' as const, message: 'Retry the retained Pending add', effect: 'unknown' as const } } : null;
  const busy = () => ({ ok: false as const, error: { code: 'busy' as const, message: 'Editor is closing', effect: 'none' as const } });
  return {
    open: () => ({ sessionId, project: structuredClone(bootstrap) }),
    /** One append into the end of Pending. The file side verifies that the caller's
     * project is the durable checkpoint, writes only this batch, and returns the
     * exact after project (revision + 1) that the Session installs once. */
    async appendPending(project: ProjectV1, input: { source?: PendingAppendInput['source']; recover?: boolean; operationId?: string }, options: PendingAppendOptions) {
      if (sealed || refreshing) return busy();
      if (project?.id !== projectId) return { ok: false as const, error: { code: 'conflict' as const, message: 'Different project identity', effect: 'none' as const } };
      if (typeof input?.operationId !== 'string' || !/^[\w.:-]{1,100}$/.test(input.operationId))
        return { ok: false as const, error: { code: 'invalid-input' as const, message: 'A valid Pending operation id is required', effect: 'none' as const } };
      if (input?.recover || pendingAddRetained) {
        try {
          const resumed = await output.resumePendingAdd(depot.value, checkpointAccess, input.operationId);
          if (!resumed) return { ok: false as const, error: { code: 'not-found' as const, message: 'No retained Pending add to recover', effect: 'none' as const } };
          pendingAddRetained = false;
          return { ok: true as const, value: resumed };
        } catch (error) {
          return { ok: false as const, error: { code: 'io-failure' as const, message: error instanceof Error ? error.message : String(error), effect: 'unknown' as const } };
        }
      }
      if (!input?.source) return { ok: false as const, error: { code: 'invalid-input' as const, message: 'Image source is required', effect: 'none' as const } };
      pending++;
      try {
        const plan = await preparePendingAdd(project, input.source, options, { codec: createPresentationCodec(rawCodec), depot: depot.value });
        const additions = plan.additions.map(addition => {
          const original = addition.original;
          return original.kind === 'source'
            ? { shot: addition.shot, image: addition.image, dialogues: addition.dialogues, basis: addition.basis,
                original: { kind: 'source' as const, digest: original.digest,
                  read: async () => (await readImageSource(original.source)).bytes } }
            : { shot: addition.shot, image: addition.image, dialogues: addition.dialogues, basis: addition.basis,
                original: { kind: 'output' as const } };
        });
        const value = await output.appendPending(project, additions,
          async id => { const asset = await depot.value.read(id); if (!asset.ok) throw Error(asset.error.message); return asset.value; },
          checkpointAccess, input.operationId, { signal: options.signal, onProgress: progress => options.onProgress?.({ ...progress, phase: 'write' }) });
        return { ok: true as const, value };
      } catch (error) {
        let retained = (error as { pendingAddRetained?: boolean })?.pendingAddRetained;
        if (retained === undefined) { try { retained = await output.hasPendingAdd(); } catch { retained = true; } }
        pendingAddRetained = retained;
        return { ok: false as const, error: { code: 'io-failure' as const, message: error instanceof Error ? error.message : String(error),
          effect: retained ? 'unknown' as const : 'none' as const } };
      } finally { pending--; }
    },
    read: depot.value.read,
    folderStatus: output.folderStatus,
    outputNames: (project: ProjectV1) => output.outputNames(project),
    async put(input: Parameters<typeof depot.value.put>[0]) {
      if (sealed || refreshing) return busy();
      if (pendingAddRetained) return retainedAdd()!;
      pending++;
      try { return await depot.value.put(input); } finally { pending--; }
    },
    async refresh(project:ProjectV1){
      if(sealed||pending)return {ok:false as const,error:{code:'busy' as const,message:'Editor has pending work',effect:'none' as const}};
      if(pendingAddRetained)return retainedAdd()!;
      pending++;refreshing=true;
      try{return {ok:true as const,value:await output.refresh(project,depot.value,checkpointAccess)};}
      catch(error){return {ok:false as const,error:{code:'io-failure' as const,message:error instanceof Error?error.message:String(error),effect:(error as {refreshPending?:boolean})?.refreshPending?'unknown' as const:'retained' as const}};}
      finally{pending--;refreshing=false;}
    },
    async saveTiff(project: ProjectV1) {
      if (sealed || refreshing) return busy();
      if (pendingAddRetained) return retainedAdd()!;
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
      if (pendingAddRetained) return retainedAdd()!;
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
      if (sealed || pending || pendingAddRetained || output.hasPendingTrashAcknowledgements() || !project || project.id !== projectId) return false;
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
