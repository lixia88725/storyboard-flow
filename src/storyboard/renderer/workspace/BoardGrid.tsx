import {useCallback,useLayoutEffect,useRef,type CSSProperties,type PointerEvent as ReactPointerEvent,type ReactNode} from 'react';
import {useDroppable} from '@dnd-kit/core';
import {marqueeIds,selectionBox,type BoardRect,type Point} from './boardGestures';

export const boardDropId='flow:board-drop';
type Props={children:ReactNode;japanese:boolean;tile:number;selected:string[];order:string[];disabled:boolean;canSelect:()=>boolean;onSelect:(ids:string[])=>void};

/** Only the grid's blank background starts a selection. Cards retain their own input. */
export function BoardGrid(p:Props){
 const element=useRef<HTMLDivElement|null>(null),current=useRef(p);current.current=p;
 const cancel=useRef<(()=>void)|undefined>(undefined);
 const drop=useDroppable({id:boardDropId,disabled:p.disabled});
 const setGrid=useCallback((node:HTMLDivElement|null)=>{element.current=node;drop.setNodeRef(node);},[drop.setNodeRef]);
 const orderKey=JSON.stringify(p.order),selectionKey=JSON.stringify(p.selected);
 // A new layout/selection cannot share the old gesture's cached geometry or baseline.
 useLayoutEffect(()=>()=>cancel.current?.(),[orderKey,selectionKey,p.japanese,p.tile,p.disabled]);

 const start=(event:ReactPointerEvent<HTMLDivElement>)=>{
  if(event.target!==event.currentTarget||!event.isPrimary||event.button!==0||p.disabled||!p.canSelect())return;
  cancel.current?.();
  const grid=event.currentTarget,host=grid.closest<HTMLElement>('.wb-panel-body');
  const cards=Array.from(grid.querySelectorAll<HTMLElement>(':scope > [data-board-id]'));
  const origin=grid.getBoundingClientRect();
  let rects:BoardRect[]=[],geometryDirty=true,geometryFrame=0;
  const measure=()=>{
   const base=grid.getBoundingClientRect();
   rects=cards.map(card=>{const r=card.getBoundingClientRect();return {id:card.dataset.boardId!,left:r.left-base.left,top:r.top-base.top,width:r.width,height:r.height};});
   geometryDirty=false;
  };
  const initial=[...p.selected],mode=event.shiftKey?'add':event.metaKey||event.ctrlKey?'toggle':'replace';
  const pointerId=event.pointerId,startScreen={x:event.clientX,y:event.clientY};
  const anchor={x:event.clientX-origin.left,y:event.clientY-origin.top};
  let pointer:Point=startScreen,started=false,finished=false,frame=0,chosen=initial;
  const previousUserSelect=grid.style.userSelect;
  grid.style.userSelect='none';grid.dataset.marqueeActive='true';
  const marker=document.createElement('div');marker.className='wb-marquee';marker.setAttribute('aria-hidden','true');
  marker.style.cssText='position:absolute;pointer-events:none;display:none;z-index:4';
  const count=document.createElement('span');marker.appendChild(count);grid.appendChild(marker);
  const showSelection=(ids:string[])=>{const selected=new Set(ids);for(const card of cards)card.classList.toggle('is-selected',selected.has(card.dataset.boardId!));};
  const update=()=>{
   if(finished)return;
   if(!started&&Math.hypot(pointer.x-startScreen.x,pointer.y-startScreen.y)<4)return;
   started=true;
   // Card-local editors mount near the viewport and can change row heights. Reuse
   // geometry only until a resize, subtree change or module scroll invalidates it.
   if(geometryDirty)measure();
   const r=grid.getBoundingClientRect(),point={x:Math.max(0,Math.min(grid.scrollWidth,pointer.x-r.left)),y:Math.max(0,Math.min(grid.scrollHeight,pointer.y-r.top))};
   const box=selectionBox(anchor,point);
   Object.assign(marker.style,{display:'block',left:box.left+'px',top:box.top+'px',width:box.width+'px',height:box.height+'px'});
   chosen=marqueeIds(rects,box,initial,mode);count.textContent=String(chosen.length);showSelection(chosen);
  };
  const invalidate=()=>{
   if(finished)return;
   geometryDirty=true;
   if(!geometryFrame)geometryFrame=requestAnimationFrame(()=>{geometryFrame=0;update();});
  };
  const resizeObserver=new ResizeObserver(invalidate);
  resizeObserver.observe(grid);for(const card of cards)resizeObserver.observe(card);
  // Only child-list changes matter here. Preview class/style changes are excluded,
  // and our own count text must never schedule another observer-driven update.
  const mutationObserver=new MutationObserver(records=>{
   if(records.some(record=>record.target!==marker&&!marker.contains(record.target)))invalidate();
  });
  mutationObserver.observe(grid,{childList:true,subtree:true});
  const cleanup=()=>{
   finished=true;cancelAnimationFrame(frame);cancelAnimationFrame(geometryFrame);
   resizeObserver.disconnect();mutationObserver.disconnect();
   window.removeEventListener('pointermove',move,true);window.removeEventListener('pointerup',up,true);window.removeEventListener('pointercancel',abortPointer,true);
   window.removeEventListener('blur',abort);window.removeEventListener('resize',abort);window.removeEventListener('keydown',key,true);
   grid.removeEventListener('lostpointercapture',abortPointer);host?.removeEventListener('scroll',invalidate);
   marker.remove();grid.style.userSelect=previousUserSelect;delete grid.dataset.marqueeActive;
   showSelection(current.current.selected);
   cancel.current=undefined;
   if(grid.hasPointerCapture(pointerId))grid.releasePointerCapture(pointerId);
  };
  const abort=()=>{if(!finished)cleanup();};
  const abortPointer=(e:PointerEvent)=>{if(e.pointerId===pointerId)abort();};
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();abort();}};
  const move=(e:PointerEvent)=>{if(e.pointerId!==pointerId)return;pointer={x:e.clientX,y:e.clientY};e.preventDefault();update();};
  const up=(e:PointerEvent)=>{
   if(e.pointerId!==pointerId)return;
   // Pointer release may precede queued observer callbacks: measure once before
   // committing so the final selection always describes the visible card boxes.
   pointer={x:e.clientX,y:e.clientY};geometryDirty=true;update();
   const result=started?chosen:mode==='replace'?[]:initial;
   cleanup();
   if(!current.current.disabled&&current.current.canSelect())current.current.onSelect(result);
  };
  const scroll=()=>{
   if(finished)return;
   if(started&&host){
    const r=host.getBoundingClientRect(),edge=24;
    // Do not scroll a module while the pointer is over a neighbouring column.
    if(pointer.x>=r.left&&pointer.x<=r.right){
     const velocity=pointer.y<r.top+edge?-Math.min(18,(r.top+edge-pointer.y)*.6):pointer.y>r.bottom-edge?Math.min(18,(pointer.y-r.bottom+edge)*.6):0;
     if(velocity){const before=host.scrollTop;host.scrollTop+=velocity;if(host.scrollTop!==before)invalidate();}
    }
   }
   frame=requestAnimationFrame(scroll);
  };
  cancel.current=abort;
  window.addEventListener('pointermove',move,{capture:true,passive:false});window.addEventListener('pointerup',up,true);window.addEventListener('pointercancel',abortPointer,true);
  window.addEventListener('blur',abort);window.addEventListener('resize',abort);window.addEventListener('keydown',key,true);
  grid.addEventListener('lostpointercapture',abortPointer);host?.addEventListener('scroll',invalidate,{passive:true});
  try{grid.setPointerCapture(pointerId);}catch{abort();return;}
  event.preventDefault();frame=requestAnimationFrame(scroll);
 };
 return <div ref={setGrid} className={p.japanese?'wb-grid wb-japanese':'wb-grid'} style={{'--tile':p.tile+'px'} as CSSProperties} onPointerDown={start}>{p.children}</div>;
}
