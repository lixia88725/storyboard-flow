import type { FolderScanPayload, Project } from '../shared/types';
import { createProject } from '../shared/projectOps';
import { createNormalSaveAppAdapter } from './normalSaveAppAdapter';
import { isCancelledBeforeEffect } from './assetIntentAdmission';

/** Main-issued observation, NOT a writer capability. Main rechecks its caller,
 * document and physical binding; neither a Root payload nor this id grants ACK. */
export type WorkspaceRootObservation = { binding: string; folderPath: string; metadataPath: string };
export type WorkspaceSlot = {
  readonly incarnation: object;
  readonly root?: WorkspaceRootObservation;
  readonly projectRef: { current: Project };
  adapter: ReturnType<typeof createNormalSaveAppAdapter>;
  lifecycle: 'active' | 'freezing' | 'suspended' | 'staging' | 'failed-staging';
  generation: number;
  readonly: boolean;
  recoveryMessage?: string;
  error?: unknown;
  view?: unknown;
};
type AdapterPorts = Parameters<typeof createNormalSaveAppAdapter>[0];
export const createWorkspaceSlots = (ports: {
  initialProject: Project;
  adapterPorts: (slot: WorkspaceSlot) => Omit<AdapterPorts, 'projectRef' | 'setProject' | 'paths'>;
  publishProject: (project: Project) => void;
  observe: (path: string) => Promise<WorkspaceRootObservation>;
  captureView: (slot: WorkspaceSlot) => unknown;
  certifyHandoff: (slot: WorkspaceSlot, capture: unknown) => Promise<boolean | { mode: 'ordinary-memory' | 'completed-terminal'; readonly: false }>;
  drain: () => Promise<void>;
  publishActive: (slot: WorkspaceSlot, scan?: FolderScanPayload) => void;
  revokeScope?: (slot: WorkspaceSlot) => void;
  onOpenError?: (error: unknown, slot: WorkspaceSlot) => void;
}) => {
  const slots: WorkspaceSlot[] = [];
  let active: WorkspaceSlot;
  let opening = false;
  let closing = false;
  let closePreparation: Promise<void> | undefined;
  let closeGeneration = 0;
  const create = (root: WorkspaceRootObservation | undefined, project: Project, lifecycle: WorkspaceSlot['lifecycle']) => {
    const slot = { incarnation: Object.freeze({}), root: root && Object.freeze({ ...root }), projectRef: { current: project }, lifecycle, generation: 0, readonly: false } as WorkspaceSlot;
    const adapterPorts = ports.adapterPorts(slot);
    slot.adapter = createNormalSaveAppAdapter({ ...adapterPorts,
      onError: error => { slot.error = error; adapterPorts.onError(error); },
      projectRef: slot.projectRef,
      paths: () => slot.root ?? {},
      setProject: p => { slot.projectRef.current = p; if (slot === active) ports.publishProject(p); }
    });
    slots.push(slot);
    return slot;
  };
  active = create(undefined, ports.initialProject, 'active');
  const isActive = (slot: WorkspaceSlot) => slot === active;
  const captureScope = (slot = active) => {
    const generation = slot.generation;
    return () => !closing && isActive(slot) && slot.lifecycle === 'active' && !slot.readonly && generation === slot.generation;
  };
  const capture = (slot: WorkspaceSlot) => ({ folderPath: slot.root?.folderPath, binding: slot.root?.binding,
    content: slot.adapter.owner.captureRecoveryContent(), view: slot.view });
  const requestOpen = async (path: string, load: (slot: WorkspaceSlot, root: WorkspaceRootObservation) => Promise<FolderScanPayload | undefined>, options?: { requireNew?: boolean }) => {
    if (closing) throw new Error('Close capture freezes workspace opening');
    if (opening) throw new Error('Workspace handoff already in progress');
    opening = true;
    const origin = active;
    let frozen = false;
    try {
      // No scanning/derived writes before physical alias discovery.
      const root = await ports.observe(path);
      const held = slots.find(s => s.root?.binding === root.binding);
      if (held && options?.requireNew) throw new Error('Create destination already belongs to a held workspace');
      if (held === origin) return true;
      if (origin.root) {
        frozen = true; origin.lifecycle = 'freezing'; origin.generation++; ports.revokeScope?.(origin);
        // Outside exclusive. Unstarted closures are revoked, never replayed.
        await origin.adapter.owner.suspendAssetAdmission();
        await ports.drain();
        await origin.adapter.drain();
        if (!origin.readonly) origin.view = ports.captureView(origin);
        const certificate = await ports.certifyHandoff(origin, capture(origin));
        if (!certificate) throw new Error('Original workspace retention not certified');
        origin.lifecycle = 'suspended'; origin.readonly = certificate === true;
      }
      const next = held ?? create(root, createProject('Opening workspace'), 'staging');
      let scan: FolderScanPayload | undefined;
      if (!held) {
        try { scan = await load(next, root); }
        catch (error) { next.error = error; next.lifecycle = 'failed-staging'; next.readonly = true; if (active === origin) ports.onOpenError?.(error, next); throw error; }
        if (!scan) { next.lifecycle = 'failed-staging'; next.readonly = true; const error = next.error ?? next.adapter.owner.lastError ?? new Error('Staged workspace initialization incomplete'); if (active === origin) ports.onOpenError?.(error, next); throw error; }
      }
      // One publication point. A failed B keeps its private facts, never half-publishes.
      active = next; next.lifecycle = 'active'; next.generation++;
      if (!next.readonly) next.adapter.owner.resumeAssetAdmission();
      ports.publishProject(next.projectRef.current);
      ports.publishActive(next, scan);
      return true;
    } catch (error) {
      origin.lifecycle = 'active';
      // Freeze is irreversible for old closures. Failure leaves held content visible,
      // protected, with the original Owner epoch/required persistence untouched.
      if (origin.root && frozen) origin.readonly = true;
      throw error;
    } finally { opening = false; }
  };
  const submitAssetIntent = <T,>(slot: WorkspaceSlot, assetId: string, bytes: Uint8Array, run: () => Promise<T>) => {
    if (!slot.root) return Promise.reject(new Error('Asset intent workspace missing'));
    return slot.adapter.owner.submitAssetIntent({ workspace: slot.root.folderPath, assetId, desiredBytes: bytes }, async () => {
      const result = await run();
      if (isCancelledBeforeEffect(result)) return result;
      // Fixed original adapter/ref/root; no late recapture of active B.
      if (!await slot.adapter.owner.persistAdmittedAssets()) throw new Error('Admitted asset required persistence incomplete');
      return result;
    });
  };
  const wholeCapture = () => {
    if (active.root && !active.readonly) active.view = ports.captureView(active);
    return { activeBinding: active.root?.binding, slots: slots.filter(s => s.root).map(s => ({ ...capture(s), ...s.view as object, lifecycle: s.lifecycle, readonly: s.readonly, generation: s.generation })) };
  };
  const freezeForClose = async () => {
    let generation = closeGeneration;
    if (!closing) {
      if (opening) throw new Error('Close capture cannot interrupt workspace staging');
      closing = true;
      generation = ++closeGeneration;
      for (const slot of slots) { slot.generation++; ports.revokeScope?.(slot); }
      active.lifecycle = 'freezing';
      // Start outside the bitmap queue; await original producers/required ACK.
      closePreparation = (async () => {
        await Promise.all(slots.map(slot => slot.adapter.owner.suspendAssetAdmission()));
        if (generation !== closeGeneration || !closing) throw new Error('Close capture cancelled');
        await ports.drain();
        if (generation !== closeGeneration || !closing) throw new Error('Close capture cancelled');
        await Promise.all(slots.map(slot => slot.adapter.drain()));
      })();
    }
    await closePreparation;
    if (generation !== closeGeneration || !closing) throw new Error('Close capture cancelled');
    // Fresh capture on BOTH calls: Main owns the exact comparison. Never return
    // a cached first snapshot to conceal revision or History/PNG changes.
    return wholeCapture();
  };
  const cancelClose = () => {
    closeGeneration++;
    closing = false; closePreparation = undefined;
    active.lifecycle = 'active';
    if (!active.readonly) active.adapter.owner.resumeAssetAdmission();
  };
  return { isBusy: () => opening || slots.some(slot => slot.adapter.owner.isBusy()), get active() { return active; }, get closing() { return closing; }, freezeForClose, cancelClose, isActive, captureScope, requestOpen, submitAssetIntent,
    // Shared queue activity and pure staging load are transient busy. Keep them
    // in hasHiddenWork (Close must still drain), never mint a recovery latch.
    hasHiddenRecovery: () => slots.some(s => {
      if (s === active || !s.root) return false;
      const c = s.adapter.owner.captureRecoveryContent();
      return s.lifecycle === 'failed-staging' || !!s.error || !!s.adapter.owner.lastError || s.adapter.owner.recoveryRequired() ||
        !!c.retainedAssetIntents.length || !!c.desiredAssets.length || !!c.effectFacts.remainingScript ||
        !!c.effectFacts.receipt.length || !!c.effectFacts.deletions.length;
    }),
    hasHiddenWork: () => slots.some(s => s !== active && !!s.root && (s.lifecycle === 'failed-staging' || s.adapter.owner.hasUnsavedWork())),
    wholeCapture };
};
