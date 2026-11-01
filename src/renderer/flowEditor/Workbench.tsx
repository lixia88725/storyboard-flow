import {useEffect,useRef,useState,useContext,type ReactNode,type CSSProperties} from 'react';
import {flushSync} from 'react-dom';
import {DndContext,PointerSensor,useSensor,useSensors,closestCenter} from '@dnd-kit/core';
import {SortableContext,useSortable,rectSortingStrategy} from '@dnd-kit/sortable';
import {CSS} from '@dnd-kit/utilities';
import type {Shot} from '../../shared/types';
import {ShotStaticMedia} from '../ShotStaticMedia';
import {CanvasPresentationContext,PresentationPreview} from '../canvasPresentation';
import {FlowPending,pendingDropId} from './FlowPending';
import {draggedShots} from './boardSelection';
import './workbench.css';

type Panel='board'|'canvas'|'info'|'layers'|'pending';
const labels:Record<Panel,string>={board:'故事板',canvas:'画布',info:'动作与对白',layers:'图层',pending:'Pending'};
const initial:Panel[][]=[['board','pending'],['canvas','info','layers']];
const layoutKey = 'flow.workbench.layout.v1';
const defaults = {layout: initial, hidden: [] as Panel[], split: 48, tile: 220, zoom: 100, japanese: false, heights: {} as Partial<Record<Panel, number>>};
function readLayout(): typeof defaults {
  try {
    const value = JSON.parse(localStorage.getItem(layoutKey) || 'null');
    const panels = Object.keys(labels);
    if (!Array.isArray(value?.layout) || value.layout.length !== 2 || !value.layout.every(Array.isArray) ||
        value.layout.flat().sort().join() !== panels.sort().join() ||
        !Array.isArray(value.hidden) || !value.hidden.every((id: string) => panels.includes(id)) ||
        !Number.isFinite(value.split) || value.split < 25 || value.split > 75 ||
        !Number.isFinite(value.tile) || value.tile < 150 || value.tile > 460 ||
        ![50,75,100,150,200].includes(value.zoom) || typeof value.japanese !== 'boolean') return defaults;
    const heights = Object.fromEntries(Object.entries(value.heights ?? {}).filter(([id, height]) =>
      panels.includes(id) && typeof height === 'number' && Number.isFinite(height) && height >= 100 && height <= 10000));
    return {...value, heights};
  } catch { return defaults; }
}
export type WorkbenchProps={
 name:string;shots:Shot[];parked:Shot[];selected:string[];revision:number;disabled:boolean;status:string;
 toolbar:ReactNode;actions:ReactNode;
 select:(id:string,event:{shiftKey?:boolean;metaKey?:boolean;ctrlKey?:boolean})=>void;
 focus:(id:string)=>void;canNavigate:()=>boolean;canStartCanvasEdit:()=>boolean;canContinueBrush:(shot:Shot)=>boolean;demand:(ids:string[])=>void;
 move:(ids:string[],destination:'active'|'pending',before?:string)=>void;
 renderCanvas:(shot:Shot,previous?:Shot,next?:Shot)=>ReactNode;
 renderLayers:(shot:Shot)=>ReactNode;renderInfo:(shot:Shot)=>ReactNode;
};
export function Workbench(p:WorkbenchProps){
 const [saved]=useState(readLayout);
 const [heights,setHeights]=useState(saved.heights);
 const [japanese,setJapanese]=useState(saved.japanese);
 const [layout,setLayout]=useState(saved.layout),[hidden,setHidden]=useState(saved.hidden);
 const [split,setSplit]=useState(saved.split),[tile,setTile]=useState(saved.tile),[zoom,setZoom]=useState(saved.zoom),[onion,setOnion]=useState(false);
 useEffect(()=>{
   const timer=window.setTimeout(()=>{
     try { localStorage.setItem(layoutKey,JSON.stringify({layout,hidden,split,tile,zoom,japanese,heights})); } catch { /* Layout stays usable without profile storage. */ }
   },100);
   return ()=>window.clearTimeout(timer);
 },[layout,hidden,split,tile,zoom,japanese,heights]);
 const [hovered,setHovered]=useState<string | undefined>(undefined),[live,setLive]=useState<{id:string;surface:string;node:HTMLElement}>();
 const visible=useRef(new Set<string>()),[visibilityVersion,setVisibilityVersion]=useState(0);
 const current=p.shots.find(s=>p.selected.includes(s.id));
 const index=p.shots.findIndex(s=>s.id===current?.id);
 const root=useRef<HTMLDivElement>(null),settleTimer=useRef<number | undefined>(undefined);
 const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{distance:6}}));
 const currentProps=useRef(p);currentProps.current=p;
 const demandKey=JSON.stringify([...p.shots.filter(s=>visible.current.has(s.id)||s.id===current?.id||s.id===hovered||(onion&&!hidden.includes('canvas')&&(s.id===p.shots[index-1]?.id||s.id===p.shots[index+1]?.id))),...(!hidden.includes('pending')?p.parked.filter(s=>visible.current.has(s.id)):[])].flatMap(s=>(s.layers??[]).map(l=>l.bitmapPath.split('/').at(-1)!)));
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
 const surface=(shot:Shot,where:string,editable:boolean)=>{
  const key=where+':'+shot.id,other=live?.id===shot.id&&live.surface!==key;
  return <div className="wb-surface" data-surface={key} onPointerDownCapture={e=>{
   if(!p.disabled && editable && live?.surface===key && e.isPrimary && e.button===0 && p.canContinueBrush(shot))return;
   if(p.disabled || !(editable ? p.canStartCanvasEdit() : p.canNavigate())){e.preventDefault();e.stopPropagation();return;}
   flushSync(()=>{p.focus(shot.id);setLive({id:shot.id,surface:key,node:e.currentTarget});});
  }} onPointerUpCapture={settle} onPointerCancelCapture={settle}>
   <div style={{visibility:other?'hidden':undefined}}>{editable?p.renderCanvas(shot,where==='viewer'&&onion?p.shots[index-1]:undefined,where==='viewer'&&onion?p.shots[index+1]:undefined):<PresentationPreview shotId={shot.id} width={shot.flow?.canvasWidth??640} height={shot.flow?.canvasHeight??360}><ShotStaticMedia shot={shot} folderPath="flow" revision={p.revision}/></PresentationPreview>}</div>
   {other&&<LiveMirror source={live.node} shot={shot}/>}
  </div>;
 };
 const content=(panel:Panel):ReactNode=>{
  if(panel==='board')return <><div className="wb-panel-tools"><button aria-pressed={japanese} onClick={()=>{if(p.canNavigate())setJapanese(!japanese);}}>日式分镜</button><span>{p.shots.length} 张 · {p.selected.length} 已选</span><label>缩略图 <input aria-label="缩略图大小" type="range" min="150" max="460" value={tile} onChange={e=>{if(p.canNavigate())setTile(Number(e.target.value));}}/></label></div>
   <SortableContext items={p.shots.map(s=>s.id)} strategy={rectSortingStrategy}><div className={japanese ? "wb-grid wb-japanese" : "wb-grid"} style={{'--tile':tile+'px'} as CSSProperties}>
    {p.shots.map((shot,i)=><BoardCard key={shot.id} shot={shot} index={i} selected={p.selected.includes(shot.id)} disabled={p.disabled} onSelect={e=>{if(p.canNavigate())p.select(shot.id,e);}}
     rowInfo={japanese ? p.renderInfo : undefined} visible={reportVisible} activate={()=>{if(p.canStartCanvasEdit())flushSync(()=>setHovered(shot.id));}}>
     {surface(shot,'grid',hovered===shot.id)}
    </BoardCard>)}
   </div></SortableContext></>;
  if(panel==='canvas')return <><div className="wb-panel-tools"><div><button aria-label="上一张" disabled={!current||index===0} onClick={()=>navigate(-1)}>←</button><span className="wb-position">{current?index+1:0} / {p.shots.length}</span><button aria-label="下一张" disabled={!current||index===p.shots.length-1} onClick={()=>navigate(1)}>→</button></div><button aria-pressed={onion} onClick={()=>{if(p.canNavigate())setOnion(!onion);}}>洋葱皮</button><label>画布 <select aria-label="画布缩放" value={zoom} onChange={e=>{if(p.canNavigate())setZoom(Number(e.target.value));}}>{[50,75,100,150,200].map(n=><option key={n} value={n}>{n===100?'适合宽度':n+'%'}</option>)}</select></label></div>
   <div className="wb-viewer" data-current-shot={current?.id}>{current?<div style={{width:zoom+'%',minWidth:zoom+'%'}}>{surface(current,'viewer',true)}</div>:<p className="wb-empty">选择一张故事板开始绘制</p>}</div></>;
  if(panel==='info')return current?p.renderInfo(current):<p className="wb-empty">尚未选择故事板</p>;
  if(panel==='layers')return current?p.renderLayers(current):null;
  return <FlowPending shots={p.parked} disabled={p.disabled} revision={p.revision} onRestore={id=>p.move([id],'active')} renderMedia={shot=><PendingPreview shot={shot} revision={p.revision} visible={reportVisible}/>}/>;
 };
 const movePanel=(e:React.DragEvent,column:number,before?:Panel)=>{const id=e.dataTransfer.getData('application/x-flow-panel') as Panel;if(!labels[id]||!p.canNavigate())return;e.preventDefault();e.stopPropagation();setLayout(old=>{const next=old.map(col=>col.filter(v=>v!==id));const at=before?next[column].indexOf(before):-1;next[column].splice(at<0?next[column].length:at,0,id);return next;});};
 return <main ref={root} className="flow-workbench" data-flow-editor="true" data-workbench="true" data-revision={p.revision}>
  <header className="wb-header"><div className="wb-brand">Storyboard <b>Flow</b><span>{p.name}</span></div><nav>{p.actions}<details><summary>面板</summary><div className="wb-menu">{(Object.keys(labels) as Panel[]).map(id=><label key={id}><input type="checkbox" checked={!hidden.includes(id)} onChange={()=>{if(p.canNavigate())setHidden(h=>h.includes(id)?h.filter(v=>v!==id):[...h,id]);}}/>{labels[id]}</label>)}<button onClick={()=>{if(p.canNavigate()){setLayout(initial);setHidden([]);setHeights({});setJapanese(false);setSplit(48);setZoom(100);setTile(220);}}}>恢复默认布局</button></div></details></nav></header>
  <div className="wb-toolbar">{p.toolbar}</div>
  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({active,over})=>{if(!over||!p.canNavigate())return;const id=String(active.id),target=String(over.id),pending=p.parked.some(s=>s.id===id),ids=pending?[id]:draggedShots(p.shots.map(s=>s.id),p.selected,id);if(ids.includes(target))return;if(target===pendingDropId||p.parked.some(s=>s.id===target))p.move(ids,'pending',target===pendingDropId?undefined:target);else if(p.shots.some(s=>s.id===target))p.move(ids,'active',target);}}>
   <div className="wb-dock" style={{gridTemplateColumns:`minmax(240px, ${split}fr) 7px minmax(260px, ${100-split}fr)`}}>
    {layout.map((panels,col)=><div key={col} className="wb-column" style={{gridColumn:col?3:1}} onDragOver={e=>{if(e.dataTransfer.types.includes('application/x-flow-panel'))e.preventDefault();}} onDrop={e=>movePanel(e,col)}>
     {panels.filter(id=>!hidden.includes(id)).map(id=><section className={'wb-panel wb-panel-'+id} key={id} data-panel={id} style={{height:heights[id]}}
       onPointerUp={e=>{
         const height=parseFloat(e.currentTarget.style.height);
         if(Number.isFinite(height) && height>=100 && height!==heights[id])setHeights(old=>({...old,[id]:height}));
       }} onDragOver={e=>{if(e.dataTransfer.types.includes('application/x-flow-panel'))e.preventDefault();}} onDrop={e=>movePanel(e,col,id)}>
      <header draggable onDragStart={e=>{if(!p.canNavigate()){e.preventDefault();return;}e.dataTransfer.setData('application/x-flow-panel',id);}}><span>⠿ {labels[id]}</span><button aria-label={'隐藏'+labels[id]} onClick={()=>{if(p.canNavigate())setHidden(h=>[...h,id]);}}>×</button></header><div className="wb-panel-body">{content(id)}</div>
     </section>)}
    </div>)}
    <div className="wb-divider" role="separator" aria-label="面板分隔" aria-orientation="vertical" tabIndex={0} onKeyDown={e=>{if(p.canNavigate()&&['ArrowLeft','ArrowRight'].includes(e.key)){e.stopPropagation();e.preventDefault();setSplit(v=>Math.max(25,Math.min(75,v+(e.key==='ArrowRight'?2:-2))));}}} onPointerDown={e=>{if(!p.canNavigate())return;e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){const r=e.currentTarget.parentElement!.getBoundingClientRect();setSplit(Math.max(25,Math.min(75,(e.clientX-r.left)/r.width*100)));}}}/>
   </div>
  </DndContext>
  <footer className="wb-status"><span role="status">{p.status}</span><span>画布落笔 · 顶部排序 · ← → 翻板</span></footer>
 </main>;
}
function BoardCard({shot,index,selected,disabled,onSelect,visible,activate,children,rowInfo}:{rowInfo?:(shot:Shot)=>ReactNode;shot:Shot;index:number;selected:boolean;disabled:boolean;onSelect:(e:React.MouseEvent)=>void;visible:(id:string,v:boolean)=>void;activate:()=>void;children:ReactNode}){
 const sortable=useSortable({id:shot.id,disabled});const element=useRef<HTMLElement|null>(null),[near,setNear]=useState(false);const report=useRef(visible);report.current=visible;
 useEffect(()=>{const observer=new IntersectionObserver(entries=>{const value=entries[0].isIntersecting;setNear(value);report.current(shot.id,value);},{rootMargin:'80px'});if(element.current)observer.observe(element.current);return()=>{observer.disconnect();report.current(shot.id,false);};},[shot.id,index]);
 return <article ref={el=>{element.current=el;sortable.setNodeRef(el);}} data-board-id={shot.id} className={'wb-card'+(selected?' is-selected':'')} style={{transform:CSS.Transform.toString(sortable.transform),transition:sortable.transition}}>
  <button className="wb-card-handle" aria-label={'选择故事板 '+shot.id} {...sortable.attributes} {...sortable.listeners} onClick={onSelect}><b>{String(index+1).padStart(3,'0')}</b><span>{shot.fileName}</span><span>⠿</span></button>
  <div className="wb-card-picture" style={{aspectRatio:`${shot.flow?.canvasWidth??640}/${shot.flow?.canvasHeight??360}`}} onPointerEnter={activate}>{near?children:null}</div>
  {rowInfo ? <div className="wb-row-info">{near && rowInfo(shot)}</div> : <div className="wb-card-caption">{shot.scriptText||'暂无动作说明'}</div>}
 </article>;
}
function LiveMirror({source,shot}:{source:HTMLElement;shot:Shot}){
 const ref=useRef<HTMLCanvasElement>(null),presentation=useContext(CanvasPresentationContext)[shot.id];
 useEffect(()=>{let frame=0;const draw=()=>{const canvas=ref.current,stage=source.querySelector('.image-stage');if(canvas&&stage){const ctx=canvas.getContext('2d')!;ctx.clearRect(0,0,canvas.width,canvas.height);
  for(const node of stage.querySelectorAll<HTMLImageElement|HTMLCanvasElement>(':scope > img, :scope > canvas, :scope > .stage-overlay canvas')){const style=getComputedStyle(node);if(style.display==='none'||style.visibility==='hidden'||!node.width||(node instanceof HTMLImageElement&&(!node.complete||!node.naturalWidth)))continue;ctx.save();ctx.globalAlpha=Number(style.opacity);ctx.globalCompositeOperation=(style.mixBlendMode==='normal'?'source-over':style.mixBlendMode) as GlobalCompositeOperation;ctx.drawImage(node,0,0,canvas.width,canvas.height);ctx.restore();}}
  frame=requestAnimationFrame(draw);};draw();return()=>cancelAnimationFrame(frame);},[source]);
 const h=shot.flow?.canvasHeight??360,pad=presentation?.mode==='expanded'?75:0;
 return <canvas aria-hidden="true" data-live-mirror="true" ref={ref} width={shot.flow?.canvasWidth??640} height={h} style={{position:'absolute',left:0,top:`${pad/(h+pad*2)*100}%`,width:'100%',height:`${h/(h+pad*2)*100}%`,pointerEvents:'none',background:'white'}}/>;
}

function PendingPreview({shot,revision,visible}:{shot:Shot;revision:number;visible:(id:string,value:boolean)=>void}) {
 const element=useRef<HTMLDivElement>(null),[near,setNear]=useState(false),report=useRef(visible);report.current=visible;
 useEffect(()=>{const observer=new IntersectionObserver(entries=>{const value=entries[0].isIntersecting;setNear(value);report.current(shot.id,value);},{rootMargin:'80px'});if(element.current)observer.observe(element.current);return()=>{observer.disconnect();report.current(shot.id,false);};},[shot.id]);
 return <div ref={element} style={{aspectRatio:`${shot.flow?.canvasWidth??640}/${shot.flow?.canvasHeight??360}`}}>{near&&<PresentationPreview shotId={shot.id} width={shot.flow?.canvasWidth??640} height={shot.flow?.canvasHeight??360}><ShotStaticMedia shot={shot} folderPath="flow" revision={revision}/></PresentationPreview>}</div>;
}
