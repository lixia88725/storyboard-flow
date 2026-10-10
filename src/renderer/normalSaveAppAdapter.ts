import { serializeStoryboardScriptMarkdown } from "../../electron/main/storyboardScript";
import { decodeNormalSaveImportResult } from "../../electron/shared/normalSaveImportIpc";
import type { FolderScanPayload, Project, SaveWorkspacePayload, Shot, WorkspacePayload } from "../shared/types";
import { applyRenamePlan, createProject, createRenamePlan, mergeExternalImageChanges, mergeFolderImages } from "../shared/projectOps";
import { createNormalSaveProjectOwner, type PendingPublication } from "./normalSaveProjectOwner";
import type { BitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createPendingShotFileController, shotFileIsInVisiblePending } from "./pendingShotFileController";

export type NormalSaveImportWorkspace = { folderPath: string; metadataPath: string; isWorkspaceCurrent: () => boolean };
type ImportPrepare = (project: Project, ids: string[], isCurrent: () => boolean, workspace: NormalSaveImportWorkspace,
  onPreparedAssets?: (ids: readonly string[]) => void) => Promise<Project>;
type Api = {
  createFromStoryboardScript?: Window["storyboard"]["createFromStoryboardScript"];
  ensureLayerAssets?: Window["storyboard"]["ensureLayerAssets"];
  exportPhotoshopTiffs?: Window["storyboard"]["exportPhotoshopTiffs"];
  importSwbFormat?: Window["storyboard"]["importSwbFormat"];
  checkExternalChanges?: Window["storyboard"]["checkExternalChanges"];
  moveShotsToPending?: Window["storyboard"]["moveShotsToPending"];
  restoreShotsFromPending?: Window["storyboard"]["restoreShotsFromPending"];
  saveWorkspace: (payload: SaveWorkspacePayload) => Promise<SaveWorkspacePayload>;
  autosaveWorkspace: (payload: WorkspacePayload) => Promise<unknown>;
  readOutputIdentity: (imagePath: string, legacy?: { project: Project; folderPath: string; shotId: string }) => Promise<string>;
};
export const createNormalSaveAppAdapter = (ports: {
  projectRef: { current: Project };
  setProject: (project: Project) => void;
  queue: Pick<BitmapLayerWriteQueue, "runExclusive">;
  freshToken: () => string;
  api: () => Api;
  paths: () => { folderPath?: string; metadataPath?: string };
  assertAdmission?: () => void;
  assertImportAdmission?: () => void;
  onImportRecoveryRequired?: (message: string, quiet?: boolean) => void;
  onSave: (saved: boolean) => void;
  onAutosave?: () => void;
  onPendingPublication?: (result: PendingPublication) => void;
  onSaveNamespace?: (namespace: NonNullable<PendingPublication["namespace"]>) => void;
  captureSaveStatus?: () => () => void;
  onError: (error: unknown) => void;
}) => {
  const importScan = async (payload: Parameters<Window["storyboard"]["importSwbFormat"]>[0]): Promise<FolderScanPayload> =>
    decodeNormalSaveImportResult<FolderScanPayload>(await ports.api().importSwbFormat!(payload));
  const workspace = (project: Project): SaveWorkspacePayload => {
    ports.assertAdmission?.();
    const { folderPath, metadataPath } = ports.paths();
    if (!folderPath || !metadataPath) throw new Error("No current workspace");
    return { project, folderPath, metadataPath, normalSave: true };
  };
  let legacyLoadFolderPath: string | undefined;
  const owner = createNormalSaveProjectOwner({
    projectRef: ports.projectRef, setProject: ports.setProject, freshToken: ports.freshToken, queue: ports.queue,
    readIdentity: (shot: Shot) => ports.api().readOutputIdentity(shot.imagePath),
    readLegacyIdentity: (project, shot) => legacyLoadFolderPath
      ? ports.api().readOutputIdentity(shot.imagePath, { project, folderPath: legacyLoadFolderPath, shotId: shot.id })
      : Promise.resolve(undefined),
    persist: project => ports.api().autosaveWorkspace(workspace(project)).then(() => undefined),
    captureEffectPersistence: () => {
      ports.assertAdmission?.();
      const { folderPath, metadataPath } = ports.paths(), api = ports.api();
      if (!folderPath || !metadataPath) throw new Error("No effect workspace");
      // Captured BEFORE the first real effect. A queued load may rotate epoch, but cannot
      // adopt another workspace until this exact normal required-persistence call settles.
      return { folderPath, metadataPath, persist: async (project: Project) => {
        ports.assertAdmission?.();
        await api.autosaveWorkspace({ project, folderPath, metadataPath, normalSave: true });
      } };
    },
    outputWhenClean: true,
    onPendingPublication: result => ports.onPendingPublication?.(result),
    onSaveNamespace: namespace => ports.onSaveNamespace?.(namespace),
    output: async (project, ids) => {
      const captured = workspace(project);
      const renamePlan = createRenamePlan(project, { allowDefaultNamingFields: true });
      const result = await ports.api().saveWorkspace({ ...captured, project: applyRenamePlan(project, renamePlan), renamePlan, dirtyShotIds: ids, normalSave: true });
      if (!result.normalSaveOutputs) throw new Error("Save did not acknowledge actual outputs");
      return { outputs: result.normalSaveOutputs, deletions: result.normalSaveDeletions ?? [] };
    }
  });
  const sameEpoch = (c: ReturnType<typeof owner.capture>) => c.epoch === owner.capture().epoch;
  const scopedPrepare = (prepare: ImportPrepare, paths: ReturnType<typeof ports.paths>, c: ReturnType<typeof owner.capture>) =>
    (project: Project, ids: string[], isCurrent: () => boolean, onPreparedAssets?: (ids: readonly string[]) => void) => {
      if (!paths.folderPath || !paths.metadataPath) throw new Error("No Import workspace");
      return prepare(project, ids, isCurrent, { folderPath: paths.folderPath, metadataPath: paths.metadataPath,
        isWorkspaceCurrent: () => sameEpoch(c) && pendingScope(paths).isCurrent() }, onPreparedAssets);
    };
  const pendingScope = (paths: ReturnType<typeof ports.paths>) => ({
    isCurrent: () => {
      const now = ports.paths();
      return now.folderPath === paths.folderPath && now.metadataPath === paths.metadataPath;
    },
    persist: async (project: Project) => {
      ports.assertAdmission?.();
      if (!paths.folderPath || !paths.metadataPath) throw new Error("No current Pending workspace");
      const payload: SaveWorkspacePayload = { project, folderPath: paths.folderPath, metadataPath: paths.metadataPath, normalSave: true };
      await ports.api().autosaveWorkspace(payload);
    }
  });
  const pendingEffects = (kind: "park" | "restore", project: Project, ids: string[], paths = ports.paths()) => {
    ports.assertAdmission?.();
    const api = ports.api();
    if (!api.moveShotsToPending || !api.restoreShotsFromPending) throw new Error("Pending API unavailable");
    const controller = createPendingShotFileController({ api: { moveShotsToPending: api.moveShotsToPending, restoreShotsFromPending: api.restoreShotsFromPending }, folderPath: paths.folderPath, metadataPath: paths.metadataPath });
    return controller.normalSaveEffects(kind, project, ids);
  };
  type ScriptContinuation = { scriptPrepare?: ImportPrepare; scriptPublished?: (scan: FolderScanPayload, durable?: boolean, changedAssetShotIds?: string[]) => void; blankShotPreset: import("../shared/types").BlankShotPreset; dirtyShotIds: string[] };
  const importPersist = (paths: ReturnType<typeof ports.paths>, retainInput = false) => {
    let expected: string | null | undefined, started = false;
    return async (project: Project, input?: string, observedInput?: string | null) => {
      ports.assertImportAdmission?.();
      if (!started) { expected = observedInput === undefined ? input : observedInput; started = true; }
      await ports.api().autosaveWorkspace({ project, folderPath: paths.folderPath!, metadataPath: paths.metadataPath!, normalSave: true,
        normalSaveScriptInput: retainInput ? input : undefined, normalSaveScriptExpectedInput: expected });
      expected = retainInput && input !== undefined ? input : serializeStoryboardScriptMarkdown(project);
    };
  };
  const scriptStage = (options: ScriptContinuation, paths: ReturnType<typeof ports.paths>, c: ReturnType<typeof owner.capture>) => ({
    effect: (project: Project, input: string, plan: NonNullable<FolderScanPayload["normalSaveScriptPlan"]>) => importScan({ project, folderPath: paths.folderPath!, metadataPath: paths.metadataPath!,
      blankShotPreset: options.blankShotPreset, dirtyShotIds: options.dirtyShotIds, normalSave: true, normalSaveScriptInput: input, normalSaveScriptPlan: plan }),
    prepare: options.scriptPrepare ? scopedPrepare(options.scriptPrepare, paths, c) : undefined,
    scope: { isCurrent: pendingScope(paths).isCurrent, published: options.scriptPublished ?? (() => {}),
      recoveryRequired: ports.onImportRecoveryRequired, admit: () => ports.assertImportAdmission?.(),
      persist: importPersist(paths) }
  });
  const deriveAssets = async (kind: "ensure" | "export", payload?: WorkspacePayload) => {
    const paths = ports.paths(), c = owner.capture();
    // Provisional/subset Projects have no owner evidence here: they cannot borrow
    // the active Project's clean state. Their producers need their own admission.
    if (payload && (payload.project !== c.project || payload.folderPath !== paths.folderPath || payload.metadataPath !== paths.metadataPath)) return false;
    const scope = pendingScope(paths);
    const accepted = await owner.derivedAssets(async project => {
      const api = ports.api(), effect = kind === "ensure" ? api.ensureLayerAssets : api.exportPhotoshopTiffs;
      if (!effect) throw new Error("Asset API unavailable");
      await effect(workspace(project));
    }, scope.isCurrent, payload !== undefined, c);
    if (!accepted && owner.lastError && sameEpoch(c) && scope.isCurrent()) ports.onError(owner.lastError);
    return accepted;
  };
  return {
    owner,
    createFromScript: async (options: { sourceMarkdownPath: string; targetFolderPath: string;
      blankShotPreset: import("../shared/types").BlankShotPreset; isCurrent: () => boolean;
      published: (scan: FolderScanPayload, project: Project) => void }) => {
      const c = owner.capture(), paths = ports.paths(), scope = pendingScope(paths);
      const accepted = await owner.createFromScript(async () => {
        const create = ports.api().createFromStoryboardScript;
        if (!create) throw new Error("Create storyboard API unavailable");
        return decodeNormalSaveImportResult<FolderScanPayload>(await create({ sourceMarkdownPath: options.sourceMarkdownPath,
          targetFolderPath: options.targetFolderPath, blankShotPreset: options.blankShotPreset, normalSave: true,
          normalSaveSource: paths.folderPath && paths.metadataPath
            ? { project: c.project, folderPath: paths.folderPath, metadataPath: paths.metadataPath, normalSave: true } : undefined }));
      }, { isCurrent: () => options.isCurrent() && scope.isCurrent(), admit: () => ports.assertImportAdmission?.(),
        published: options.published, recoveryRequired: ports.onImportRecoveryRequired });
      const latest = owner.capture();
      if (!accepted && sameEpoch(c) && options.isCurrent() && scope.isCurrent() &&
        (owner.lastError || latest.sequence === c.sequence && latest.project === c.project)) ports.onError(owner.lastError ?? new Error("New storyboard creation incomplete"));
      return accepted;
    },
    // With a payload: caller already owns its existing asset queue (presentation/Paste).
    // Without one: capture now, queue execution recheck, IO, final verification, release.
    ensureLayerAssets: (payload?: WorkspacePayload) => deriveAssets("ensure", payload),
    exportPhotoshopTiffs: () => deriveAssets("export"),
    imageImport: async (options: { blankShotPreset: import("../shared/types").BlankShotPreset; dirtyShotIds: string[];
      prepare: ImportPrepare; scriptPrepare?: ImportPrepare; scriptPublished?: (scan: FolderScanPayload, durable?: boolean, changedAssetShotIds?: string[]) => void; published: (scan: FolderScanPayload, durable?: boolean) => void }) => {
      const paths = ports.paths(), c = owner.capture(), scope = pendingScope(paths);
      const accepted = await owner.imageImport(async project => {
        return importScan({ project, folderPath: paths.folderPath!, metadataPath: paths.metadataPath!,
          blankShotPreset: options.blankShotPreset, dirtyShotIds: [...new Set([...options.dirtyShotIds, ...Object.entries(project.pendingBake?.shots ?? {}).filter(([, e]) => e.state === "pending").map(([id]) => id)])], normalSave: true, normalSaveImageImport: true });
      }, scopedPrepare(options.prepare, paths, c), { isCurrent: scope.isCurrent, published: options.published, recoveryRequired: ports.onImportRecoveryRequired, script: scriptStage(options, paths, c),
        admit: () => { ports.assertImportAdmission?.(); if (!ports.api().importSwbFormat) throw new Error("Image Import API unavailable"); }, persist: importPersist(paths, true) });
      if (!accepted && sameEpoch(c) && scope.isCurrent()) ports.onError(owner.lastError ?? new Error("Image Import incomplete"));
      return accepted;
    },
    // Script text Import (storyboard-script.md → active shots). Same single ordering domain as
    // Import: capture now, execution recheck, real main read/parse/merge, latest-Project merge,
    // required JSON/MD persistence, publication, release. It never borrows manual-image
    // permission and never invents a raster token for an existing shot's text/order edit.
    scriptImport: async (options: { blankShotPreset: import("../shared/types").BlankShotPreset; dirtyShotIds: string[];
      prepare: ImportPrepare; published: (scan: FolderScanPayload, durable?: boolean, changedAssetShotIds?: string[]) => void }) => {
      const paths = ports.paths(), c = owner.capture(), scope = pendingScope(paths);
      const accepted = await owner.scriptImport(async (project, input, plan) => {
        if (!paths.folderPath || !paths.metadataPath) throw new Error("No Script Import workspace");
        return importScan({ project, folderPath: paths.folderPath, metadataPath: paths.metadataPath,
          blankShotPreset: options.blankShotPreset, dirtyShotIds: options.dirtyShotIds, normalSave: true, normalSaveScriptInput: input, normalSaveScriptPlan: plan });
      }, scopedPrepare(options.prepare, paths, c), { isCurrent: scope.isCurrent, published: options.published,
        admit: () => { ports.assertImportAdmission?.(); if (!ports.api().importSwbFormat) throw new Error("Script Import API unavailable"); },
        recoveryRequired: ports.onImportRecoveryRequired,
        persist: importPersist(paths) });
      if (!accepted && owner.lastError && sameEpoch(c) && scope.isCurrent()) ports.onError(owner.lastError);
      return accepted;
    },
    externalRefresh: async (options: { check: (project: Project) => Promise<Project>; isCurrent?: () => boolean; blankShotPreset: import("../shared/types").BlankShotPreset; dirtyShotIds: string[];
      prepare: ImportPrepare; scriptPrepare?: ImportPrepare; scriptPublished?: (scan: FolderScanPayload, durable?: boolean, changedAssetShotIds?: string[]) => void; published: (scan: FolderScanPayload, durable?: boolean) => void }) => {
      const paths = ports.paths(), c = owner.capture(), scope = pendingScope(paths);
      const pathScope = scope.isCurrent;
      let readerAccepted = false;
      scope.isCurrent = () => pathScope() && (readerAccepted || (options.isCurrent?.() ?? true));
      let started = false;
      const accepted = await owner.externalRefresh(async project => {
        started = true;
        const result = await options.check(project);
        // Watcher generations cancel pre-effect scans, not an admitted Import's ACK.
        readerAccepted = options.isCurrent?.() ?? true;
        return result;
      }, project => importScan({
        project, folderPath: paths.folderPath!, metadataPath: paths.metadataPath!, blankShotPreset: options.blankShotPreset,
        dirtyShotIds: options.dirtyShotIds, normalSave: true, normalSaveAutoImageImport: true
      }), scopedPrepare(options.prepare, paths, c), { ...scope, dirtyShotIds: options.dirtyShotIds, published: options.published,
        recoveryRequired: ports.onImportRecoveryRequired, script: scriptStage(options, paths, c), admit: () => { ports.assertImportAdmission?.(); if (!ports.api().importSwbFormat) throw new Error("Image Import API unavailable"); },
        persist: importPersist(paths, true) });
      if (!accepted && started && owner.lastError && sameEpoch(c) && scope.isCurrent()) ports.onError(owner.lastError);
      return accepted;
    },
    pending: async (kind: "park" | "restore", update: (p: Project) => Project, ids: string[]) => {
      const paths = ports.paths(), c = owner.capture();
      const accepted = await owner.pending(update, ids, kind === "park", (project, ids) => {
        const now = ports.paths();
        if (now.folderPath !== paths.folderPath || now.metadataPath !== paths.metadataPath) throw new Error("Pending workspace changed");
        return pendingEffects(kind, project, ids, paths);
      }, pendingScope(paths));
      if (!accepted && sameEpoch(c) && pendingScope(paths).isCurrent()) {
        ports.onError(owner.lastError ?? new Error("Pending incomplete; newer edits or unknown output remain"));
      }
      return accepted;
    },
    save: async () => {
      const c = owner.capture();
      const finishStatus = ports.captureSaveStatus?.();
      const saved = await owner.save();
      if (sameEpoch(c)) {
        if (owner.lastError) ports.onError(owner.lastError);
        else {
          if (saved) finishStatus?.();
          ports.onSave(saved);
        }
      }
      return saved;
    },
    autosave: async (project: Project) => {
      const c = owner.capture();
      if (c.project !== project) return false;
      try {
        const saved = await owner.autosave();
        const latest = owner.capture();
        if (saved && sameEpoch(c) && c.sequence === latest.sequence && c.project === latest.project) ports.onAutosave?.();
        return saved;
      }
      catch (error) {
        const latest = owner.capture();
        if (sameEpoch(c) && c.sequence === latest.sequence && c.project === latest.project) ports.onError(error);
        return false;
      }
    },
    load: async (reader: () => Promise<FolderScanPayload>, publishScan: (scan: FolderScanPayload, project: Project) => void,
      autoImport?: { blankShotPreset: import("../shared/types").BlankShotPreset; dirtyShotIds: string[]; prepare: ImportPrepare; scriptPrepare?: ImportPrepare; scriptPublished?: (scan: FolderScanPayload, durable?: boolean, changedAssetShotIds?: string[]) => void; published: (scan: FolderScanPayload, durable?: boolean) => void },
      onSettled?: (info: { epoch: object; completed: boolean; project: Project }) => void) => {
      let scan: FolderScanPayload | undefined;
      // Request epoch happens now; disk reading happens only at queue execution.
      const loading = owner.load(async () => {
        scan = await reader();
        if (scan.normalSaveOpenRecoveryRequired) throw new Error(scan.normalSaveOpenRecoveryRequired);
        if (!sameEpoch(request)) return createProject(scan.folderName);
        legacyLoadFolderPath = scan.folderPath;
        let project = scan.project ?? createProject(scan.folderName);
        if (!scan.preserveProjectWithoutImageMerge && (!scan.project || scan.images.length > 0)) project = mergeFolderImages(project, scan.images);
        if (autoImport && scan.project && ports.api().checkExternalChanges) {
          const checked = await ports.api().checkExternalChanges!({ project, folderPath: scan.folderPath, metadataPath: scan.metadataPath, normalSave: true });
          project = mergeExternalImageChanges(project, checked.images);
          scan = { ...scan, scriptImportNeeded: checked.scriptImportNeeded };
        }
        return project;
      }, project => publishScan(scan!, project), {
        ids: project => (project.parkedShots ?? []).filter(shot => !shotFileIsInVisiblePending(scan!.folderPath, shot.imagePath)).map(shot => shot.id),
        effect: (project, ids) => pendingEffects("park", project, ids, { folderPath: scan!.folderPath, metadataPath: scan!.metadataPath }),
        scope: { isCurrent: () => pendingScope(scan!).isCurrent(), persist: project => pendingScope(scan!).persist(project) }
      }, autoImport ? () => [project => importScan({ project, folderPath: scan!.folderPath, metadataPath: scan!.metadataPath,
        blankShotPreset: autoImport.blankShotPreset, dirtyShotIds: autoImport.dirtyShotIds, normalSave: true, normalSaveAutoImageImport: true }),
        scopedPrepare(autoImport.prepare, scan!, request), { isCurrent: () => pendingScope(scan!).isCurrent(), automatic: true, dirtyShotIds: autoImport.dirtyShotIds, published: autoImport.published,
          recoveryRequired: ports.onImportRecoveryRequired, script: scriptStage(autoImport, scan!, request), admit: () => ports.assertImportAdmission?.(),
          persist: importPersist(scan!, true) }] : undefined, onSettled);
      const request = owner.capture();
      try {
        const loaded = await loading;
        if (!loaded && sameEpoch(request)) ports.onError(owner.lastError ?? new Error("Load incomplete; Pending migration was not accepted"));
        return loaded;
      }
      catch (error) { if (sameEpoch(request)) ports.onError(error); return false; }
    }
  };
};
