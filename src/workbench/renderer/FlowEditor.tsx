import { createPaintInputGate, createPaintPresentation } from '../../drawing/renderer/paintPresentation';
import { paintPresentationCanvas } from '../../drawing/renderer/paintPresentationCanvas';
import { canContinuePaint } from './paintAdmission';
import { useFolderStatus } from './useFolderStatus';
import {Workbench} from './Workbench';
import {CanvasPresentationContext} from '../../drawing/renderer/canvasPresentation';
import type { SelectionTransformIntent } from '../../drawing/renderer/selectionTransform';
import type { FlowSelection } from '../../platform/contracts/flowSelection';
import { selectShots, nextSelectionAnchor, selectAllShots } from '../../storyboard/renderer/boardSelection';
import { pendingDeleteDecision } from '../../storyboard/renderer/pendingSelection';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import type { FlowEditorBootstrap, FlowProjectTarget, FlowRecentProject } from '../../platform/contracts/flowEditor';
import type { FlowBoardCommand, FlowPendingAdd, FlowSession, FlowSessionRequest } from '../../platform/contracts/flowWave2';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';
import { createFlowSession } from '../../session/core';
import { toolPlan } from '../../session/core/pixelTools';
import { createPixelTools, createFlowPixels } from '../../drawing/renderer';
import { MediaSourceContext, type MediaSource } from '../../drawing/renderer/mediaSource';
import { SketchPad } from '../../drawing/renderer/SketchPad';
import { BrushPanel, brushSizeShortcutDelta, nextBrushSize } from '../../drawing/renderer/brushPanel';
import { preferenceFor, readBrushPreferences, strokeBrushFor, withPreference, writeBrushPreferences } from '../../drawing/renderer/brushPresets';
import { LayerPanel } from '../../drawing/renderer/LayerPanel';
import {DialogueBlocks} from '../../storyboard/renderer/dialogueBlocks';
import {createDialogueCommitState, type DialogueCommitState, type DialogueEditState} from '../../storyboard/renderer/dialogueCommitState';
import { WorkspaceToolRail } from './workspace/WorkspaceToolRail';
import { createController, TOOL_KEYS as TOOL_SHORTCUT_KEYS } from './toolShortcuts';
import { ChevronDown, FolderClosed, FolderInput, Undo2, Redo2, Save } from 'lucide-react';
import { ProjectLauncher } from './ProjectLauncher';
import { CreateProjectSheet } from './CreateProjectSheet';
import { ProjectNamingBar } from './ProjectNamingBar';
import { useCreateProject } from './useCreateProject';
import { useProjectNaming } from './useProjectNaming';
import { PendingAddAction } from './PendingAddAction';
import { hasUnsettledMountedGesture } from '../../drawing/renderer/mountedCanvasRecoveryCapture';
import { projectShots, pixelStroke, settledStrokePreview } from './adapter';
import type { Shot } from '../../drawing/contracts/types';
import '../../storyboard/renderer/flowPending.css';

const required = <T,>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message); return r.value;
};
const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };

function bindEditor(sessionId: string) {
  const api = window.flowEditor!;
  const preview: { accept?: (id:string,png:Uint8Array)=>void } = {};
  return {
    preview,
    read: (id: string) => api.read(sessionId, id),
    put: async (input: Parameters<typeof api.put>[1]) => {
      const result=await api.put(sessionId,input);
      if(result.ok && preview.accept){
        try { preview.accept(result.value.assetId,input.png); }
        catch { /* Presentation falls back to the normal depot read. */ }
      }
      return result;
    },
    checkpoint: (project: FlowEditorBootstrap['project']) => api.checkpoint(sessionId, project),
    refresh: (project: FlowEditorBootstrap['project']) => api.refresh(sessionId, project),
    folderStatus: (request: Parameters<typeof api.folderStatus>[1]) => api.folderStatus(sessionId, request),
    outputNames: (project: FlowEditorBootstrap['project']) => api.outputNames(sessionId, project),
    saveTiff: (project: FlowEditorBootstrap['project']) => api.saveTiff(sessionId, project),
    pendingAdd: (project: ProjectV1, request: FlowPendingAdd & { recover: boolean }) => api.pendingAdd(sessionId, project, request)
  };
}
type EditorOwner = { paintInput: ReturnType<typeof createPaintInputGate>; flow: FlowSession; sessionId: string; api: ReturnType<typeof bindEditor>; folderName: string };
type TransitionResult = 'opened' | 'unchanged' | { error: string };
export function FlowEditor() {
  const [owner, setOwner] = useState<EditorOwner>();
  const current = useRef<EditorOwner | undefined>(undefined);
  const [issue, setIssue] = useState('');
  const [switching, setSwitching] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);
  const [recent, setRecent] = useState<FlowRecentProject[]>([]);
  const [currentRecentId, setCurrentRecentId] = useState<string | null>(null);
  const gestures = useRef(0);
  const outputWork = useRef<Promise<void> | undefined>(undefined);
  const switchWork = useRef<Promise<TransitionResult> | undefined>(undefined);
  const closing = useRef(false);
  // The active editor registers its naming draft here. A project transition must collect
  // those values before freeze; closing must do the same.
  const beforeTransition = useRef<() => Promise<void>>(() => Promise.resolve());
  // Dialogue composition and host-owned commits live here so the close/open path can read them
  // synchronously; an editor unmounting never marks its text as saved.
  const dialogueCommits = useRef(createDialogueCommitState());
  const assertSettledGesture = () => {
    if (gestures.current || hasUnsettledMountedGesture()) throw Error('Finish the current stroke first');
    if (dialogueCommits.current.busy()) throw Error('Finish the current dialogue input first');
  };
  const install = ({ project, sessionId, folderName }: FlowEditorBootstrap) => {
    const api = bindEditor(sessionId);
    const flow = required(createFlowSession({ project, sessionId, incarnation: crypto.randomUUID(),
      maxHistoryEntries: 60, maxPendingRequests: 32, assets: api,
      pixels: createFlowPixels({ maxPixels: 32_000_000, maxPngBytes: 64 * 1024 * 1024, maxPoints: 100_000 }),
      tools: createPixelTools({ maxPixels: 32_000_000, maxPngBytes: 64 * 1024 * 1024, maxLayers: 64 }),
      checkpoint: api.checkpoint, refresh: api.refresh, pendingAdd: api.pendingAdd,
      clock: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: h => window.clearTimeout(h as number), now: () => performance.now() } }));
    const next = { flow, api, sessionId, folderName, paintInput: createPaintInputGate() };
    current.current = next; setOwner(next); setIssue('');
    beforeTransition.current = () => Promise.resolve();
    dialogueCommits.current.reset();
    void flow.request({ kind: 'checkpoint' }).then(result => { if (current.current === next && !result.ok) setIssue(result.error.message); });
  };
  const refreshRecent = async () => {
    try {
      const state = await window.flowEditor!.launcherState();
      setRecent(state.recent);
      setCurrentRecentId(state.currentId);
    } catch { /* keep the last known list */ }
  };
  const removeRecent = async (id: string) => {
    try { await window.flowEditor!.removeRecent(id); await refreshRecent(); }
    catch (error) { setIssue(String(error)); }
  };
  const relocateRecent = async (id: string) => {
    try {
      const result = await window.flowEditor!.relocateRecent(id);
      if ('canceled' in result) return;
      if (!result.ok) { setIssue(result.message); return; }
      setIssue('');
      await refreshRecent();
    } catch (error) { setIssue(String(error)); }
  };
  const resume = async (owner: EditorOwner) => {
    // A failed checkpoint leaves Session in `freezing`; finish that fence before
    // resuming. Never open the presentation gate against a frozen Session.
    if (owner.flow.snapshot().phase === 'freezing') required(await owner.flow.request({ kind: 'freeze' }));
    if (owner.flow.snapshot().phase === 'frozen') required(await owner.flow.request({ kind: 'resume' }));
    owner.paintInput.resume();
  };
  const openProject = (target: FlowProjectTarget): Promise<TransitionResult> => {
    if (switchWork.current) return Promise.resolve({ error: '项目正在切换，请稍候' });
    if (closing.current || !current.current) return Promise.resolve({ error: '项目尚未打开' });
    const previous = current.current;
    previous.paintInput.pause();
    setSwitching(true);
    const work = (async (): Promise<TransitionResult> => {
      try {
        assertSettledGesture();
        await beforeTransition.current();
        while (outputWork.current) await outputWork.current;
        assertSettledGesture();
        const frozen = required(await previous.flow.request({ kind: 'freeze' }));
        previous.paintInput.assertSettled();
        assertSettledGesture();
        const next = await window.flowEditor!.switchProject(previous.sessionId, frozen.snapshot.project, target);
        if (next) { install(next); void refreshRecent(); return 'opened'; }
        await resume(previous); setIssue(''); return 'unchanged';
      } catch (error) {
        let message = error instanceof Error ? error.message : String(error);
        if (current.current === previous) {
          try { await resume(previous); }
          catch (resumeError) { message += '；输入仍暂停，请重试关闭项目：' + String(resumeError); }
        }
        setIssue(message);
        return { error: message };
      } finally { setSwitching(false); }
    })();
    switchWork.current = work;
    void work.finally(() => { if (switchWork.current === work) switchWork.current = undefined; });
    return work;
  };
  const launch = async (target: FlowProjectTarget): Promise<TransitionResult> => {
    if (owner || launchBusy) return { error: '项目已经打开' };
    setLaunchBusy(true); setIssue('');
    try {
      const result = await window.flowEditor!.launch(target);
      if (result.canceled) return 'unchanged';
      install(result.bootstrap);
      void refreshRecent();
      return 'opened';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setIssue(message);
      return { error: message };
    } finally { setLaunchBusy(false); }
  };
  useEffect(() => {
    const api = window.flowEditor!;
    let cancelled = false;
    void (async () => {
      try {
        const state = await api.launcherState();
        if (cancelled) return;
        setRecent(state.recent);
        if (state.open) {
          const value = await api.open();
          if (!cancelled) { install(value); void refreshRecent(); }
        }
      } catch (error) { if (!cancelled) setIssue(String(error)); }
    })();
    const off = api.onClose(id => { void (async () => {
      if (closing.current) return;
      closing.current = true;
      current.current?.paintInput.pause();
      let owner: EditorOwner | undefined;
      try {
        if (switchWork.current) await switchWork.current;
        owner = current.current;
        if (!owner) throw Error('Project is still opening');
        owner.paintInput.pause();
        assertSettledGesture();
        await beforeTransition.current();
        while (outputWork.current) await outputWork.current;
        assertSettledGesture();
        const result = required(await owner.flow.request({ kind: 'freeze' }));
        // The freeze itself can reject a commit that was admitted just before it (the session
        // leaves `active`), so a new obligation may appear while we await it. Never certify the
        // closed project with unconfirmed dialogue text: refuse and resume instead.
        assertSettledGesture();
        owner.paintInput.assertSettled();
        const closed = await api.finishClose(owner.sessionId, id, result.snapshot.project);
        if (!closed.ok) throw Error(closed.message);
      } catch (error) {
        setIssue(String(error));
        try { await api.finishClose(owner?.sessionId ?? '', id, null); }
        catch (closeError) { setIssue('关闭确认失败：' + String(closeError)); }
        try { if (owner) await resume(owner); }
        catch (resumeError) { setIssue('输入仍暂停，请重试关闭项目：' + String(resumeError)); }
        finally { closing.current = false; }
      }
    })(); });
    return () => { cancelled = true; off(); };
  }, []);
  useEffect(() => {
    if (!owner) return;
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [owner]);
  return owner
    ? <Editor key={owner.sessionId} paintInput={owner.paintInput} flow={owner.flow} api={owner.api} folderName={owner.folderName} sessionId={owner.sessionId} openProject={openProject} switching={switching}
        issue={issue} setIssue={s => { if (current.current === owner) setIssue(s); }} gestures={gestures} outputWork={outputWork} dialogueCommits={dialogueCommits}
        beforeTransition={beforeTransition} recent={recent} currentRecentId={currentRecentId} onRemoveRecent={removeRecent} onRelocateRecent={relocateRecent} />
    : <ProjectHome recent={recent} busy={launchBusy} issue={issue} launch={launch} onRemoveRecent={removeRecent} onRelocateRecent={relocateRecent} />;
}
function ProjectHome({ recent, busy, issue, launch, onRemoveRecent, onRelocateRecent }: {
  recent: FlowRecentProject[]; busy: boolean; issue: string;
  launch: (target: FlowProjectTarget) => Promise<TransitionResult>;
  onRemoveRecent: (id: string) => Promise<void>; onRelocateRecent: (id: string) => Promise<void>;
}) {
  const create = useCreateProject(launch);
  return <>
    <ProjectLauncher recent={recent} busy={busy || create.state?.phase === 'creating'} message={issue}
      onCreate={() => void create.begin()} onOpen={() => void launch({ kind: 'dialog' })}
      onOpenRecent={id => void launch({ kind: 'recent', id })} onRemoveRecent={onRemoveRecent} onRelocateRecent={onRelocateRecent} />
    {create.state && <CreateProjectSheet key={create.state.draft.id} state={create.state} busy={busy}
      onChooseSource={kind => void create.chooseSource(kind)} onChooseDestination={() => void create.chooseDestination()}
      onConfirm={fields => void create.confirm(fields)} onCancel={() => void create.cancel()}
      onAbort={() => void create.abort()} onRespond={decision => void create.respond(decision)} onError={create.setError} />}
  </>;
}
function Editor({ paintInput, flow, api, folderName, sessionId, openProject, switching, issue, setIssue, gestures, outputWork, dialogueCommits, beforeTransition, recent, currentRecentId, onRemoveRecent, onRelocateRecent }: {
  paintInput: ReturnType<typeof createPaintInputGate>; api: ReturnType<typeof bindEditor>; folderName: string; sessionId: string; openProject: (target: FlowProjectTarget) => Promise<TransitionResult>; switching: boolean;
  outputWork: { current: Promise<void> | undefined }; flow: FlowSession; issue: string; setIssue: (s: string) => void; gestures: { current: number };
  dialogueCommits: { current: DialogueCommitState };
  beforeTransition: { current: () => Promise<void> }; recent: FlowRecentProject[]; currentRecentId: string | null;
  onRemoveRecent: (id: string) => Promise<void>; onRelocateRecent: (id: string) => Promise<void>;
}) {
  const [demand,setDemand]=useState<string[]>([]);
  const demandRef=useRef(demand);demandRef.current=demand;
  const requestAssets=useCallback((ids:string[])=>setDemand(old=>JSON.stringify(old)===JSON.stringify(ids)?old:ids),[]);
  const [snapshot, setSnapshot] = useState(() => flow.snapshot());
  const [layers, setLayers] = useState<Record<string, string>>({});
  const [selection, setSelection] = useState<string[]>(snapshot.project.shots[0] ? [snapshot.project.shots[0].id] : []);
  const selectionAnchor = useRef<string | undefined>(snapshot.project.shots[0]?.id);
  const selectedIds = snapshot.project.shots.filter(s => selection.includes(s.id)).map(s => s.id);
  const focusShot = (id: string) => { setSelection([id]); selectionAnchor.current = id; };
  // Pending is its own table: same gestures and the same helpers, its own order and anchor.
  // It never merges with the board selection and never opens the canvas.
  const [pendingSelection, setPendingSelection] = useState<string[]>([]);
  const pendingAnchor = useRef<string | undefined>(undefined);
  const parkedOrder = () => flow.snapshot().project.parkedShots.map(s => s.id);
  const pendingSelected = snapshot.project.parkedShots.filter(s => pendingSelection.includes(s.id)).map(s => s.id);
  const selectPending = (id: string, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    if (!active) return;
    const order = parkedOrder(), anchor = pendingAnchor.current;
    setPendingSelection(current => selectShots(order, current, anchor, id, event));
    pendingAnchor.current = nextSelectionAnchor(order, anchor, id, event);
  };
  const selectShot = (id: string, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    const order = flow.snapshot().project.shots.map(s => s.id), anchor = selectionAnchor.current;
    setSelection(current => selectShots(order, current, anchor, id, event));
    selectionAnchor.current = nextSelectionAnchor(order, anchor, id, event);
  };
  const [refreshing,setRefreshing]=useState(false),[refreshRecovery,setRefreshRecovery]=useState(false);
  const [savingTiff, setSavingTiff] = useState(false);
  const flowSaved = snapshot.checkpoint?.revision === snapshot.project.revision && !snapshot.pending;
  const folderStatus = useFolderStatus(snapshot.project, flowSaved, savingTiff || refreshing, api.folderStatus);
  const [tool, setTool] = useState<'brush' | 'eraser' | 'blur' | 'select'>('brush');
  // Photoshop-style tool keys: B/E/L/K, plus the spring-loaded eraser on E.
  const toolRef = useRef(tool);
  toolRef.current = tool;
  const shortcutRef = useRef<ReturnType<typeof createController>>(undefined);
  useEffect(() => {
    const controller = createController({
      current: () => toolRef.current,
      // Keep the ref and the state in step: two keys pressed before React renders must not
      // both read the previous tool.
      apply: next => { toolRef.current = next; setTool(next); },
      isBlocked: () => {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
        if (outputRef.current || savingTiffRef.current || pausedRef.current) return true;
        // A live lasso/transform gesture owns the pointer; the eraser must not reinterpret it.
        return toolRef.current === 'select' && hasUnsettledRef.current();
      }
    });
    shortcutRef.current = controller;
    const onKeyDown = (event: KeyboardEvent) => {
      const mapped = TOOL_SHORTCUT_KEYS[event.key.toLowerCase()];
      // Brush and eraser must stay available while a stroke is in flight; lasso and blur
      // are ordinary selections and keep the existing settlement gate.
      if (mapped === 'select' && !canNavigateRef.current()) return;
      if (event.key.toLowerCase() === 'k' && !canNavigateRef.current()) return;
      if (controller.keyDown(event) !== 'ignored') event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => { controller.keyUp(event); };
    const onBlur = () => { controller.blur(); };
    const onHide = () => { if (document.visibilityState === 'hidden') controller.blur(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHide);
      controller.dispose();
      shortcutRef.current = undefined;
    };
  }, []);
  const canNavigateRef = useRef<() => boolean>(() => false);
  const outputRef = useRef(false);
  const savingTiffRef = useRef(false);
  const pausedRef = useRef(false);
  const hasUnsettledRef = useRef<() => boolean>(() => false);
  const [color, setColor] = useState('#dd3344');
  const pixelSelections = useRef<Record<string, FlowSelection>>({});
  const bitmapSelectionChange = useCallback((shotId: string, layerId: string | undefined, points: FlowSelection | undefined) => {
    for(const key of Object.keys(pixelSelections.current))if(key.startsWith(`${shotId}/`))delete pixelSelections.current[key];
    if(layerId && points)pixelSelections.current[`${shotId}/${layerId}`]=points.map(p=>({...p}));
  },[]);
  const [blurRadius,setBlurRadius]=useState(8);
  // Brush preferences are a tool preference of this machine's user: they never enter the
  // project, and each preset keeps its own size and opacity.
  const [brushPreferences, setBrushPreferences] = useState(readBrushPreferences);
  const [brushPanel, setBrushPanel] = useState<{x:number;y:number}|undefined>();
  useEffect(()=>{ writeBrushPreferences(brushPreferences); },[brushPreferences]);
  // The rail's size field always edits the preset the current tool is using.
  const activePresetId = tool==='eraser' ? brushPreferences.eraser : brushPreferences.brush;
  const activePresetValue = preferenceFor(brushPreferences, activePresetId);
  const setActiveSize = (size:number)=>setBrushPreferences(p=>withPreference(p, tool==='eraser'?p.eraser:p.brush, {size}));
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      const delta=brushSizeShortcutDelta(event);
      if(delta===undefined)return;
      event.preventDefault();
      setBrushPreferences(p=>{
        const id=tool==='eraser'?p.eraser:p.brush;
        return withPreference(p,id,{size:nextBrushSize(preferenceFor(p,id).size,delta)});
      });
    };
    window.addEventListener('keydown',onKey);
    return ()=>window.removeEventListener('keydown',onKey);
  },[tool]);
  const [opacityPreview, setOpacityPreview] = useState<Record<string, number>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const disposed = useRef(false);
  const cache = useMemo(() => new Map<string, string>(), []);
  const loads = useMemo(() => new Map<string, Promise<string>>(), []);
  useEffect(() => {
    const unsubscribe = flow.subscribe(() => { paintPresentation.observe(); setSnapshot(flow.snapshot()); });
    // A fast initial checkpoint can finish between render and effect subscription.
    setSnapshot(flow.snapshot());
    return unsubscribe;
  }, [flow]);
  const rememberUrl = (id:string, bytes:Uint8Array) => {
    const existing=cache.get(id);if(existing)return existing;
    const url=URL.createObjectURL(new Blob([new Uint8Array(bytes)],{type:'image/png'}));
    cache.set(id,url);
    for(const [old,held] of cache){if(cache.size<=96)break;if(!demandRef.current.includes(old)&&old!==id){URL.revokeObjectURL(held);cache.delete(old);}}
    setUrls(Object.fromEntries(cache));return url;
  };
  // The pixels just accepted by the depot are already here. Make their URL available
  // before Session announces that layer's new id, so neither surface drops its image.
  useEffect(()=>{
    api.preview.accept=rememberUrl;
    return()=>{delete api.preview.accept;};
  },[api,cache]);
  const source = async (id: string): Promise<string> => {
    if (cache.has(id)) return cache.get(id)!;
    if (!loads.has(id)) loads.set(id, api.read(id).then(result => {
      if (disposed.current) throw Error('Editor session retired');
      return rememberUrl(id,required(result));
    }).finally(() => loads.delete(id)));
    return loads.get(id)!;
  };
  useEffect(() => {
    const ids=demand;
    for(const id of new Set(ids))void source(id).catch(error=>setIssue(String(error)));
  }, [snapshot.project, demand]);
  useEffect(() => { disposed.current = false; return () => { disposed.current = true; for (const url of cache.values()) URL.revokeObjectURL(url); }; }, [cache]);
  const media: MediaSource = useMemo(() => ({ assetUrl: id => urls[id] ?? '', layerAssetUrl: ({ bitmapPath }) => urls[bitmapPath.split('/').at(-1)!] ?? '' }), [urls]);
  const paintPresentation = useMemo(() => createPaintPresentation({
    inputGate: paintInput,
    identity: { projectId: flow.snapshot().project.id, sessionId },
    raster: paintPresentationCanvas(source),
    current: (shotId, layerId) => {
      const project = flow.snapshot().project, shot = project.shots.find(s => s.id === shotId);
      const image = shot && project.images[shot.imageId], layer = image?.layers.find(l => l.id === layerId);
      return shot && image && layer && layer.visible && !layer.locked
        ? { shotId, imageId: image.id, layerId, assetId: layer.assetId, width: image.width, height: image.height } : undefined;
    },
    commit: async (target, stroke) => {
      const result = await flow.request({kind:'paint', shotId:target.shotId, layerId:target.layerId, stroke:pixelStroke(stroke)});
      if (!result.ok) throw result.error;
      const shot = result.value.snapshot.project.shots.find(s => s.id === target.shotId)!;
      const layer = result.value.snapshot.project.images[shot.imageId].layers.find(l => l.id === target.layerId)!;
      return { assetId: layer.assetId, revision: result.value.snapshot.project.revision };
    },
    report: setIssue,
  }), [flow]);
  useEffect(() => paintInput.connect(paintPresentation.assertSettled), [paintInput, paintPresentation]);
  useEffect(() => () => paintPresentation.dispose(), [paintPresentation]);
  const otherRequests = useRef(0);
  const request = async (r: FlowSessionRequest, settlingGesture=false) => {
    if(gestures.current && !settlingGesture)throw Error('Finish the current layer gesture first');
    const other = r.kind !== 'paint';
    if (other) otherRequests.current++;
    try {
      const run = async () => required(await flow.request(r));
      const changesPixels = r.kind !== 'paint' && r.kind !== 'board' && r.kind !== 'checkpoint' && r.kind !== 'freeze' && r.kind !== 'resume';
      const result = changesPixels ? await paintPresentation.barrier(run) : await run();
      setIssue(''); return result;
    } catch (error) { setIssue(String(error)); throw error; }
    finally { if (other) otherRequests.current--; }
  };
  const act = (r: FlowSessionRequest) => { void request(r).catch(() => {}); };
  const [dialogueBusy, setDialogueBusy] = useState(false);
  // Bumped only after a successful history step: dialogue drafts adopt the restored text.
  const [authority, setAuthority] = useState(0);
  const naming = useProjectNaming(snapshot.project, async draft => {
    await request({ kind: 'board', command: { kind: 'setProjectNaming', name: draft.name, naming: draft.naming } });
    // The recent label follows the project name; its root and identity do not change.
    await window.flowEditor!.updateRecentName(sessionId, draft.name).catch(() => {});
  });
  useEffect(() => {
    beforeTransition.current = async () => { await naming.flush(); await paintPresentation.settle(); };
    return () => { beforeTransition.current = () => Promise.resolve(); };
  }, [beforeTransition, naming.flush, paintPresentation]);
  const create = useCreateProject(openProject);
  // Response-tracked identity, not a render-time read of the state object: several editors can
  // be busy at once, so the held set (not a single shot) decides which cards stay mounted.
  const [dialogueHoldShots, setDialogueHoldShots] = useState<string[]>([]);
  // One aggregate flag keeps per-keystroke state churn out of this render path.
  const refreshDialogueBusy = () => {
    const busy = dialogueCommits.current.busy();
    setDialogueBusy(current => (current === busy ? current : busy));
    const hold = dialogueCommits.current.holdShots();
    setDialogueHoldShots(current => (current.join("\n") === hold.join("\n") ? current : hold));
  };
  const reportDialogueEdit = useCallback((id: string, state: DialogueEditState | null) => {
    dialogueCommits.current.report(id, state);
    refreshDialogueBusy();
  }, [dialogueCommits]);
  // One obligation per setDialogues request. A rejection keeps Close refused until a later
  // commit succeeds; unmounting the editor releases nothing.
  const commitDialogue = (command: FlowBoardCommand, owner: string) => {
    if (command.kind !== 'setDialogues') return request({ kind: 'board', command });
    const id = dialogueCommits.current.begin(command.shotId, owner);
    refreshDialogueBusy();
    return request({ kind: 'board', command }).then(
      outcome => { dialogueCommits.current.settle(id, true); refreshDialogueBusy(); return outcome; },
      error => { dialogueCommits.current.settle(id, false); refreshDialogueBusy(); throw error; }
    );
  };
  const inputUnsettled = () => dialogueBusy || dialogueCommits.current.busy();
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if(outputWork.current||gestures.current)return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) {
        event.preventDefault(); void historyStep(event.shiftKey ? 'redo' : 'undo');
      }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [flow]);
  const shots = projectShots(snapshot.project, layers);
  // Gesture feedback only, never sent to persistence or installed as another Project.
  for (const shot of shots) for (const layer of shot.layers ?? []) {
    const preview = opacityPreview[`${shot.id}/${layer.id}`];
    if (preview !== undefined) layer.opacity = preview;
  }
  const rejectTool = () => setIssue('This operation is not connected yet');
  const active = snapshot.phase === 'active' && !switching && !refreshing && !refreshRecovery;
  // One admission path for the textarea shortcut, the global shortcut and the rail buttons.
  const historyStep = async (kind: 'undo' | 'redo') => {
    // Reads live state: the global shortcut effect below is installed once per session.
    if (flow.snapshot().phase !== 'active' || gestures.current || outputWork.current || paintPresentation.hasDrawing()) { setIssue('Finish the current edit first'); return; }
    if (dialogueCommits.current.busy()) {
      setIssue('Finish the current dialogue input first'); return;
    }
    try { await request({ kind }); setAuthority(value => value + 1); } catch { /* request reports the failure */ }
  };
  const script = (shotId: string, text: string) => act({ kind: 'board', command: { kind: 'setScriptText', shotId, text } });
  const transformSelection = async (shot: Shot, layerId: string, _preview: string, intent?: SelectionTransformIntent) => {
    try {
      if(!intent || !active || outputWork.current)throw Error('Selection is not ready');
      const result=await request({kind:'pixelTool',shotId:shot.id,tool:{kind:'transform',layerId,expectedAssetId:intent.sourcePath.split('/').at(-1)!,selection:intent.selection,matrix:intent.matrix}});
      const image=result.snapshot.project.images[result.snapshot.project.shots.find(s=>s.id===shot.id)!.imageId];
      return settledStrokePreview(()=>flow.snapshot().project,shot.id,layerId,image.layers.find(l=>l.id===layerId)!.assetId,source);
    } catch(error){setIssue(String(error));return undefined;}
  };
  const fill = async (shot: Shot, layerId: string, point: { x: number; y: number }, color: string) => {
    try {
      const hex = color.replace('#', '');
      const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex;
      if (!/^[a-fA-F0-9]{6}$/.test(full)) throw new Error('Invalid fill color');
      const rgba = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16));
      const result = await request({ kind: 'pixelTool', shotId: shot.id, tool: { kind: 'fill', layerId, ...point, color: [rgba[0], rgba[1], rgba[2], 255], tolerance: 0 } });
      const image = result.snapshot.project.images[result.snapshot.project.shots.find(s => s.id === shot.id)!.imageId];
      return settledStrokePreview(() => flow.snapshot().project, shot.id, layerId, image.layers.find(l => l.id === layerId)!.assetId, source);
    } catch (error) { setIssue(String(error)); return undefined; }
  };
  const addLayer = async (shotId:string) => {
    const layerId=crypto.randomUUID(),shot=shots.find(s=>s.id===shotId);
    try { await request({kind:'newLayer',shotId,layerId,...(shot?.activeLayerId?{afterId:shot.activeLayerId}:{})});
      setLayers(current=>({...current,[shotId]:layerId}));
    } catch { /* request reports the failure; selection remains unchanged. */ }
  };
  const moveLayers = (shotId:string,layerIds:string[],targetLayerId:string,placement:'before'|'after') =>
    act({kind:'layer',shotId,edit:{kind:'moveLayers',layerIds,targetLayerId,placement}});
  const applyBlur = () => {
    if(!active||gestures.current||outputWork.current||flow.snapshot().pending||hasUnsettledMountedGesture()){setIssue('Finish the current edit before applying blur');return;}
    const shot=shots.find(s=>s.id===(selectedIds[0]));
    if(shot?.activeLayerId)act({kind:'pixelTool',shotId:shot.id,tool:{kind:'blur',layerId:shot.activeLayerId,radius:blurRadius,...(pixelSelections.current[`${shot.id}/${shot.activeLayerId}`] ? {selection:pixelSelections.current[`${shot.id}/${shot.activeLayerId}`]} : {})}});
  };
  const merge = (shotId: string, layerId: string, selectedIds: string[]) => {
    const project = flow.snapshot().project, shot = project.shots.find(s => s.id === shotId);
    if (!shot) return;
    const image = project.images[shot.imageId], index = image.layers.findIndex(l => l.id === layerId);
    const ids = selectedIds.length >= 2 ? selectedIds : image.layers.slice(Math.max(0, index - 1), index + 1).map(l => l.id);
    act({ kind: 'pixelTool', shotId, tool: { kind: 'merge', layerIds: ids } });
  };
  const refreshImages = () => {
    if(outputWork.current||switching||refreshing||gestures.current||hasUnsettledMountedGesture())return;
    if (inputUnsettled()) { setIssue('Finish the current dialogue input before refreshing images'); return; }
    setRefreshing(true);
    const work=(async()=>{
      try{
        const result=await paintPresentation.barrier(() => flow.request({kind:'refresh'}));
        if(!result.ok){setRefreshRecovery(result.error.effect==='unknown');throw Error(result.error.message);}
        setRefreshRecovery(false);setIssue('');
      }catch(error){setIssue(String(error));}
      finally{setRefreshing(false);}
    })();
    outputWork.current=work;void work.finally(()=>{if(outputWork.current===work)outputWork.current=undefined;});
  };
  const saveTiff = async () => {
    if (!active || savingTiff || outputWork.current) return;
    if (naming.composing) { setIssue('请先完成输入法组字，再保存'); return; }
    if (paintPresentation.hasInput() || gestures.current || hasUnsettledMountedGesture() || flow.snapshot().pending || inputUnsettled()) {
      setIssue('Finish the current edit before saving TIFF'); return;
    }
    if (naming.issue) { setIssue(naming.issue); return; }
    setSavingTiff(true);
    const work = (async () => {
      try {
        // Collect the values currently in the four fields before capturing the project.
        await naming.flush();
        await request({ kind: 'checkpoint' });
        const live = flow.snapshot();
        if (live.phase !== 'active' || live.pending || gestures.current || hasUnsettledMountedGesture())
          throw Error('Finish the current edit before saving TIFF');
        const captured = live.project;
        const receipt = required(await api.saveTiff(captured));
        if (receipt.projectId !== captured.id || receipt.revision !== captured.revision) throw Error('TIFF Save receipt mismatch');
        setIssue('');
      } catch (error) { setIssue(String(error)); throw error; }
      finally { setSavingTiff(false); }
    })();
    outputWork.current = work;
    try { await work; } finally { if (outputWork.current === work) outputWork.current = undefined; }
  };

  const newShot = () => {
    if (inputUnsettled()) { setIssue('Finish the current dialogue input before adding a shot'); return; }
    const project = flow.snapshot().project, anchor = project.shots.find(s => s.id === selectedIds[0]);
    const image = anchor ? project.images[anchor.imageId] : project.shots[0] ? project.images[project.shots[0].imageId] : undefined;
    const shotId = crypto.randomUUID();
    void request({ kind: 'newShot', shotId, imageId: crypto.randomUUID(), width: image?.width ?? 1920, height: image?.height ?? 1080,
      ...(anchor ? { afterId: anchor.id } : {}) }).then(() => focusShot(shotId)).catch(() => {});
  };
  const renderDialogue = (shotId: string, compact = false, allowDrag = false) => <DialogueBlocks shotId={shotId}
    dialogues={snapshot.project.dialogues} disabled={!active} variant={compact?'compact':'full'} autoFocus={compact}
    authority={authority} allowDrag={allowDrag}
    onSelect={()=>{if(selectedIds.length!==1||selectedIds[0]!==shotId)focusShot(shotId);}}
    onCommit={(command, owner)=>commitDialogue(command, owner)} onEditState={reportDialogueEdit}
    onUndo={()=>void historyStep('undo')} onRedo={()=>void historyStep('redo')} ariaLabel={`故事板对白 ${shotId}`}/>;
  const moveShots = (shotIds: string[], destination: 'active' | 'pending', beforeId?: string) => {
    if (!active || gestures.current || hasUnsettledMountedGesture()) {
      setIssue('Finish the current stroke before moving shots'); return;
    }
    // Moving the edited board out of the grid unmounts its dialogue editor.
    if (inputUnsettled()) { setIssue('Finish the current dialogue input before moving shots'); return; }
    act({ kind: 'board', command: { kind: 'moveShots', shotIds, destination, ...(beforeId ? { beforeId } : {}) } });
  };
  /** Deleting active boards unmounts their dialogue editors, so it needs the same gate. */
  const removeActiveShots = (shotIds: string[]) => {
    if (!active || !shotIds.length) return;
    if (inputUnsettled()) { setIssue('Finish the current dialogue input before deleting shots'); return; }
    act({ kind: 'board', command: { kind: 'removeShots', shotIds } });
  };
  // Pending deletion only. The shelf owns its own selection; active selection is untouched.
  // One snapshot, one synchronous decision, then the request: no await can slip a Restore in.
  const deletePending = (shotIds: string[]) => {
    const current = flow.snapshot();
    const decision = pendingDeleteDecision(
      { pending: current.pending, parked: current.project.parkedShots.map(shot => shot.id) }, shotIds);
    if (decision === 'empty') return;
    if (!active || savingTiff || outputWork.current || gestures.current || hasUnsettledMountedGesture()) {
      setIssue('Finish the current edit before deleting shots'); return;
    }
    // Live work may be a queued Restore, so the parked check alone would race it.
    if (decision === 'busy') { setIssue('还有操作尚未完成，请稍后重试删除'); return; }
    if (decision === 'stale') { setIssue('Pending 已发生变化，请重新选择后再删除'); return; }
    act({ kind: 'board', command: { kind: 'removeShots', shotIds } });
  };
  const renderLayers=(shot:Shot)=><LayerPanel key={shot.id} docked respectActiveLayer shot={shot}
          canMergeLayerIds={ids=>{
            const board=snapshot.project.shots.find(s=>s.id===shot.id);
            return !!board && ids.length>=2 && toolPlan(snapshot.project.images[board.imageId],{kind:'merge',layerIds:ids}).ok;
          }} folderPath="flow" thumbnailRevision={snapshot.project.revision} isOpen isRendered
          canBeginLayerGesture={()=>!paintPresentation.hasInput() && !gestures.current && !flow.snapshot().pending && !outputWork.current && flow.snapshot().phase==='active'}
          onLayerGroupOpacityGesture={(shotId,ids,delta,initial,phase)=>{
            const changes=ids.map(layerId=>({layerId,before:initial[layerId],opacity:Math.round(Math.max(0,Math.min(1,initial[layerId]+delta))*1000)/1000}));
            const clear=()=>{gestures.current=0;setOpacityPreview(current=>{const next={...current};for(const id of ids)delete next[`${shotId}/${id}`];return next;});};
            if(phase==='preview'){gestures.current=1;setOpacityPreview(current=>({...current,...Object.fromEntries(changes.map(c=>[`${shotId}/${c.layerId}`,c.opacity]))}));}
            else if(phase==='cancel')clear();
            else void request({kind:'layer',shotId,edit:{kind:'setLayerOpacities',changes}},true).catch(()=>{}).finally(clear);
          }}
          onLayerOpacityGesture={(shotId, layerId, opacity, phase) => {
            const key = `${shotId}/${layerId}`;
            const clear=()=>{gestures.current=0;setOpacityPreview(current=>{const next={...current};delete next[key];return next;});};
            if (phase === 'preview') { gestures.current = 1; setOpacityPreview(current => ({ ...current, [key]: opacity })); }
            else if (phase === 'cancel') clear();
            else void request({ kind: 'layer', shotId, edit: { kind: 'setLayer', layerId, patch: { opacity } } },true).catch(() => {}).finally(clear);
          }}
          structuralEditsEnabled={active} mergeEditsEnabled={active} onToggle={() => {}} onAddLayer={id=>{void addLayer(id);}} onRemoveLayer={(shotId,layerId)=>act({kind:'layer',shotId,edit:{kind:'removeLayer',layerId}})} onMergeLayers={merge} onMergeVisibleLayers={shotId => {
            const shot = snapshot.project.shots.find(s => s.id === shotId)!;
            act({ kind: 'pixelTool', shotId, tool: { kind: 'merge', layerIds: snapshot.project.images[shot.imageId].layers.filter(l => l.visible).map(l => l.id) } });
          }} onClearLayer={(shotId, layerId) => act({ kind: 'pixelTool', shotId, tool: { kind: 'clear', layerId } })}
          onSelectLayer={(id, layerId) => setLayers(current => ({ ...current, [id]: layerId }))}
          onUpdateLayer={(shotId, layerId, patch) => act({ kind: 'layer', shotId, edit: { kind: 'setLayer', layerId, patch } })}
          onMoveLayer={(shotId,layerId,target,placement)=>moveLayers(shotId,[layerId],target,placement)} onMoveLayerGroup={moveLayers} onSelectedLayerIdsChange={() => {}}
          onUpdateLayerGroupOpacity={(shotId, ids, delta, initial) => {
            if (ids.length !== 1) { rejectTool(); return; }
            act({ kind: 'layer', shotId, edit: { kind: 'setLayer', layerId: ids[0], patch: { opacity: Math.max(0, Math.min(1, initial[ids[0]] + delta)) } } });
          }} />;
  const editsSettled = () => !paintInput.isPaused() && active && !paintPresentation.hasInput() && !gestures.current && !flow.snapshot().pending && !hasUnsettledMountedGesture() && !inputUnsettled();
  const canNavigate = () => !outputWork.current && editsSettled();
  canNavigateRef.current = canNavigate;
  outputRef.current = !!outputWork.current;
  savingTiffRef.current = savingTiff;
  pausedRef.current = paintInput.isPaused();
  hasUnsettledRef.current = () => !!gestures.current || hasUnsettledMountedGesture() || inputUnsettled();
  // TIFF output owns its captured revision. A new brush stroke edits the live Session.
  const brushAvailable = () => active && tool === 'brush' && (!outputWork.current || savingTiff) && !gestures.current;
  const canStartCanvasEdit = () => (!outputWork.current || brushAvailable()) && editsSettled();
  const closeMenu = (event: { currentTarget: HTMLElement }) => {
    const menu = event.currentTarget.closest('details');
    if (menu instanceof HTMLDetailsElement) menu.open = false;
  };
  const [addAnchor, setAddAnchor] = useState<HTMLSpanElement | null>(null);
  const dialogueText=new Map<string,string>();
  for(const d of snapshot.project.dialogues){const text=d.text.trim();if(text)dialogueText.set(d.shotId,[dialogueText.get(d.shotId),text].filter(Boolean).join(' ').replace(/\s+/g,' '));}
  const presentations=Object.fromEntries([...snapshot.project.shots,...snapshot.project.parkedShots].filter(s=>s.presentation).map(s=>[s.id,{...s.presentation!,text:dialogueText.get(s.id)??''} ]));
  return <MediaSourceContext.Provider value={media}><CanvasPresentationContext.Provider value={presentations}>
    <Workbench dialogueText={dialogueText} name={snapshot.project.name} shots={shots.slice(0,snapshot.project.shots.length)} parked={shots.slice(snapshot.project.shots.length)} selected={selectedIds} revision={snapshot.project.revision} disabled={!active}
      status={issue || (flowSaved
        ? '已自动暂存 · ' + (savingTiff ? '正在更新文件夹中的故事板…' : folderStatus.label)
        : (snapshot.lastError?.message || '正在自动暂存…'))}
      projectBar={<ProjectNamingBar naming={naming} folderName={folderName} disabled={!active || savingTiff} />}
      select={selectShot} focus={focusShot}
      selectAll={()=>{const ids=selectAllShots(flow.snapshot().project.shots.map(s=>s.id));setSelection(ids);selectionAnchor.current=undefined;}}
      selectMany={ids=>{const known=new Set(ids),next=flow.snapshot().project.shots.map(s=>s.id).filter(id=>known.has(id));setSelection(next);selectionAnchor.current=next[0];}}
      clearSelection={()=>{setSelection([]);selectionAnchor.current=undefined;}}
      pendingSelected={pendingSelected} selectPending={selectPending}
      selectManyPending={ids=>{const known=new Set(ids),next=parkedOrder().filter(id=>known.has(id));setPendingSelection(next);pendingAnchor.current=next[0];}}
      selectAllPending={()=>{setPendingSelection(selectAllShots(parkedOrder()));pendingAnchor.current=undefined;}}
      clearPending={()=>{setPendingSelection([]);pendingAnchor.current=undefined;}}
      canNavigate={canNavigate} canStartCanvasEdit={canStartCanvasEdit} canContinueBrush={shot=>canContinuePaint({active:active && !paintInput.isPaused(),tool,outputWork:!!outputWork.current,savingTiff,gesture:!!gestures.current || hasUnsettledMountedGesture() || inputUnsettled(),otherRequests:paintPresentation.awaitingAuthority() ? 0 : otherRequests.current,queuedTargets:paintPresentation.canContinue(shot.id,shot.activeLayerId ?? '') ? [JSON.stringify([shot.id,shot.activeLayerId])] : [],target:JSON.stringify([shot.id,shot.activeLayerId])})} demand={requestAssets} move={moveShots} remove={deletePending} renderLayers={renderLayers}
      holdShots={dialogueHoldShots}
      renderInfo={(shot,allowDialogueDrag=false)=><div className="wb-info"><label>动作说明<textarea aria-label={'动作说明 '+shot.id} value={shot.scriptText} disabled={!active} onChange={e=>script(shot.id,e.target.value)}/></label>{renderDialogue(shot.id,false,allowDialogueDrag)}</div>}
      renderCanvas={(shot,previous,next)=><SketchPad paintPresentation={paintPresentation} respectActiveLayer key={shot.id} shot={shot} folderPath="flow" bitmapRevision={snapshot.project.revision} tool={tool} brushColor={color}
        brushSize={preferenceFor(brushPreferences, brushPreferences.brush).size}
        brushOpacity={preferenceFor(brushPreferences, brushPreferences.brush).opacity}
        eraserSize={preferenceFor(brushPreferences, brushPreferences.eraser).size}
        eraserOpacity={preferenceFor(brushPreferences, brushPreferences.eraser).opacity}
        brushSoftness={0} eraserSoftness={0}
        brush={strokeBrushFor(brushPreferences.brush, 1)} eraserBrush={strokeBrushFor(brushPreferences.eraser, 1)}
        pressureEnabled={brushPreferences.pressure}
        onOpenBrushPanel={canStartCanvasEdit()?setBrushPanel:undefined}
        isZoomScrubbing={false}
        onionSkinPreviousShot={previous} onionSkinNextShot={next} onionSkinPreviousRevision={snapshot.project.revision} onionSkinNextRevision={snapshot.project.revision}
        onFocusShot={()=>focusShot(shot.id)} wantsRenderedDataUrl={false} onSelectionTransform={(layerId,data,intent)=>transformSelection(shot,layerId,data,intent)} onBitmapSelectionChange={bitmapSelectionChange} onFill={(layerId,point,color)=>fill(shot,layerId,point,color)} onPickColor={setColor}/>}
      actions={<div className="wb-actions">
        <details className="wb-project-menu">
          <summary className="wb-document-action"><FolderClosed aria-hidden size={15}/>项目<ChevronDown aria-hidden size={11}/></summary>
          <div className="wb-menu wb-project-menu-list">
            <button type="button" disabled={!active || switching} onClick={event => { closeMenu(event); void openProject({ kind: 'dialog' }); }}>打开项目…</button>
            <button type="button" disabled={!active || switching} onClick={event => { closeMenu(event); void create.begin(); }}>新建项目…</button>
            <span className="wb-menu-label">最近项目</span>
            {recent.length ? recent.map(project => project.available
              ? <button type="button" key={project.id} data-recent-project={project.id} data-recent-target={project.target}
                  disabled={!active || switching || project.id === currentRecentId}
                  title={project.id === currentRecentId ? '当前项目' : project.name}
                  onClick={event => { closeMenu(event); void openProject({ kind: 'recent', id: project.id }); }}>
                  <span className="wb-menu-recent-label"><span>{project.name}{project.id === currentRecentId ? ' · 当前' : ''}</span><small className="wb-menu-recent-target">{project.target}</small></span>
                </button>
              : <div className="wb-menu-missing" key={project.id} data-recent-project={project.id} data-recent-target={project.target}>
                  <span className="wb-menu-recent-label"><span>{project.name} · 不可用</span><small className="wb-menu-recent-target">{project.target}</small></span>
                  <div>
                    <button type="button" disabled={!active || switching} onClick={event => { closeMenu(event); void onRelocateRecent(project.id); }}>重新定位…</button>
                    <button type="button" disabled={!active || switching} onClick={event => { closeMenu(event); void onRemoveRecent(project.id); }}>移除</button>
                  </div>
                </div>) : <span className="wb-menu-empty">还没有最近项目</span>}
          </div>
        </details>
        <PendingAddAction anchor={addAnchor} flow={flow} sessionId={sessionId} disabled={!active || savingTiff} recovery={snapshot.pendingAddRecovery} />
        <button disabled={!active || savingTiff || Boolean(naming.issue) || naming.composing} className="wb-save wb-document-action" onClick={() => { void saveTiff().catch(() => {}); }}><Save aria-hidden size={15}/>{savingTiff?'保存中…':'保存'}</button>
        <button disabled={!active} className="wb-refresh" data-external={folderStatus.state==='external'||folderStatus.state==='both'} data-spinning={refreshing} aria-busy={refreshing} title="从文件夹取回外部改动" aria-label="从文件夹取回外部改动" onClick={refreshImages}><FolderInput size={17} strokeWidth={1.75} aria-hidden /></button>
      </div>}
      renderDialogue={renderDialogue}
      toolbar={null}
      toolRail={<WorkspaceToolRail tool={tool} disabled={!active} canChangeTool={canNavigate()} paintInFlight={!outputWork.current && paintPresentation.hasInput()} onToolChange={(next) => { toolRef.current = next; shortcutRef.current?.toolChosenByUser(next); setTool(next); }}
        color={color} onColorChange={setColor} size={activePresetValue.size} onSizeChange={setActiveSize}
        blurRadius={blurRadius} onBlurRadiusChange={setBlurRadius} onApplyBlur={applyBlur}
        footer={<><button disabled={!active} title="撤销" aria-label="撤销" onClick={()=>void historyStep('undo')}><Undo2 size={20} strokeWidth={1.5} aria-hidden /><span className="wb-sr-only">撤销</span></button><button disabled={!active} title="重做" aria-label="重做" onClick={()=>void historyStep('redo')}><Redo2 size={20} strokeWidth={1.5} aria-hidden /><span className="wb-sr-only">重做</span></button></>}/>}
      boardActions={<><button className="wb-icon-button" disabled={!active} title="新建板" aria-label="新建板" onClick={newShot}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.4v9.2M3.4 8h9.2"/></svg><span className="wb-sr-only">新建板</span></button>
        <span className="wb-add-anchor" ref={setAddAnchor}/>
        <button className="wb-icon-button" disabled={!active||!selectedIds.length} title="删除" aria-label={selectedIds.length>1?`删除 (${selectedIds.length})`:'删除'} onClick={()=>removeActiveShots(selectedIds)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.2 4.9h9.6M6.5 4.9V3.4h3v1.5M4.7 4.9l.55 7.7h5.5l.55-7.7M6.8 7.1v3.6M9.2 7.1v3.6"/></svg><span className="wb-sr-only">删除</span>
          {selectedIds.length>1&&<span className="wb-icon-badge" aria-hidden="true">{selectedIds.length}</span>}
        </button></>}/>
    {brushPanel && <BrushPanel tool={tool==='eraser'?'eraser':'brush'} preferences={brushPreferences}
      disabled={!active} anchor={brushPanel} onChange={setBrushPreferences} onClose={()=>setBrushPanel(undefined)}/>}
    {folderStatus.recovery && <aside className="wb-recovery" aria-label="文件恢复">
      <strong>上次保存中断 · {folderStatus.recovery.name}</strong>
      {folderStatus.recovery.state === 'restore' && <p>Flow 无法确认这张故事板是否已移入废纸篓。请在系统废纸篓中找到原文件，选择“放回”或“还原”。还原位置是项目内的 <code>{folderStatus.recovery.directory}</code>。切回 Flow 后会重新检查。若找不到原文件，请保留整个项目文件夹以便恢复。</p>}
      {folderStatus.recovery.state === 'inspect' && <p>恢复文件的位置、身份或内容与保存记录不一致。请保留项目文件夹和原文件，以便核对。</p>}
      {folderStatus.recovery.state === 'retry' && <><p>已找到可继续的删除记录。重试会继续上次保存，并把仍待删除的原文件移入系统废纸篓。</p><button disabled={!active || savingTiff} onClick={() => { void saveTiff().catch(() => {}); }}>重试保存 TIFF</button></>}
    </aside>}
    {create.state && <CreateProjectSheet key={create.state.draft.id} state={create.state} busy={switching}
      onChooseSource={kind => void create.chooseSource(kind)} onChooseDestination={() => void create.chooseDestination()}
      onConfirm={fields => void create.confirm(fields)} onCancel={() => void create.cancel()}
      onAbort={() => void create.abort()} onRespond={decision => void create.respond(decision)} onError={create.setError} />}
  </CanvasPresentationContext.Provider></MediaSourceContext.Provider>;
}
