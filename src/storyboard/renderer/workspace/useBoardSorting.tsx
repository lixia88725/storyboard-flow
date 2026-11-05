import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {DragStartEvent} from '@dnd-kit/core';
import type {Shot} from '../../../drawing/contracts/types';
import {ShotStaticMedia} from '../ShotStaticMedia';
import {draggedShots} from '../boardSelection';
import {boardInsertion,boardMovePlan,type BoardRect,type Point} from './boardGestures';

type Props={shots:Shot[];parked:Shot[];selected:string[];pendingSelected:string[];revision:number;canNavigate:()=>boolean;selectMany:(ids:string[])=>void;selectManyPending:(ids:string[])=>void;move:(ids:string[],destination:'active'|'pending',before?:string)=>void};
type Target={destination:'active'|'pending';beforeId?:string;changed:boolean};
type Gesture={ids:string[];activeOrder:string[];pendingOrder:string[];rects:BoardRect[];scroll:HTMLElement|null;top:number;left:number;point:Point;dirty:boolean;dispose:()=>void;target?:Target};
/** Sorting uses immutable source geometry. Only the ghost and insertion marker move. */
export function useBoardSorting(p:Props,root:RefObject<HTMLElement|null>,dragging:RefObject<boolean>,afterDrop:(point:Point)=>void){
 const props=useRef(p);props.current=p;
 const gesture=useRef<Gesture|undefined>(undefined);const skipClick=useRef(false);
 const [preview,setPreview]=useState<{shot:Shot;count:number}>();
 const ghost=useRef<HTMLDivElement>(null),marker=useRef<HTMLDivElement>(null);
 const update=()=>{
  const g=gesture.current;if(!g)return;
  if(ghost.current)ghost.current.style.transform=`translate(${g.point.x+14}px,${g.point.y+14}px)`;
  if(g.dirty){
   const grid=root.current?.querySelector<HTMLElement>('.wb-grid:not(.wb-pending-grid)');
   g.rects=Array.from(grid?.querySelectorAll<HTMLElement>('[data-board-id]')??[]).map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.boardId!,left:r.left,top:r.top,width:r.width,height:r.height};});
   g.top=g.scroll?.scrollTop??0;g.left=g.scroll?.scrollLeft??0;g.dirty=false;
  }
  g.target=undefined;if(marker.current)marker.current.hidden=true;
  const hit=document.elementFromPoint(g.point.x,g.point.y);if(!hit||!root.current?.contains(hit))return;
  // The Pending table renders its cards inside a grid too, so the shelf is tested first.
  const shelf=hit.closest<HTMLElement>('.flow-pending-shelf'),grid=shelf?null:hit.closest<HTMLElement>('.wb-grid');
  if(grid){
   const dx=(g.scroll?.scrollLeft??0)-g.left,dy=(g.scroll?.scrollTop??0)-g.top;
   const rects=g.rects.map(r=>({...r,left:r.left-dx,top:r.top-dy}));
   const insertion=boardInsertion(rects,g.point),bounds=grid.getBoundingClientRect();
   const plan=boardMovePlan(g.activeOrder,g.ids,insertion?.index??0);
   g.target={destination:'active',beforeId:plan.beforeId,changed:plan.changed};
   const line=insertion?.line??{left:bounds.left+14,top:bounds.top+14,width:Math.max(20,bounds.width-28),height:3};
   if(marker.current){Object.assign(marker.current.style,{left:line.left+'px',top:line.top+'px',width:line.width+'px',height:line.height+'px'});marker.current.hidden=false;}
  }else if(shelf){
   const cards=Array.from(shelf.querySelectorAll<HTMLElement>('[data-pending-shot-id]'));
   const card=hit.closest<HTMLElement>('[data-pending-shot-id]'),r=card?.getBoundingClientRect();
   const slot=card?cards.indexOf(card)+(g.point.y>r!.top+r!.height/2?1:0):cards.length;
   const plan=boardMovePlan(g.pendingOrder,g.ids,slot);g.target={destination:'pending',beforeId:plan.beforeId,changed:plan.changed};
   const anchor=cards.find(c=>c.dataset.pendingShotId===plan.beforeId),box=(anchor??cards.at(-1)??shelf).getBoundingClientRect();
   if(marker.current){Object.assign(marker.current.style,{left:box.left+'px',top:(anchor?box.top:box.bottom)+'px',width:box.width+'px',height:'3px'});marker.current.hidden=false;}
  }
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
  const grid=root.current?.querySelector<HTMLElement>('.wb-grid:not(.wb-pending-grid)'),scroll=grid?.closest<HTMLElement>('.wb-panel-body')??null;
  const rects=Array.from(grid?.querySelectorAll<HTMLElement>('[data-board-id]')??[]).map(el=>{const r=el.getBoundingClientRect();return {id:el.dataset.boardId!,left:r.left,top:r.top,width:r.width,height:r.height};});
  const e=event.activatorEvent as PointerEvent;
  gesture.current={ids,activeOrder,pendingOrder,rects,scroll,top:scroll?.scrollTop??0,left:scroll?.scrollLeft??0,point:{x:e.clientX,y:e.clientY},dirty:false,dispose:()=>{}};
  // Near-window editors can change row height while scrolling. Invalidate cached
  // geometry on actual layout/content changes, rather than forcing layout each move.
  let frame=0,autoFrame=0;
  const invalidate=()=>{if(!gesture.current)return;gesture.current.dirty=true;cancelAnimationFrame(frame);frame=requestAnimationFrame(update);};
  const resizeObserver=new ResizeObserver(invalidate),mutations=new MutationObserver(invalidate);
  if(grid){resizeObserver.observe(grid);for(const card of grid.querySelectorAll<HTMLElement>('[data-board-id]'))resizeObserver.observe(card);mutations.observe(grid,{childList:true,subtree:true});}
  const autoScroll=()=>{
   const g=gesture.current;if(!g)return;
   const hit=document.elementFromPoint(g.point.x,g.point.y);
   const host=hit&&root.current?.contains(hit)&&hit.closest('[data-panel=board],[data-panel=pending]')?hit.closest<HTMLElement>('.wb-panel-body'):null;
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
  const g=gesture.current;if(!g){cancel();return;}g.dirty=true;update();const current=props.current;
  const unchanged=JSON.stringify(g.activeOrder)===JSON.stringify(current.shots.map(s=>s.id))&&JSON.stringify(g.pendingOrder)===JSON.stringify(current.parked.map(s=>s.id));
  const target=g.target;cancel();
  if(unchanged&&target?.changed&&current.canNavigate()){current.move(g.ids,target.destination,target.beforeId);afterDrop(g.point);}
 };
 return {start,end,cancel,skipClick,overlay:preview&&createPortal(<><div ref={marker} className="wb-insertion-line" hidden/><div ref={ghost} className="wb-drag-ghost" aria-hidden="true"><ShotStaticMedia shot={preview.shot} folderPath="flow" revision={p.revision}/><span>{preview.count} 张</span></div></>,document.body)};
}
