import { useFolderStatus } from './useFolderStatus';
import {Workbench} from './Workbench';
import {FlowInspection} from './FlowInspection';
import {CanvasPresentationContext} from '../canvasPresentation';
import type { SelectionTransformIntent } from '../selectionTransform';
import type { FlowSelection } from '../../../electron/shared/flowSelection';
import { selectShots, draggedShots } from './boardSelection';
import { DialogueTransfers } from './DialogueTransfers';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FlowEditorBootstrap } from '../../../electron/shared/flowEditor';
import type { FlowSession, FlowSessionRequest } from '../../../electron/shared/flowWave2';
import { createFlowSession } from '../../core/session';
import { createPixelTools, createFlowPixels } from '../drawing';
import { MediaSourceContext, type MediaSource } from '../mediaSource';
import { JapaneseStoryboardView } from '../JapaneseStoryboardView';
import { shotDialogueText } from '../editableDialogueText';
import { SketchPad } from '../SketchPad';
import { LayerPanel } from '../LayerPanel';
import { FlowNaming } from './FlowNaming';
import { FlowPending, pendingDropId } from './FlowPending';
import { captureMountedCanvasCheckpoints } from '../mountedCanvasRecoveryCapture';
import { projectView, dialogueCommand, projectShots, pixelStroke, settledStrokePreview } from './adapter';
import type { Shot, SketchStroke } from '../../shared/types';
import './flowEditor.css';

const required = <T,>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message); return r.value;
};
const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };

function bindEditor(sessionId: string) {
  const api = window.flowEditor!;
  return {
    read: (id: string) => api.read(sessionId, id),
    put: (input: Parameters<typeof api.put>[1]) => api.put(sessionId, input),
    checkpoint: (project: FlowEditorBootstrap['project']) => api.checkpoint(sessionId, project),
    refresh: (project: FlowEditorBootstrap['project']) => api.refresh(sessionId, project),
    folderStatus: (request: Parameters<typeof api.folderStatus>[1]) => api.folderStatus(sessionId, request),
    saveTiff: (project: FlowEditorBootstrap['project']) => api.saveTiff(sessionId, project)
  };
}
type EditorOwner = { flow: FlowSession; sessionId: string; api: ReturnType<typeof bindEditor> };
export function FlowEditor() {
  const [owner, setOwner] = useState<EditorOwner>();
  const current = useRef<EditorOwner | undefined>(undefined);
  const [issue, setIssue] = useState('');
  const [switching, setSwitching] = useState(false);
  const gestures = useRef(0);
  const outputWork = useRef<Promise<void> | undefined>(undefined);
  const switchWork = useRef<Promise<void> | undefined>(undefined);
  const closing = useRef(false);
  const assertSettledGesture = () => {
    if (gestures.current || captureMountedCanvasCheckpoints().hasUnsettledGesture) throw Error('Finish the current stroke first');
  };
  const install = ({ project, sessionId }: FlowEditorBootstrap) => {
    const api = bindEditor(sessionId);
    const flow = required(createFlowSession({ project, sessionId, incarnation: crypto.randomUUID(),
      maxHistoryEntries: 60, maxPendingRequests: 32, assets: api,
      pixels: createFlowPixels({ maxPixels: 32_000_000, maxPngBytes: 64 * 1024 * 1024, maxPoints: 100_000 }),
      tools: createPixelTools({ maxPixels: 32_000_000, maxPngBytes: 64 * 1024 * 1024, maxLayers: 64 }),
      checkpoint: api.checkpoint, refresh: api.refresh, clock: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: h => window.clearTimeout(h as number) } }));
    const next = { flow, api, sessionId };
    current.current = next; setOwner(next); setIssue('');
    void flow.request({ kind: 'checkpoint' }).then(result => { if (current.current === next && !result.ok) setIssue(result.error.message); });
  };
  const resume = async (owner: EditorOwner) => {
    if (owner.flow.snapshot().phase === 'frozen') required(await owner.flow.request({ kind: 'resume' }));
  };
  const openProject = () => {
    if (switchWork.current || closing.current || !current.current) return;
    const previous = current.current;
    setSwitching(true);
    const work = (async () => {
      try {
        assertSettledGesture();
        while (outputWork.current) await outputWork.current;
        assertSettledGesture();
        const frozen = required(await previous.flow.request({ kind: 'freeze' }));
        const next = await window.flowEditor!.switchProject(previous.sessionId, frozen.snapshot.project);
        if (next) install(next); else { await resume(previous); setIssue(''); }
      } catch (error) {
        if (current.current === previous) await resume(previous);
        setIssue(String(error));
      } finally { setSwitching(false); }
    })();
    switchWork.current = work;
    void work.finally(() => { if (switchWork.current === work) switchWork.current = undefined; });
  };
  useEffect(() => {
    const api = window.flowEditor!;
    let cancelled = false;
    window.addEventListener('beforeunload', beforeUnload);
    void api.open().then(value => { if (!cancelled) install(value); }).catch(error => setIssue(String(error)));
    const off = api.onClose(id => { void (async () => {
      if (closing.current) return;
      closing.current = true;
      let owner: EditorOwner | undefined;
      try {
        if (switchWork.current) await switchWork.current;
        owner = current.current;
        if (!owner) throw Error('Project is still opening');
        assertSettledGesture();
        while (outputWork.current) await outputWork.current;
        assertSettledGesture();
        const result = required(await owner.flow.request({ kind: 'freeze' }));
        const closed = await api.finishClose(owner.sessionId, id, result.snapshot.project);
        if (!closed.ok) throw Error(closed.message);
        window.removeEventListener('beforeunload', beforeUnload);
      } catch (error) {
        setIssue(String(error));
        await api.finishClose(owner?.sessionId ?? '', id, null);
        if (owner) await resume(owner);
        closing.current = false;
      }
    })(); });
    return () => { cancelled = true; off(); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
  return owner ? <Editor key={owner.sessionId} flow={owner.flow} api={owner.api} openProject={openProject} switching={switching}
    issue={issue} setIssue={s => { if (current.current === owner) setIssue(s); }} gestures={gestures} outputWork={outputWork} /> : <main><p role="status">{issue || 'Opening project…'}</p></main>;
}
function Editor({ flow, api, openProject, switching, issue, setIssue, gestures, outputWork }: {
  api: ReturnType<typeof bindEditor>; openProject: () => void; switching: boolean;
  outputWork: { current: Promise<void> | undefined }; flow: FlowSession; issue: string; setIssue: (s: string) => void; gestures: { current: number }
}) {
  const [workbench,setWorkbench]=useState(window.location.hash==='#flow-workbench');
  const [demand,setDemand]=useState<string[]>([]);
  const demandRef=useRef(demand);demandRef.current=demand;
  const requestAssets=useCallback((ids:string[])=>setDemand(old=>JSON.stringify(old)===JSON.stringify(ids)?old:ids),[]);
  const [snapshot, setSnapshot] = useState(() => flow.snapshot());
  const [layers, setLayers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState(snapshot.project.shots[0]?.id);
  const [selection, setSelection] = useState<string[]>(snapshot.project.shots[0] ? [snapshot.project.shots[0].id] : []);
  const selectionAnchor = useRef<string | undefined>(snapshot.project.shots[0]?.id);
  const selectedIds = snapshot.project.shots.filter(s => selection.includes(s.id)).map(s => s.id);
  const focusShot = (id: string) => { setSelected(id); setSelection([id]); selectionAnchor.current = id; };
  const selectShot = (id: string, event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => {
    setSelection(current => selectShots(flow.snapshot().project.shots.map(s => s.id), current, selectionAnchor.current, id, event));
    setSelected(id); if (!event.shiftKey) selectionAnchor.current = id;
  };
  const [inspection, setInspection] = useState(false);
  const [namingOpen, setNamingOpen] = useState(false);
  const [panel, setPanel] = useState<string>();
  const [refreshing,setRefreshing]=useState(false),[refreshRecovery,setRefreshRecovery]=useState(false),[refreshStatus,setRefreshStatus]=useState('');
  const [savingTiff, setSavingTiff] = useState(false);
  const [savedTiffRevision, setSavedTiffRevision] = useState<number>();
  const flowSaved = snapshot.checkpoint?.revision === snapshot.project.revision && !snapshot.pending;
  const folderStatus = useFolderStatus(snapshot.project, workbench && flowSaved, savingTiff || refreshing, api.folderStatus);
  const [japanese, setJapanese] = useState(false);
  const [tool, setTool] = useState<'brush' | 'eraser' | 'blur' | 'select'>('brush');
  const [color, setColor] = useState('#dd3344');
  const pixelSelections = useRef<Record<string, FlowSelection>>({});
  const bitmapSelectionChange = useCallback((shotId: string, layerId: string | undefined, points: FlowSelection | undefined) => {
    for(const key of Object.keys(pixelSelections.current))if(key.startsWith(`${shotId}/`))delete pixelSelections.current[key];
    if(layerId && points)pixelSelections.current[`${shotId}/${layerId}`]=points.map(p=>({...p}));
  },[]);
  const [blurRadius,setBlurRadius]=useState(8);
  const [size, setSize] = useState(20);
  const [opacityPreview, setOpacityPreview] = useState<Record<string, number>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const disposed = useRef(false);
  const cache = useMemo(() => new Map<string, string>(), []);
  const loads = useMemo(() => new Map<string, Promise<string>>(), []);
  useEffect(() => {
    const unsubscribe = flow.subscribe(() => setSnapshot(flow.snapshot()));
    // A fast initial checkpoint can finish between render and effect subscription.
    setSnapshot(flow.snapshot());
    return unsubscribe;
  }, [flow]);
  const source = async (id: string): Promise<string> => {
    if (cache.has(id)) return cache.get(id)!;
    if (!loads.has(id)) loads.set(id, api.read(id).then(result => {
      if (disposed.current) throw Error('Editor session retired');
      const bytes = new Uint8Array(required(result));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      cache.set(id, url);
      if(workbench)for(const [old,held] of cache){if(cache.size<=96)break;if(!demandRef.current.includes(old)&&old!==id){URL.revokeObjectURL(held);cache.delete(old);}}
      setUrls(Object.fromEntries(cache)); return url;
    }).finally(() => loads.delete(id)));
    return loads.get(id)!;
  };
  useEffect(() => {
    const ids=workbench?demand:Object.values(snapshot.project.images).flatMap(image=>image.layers.map(layer=>layer.assetId));
    for(const id of new Set(ids))void source(id).catch(error=>setIssue(String(error)));
  }, [snapshot.project, demand, workbench]);
  useEffect(() => { disposed.current = false; return () => { disposed.current = true; for (const url of cache.values()) URL.revokeObjectURL(url); }; }, [cache]);
  const media: MediaSource = useMemo(() => ({ assetUrl: id => urls[id] ?? '', layerAssetUrl: ({ bitmapPath }) => urls[bitmapPath.split('/').at(-1)!] ?? '' }), [urls]);
  const otherRequests = useRef(0);
  const request = async (r: FlowSessionRequest, settlingGesture=false) => {
    if(gestures.current && !settlingGesture)throw Error('Finish the current layer gesture first');
    const other = r.kind !== 'paint' || r.stroke.tool !== 'brush';
    if (other) otherRequests.current++;
    try { const result = required(await flow.request(r)); setIssue(''); return result; } catch (error) { setIssue(String(error)); throw error; }
    finally { if (other) otherRequests.current--; }
  };
  const act = (r: FlowSessionRequest) => { void request(r).catch(() => {}); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if(outputWork.current||gestures.current)return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !(event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLInputElement)) {
        event.preventDefault(); act({ kind: event.shiftKey ? 'redo' : 'undo' });
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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const rejectTool = () => setIssue('This operation is not connected yet');
  const active = snapshot.phase === 'active' && !switching && !refreshing && !refreshRecovery;
  const view = projectView(snapshot.project, shots);
  const script = (shotId: string, text: string) => act({ kind: 'board', command: { kind: 'setScriptText', shotId, text } });
  const dialogue = (shotId: string, text: string) => act({ kind: 'board', command: dialogueCommand(flow.snapshot().project, shotId, text) });
  const brushQueue = useRef(new Map<symbol, string>());
  const stroke = async (shot: Shot, layerId: string, input: SketchStroke) => {
    const token = Symbol();
    if (input.tool === 'brush') brushQueue.current.set(token, JSON.stringify([shot.id,layerId]));
    try {
      const result = await request({ kind: 'paint', shotId: shot.id, layerId, stroke: pixelStroke(input) });
      const currentShot = result.snapshot.project.shots.find(s => s.id === shot.id)!;
      return await settledStrokePreview(() => flow.snapshot().project, shot.id, layerId,
        result.snapshot.project.images[currentShot.imageId].layers.find(l => l.id === layerId)!.assetId, source);
    } finally { brushQueue.current.delete(token); }
  };
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
    if(!active||gestures.current||outputWork.current||flow.snapshot().pending||captureMountedCanvasCheckpoints().hasUnsettledGesture){setIssue('Finish the current edit before applying blur');return;}
    const shot=shots.find(s=>s.id===(workbench?selectedIds[0]:selected));
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
    if(outputWork.current||switching||refreshing||gestures.current||captureMountedCanvasCheckpoints().hasUnsettledGesture)return;
    const before=flow.snapshot().project;
    setRefreshing(true);setRefreshStatus('Checking external images…');
    const work=(async()=>{
      try{
        const result=await flow.request({kind:'refresh'});
        if(!result.ok){setRefreshRecovery(result.error.effect==='unknown');throw Error(result.error.message);}
        const after=result.value.snapshot.project;
        const alternatives=after.parkedShots.length-before.parkedShots.length;
        const updated=[...before.shots,...before.parkedShots].filter(s=>JSON.stringify(before.images[s.imageId])!==JSON.stringify(after.images[s.imageId])).length;
        setRefreshRecovery(false);setIssue('');
        setRefreshStatus(alternatives?`${updated} images updated; ${alternatives} external versions kept in Pending`:`${updated} images updated`);
        if(result.value.changed)setSavedTiffRevision(undefined);
      }catch(error){setIssue(String(error));setRefreshStatus('Refresh did not finish; retry after resolving the issue');}
      finally{setRefreshing(false);}
    })();
    outputWork.current=work;void work.finally(()=>{if(outputWork.current===work)outputWork.current=undefined;});
  };
  const saveTiff = async () => {
    if (!active || savingTiff || outputWork.current) return;
    if (gestures.current || captureMountedCanvasCheckpoints().hasUnsettledGesture || flow.snapshot().pending) {
      setIssue('Finish the current edit before saving TIFF'); return;
    }
    const captured = flow.snapshot().project;
    setSavingTiff(true);
    const work = (async () => {
      try {
        const receipt = required(await api.saveTiff(captured));
        if (receipt.projectId !== captured.id || receipt.revision !== captured.revision) throw Error('TIFF Save receipt mismatch');
        setSavedTiffRevision(receipt.revision); setIssue('');
      } catch (error) { setIssue(String(error)); throw error; }
      finally { setSavingTiff(false); }
    })();
    outputWork.current = work;
    try { await work; } finally { if (outputWork.current === work) outputWork.current = undefined; }
  };

  const newShot = () => {
    const project = flow.snapshot().project, anchor = project.shots.find(s => s.id === (workbench?selectedIds[0]:selected));
    const image = anchor ? project.images[anchor.imageId] : project.shots[0] ? project.images[project.shots[0].imageId] : undefined;
    const shotId = crypto.randomUUID();
    void request({ kind: 'newShot', shotId, imageId: crypto.randomUUID(), width: image?.width ?? 1920, height: image?.height ?? 1080,
      ...(anchor ? { afterId: anchor.id } : {}) }).then(() => focusShot(shotId)).catch(() => {});
  };
  const dialogueTransfers = (shotId: string) => <DialogueTransfers shotId={shotId} dialogues={snapshot.project.dialogues} disabled={!active}
    onMove={(id, targetShotId, beforeId) => act({ kind: 'board', command: { kind: 'moveDialogues', dialogueIds: [id], targetShotId, ...(beforeId ? { beforeId } : {}) } })} />;
  const moveShots = (shotIds: string[], destination: 'active' | 'pending', beforeId?: string) => {
    if (!active || gestures.current || captureMountedCanvasCheckpoints().hasUnsettledGesture) {
      setIssue('Finish the current stroke before moving shots'); return;
    }
    act({ kind: 'board', command: { kind: 'moveShots', shotIds, destination, ...(beforeId ? { beforeId } : {}) } });
  };
  const switchView = () => {
    if (gestures.current || flow.snapshot().pending || captureMountedCanvasCheckpoints().hasUnsettledGesture) {
      setIssue('Finish the current edit before switching views'); return;
    }
    setJapanese(value => !value);
  };

  const renderLayers=(shot:Shot)=><LayerPanel shot={shot} folderPath="flow" thumbnailRevision={snapshot.project.revision} isOpen={workbench || panel === shot.id} isRendered={workbench || panel === shot.id}
          canBeginLayerGesture={()=>!gestures.current && !flow.snapshot().pending && !outputWork.current && flow.snapshot().phase==='active'}
          onLayerGroupOpacityGesture={(shotId,ids,delta,initial,phase)=>{
            const changes=ids.map(layerId=>({layerId,before:initial[layerId],opacity:Math.round(Math.max(0,Math.min(1,initial[layerId]+delta))*1000)/1000}));
            const clear=()=>{gestures.current=0;setOpacityPreview(current=>{const next={...current};for(const id of ids)delete next[`${shotId}/${id}`];return next;});};
            if(phase==='preview'){gestures.current=1;setOpacityPreview(current=>({...current,...Object.fromEntries(changes.map(c=>[`${shotId}/${c.layerId}`,c.opacity]))}));}
            else if(phase==='cancel')clear();
            else void request({kind:'layer',shotId,edit:{kind:'setLayerOpacities',changes}},true).catch(()=>{}).finally(clear);
          }}
          onLayerOpacityGesture={(shotId, layerId, opacity, phase) => {
            const key = `${shotId}/${layerId}`;
            if (phase === 'preview') { gestures.current = 1; setOpacityPreview(current => ({ ...current, [key]: opacity })); }
            else void request({ kind: 'layer', shotId, edit: { kind: 'setLayer', layerId, patch: { opacity } } },true).catch(() => {}).finally(() => {
              gestures.current = 0; setOpacityPreview(current => { const next = { ...current }; delete next[key]; return next; });
            });
          }}
          structuralEditsEnabled={active} mergeEditsEnabled={active} onToggle={() => setPanel(undefined)} onAddLayer={id=>{void addLayer(id);}} onRemoveLayer={(shotId,layerId)=>act({kind:'layer',shotId,edit:{kind:'removeLayer',layerId}})} onMergeLayers={merge} onMergeVisibleLayers={shotId => {
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
  const canInspect = () => active && !outputWork.current && !gestures.current && !flow.snapshot().pending && !captureMountedCanvasCheckpoints().hasUnsettledGesture;
  const presentations=Object.fromEntries([...snapshot.project.shots,...snapshot.project.parkedShots].filter(s=>s.presentation).map(s=>[s.id,{...s.presentation!,text:snapshot.project.dialogues.filter(d=>d.shotId===s.id).map(d=>d.text.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ')} ]));
  if(workbench)return <MediaSourceContext.Provider value={media}><CanvasPresentationContext.Provider value={presentations}>
    <Workbench name={snapshot.project.name} shots={shots.slice(0,snapshot.project.shots.length)} parked={shots.slice(snapshot.project.shots.length)} selected={selectedIds} revision={snapshot.project.revision} disabled={!active}
      status={issue||snapshot.lastError?.message||(flowSaved ? 'Flow 内已保存 · ' + (savingTiff ? '正在更新文件夹中的故事板…' : folderStatus.label) : '正在保存到 Flow…')}
      select={selectShot} focus={focusShot} canNavigate={canInspect} canContinueBrush={shot=>active && tool==='brush' && !outputWork.current && !gestures.current &&
        brushQueue.current.size>0 && !otherRequests.current &&
        [...brushQueue.current.values()].every(key=>key===JSON.stringify([shot.id,shot.activeLayerId]))} demand={requestAssets} move={moveShots} renderLayers={renderLayers}
      renderInfo={shot=><div className="wb-info"><label>动作说明<textarea aria-label={'动作说明 '+shot.id} value={shot.scriptText} disabled={!active} onChange={e=>script(shot.id,e.target.value)}/></label><label>对白<textarea aria-label={'对白 '+shot.id} value={shotDialogueText(view,shot.id)} disabled={!active} onChange={e=>dialogue(shot.id,e.target.value)}/></label>{dialogueTransfers(shot.id)}</div>}
      renderCanvas={(shot,previous,next)=><SketchPad key={shot.id} shot={shot} folderPath="flow" bitmapRevision={snapshot.project.revision} tool={tool} brushColor={color} brushSize={size} brushOpacity={1} brushSoftness={0} eraserSize={size} eraserOpacity={1} eraserSoftness={0} isZoomScrubbing={false}
        onionSkinPreviousShot={previous} onionSkinNextShot={next} onionSkinPreviousRevision={snapshot.project.revision} onionSkinNextRevision={snapshot.project.revision}
        onFocusShot={()=>focusShot(shot.id)} onStroke={(layerId,input)=>stroke(shot,layerId,input)} onSelectionTransform={(layerId,data,intent)=>transformSelection(shot,layerId,data,intent)} onBitmapSelectionChange={bitmapSelectionChange} onFill={(layerId,point,color)=>fill(shot,layerId,point,color)} onPickColor={setColor}/>}
      actions={<><button disabled={!active} onClick={openProject}>打开项目</button><button disabled={!active} onClick={()=>setNamingOpen(true)}>命名</button><button disabled={!active||savingTiff} className="wb-save" onClick={()=>{void saveTiff().catch(()=>{});}}>{savingTiff?'保存中…':'保存 TIFF'}</button><button disabled={!active} onClick={refreshImages}>刷新外部图片</button></>}
      toolbar={<><div className="wb-tool-group">{(['brush','eraser','select','blur'] as const).map((t,i)=><button key={t} disabled={!active} aria-pressed={tool===t} onClick={()=>{if(canInspect())setTool(t);}}>{['画笔','橡皮','选区','模糊'][i]}</button>)}</div>
        <input aria-label="画笔颜色" type="color" value={color} onChange={e=>setColor(e.target.value)}/><label>笔径 <input aria-label="画笔大小" type="range" min="1" max="100" value={size} onChange={e=>setSize(Number(e.target.value))}/><span>{size}</span></label>
        {tool==='blur'&&<><input aria-label="模糊半径" type="range" min="1" max="50" value={blurRadius} onChange={e=>setBlurRadius(Number(e.target.value))}/><button disabled={!active} onClick={applyBlur}>应用模糊</button></>}
        <button disabled={!active} onClick={()=>act({kind:'undo'})}>撤销</button><button disabled={!active} onClick={()=>act({kind:'redo'})}>重做</button><span className="wb-toolbar-spacer"/>
        <button disabled={!active} onClick={newShot}>＋ 新建板</button><button disabled={!active||!selectedIds.length} onClick={()=>moveShots(selectedIds,'pending')}>移入 Pending</button><button disabled={!active||!selectedIds.length} onClick={()=>act({kind:'board',command:{kind:'removeShots',shotIds:selectedIds}})}>删除</button></>}/>
    {folderStatus.recovery && <aside className="wb-recovery" aria-label="文件恢复">
      <strong>上次保存中断 · {folderStatus.recovery.name}</strong>
      {folderStatus.recovery.state === 'restore' && <p>Flow 无法确认这张故事板是否已移入废纸篓。请在系统废纸篓中找到原文件，选择“放回”或“还原”。还原位置是项目内的 <code>{folderStatus.recovery.directory}</code>。切回 Flow 后会重新检查。若找不到原文件，请保留整个项目文件夹以便恢复。</p>}
      {folderStatus.recovery.state === 'inspect' && <p>恢复文件的位置、身份或内容与保存记录不一致。请保留项目文件夹和原文件，以便核对。</p>}
      {folderStatus.recovery.state === 'retry' && <><p>已找到可继续的删除记录。重试会继续上次保存，并把仍待删除的原文件移入系统废纸篓。</p><button disabled={!active || savingTiff} onClick={() => { void saveTiff().catch(() => {}); }}>重试保存 TIFF</button></>}
    </aside>}
    {namingOpen&&<div className="wb-naming"><FlowNaming project={snapshot.project} onCancel={()=>setNamingOpen(false)} onApply={async(name,naming)=>{await request({kind:'board',command:{kind:'setProjectNaming',name,naming}});setNamingOpen(false);}}/></div>}
  </CanvasPresentationContext.Provider></MediaSourceContext.Provider>;
  return <MediaSourceContext.Provider value={media}><CanvasPresentationContext.Provider value={presentations}>
    <main className="flow-editor" data-flow-editor="true" data-revision={snapshot.project.revision} data-phase={snapshot.phase}>
      <header className="topbar"><button onClick={()=>{if(canInspect())setWorkbench(true);}}>Workspace</button><strong>Storyboard Flow</strong><span>{snapshot.project.name}</span>
        <button disabled={switching} onClick={openProject}>{switching ? 'Opening…' : 'Open project'}</button>
        <button disabled={!active} onClick={() => setNamingOpen(value => !value)}>Naming</button>
        <label>Matte <select aria-label="Matte mode" disabled={!active||!!snapshot.pending} value={snapshot.project.presentation?.mode??'off'} onChange={e=>{
          if(captureMountedCanvasCheckpoints().hasUnsettledGesture||outputWork.current||gestures.current){setIssue('Finish the current edit first');return;}
          act({kind:'board',command:{kind:'setPresentation',presentation:e.target.value==='off'?null:{mode:e.target.value as 'expanded'|'embedded',dialogue:snapshot.project.presentation?.dialogue??false}}});
        }}><option value="off">Off</option><option value="expanded">Expanded</option><option value="embedded">Embedded</option></select></label>
        <button disabled={!active||!snapshot.project.presentation||!!snapshot.pending} aria-pressed={snapshot.project.presentation?.dialogue??false} onClick={()=>{
          if(snapshot.project.presentation)act({kind:'board',command:{kind:'setPresentation',presentation:{...snapshot.project.presentation,dialogue:!snapshot.project.presentation.dialogue}}});
        }}>Dialogue overlay</button>
        <button disabled={!active || !snapshot.project.shots.length} onClick={() => {if(canInspect())setInspection(true);else setIssue('Finish the current edit first');}}>Inspect</button>
        <button disabled={!active} onClick={switchView}>{japanese ? 'Grid view' : 'Japanese view'}</button>
        <button disabled={!active} aria-pressed={tool === 'brush'} onClick={() => setTool('brush')}>Brush</button>
        <button disabled={!active} aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>Eraser</button>
        <button disabled={!active} aria-pressed={tool==='select'} onClick={()=>setTool('select')}>Select</button>
        <button disabled={!active} aria-pressed={tool==='blur'} onClick={()=>setTool('blur')}>Blur</button>
        {tool==='blur'&&<><input aria-label="Blur radius" type="range" min="1" max="50" step="1" value={blurRadius} onChange={e=>setBlurRadius(Number(e.target.value))}/><span>{blurRadius} px</span><button disabled={!active||!!snapshot.pending} onClick={applyBlur}>Apply blur</button></>}
        <input aria-label="Brush color" type="color" value={color} onChange={e => setColor(e.target.value)} />
        <button draggable={active} disabled={!active} title="Drag this color onto a layer to fill" onDragStart={e => { e.dataTransfer.setData('application/x-storyboard-fill-color', color); e.dataTransfer.effectAllowed = 'copy'; }}>Fill color</button>
        <input aria-label="Brush size" type="range" min="1" max="100" value={size} onChange={e => setSize(Number(e.target.value))} />
        <button disabled={!active} onClick={() => act({ kind: 'undo' })}>Undo</button><button disabled={!active} onClick={() => act({ kind: 'redo' })}>Redo</button>
        <button disabled={!active} onClick={() => act({ kind: 'checkpoint' })}>Checkpoint</button>
        <button disabled={!active || savingTiff} onClick={() => { void saveTiff().catch(() => {}); }}>Save TIFF</button>
        <button disabled={switching||refreshing||savingTiff||snapshot.phase!=='active'} onClick={refreshImages}>{refreshing?'Refreshing…':'Refresh images'}</button>
        <span aria-label="External image status">{refreshStatus}</span>
        <span aria-label="TIFF output status">{savingTiff ? 'Saving TIFF…' : savedTiffRevision === snapshot.project.revision ? 'TIFF saved' : 'TIFF not saved for current edit'}</span>
        <button disabled={!active} onClick={newShot}>New shot</button>
        <button disabled={!active || !selectedIds.length} onClick={() => moveShots(selectedIds, 'pending')}>Move to Pending</button>
        <button disabled={!active || !selectedIds.length} onClick={() => act({ kind: 'board', command: { kind: 'removeShots', shotIds: selectedIds } })}>Delete shot</button>
        <button disabled={!active || !selectedIds.length} onClick={() => act({ kind: 'board', command: { kind: 'moveShots', shotIds: selectedIds, destination: 'active' } })}>Move to end</button>
        <button disabled={!active || !selected || !snapshot.project.shots.some(s => s.id === selected)} onClick={() => {
          const shot = shots.find(s => s.id === selected);
          if (shot?.activeLayerId) act({ kind: 'pixelTool', shotId: shot.id, tool: { kind: 'clear', layerId: shot.activeLayerId } });
        }}>Clear layer</button>
      </header>
      {namingOpen && <FlowNaming project={snapshot.project} onCancel={() => setNamingOpen(false)} onApply={async (name, naming) => { await request({ kind: 'board', command: { kind: 'setProjectNaming', name, naming } }); setNamingOpen(false); }} />}
      <p role="status">{issue || snapshot.lastError?.message || (snapshot.checkpoint?.revision === snapshot.project.revision ? 'Editable project saved' : 'Saving editable project…')}</p>
      {inspection && <FlowInspection shots={shots.slice(0,snapshot.project.shots.length)} initialId={selected} revision={snapshot.project.revision}
        issue={issue || snapshot.lastError?.message} canNavigate={canInspect} onClose={id=>{if(id)focusShot(id);setInspection(false);}}
        renderCanvas={(shot,previous,next)=><SketchPad key={shot.id} shot={shot} folderPath="flow" bitmapRevision={snapshot.project.revision}
          onionSkinPreviousShot={previous} onionSkinNextShot={next} onionSkinPreviousRevision={snapshot.project.revision} onionSkinNextRevision={snapshot.project.revision}
          tool={tool} brushColor={color} brushSize={size} brushOpacity={1} brushSoftness={0} eraserSize={size} eraserOpacity={1} eraserSoftness={0}
          isZoomScrubbing={false} onFocusShot={()=>focusShot(shot.id)} onStroke={(layerId,input)=>stroke(shot,layerId,input)}
          onSelectionTransform={(layerId,data,intent)=>transformSelection(shot,layerId,data,intent)} onBitmapSelectionChange={bitmapSelectionChange}
          onFill={(layerId,point,color)=>fill(shot,layerId,point,color)} onPickColor={setColor} />} />}
      {!inspection && <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active: from, over }) => {
        if (!over) return;
        const project = flow.snapshot().project, sourceId = String(from.id), targetId = String(over.id);
        const parked = project.parkedShots.some(s => s.id === sourceId);
        const ids = parked ? [sourceId] : draggedShots(project.shots.map(s => s.id), selectedIds, sourceId);
        if (ids.includes(targetId)) return;
        if (targetId === pendingDropId) moveShots(ids, 'pending');
        else if (project.parkedShots.some(s => s.id === targetId)) moveShots(ids, 'pending', targetId);
        else if (project.shots.some(s => s.id === targetId)) moveShots(ids, 'active', targetId);
      }}><SortableContext items={snapshot.project.shots.map(s => s.id)} strategy={japanese ? verticalListSortingStrategy : rectSortingStrategy}>
      {japanese ? <fieldset className="flow-editor-sheet" disabled={!active}>
        <JapaneseStoryboardView project={view} selectedShotIds={selectedIds} zoomLevel={100}
          activeSketchTool={tool} brushColor={color} brushSize={size} brushOpacity={1} brushSoftness={0}
          eraserSize={size} eraserOpacity={1} eraserSoftness={0} folderPath="flow" isZoomScrubbing={false}
          bitmapRevisionByShotId={Object.fromEntries(shots.map(s => [s.id, snapshot.project.revision]))}
          onActionText={script} onDialogueText={dialogue} onFocusShot={focusShot} onSelectShot={selectShot} renderDialogueTransfers={dialogueTransfers}
          onPickColor={setColor} onFill={fill} onSelectionTransform={transformSelection} onBitmapSelectionChange={bitmapSelectionChange} onSketchStroke={stroke} />
      </fieldset> :
      <div className="flow-editor-grid">{shots.slice(0, snapshot.project.shots.length).map(shot => <Card key={shot.id} shot={shot} selected={selectedIds.includes(shot.id)} disabled={!active} onSelect={event => selectShot(shot.id, event)}>
        <SketchPad shot={shot} folderPath="flow" bitmapRevision={snapshot.project.revision} tool={tool} brushColor={color} brushSize={size} brushOpacity={1} brushSoftness={0}
          eraserSize={size} eraserOpacity={1} eraserSoftness={0} isZoomScrubbing={false} onFocusShot={() => focusShot(shot.id)}
          onStroke={(layerId, input) => stroke(shot, layerId, input)} onSelectionTransform={(layerId,data,intent)=>transformSelection(shot,layerId,data,intent)} onBitmapSelectionChange={bitmapSelectionChange} onFill={(layerId, point, color) => fill(shot, layerId, point, color)} onPickColor={setColor} />
        <textarea aria-label={`Script ${shot.id}`} value={shot.scriptText} disabled={!active} onChange={e => script(shot.id, e.target.value)} />
        <textarea aria-label={`Dialogue ${shot.id}`} value={shotDialogueText(view, shot.id)} disabled={!active} onChange={e => dialogue(shot.id, e.target.value)} />
        {dialogueTransfers(shot.id)}
        <button disabled={!active} onClick={() => { focusShot(shot.id); setPanel(panel === shot.id ? undefined : shot.id); }}>Layers</button>
        {renderLayers(shot)}
      </Card>)}</div>}</SortableContext>
      <FlowPending shots={shots.slice(snapshot.project.shots.length)} disabled={!active} revision={snapshot.project.revision} onRestore={id => moveShots([id], 'active')} />
      </DndContext>}
    </main>
  </CanvasPresentationContext.Provider></MediaSourceContext.Provider>;
}
function Card({ shot, disabled, selected, onSelect, children }: { onSelect: (event: React.MouseEvent<HTMLElement>) => void; shot: Shot; disabled: boolean; selected: boolean; children: React.ReactNode }) {
  const sortable = useSortable({ id: shot.id, disabled });
  return <article className={`shot-card ${selected ? 'is-selected' : ''}`} data-shot-id={shot.id} ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <button aria-label={`Move ${shot.id}`} onClick={onSelect} {...sortable.attributes} {...sortable.listeners}>{shot.fileName}</button>{children}
  </article>;
}
