import type { Project, Shot, FolderScanPayload } from "../shared/types";
import { automaticImageImportAdmission, manualImageImportAdmission } from "../../electron/shared/manualImageImportRules";
import { importRecoveryIncompleteCode } from "../../electron/shared/normalSaveImportIpc";
import { acknowledgeBake, classifyPendingBake, initializeCompletedShot, pendingBakeForProject, type NormalSaveOutputAck } from "../shared/pendingBake";
import { publishWorkspaceProject } from "./workspaceLifecycleState";
import type { BitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { HistoryAssetRestoreFailure, type HistoryAssetFact } from "./bitmapLayerHistory";
import { createAssetIntentAdmission, type RetainedAssetIntent, type AssetOperationLease } from "./assetIntentAdmission";
import type { NormalSaveCompletion, NormalSaveDeletionAck } from "../../electron/normalSaveTransport";
export type { NormalSaveOutputAck } from "../shared/pendingBake";
export type PendingPublication = { durable: boolean; namespace?: { before: Project; after: Project; ids: string[]; update: (project: Project) => Project } };
export type DurableEffectHooks = {
  published: (before: Project, after: Project) => void;
  afterDurable: (project: Project) => Promise<void>;
};
export type CompletedEffect = ((update: Project | ((project: Project) => Project), shotIds: readonly string[], hooks?: DurableEffectHooks) => Promise<void>) & {
  // An effect was attempted but has no complete ACK. Same-process barrier, not durable pending.
  // Available only on a captured real effect; refuses until original History
  // and bound persistence/ACK finish, then exits this exact admitted intent once.
  exitWithoutPublication?: () => never;
  failed: (error: unknown, shotIds: readonly string[]) => void;
  // Complete only the original Root's required persistence after exact PNG
  // compensation. Does not publish Project, alter History, certify output,
  // retire another effect's pins or convert the failed user action to success.
  compensated?: (failure: HistoryAssetRestoreFailure) => Promise<void>;
  retainDesiredPng?: (target: { folderPath: string; bitmapPath: string; shotId: string; layerId: string; dataUrl: string }) => void;
  prepareSinglePng?: (target: { folderPath: string; bitmapPath: string; shotId: string; layerId: string;
    dataUrl: string; read: () => Promise<string | undefined>; update: (project: Project) => Project }) => void;
};
export type NormalSaveOwnerPorts = {
  projectRef: { current: Project };
  setProject: (project: Project) => void;
  freshToken: () => string;
  queue: Pick<BitmapLayerWriteQueue, "runExclusive" | "isBusy">;
  readIdentity: (shot: Shot) => Promise<string>;
  persist: (project: Project, required?: boolean) => Promise<void>;
  captureEffectPersistence?: () => { folderPath: string; metadataPath: string; persist: (project: Project) => Promise<void> };
  output: (project: Project, shotIds: string[]) => Promise<NormalSaveOutputAck[] | NormalSaveCompletion>;
  outputWhenClean?: boolean;
  onPendingPublication?: (result: PendingPublication) => void;
  onSaveNamespace?: (namespace: NonNullable<PendingPublication["namespace"]>) => void;
};

/** Main transports a recovery-incomplete Import as a RETURNED serializable envelope that the
 * renderer consumer decodes locally after contextBridge into a business `code` error. The owner matches
 * on that decoded code (never on a thrown error's `name`, which the IPC boundary does not
 * preserve). The in-process property is kept only for direct (non-IPC) callers. */
const importRecoveryIncomplete = (error: unknown): boolean => {
  if (!error || typeof error !== "object") return false;
  const typed = error as { code?: unknown; recoveryIncomplete?: unknown };
  return typed.code === importRecoveryIncompleteCode || typed.recoveryIncomplete === true;
};

/** App remains the sole owner: this module operates on its ref and synchronous state publication port.
 * Not enabled in App until every producer and effect admission is adapted. No IPC or new queue. */
export const createNormalSaveProjectOwner = (ports: NormalSaveOwnerPorts) => {
  let executingIntent: RetainedAssetIntent | undefined;
  const completionSignals = new WeakMap<object, RetainedAssetIntent>();
  const assetAdmission = createAssetIntentAdmission((signal, executing) => {
    if (!signal || typeof signal !== 'object' || completionSignals.get(signal) !== executing) return false;
    completionSignals.delete(signal);
    return true;
  });
  let heldSaveAdmission: AssetOperationLease | undefined;
  let saveAdmissionActive = false;
  const submitAssetIntent = <T,>(intent: RetainedAssetIntent, run: () => Promise<T>) => assetAdmission.submit(intent, async executing => {
    // Admission serializes producers through their complete required ACK.
    executingIntent = executing;
    try { return await run(); }
    finally { executingIntent = undefined; }
  });
  let epoch: object = {};
  let sequence = 0;
  let loading = false;
  // Receipt is intentionally process-local; never used to certify a reopened project.
  let receipt: { epoch: object; acks: NormalSaveOutputAck[]; deletions?: NormalSaveDeletionAck[] } | undefined;
  let lastError: unknown;
  // Immutable desired versions survive writer rejection and UI finally cleanup. These are
  // content pins only, never a permission certificate or cold replay capability.
  const desiredAssets: { folderPath: string; bitmapPath: string; shotId: string; layerId: string; dataUrl: string; version: number }[] = [];
  let assetRevision = 0;
  // A load request invalidates queued work immediately, but does not replace the workspace whose
  // admitted effect still owns the queue. Installation happens only after that effect settles.
  let installedWorkspace: object = epoch;
  // At most one completion can await required persistence in the existing exclusive queue.
  // This is not durable until its bound JSON/MD writer ACKs; a new reader cannot pass it.
  let unsettledEffect: { persist: () => Promise<void>; recover?: () => Promise<void>; failure?: unknown;
    historyRestore?: { folderPath: string; project: Project; assets: HistoryAssetFact[]; error: string } } | undefined;
  const capture = () => ({ epoch, sequence, project: ports.projectRef.current });
  type Capture = ReturnType<typeof capture>;
  // Private evidence of an actual owner-observed metadata Delete, not a history
  // envelope or caller-supplied permission. This never certifies output.
  const deletedSources = new Map<string, { epoch: object; projectId: string; shot: Shot;
    inputs: string; entry: string }>();
  const deletedEntryIdentity = (p: Project, id: string) => {
    const entry = p.pendingBake?.shots[id];
    return JSON.stringify([entry?.state, entry?.acceptedOutputIdentity, entry?.editToken]);
  };
  const deletedShotInputs = (s: Shot) => JSON.stringify([s.id, s.imagePath, s.fileName,
    s.swb, s.layers, s.sketchLayers, s.imageLayerEdits, s.baseVisible, s.presentation,
    s.activeLayerId, s.activeLayerTarget]);
  const scriptDependency = (p: Project) => JSON.stringify({ dialogues: p.dialogues,
    shots: p.shots.map(s => [s.id, s.scriptText, s.order, s.presentation,
      s.layers, s.sketchLayers, s.imageLayerEdits, s.baseVisible, s.activeLayerId, s.activeLayerTarget,
      s.swb?.canvasWidth, s.swb?.canvasHeight, s.swb?.version, s.swb?.status,
      s.swb?.sourceKind, s.swb?.sourcePath, s.swb?.baseFingerprint]) });
  // Keeps a completed image stage from being repeated or its still-unconsumed input erased.
  type ScriptPlan = NonNullable<FolderScanPayload["normalSaveScriptPlan"]>;
  let remainingScript: { epoch: object; input: string; plan: ScriptPlan; dependency: string; imageCompleted: boolean } | undefined;
  let scriptCompletion = 0;
  const current = (c: Capture) => c.epoch === epoch && c.sequence === sequence && c.project === ports.projectRef.current;
  // Process-local deletion lifecycles: identical bytes/IDs recreated after an Undo
  // are not the operation that was captured before output began.
  const deletionLifecycles = new Map<string, { identity: string; marker: object }>();
  const deletionIdentity = (p: Project, id: string): string | undefined => {
    const records = p.pendingDeletedShots?.filter(s => s.id === id) ?? [];
    if (records.length !== 1 || [...p.shots, ...(p.parkedShots ?? [])].some(s => s.id === id)) return undefined;
    return JSON.stringify([p.id, records[0], p.pendingBake?.shots[id]]);
  };
  const syncDeletionLifecycles = (p: Project) => {
    for (const id of deletionLifecycles.keys()) if (deletionIdentity(p, id) !== deletionLifecycles.get(id)!.identity) deletionLifecycles.delete(id);
    for (const record of p.pendingDeletedShots ?? []) {
      const identity = deletionIdentity(p, record.id);
      if (identity !== undefined && !deletionLifecycles.has(record.id)) deletionLifecycles.set(record.id, { identity, marker: {} });
    }
  };
  const publish = (p: Project) => {
    sequence++;
    syncDeletionLifecycles(p);
    for (const [id, source] of deletedSources) {
      if (source.epoch !== epoch || source.projectId !== p.id ||
          !p.pendingDeletedShots?.some(s => s.id === id && s.imagePath === source.shot.imagePath) ||
          [...p.shots, ...(p.parkedShots ?? [])].some(s => s.id === id) ||
          deletedEntryIdentity(p, id) !== source.entry) deletedSources.delete(id);
    }
    publishWorkspaceProject(ports.projectRef, ports.setProject, p);
  };
  const preserveRaw = (p: Project) => ["unsupported", "corrupt"].includes(classifyPendingBake(p));
  const supported = (p: Project) => !unsettledEffect && !preserveRaw(p) && Object.values(pendingBakeForProject(p).shots).every(s => s.state !== "unknown");
  const complete = (p: Project) => !(p.pendingDeletedShots?.length) && Object.values(pendingBakeForProject(p).shots).every(s => s.state === "synced");

  // Live control state, re-evaluated on every call. An admission captured before queueing must
  // not survive a later load, held receipt, unconsumed script input, or raw/unknown output state.
  // Same-epoch metadata P2 and continuous strokes stay allowed: neither epoch nor sequence is
  // pinned here.
  const captureEffectAdmission = () => {
    const capturedEpoch = epoch;
    return () => capturedEpoch === epoch && !loading && !receipt && !remainingScript &&
      !unsettledEffect && supported(ports.projectRef.current);
  };
  const settleEffectCompletion = async () => {
    const fact = unsettledEffect;
    if (!fact) return;
    await fact.persist();
    if (unsettledEffect === fact) {
      unsettledEffect = undefined;
      // Only the actual failed effect's successful original persistence ACK
      // consumes its associated intent. Other failures remain protected.
      if (fact.failure !== undefined) assetAdmission.completeFailedIntent(fact.failure);
    }
  };
  // Capture while this operation is admitted, BEFORE its real first effect. Caller invokes the
  // completion only after the full effect succeeds, supplying its actual metadata transformation.
  // Relative paths alone are not facts; history envelopes are never completion authority.
  const captureEffectCompletion = (): CompletedEffect => {
    if (!captureEffectAdmission()()) throw new Error("Effect completion capture refused: workspace not ready");
    const source = ports.projectRef.current, instance = installedWorkspace, effectEpoch = epoch;
    const originalIntent = executingIntent;
    let completedWithHistory = false, exitUsed = false;
    const binding = ports.captureEffectPersistence?.();
    if (!binding) throw new Error("Effect completion persistence binding unavailable");
    let used = false;
    let desiredPin: (typeof desiredAssets)[number] | undefined;
    let single: (Parameters<NonNullable<CompletedEffect["prepareSinglePng"]>>[0] & {
      dependency: string; baseline: ReturnType<typeof pendingBakeForProject>["shots"][string]; root: Shot;
    }) | undefined;
    const dependency = (p: Project, id: string) => {
      const s = p.shots.find(s => s.id === id);
      return s && JSON.stringify([s.id, s.imagePath, s.swb, s.presentation, s.baseVisible,
        s.imageLayerEdits, s.sketchLayers, s.layers?.map(({ name: _name, ...layer }) => layer)]);
    };
    const block = (error: unknown, shotIds: readonly string[]) => {
      const previousFailure = unsettledEffect;
      const fact: NonNullable<typeof unsettledEffect> = { failure: error, persist: async () => { throw error; } };
      if (error instanceof HistoryAssetRestoreFailure) {
        // Keep original/desired/actual bytes and failed ACKs separately. These
        // content pins are not executable recovery or permission evidence.
        fact.historyRestore = { folderPath: binding.folderPath, project: structuredClone(source),
          assets: structuredClone(error.assets), error: error.message };
      }
      if (!previousFailure) unsettledEffect = fact;
      lastError = error;
      if (instance === installedWorkspace && ports.projectRef.current.id === source.id) {
        const latest = ports.projectRef.current, envelope = pendingBakeForProject(latest);
        for (const id of shotIds) if (envelope.shots[id]) {
          const { editToken: _token, ...entry } = envelope.shots[id];
          envelope.shots[id] = { ...entry, state: "unknown" };
        }
        publish({ ...latest, pendingBake: envelope });
      }
      const target = single;
      if (!previousFailure && target && shotIds.length === 1 && shotIds[0] === target.shotId) {
        const failedEntry = JSON.stringify(pendingBakeForProject(ports.projectRef.current).shots[target.shotId]);
        fact.recover = async () => {
          const latest = ports.projectRef.current;
          const entry = target.baseline;
          const eligible = () => unsettledEffect === fact && instance === installedWorkspace && effectEpoch === epoch &&
            !loading && !receipt && !remainingScript && !preserveRaw(ports.projectRef.current) &&
            target.dependency === dependency(ports.projectRef.current, target.shotId) &&
            JSON.stringify(pendingBakeForProject(ports.projectRef.current).shots[target.shotId]) === failedEntry &&
            Object.entries(pendingBakeForProject(ports.projectRef.current).shots).every(([id, s]) => id === target.shotId || s.state !== "unknown");
          if (!eligible() || !entry?.acceptedOutputIdentity) throw error;
          const actual = await target.read();
          const rootHash = await ports.readIdentity(target.root);
          if (actual !== target.dataUrl || rootHash !== entry.acceptedOutputIdentity ||
              !eligible() || ports.projectRef.current !== latest) throw error;
          const envelope = pendingBakeForProject(latest);
          envelope.shots[target.shotId] = { ...entry, state: "pending", editToken: ports.freshToken() };
          const project = { ...target.update(latest), pendingBake: envelope };
          // This exact effect is now proved complete. Required persistence can retry, but
          // neither proof nor any subsequent retry writes the PNG or certifies TIFF output.
          fact.recover = undefined;
          fact.persist = () => binding.persist(project);
          publish(project);
          await settleEffectCompletion();
        };
      }
    };
    const complete: CompletedEffect = Object.assign(async (update: Project | ((project: Project) => Project), shotIds: readonly string[], hooks?: DurableEffectHooks) => {
      if (used || unsettledEffect) throw new Error("Effect completion already recorded");
      used = true;
      const latest = ports.projectRef.current;
      const refuse = (message: string) => {
        const error = new Error(message);
        block(error, shotIds);
        throw error;
      };
      if (instance !== installedWorkspace || !supported(latest) || !shotIds.length ||
          shotIds.some(id => !samePendingSource(source, latest, id) ||
            pendingBakeForProject(source).shots[id]?.acceptedOutputIdentity !== pendingBakeForProject(latest).shots[id]?.acceptedOutputIdentity)) {
        return refuse("Completed effect source changed; recovery required, no output certification");
      }
      const next = typeof update === "function" ? update(latest) : update;
      if (shotIds.some(id => !samePendingSource(latest, next, id))) {
        return refuse("Completed effect target source changed; recovery required, assets retained");
      }
      const envelope = pendingBakeForProject(latest);
      for (const id of new Set(shotIds)) {
        const entry = envelope.shots[id];
        if (!entry || entry.state === "unknown") return refuse("Completed effect baseline unknown");
        envelope.shots[id] = { ...entry, state: "pending", editToken: ports.freshToken() };
      }
      const project = { ...next, pendingBake: envelope };
      let durable = false;
      let historyPublished = !hooks;
      const fact = { persist: async () => {
        if (!historyPublished) throw new Error('Completed effect original history publication incomplete');
        if (!durable) { await binding.persist(project); durable = true; }
        if (hooks) {
          // A queued load already invalidated this request. Its original effect
          // is durable, but cleanup must not run across the workspace handoff.
          // Retain orphan inputs rather than block the new reader forever.
          if (effectEpoch !== epoch) return;
          if (instance !== installedWorkspace || ports.projectRef.current !== project) {
            throw new Error("Durable effect cleanup scope changed; source assets retained");
          }
          await hooks.afterDurable(project);
        }
        // Retire only this operation's immutable desired version after the
        // bound ACK and its original history/cleanup, never a newer paint pin.
        if (desiredPin) {
          const index = desiredAssets.indexOf(desiredPin);
          if (index >= 0) desiredAssets.splice(index, 1);
        }
      } };
      unsettledEffect = fact;
      // Still original installed A: new epoch is a queued request, NOT permission to publish to B.
      publish(project);
      try { hooks?.published(latest, project); historyPublished = true; }
      catch (error) { lastError = error; throw error; }
      try { await settleEffectCompletion(); } catch (error) { lastError = error; throw error; }
      completedWithHistory = !!hooks && historyPublished && durable && !unsettledEffect;
    }, { exitWithoutPublication: (): never => {
      if (exitUsed || !completedWithHistory || !originalIntent || executingIntent !== originalIntent ||
          originalIntent.workspace !== binding.folderPath || !desiredPin ||
          originalIntent.assetId !== desiredPin.bitmapPath || desiredAssets.includes(desiredPin) ||
          instance !== installedWorkspace || effectEpoch !== epoch || unsettledEffect) {
        throw new Error('Painting workspace changed; PNG retained without stale publication: Exact intent completion authority unavailable');
      }
      exitUsed = true;
      const signal = new Error('Original exact intent completed without stale publication');
      completionSignals.set(signal, originalIntent);
      throw signal;
    }, prepareSinglePng: (target: Parameters<NonNullable<CompletedEffect["prepareSinglePng"]>>[0]) => {
      const shot = source.shots.find(s => s.id === target.shotId);
      const layer = shot?.layers?.find(l => l.id === target.layerId && l.bitmapPath === target.bitmapPath);
      if (used || single || target.folderPath !== binding.folderPath || !layer ||
          !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(target.dataUrl)) return;
      // Real producer bytes, frozen before write. Check the PNG's declared size and complete
      // end marker; actual bytes must later match this entire immutable target exactly.
      try {
        const bytes = atob(target.dataUrl.slice("data:image/png;base64,".length));
        const size = (offset: number) => ((bytes.charCodeAt(offset) * 0x1000000) +
          (bytes.charCodeAt(offset + 1) << 16) + (bytes.charCodeAt(offset + 2) << 8) + bytes.charCodeAt(offset + 3));
        if (!bytes.startsWith("\x89PNG\r\n\x1a\n") || bytes.slice(12, 16) !== "IHDR" ||
            size(16) !== layer.width || size(20) !== layer.height ||
            bytes.slice(-12) !== "\x00\x00\x00\x00IEND\xaeB\x60\x82") return;
        const baseline = pendingBakeForProject(source).shots[target.shotId];
        if (!baseline || baseline.state === "unknown" || !baseline.acceptedOutputIdentity) return;
        single = { ...target, dependency: dependency(source, target.shotId)!,
          baseline: { ...baseline }, root: { ...shot! } };
      } catch { /* Missing/unproved expected bytes keep ordinary failure protection. */ }
    }, retainDesiredPng: (target: { folderPath: string; bitmapPath: string; shotId: string; layerId: string; dataUrl: string }) => {
      if (used || target.folderPath !== binding.folderPath || !source.shots.some(s => s.id === target.shotId &&
          s.layers?.some(l => l.id === target.layerId && l.bitmapPath === target.bitmapPath))) throw new Error("Desired PNG source binding changed");
      desiredPin = { ...target, version: ++assetRevision };
      desiredAssets.push(desiredPin);
    }, compensated: async (failure: HistoryAssetRestoreFailure) => {
      if (used || unsettledEffect || failure.folderPath !== binding.folderPath || !failure.compensated) {
        throw new Error('History compensation original completion unavailable');
      }
      used = true;
      if (!failure.assets.some(a => a.started)) return;
      const latest = ports.projectRef.current;
      // Real slots keep an original Root ref. A replaced/foreign ref is not
      // allowed to redirect its captured persistence binding to B or alias-A.
      const originalCurrent = instance === installedWorkspace && latest.id === source.id &&
        source.shots.every(s => samePendingSource(source, latest, s.id));
      const project = originalCurrent ? latest : source;
      unsettledEffect = { persist: () => binding.persist(project),
        historyRestore: { folderPath: binding.folderPath, project: structuredClone(source),
          assets: structuredClone(failure.assets), error: failure.message } };
      try { await settleEffectCompletion(); }
      catch (error) {
        const incomplete = new Error(`${failure.message}; original required persistence failed: ${error instanceof Error ? error.message : String(error)}`);
        lastError = incomplete;
        throw incomplete;
      }
    }, failed: (error: unknown, shotIds: readonly string[]) => {
      if (used) return; // exact successful completion remains retryable after required persist failure
      used = true;
      block(error, shotIds);
    } });
    return complete;
  };

  const publishEditWithSources = (update: Project | ((p: Project) => Project), shotIds: string[],
    restoredSources?: ReadonlyMap<string, Shot>) => {
    if (loading || unsettledEffect) return false;
    const previous = ports.projectRef.current;
    const next = typeof update === "function" ? update(previous) : update;
    if ([...next.shots, ...(next.parkedShots ?? [])].some(shot =>
      ![...previous.shots, ...(previous.parkedShots ?? [])].some(s => s.id === shot.id) &&
      previous.pendingDeletedShots?.some(s => s.id === shot.id) && !restoredSources?.has(shot.id))) return false;
    if (preserveRaw(previous)) {
      publish({ ...next, pendingBake: previous.pendingBake });
      return true;
    }
    const envelope = pendingBakeForProject(previous);
    const nextShots = [...next.shots, ...(next.parkedShots ?? [])];
    for (const shot of nextShots) {
      const source = [...previous.shots, ...(previous.parkedShots ?? [])].find(s => s.id === shot.id) ?? restoredSources?.get(shot.id);
      if (!source || source.imagePath !== shot.imagePath ||
          source.swb?.sourcePath !== shot.swb?.sourcePath || source.swb?.sourceKind !== shot.swb?.sourceKind ||
          source.swb?.status !== shot.swb?.status || !envelope.shots[shot.id]) {
        envelope.shots[shot.id] = { ...envelope.shots[shot.id], state: "unknown" };
      }
    }
    // Metadata-only publication does not turn a pristine unimported source into an owned unknown.
    for (const shot of nextShots) {
      const source = [...previous.shots, ...(previous.parkedShots ?? [])].find(s => s.id === shot.id);
      if (source && !previous.pendingBake?.shots[shot.id] && !shotIds.includes(shot.id) &&
          source.imagePath === shot.imagePath && source.swb?.status === "non-swb" && shot.swb?.status === "non-swb") {
        try {
          if (manualImageImportAdmission({ shots: [source] })[0].fresh && manualImageImportAdmission({ shots: [shot] })[0].fresh) delete envelope.shots[shot.id];
        } catch { /* Non-default internal metadata remains unknown. */ }
      }
    }
    for (const id of shotIds) {
      const entry = envelope.shots[id];
      if (entry && entry.state !== "unknown") envelope.shots[id] = { ...entry, state: "pending", editToken: ports.freshToken() };
    }
    publish({ ...next, pendingBake: envelope });
    // Only full known owned sources actually removed in this publication are
    // witnesses. pendingDeletedShots itself is deliberately NOT a Shot list.
    if (supported(previous) && classifyPendingBake(previous) === "supported") {
      for (const shot of previous.shots) {
        if (shot.swb?.status !== "owned" || !/\.tiff?$/iu.test(shot.imagePath) ||
            [...next.shots, ...(next.parkedShots ?? [])].some(s => s.id === shot.id) ||
            next.pendingDeletedShots?.filter(s => s.id === shot.id && s.imagePath === shot.imagePath).length !== 1 ||
            !envelope.shots[shot.id] || envelope.shots[shot.id].state === "unknown") continue;
        deletedSources.set(shot.id, { epoch, projectId: previous.id, shot: structuredClone(shot),
          inputs: deletedShotInputs(shot), entry: deletedEntryIdentity(ports.projectRef.current, shot.id) });
      }
    }
    return true;
  };

  const publishEdit = (update: Project | ((p: Project) => Project), shotIds: string[]) =>
    publishEditWithSources(update, shotIds);

  // Metadata-only History already owns the exclusive queue: no nested queue or
  // asset writes. Actual identity reads precede the first publication.
  const publishMetadataHistory = async (next: Project, shotIds: string[]): Promise<boolean> => {
    const c = capture();
    const previousShots = [...c.project.shots, ...(c.project.parkedShots ?? [])];
    const restored = [...next.shots, ...(next.parkedShots ?? [])].filter(s => !previousShots.some(p => p.id === s.id));
    if (!restored.length) return publishEdit(next, shotIds);
    const dependency = JSON.stringify([c.project, next]);
    const ready = () => current(c) && !loading && !receipt && !remainingScript && !unsettledEffect &&
      supported(c.project) && classifyPendingBake(c.project) === "supported" &&
      next.id === c.project.id && !preserveRaw(next) && JSON.stringify([c.project, next]) === dependency;
    const sources = new Map<string, Shot>();
    if (!ready() || new Set(restored.map(s => s.id)).size !== restored.length) return false;
    for (const shot of restored) {
      const proof = deletedSources.get(shot.id), entry = c.project.pendingBake?.shots[shot.id];
      if (!proof || proof.epoch !== c.epoch || proof.projectId !== c.project.id ||
          proof.inputs !== deletedShotInputs(shot) || proof.entry !== deletedEntryIdentity(c.project, shot.id) ||
          !entry || entry.state === "unknown" || !shotIds.includes(shot.id) ||
          c.project.pendingDeletedShots?.filter(s => s.id === shot.id).length !== 1 ||
          c.project.pendingDeletedShots?.find(s => s.id === shot.id)?.imagePath !== shot.imagePath ||
          next.pendingDeletedShots?.some(s => s.id === shot.id) || !next.shots.some(s => s.id === shot.id)) return false;
      try { if (await ports.readIdentity(proof.shot) !== entry.acceptedOutputIdentity) return false; }
      catch { return false; }
      if (!ready() || deletedSources.get(shot.id) !== proof) return false;
      sources.set(shot.id, proof.shot);
    }
    if (!ready()) return false;
    // The narrow restoration permission must not smuggle an unrelated source
    // transition into an otherwise accepted metadata History publication.
    for (const shot of [...next.shots, ...(next.parkedShots ?? [])]) {
      const source = previousShots.find(s => s.id === shot.id) ?? sources.get(shot.id);
      if (!source || source.imagePath !== shot.imagePath ||
          source.swb?.sourcePath !== shot.swb?.sourcePath || source.swb?.sourceKind !== shot.swb?.sourceKind ||
          source.swb?.status !== shot.swb?.status || !c.project.pendingBake?.shots[shot.id]) return false;
    }
    return publishEditWithSources(next, shotIds, sources);
  };

  // Only Add/Paste actual completed root assets may call this; never initialize an existing shot.
  // Caller retains its operation scope and (when applicable) the existing exclusive queue.
  const publishNewShot = async (update: (p: Project) => Project, shotId: string, isCurrent: () => boolean): Promise<boolean> => {
    const c = capture();
    const allShots = (p: Project) => [...p.shots, ...(p.parkedShots ?? [])];
    if (loading || !isCurrent() || !supported(c.project) || allShots(c.project).some(s => s.id === shotId)) return false;
    const prepared = update(c.project);
    const shot = allShots(prepared).find(s => s.id === shotId);
    if (!shot || !/\.tiff?$/iu.test(shot.imagePath)) return false;
    let hash: string;
    try { hash = await ports.readIdentity(shot); } catch { return false; }
    const latest = ports.projectRef.current;
    if (loading || c.epoch !== epoch || !isCurrent() || !supported(latest) || allShots(latest).some(s => s.id === shotId)) return false;
    const next = update(latest);
    if (allShots(next).find(s => s.id === shotId)?.imagePath !== shot.imagePath) return false;
    // Fresh token + H0 in the same publication; never synced (matte may not be output yet).
    try { publish(initializeCompletedShot({ ...next, pendingBake: pendingBakeForProject(latest) }, shotId, hash, ports.freshToken())); } catch { return false; }
    return true;
  };

  // Explicit image Import owns the existing queue through required persistence and publication.
  const executeImageImport = async (c: Capture, effect: (project: Project) => Promise<FolderScanPayload>,
    prepare: (project: Project, ids: string[], isCurrent: () => boolean) => Promise<Project>,
    scope: { isCurrent: () => boolean; persist: (project: Project, input?: string, expectedInput?: string | null) => Promise<void>; published: (scan: FolderScanPayload, durable?: boolean) => void; recoveryRequired?: (message: string) => void; admit?: () => void; automatic?: boolean; dirtyShotIds?: string[];
      script?: { effect: (project: Project, input: string, plan: ScriptPlan) => Promise<FolderScanPayload>; prepare?: Parameters<typeof executeScriptImport>[2]; scope: ScriptScope } }) => {
    let effectStarted = false;
    let acknowledged: FolderScanPayload | undefined;
      try {
        if (loading || !current(c) || !scope.isCurrent() || receipt || remainingScript || unsettledEffect) return false;
        const admitted = scope.automatic ? automaticImageImportAdmission(c.project, scope.dirtyShotIds) : manualImageImportAdmission(c.project);
        for (const a of admitted) if (!a.fresh && !a.external && await ports.readIdentity(a.shot) !== a.entry!.acceptedOutputIdentity) throw new Error("Import source changed");
        if (!current(c) || !scope.isCurrent() || unsettledEffect) return false;
        scope.admit?.();
        effectStarted = true;
        const scan = await effect(c.project), effects = scan.normalSaveImportEffects;
        if (c.epoch !== epoch || !scope.isCurrent()) return false;
        if (!scan.project || !effects || new Set(effects.map(e => e.sourceShotId)).size !== effects.length) throw new Error("Import did not acknowledge actual completed shots");
        if (admitted.filter(a => a.fresh || a.external).some(a => !effects.some(e => e.sourceShotId === a.shot.id))) throw new Error("Import completion is missing");
        for (const e of effects) {
          const a = admitted.find(a => a.shot.id === e.sourceShotId), target = allShots(scan.project).find(s => s.id === e.shotId);
          if (!a || e.sourcePath !== a.shot.imagePath || !/^[a-f0-9]{64}$/u.test(e.sourceHash) || !/^[a-f0-9]{64}$/u.test(e.outputHash) || !target || target.imagePath !== e.targetPath || target.swb?.status !== "owned" ||
            !a.fresh && !a.external && e.sourceHash !== a.entry!.acceptedOutputIdentity || await ports.readIdentity(target) !== e.outputHash) throw new Error("Import output identity is unverified");
        }
        if (c.epoch !== epoch || !scope.isCurrent()) return false;
        acknowledged = scan;
        if (scan.normalSaveScriptInput !== undefined) {
          if (!scope.script) throw new Error("Import script continuation unavailable; external input retained");
          if (!scan.normalSaveScriptPlan) throw new Error("Import did not acknowledge its frozen script plan");
          // The image stage may legitimately duplicate a protected source. In legacy one-click
          // Import the duplicate inherits that source's imported text; do not re-plan the raw MD
          // against the newly expanded shot count and create unintended blank shots.
          const plan: ScriptPlan = scan.normalSaveScriptPlan.flatMap<ScriptPlan[number]>(item => item.type === "new" ? [item] : [item,
            ...effects.filter(e => e.sourceShotId === item.shotId && e.shotId !== e.sourceShotId)
              .map(e => ({ ...item, shotId: e.shotId }))]);
          remainingScript = { epoch, input: scan.normalSaveScriptInput, plan, dependency: scriptDependency(c.project), imageCompleted: false };
        }
        const scriptCurrent = () => !remainingScript ||
          remainingScript.epoch === epoch && scriptDependency(ports.projectRef.current) === remainingScript.dependency;
        if (!scriptCurrent()) throw new Error("Import script dependency changed during image stage; external input retained");
        const changedIds = effects.filter(e => e.kind !== "preserved").map(e => e.shotId);
        const preparationBase = ports.projectRef.current;
        const dependencies = (p: Project) => JSON.stringify({ dialogues: p.dialogues, scene: p.shots.map(s => [s.id, s.presentation]) });
        const dependencyCapture = dependencies(preparationBase);
        const preparationCurrent = () => c.epoch === epoch && scope.isCurrent() && dependencies(ports.projectRef.current) === dependencyCapture;
        const preparationEnvelope = pendingBakeForProject(scan.project);
        for (const e of effects) {
          const previous = pendingBakeForProject(c.project).shots[e.sourceShotId];
          preparationEnvelope.shots[e.shotId] = previous?.state === "pending"
            ? { ...previous, acceptedOutputIdentity: e.outputHash }
            : { state: "synced", acceptedOutputIdentity: e.outputHash };
        }
        // This is only verified effect evidence for the existing Import's local
        // ensure caller; it cannot certify the owner or clear pending obligations.
        const prepared = await prepare({ ...scan.project, pendingBake: preparationEnvelope, dialogues: preparationBase.dialogues }, changedIds, preparationCurrent);
        if (!preparationCurrent()) throw new Error("Import scene or dialogue changed during preparation; output remains incomplete");
        const tokens = new Map(changedIds.map(id => [id, ports.freshToken()]));
        const merge = () => {
          const latest = ports.projectRef.current;
          if (!preparationCurrent()) throw new Error("Import scene or dialogue changed after preparation");
          if (!scriptCurrent()) throw new Error("Import script dependency changed during image stage; external input retained");
          manualImageImportAdmission(latest);
          if (admitted.some(a => !samePendingSource(c.project, latest, a.shot.id))) throw new Error("Import source or lifecycle changed");
          const envelope = { ...latest.pendingBake, version: 1 as const, shots: { ...latest.pendingBake?.shots } };
          let next = { ...latest, pendingBake: envelope };
          for (const e of effects) {
            const target = allShots(prepared).find(s => s.id === e.shotId);
            const a = admitted.find(a => a.shot.id === e.sourceShotId)!;
            if (!target || target.imagePath !== e.targetPath) throw new Error("Import matte changed output source");
            if (e.kind === "preserved" || e.shotId !== e.sourceShotId) {
              const patchOriginal = (s: Shot): Shot => s.id === e.sourceShotId ? { ...s, swb: { ...s.swb!, status: "owned", baseFingerprint: target.swb?.baseFingerprint } } : s;
              next = { ...next, shots: next.shots.map(patchOriginal), parkedShots: next.parkedShots?.map(patchOriginal) };
              envelope.shots[e.sourceShotId] = { ...envelope.shots[e.sourceShotId], acceptedOutputIdentity: e.kind === "preserved" ? e.outputHash : e.sourceHash };
              if (e.kind === "preserved") continue;
            }
            const beforeShot = a.shot, latestShot = allShots(latest).find(s => s.id === e.sourceShotId)!;
            if (e.shotId === e.sourceShotId && (beforeShot.layers !== latestShot.layers || beforeShot.sketchLayers !== latestShot.sketchLayers || beforeShot.imageLayerEdits !== latestShot.imageLayerEdits || beforeShot.presentation !== latestShot.presentation)) throw new Error("Import internal output changed during I/O");
            const patch = (s: Shot): Shot => s.id === e.sourceShotId ? { ...s, imagePath: target.imagePath, fileName: target.fileName, previewPath: target.previewPath, sourceFileName: target.sourceFileName, presentation: target.presentation, activeLayerId: target.activeLayerId, activeLayerTarget: target.activeLayerTarget, swb: target.swb, layers: target.layers, sketchLayers: target.sketchLayers, imageLayerEdits: target.imageLayerEdits } : s;
            if (e.shotId === e.sourceShotId) next = { ...next, shots: next.shots.map(patch), parkedShots: next.parkedShots?.map(patch) };
            else {
              if (allShots(latest).some(s => s.id === e.shotId)) throw new Error("Import duplicate identity collision");
              const insert = (shots: Shot[]) => shots.flatMap(s => s.id === e.sourceShotId ? [s, target] : [s]).map((s, order) => ({ ...s, order }));
              next = latest.shots.some(s => s.id === e.sourceShotId) ? { ...next, shots: insert(next.shots) } : { ...next, parkedShots: insert(next.parkedShots ?? []) };
            }
            const old = envelope.shots[e.shotId];
            // Existing pending is never discharged by Import; only completed effects establish H0.
            envelope.shots[e.shotId] = { ...old, state: "pending", editToken: old?.editToken && old.editToken !== a.entry?.editToken ? old.editToken : tokens.get(e.shotId)!, acceptedOutputIdentity: e.outputHash };
            if (!a.fresh && old?.acceptedOutputIdentity !== a.entry?.acceptedOutputIdentity && e.shotId === e.sourceShotId) throw new Error("Import baseline changed");
          }
          return next;
        };
        if (c.epoch !== epoch || !scope.isCurrent()) return false;
        let merged = merge();
        let final = capture();
        await scope.persist(merged, remainingScript?.input, scan.normalSaveScriptExpectedInput);
        if (c.epoch !== epoch || !scope.isCurrent()) return false;
        if (!current(final)) {
          // Exactly one final persistence, never chase edits while holding the queue.
          merged = merge();
          final = capture();
          await scope.persist(merged, remainingScript?.input, scan.normalSaveScriptExpectedInput);
          if (c.epoch !== epoch || !scope.isCurrent()) return false;
        }
        const durable = current(final);
        if (!durable) merged = merge();
        publish(merged);
        scope.published(scan, durable);
        lastError = undefined;
        if (remainingScript && scope.script) {
          remainingScript.imageCompleted = true;
          remainingScript.dependency = scriptDependency(merged);
          return await executeRemainingScript(scope.script.effect, scope.script.prepare, scope.script.scope);
        }
        return durable;
      } catch (error) {
        if (c.epoch === epoch && scope.isCurrent()) {
          lastError = error;
          if (effectStarted && !preserveRaw(ports.projectRef.current)) {
            const latest = ports.projectRef.current, envelope = pendingBakeForProject(latest);
            const ids = new Set(allShots(c.project).map(s => s.id));
            // Only verified ACK paths are facts. Do not claim rollback or publish stale metadata.
            const facts = acknowledged?.normalSaveImportEffects ?? [];
            const patchFacts = (s: Shot): Shot => {
              const e = facts.find(e => e.sourceShotId === s.id && e.shotId === s.id);
              const target = e && allShots(acknowledged!.project!).find(t => t.id === e.shotId);
              if (!target || !samePendingSource(c.project, latest, s.id)) return s;
              return { ...s, imagePath: target.imagePath, fileName: target.fileName, swb: target.swb };
            };
            for (const id of ids) if (envelope.shots[id]) envelope.shots[id] = { ...envelope.shots[id], state: "unknown" };
            const factsProject = { ...latest, pendingBake: envelope, shots: latest.shots.map(patchFacts), parkedShots: latest.parkedShots?.map(patchFacts) };
            for (const e of facts) if (e.shotId !== e.sourceShotId && !allShots(latest).some(s => s.id === e.shotId) && samePendingSource(c.project, latest, e.sourceShotId)) {
              const target = allShots(acknowledged!.project!).find(s => s.id === e.shotId)!;
              envelope.shots[e.shotId] = { state: "unknown", acceptedOutputIdentity: e.outputHash };
              if (latest.shots.some(s => s.id === e.sourceShotId)) factsProject.shots = [...factsProject.shots, target];
              else factsProject.parkedShots = [...(factsProject.parkedShots ?? []), target];
            }
            publish(factsProject);
            scope.recoveryRequired?.(`Image Import incomplete after possible asset effects; assets retained, recovery required: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return false;
      }
  };
  const imageImport = (...args: Parameters<typeof executeImageImport> extends [Capture, ...infer A] ? A : never) => {
    const c = capture();
    return ports.queue.runExclusive(() => executeImageImport(c, ...args));
  };
  // Refresh owns the same domain as Import, including its reader; never loads an old scan.
  const externalRefresh = (read: (project: Project) => Promise<Project>,
    effect: Parameters<typeof executeImageImport>[1], prepare: Parameters<typeof executeImageImport>[2],
    scope: Parameters<typeof executeImageImport>[3]) => {
    const c = capture();
    return ports.queue.runExclusive(async () => {
      try {
        if (loading || !current(c) || !scope.isCurrent()) return false;
        lastError = undefined;
        scope.admit?.();
        const scanned = await read(c.project);
        if (!current(c) || !scope.isCurrent()) return false;
        if (!supported(c.project)) throw new Error("External refresh compatibility unknown; both versions retained");
        const envelope = pendingBakeForProject(c.project);
        let conflict = false;
        for (const shot of allShots(scanned)) {
          if (shot.swb?.status === "compatible-external-edit") continue;
          const entry = envelope.shots[shot.id];
          if (!entry) continue; // fresh scans are observable, never auto-imported
          let matches = false;
          try { matches = await ports.readIdentity(shot) === entry.acceptedOutputIdentity; } catch { /* missing source */ }
          if (!current(c) || !scope.isCurrent()) return false;
          if (!matches) { envelope.shots[shot.id] = { ...entry, state: "unknown" }; conflict = true; }
        }
        if (conflict) {
          publish({ ...scanned, pendingBake: envelope });
          throw new Error("Working TIFF bytes changed outside compatible scan; both versions retained");
        }
        // SWB scan normalization recreates objects/timestamps; a read-only observation
        // must not invalidate an admitted producer or create an autosave obligation.
        const meaning = (p: Project) => JSON.stringify({ ...p, updatedAt: undefined });
        if (meaning(scanned) === meaning(c.project)) return true;
        publish({ ...scanned, pendingBake: c.project.pendingBake });
        if (!allShots(scanned).some(s => s.swb?.status === "compatible-external-edit")) return true;
        return await executeImageImport(capture(), effect, prepare, { ...scope, automatic: true });
      } catch (error) {
        if (c.epoch === epoch && scope.isCurrent()) lastError = error;
        return false;
      }
    });
  };

  // Script text Import: the on-disk storyboard-script.md is the source of truth for the
  // SCRIPT-OWNED fields (scriptText + order) of the active shots. It produces a Project
  // (metadata) obligation only: an existing shot's text/order change must NOT invent a new
  // raster token. Only genuinely new blank shots that main actually created are initialized
  // at H0 from their real completed identity — never an invented redraw/matte.
  type ScriptScope = { isCurrent: () => boolean; persist: (project: Project, input?: string) => Promise<void>;
    published: (scan: FolderScanPayload, durable?: boolean, changedAssetShotIds?: string[]) => void; admit?: () => void; recoveryRequired?: (message: string) => void };
  const executeScriptImport = async (c: Capture,
    effect: (project: Project) => Promise<FolderScanPayload>,
    prepare: ((project: Project, ids: string[], isCurrent: () => boolean, onPreparedAssets?: (ids: readonly string[]) => void) => Promise<Project>) | undefined,
    scope: ScriptScope) => {
    lastError = undefined;
    let effectStarted = false;
    let imported: Project | undefined;
    let newShots: Shot[] = [];
    let capturedActiveIds = new Set<string>();
    let capturedOrder: string[] = [];
    // A persist attempt is a real side effect: the required JSON/MD may already have landed on
    // disk (JSON first). Track it so a later failure preserves that fact instead of pretending
    // there was no effect and letting a stale in-memory autosave overwrite the written disk.
    let persistAttempted = false;
    // Prepare state is declared at function scope so the failure gate can read the actual write
    // facts even when the effect throws before the prepare block is reached.
    let preparedAssets: Map<string, { before: Shot; after: Shot }> | undefined;
    let assetChangedIds: string[] = [];
    // Actual write facts, reported by the prepare itself across the owner-after-prepare boundary:
    // a shot whose asset bytes were rewritten survives even when a LATER dependency rejection
    // throws before buildPublication returns, so the failure gate is not blind to the real effect.
    let preparedAssetShotIds: string[] = [];
    // Snapshot of the scene/dialogue dependency the prepared asset was derived from; rechecked on
    // every rebuild AND the final publication so a late P2/P3 cannot be reported as a new success.
    let assetDependencySnapshot: string | undefined;
    try {
      if (loading || !current(c) || !scope.isCurrent() || receipt) return false;
      if (!supported(c.project)) throw new Error("Script import compatibility unknown; project retained");
      // The captured active set is known before the effect, so a failure can still identify which
      // shots' persisted JSON may already have landed.
      capturedActiveIds = new Set(c.project.shots.map(s => s.id));
      capturedOrder = c.project.shots.map(s => s.id);
      scope.admit?.();
      effectStarted = true;
      const scan = await effect(c.project);
      if (c.epoch !== epoch || !scope.isCurrent()) return false;
      // The script path is Project-only: a raster ACK payload belongs to Import, not here.
      if (!scan.project || scan.normalSaveImportEffects) throw new Error("Script import did not return a plain project");
      imported = scan.project;
      // The parsed plan may only (re)label/reorder captured shots and append genuinely new
      // blanks. A plan that dropped a captured shot is refused before any Project publication.
      const importedActive = imported.shots;
      const importedById = new Map(importedActive.map(s => [s.id, s]));
      for (const id of capturedActiveIds) if (!importedById.has(id)) throw new Error("Script import dropped an existing shot");
      newShots = importedActive.filter(s => !capturedActiveIds.has(s.id));
      const newIds = newShots.map(s => s.id);
      // Read the real completed blank identity (H0) of each new shot. A failed/absent hash
      // means no certification: the whole publication is refused, no partial token is written.
      const newHashes = new Map<string, string>();
      for (const shot of newShots) {
        const hash = await ports.readIdentity(shot);
        if (!/^[a-f0-9]{64}$/u.test(hash)) throw new Error("Script import blank identity is unverified");
        newHashes.set(shot.id, hash);
        if (c.epoch !== epoch || !scope.isCurrent()) return false;
      }
      // captured → latest may transfer ONLY this operation's own script-owned fields (scriptText +
      // order) onto the captured shots. A newer same-scope edit to those fields, to the active/
      // parked lifecycle, or a new-shot identity collision is a conflict: refuse rather than let
      // the Markdown "source of truth" silently overwrite the newer edit.
      const dependency = (p: Project) => JSON.stringify({ dialogues: p.dialogues,
        scene: p.shots.map(s => [s.id, s.presentation, s.scriptText, s.order,
          s.layers, s.sketchLayers, s.imageLayerEdits, s.baseVisible, s.activeLayerId, s.activeLayerTarget,
          s.swb?.canvasWidth, s.swb?.canvasHeight, s.swb?.version, s.swb?.status,
          s.swb?.sourceKind, s.swb?.sourcePath, s.swb?.baseFingerprint]) });
      const merge = () => {
        const latest = ports.projectRef.current;
        if (c.epoch !== epoch || !scope.isCurrent()) throw new Error("Script import workspace changed");
        if (!supported(latest)) throw new Error("Script import workspace output state changed");
        const latestActive = latest.shots;
        const latestById = new Map(allShots(latest).map(s => [s.id, s]));
        const latestActiveIds = new Set(latestActive.map(s => s.id));
        for (const id of capturedActiveIds) {
          const captured = c.project.shots.find(s => s.id === id)!;
          const latestShot = latestById.get(id);
          if (!latestShot || !latestActiveIds.has(id)) throw new Error("Script import target lifecycle changed");
          if (latestShot.scriptText !== captured.scriptText) throw new Error("Script import target text changed during I/O");
        }
        const latestCapturedOrder = latestActive.filter(s => capturedActiveIds.has(s.id)).map(s => s.id);
        if (latestCapturedOrder.length !== capturedOrder.length ||
          latestCapturedOrder.some((id, index) => id !== capturedOrder[index])) {
          throw new Error("Script import target order changed during I/O");
        }
        for (const shot of newShots) {
          if (latestActiveIds.has(shot.id) || (latest.parkedShots ?? []).some(s => s.id === shot.id)) throw new Error("Script import identity collision");
          if (allShots(latest).some(s => s.imagePath === shot.imagePath)) throw new Error("Script import asset path collision");
        }
        const active: Shot[] = importedActive.map(importedShot => {
          const existing = latestActive.find(s => s.id === importedShot.id);
          // Existing shot keeps ALL latest fields; only the script-owned text is taken from the plan.
          return existing ? { ...existing, scriptText: importedShot.scriptText } : importedShot;
        });
        // Shots latest gained after capture (same scope) stay; never overwritten by the plan.
        for (const shot of latestActive) if (!importedById.has(shot.id)) active.push(shot);
        let next: Project = { ...latest, shots: active.map((s, order) => ({ ...s, order })) };
        for (const shot of newShots) next = initializeCompletedShot(next, shot.id, newHashes.get(shot.id)!, ports.freshToken());
        return next;
      };
      // The scene/dialogue dependency the prepared asset is derived from. Captured from the LATEST
      // published Project (the merged candidate is not published yet) and rechecked on every rebuild
      // and at the final publication, so a late P2/P3 can never be reported as a new success.
      const dependencyState = () => dependency(ports.projectRef.current);
      const dependencyCurrentFor = (snapshot: string) => () =>
        c.epoch === epoch && scope.isCurrent() && dependencyState() === snapshot;
      const assetDependencyChanged = () => assetDependencySnapshot !== undefined &&
        !(c.epoch === epoch && scope.isCurrent() && dependencyState() === assetDependencySnapshot);
      // A prepare changes real pixels (scene matte / overlay expansion). It must run at most ONCE:
      // a P2/P3 during the required persistence re-merges the latest METADATA but reuses the
      // already-completed asset preparation, so the same internal PNG is never re-expanded.
      // Track the derived field set, including SWB canvas dimensions but not the whole SWB record.
      // Eligibility/provenance changes are rejected by the dependency check; other latest metadata
      // stays latest. Each overlay below contains only fields this prepare actually changed.
      const assetKey = (shot: Shot) => JSON.stringify([shot.layers, shot.sketchLayers, shot.imageLayerEdits,
        shot.presentation, shot.swb?.canvasWidth, shot.swb?.canvasHeight, shot.baseVisible, shot.activeLayerId, shot.activeLayerTarget]);
      const applyPreparedAssets = (merged: Project): Project => {
        if (!preparedAssets) return merged;
        const overlay = (shot: Shot): Shot => {
          const prepared = preparedAssets!.get(shot.id);
          if (!prepared) return shot;
          const { before, after } = prepared;
          // Overlay only fields actually derived by this prepare. SWB eligibility and provenance
          // belong to latest metadata; never replace the entire SWB record with captured bytes.
          const next = { ...shot };
          for (const key of ["layers", "sketchLayers", "imageLayerEdits", "presentation", "baseVisible",
            "activeLayerId", "activeLayerTarget"] as const) {
            if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
              Object.assign(next, { [key]: after[key] });
            }
          }
          for (const key of ["canvasWidth", "canvasHeight"] as const) {
            if (before.swb?.[key] !== after.swb?.[key] && after.swb && next.swb) {
              next.swb = { ...next.swb, [key]: after.swb[key] };
            }
          }
          return next;
        };
        return { ...merged, shots: merged.shots.map(overlay), parkedShots: merged.parkedShots?.map(overlay) };
      };
      // Existing owned shots whose internal PNG actually changed need a fresh pending obligation
      // (their accepted output is now stale); purely matching / text-only shots stay untouched so
      // a pure text/order Import never churns tokens.
      const advanceChangedAssets = (project: Project): Project => {
        if (!assetChangedIds.length) return project;
        const envelope = pendingBakeForProject(project);
        let changed = false;
        for (const id of assetChangedIds) {
          const entry = envelope.shots[id];
          if (entry && entry.state === "synced") { envelope.shots[id] = { state: "pending", editToken: ports.freshToken(), acceptedOutputIdentity: entry.acceptedOutputIdentity }; changed = true; }
        }
        return changed ? { ...project, pendingBake: envelope } : project;
      };
      const runPrepare = async (merged: Project): Promise<Project> => {
        const before = new Map(merged.shots.map(s => [s.id, s] as const));
        // Capture the derivation snapshot and hand the prepare an isCurrent bound to it.
        assetDependencySnapshot = dependencyState();
        const isCurrent = dependencyCurrentFor(assetDependencySnapshot);
        // The prepare reports the shots whose asset bytes it actually rewrote BEFORE any later
        // dependency rejection, so the owner-after-prepare boundary records a real effect that a
        // subsequent throw (or refused publication) must not lose.
        const reportPreparedAssets = (ids: readonly string[]) => {
          if (ids.length) preparedAssetShotIds = [...new Set([...preparedAssetShotIds, ...ids])];
        };
        const out = await prepare!(merged, newIds, isCurrent, reportPreparedAssets);
        if (!isCurrent()) throw new Error("Script import scene changed during preparation; output remains incomplete");
        const changed = new Map<string, { before: Shot; after: Shot }>();
        for (const shot of out.shots) {
          const prior = before.get(shot.id);
          if (prior && assetKey(prior) !== assetKey(shot)) changed.set(shot.id, { before: prior, after: shot });
        }
        preparedAssets = changed;
        assetChangedIds = [...new Set([...changed.keys(), ...preparedAssetShotIds])];
        return out;
      };
      // The prepare must target the ACTUAL needed set (genuinely new blanks AND existing owned
      // shots whose overlay no longer matches), which the caller's prepare computes; it is NOT
      // gated on newIds being non-empty, or an existing-only mismatch would never be inherited.
      const buildPublication = async (): Promise<Project> => {
        const next = merge();
        const withAssets = !prepare ? next : (preparedAssets ? applyPreparedAssets(next) : await runPrepare(next));
        return advanceChangedAssets(withAssets);
      };
      let prepared = await buildPublication();
      let final = capture();
      persistAttempted = true;
      await scope.persist(prepared, remainingScript?.input);
      if (c.epoch !== epoch || !scope.isCurrent()) return false;
      // A P2/P3 that changed the SCENE/DIALOGUE during the required persistence invalidates the
      // prepared asset derivation: never report the stale internal PNG as a new success.
      if (assetDependencyChanged()) throw new Error("Script import scene changed during persistence; output remains incomplete");
      if (!current(final)) {
        // Exactly one final persistence, never chase edits while holding the queue.
        prepared = await buildPublication();
        final = capture();
        persistAttempted = true;
        await scope.persist(prepared, remainingScript?.input);
        if (c.epoch !== epoch || !scope.isCurrent()) return false;
        if (assetDependencyChanged()) throw new Error("Script import scene changed during persistence; output remains incomplete");
      }
      const durable = current(final);
      if (!durable) prepared = await buildPublication();
      if (assetDependencyChanged()) throw new Error("Script import scene changed before publication; output remains incomplete");
      publish(prepared);
      scope.published(scan, durable, assetChangedIds.length ? [...assetChangedIds] : undefined);
      lastError = undefined;
      return durable;
    } catch (error) {
      if (c.epoch === epoch && scope.isCurrent()) {
        lastError = error;
        // Preserve the real facts: a persist attempt (or a materialized new blank, or a typed
        // main-process recovery-incomplete plain result decoded locally by the renderer) may already have
        // written JSON/MD or left assets on disk. Mark the affected shots unknown so a stale
        // in-memory autosave cannot overwrite the already-written disk, and never guess a
        // rollback that could delete a dependency. A pure merge/text/order conflict BEFORE any
        // effect publishes nothing and does not gate the newer edit.
        const recoveryIncomplete = importRecoveryIncomplete(error);
        // A prepare that actually rewrote an existing (or new) owned shot's internal PNG is a real
        // effect even with no new shots and no persist attempt; a failed derive or an unprovable
        // rollback must gate the writers rather than be treated as no-effect.
        const assetWritten = preparedAssetShotIds.length > 0;
        const sideEffected = persistAttempted || newShots.length > 0 || recoveryIncomplete || assetWritten;
        if (effectStarted && sideEffected && !preserveRaw(ports.projectRef.current)) {
          const latest = ports.projectRef.current;
          const envelope = pendingBakeForProject(latest);
          if (persistAttempted || recoveryIncomplete) for (const id of capturedActiveIds) if (envelope.shots[id]) envelope.shots[id] = { ...envelope.shots[id], state: "unknown" };
          // The shots whose asset bytes the prepare actually rewrote keep the latest Project but are
          // marked unknown so a stale in-memory autosave cannot silently overwrite the written PNG.
          for (const id of preparedAssetShotIds) envelope.shots[id] = { ...envelope.shots[id], state: "unknown" };
          const kept = new Set(allShots(latest).map(s => s.id));
          const orphan = newShots.filter(s => !kept.has(s.id));
          for (const shot of orphan) envelope.shots[shot.id] = { state: "unknown" };
          publish({ ...latest, pendingBake: envelope,
            shots: [...latest.shots, ...orphan.map((shot, index) => ({ ...shot, order: latest.shots.length + index }))] });
          scope.recoveryRequired?.("Script Import incomplete after possible persistence; assets retained, recovery required");
        }
      }
      return false;
    }
  };
  const executeRemainingScript = async (effect: (project: Project, input: string, plan: ScriptPlan) => Promise<FolderScanPayload>,
    prepare: Parameters<typeof executeScriptImport>[2], scope: ScriptScope) => {
    const held = remainingScript;
    if (!held || held.epoch !== epoch || !held.imageCompleted || !scope.isCurrent()) return false;
    if (scriptDependency(ports.projectRef.current) !== held.dependency) {
      lastError = new Error("Image Import completed, script Import incomplete: original script dependency changed; external input retained");
      return false;
    }
    const completed = await executeScriptImport(capture(), p => effect(p, held.input, held.plan), prepare, { ...scope,
      published: (...args) => {
        // Required ACK consumed the input even if a newer metadata edit needs ordinary autosave.
        if (remainingScript === held && held.epoch === epoch) { remainingScript = undefined; scriptCompletion++; }
        scope.published(...args);
      } });
    if (!completed && remainingScript === held && held.epoch === epoch && lastError) {
      const detail = lastError instanceof Error ? lastError.message : String(lastError);
      const error = new Error(`Image Import completed, script Import incomplete; source retained by operation: ${detail}`, { cause: lastError });
      lastError = error;
    }
    return completed;
  };
  const scriptImport = (effect: (project: Project, input?: string, plan?: ScriptPlan) => Promise<FolderScanPayload>,
    prepare: ((project: Project, ids: string[], isCurrent: () => boolean, onPreparedAssets?: (ids: readonly string[]) => void) => Promise<Project>) | undefined,
    scope: ScriptScope) => {
    const c = capture();
    return ports.queue.runExclusive(async () => remainingScript
      ? current(c) && await executeRemainingScript(effect, prepare, scope)
      : await executeScriptImport(c, effect, prepare, scope));
  };

  const autosave = () => {
    const c = capture();
    return ports.queue.runExclusive(async () => {
      if (loading || !current(c) || !supported(c.project) || receipt || remainingScript || unsettledEffect) return false;
      await ports.persist(c.project);
      return current(c);
    });
  };
  const persistAdmittedAssets = () => ports.queue.runExclusive(async () => {
    // Capture at execution, not before queued P2 naming edits. Metadata-only P2
    // can advance during this ACK; Save recaptures it after producers settle.
    const c = capture(), revision = assetRevision;
    const assets = (p: Project) => JSON.stringify({pendingBake:p.pendingBake,
      shots:allShots(p).map(s=>({id:s.id,imagePath:s.imagePath,swb:s.swb,layers:s.layers}))});
    if (loading || !supported(c.project) || receipt || remainingScript || unsettledEffect) return false;
    const binding = assets(c.project);
    await ports.persist(c.project, true);
    const completed = c.epoch === epoch && revision === assetRevision && !loading && !unsettledEffect && binding === assets(ports.projectRef.current);
    if (completed) {
      // These exact admitted versions' history/descriptor publication ran in
      // the producer before this bound required ACK. No future version clears.
      for (let i = desiredAssets.length - 1; i >= 0; i--)
        if (desiredAssets[i].version <= revision) desiredAssets.splice(i, 1);
    }
    return completed;
  });
  // Ensure/export only derive files, not Project metadata or output receipts.
  // Existing caller queue owns within-operation requests; never nest runExclusive.
  const executeDerivedAssets = async (c: Capture, effect: (project: Project) => Promise<unknown>, isCurrent: () => boolean) => {
    try {
      if (loading || !current(c) || !supported(c.project) || receipt || remainingScript || !isCurrent()) return false;
      for (const shot of allShots(c.project)) {
        const entry = pendingBakeForProject(c.project).shots[shot.id];
        if (await ports.readIdentity(shot) !== entry.acceptedOutputIdentity) throw new Error("Asset source changed; assets retained");
      }
      if (!current(c) || loading || !isCurrent()) return false;
      await effect(c.project);
      // No returned Project publication; metadata-P2 remains the sole owner truth.
      return current(c) && !loading && isCurrent();
    } catch (error) {
      if (c.epoch === epoch && isCurrent()) lastError = error;
      return false;
    }
  };
  const captureAssetScope = () => {
    const c = capture();
    return () => !loading && current(c) && supported(c.project) && !receipt && !remainingScript;
  };
  // Normalize separators once and compare relative/under (mirrors the platform
  // assertPathInsideFolder semantics: reject `..` segments and absolute escapes) instead of a
  // raw string prefix that a `..` segment can slip through.
  const normalizePath = (value: string) => value.replaceAll("\\", "/");
  const relativeUnder = (folder: string, file: string): string | undefined => {
    const base = normalizePath(folder).replace(/\/+$/u, "");
    const target = normalizePath(file);
    if (target.split("/").includes("..")) return undefined;
    if (!base) return undefined;
    if (target === base) return "";
    return target.startsWith(`${base}/`) ? target.slice(base.length + 1) : undefined;
  };
  const hasTraversal = (value: string) =>
    value.startsWith("/") || value.startsWith("\\") || normalizePath(value).split("/").includes("..");
  const underLayerPrefix = (value: string, prefix: string) =>
    value === prefix || value.startsWith(`${prefix}/`) || value.startsWith(`${prefix}\\`);
  const captureAddShotOperation = (context: { folderPath?: string; metadataPath?: string }) => {
    const c = capture();
    const folderPath = context.folderPath, metadataPath = context.metadataPath;
    const LAYER_PREFIX = ".storyboard-workbench/layers/";
    // The one actual blank completion this operation produced, recorded by the operation's OWN
    // bound createBlankShot wrapper. Never a shared "latest" ref, and never a caller-supplied
    // argument: the caller keeps this handle locally so an interleaved newer Add cannot be
    // borrowed, and a caller cannot forge the fact.
    let blankCompletion: { imagePath: string; fileName?: string } | undefined;
    let registered: { shotId: string; imagePath: string; fileName?: string } | undefined;
    // This operation's single blank-request qualification, claimed synchronously by the bound api
    // BEFORE the real createBlankShot effect. It is a one-way latch: a started/completed/failed
    // request can never start another create (a second sequential or concurrent call is refused
    // before the effect), a failed request is NOT reset for automatic retry, and a possibly-created
    // provisional blank is never deleted. Only a brand-new operation handle retries.
    let blankRequested = false;
    const takeIds = () => new Set([...allShots(c.project), ...allShots(ports.projectRef.current)].map(s => s.id));
    const takePaths = () => new Set([...allShots(c.project), ...allShots(ports.projectRef.current)].map(s => s.imagePath));
    const instance = () => {
      if (c.epoch !== epoch) throw new Error("Add shot refused: workspace instance changed");
      if (loading) throw new Error("Add shot refused: workspace load in flight");
      if (receipt) throw new Error("Add shot refused: output receipt held");
      if (remainingScript) throw new Error("Add shot refused: Import script input remains unconsumed");
      if (!supported(ports.projectRef.current)) throw new Error("Add shot refused: workspace output state is not ready");
    };
    const ownLayer = (shotId: string, bitmapPath: string) =>
      !hasTraversal(bitmapPath) && underLayerPrefix(bitmapPath, `${LAYER_PREFIX}${shotId}`);
    // Claim the one blank-request qualification synchronously, BEFORE the real createBlankShot
    // effect. Re-checks the same captured instance so a stale operation is refused here too; the
    // operation's own wrong-scope/recovery guard runs first, so a refused scope never spends it.
    const beginBlankRequest = () => {
      instance();
      if (blankRequested) throw new Error("Add shot refused: a blank request has already started for this operation");
      blankRequested = true;
    };
    // The ONLY fact registerBlankShot may bind: the actual return of this operation's own bound
    // createBlankShot wrapper. A caller-supplied path can never register (no receipt forgery), and
    // exactly one completion is allowed.
    const recordBlankCompletion = (result: { imagePath: string; fileName?: string }) => {
      if (blankCompletion) throw new Error("Add shot refused: operation already recorded a blank completion");
      if (!/\.tiff?$/iu.test(result.imagePath)) throw new Error("Add shot refused: blank output is not a TIFF");
      const relative = folderPath === undefined ? undefined : relativeUnder(folderPath, result.imagePath);
      if (relative === undefined || relative === "") throw new Error("Add shot refused: blank output outside the operation folder");
      if (takePaths().has(result.imagePath)) throw new Error("Add shot refused: an existing TIFF cannot be certified as a new blank");
      blankCompletion = { imagePath: result.imagePath, fileName: result.fileName };
    };
    // Bind this operation's registered shot to the actual completion that its own bound api
    // recorded (once). Never to a caller path, never without a completion, never a borrowed blank.
    const registerBlankShot = (done: { shotId: string }) => {
      instance();
      if (registered) throw new Error("Add shot refused: operation already registered a shot");
      if (!blankCompletion) throw new Error("Add shot refused: no blank completion recorded for this operation");
      if (!done.shotId || takeIds().has(done.shotId)) throw new Error("Add shot refused: existing shot identity");
      registered = { shotId: done.shotId, imagePath: blankCompletion.imagePath, fileName: blankCompletion.fileName };
      return registered;
    };
    // Recheck the SAME captured instance/workspace context; never re-capture per call.
    const admit = (args: { folderPath?: string; metadataPath?: string; bitmapPath?: string; project?: Project } = {}) => {
      instance();
      if (args.folderPath !== undefined && args.folderPath !== folderPath) throw new Error("Add shot refused: wrong folder");
      if (args.metadataPath !== undefined && args.metadataPath !== metadataPath) throw new Error("Add shot refused: wrong metadata path");
      if (args.bitmapPath !== undefined) {
        if (!registered || !ownLayer(registered.shotId, args.bitmapPath)) throw new Error("Add shot refused: asset outside the registered new shot's own paths");
      }
      if (args.project) {
        // Only this operation's registered shot may be produced; existing shots and any
        // extra/borrowed id are refused before the effect.
        if (!registered) throw new Error("Add shot refused: no registered new shot for this operation");
        if (args.project.shots.length !== 1 || args.project.shots.some(shot => shot.id !== registered!.shotId)) throw new Error("Add shot refused: only the registered new shot may be produced");
        const shot = args.project.shots[0];
        const relative = folderPath === undefined ? undefined : relativeUnder(folderPath, shot.imagePath);
        if (relative === undefined || relative === "" || shot.imagePath !== registered.imagePath) throw new Error("Add shot refused: registered image path is required");
        for (const layer of shot.layers ?? []) if (!ownLayer(registered!.shotId, layer.bitmapPath)) throw new Error("Add shot refused: asset outside the registered new shot's own paths");
      }
    };
    return { admit, beginBlankRequest, recordBlankCompletion, registerBlankShot };
  };
  const derivedAssets = (effect: (project: Project) => Promise<unknown>, isCurrent: () => boolean, alreadyQueued = false, c = capture()) =>
    alreadyQueued ? executeDerivedAssets(c, effect, isCurrent) : ports.queue.runExclusive(() => executeDerivedAssets(c, effect, isCurrent));
  type PendingEffect = (project: Project, ids: string[]) => Promise<NormalSaveOutputAck[]>;
  type PendingScope = { isCurrent: () => boolean; persist: (project: Project) => Promise<void> };
  const allShots = (p: Project) => [...p.shots, ...(p.parkedShots ?? [])];
  const samePendingSource = (before: Project, latest: Project, id: string) => {
    const a = allShots(before).find(s => s.id === id), b = allShots(latest).find(s => s.id === id);
    return !!a && !!b && a.imagePath === b.imagePath && a.swb?.sourcePath === b.swb?.sourcePath &&
      a.swb?.sourceKind === b.swb?.sourceKind && a.swb?.status === b.swb?.status &&
      before.shots.some(s => s.id === id) === latest.shots.some(s => s.id === id);
  };
  // Only Pending's existing materialize/move workflow. Not a general operation coordinator.
  const executePending = async (c: Capture, update: (p: Project) => Project, ids: string[], materializes: boolean, effect: PendingEffect, scope?: PendingScope) => {
    let effected = false;
    let verifiedMerge: (() => Project) | undefined;
    const uncertain = () => {
      if (c.epoch !== epoch || scope && !scope.isCurrent() || preserveRaw(ports.projectRef.current)) return;
      let latest = ports.projectRef.current;
      try { latest = verifiedMerge?.() ?? latest; } catch { /* Preserve changed source/lifecycle, not the old result. */ }
      const envelope = pendingBakeForProject(latest);
      for (const id of ids) if (envelope.shots[id]) envelope.shots[id] = { ...envelope.shots[id], state: "unknown" };
      publish({ ...latest, pendingBake: envelope });
    };
    try {
      if (loading || !current(c) || !supported(c.project) || receipt || remainingScript || scope && !scope.isCurrent() || !ids.length || new Set(ids).size !== ids.length) return false;
      const before = pendingBakeForProject(c.project);
      for (const id of ids) {
        const shot = allShots(c.project).find(s => s.id === id);
        if (!shot || await ports.readIdentity(shot) !== before.shots[id].acceptedOutputIdentity) return false;
      }
      if (!current(c) || scope && !scope.isCurrent()) return false;
      const prepared = update(c.project);
      if (ids.some(id => !allShots(prepared).some(s => s.id === id && s.imagePath === allShots(c.project).find(s => s.id === id)!.imagePath) ||
        (materializes ? !(prepared.parkedShots ?? []).some(s => s.id === id) : !prepared.shots.some(s => s.id === id)))) return false;
      effected = true;
      const acks = await effect(prepared, ids);
      if (c.epoch !== epoch) return false;
      if (acks.length !== ids.length || new Set(acks.map(a => a.shotId)).size !== ids.length) throw new Error("Pending did not acknowledge each actual output");
      for (const ack of acks) {
        const source = allShots(c.project).find(s => s.id === ack.shotId);
        if (!ids.includes(ack.shotId) || !source || ack.sourcePath !== source.imagePath ||
          ack.capturedToken !== before.shots[ack.shotId].editToken || !/^[a-f0-9]{64}$/u.test(ack.outputHash) ||
          !materializes && ack.outputHash !== before.shots[ack.shotId].acceptedOutputIdentity ||
          ack.fileName !== ack.targetPath.split(/[\\/]/u).pop() ||
          await ports.readIdentity({ ...source, imagePath: ack.targetPath }) !== ack.outputHash) throw new Error("Pending output identity is unverified");
      }
      if (c.epoch !== epoch) return false;
      if (scope && !scope.isCurrent()) throw new Error("Pending workspace changed after effect");
      verifiedMerge = () => {
      const latest = ports.projectRef.current;
      if (!supported(latest) || ids.some(id => !samePendingSource(c.project, latest, id))) throw new Error("Pending source or lifecycle changed");
      const envelope = pendingBakeForProject(latest);
      for (const ack of acks) {
        const entry = envelope.shots[ack.shotId];
        if (entry.acceptedOutputIdentity !== before.shots[ack.shotId].acceptedOutputIdentity) throw new Error("Pending baseline changed");
        const completed = { ...entry, acceptedOutputIdentity: ack.outputHash };
        // Restore moves bytes only; it cannot certify a pending bitmap as output.
        if (materializes && entry.editToken === ack.capturedToken) { completed.state = "synced"; delete completed.editToken; }
        envelope.shots[ack.shotId] = completed;
      }
      const transitioned = update(latest), byId = new Map(acks.map(a => [a.shotId, a]));
      if (ids.some(id => transitioned.shots.some(s => s.id === id) !== prepared.shots.some(s => s.id === id) ||
        !allShots(transitioned).some(s => s.id === id))) throw new Error("Pending destination lifecycle changed");
      const patch = (shot: Shot): Shot => {
        const ack = byId.get(shot.id);
        return ack ? { ...shot, imagePath: ack.targetPath, fileName: ack.fileName!, swb: shot.swb && ack.baseFingerprint ? { ...shot.swb, baseFingerprint: ack.baseFingerprint } : shot.swb } : shot;
      };
      return { ...transitioned, pendingBake: envelope, shots: transitioned.shots.map(patch), parkedShots: transitioned.parkedShots?.map(patch) };
      };
      const merged = verifiedMerge();
      receipt = { epoch, acks };
      const final = capture(), persistedReceipt = receipt;
      await (scope?.persist ?? ports.persist)(merged);
      if (final.epoch === epoch && receipt === persistedReceipt) receipt = undefined;
      if (c.epoch !== epoch) return false;
      if (scope && !scope.isCurrent()) throw new Error("Pending workspace changed during persistence");
      const unchanged = current(final);
      // Publish only after required persistence; edits during that await are merged again.
      publish(unchanged ? merged : verifiedMerge());
      ports.onPendingPublication?.({ durable: unchanged, namespace: { before: c.project, after: ports.projectRef.current, ids, update } });
      lastError = undefined;
      return unchanged;
    } catch (error) {
      if (c.epoch === epoch && (!scope || scope.isCurrent())) lastError = error;
      // The main transaction owns rollback. Never issue a guessed reverse move here.
      if (effected) uncertain();
      return false;
    }
  };
  const pending = (update: (p: Project) => Project, ids: string[], materializes: boolean, effect: PendingEffect, scope?: PendingScope) => {
    const c = capture();
    return ports.queue.runExclusive(() => executePending(c, update, ids, materializes, effect, scope));
  };
  // Disk-backed callers must pass a reader, not JSON read before queue admission.
  // Project input is only for an already isolated in-memory fixture/snapshot.
  const createFromScript = (effect: () => Promise<FolderScanPayload>, scope: {
    isCurrent: () => boolean; admit: () => void; published: (scan: FolderScanPayload, project: Project) => void;
    recoveryRequired?: (message: string, quiet?: boolean) => void
  }) => {
    const c = capture();
    return ports.queue.runExclusive(async () => {
      try {
        if (loading || !current(c) || !scope.isCurrent() || !supported(c.project) || receipt || remainingScript) return false;
        scope.admit();
        const scan = await effect(), project = scan.project;
        if (!current(c) || !scope.isCurrent()) return false;
        if (!project || classifyPendingBake(project) !== "supported" || !supported(project) || project.parkedShots?.length) {
          throw new Error("New storyboard completion is not certified");
        }
        const oldPaths = new Set([...c.project.shots, ...(c.project.parkedShots ?? [])].map(s => s.imagePath));
        for (const shot of project.shots) {
          const entry = project.pendingBake!.shots[shot.id];
          if (!entry || entry.state !== "pending" || !entry.editToken || oldPaths.has(shot.imagePath) ||
            await ports.readIdentity(shot) !== entry.acceptedOutputIdentity) throw new Error("New blank completion changed");
        }
        if (!current(c) || !scope.isCurrent()) return false;
        epoch = {}; installedWorkspace = epoch; remainingScript = undefined; receipt = undefined; lastError = undefined;
        publish(project);
        scope.published(scan, project);
        return true;
      } catch (error) {
        if (c.epoch === epoch) {
          lastError = error;
          if (importRecoveryIncomplete(error)) scope.recoveryRequired?.(
            "New storyboard creation recovery incomplete; retained files require recovery", !scope.isCurrent());
        }
        return false;
      }
    });
  };
  const load = (input: Project | (() => Promise<Project>), onLoaded?: (project: Project) => void,
    parkedMigration?: { ids: (project: Project) => string[]; effect: PendingEffect; scope?: PendingScope },
    autoImport?: () => Parameters<typeof executeImageImport> extends [Capture, ...infer A] ? A : never,
    onSettled?: (info: { epoch: object; completed: boolean; project: Project }) => void) => {
    const requestEpoch = (epoch = {});
    loading = true;
    receipt = undefined;
    remainingScript = undefined;
    lastError = undefined;
    let completed = false;
    return ports.queue.runExclusive(async () => {
      // `onSettled` reports the request epoch and the FINAL owner Project (after Pending
      // migration/auto-import). The caller must still verify the epoch is current before adopting
      // it; this is a precise request scope, not a per-call re-capture.
      try {
      if (epoch !== requestEpoch) return false;
      // Retry only the exact completed effect's original bound persistence; never read A's old
      // JSON or adopt B while its full admitted completion still lacks required persistence ACK.
      await settleEffectCompletion();
      if (epoch !== requestEpoch) return false;
      const project = typeof input === "function" ? await input() : input;
      if (epoch !== requestEpoch) return false;
      const envelope = pendingBakeForProject(project);
      // Missing old output state stays unknown; legacy equivalence migration is retired.
      for (const shot of [...project.shots, ...(project.parkedShots ?? [])]) {
        const entry = envelope.shots[shot.id];
        if (entry.state !== "unknown" && !(autoImport && entry.state === "synced" && shot.swb?.status === "compatible-external-edit")) {
          try {
            if (await ports.readIdentity(shot) !== entry.acceptedOutputIdentity) envelope.shots[shot.id] = { ...entry, state: "unknown" };
          } catch { envelope.shots[shot.id] = { ...entry, state: "unknown" }; }
        }
      }
      if (epoch !== requestEpoch) return false;
      // Missing-entry pristine external images remain eligible only for explicit Import;
      // Save still derives unknown. Never erase an explicit unknown/raw future record.
      if (!preserveRaw(project)) for (const shot of [...project.shots, ...(project.parkedShots ?? [])]) {
        if (!project.pendingBake?.shots[shot.id]) {
          try { if (manualImageImportAdmission({ shots: [shot] })[0].fresh) delete envelope.shots[shot.id]; } catch { /* owned/ambiguous stays unknown */ }
        }
      }
      installedWorkspace = requestEpoch;
      publish(preserveRaw(project) ? project : { ...project, pendingBake: envelope });
      loading = false;
      onLoaded?.(ports.projectRef.current);
      if (parkedMigration) {
        const ids = parkedMigration.ids(ports.projectRef.current);
        // Already owns the reader domain: never re-enter runExclusive here.
        if (ids.length && !await executePending(capture(), p => p, ids, true, parkedMigration.effect, parkedMigration.scope)) return false;
      }
      if (autoImport && allShots(ports.projectRef.current).some(s => s.swb?.status === "compatible-external-edit")) {
        completed = await executeImageImport(capture(), ...autoImport());
        return completed;
      }
      completed = true;
      return true;
      } catch (error) {
        // A retained original completion can retry Save; a failed new reader must keep its
        // pre-existing not-ready gate, never silently authorize the stale installed Project.
        if (epoch === requestEpoch) { if (unsettledEffect) loading = false; lastError = error; }
        throw error;
      } finally {
        onSettled?.({ epoch: requestEpoch, completed, project: ports.projectRef.current });
      }
    });
  };
  const savePrepared = (initial = capture()) => {
    let c = initial;
    const instance = installedWorkspace;
    return ports.queue.runExclusive(async () => {
      try {
        const failed = unsettledEffect;
        if (failed?.recover) {
          if (!current(c)) return false;
          await failed.recover();
          if (c.epoch !== epoch) return false;
          c = capture(); // Only this proven operation's publication replaces this Save capture.
        }
        await settleEffectCompletion();
        if (loading || !current(c) || !supported(c.project) || remainingScript) return false;
        const envelope = pendingBakeForProject(c.project);
        const ids = c.project.shots.filter(s => envelope.shots[s.id].state === "pending").map(s => s.id);
        for (const shot of c.project.shots) {
          if (await ports.readIdentity(shot) !== envelope.shots[shot.id].acceptedOutputIdentity) return false;
        }
        if (!current(c)) return false;
        if (receipt && (ids.length === 0 || receipt.deletions?.length)) {
          const retryReceipt = receipt;
          if (retryReceipt.epoch !== epoch || retryReceipt.acks.some(ack => {
            const shot = c.project.shots.find(s => s.id === ack.shotId);
            return !shot || shot.imagePath !== ack.targetPath || envelope.shots[ack.shotId]?.acceptedOutputIdentity !== ack.outputHash;
          }) || retryReceipt.deletions?.some(ack => c.project.pendingDeletedShots?.some(s => s.id === ack.shotId) ||
            [...c.project.shots, ...(c.project.parkedShots ?? [])].some(s => s.id === ack.shotId) ||
            Object.hasOwn(envelope.shots, ack.shotId))) return false;
          await ports.persist(c.project, true);
          if (c.epoch === epoch && receipt === retryReceipt) receipt = undefined;
          if (c.epoch === epoch) lastError = undefined;
          return current(c) && complete(c.project);
        }
        syncDeletionLifecycles(c.project);
        const capturedLifecycles = new Map(deletionLifecycles);
        const output = ids.length || (c.project.pendingDeletedShots?.length ?? 0) || ports.outputWhenClean
          ? await ports.output(c.project, ids) : [];
        const acks = Array.isArray(output) ? output : output.outputs;
        const deletions = Array.isArray(output) ? [] : output.deletions;
        if (c.epoch !== epoch) return false;
        const mergeDeletions = (p: Project): Project | undefined => {
          if (new Set(deletions.map(a => a.shotId)).size !== deletions.length) return undefined;
          for (const ack of deletions) {
            const captured = c.project.pendingDeletedShots?.filter(s => s.id === ack.shotId) ?? [];
            const lifecycle = capturedLifecycles.get(ack.shotId);
            const entry = c.project.pendingBake?.shots[ack.shotId];
            if (captured.length !== 1 || captured[0].imagePath !== ack.sourcePath || !lifecycle ||
                !entry || entry.state === "unknown" ||
                deletionLifecycles.get(ack.shotId)?.marker !== lifecycle.marker || deletionIdentity(p, ack.shotId) !== lifecycle.identity) return undefined;
          }
          if (!deletions.length) return p;
          const retired = new Set(deletions.map(a => a.shotId));
          const shots = { ...p.pendingBake!.shots };
          for (const id of retired) delete shots[id];
          return { ...p, pendingBake: { ...p.pendingBake!, shots }, pendingDeletedShots: p.pendingDeletedShots?.filter(s => !retired.has(s.id)) };
        };
        const merged = acknowledgeBake(c.project, ports.projectRef.current, acks);
        if (!merged) return false;
        // Validate the actual output, not just a provider-supplied hash.
        for (const ack of acks) {
          const shot = merged.shots.find(s => s.id === ack.shotId)!;
          if (await ports.readIdentity(shot) !== ack.outputHash) return false;
        }
        if (c.epoch !== epoch) return false;
        // readIdentity awaited: merge again against the latest owner, never publish the pre-await Project.
        const latestBakeMerged = acknowledgeBake(c.project, ports.projectRef.current, acks);
        const latestMerged = latestBakeMerged && mergeDeletions(latestBakeMerged);
        if (!latestMerged) return false;
        if (acks.length || deletions.length) receipt = { epoch, acks, deletions };
        publish(latestMerged);
        if (acks.length) {
          // Verified physical facts survive required-persist failure. Notify
          // history here once; the retained-receipt retry must not replay it.
          ports.onSaveNamespace?.({ before: c.project, after: latestMerged,
            ids: acks.map(ack => ack.shotId), update: project => project });
        }
        const final = capture();
        const persistedReceipt = receipt;
        await ports.persist(final.project, true);
        // Durability of this completion is independent of edits published during I/O.
        // Only retire the exact receipt included in this ACK, never a later epoch's.
        if (final.epoch === epoch && receipt === persistedReceipt) receipt = undefined;
        if (!current(final)) return false;
        lastError = undefined;
        return complete(final.project);
      } catch (error) {
        if (importRecoveryIncomplete(error) && instance === installedWorkspace && !unsettledEffect) {
          // Main may have published names/JSON without a complete ACK. Never
          // persist this old Project to "recover" or silently clear the barrier.
          unsettledEffect = { persist: async () => { throw error; } };
        }
        if (c.epoch === epoch) lastError = error;
        return false;
      }
    });
  };
  const save = async () => {
    // Freeze outside the exclusive queue: admitted producers need it to ACK.
    if (saveAdmissionActive) return false;
    saveAdmissionActive = true;
    const initial = capture(), hadProducers = assetAdmission.retainedIntents().some(i => i.state === 'started');
    let lease = heldSaveAdmission ?? assetAdmission.beginIdleOperation() ?? assetAdmission.beginRecoveryOperation(unsettledEffect?.failure);
    try { if (!lease) lease = await assetAdmission.beginOperation(); }
    catch (error) { lastError = error; saveAdmissionActive = false; return false; }
    try { return await savePrepared(hadProducers ? capture() : initial); }
    finally {
      // Hold on incomplete Save; the existing exact-receipt retry may retire it.
      // New producers remain retained outside the queue, not replayed as effects.
      if (unsettledEffect || lastError) heldSaveAdmission = lease;
      else { assetAdmission.completeOperation(lease); heldSaveAdmission = undefined; }
      saveAdmissionActive = false;
    }
  };
  const hasUnsavedWork = () => !!assetAdmission.retainedIntents().length || !!ports.queue.isBusy?.() || loading || !!receipt || !!remainingScript || !!unsettledEffect ||
    !!lastError || !supported(ports.projectRef.current) || !complete(ports.projectRef.current);
  // A known receipt awaiting this active Save's required ACK is busy, not an
  // unknown failure. Close drains that queue; failed/abandoned receipts remain
  // protected as soon as Save settles. Do not permanently latch ordinary success.
  // Close has drained started producers. Revoked closures still own unique RAM
  // bytes: a later Save ACK cannot complete them or authorize ordinary discard.
  // Do not latch a started/waiting producer that can still finish normally.
  const recoveryRequired = () => assetAdmission.retainedIntents().some(intent => intent.state === 'cancelled-before-effect' || intent.state === 'failed') ||
    !!unsettledEffect || !!receipt && !saveAdmissionActive || !supported(ports.projectRef.current);
  const captureRecoveryContent = () => ({
    projectRaw: structuredClone(ports.projectRef.current),
    sequence, assetRevision, desiredAssets: structuredClone(desiredAssets),
    deletedDependencies: structuredClone([...deletedSources.values()].filter(v => v.epoch === epoch && v.projectId === ports.projectRef.current.id).map(v => v.shot)),
    retainedAssetIntents: assetAdmission.retainedIntents(),
    recoveryRequired: recoveryRequired(),
    effectFacts: { unsettled: !!unsettledEffect,
      ...(unsettledEffect?.historyRestore ? { historyRestore: structuredClone(unsettledEffect.historyRestore) } : {}),
      receipt: structuredClone(receipt?.acks ?? []),
      deletions: structuredClone(receipt?.deletions ?? []), remainingScript: remainingScript
        ? structuredClone({ input: remainingScript.input, plan: remainingScript.plan, dependency: remainingScript.dependency, imageCompleted: remainingScript.imageCompleted }) : null,
      error: lastError instanceof Error ? { name: lastError.name, message: lastError.message, ...Object.fromEntries(["code","recoveryIncomplete","publicationOrCleanup","metadata","retainedPaths","sourceEffects"].flatMap(key => (lastError as any)[key] === undefined ? [] : [[key,(lastError as any)[key]]])) } : lastError === undefined ? null : structuredClone(lastError) }
  });
  return { isBusy: () => loading || saveAdmissionActive || assetAdmission.isBusy() || !!ports.queue.isBusy?.(), suspendAssetAdmission: assetAdmission.suspend,
 resumeAssetAdmission: assetAdmission.resume, persistAdmittedAssets, submitAssetIntent, captureRecoveryContent, recoveryRequired, hasUnsavedWork, createFromScript, captureAssetScope, captureAddShotOperation, captureEffectAdmission, captureEffectCompletion, derivedAssets, publishEdit, publishMetadataHistory, publishNewShot, externalRefresh, imageImport, scriptImport, pending, autosave, load, save, capture, isRequestCurrent: (requestEpoch: object) => requestEpoch === epoch, get scriptCompletion() { return scriptCompletion; }, get scriptImportRemaining() { return !!remainingScript; }, get lastError() { return lastError; } };
};
