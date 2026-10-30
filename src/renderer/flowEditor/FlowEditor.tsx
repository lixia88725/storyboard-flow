import { useEffect, useMemo, useState, useRef } from 'react';
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { FlowSession, FlowSessionRequest } from '../../../electron/shared/flowWave2';
import { createFlowSession } from '../../core/session';
import { createFlowPixels } from '../drawing';
import { MediaSourceContext, type MediaSource } from '../mediaSource';
import { JapaneseStoryboardView } from '../JapaneseStoryboardView';
import { shotDialogueText } from '../editableDialogueText';
import { SketchPad } from '../SketchPad';
import { LayerPanel } from '../LayerPanel';
import { ShotStaticMedia } from '../ShotStaticMedia';
import { captureMountedCanvasCheckpoints } from '../mountedCanvasRecoveryCapture';
import { projectView, dialogueCommand, projectShots, pixelStroke, settledStrokePreview } from './adapter';
import type { Shot, SketchStroke } from '../../shared/types';
import './flowEditor.css';

const required = <T,>(r: { ok: true; value: T } | { ok: false; error: { message: string } }): T => {
  if (!r.ok) throw new Error(r.error.message); return r.value;
};
const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
const unavailable = () => { throw new Error('This tool is not connected in this editor yet'); };

export function FlowEditor() {
  const [flow, setFlow] = useState<FlowSession>();
  const [issue, setIssue] = useState('');
  const gestures = useRef(0);
  useEffect(() => {
    const api = window.flowEditor!;
    let off: (() => void) | undefined, cancelled = false;
    window.addEventListener('beforeunload', beforeUnload);
    void api.open().then(({ project, sessionId }) => {
      if (cancelled) return;
      const owner = required(createFlowSession({ project, sessionId, incarnation: crypto.randomUUID(),
        maxHistoryEntries: 60, maxPendingRequests: 32, assets: api,
        pixels: createFlowPixels({ maxPixels: 32_000_000, maxPngBytes: 64 * 1024 * 1024, maxPoints: 100_000 }),
        checkpoint: p => api.checkpoint(p), clock: { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: h => window.clearTimeout(h as number) } }));
      off = api.onClose(id => { void (async () => {
        try {
          if (gestures.current || captureMountedCanvasCheckpoints().hasUnsettledGesture) throw new Error('Finish the current stroke before closing');
          const result = required(await owner.request({ kind: 'freeze' }));
          const closed = await api.finishClose(id, result.snapshot.project);
          if (!closed.ok) throw new Error(closed.message);
          window.removeEventListener('beforeunload', beforeUnload);
        } catch (error) { setIssue(String(error)); await api.finishClose(id, null); }
      })(); });
      setFlow(owner);
      void owner.request({ kind: 'checkpoint' }).then(result => { if (!result.ok) setIssue(result.error.message); });
    }).catch(error => setIssue(String(error)));
    return () => { cancelled = true; off?.(); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);
  return flow ? <Editor flow={flow} issue={issue} setIssue={setIssue} gestures={gestures} /> : <main><p role="status">{issue || 'Opening project…'}</p></main>;
}
function Editor({ flow, issue, setIssue, gestures }: { flow: FlowSession; issue: string; setIssue: (s: string) => void; gestures: { current: number } }) {
  const [snapshot, setSnapshot] = useState(() => flow.snapshot());
  const [layers, setLayers] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState(snapshot.project.shots[0]?.id);
  const [panel, setPanel] = useState<string>();
  const [japanese, setJapanese] = useState(false);
  const [tool, setTool] = useState<'brush' | 'eraser'>('brush');
  const [color, setColor] = useState('#dd3344');
  const [size, setSize] = useState(20);
  const [opacityPreview, setOpacityPreview] = useState<Record<string, number>>({});
  const [urls, setUrls] = useState<Record<string, string>>({});
  const cache = useMemo(() => new Map<string, string>(), []);
  const loads = useMemo(() => new Map<string, Promise<string>>(), []);
  useEffect(() => flow.subscribe(() => setSnapshot(flow.snapshot())), [flow]);
  const source = async (id: string): Promise<string> => {
    if (cache.has(id)) return cache.get(id)!;
    if (!loads.has(id)) loads.set(id, window.flowEditor!.read(id).then(result => {
      const bytes = new Uint8Array(required(result));
      const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      cache.set(id, url); setUrls(Object.fromEntries(cache)); return url;
    }).finally(() => loads.delete(id)));
    return loads.get(id)!;
  };
  useEffect(() => {
    for (const image of Object.values(snapshot.project.images)) for (const layer of image.layers) void source(layer.assetId).catch(error => setIssue(String(error)));
  }, [snapshot.project]);
  useEffect(() => () => { for (const url of cache.values()) URL.revokeObjectURL(url); }, [cache]);
  const media: MediaSource = useMemo(() => ({ assetUrl: id => urls[id] ?? '', layerAssetUrl: ({ bitmapPath }) => urls[bitmapPath.split('/').at(-1)!] ?? '' }), [urls]);
  const request = async (r: FlowSessionRequest) => {
    try { const result = required(await flow.request(r)); setIssue(''); return result; } catch (error) { setIssue(String(error)); throw error; }
  };
  const act = (r: FlowSessionRequest) => { void request(r).catch(() => {}); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
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
  const active = snapshot.phase === 'active';
  const view = projectView(snapshot.project, shots);
  const script = (shotId: string, text: string) => act({ kind: 'board', command: { kind: 'setScriptText', shotId, text } });
  const dialogue = (shotId: string, text: string) => act({ kind: 'board', command: dialogueCommand(flow.snapshot().project, shotId, text) });
  const stroke = async (shot: Shot, layerId: string, input: SketchStroke) => {
    const result = await request({ kind: 'paint', shotId: shot.id, layerId, stroke: pixelStroke(input) });
    const currentShot = result.snapshot.project.shots.find(s => s.id === shot.id)!;
    return settledStrokePreview(() => flow.snapshot().project, shot.id, layerId,
      result.snapshot.project.images[currentShot.imageId].layers.find(l => l.id === layerId)!.assetId, source);
  };
  const switchView = () => {
    if (gestures.current || flow.snapshot().pending || captureMountedCanvasCheckpoints().hasUnsettledGesture) {
      setIssue('Finish the current edit before switching views'); return;
    }
    setJapanese(value => !value);
  };

  return <MediaSourceContext.Provider value={media}>
    <main className="flow-editor" data-flow-editor="true" data-revision={snapshot.project.revision} data-phase={snapshot.phase}>
      <header className="topbar"><strong>Storyboard Flow</strong><span>{snapshot.project.name}</span>
        <button disabled={!active} onClick={switchView}>{japanese ? 'Grid view' : 'Japanese view'}</button>
        <button disabled={!active} aria-pressed={tool === 'brush'} onClick={() => setTool('brush')}>Brush</button>
        <button disabled={!active} aria-pressed={tool === 'eraser'} onClick={() => setTool('eraser')}>Eraser</button>
        <input aria-label="Brush color" type="color" value={color} onChange={e => setColor(e.target.value)} />
        <input aria-label="Brush size" type="range" min="1" max="100" value={size} onChange={e => setSize(Number(e.target.value))} />
        <button disabled={!active} onClick={() => act({ kind: 'undo' })}>Undo</button><button disabled={!active} onClick={() => act({ kind: 'redo' })}>Redo</button>
        <button disabled={!active} onClick={() => act({ kind: 'checkpoint' })}>Checkpoint</button>
      </header>
      <p role="status">{issue || snapshot.lastError?.message || (snapshot.checkpoint?.revision === snapshot.project.revision ? 'Editable project saved' : 'Saving editable project…')}</p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({ active: from, over }) => {
        if (over && from.id !== over.id) act({ kind: 'board', command: { kind: 'moveShots', shotIds: [String(from.id)], destination: 'active', beforeId: String(over.id) } });
      }}><SortableContext items={snapshot.project.shots.map(s => s.id)} strategy={japanese ? verticalListSortingStrategy : rectSortingStrategy}>
      {japanese ? <fieldset className="flow-editor-sheet" disabled={!active}>
        <JapaneseStoryboardView project={view} selectedShotIds={selected ? [selected] : []} zoomLevel={100}
          activeSketchTool={tool} brushColor={color} brushSize={size} brushOpacity={1} brushSoftness={0}
          eraserSize={size} eraserOpacity={1} eraserSoftness={0} folderPath="flow" isZoomScrubbing={false}
          bitmapRevisionByShotId={Object.fromEntries(shots.map(s => [s.id, snapshot.project.revision]))}
          onActionText={script} onDialogueText={dialogue} onFocusShot={setSelected} onSelectShot={setSelected}
          onPickColor={setColor} onFill={unavailable} onSelectionTransform={unavailable} onSketchStroke={stroke} />
      </fieldset> :
      <div className="flow-editor-grid">{shots.slice(0, snapshot.project.shots.length).map(shot => <Card key={shot.id} shot={shot} selected={selected === shot.id} disabled={!active}>
        <SketchPad shot={shot} folderPath="flow" bitmapRevision={snapshot.project.revision} tool={tool} brushColor={color} brushSize={size} brushOpacity={1} brushSoftness={0}
          eraserSize={size} eraserOpacity={1} eraserSoftness={0} isZoomScrubbing={false} onFocusShot={() => setSelected(shot.id)}
          onStroke={(layerId, input) => stroke(shot, layerId, input)} onSelectionTransform={unavailable} onFill={unavailable} onPickColor={setColor} />
        <textarea aria-label={`Script ${shot.id}`} value={shot.scriptText} disabled={!active} onChange={e => script(shot.id, e.target.value)} />
        <textarea aria-label={`Dialogue ${shot.id}`} value={shotDialogueText(view, shot.id)} disabled={!active} onChange={e => dialogue(shot.id, e.target.value)} />
        <button disabled={!active} onClick={() => { setSelected(shot.id); setPanel(panel === shot.id ? undefined : shot.id); }}>Layers</button>
        <LayerPanel shot={shot} folderPath="flow" thumbnailRevision={snapshot.project.revision} isOpen={panel === shot.id} isRendered={panel === shot.id}
          onLayerOpacityGesture={(shotId, layerId, opacity, phase) => {
            const key = `${shotId}/${layerId}`;
            if (phase === 'preview') { gestures.current = 1; setOpacityPreview(current => ({ ...current, [key]: opacity })); }
            else void request({ kind: 'layer', shotId, edit: { kind: 'setLayer', layerId, patch: { opacity } } }).catch(() => {}).finally(() => {
              gestures.current = 0; setOpacityPreview(current => { const next = { ...current }; delete next[key]; return next; });
            });
          }}
          structuralEditsEnabled={false} onToggle={() => setPanel(undefined)} onAddLayer={rejectTool} onRemoveLayer={rejectTool} onMergeLayers={rejectTool} onMergeVisibleLayers={rejectTool} onClearLayer={rejectTool}
          onSelectLayer={(id, layerId) => setLayers(current => ({ ...current, [id]: layerId }))}
          onUpdateLayer={(shotId, layerId, patch) => act({ kind: 'layer', shotId, edit: { kind: 'setLayer', layerId, patch } })}
          onMoveLayer={rejectTool} onMoveLayerGroup={rejectTool} onSelectedLayerIdsChange={() => {}}
          onUpdateLayerGroupOpacity={(shotId, ids, delta, initial) => {
            if (ids.length !== 1) { rejectTool(); return; }
            act({ kind: 'layer', shotId, edit: { kind: 'setLayer', layerId: ids[0], patch: { opacity: Math.max(0, Math.min(1, initial[ids[0]] + delta)) } } });
          }} />
      </Card>)}</div>}</SortableContext></DndContext>
      <aside aria-label="Pending"><h2>Pending</h2>{shots.slice(snapshot.project.shots.length).map(shot => <div key={shot.id} className="flow-pending"><span>{shot.fileName}</span><ShotStaticMedia shot={shot} folderPath="flow" revision={snapshot.project.revision} /></div>)}</aside>
    </main>
  </MediaSourceContext.Provider>;
}
function Card({ shot, disabled, selected, children }: { shot: Shot; disabled: boolean; selected: boolean; children: React.ReactNode }) {
  const sortable = useSortable({ id: shot.id, disabled });
  return <article className={`shot-card ${selected ? 'is-selected' : ''}`} data-shot-id={shot.id} ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}>
    <button aria-label={`Move ${shot.id}`} {...sortable.attributes} {...sortable.listeners}>{shot.fileName}</button>{children}
  </article>;
}
