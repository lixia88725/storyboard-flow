import {Fragment,useEffect,useRef,useState,useLayoutEffect,useContext,useMemo,useCallback,type ReactNode,type CSSProperties} from 'react';
import {flushSync,createPortal} from 'react-dom';
import {DndContext,PointerSensor,useSensor,useSensors,closestCenter,useDraggable} from '@dnd-kit/core';
import type {Shot} from '../../drawing/contracts/types';
import {ShotStaticMedia} from '../../storyboard/renderer/ShotStaticMedia';
import {CanvasPresentationContext,PresentationPreview} from '../../drawing/renderer/canvasPresentation';
import {FlowPending} from '../../storyboard/renderer/FlowPending';
import {BoardGrid} from '../../storyboard/renderer/workspace/BoardGrid';
import {useBoardSorting} from '../../storyboard/renderer/workspace/useBoardSorting';
import {defaultWorkspaceLayout, panelLabels as labels, readWorkspaceLayout, workspaceZoomSteps, writeWorkspaceLayout, type WorkspacePanel as Panel} from './workspace/layoutPreferences';
import {contentBoxOf,fitCanvasBox} from './workspace/canvasFit';
import {DockResizeHandle} from './workspace/DockResizeHandle';
import {DockPanelIcon,DockChevron} from './workspace/DockIcons';
import {BoardDialogue} from '../../storyboard/renderer/workspace/BoardDialogue';
import './workbench.css';

// Immutable options keep useSensor's memo stable without moving the hook out of the component.
const pointerSensorOptions={activationConstraint:{distance:6}} as const;

export type WorkbenchProps={
 dialogueText:ReadonlyMap<string,string>;name:string;shots:Shot[];parked:Shot[];selected:string[];revision:number;disabled:boolean;status:string;
 renderDialogue:(id:string,compact?:boolean)=>ReactNode;
 toolbar:ReactNode;actions:ReactNode;toolRail:ReactNode;boardActions:ReactNode;
 /** Persistent project fields, kept out of the per-session editor panes. */
 projectBar?:ReactNode;
 select:(id:string,event:{shiftKey?:boolean;metaKey?:boolean;ctrlKey?:boolean})=>void;
 focus:(id:string)=>void;selectMany:(ids:string[])=>void;selectAll:()=>void;clearSelection:()=>void;canNavigate:()=>boolean;canStartCanvasEdit:()=>boolean;canContinueBrush:(shot:Shot)=>boolean;demand:(ids:string[])=>void;
 move:(ids:string[],destination:'active'|'pending',before?:string)=>void;
 /** Pending-only removal; the sheet's own selection decides the count. */
 remove:(ids:string[])=>void;
 /** Boards holding unconfirmed text or an unsettled commit; their cards stay mounted. */
 holdShots?:string[];
 renderCanvas:(shot:Shot,previous?:Shot,next?:Shot)=>ReactNode;
 renderLayers:(shot:Shot)=>ReactNode;renderInfo:(shot:Shot,allowDialogueDrag?:boolean)=>ReactNode;
};
export function Workbench(p:WorkbenchProps){
 const [dialogueEditing,setDialogueEditing]=useState<string>();
 const [saved]=useState(readWorkspaceLayout);
 const [heights,setHeights]=useState(saved.heights);
 const [collapsed,setCollapsed]=useState(saved.collapsed);
 const [flyout,setFlyout]=useState<(Panel|undefined)[]>([undefined,undefined]);
 const toggleColumn=(col:number)=>{if(!p.canNavigate())return;setCollapsed(old=>old.map((v,i)=>i===col?!v:v) as [boolean,boolean]);setFlyout([undefined,undefined]);};
 const [japanese,setJapanese]=useState(saved.japanese);
 const [layout,setLayout]=useState(saved.layout),[hidden,setHidden]=useState(saved.hidden);
 const [split,setSplit]=useState(saved.split),[tile,setTile]=useState(saved.tile),[zoom,setZoom]=useState(saved.zoom),[onion,setOnion]=useState(false);
 useEffect(()=>{
   const timer=window.setTimeout(()=>{
     writeWorkspaceLayout({layout,hidden,split,tile,zoom,japanese,heights,collapsed});
   },100);
   return ()=>window.clearTimeout(timer);
 },[layout,hidden,split,tile,zoom,japanese,heights,collapsed]);
 const [hovered,setHovered]=useState<string | undefined>(undefined),[live,setLive]=useState<{id:string;surface:string;node:HTMLElement}>();
 // Hover must not mount a canvas mid-drag: that swaps the picture, flushes a full
 // grid render and re-reads assets while the pointer is sorting cards.
 const dragging=useRef(false);
 const visible=useRef(new Set<string>()),[visibilityVersion,setVisibilityVersion]=useState(0);
 const current=p.shots.find(s=>p.selected.includes(s.id));
 const index=p.shots.findIndex(s=>s.id===current?.id);
 const root=useRef<HTMLDivElement>(null),settleTimer=useRef<number | undefined>(undefined);
 const sensors=useSensors(useSensor(PointerSensor,pointerSensorOptions));
 const currentProps=useRef(p);currentProps.current=p;
 const sorting=useBoardSorting(p,root,dragging,point=>requestAnimationFrame(()=>{
  const card=document.elementFromPoint(point.x,point.y)?.closest<HTMLElement>('[data-board-id]');
  if(card&&currentProps.current.canStartCanvasEdit())setHovered(card.dataset.boardId);
 }));
 const demandKey=useMemo(()=>JSON.stringify([...p.shots.filter(s=>visible.current.has(s.id)||s.id===current?.id||s.id===hovered||(onion&&!hidden.includes('canvas')&&(s.id===p.shots[index-1]?.id||s.id===p.shots[index+1]?.id))),...(!hidden.includes('pending')?p.parked.filter(s=>visible.current.has(s.id)):[])].flatMap(s=>(s.layers??[]).map(l=>l.bitmapPath.split('/').at(-1)!))),[p.shots,p.parked,visibilityVersion,hovered,current?.id,index,onion,hidden]);
 useEffect(()=>{p.demand(JSON.parse(demandKey));},[demandKey,visibilityVersion]);
 useEffect(()=>()=>window.clearTimeout(settleTimer.current),[]);
 const reportVisible=(id:string,value:boolean)=>{const changed=value?!visible.current.has(id):visible.current.has(id);if(!changed)return;value?visible.current.add(id):visible.current.delete(id);setVisibilityVersion(v=>v+1);};
 const navigate=(offset:number)=>{if(!current||!p.canNavigate())return;const next=p.shots[Math.max(0,Math.min(p.shots.length-1,index+offset))];p.focus(next.id);};
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{if(e.defaultPrevented||e.metaKey||e.ctrlKey||e.altKey||e.shiftKey||!(e.key==='ArrowLeft'||e.key==='ArrowRight'))return;
   if(e.target instanceof Element&&e.target.closest('input,textarea,select,[contenteditable=true],[role=dialog],dialog'))return;
   e.preventDefault();navigate(e.key==='ArrowLeft'?-1:1);
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[p.shots,p.selected,p.canNavigate]);
 useEffect(()=>{if(!current||live)return;const card=Array.from(root.current?.querySelectorAll<HTMLElement>('[data-board-id]')??[]).find(el=>el.dataset.boardId===current.id);
  if(card){const scroll=card.closest('.wb-panel-body')!,a=card.getBoundingClientRect(),b=scroll.getBoundingClientRect();if(a.top<b.top||a.bottom>b.bottom)card.scrollIntoView({block:'nearest',inline:'nearest'});}
 },[current?.id]);
 const settle=()=>{window.clearTimeout(settleTimer.current);settleTimer.current=window.setTimeout(()=>{if(currentProps.current.canStartCanvasEdit())setLive(undefined);else settle();},80);};
 const viewerRef=useRef<HTMLDivElement|null>(null);
 const [fitBox,setFitBox]=useState<{width:number;height:number}|undefined>();
 // "适合" mode: the canvas keeps its aspect ratio and stays completely inside the panel.
 // Measure the panel body, not the viewer: the viewer is content-high, so measuring it
 // would ratchet the canvas smaller on every shrink and never let it grow back.
 useLayoutEffect(()=>{
  if(zoom!=='fit'||!current)return;
  const element=viewerRef.current,host=element?.parentElement;
  if(!element||!host)return;
  const tools=element.previousElementSibling instanceof HTMLElement?element.previousElementSibling:null;
  const measure=()=>{
   const style=getComputedStyle(element);
   const content=contentBoxOf(
     {clientWidth:host.clientWidth,clientHeight:host.clientHeight-(tools?.getBoundingClientRect().height??0)},
     {left:parseFloat(style.paddingLeft)||0,top:parseFloat(style.paddingTop)||0,right:parseFloat(style.paddingRight)||0,bottom:parseFloat(style.paddingBottom)||0});
   setFitBox(content?fitCanvasBox({containerWidth:content.width,containerHeight:content.height,aspectRatio:(current.flow?.canvasWidth??640)/(current.flow?.canvasHeight??360)}):undefined);
  };
  measure();
  const observer=new ResizeObserver(measure);observer.observe(host);if(tools)observer.observe(tools);
  return()=>observer.disconnect();
 },[zoom,current?.id,current?.flow?.canvasWidth,current?.flow?.canvasHeight,layout,hidden,collapsed,flyout]);
 const presentation=useContext(CanvasPresentationContext);
 const track=(shot:Shot,key:string,footer=false)=><BoardDialogue shotId={shot.id} height={shot.flow?.canvasHeight??360}
   footer={footer} text={p.dialogueText.get(shot.id)??''} editing={dialogueEditing===key} disabled={p.disabled}
   holding={Boolean(p.holdShots?.includes(shot.id))}
   editor={dialogueEditing===key?p.renderDialogue(shot.id,true):null}
   begin={()=>{if(p.disabled||!p.canNavigate())return false;p.focus(shot.id);setDialogueEditing(key);return true;}}
   end={()=>setDialogueEditing(current=>current===key?undefined:current)}/>;
 const surface=(shot:Shot,where:string,editable:boolean)=>{
  const key=where+':'+shot.id,other=live?.id===shot.id&&live.surface!==key;
  return <div className="wb-surface" data-surface={key} onPointerDownCapture={e=>{
   if(e.target instanceof Element&&e.target.closest('[data-board-dialogue]'))return;
   if(!p.disabled && editable && live?.surface===key && e.isPrimary && e.button===0 && p.canContinueBrush(shot))return;
   if(p.disabled || !(editable ? p.canStartCanvasEdit() : p.canNavigate())){e.preventDefault();e.stopPropagation();return;}
   flushSync(()=>{p.focus(shot.id);setLive({id:shot.id,surface:key,node:e.currentTarget});});
  }} onPointerUpCapture={settle} onPointerCancelCapture={settle}>
   <div>{editable?p.renderCanvas(shot,where==='viewer'&&onion?p.shots[index-1]:undefined,where==='viewer'&&onion?p.shots[index+1]:undefined):<PresentationPreview shotId={shot.id} width={shot.flow?.canvasWidth??640} height={shot.flow?.canvasHeight??360}><ShotStaticMedia shot={shot} folderPath="flow" revision={p.revision}/></PresentationPreview>}</div>
   {presentation[shot.id]?.dialogue&&track(shot,key)}
   {other&&<LiveMirror source={live.node} shot={shot}/>}
  </div>;
 };
 const content=(panel:Panel):ReactNode=>{
  if(panel==='board')return <><div className="wb-panel-tools wb-board-tools"><button aria-pressed={japanese} onClick={()=>{if(p.canNavigate())setJapanese(!japanese);}}>日式分镜</button><span>{p.shots.length} 张 · {p.selected.length} 已选</span><label>缩略图 <input aria-label="缩略图大小" type="range" min="150" max="460" value={tile} onChange={e=>{if(p.canNavigate())setTile(Number(e.target.value));}}/></label><div className="wb-board-selection"><button disabled={p.disabled||!p.shots.length} title="全选故事板（⌘/Ctrl+A）" onClick={()=>{if(p.canNavigate())p.selectAll();}}>全选</button><button disabled={p.disabled||!p.selected.length} onClick={()=>{if(p.canNavigate())p.clearSelection();}}>取消选择</button></div><div className="wb-board-actions">{p.boardActions}</div></div>
   <BoardGrid japanese={japanese} tile={tile} selected={p.selected} order={p.shots.map(s=>s.id)} disabled={p.disabled} canSelect={p.canNavigate} onSelect={p.selectMany}>
    {p.shots.map((shot,i)=><BoardCard key={shot.id} shot={shot} index={i} selected={p.selected.includes(shot.id)} disabled={p.disabled} onSelect={e=>{if(p.canNavigate())p.select(shot.id,e);}}
     hold={Boolean(p.holdShots?.includes(shot.id))} force={hovered===shot.id}
     footer={!japanese&&!presentation[shot.id]?.dialogue?track(shot,'footer:'+shot.id,true):null} rowInfo={japanese ? shot=>p.renderInfo(shot,true) : undefined} visible={reportVisible} activate={()=>{if(!dragging.current&&!root.current?.querySelector('[data-marquee-active="true"]')&&p.canStartCanvasEdit())flushSync(()=>setHovered(shot.id));}}>
     {surface(shot,'grid',hovered===shot.id)}
    </BoardCard>)}
   </BoardGrid></>;
  if(panel==='canvas')return <><div className="wb-panel-tools"><div><button aria-label="上一张" disabled={!current||index===0} onClick={()=>navigate(-1)}>←</button><span className="wb-position">{current?index+1:0} / {p.shots.length}</span><button aria-label="下一张" disabled={!current||index===p.shots.length-1} onClick={()=>navigate(1)}>→</button></div><button aria-pressed={onion} onClick={()=>{if(p.canNavigate())setOnion(!onion);}}>洋葱皮</button><label>画布 <select aria-label="画布缩放" value={String(zoom)} onChange={e=>{if(!p.canNavigate())return;const value=e.target.value;setZoom(value==='fit'?'fit':Number(value));}}><option value="fit">适合</option>{workspaceZoomSteps.map(n=><option key={n} value={n}>{n}%</option>)}</select></label></div>
   <div className={'wb-viewer'+(current?'':' is-empty')} ref={viewerRef} data-current-shot={current?.id}>{current?(zoom==='fit'
     ?<div style={{height:'100%',display:'flex',alignItems:'center',justifyContent:'center'}}><div style={fitBox?{width:fitBox.width,height:fitBox.height,flex:'none'}:{width:'100%'}}>{surface(current,'viewer',true)}</div></div>
     :<div style={{width:zoom+'%',minWidth:zoom+'%'}}>{surface(current,'viewer',true)}</div>):<p className="wb-empty">选择一张故事板开始绘制</p>}</div></>;
  if(panel==='info')return current?p.renderInfo(current,true):<p className="wb-empty">尚未选择故事板</p>;
  if(panel==='layers')return current?p.renderLayers(current):null;
  return <FlowPending stationary shots={p.parked} disabled={p.disabled} revision={p.revision} onRestore={id=>p.move([id],'active')} onDelete={p.remove} renderMedia={shot=><PendingPreview shot={shot} revision={p.revision} visible={reportVisible}/>}/>;
 };
 const movePanel=(e:React.DragEvent,column:number,before?:Panel)=>{const id=e.dataTransfer.getData('application/x-flow-panel') as Panel;if(!labels[id]||!p.canNavigate())return;e.preventDefault();e.stopPropagation();setLayout(old=>{const next=old.map(col=>col.filter(v=>v!==id));const at=before?next[column].indexOf(before):-1;next[column].splice(at<0?next[column].length:at,0,id);return next;});};
 return <main ref={root} className="flow-workbench" data-flow-editor="true" data-workbench="true" data-revision={p.revision} onClickCapture={e=>{if(sorting.skipClick.current&&e.detail>0){e.preventDefault();e.stopPropagation();}}} onPointerDownCapture={e=>{if(!dragging.current)sorting.skipClick.current=false;if(flyout.some(Boolean)&&e.target instanceof Element&&!e.target.closest('.wb-column.is-collapsed')&&p.canNavigate())setFlyout([undefined,undefined]);}} onKeyDown={e=>{
   sorting.skipClick.current=false;
   if(e.key==='Escape'&&flyout.some(Boolean)&&p.canNavigate()){e.preventDefault();setFlyout([undefined,undefined]);return;}
   if(e.defaultPrevented||e.altKey||!(e.metaKey||e.ctrlKey)||e.key.toLowerCase()!=='a')return;
   const target=e.target as Element;
   if(!target.closest('[data-panel="board"]')||target.closest('input,textarea,select,[contenteditable=true],dialog,[role=dialog]'))return;
   e.preventDefault();if(!p.disabled&&p.canNavigate())(e.shiftKey?p.clearSelection:p.selectAll)();
  }}>
  <header className="wb-header"><nav aria-label="项目操作">{p.actions}<details className="wb-panel-menu"><summary>面板</summary><div className="wb-menu">{(Object.keys(labels) as Panel[]).map(id=><label key={id}><input type="checkbox" data-panel-toggle={id} checked={!hidden.includes(id)} onChange={()=>{if(p.canNavigate())setHidden(h=>h.includes(id)?h.filter(v=>v!==id):[...h,id]);}}/>{labels[id]}</label>)}<button onClick={()=>{if(p.canNavigate()){const defaults=defaultWorkspaceLayout();setLayout(defaults.layout);setHidden(defaults.hidden);setHeights(defaults.heights);setJapanese(defaults.japanese);setSplit(defaults.split);setZoom(defaults.zoom);setTile(defaults.tile);setCollapsed(defaults.collapsed);setFlyout([undefined,undefined]);}}}>恢复默认布局</button></div></details></nav></header>
  {p.projectBar}
  <div className="wb-toolbar">{p.toolbar}</div>
  <div className="wb-main-row">{p.toolRail}<div className="wb-work-area">
  <DndContext autoScroll={false} sensors={sensors} collisionDetection={closestCenter} onDragStart={sorting.start} onDragCancel={sorting.cancel} onDragEnd={sorting.end}>
   <div className="wb-dock" style={{gridTemplateColumns:collapsed[0]?(collapsed[1]?'40px minmax(0,1fr) 40px':'40px 5px minmax(260px,1fr)'):(collapsed[1]?'minmax(240px,1fr) 5px 40px':`minmax(240px, ${split}fr) 5px minmax(260px, ${100-split}fr)`)}}>
    {layout.map((panels,col)=>{const shown=panels.filter(id=>!hidden.includes(id));return <div key={col} className={'wb-column'+(collapsed[col]?' is-collapsed':'')} data-dock-column={col} style={{gridColumn:col?3:1,'--wb-panel-count':Math.max(1,shown.length)} as CSSProperties} onDragOver={e=>{if(!collapsed[col]&&e.dataTransfer.types.includes('application/x-flow-panel'))e.preventDefault();}} onDrop={e=>{if(!collapsed[col])movePanel(e,col);}}>
     <div className="wb-column-cap"><button aria-label={(collapsed[col]?'展开':'折叠')+(col?'右栏':'左栏')} aria-expanded={!collapsed[col]} title={(collapsed[col]?'展开':'折叠')+(col?'右栏':'左栏')} onClick={()=>toggleColumn(col)}><DockChevron right={collapsed[col]?!col:Boolean(col)}/></button></div>
     {collapsed[col]&&<div className="wb-dock-icons">{shown.map(id=><button key={id} aria-label={'打开'+labels[id]+'面板'} title={labels[id]} aria-expanded={flyout[col]===id} onClick={()=>{if(p.canNavigate())setFlyout(old=>old.map((v,i)=>i===col?(v===id?undefined:id):undefined));}}><DockPanelIcon panel={id}/></button>)}</div>}
     {shown.map((id,i)=><Fragment key={id}>
      {!collapsed[col]&&i>0&&<DockResizeHandle above={shown[i-1]} below={id} canResize={p.canNavigate} onCommit={values=>setHeights(old=>({...old,...values}))}/>}
      <section className={'wb-panel wb-panel-'+id+(collapsed[col]?' wb-panel-flyout':'')} data-panel={id} tabIndex={id==='board'?-1:undefined} style={{height:heights[id],display:collapsed[col]&&flyout[col]!==id?'none':undefined}}
       onPointerDownCapture={e=>{if(id==='board'&&e.isPrimary&&e.button===0&&e.target instanceof Element&&!e.target.closest('input,textarea,select,button,[contenteditable=true]'))e.currentTarget.focus({preventScroll:true});}}
       onDragOver={e=>{if(!collapsed[col]&&e.dataTransfer.types.includes('application/x-flow-panel'))e.preventDefault();}} onDrop={e=>{if(!collapsed[col])movePanel(e,col,id);}}>
       <header draggable={!collapsed[col]} onDragStart={e=>{if(!p.canNavigate()){e.preventDefault();return;}e.dataTransfer.setData('application/x-flow-panel',id);}}><span className="wb-panel-title">{labels[id]}</span><button aria-label={(collapsed[col]?'关闭':'隐藏')+labels[id]} title={collapsed[col]?'关闭展开面板':'隐藏'+labels[id]+'，可在右上角「面板」中重新打开'} onClick={()=>{if(p.canNavigate()){if(collapsed[col])setFlyout([undefined,undefined]);else setHidden(h=>[...h,id]);}}}>×</button></header><div className="wb-panel-body">{content(id)}</div>
      </section>
     </Fragment>)}
    </div>})}
    <div className={'wb-divider'+(collapsed.some(Boolean)?' is-inactive':'')} aria-disabled={collapsed.some(Boolean)} role="separator" aria-label="面板分隔" aria-orientation="vertical" tabIndex={collapsed.some(Boolean)?-1:0} onKeyDown={e=>{if(!collapsed.some(Boolean)&&p.canNavigate()&&['ArrowLeft','ArrowRight'].includes(e.key)){e.stopPropagation();e.preventDefault();setSplit(v=>Math.max(25,Math.min(75,v+(e.key==='ArrowRight'?2:-2))));}}} onPointerDown={e=>{if(collapsed.some(Boolean)||!p.canNavigate())return;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){const r=e.currentTarget.parentElement!.getBoundingClientRect();setSplit(Math.max(25,Math.min(75,(e.clientX-r.left)/r.width*100)));}}}/>
   </div>
  {sorting.overlay}</DndContext>
  </div></div>
  <footer className="wb-status"><span role="status">{p.status}</span><span>画布落笔 · 顶部排序 · ← → 翻板</span></footer>
 </main>;
}
function BoardCard({shot,index,selected,disabled,onSelect,visible,activate,children,rowInfo,footer,hold,force}:{footer:ReactNode;rowInfo?:(shot:Shot)=>ReactNode;shot:Shot;index:number;selected:boolean;disabled:boolean;onSelect:(e:{shiftKey?:boolean;metaKey?:boolean;ctrlKey?:boolean})=>void;visible:(id:string,v:boolean)=>void;activate:()=>void;children:ReactNode;hold?:boolean;force?:boolean}){
 const modifiedPicture=useRef(false),modifiedHeader=useRef(false);
 const sortable=useDraggable({id:shot.id,disabled});const element=useRef<HTMLElement|null>(null),[near,setNear]=useState(false);const report=useRef(visible);report.current=visible;
 // A stable ref keeps dnd-kit's ResizeObserver attached; an inline arrow detaches and
 // re-attaches it on every render, which is expensive while dragging.
 const setCard=useCallback((el:HTMLElement|null)=>{element.current=el;sortable.setNodeRef(el);},[sortable.setNodeRef]);
 // The observer is re-created on reorder because the index dependency is the only
 // reliable reset after a transformed card may have reported a false intersection.
 useEffect(()=>{const observer=new IntersectionObserver(entries=>{const value=entries[0].isIntersecting;setNear(value);report.current(shot.id,value);},{rootMargin:'80px'});if(element.current)observer.observe(element.current);return()=>{observer.disconnect();report.current(shot.id,false);};},[shot.id,index]);
 // Unconfirmed IME text must survive a scroll: hold the mounted editor even when the card
 // leaves the near window. The hovered card is forced so a drop or hover stays drawable
 // even if its intersection state lagged while it was being transformed.
 const shown=near||Boolean(hold)||Boolean(force);
 return <article ref={setCard} data-board-id={shot.id} className={'wb-card'+(selected?' is-selected':'')}>
  <button className="wb-card-handle" aria-label={'选择故事板 '+shot.id} {...sortable.attributes} {...sortable.listeners} onPointerDownCapture={e=>{modifiedHeader.current=e.isPrimary&&e.button===0&&Boolean(e.shiftKey||e.metaKey||e.ctrlKey);if(modifiedHeader.current){e.currentTarget.focus({preventScroll:true});e.preventDefault();e.stopPropagation();if(!disabled)onSelect(e);}}}
   onContextMenu={e=>{if(e.ctrlKey)e.preventDefault();}} onKeyDownCapture={()=>{modifiedHeader.current=false;}}
   onClick={e=>{if(modifiedHeader.current){modifiedHeader.current=false;return;}onSelect(e);}}><b>{String(index+1).padStart(3,'0')}</b><span className="wb-card-grip" aria-hidden="true">⠿</span></button>
  <div className="wb-card-picture" style={{aspectRatio:`${shot.flow?.canvasWidth??640}/${shot.flow?.canvasHeight??360}`}} onPointerEnter={activate} onContextMenu={e=>{if(e.ctrlKey)e.preventDefault();}}
    onPointerDownCapture={e=>{modifiedPicture.current=e.isPrimary&&e.button===0&&Boolean(e.shiftKey||e.metaKey||e.ctrlKey);if(!modifiedPicture.current||e.target instanceof Element&&e.target.closest('input,textarea,[contenteditable=true],[data-board-dialogue]')){modifiedPicture.current=false;return;}e.preventDefault();e.stopPropagation();if(!disabled)onSelect(e);}}
    onMouseDownCapture={e=>{if(modifiedPicture.current){e.preventDefault();e.stopPropagation();}}}
    onClickCapture={e=>{if(modifiedPicture.current){e.preventDefault();e.stopPropagation();modifiedPicture.current=false;}}}>{shown?children:null}</div>
  {shown&&footer}
  {rowInfo && <div className="wb-row-info">{shown && rowInfo(shot)}</div>}
 </article>;
}
function LiveMirror({source,shot}:{source:HTMLElement;shot:Shot}){
 const anchor=useRef<HTMLSpanElement>(null),ref=useRef<HTMLCanvasElement>(null);
 const [target,setTarget]=useState<HTMLElement|null>(null);
 // Mirror only the raster plane. The destination owns its matte, dialogue and geometry.
 useLayoutEffect(()=>{setTarget(anchor.current?.parentElement?.querySelector<HTMLElement>('.image-stage')??null);});
 useLayoutEffect(()=>{
  const canvas=ref.current, stage=source.querySelector('.image-stage');
  if(!canvas||!stage||!target)return;
  const ctx=canvas.getContext('2d');if(!ctx)return;
  let frame=0;
  const draw=()=>{
   const nodes=Array.from(stage.querySelectorAll<HTMLImageElement|HTMLCanvasElement>(':scope > img, :scope > canvas, :scope > .stage-overlay canvas'))
    .filter(node=>getComputedStyle(node).display!=='none'&&getComputedStyle(node).visibility!=='hidden');
   // Keep the last complete frame while the renderer decodes a replacement layer.
   if(nodes.length && nodes.every(node=>node instanceof HTMLImageElement ? node.complete&&node.naturalWidth>0 : node.width>0&&node.height>0)){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    for(const node of nodes){const style=getComputedStyle(node);ctx.save();ctx.globalAlpha=Number(style.opacity);ctx.globalCompositeOperation=(style.mixBlendMode==='normal'?'source-over':style.mixBlendMode) as GlobalCompositeOperation;ctx.drawImage(node,0,0,canvas.width,canvas.height);ctx.restore();}
    canvas.dataset.ready='true';
   }
   frame=requestAnimationFrame(draw);
  };
  draw();return()=>cancelAnimationFrame(frame);
 },[source,target,shot.flow?.canvasWidth,shot.flow?.canvasHeight]);
 return <><span hidden ref={anchor}/>{target&&createPortal(<canvas aria-hidden="true" data-live-mirror="true" ref={ref} width={shot.flow?.canvasWidth??640} height={shot.flow?.canvasHeight??360}/>,target)}</>;

}

function PendingPreview({shot,revision,visible}:{shot:Shot;revision:number;visible:(id:string,value:boolean)=>void}) {
 const element=useRef<HTMLDivElement>(null),[near,setNear]=useState(false),report=useRef(visible);report.current=visible;
 useEffect(()=>{const observer=new IntersectionObserver(entries=>{const value=entries[0].isIntersecting;setNear(value);report.current(shot.id,value);},{rootMargin:'80px'});if(element.current)observer.observe(element.current);return()=>{observer.disconnect();report.current(shot.id,false);};},[shot.id]);
 return <div ref={element} style={{aspectRatio:`${shot.flow?.canvasWidth??640}/${shot.flow?.canvasHeight??360}`}}>{near&&<PresentationPreview shotId={shot.id} width={shot.flow?.canvasWidth??640} height={shot.flow?.canvasHeight??360}><ShotStaticMedia shot={shot} folderPath="flow" revision={revision}/></PresentationPreview>}</div>;
}
