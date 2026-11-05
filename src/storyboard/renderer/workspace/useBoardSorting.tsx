import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {DragStartEvent} from '@dnd-kit/core';
import type {Shot} from '../../../drawing/contracts/types';
import {ShotStaticMedia} from '../ShotStaticMedia';
import {draggedShots} from '../boardSelection';
import {boardInsertion,boardMovePlan,type BoardRect,type Point} from './boardGestures';

type Props={shots:Shot[];parked:Shot[];selected:string[];pendingSelected:string[];revision:number;canNavigate:()=>boolean;selectMany:(ids:string[])=>void;selectManyPending:(ids:string[])=>void;move:(ids:string[],destination:'active'|'pending',before?:string)=>void};
type Target={destination:'active'|'pending';beforeId?:string;changed:boolean};
/** One table's immutable geometry, plus the box that scrolls it. */
type Table={kind:'active'|'pending';order:string[];grid:HTMLElement|null;scroll:HTMLElement|null;rects:BoardRect[];top:number;left:number};
type Gesture={ids:string[];tables:Record<'active'|'pending',Table>;point:Point;target?:Target;dispose:()=>void};
/** Sorting uses immutable source geometry. Only the ghost and insertion marker move. */
export function useBoardSorting(p:Props,root:RefObject<HTMLElement|null>,dragging:RefObject<boolean>,afterDrop:(point:Point)=>void){
 const props=useRef(p);props.current=p;
 const gesture=useRef<Gesture|undefined>(undefined);const skipClick=useRef(false);
 const [preview,setPreview]=useState<{shot:Shot;count:number}>();
 const ghost=useRef<HTMLDivElement>(null),marker=useRef<HTMLDivElement>(null);
 /** Cards of one table in its own order, measured in client coordinates. */
 const measure=(kind:Table['kind'],order:string[]):Table=>{
  const grid=(kind==='pending'?root.current?.querySelector<HTMLElement>('.wb-pending-grid')
   :root.current?.querySelector<HTMLElement>('.wb-grid:not(.wb-pending-grid)'))??null;
  const attr=kind==='pending'?'pendingShotId':'boardId',selector=kind==='pending'?'[data-pending-shot-id]':'[data-board-id]';
  const rects=Array.from(grid?.querySelectorAll<HTMLElement>(selector)??[]).map(el=>{
   const r=el.getBoundingClientRect();
   return {id:(el.dataset as Record<string,string|undefined>)[attr]!,left:r.left,top:r.top,width:r.width,height:r.height};
  });
  const scroll=grid?.closest<HTMLElement>('.wb-panel-body')??null;
  return {kind,order,grid,scroll,rects,top:scroll?.scrollTop??0,left:scroll?.scrollLeft??0};
 };
 const remeasure=(t:Table)=>Object.assign(t,measure(t.kind,t.order));
 const update=()=>{
  const g=gesture.current;if(!g)return;
  if(ghost.current)ghost.current.style.transform=`translate(${g.point.x+14}px,${g.point.y+14}px)`;
  g.target=undefined;if(marker.current)marker.current.hidden=true;
  const hit=document.elementFromPoint(g.point.x,g.point.y);if(!hit||!root.current?.contains(hit))return;
  // The panel under the pointer decides the table, so an empty table still accepts a drop.
  const panel=hit.closest<HTMLElement>('[data-panel=board],[data-panel=pending]');
  const table=!panel?undefined:panel.getAttribute('data-panel')==='pending'?g.tables.pending:g.tables.active;
  if(!table)return;
  // The same two-dimensional insertion rule serves both tables; only the order differs.
  const dx=(table.scroll?.scrollLeft??0)-table.left,dy=(table.scroll?.scrollTop??0)-table.top;
  const insertion=boardInsertion(table.rects.map(r=>({...r,left:r.left-dx,top:r.top-dy})),g.point);
  const plan=boardMovePlan(table.order,g.ids,insertion?.index??table.order.length);
  g.target={destination:table.kind,beforeId:plan.beforeId,changed:plan.changed};
  const bounds=table.grid?.getBoundingClientRect();
  const line=insertion?.line??(bounds?{left:bounds.left+14,top:bounds.top+14,width:Math.max(20,bounds.width-28),height:3}:undefined);
  if(marker.current&&line){Object.assign(marker.current.style,{left:line.left+'px',top:line.top+'px',width:line.width+'px',height:line.height+'px'});marker.current.hidden=false;}
 };
 const cancel=()=>{gesture.current?.dispose();gesture.current=undefined;dragging.current=false;setPreview(undefined);};
 useEffect(()=>{
  const move=(e:PointerEvent)=>{if(gesture.current){gesture.current.point={x:e.clientX,y:e.clientY};update();}};
  const scroll=()=>update();const resize=()=>cancel();
  window.addEventListener('pointermove',move,true);window.addEventListener('pointerup',move,true);window.addEventListener('scroll',scroll,true);window.addEventListener('blur',resize);window.addEventListener('resize',resize);
  return()=>{window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',move,true);window.removeEventListener('scroll',scroll,true);window.removeEventListener('blur',resize);window.removeEventListener('resize',resize);gesture.current?.dispose();gesture.current=undefined;dragging.current=false;};
 },[]);
 useEffect(()=>{if(preview)update();},[preview]);
 const start=(event:DragStartEvent)=>{
  const current=props.current,id=String(event.active.id),shot=[...current.shots,...current.parked].find(s=>s.id===id);
  if(!shot||!current.canNavigate())return;
  const activeOrder=current.shots.map(s=>s.id),pendingOrder=current.parked.map(s=>s.id);
  // Either table drags its own selection: the same rule, applied to that table's order.
  const fromPending=pendingOrder.includes(id);
  const ids=fromPending?draggedShots(pendingOrder,current.pendingSelected,id):draggedShots(activeOrder,current.selected,id);
  const tables={active:measure('active',activeOrder),pending:measure('pending',pendingOrder)};
  const e=event.activatorEvent as PointerEvent;
  gesture.current={ids,tables,point:{x:e.clientX,y:e.clientY},dispose:()=>{}};
  // Near-window editors can change row height while scrolling. Invalidate cached
  // geometry on actual layout/content changes, rather than forcing layout each move.
  let frame=0,autoFrame=0;
  const invalidate=()=>{const g=gesture.current;if(!g)return;remeasure(g.tables.active);remeasure(g.tables.pending);cancelAnimationFrame(frame);frame=requestAnimationFrame(update);};
  const resizeObserver=new ResizeObserver(invalidate),mutations=new MutationObserver(invalidate);
  for(const t of Object.values(tables)){
   if(!t.grid)continue;
   resizeObserver.observe(t.grid);
   for(const card of t.grid.querySelectorAll<HTMLElement>('[data-board-id],[data-pending-shot-id]'))resizeObserver.observe(card);
   mutations.observe(t.grid,{childList:true,subtree:true});
  }
  const autoScroll=()=>{
   const g=gesture.current;if(!g)return;
   const hit=document.elementFromPoint(g.point.x,g.point.y);
   // Scroll the panel the pointer is actually over, so a drag near the Pending edge never
   // scrolls the storyboard underneath it.
   const body=hit&&root.current?.contains(hit)?hit.closest<HTMLElement>('.wb-panel-body'):null;
   const host=body&&body.querySelector('.wb-grid')?body:null;
   if(host){const r=host.getBoundingClientRect(),edge=28;
    const velocity=g.point.y<r.top+edge?-Math.min(18,(r.top+edge-g.point.y)*.6):g.point.y>r.bottom-edge?Math.min(18,(g.point.y-r.bottom+edge)*.6):0;
    if(velocity){const before=host.scrollTop;host.scrollTop+=velocity;if(before!==host.scrollTop)update();}
   }
   autoFrame=requestAnimationFrame(autoScroll);
  };
  autoFrame=requestAnimationFrame(autoScroll);
  gesture.current.dispose=()=>{cancelAnimationFrame(frame);cancelAnimationFrame(autoFrame);resizeObserver.disconnect();mutations.disconnect();};
  dragging.current=true;skipClick.current=true;
  if(fromPending){if(!current.pendingSelected.includes(id))current.selectManyPending(ids);}
  else if(!current.selected.includes(id))current.selectMany(ids);
  setPreview({shot,count:ids.length});
 };
 const end=()=>{
  const g=gesture.current;if(!g){cancel();return;}
  // Re-derive the target from the final pointer position before committing the move.
  update();
  const current=props.current;
  const unchanged=JSON.stringify(g.tables.active.order)===JSON.stringify(current.shots.map(s=>s.id))&&JSON.stringify(g.tables.pending.order)===JSON.stringify(current.parked.map(s=>s.id));
  const target=g.target,point=g.point;cancel();
  if(unchanged&&target?.changed&&current.canNavigate()){current.move(g.ids,target.destination,target.beforeId);afterDrop(point);}
 };
 return {start,end,cancel,skipClick,overlay:preview&&createPortal(<><div ref={marker} className="wb-insertion-line" hidden/><div ref={ghost} className="wb-drag-ghost" aria-hidden="true"><ShotStaticMedia shot={preview.shot} folderPath="flow" revision={p.revision}/><span>{preview.count} 张</span></div></>,document.body)};
}
