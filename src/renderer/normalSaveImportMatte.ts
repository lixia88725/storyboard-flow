import type { Project } from "../shared/types";
import type { BitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createShotPresentationController } from "./shotPresentationController";
import { readLayerAssetSnapshots } from "./bitmapLayerHistory";

// Import targets are existing committed assets, not provisional Add assets. Keep
// the existing presentation recovery subscriber and distinguish ownership from P2.
export const prepareImportedImageMatte = async (
  project: Project, mode: "expanded" | "embedded", ids: readonly string[],
  request: {
    folderPath: string; metadataPath: string; isCurrent: () => boolean;
    isWorkspaceCurrent: () => boolean; dialogueOverlayEnabled: boolean;
    setStatus: (message: string) => void; onRecoveryRequired: (message: string) => void;
    onPreparedAssets?: (ids: readonly string[]) => void;
  },
  dependencies: {
    api: Window["storyboard"]; queue: BitmapLayerWriteQueue;
    canvas?: Pick<Parameters<typeof createShotPresentationController>[0], "expandBitmapLayer" | "createMatteOverlay" | "createDialogueOverlay">;
  }
): Promise<Project> => {
  const local = { current: { ...project, shots: project.shots.filter(s => ids.includes(s.id)) } };
  let recoveryFailure: string | undefined;
  const scopedApi = {
    ...dependencies.api,
    ensureLayerAssets: async (payload: Parameters<Window["storyboard"]["ensureLayerAssets"]>[0]) => {
      if (!request.isCurrent()) throw new Error("Import preparation changed before ensure");
      const result = await dependencies.api.ensureLayerAssets({ ...payload, normalSave: true });
      if (!request.isCurrent()) throw new Error("Import preparation changed during ensure");
      return result;
    }
  };
  const controller = createShotPresentationController({
    ...dependencies.canvas, api: scopedApi,
    bitmapLayerWriteQueueRef: { current: dependencies.queue },
    folderPath: request.folderPath, metadataPath: request.metadataPath, projectRef: local,
    shotPresentationActionRef: { current: undefined },
    createHistoryEntry: async (paths = []) => ({ project: local.current,
      fileNameSyncState: "unsynced", selectedShotIds: [],
      layerAssets: await readLayerAssetSnapshots(dependencies.api, request.folderPath, paths) }),
    markShotsDirty: () => {}, recordUndoEntry: () => {},
    onRecoveryRequired: message => { recoveryFailure = message; if (request.isWorkspaceCurrent()) request.onRecoveryRequired(message); },
    setStatus: message => { if (request.isCurrent()) request.setStatus(message); },
    updateProject: update => { local.current = typeof update === "function" ? update(local.current) : update; }
  });
  const assetKey = (shot: Project["shots"][number]) => JSON.stringify([shot.layers,
    shot.sketchLayers, shot.imageLayerEdits, shot.presentation, shot.swb, shot.baseVisible]);
  // Report the shots whose asset bytes the prepare actually rewrote BEFORE the isCurrent check, so
  // the owner records a real effect across the owner-after-prepare boundary even when a late scene
  // edit makes the derive non-current and this function then throws.
  const inherited = await controller.handleInheritSceneMatte(local.current, mode, ids, {
    isCurrent: request.isCurrent, isWorkspaceCurrent: request.isWorkspaceCurrent,
    dialogueOverlayEnabled: request.dialogueOverlayEnabled
  });
  const afterById = new Map(local.current.shots.map(s => [s.id, s]));
  const changedIds = project.shots
    .filter(s => { const after = afterById.get(s.id); return after ? assetKey(s) !== assetKey(after) : false; })
    .map(s => s.id);
  if (changedIds.length) request.onPreparedAssets?.(changedIds);
  if (!inherited || !request.isCurrent()) throw new Error(recoveryFailure ?? "Import matte preparation incomplete");
  const byId = afterById;
  return { ...project, shots: project.shots.map(s => byId.get(s.id) ?? s) };
};
