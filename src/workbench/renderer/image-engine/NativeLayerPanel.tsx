import { Eye, EyeOff, LockKeyhole, LockKeyholeOpen, SquarePlus, Trash2, ChevronDown, ChevronRight, Folder, Layers, Image as ImageIcon, FileQuestion } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { ImageWorkspaceImageView } from '../../../platform/contracts/imageWorkspace';
import type { ImageEngineEdit, ImageEngineBlendMode } from '../../../platform/contracts/imageEngine';
import { layerDropPlacementFromClientY, layerOpacityFromClientX, layerRowDragIntentFromDelta, type LayerRowDragIntent } from '../../../drawing/renderer/sketchGeometry';
import { nativeBlendLabel, nativeLayerRows, nativeLayerReason, nativeLayerGestureKey, nativeLayerSelection, nativeOpacityChanges, NativeOpacityGesture, type NativeLayerView, type NativeOpacityEvent, type NativeLayerNameDraftEvent } from './nativeLayerPanelModel';
import '../styles/layer-panel.css';
import './native-layer-panel.css';

export type NativeLayerPanelProps = {
  image?: Omit<ImageWorkspaceImageView, 'layers'> & { readonly layers: readonly NativeLayerView[] };
  onSelect: (layerId: string) => void | Promise<void>;
  onEdit: (edit: ImageEngineEdit) => Promise<void>;
  onOpacityGesture: (event: NativeOpacityEvent) => void | Promise<void>;
  onNameDraftChange?: (event:NativeLayerNameDraftEvent)=>void;
  nameDrafts?:Readonly<Record<string,{name:string;composing:boolean}>>;
  canBeginGesture?: () => boolean;
  /** Main's explicit edit capability list. Missing capabilities fail closed. */
  allowedEdits?: readonly ImageEngineEdit['kind'][];
  disabledReason?: string;
  /** Routine input can disable controls without inserting a layout-changing notice. */
  showDisabledNotice?: boolean;
  isOpen?: boolean;
};
const modes: ImageEngineBlendMode[] = ['normal', 'multiply', 'screen'];
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Renders the Session's immutable projection. Only selection, text drafts and
 * transient gesture numbers are local; edits always return to the native owner. */
export function NativeLayerPanel({image, onSelect, onEdit, onOpacityGesture, onNameDraftChange, nameDrafts, canBeginGesture, allowedEdits = [], disabledReason, showDisabledNotice = true, isOpen = true}: NativeLayerPanelProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const anchor = useRef<string | undefined>(undefined);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string,string>>({});
  const nameComposing=useRef(new Set<string>());
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const selectingRef = useRef(false);
  const [visual, setVisual] = useState<{ids:readonly string[];intent:LayerRowDragIntent;deltaY:number}>();
  const [opacity, setOpacity] = useState<NativeOpacityGesture>();
  const opacityRef = useRef<NativeOpacityGesture | undefined>(undefined);
  const [, repaint] = useState(0);
  const cancelPointer = useRef<(() => void) | undefined>(undefined);
  const suppressClick = useRef(false);
  const section = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{id:string;x:number;y:number;blend:boolean}>();
  const callbacks = useRef({onEdit,onSelect,onOpacityGesture,canBeginGesture});
  callbacks.current = {onEdit,onSelect,onOpacityGesture,canBeginGesture};
  const layers = image?.layers ?? [];
  const rows = nativeLayerRows(layers, collapsed);
  const active = layers.find(l => l.id === image?.activeLayerId);
  const globalReason = disabledReason ?? (!image ? '请先选择故事板' : !['editable','reference'].includes(image.availability) ? image.issue?.message ?? '图片尚未准备好' : undefined);
  const protectedGesture = !!opacity && !['committed','canceled'].includes(opacity.state);
  const available = (kind: ImageEngineEdit['kind']) => !globalReason && !busy && !protectedGesture && allowedEdits.includes(kind);
  const reason = (layer: NativeLayerView, cap: keyof NativeLayerView['capabilities'], allowLocked = false) => globalReason ?? nativeLayerReason(layer, cap, allowLocked);
  const editReason = (kind:ImageEngineEdit['kind'], layer?:NativeLayerView, cap?:keyof NativeLayerView['capabilities'], allowLocked=false) =>
    globalReason ?? (!allowedEdits.includes(kind)?'当前引擎未提供这项操作':undefined) ?? (layer&&cap?nativeLayerReason(layer,cap,allowLocked):undefined) ?? (busy?'正在结算图层操作':protectedGesture?'请先完成或回滚透明度手势':undefined);
  const picked = layers.filter(l => selected.includes(l.id));
  const activeIndex = active ? layers.indexOf(active) : -1;
  const below = active && [...layers.slice(0,activeIndex)].reverse().find(l => l.visible && l.parentId === active.parentId);
  const mergeLayers = picked.length >= 2 ? picked : [below,active].filter((l):l is NativeLayerView => !!l);
  const canMerge = available('merge') && mergeLayers.length >= 2 && mergeLayers.every(l => l.visible && !reason(l,'structure') && l.parentId === mergeLayers[0].parentId);
  const visible = layers.filter(l => l.visible);
  const canMergeVisible = available('mergeVisible') && visible.length >= 2 && visible.every(l => !reason(l,'structure'));

  useEffect(() => {
    const ids = new Set(layers.map(l => l.id));
    setSelected(current => {
      const next = current.filter(id => ids.has(id));
      return image?.activeLayerId && !next.includes(image.activeLayerId) ? [image.activeLayerId] : next;
    });
  }, [image?.activeLayerId, image?.layers]);
  useEffect(() => {
    setCollapsed(new Set()); setSelected(image?.activeLayerId ? [image.activeLayerId] : []); anchor.current = undefined; setMenu(undefined);
    return () => { cancelPointer.current?.(); const held = opacityRef.current; if (held?.state === 'active') void held.finish('cancel').catch(() => {}); };
  }, [image?.imageId]);
  useEffect(() => { if (!isOpen) { cancelPointer.current?.(); setMenu(undefined); } }, [isOpen]);
  useEffect(() => { if (globalReason) cancelPointer.current?.(); }, [globalReason]);
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) return;
    el.showPopover();
    el.style.left = Math.max(4,Math.min(menu.x,innerWidth-el.offsetWidth-4))+'px';
    el.style.top = Math.max(4,Math.min(menu.y,innerHeight-el.offsetHeight-4))+'px';
    (el.querySelector<HTMLButtonElement>('button:not(:disabled)') ?? el).focus();
    const outside = (event: globalThis.PointerEvent) => { if (!event.composedPath().includes(el)) setMenu(undefined); };
    const close = () => setMenu(undefined);
    document.addEventListener('pointerdown',outside,true); window.addEventListener('blur',close);
    return () => { document.removeEventListener('pointerdown',outside,true); window.removeEventListener('blur',close); };
  }, [menu]);

  const select = (id:string, modifiers: {shiftKey?:boolean;metaKey?:boolean;ctrlKey?:boolean} = {}) => {
    if (protectedGesture || busyRef.current || selectingRef.current || cancelPointer.current) return;
    const next = nativeLayerSelection(rows.map(r => r.layer.id),selected,id,anchor.current,modifiers);
    anchor.current = next.anchorId; setSelected(next.selectedIds);
    const target = next.selectedIds.includes(id) ? id : next.selectedIds[0];
    if (target) {
      selectingRef.current=true;
      void Promise.resolve().then(() => callbacks.current.onSelect(target)).catch(e => setError(message(e))).finally(()=>{selectingRef.current=false;});
    }
  };
  const edit = async (value:ImageEngineEdit): Promise<boolean> => {
    if (!available(value.kind) || busyRef.current || callbacks.current.canBeginGesture?.() === false) return false;
    busyRef.current = true; setBusy(true);
    try { await callbacks.current.onEdit(value); setError(undefined); return true; }
    catch (e) { setError(message(e)); return false; }
    finally { busyRef.current = false; setBusy(false); }
  };
  const finishOpacity = async (held:NativeOpacityGesture, phase:'commit'|'cancel', retry = false) => {
    try {
      await held.finish(phase,retry);
      if (['committed','canceled'].includes(held.state) && opacityRef.current === held) { opacityRef.current = undefined; setOpacity(undefined); setError(undefined); }
    } catch (e) { setError(message(e)); }
  };
  const openMenu = (layer:NativeLayerView,x:number,y:number,blend=false) => {
    if (protectedGesture || busyRef.current || cancelPointer.current) return;
    if (!selected.includes(layer.id)) select(layer.id);
    setMenu({id:layer.id,x,y,blend});
  };
  const beginRow = (event:ReactPointerEvent<HTMLDivElement>,layer:NativeLayerView) => {
    if (event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || globalReason || busyRef.current || selectingRef.current || protectedGesture || cancelPointer.current || callbacks.current.canBeginGesture?.() === false || (event.target as Element).closest('button,select,textarea')) return;
    const ids = selected.includes(layer.id) ? selected : [layer.id];
    const targets = layers.filter(l => ids.includes(l.id));
    const canOpacity = allowedEdits.includes('setLayerOpacities') && targets.every(l => !reason(l,'properties'));
    const canMove = allowedEdits.includes('moveLayers') && targets.every(l => !reason(l,'structure') && l.parentId === layer.parentId);
    if (!canOpacity && !canMove) return;
    const selectedOnDown=!selected.includes(layer.id);
    if (selectedOnDown) select(layer.id);
    event.stopPropagation(); setMenu(undefined);
    const pointerId = event.pointerId; const x = event.clientX; const y = event.clientY;
    const row = event.currentTarget; const rect = row.getBoundingClientRect();
    const initialTarget = event.target;
    let intent:LayerRowDragIntent|undefined; let held:NativeOpacityGesture|undefined; let ended = false;
    const move = (e:globalThis.PointerEvent) => {
      if (e.pointerId !== pointerId || ended) return;
      if (selectingRef.current || !intent && callbacks.current.canBeginGesture?.() === false) return;
      const dx=e.clientX-x,dy=e.clientY-y;
      if (!intent) {
        const candidate=layerRowDragIntentFromDelta(dx,dy);
        if (!candidate || candidate==='opacity' && !canOpacity || candidate==='reorder' && !canMove) return;
        intent=candidate;
        if (initialTarget instanceof HTMLInputElement) initialTarget.blur();
        if (intent==='opacity') {
          const emitOpacity = callbacks.current.onOpacityGesture;
          held=new NativeOpacityGesture(nativeOpacityChanges(layers,ids,layer.opacity),emitOpacity,() => repaint(n=>n+1));
          opacityRef.current=held;setOpacity(held);
        }
      }
      e.preventDefault();setVisual({ids,intent,deltaY:intent==='reorder'?dy:0});
      if (intent==='opacity') held?.preview(nativeOpacityChanges(layers,ids,layerOpacityFromClientX(e.clientX,rect.left,rect.width),ids.length>1?dx/rect.width:undefined));
    };
    const finish = (cancelled:boolean,e?:globalThis.PointerEvent) => {
      if (ended) return; ended=true;
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('blur',cancel);window.removeEventListener('keydown',key,true);
      cancelPointer.current=undefined;setVisual(undefined);
      if (intent || selectedOnDown) { suppressClick.current=true;setTimeout(()=>{suppressClick.current=false;},0); }
      if (held) void finishOpacity(held,cancelled?'cancel':'commit');
      else if (intent==='reorder' && !cancelled && e) {
        const target=document.elementsFromPoint(e.clientX,e.clientY).map(el=>el.closest<HTMLElement>('.native-layer-panel .layer-row')).find(el=>el && section.current?.contains(el) && !ids.includes(el.dataset.layerId??''));
        const targetLayer=layers.find(l=>l.id===target?.dataset.layerId);
        if(target && targetLayer && targetLayer.parentId===layer.parentId && !reason(targetLayer,'structure')) {
          const r=target.getBoundingClientRect();
          void edit({kind:'moveLayers',layerIds:layers.filter(l=>ids.includes(l.id)).map(l=>l.id),targetLayerId:targetLayer.id,placement:layerDropPlacementFromClientY(e.clientY,r.top,r.height)});
        }
      }
    };
    const up=(e:globalThis.PointerEvent)=>{if(e.pointerId===pointerId)finish(e.type==='pointercancel',e);};
    const cancel=()=>finish(true);
    const key=(e:KeyboardEvent)=>{const action=nativeLayerGestureKey(e.key);if(action!=='pass'){e.preventDefault();e.stopPropagation();if(action==='cancel')cancel();}};
    cancelPointer.current=cancel;
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);window.addEventListener('blur',cancel);window.addEventListener('keydown',key,true);
  };
  const beginVisibility = (event:ReactPointerEvent<HTMLButtonElement>,layer:NativeLayerView) => {
    if(event.button!==0 || !available('setLayer') || reason(layer,'properties',true) || busyRef.current || selectingRef.current || cancelPointer.current || callbacks.current.canBeginGesture?.()===false)return;
    event.preventDefault();event.stopPropagation();
    const pointerId=event.pointerId;const visible=!layer.visible;const visited=new Set<string>();
    const queue:NativeLayerView[]=[];let running=false,ended=false,failed=false;
    const emitEdit=callbacks.current.onEdit;
    busyRef.current=true;setBusy(true);
    const release=()=>{if(ended&&!running){busyRef.current=false;setBusy(false);}};
    const pump=async()=>{
      if(running)return;running=true;
      try{while(queue.length){const target=queue.shift()!;await emitEdit({kind:'setLayer',layerId:target.id,patch:{visible}});}}
      catch(e){failed=true;queue.length=0;setError(message(e));}
      finally{running=false;release();}
    };
    const visit=(target:NativeLayerView)=>{if(failed||visited.has(target.id)||reason(target,'properties',true))return;visited.add(target.id);if(target.visible!==visible){queue.push(target);void pump();}};
    const move=(e:globalThis.PointerEvent)=>{if(e.pointerId!==pointerId)return;e.preventDefault();const button=document.elementsFromPoint(e.clientX,e.clientY).map(el=>el.closest<HTMLElement>('.native-layer-panel .layer-select')).find(el=>el&&section.current?.contains(el));const target=layers.find(l=>l.id===button?.dataset.layerId);if(target)visit(target);};
    const end=()=>{if(ended)return;ended=true;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);window.removeEventListener('blur',end);window.removeEventListener('keydown',key,true);cancelPointer.current=undefined;release();};
    const up=(e:globalThis.PointerEvent)=>{if(e.pointerId===pointerId)end();};
    const key=(e:KeyboardEvent)=>{if(nativeLayerGestureKey(e.key)!=='pass'){e.preventDefault();e.stopPropagation();if(e.key==='Escape')end();}};
    cancelPointer.current=end;visit(layer);
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);window.addEventListener('blur',end);window.addEventListener('keydown',key,true);
  };
  const submitName = async (layer:NativeLayerView) => {
    const key=JSON.stringify([image?.imageId,layer.id]);
    const name=names[key]??nameDrafts?.[layer.id]?.name; if(name===undefined || name===layer.name || nameComposing.current.has(key) || nameDrafts?.[layer.id]?.composing || cancelPointer.current || protectedGesture) return;
    if(await edit({kind:'setLayer',layerId:layer.id,patch:{name}})){onNameDraftChange?.({layerId:layer.id,name,composing:false,action:'confirmed'});setNames(current=>{if(current[key]!==name)return current;const next={...current};delete next[key];return next;});}
  };
  const menuLayer=layers.find(l=>l.id===menu?.id);
  const shownOpacity=(layer:NativeLayerView)=>opacity?.changes.find(c=>c.layerId===layer.id)?.opacity??layer.opacity;
  if(!isOpen)return null;
  return <section ref={section} className="layer-panel native-layer-panel" aria-label="图层" aria-busy={busy} onPointerDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} onKeyDown={e=>{
    if(e.key==='Escape'){setMenu(undefined);cancelPointer.current?.();}
    if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='a' && !(e.target instanceof HTMLInputElement)){e.preventDefault();if(!protectedGesture&&!cancelPointer.current)setSelected(e.shiftKey?[]:rows.map(r=>r.layer.id));}
  }}>
    <div className="native-layer-properties">
      <label>混合模式<select aria-label="混合模式" value={active?.blendMode??''} disabled={!active||!available('setLayer')||!!reason(active,'properties')} title={editReason('setLayer',active,'properties')} onChange={e=>{if(active)void edit({kind:'setLayer',layerId:active.id,patch:{blendMode:e.target.value as ImageEngineBlendMode}});}}>
        {!active&&<option value="">—</option>}{active&&!modes.includes(active.blendMode as ImageEngineBlendMode)&&<option value={active.blendMode}>{nativeBlendLabel(active.blendMode)}</option>}{modes.map(mode=><option key={mode} value={mode}>{nativeBlendLabel(mode)}</option>)}
      </select></label>
      <output title="左右拖动图层行可调整不透明度">不透明度 <b>{active?Math.round(shownOpacity(active)*100)+'%':'—'}</b></output>
      <button type="button" aria-label={active?.locked?'解锁当前图层':'锁定当前图层'} aria-pressed={!!active?.locked} disabled={!active||!available('setLayer')||!!reason(active,'properties',true)} title={editReason('setLayer',active,'properties',true)} onClick={()=>{if(active)void edit({kind:'setLayer',layerId:active.id,patch:{locked:!active.locked}});}}>{active?.locked?<LockKeyhole size={15}/>:<LockKeyholeOpen size={15}/>}</button>
    </div>
    {globalReason&&(!disabledReason||showDisabledNotice)&&<p className="native-layer-notice" role="status">{globalReason}</p>}
    {!globalReason&&!allowedEdits.length&&<p className="native-layer-notice" role="status">当前引擎未提供图层编辑能力</p>}
    <div className="layer-list" role="tree" aria-label="图层树" aria-multiselectable="true">
      {rows.map(({layer,depth,hasChildren})=>{const v=visual?.ids.includes(layer.id)?visual:undefined;const nameKey=JSON.stringify([image?.imageId,layer.id]);const Icon=layer.kind==='group'?Folder:layer.kind==='raster'?Layers:layer.kind==='reference'?ImageIcon:FileQuestion;
        return <div key={layer.id} data-layer-id={layer.id} role="treeitem" aria-level={depth+1} aria-selected={selected.includes(layer.id)} aria-expanded={hasChildren?!collapsed.has(layer.id):undefined} tabIndex={0}
          className={`layer-row ${selected.includes(layer.id)?'is-selected':''} ${active?.id===layer.id?'is-active':''} ${layer.visible?'':'is-hidden'} ${layer.locked?'is-locked':''} ${v?`is-${v.intent}-dragging is-dragging-layer`:''}`}
          style={{'--layer-opacity-width':`${shownOpacity(layer)*100}%`,'--native-layer-depth':depth,transform:v?.intent==='reorder'?`translateY(${v.deltaY}px)`:undefined} as CSSProperties}
          title={layer.readOnlyReason} onPointerDown={e=>beginRow(e,layer)} onClick={e=>{if(suppressClick.current){suppressClick.current=false;return;}select(layer.id,e);}}
          onContextMenu={e=>{e.preventDefault();e.stopPropagation();openMenu(layer,e.clientX,e.clientY);}}
          onKeyDown={e=>{if(e.target!==e.currentTarget)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();select(layer.id,e);}if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){e.preventDefault();const r=e.currentTarget.getBoundingClientRect();openMenu(layer,r.left+12,r.bottom);}if(['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const index=rows.findIndex(r=>r.layer.id===layer.id);const next=rows[index+(e.key==='ArrowDown'?1:-1)];if(next){select(next.layer.id,e);Array.from(section.current?.querySelectorAll<HTMLElement>('[role="treeitem"]')??[]).find(el=>el.dataset.layerId===next.layer.id)?.focus();}}}}>
          <button type="button" className="layer-select" data-layer-id={layer.id} aria-label={layer.visible?'隐藏图层':'显示图层'} disabled={!available('setLayer')||!!reason(layer,'properties',true)} title={editReason('setLayer',layer,'properties',true)} onPointerDown={e=>beginVisibility(e,layer)} onClick={e=>{e.stopPropagation();if(e.detail===0)void edit({kind:'setLayer',layerId:layer.id,patch:{visible:!layer.visible}});}}>{layer.visible?<Eye size={16}/>:<EyeOff size={16}/>}</button>
          <div className="native-layer-kind" title={`${{raster:'像素层',group:'图层组',reference:'参考内容',unsupported:'不支持的内容'}[layer.kind]}；尚无单层缩略图`}>
            {hasChildren?<button type="button" aria-label={collapsed.has(layer.id)?'展开图层组':'折叠图层组'} onClick={e=>{e.stopPropagation();setCollapsed(current=>{const next=new Set(current);if(next.has(layer.id))next.delete(layer.id);else next.add(layer.id);return next;});}}>{collapsed.has(layer.id)?<ChevronRight size={12}/>:<ChevronDown size={12}/>}</button>:<span className="native-layer-indent"/>}<Icon size={20}/>
          </div>
          <input aria-label="Layer name" value={names[nameKey]??nameDrafts?.[layer.id]?.name??layer.name} disabled={!available('setLayer')||!!reason(layer,'properties')} title={editReason('setLayer',layer,'properties')} onClick={e=>e.stopPropagation()} onFocus={()=>{if(!selected.includes(layer.id))select(layer.id);}}
            onChange={e=>{const name=e.target.value;setNames(current=>({...current,[nameKey]:name}));onNameDraftChange?.({layerId:layer.id,name,composing:nameComposing.current.has(nameKey),action:'change'});}}
            onCompositionStart={e=>{nameComposing.current.add(nameKey);onNameDraftChange?.({layerId:layer.id,name:e.currentTarget.value,composing:true,action:'change'});}}
            onCompositionEnd={e=>{nameComposing.current.delete(nameKey);const name=e.currentTarget.value;setNames(current=>({...current,[nameKey]:name}));onNameDraftChange?.({layerId:layer.id,name,composing:false,action:'change'});}}
            onBlur={()=>void submitName(layer)} onKeyDown={e=>{e.stopPropagation();if(e.nativeEvent.isComposing||nameComposing.current.has(nameKey))return;if(e.key==='Enter'){e.preventDefault();void submitName(layer);}if(e.key==='Escape'){e.preventDefault();onNameDraftChange?.({layerId:layer.id,name:layer.name,composing:false,action:'discard'});setNames(current=>{const next={...current};delete next[nameKey];return next;});}}}/>
          {layer.locked?<LockKeyhole size={12} aria-label="已锁定"/>:<span/>}
          <button type="button" className={`layer-blend-dot ${modes.includes(layer.blendMode as ImageEngineBlendMode)?`layer-blend-dot-${layer.blendMode}`:'native-blend-unknown'}`} aria-label={`图层混合模式：${nativeBlendLabel(layer.blendMode)}`} title={editReason('setLayer',layer,'properties')??nativeBlendLabel(layer.blendMode)} disabled={!available('setLayer')||!!reason(layer,'properties')} onClick={e=>{e.stopPropagation();const r=e.currentTarget.getBoundingClientRect();openMenu(layer,r.left,r.bottom,true);}}/>
          {layer.readOnlyReason&&<span className="native-layer-reason">{layer.readOnlyReason}</span>}
        </div>;
      })}
      {!rows.length&&<p className="layer-empty">{image?'暂无图层':'选择故事板以查看图层'}</p>}
    </div>
    {menu&&menuLayer&&<div ref={menuRef} className="native-layer-menu" popover="manual" role="menu" tabIndex={-1} aria-label={menu.blend?'混合模式':'图层操作'} onKeyDown={e=>{if(e.key==='Escape'){setMenu(undefined);e.preventDefault();}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const items=Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const i=items.indexOf(document.activeElement as HTMLButtonElement);items[(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}}}>
      {menu.blend?modes.map(mode=><button key={mode} type="button" role="menuitemradio" aria-checked={menuLayer.blendMode===mode} disabled={!available('setLayer')||!!reason(menuLayer,'properties')} title={editReason('setLayer',menuLayer,'properties')} onClick={()=>{setMenu(undefined);void edit({kind:'setLayer',layerId:menuLayer.id,patch:{blendMode:mode}});}}>{nativeBlendLabel(mode)}</button>):<>
        <button type="button" role="menuitem" disabled={!canMerge} title={!canMerge?'合并需要同组内可编辑、可见且未锁定的图层':undefined} onClick={()=>{setMenu(undefined);void edit({kind:'merge',layerIds:mergeLayers.map(l=>l.id)});}}>{picked.length>=2?'合并所选图层':'向下合并'}</button>
        <button type="button" role="menuitem" disabled={!canMergeVisible} title={!canMergeVisible?'可见内容包含不能合并的图层，或不足两层':undefined} onClick={()=>{setMenu(undefined);void edit({kind:'mergeVisible'});}}>合并可见图层</button>
        <button type="button" role="menuitem" disabled={!available('clear')||!!reason(menuLayer,'paint')} title={editReason('clear',menuLayer,'paint')} onClick={()=>{setMenu(undefined);void edit({kind:'clear',layerId:menuLayer.id});}}>清空图层</button>
      </>}
    </div>}
    <div className="layer-panel-footer"><div className="layer-panel-footer-group">
      <button type="button" aria-label="新增图层" title={globalReason??(!allowedEdits.includes('newLayer')?'当前引擎未提供新增图层':'新增图层')} disabled={!available('newLayer')} onClick={()=>void edit({kind:'newLayer',name:'新图层'})}><SquarePlus size={16}/></button>
      <button type="button" aria-label="删除当前图层" title={layers.length<=1?'至少保留一个图层':editReason('removeLayer',active,'structure')} disabled={!active||!available('removeLayer')||!!reason(active,'structure')||layers.length<=1} onClick={()=>{if(active)void edit({kind:'removeLayer',layerId:active.id});}}><Trash2 size={16}/></button>
    </div><span className="native-layer-count">{selected.length>1?`已选 ${selected.length} 层`:`${layers.length} 层`}</span></div>
    {error&&<div className="native-layer-error" role="alert"><p>{error}</p>{opacity?.state==='failed'&&<><p>透明度输入已保留，尚未确认提交。</p><button type="button" onClick={()=>void finishOpacity(opacity,'commit',true)}>重试透明度提交</button><button type="button" onClick={()=>void finishOpacity(opacity,'cancel')}>回滚透明度预览</button></>}</div>}
  </section>;
}
