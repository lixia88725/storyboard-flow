import ts from 'typescript';
import { readFile } from 'node:fs/promises';
import { createWorkspaceSlots } from './workspaceSlots';
import { formatWorkspaceOpenError } from './workspaceOpenErrors';
import type { createNormalSaveAppAdapter } from './normalSaveAppAdapter';

const contexts = new WeakMap<object, Record<string, any>>();

/** Bind the real adapter captured by this render, not a late active-view read. */
export function appCallerAdapterScope(bindings: Record<string, any>) {
  const adapter = bindings.renderAdapter ?? bindings.normalSaveAppAdapterRef?.current;
  const context = adapter && contexts.get(adapter) || bindings.projectRef && contexts.get(bindings.projectRef);
  return { formatWorkspaceOpenError, setFolderBrowser: () => {}, folderOpenRequestRef: context?.folderOpenRequestRef ?? { current: 0 }, ...context, ...bindings, renderAdapter: adapter ?? context?.renderAdapter };
}

/** Execute App's ACTUAL slot factory options. Only pre-existing fixture IPC/UI
 * boundaries are supplied; queue/slots/Owner/adapter/scope are production code.
 * The observation below is a fixture identity, NOT Main or a writer capability.
 * Handoff certification is fail-closed; this helper cannot certify g2/GUI/native.
 * The initial Project is the old fixture's already-loaded input, not a reader
 * implementation. Subsequent caller reads use the actual slot adapter/load. */
export async function createAppRootActor(ports: Parameters<typeof createNormalSaveAppAdapter>[0], open?: {
  observeWorkspace: (folderPath: string) => Promise<{ binding: string; folderPath: string; metadataPath: string }>;
  preloaded?: boolean;
  captureView?: () => unknown;
  admitPreloaded?: (load: () => Promise<any>) => Promise<any>;
  probeOperation?: boolean;
  publishScan?: (scan: any, project: any) => void;
  setStatus?: (status: string) => void;
}) {
  const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
  const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'createWorkspaceSlots') expressions.push(node.arguments[0].getText(tree));
    ts.forEachChild(node, visit);
  }; visit(tree);
  if (expressions.length !== 1) throw new Error('Exactly one App slot factory required');
  const initial = ports.projectRef.current, paths = ports.paths();
  if (!paths.folderPath || !paths.metadataPath) throw new Error('Root fixture requires explicit paths');
  // Preserve the fixture's original queue, including old-I/O ordering.
  if (!('drain' in ports.queue) || typeof ports.queue.drain !== 'function') throw new Error('Root fixture requires the real drainable queue');
  const queuePort = ports.queue;
  const workspaceSlotsRef: {current?: ReturnType<typeof createWorkspaceSlots>} = {};
  let recoveryMessage: string | undefined;
  const recovery = { get current() { return recoveryMessage; }, set current(message: string | undefined) { recoveryMessage = message; if (message) ports.onImportRecoveryRequired?.(message); } };
  const noUI = () => {};
  const callbacks = {
    assertAdmission: () => ports.assertAdmission?.(), onError: ports.onError, onSave: ports.onSave,
    onPendingPublication: (result: any) => ports.onPendingPublication?.(result),
    captureSaveStatus: () => ports.captureSaveStatus?.() ?? noUI
  };
  const bindings = {
    activeViewProjectRef: ports.projectRef, workspaceSlotsRef,
    setProject: (p: typeof initial) => { ports.projectRef.current = p; ports.setProject(p); },
    window: { storyboard: Object.assign(ports.api(), { observeWorkspace: open?.observeWorkspace ?? (async (folderPath: string) => ({ binding: `fixture-observation:${folderPath}`, folderPath, metadataPath: paths.metadataPath! })) }) },
    aiApplyWorkspaceIdentityRef: { current: {} }, scriptImportCheckIdRef: { current: 0 },
    bitmapLayerWriteQueueRef: { current: queuePort },
    captureSlotView: open?.captureView ?? (() => { throw new Error('Fixture cannot supply mounted History/canvas capture'); }),
    normalSaveAppAdapterRef: { current: undefined },
    publishNormalSaveFolderScan: open?.publishScan ?? noUI,
    restoreHistoryData: () => { throw new Error('Fixture cannot restore held History'); },
    selectedShotIdsRef: { current: [] }, dirtyShotIdsRef: { current: new Set<string>() },
    folderPathRef: { current: paths.folderPath }, metadataPathRef: { current: paths.metadataPath },
    setFolderPath: noUI, setMetadataPath: noUI, setFolderInputValue: noUI, setSelectedShotIds: noUI,
    setFileNameSyncState: noUI, fileNameSyncStateRef: { current: 'synced' },
    setWorkspaceSaveState: noUI, workspaceSaveStateRef: { current: 'saved' },
    workspaceRecoveryRequiredRef: recovery, setStatus: open?.setStatus ?? noUI, setWorkspaceTask: noUI,
    formatWorkspaceOpenError,
    normalSaveAppCallbacksRef: { current: callbacks },
    setAutosaveError: noUI, autosaveErrorReducer: (v: unknown) => v, setSaveErrorDialog: noUI,
    rebasePendingHistory: (...args: any[]) => ports.onSaveNamespace?.({before:args[0],after:args[1],ids:args[2],update:args[3]}),
    crypto: { randomUUID: ports.freshToken }
  };
  const options = new Function(...Object.keys(bindings), ts.transpile(`return (${expressions[0]});`, {target:ts.ScriptTarget.ES2022}))(...Object.values(bindings));
  // Observe the actual operation's private failed slot; invoke the actual App
  // handler unchanged. This fixture ref probes operation B, not active view A.
  let failedOperation: import('./workspaceSlots').WorkspaceSlot | undefined;
  const onOpenError = options.onOpenError;
  options.onOpenError = (error: unknown, slot: import('./workspaceSlots').WorkspaceSlot) => { if (open?.probeOperation) failedOperation = slot; onOpenError(error, slot); };
  // CertifyHandoff remains the actual App port and lacks native certification.
  const slots = createWorkspaceSlots(options); workspaceSlotsRef.current = slots;
  // A source-bound first open starts with App's unrooted slot. It must observe
  // and read through the actual caller; never pre-load or manufacture a Root.
  if (!open || open.preloaded) await slots.requestOpen(paths.folderPath, async slot => {
    const load = async () => { slot.projectRef.current = initial; return {folderPath:paths.folderPath!,metadataPath:paths.metadataPath!,folderName:'Fixture',images:[],project:initial}; };
    return open?.admitPreloaded ? open.admitPreloaded(load) : load();
  });
  const slot = slots.active;
  // The old fixture's external view ref now follows the PRIVATE current slot ref.
  Object.defineProperty(ports.projectRef, 'current', { configurable:true, get:()=>(failedOperation ?? slots.active).projectRef.current, set:p=>{(failedOperation ?? slots.active).projectRef.current=p;} });
  const operationRecoveryRef = { get current() { return (failedOperation ?? slots.active).recoveryMessage; } };
  const context = { workspaceSlotsRef, folderOpenRequestRef: { current: 0 }, renderSlot:slot, renderAdapter:slot.adapter, slot, operationRecoveryRef, document: { getElementById: () => null } };
  contexts.set(slot.adapter,context); contexts.set(ports.projectRef,context);
  return slot.adapter;
}
