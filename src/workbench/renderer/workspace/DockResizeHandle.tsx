import {useEffect,useRef,type PointerEvent as ReactPointerEvent} from 'react';
import {panelLabels,type WorkspacePanel} from './layoutPreferences';

/** Keep the pair's total height; compressed docks never acquire negative bodies. */
export function resizeDockPair(upper:number,lower:number,delta:number):[number,number] {
 const total=upper+lower,min=Math.min(100,total/2);
 const next=Math.max(min,Math.min(total-min,upper+delta));
 return [next,total-next];
}

/** Preview only DOM sizes while dragging, then publish one preference update. */
export function DockResizeHandle({above,below,canResize,onCommit}:{above:WorkspacePanel;below:WorkspacePanel;canResize:()=>boolean;onCommit:(heights:Partial<Record<WorkspacePanel,number>>)=>void}) {
 const cancel=useRef<(()=>void)|undefined>(undefined);
 const latest=useRef({canResize,onCommit});latest.current={canResize,onCommit};
 useEffect(()=>()=>cancel.current?.(),[above,below]);
 const collect=(node:HTMLElement)=>Array.from(node.parentElement!.querySelectorAll<HTMLElement>(':scope > .wb-panel')).map(el=>({el,id:el.dataset.panel as WorkspacePanel,height:el.getBoundingClientRect().height,flex:el.style.flex}));
 const begin=(event:ReactPointerEvent<HTMLDivElement>)=>{
  if(!event.isPrimary||event.button!==0||!latest.current.canResize())return;
  event.preventDefault();event.stopPropagation();event.currentTarget.focus({preventScroll:true});cancel.current?.();
  const rows=collect(event.currentTarget),a=rows.find(r=>r.id===above),b=rows.find(r=>r.id===below);
  if(!a||!b)return;
  const start=event.clientY,pointer=event.pointerId,handle=event.currentTarget;
  let sizes=rows.map(r=>r.height),ended=false;
  const cursor=document.body.style.cursor,select=document.body.style.userSelect;
  document.body.style.cursor='row-resize';document.body.style.userSelect='none';
  rows.forEach((r,i)=>{r.el.style.flex=`0 0 ${sizes[i]}px`;});handle.dataset.resizing='true';
  const move=(e:PointerEvent)=>{if(e.pointerId!==pointer)return;e.preventDefault();const [up,down]=resizeDockPair(a.height,b.height,e.clientY-start);sizes=rows.map(r=>r===a?up:r===b?down:r.height);rows.forEach((r,i)=>{r.el.style.flex=`0 0 ${sizes[i]}px`;});};
  const finish=(commit:boolean)=>{
   if(ended)return;ended=true;
   window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',abortPointer);window.removeEventListener('blur',abort);window.removeEventListener('resize',abort);handle.removeEventListener('lostpointercapture',abort);if(handle.hasPointerCapture(pointer))handle.releasePointerCapture(pointer);window.removeEventListener('keydown',key);
   rows.forEach(r=>{r.el.style.flex=r.flex;});document.body.style.cursor=cursor;document.body.style.userSelect=select;delete handle.dataset.resizing;cancel.current=undefined;
   if(commit&&latest.current.canResize())latest.current.onCommit(Object.fromEntries(rows.map((r,i)=>[r.id,sizes[i]])));
  };
  const up=(e:PointerEvent)=>{if(e.pointerId===pointer)finish(true);};
  const abortPointer=(e:PointerEvent)=>{if(e.pointerId===pointer)finish(false);};
  const abort=()=>finish(false);
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);}};
  cancel.current=abort;
  window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',abortPointer);window.addEventListener('blur',abort);window.addEventListener('keydown',key);window.addEventListener('resize',abort);handle.addEventListener('lostpointercapture',abort);try{handle.setPointerCapture(pointer);}catch{/* Synthetic drivers may not have an active native pointer. */}
 };
 return <div className="wb-row-divider" role="separator" aria-orientation="horizontal" aria-label={`调整${panelLabels[above]}与${panelLabels[below]}高度`} tabIndex={0} onPointerDown={begin} onKeyDown={e=>{
  if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();e.stopPropagation();
  if(cancel.current||!['ArrowUp','ArrowDown'].includes(e.key)||!latest.current.canResize())return;
  const rows=collect(e.currentTarget),a=rows.find(r=>r.id===above),b=rows.find(r=>r.id===below);if(!a||!b)return;
  const [up,down]=resizeDockPair(a.height,b.height,(e.key==='ArrowUp'?-1:1)*(e.shiftKey?40:10));
  latest.current.onCommit(Object.fromEntries(rows.map(r=>[r.id,r===a?up:r===b?down:r.height])));
 }}/>;
}
