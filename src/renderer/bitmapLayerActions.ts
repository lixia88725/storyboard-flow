import type { MutableRefObject } from "react";
import {
  addBitmapLayer,
  bitmapLayersForShot,
  clearBitmapLayer,
  deleteBitmapLayer,
  mergeBitmapLayerDown,
  mergeSelectedBitmapLayers,
  mergeVisibleBitmapLayers
} from "../shared/projectOps";
import type { BitmapLayer, Project } from "../shared/types";
import type { BitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import type { CompletedEffect, DurableEffectHooks } from "./normalSaveProjectOwner";
import { readLayerAssetSnapshots, type LayerAssetSnapshot } from "./bitmapLayerHistory";
import { canvasSizeForShot } from "./sketchRendering";
import { sketchCanvasSize } from "./sketchGeometry";

export type BitmapLayerProjectUpdate = Project | ((currentProject: Project) => Project);

export const visibleLayerBelow = (
  layers: BitmapLayer[],
  sourceLayerId: string
): BitmapLayer | undefined => {
  const sourceIndex = layers.findIndex((layer) => layer.id === sourceLayerId);
  if (sourceIndex <= 0) {
    return undefined;
  }

  return [...layers.slice(0, sourceIndex)].reverse().find((layer) => layer.visible);
};

export type BitmapLayerActionsOptions<HistoryEntry> = {
  captureEnsureScope?: () => () => boolean;
  captureEffectCompletion?: () => CompletedEffect;
  isImageImportLocked: () => boolean;
  // Owner token changes on open/reload/Save/destination invalidation, including A→B→A.
  // Until the owner wires this port, object/metadata checks cannot detect origin ABA.
  getWorkspaceIdentity?: () => object;
  projectRef: MutableRefObject<Project>;
  folderPath: string | undefined;
  bitmapLayerWriteQueueRef: MutableRefObject<BitmapLayerWriteQueue>;
  createTransparentLayerDataUrl: (width: number, height: number) => Promise<string>;
  createHistoryEntry: (bitmapPaths?: string[]) => Promise<HistoryEntry>;
  getHistoryLayerAssets?: (entry: HistoryEntry) => readonly LayerAssetSnapshot[] | undefined;
  rebaseAddHistoryEntry?: (entry: HistoryEntry, project: Project) => HistoryEntry;
  recordUndoEntry: (entry: HistoryEntry) => void;
  markShotsDirty: (shotIds: string[]) => void;
  updateProject: (
    projectUpdate: BitmapLayerProjectUpdate,
    markFileNamesUnsynced?: boolean,
    recordUndo?: boolean
  ) => void;
  setStatus: (status: string) => void;
};

export const useBitmapLayerActions = <HistoryEntry,>({
  captureEnsureScope,
  captureEffectCompletion,
  isImageImportLocked,
  getWorkspaceIdentity,
  projectRef,
  folderPath,
  bitmapLayerWriteQueueRef,
  createTransparentLayerDataUrl,
  createHistoryEntry,
  getHistoryLayerAssets,
  rebaseAddHistoryEntry,
  recordUndoEntry,
  markShotsDirty,
  updateProject,
  setStatus
}: BitmapLayerActionsOptions<HistoryEntry>) => {
  // No safe rebase for these frozen-history/precomputed-project actions. Reject
  // stale read-only preparation before the first write/publication, never after it.
  const capturePreparation = (checkImportLock = true) => {
    const isOwnerCurrent = captureEnsureScope?.();
    const identity = getWorkspaceIdentity?.();
    const project = projectRef.current;
    const baseline = JSON.stringify(project);
    return () => {
      if (isOwnerCurrent && !isOwnerCurrent()) return false;
      if (identity !== getWorkspaceIdentity?.()) return false;
      if (checkImportLock && isImageImportLocked()) return false;
      if (projectRef.current !== project || JSON.stringify(projectRef.current) !== baseline) {
        setStatus("Storyboard changed during layer preparation; try again");
        return false;
      }
      return true;
    };
  };
  // Re-evaluates ONLY the workspace-owner admission immediately after the real pixel effect: a newer
  // load, held receipt, unconsumed script input or raw/unknown output state. The pre-effect import
  // lock / project baseline checks keep their existing meaning, so an Import lock that arrives after
  // the asset write still publishes its own metadata/history. A refused effect is handed back, never
  // silently dropped.
  const beginEffect = (update: BitmapLayerProjectUpdate, ids: readonly string[]) => {
    const ownerAdmissible = captureEnsureScope?.();
    const completion = captureEffectCompletion?.();
    return Object.assign(() => {
      // Ordinary publication must remain synchronous: no new load/publication await gap.
      if (!ownerAdmissible || ownerAdmissible()) return undefined;
      return completion ? completion(update, ids) : Promise.resolve();
    }, { isCurrent: () => !!ownerAdmissible?.(), effect: async <T,>(write: () => Promise<T>): Promise<T> => {
      try { return await write(); }
      catch (error) { completion?.failed(error, ids); throw error; }
    }, durable: (hooks: DurableEffectHooks) => completion ? completion(update, ids, hooks) : undefined,
    failed: (error: unknown) => completion?.failed(error, ids) });
  };
  const handleClearBitmapLayer = async (shotId: string, layerId: string) => {
    if (isImageImportLocked()) return;
    const isPreparedCurrent = capturePreparation();
    const shot = projectRef.current.shots.find((item) => item.id === shotId);
    const layer = shot ? bitmapLayersForShot(shot).find((item) => item.id === layerId) : undefined;

    if (!window.storyboard || !folderPath || !layer || layer.locked) {
      return;
    }

    await bitmapLayerWriteQueueRef.current.enqueue(layer.bitmapPath, async () => {
      if (!isPreparedCurrent()) return;
      const currentShot = projectRef.current.shots.find((item) => item.id === shotId);
      const currentLayer = currentShot ? bitmapLayersForShot(currentShot).find((item) => item.id === layerId) : undefined;
      if (!currentLayer || currentLayer.locked) {
        return;
      }

      const undoEntry = await createHistoryEntry([currentLayer.bitmapPath]);
      const dataUrl = await createTransparentLayerDataUrl(currentLayer.width, currentLayer.height);
      if (!isPreparedCurrent()) return;
      const completed = beginEffect(p => clearBitmapLayer(p, shotId, layerId), [shotId]);
      await completed.effect(() => window.storyboard!.writeLayerPng({ folderPath, bitmapPath: currentLayer.bitmapPath, dataUrl }));
      const handoff = completed();
      if (handoff) { await handoff; return; }
      markShotsDirty([shotId]);
      recordUndoEntry(undoEntry);
      updateProject((currentProject) => clearBitmapLayer(currentProject, shotId, layerId), false, false);
    });
  };

  const handleRemoveBitmapLayer = async (shotId: string, layerId: string) => {
    if (isImageImportLocked()) return;
    const isPreparedCurrent = capturePreparation();
    const projectAtRequest = projectRef.current;
    const shot = projectAtRequest.shots.find((item) => item.id === shotId);
    const layer = shot ? bitmapLayersForShot(shot).find((item) => item.id === layerId) : undefined;

    if (!window.storyboard || !folderPath || !layer || layer.locked) {
      return;
    }

    await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
      if (!isPreparedCurrent()) return;
      if (projectRef.current !== projectAtRequest) {
        setStatus("Storyboard changed before layer removal; try again");
        return;
      }
      const currentProject = projectRef.current;
      const currentShot = currentProject.shots.find((item) => item.id === shotId);
      const currentLayers = currentShot ? bitmapLayersForShot(currentShot) : [];
      const currentLayer = currentLayers.find((item) => item.id === layerId);
      if (!currentLayer || currentLayer.locked || currentLayers.length <= 1) {
        return;
      }

      // Confirm metadata accepts the removal before touching its pixel asset.
      const nextProject = deleteBitmapLayer(currentProject, shotId, layerId);
      const nextShot = nextProject.shots.find((item) => item.id === shotId);
      const nextLayers = nextShot ? bitmapLayersForShot(nextShot) : [];
      if (!nextLayers.length || nextLayers.some((item) => item.id === layerId)) {
        return;
      }

      const undoEntry = await createHistoryEntry([currentLayer.bitmapPath]);
      if (!isPreparedCurrent()) return;
      const completed = beginEffect(p => deleteBitmapLayer(p, shotId, layerId), [shotId]);
      await completed.effect(() => window.storyboard!.deleteLayerPng({
        folderPath,
        bitmapPath: currentLayer.bitmapPath
      }));
      const handoff = completed();
      if (handoff) { await handoff; return; }
      markShotsDirty([shotId]);
      recordUndoEntry(undoEntry);
      updateProject(
        (project) => deleteBitmapLayer(project, shotId, layerId),
        false,
        false
      );
    });
  };

  const handleMergeBitmapLayerDown = async (shotId: string, layerId: string) => {
    if (isImageImportLocked()) return;
    const isPreparedCurrent = capturePreparation();
    const projectAtRequest = projectRef.current;
    const shot = projectAtRequest.shots.find((item) => item.id === shotId);
    const layers = shot ? bitmapLayersForShot(shot) : [];
    const sourceLayer = layers.find((item) => item.id === layerId && item.visible);
    const targetLayer = sourceLayer ? visibleLayerBelow(layers, sourceLayer.id) : undefined;

    if (!window.storyboard || !folderPath || !shot || !sourceLayer) {
      return;
    }

    if (!targetLayer) {
      setStatus("No visible layer below to merge into");
      return;
    }

    if (sourceLayer.locked || targetLayer.locked) {
      setStatus("Unlock both layers before merging down");
      return;
    }

    try {
      await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
        if (!isPreparedCurrent()) return;
        if (projectRef.current !== projectAtRequest) {
          throw new Error("Storyboard changed before merge; try again");
        }
        const undoEntry = await createHistoryEntry([targetLayer.bitmapPath, sourceLayer.bitmapPath]);
        if (!isPreparedCurrent()) return;
        const completed = beginEffect(p => mergeBitmapLayerDown(p, shotId, sourceLayer.id, targetLayer.id), [shotId]);
        await completed.effect(() => window.storyboard!.mergeLayerDown({
          folderPath,
          sourceBitmapPath: sourceLayer.bitmapPath,
          targetBitmapPath: targetLayer.bitmapPath,
          width: targetLayer.width,
          height: targetLayer.height,
          sourceOpacity: sourceLayer.opacity,
          sourceBlendMode: sourceLayer.blendMode,
          targetOpacity: targetLayer.opacity,
          targetBlendMode: targetLayer.blendMode
        }));
        const handoff = completed();
        if (handoff) { await handoff; return; }
        markShotsDirty([shotId]);
        recordUndoEntry(undoEntry);
        updateProject(
          (currentProject) =>
            mergeBitmapLayerDown(currentProject, shotId, sourceLayer.id, targetLayer.id),
          false,
          false
        );
        setStatus(`Merged "${sourceLayer.name}" down into "${targetLayer.name}"`);
      });
    } catch (error) {
      setStatus(`Merge down failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleMergeBitmapLayers = async (
    shotId: string,
    layerId: string,
    selectedLayerIds: string[]
  ) => {
    if (isImageImportLocked()) return;
    const isPreparedCurrent = capturePreparation();
    const projectAtRequest = projectRef.current;
    const shot = projectAtRequest.shots.find((item) => item.id === shotId);
    const layers = shot ? bitmapLayersForShot(shot) : [];
    const selectedLayers = layers.filter((layer) => selectedLayerIds.includes(layer.id));

    if (selectedLayers.length < 2) {
      await handleMergeBitmapLayerDown(shotId, layerId);
      return;
    }

    if (!window.storyboard || !folderPath || !shot) {
      return;
    }

    if (selectedLayers.some((layer) => layer.locked)) {
      setStatus("Unlock selected layers before merging");
      return;
    }

    if (selectedLayers.some((layer) => !layer.visible)) {
      setStatus("Show selected layers before merging");
      return;
    }

    const targetLayer = selectedLayers[0];
    const sourceLayers = selectedLayers.slice(1);

    try {
      await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
        if (!isPreparedCurrent()) return;
        if (projectRef.current !== projectAtRequest) {
          throw new Error("Storyboard changed before merge; try again");
        }
        const undoEntry = await createHistoryEntry(selectedLayers.map((layer) => layer.bitmapPath));
        if (!isPreparedCurrent()) return;
        const completed = beginEffect(p => mergeSelectedBitmapLayers(p, shotId, selectedLayers.map(l => l.id)), [shotId]);
        await completed.effect(() => window.storyboard!.mergeVisibleLayers({
          folderPath,
          targetBitmapPath: targetLayer.bitmapPath,
          width: targetLayer.width,
          height: targetLayer.height,
          layers: selectedLayers.map((layer) => ({
            bitmapPath: layer.bitmapPath,
            opacity: layer.opacity,
            blendMode: layer.blendMode
          })),
          deleteBitmapPaths: sourceLayers.map((layer) => layer.bitmapPath)
        }));
        const handoff = completed();
        if (handoff) { await handoff; return; }
        markShotsDirty([shotId]);
        recordUndoEntry(undoEntry);
        updateProject(
          (currentProject) =>
            mergeSelectedBitmapLayers(
              currentProject,
              shotId,
              selectedLayers.map((layer) => layer.id)
            ),
          false,
          false
        );
        setStatus(`Merged ${selectedLayers.length} selected layers`);
      });
    } catch (error) {
      setStatus(`Merge failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleMergeVisibleBitmapLayers = async (shotId: string) => {
    const isPreparedCurrent = capturePreparation(false);
    const projectAtRequest = projectRef.current;
    const shot = projectAtRequest.shots.find((item) => item.id === shotId);
    const layers = shot ? bitmapLayersForShot(shot) : [];
    const visibleLayers = layers.filter((layer) => layer.visible);
    const targetLayer = visibleLayers[0];

    if (!window.storyboard || !folderPath || !shot || !targetLayer) {
      return;
    }

    if (visibleLayers.length < 2) {
      setStatus("Need at least two visible layers to merge");
      return;
    }

    const nextProject = mergeVisibleBitmapLayers(projectRef.current, shotId);
    const nextShot = nextProject.shots.find((item) => item.id === shotId);
    const existingLayerIds = new Set(layers.map((layer) => layer.id));
    const mergedLayer = nextShot
      ? bitmapLayersForShot(nextShot).find((layer) => !existingLayerIds.has(layer.id))
      : undefined;

    if (!mergedLayer) {
      setStatus("Could not create merged layer");
      return;
    }

    // Freeze only the merge's physical inputs. Labels/script/project metadata may change
    // during IPC; layer membership/order, compositing/deletion inputs and canvas/source may not.
    const mergeDependencies = (p: Project) => {
      const s = p.shots.find(s => s.id === shotId);
      return s && JSON.stringify({ imagePath: s.imagePath, sourcePath: s.swb?.sourcePath,
        sourceKind: s.swb?.sourceKind, status: s.swb?.status,
        canvasWidth: s.swb?.canvasWidth, canvasHeight: s.swb?.canvasHeight,
        presentation: s.presentation, sketchLayers: s.sketchLayers, imageLayerEdits: s.imageLayerEdits,
        layers: bitmapLayersForShot(s).map(l => ({ id: l.id, bitmapPath: l.bitmapPath, kind: l.kind,
          visible: l.visible, locked: l.locked, opacity: l.opacity, blendMode: l.blendMode,
          width: l.width, height: l.height, order: l.order, cleared: l.cleared })) });
    };
    const dependencies = mergeDependencies(projectAtRequest);
    const applyMerge = (p: Project): Project => ({ ...p, updatedAt: new Date().toISOString(),
      shots: p.shots.map(s => s.id !== shotId ? s : { ...s,
        // Preserve latest safe fields, including retained-layer labels. Reuse the normalized
        // actual target layout and generated id/path; never call mergeVisibleBitmapLayers again.
        layers: nextShot!.layers!.map(l => l.id === mergedLayer.id ? l : {
          ...bitmapLayersForShot(s).find(current => current.id === l.id)!, visible: l.visible, order: l.order }),
        activeLayerId: nextShot!.activeLayerId }) });

    try {
      await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
        if (!isPreparedCurrent()) return;
        if (projectRef.current !== projectAtRequest) {
          throw new Error("Storyboard changed before merge; try again");
        }
        const undoEntry = await createHistoryEntry([
          ...visibleLayers.map((layer) => layer.bitmapPath),
          mergedLayer.bitmapPath
        ]);
        if (!isPreparedCurrent()) return;
        const cleanupScope = getWorkspaceIdentity?.();
        const snapshots = getHistoryLayerAssets?.(undoEntry);
        if (captureEffectCompletion && (!snapshots?.find(s => s.bitmapPath === mergedLayer.bitmapPath && !s.dataUrl) ||
            !visibleLayers.every(l => snapshots.some(s => s.bitmapPath === l.bitmapPath && !!s.dataUrl)))) {
          throw new Error("Merge History asset proof incomplete; no effect performed");
        }
        // This operation created an opaque new layer id before IO. Reuse its actual target
        // metadata, not a second mergeVisibleBitmapLayers call that would invent another id.
        const completed = beginEffect(applyMerge, [shotId]);
        const mergeResult = await completed.effect(() => window.storyboard!.mergeVisibleLayers({
          folderPath,
          targetBitmapPath: mergedLayer.bitmapPath,
          width: mergedLayer.width,
          height: mergedLayer.height,
          layers: visibleLayers.map((layer) => ({
            bitmapPath: layer.bitmapPath,
            opacity: layer.opacity,
            blendMode: layer.blendMode
          })),
          deleteBitmapPaths: visibleLayers
            .filter((layer) => !layer.locked)
            .map((layer) => layer.bitmapPath)
        }));
        if (mergeDependencies(projectRef.current) !== dependencies) {
          // No rollback/publication: prove that only an unreferenced NEW target
          // was created. Original source bytes and latest P2 remain untouched.
          const latest = projectRef.current;
          const snapshots = getHistoryLayerAssets?.(undoEntry);
          const targetBefore = snapshots?.find(s => s.bitmapPath === mergedLayer.bitmapPath);
          const originals = visibleLayers.map(l => snapshots?.find(s => s.bitmapPath === l.bitmapPath));
          const latestShot = latest.shots.find(s => s.id === shotId);
          const sourceScope = (s: typeof shot) => s && JSON.stringify([s.imagePath, s.swb?.sourcePath, s.swb?.sourceKind, s.swb?.status]);
          const baseline = projectAtRequest.pendingBake?.shots[shotId]?.acceptedOutputIdentity;
          const unpublished = ![...latest.shots, ...(latest.parkedShots ?? [])]
            .some(s => s.layers?.some(l => l.bitmapPath === mergedLayer.bitmapPath));
          let intact = false;
          if (completed.isCurrent() && targetBefore && !targetBefore.dataUrl &&
              originals.every(s => !!s?.dataUrl) && latestShot && unpublished &&
              sourceScope(latestShot) === sourceScope(shot) && baseline &&
              latest.pendingBake?.shots[shotId]?.acceptedOutputIdentity === baseline) {
            try {
              const actual = await readLayerAssetSnapshots(window.storyboard!, folderPath, visibleLayers.map(l => l.bitmapPath));
              const rootHash = await window.storyboard!.readOutputIdentity(shot.imagePath);
              intact = projectRef.current === latest && completed.isCurrent() && rootHash === baseline &&
                actual.every((s, index) => s.dataUrl === originals[index]!.dataUrl);
            } catch { /* Unproved/no-read case retains the existing failure gate. */ }
          }
          if (intact) {
            setStatus("Merge visible not applied: source assets verified intact; latest edits retained");
            return; // Do not invent pending or clear any other operation's state.
          }
          const error = new Error("Merge visible inputs changed during pixel effect; recovery required");
          completed.failed(error);
          throw error;
        }
        if (captureEffectCompletion) {
          const originals = mergeResult.sourceIdentities;
          if (!originals || !mergeResult.targetDataUrl || !visibleLayers.every(l =>
              originals.some(s => s.bitmapPath === l.bitmapPath && s.dataUrl === snapshots?.find(a => a.bitmapPath === l.bitmapPath)?.dataUrl))) {
            const error = new Error("Merge source completion identity unproved; inputs retained");
            completed.failed(error); throw error;
          }
          const remaining = originals.filter(s => visibleLayers.some(l => l.bitmapPath === s.bitmapPath && !l.locked));
          await completed.durable({
            published: before => {
              const historyProject = { ...before, shots: before.shots.map(s => s.id !== shotId ? s : {
                ...s, layers: layers.map(l => ({ ...l, name: s.layers?.find(latest => latest.id === l.id)?.name ?? l.name })),
                activeLayerId: shot.activeLayerId }) };
              recordUndoEntry(rebaseAddHistoryEntry ? rebaseAddHistoryEntry(undoEntry, historyProject) : undoEntry);
            },
            afterDurable: async project => {
              if (cleanupScope !== getWorkspaceIdentity?.() || projectRef.current !== project) throw Error("Merge cleanup scope changed; sources retained");
              const result = await window.storyboard!.cleanupMergedLayerSources({ folderPath, project,
                targetBitmapPath: mergedLayer.bitmapPath, targetDataUrl: mergeResult.targetDataUrl!, sources: remaining });
              for (const deleted of result.deleted) {
                const index = remaining.findIndex(s => s.bitmapPath === deleted);
                if (index >= 0) remaining.splice(index, 1);
              }
              if (result.retained.length || result.errors.length || remaining.length) {
                throw Error(`Merge persisted; source cleanup incomplete: ${result.errors.join("; ")}`);
              }
              setStatus("Merged visible layers");
            }
          });
          return;
        }
        const handoff = completed();
        if (handoff) { await handoff; return; }
        markShotsDirty([shotId]);
        recordUndoEntry(undoEntry);
        updateProject(applyMerge, false, false);
        setStatus("Merged visible layers");
      });
    } catch (error) {
      setStatus(`Merge visible failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleAddBitmapLayer = async (shotId: string) => {
    const isPreparedCurrent = capturePreparation(false);
    const ownerCurrent = captureEnsureScope?.();
    await bitmapLayerWriteQueueRef.current.runExclusive(async () => {
      if (!isPreparedCurrent()) return;
      const currentProject = projectRef.current;
      const targetShot = currentProject.shots.find((item) => item.id === shotId);
      const canvasSize = targetShot
        ? canvasSizeForShot(targetShot)
        : sketchCanvasSize;
      const existingLayerIds = new Set(
        targetShot ? bitmapLayersForShot(targetShot).map((layer) => layer.id) : []
      );
      const nextProject = addBitmapLayer(currentProject, shotId, {
        name: "Layer",
        width: canvasSize.width,
        height: canvasSize.height
      });
      const nextShot = nextProject.shots.find((item) => item.id === shotId);
      const addedLayer = nextShot
        ? bitmapLayersForShot(nextShot).find(
            (layer) => !existingLayerIds.has(layer.id)
          )
        : undefined;
      const undoEntry = await createHistoryEntry(
        addedLayer ? [addedLayer.bitmapPath] : []
      );
      if (!isPreparedCurrent()) return;
      if (!window.storyboard?.createLayerPng || !folderPath || !ownerCurrent?.()) return;
      if (!targetShot || !addedLayer) return;
      const snapshots = getHistoryLayerAssets?.(undoEntry);
      if (!snapshots || snapshots.length !== 1 || snapshots[0].bitmapPath !== addedLayer.bitmapPath || snapshots[0].dataUrl !== undefined) {
        setStatus("Add refused: target asset already exists or absence is unproved");
        return;
      }
      const dependency = (p: Project) => {
        const shot = p.shots.find(s => s.id === shotId);
        return JSON.stringify([p.id, shot?.id, shot?.imagePath, shot?.swb, shot?.presentation,
          shot?.baseVisible, shot?.sketchLayers, shot?.imageLayerEdits,
          shot?.layers?.map(({ name: _name, ...layer }) => layer)]);
      };
      const baseline = dependency(currentProject);
      const applyAdd = (p: Project): Project => {
        if (dependency(p) !== baseline || [...p.shots, ...(p.parkedShots ?? [])].some(s => s.layers?.some(l => l.id === addedLayer.id || l.bitmapPath === addedLayer.bitmapPath))) {
          throw new Error("Add target dependencies changed after PNG ACK; new asset retained");
        }
        return addBitmapLayer(p, shotId, { id: addedLayer.id, name: addedLayer.name,
          width: addedLayer.width, height: addedLayer.height });
      };
      const dataUrl = await createTransparentLayerDataUrl(addedLayer.width, addedLayer.height);
      if (!isPreparedCurrent()) return;
      const completion = captureEffectCompletion?.();
      let result;
      try {
        result = await window.storyboard!.createLayerPng({ folderPath, bitmapPath: addedLayer.bitmapPath,
          dataUrl, project: currentProject, shotId, layerId: addedLayer.id, width: addedLayer.width, height: addedLayer.height });
      } catch (error) {
        completion?.failed(error, [shotId]);
        setStatus(`Add ACK unavailable; possible new asset retained: ${addedLayer.bitmapPath}`);
        throw error;
      }
      if (!result.ok) {
        const error = new Error(result.message);
        if (result.effect === "unknown") completion?.failed(error, [shotId]);
        setStatus(`Add ${result.effect === "refused" ? "refused before write" : "failed; possible new asset retained"}: ${result.message}`);
        return;
      }
      if (result.folderPath !== folderPath || result.bitmapPath !== addedLayer.bitmapPath || result.dataUrl !== dataUrl) {
        const error = new Error("Add ACK target mismatch; new asset retained");
        completion?.failed(error, [shotId]);
        throw error;
      }
      try { applyAdd(projectRef.current); }
      catch (error) { completion?.failed(error, [shotId]); throw error; }
      // A queued load cannot install its workspace while this exclusive task owns
      // the queue. Complete/persist the original obligation before releasing it.
      if (!ownerCurrent()) { await completion?.(applyAdd, [shotId]); return; }
      const history = projectRef.current === currentProject ? undoEntry : rebaseAddHistoryEntry?.(undoEntry, projectRef.current);
      if (!history) {
        const error = new Error("Add History rebase unavailable; completed asset retained");
        completion?.failed(error, [shotId]); throw error;
      }
      recordUndoEntry(history);
      markShotsDirty([shotId]);
      updateProject(applyAdd, false, false);
    });
  };

  return {
    handleAddBitmapLayer,
    handleClearBitmapLayer,
    handleMergeBitmapLayerDown,
    handleMergeBitmapLayers,
    handleMergeVisibleBitmapLayers,
    handleRemoveBitmapLayer
  };
};
