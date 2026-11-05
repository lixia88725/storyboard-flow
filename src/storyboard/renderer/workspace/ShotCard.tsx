import type {HTMLAttributes,MouseEventHandler,PointerEventHandler,ReactNode} from 'react';

/** Which table this card belongs to. The attribute is what marquee, click and drag hit-test. */
export type ShotCardKind='board'|'pending';

type CardProps={id:string;kind:ShotCardKind;selected:boolean;aspectRatio:string;className?:string;
 register?:(el:HTMLElement|null)=>void;
 onPointerDown?:PointerEventHandler<HTMLElement>;onClick?:MouseEventHandler<HTMLElement>;
 /** The grab bar. Usually `<ShotCardHandle>`; the caller owns its drag and select wiring. */
 handle:ReactNode;picture:ReactNode;pictureProps?:HTMLAttributes<HTMLDivElement>;
 footer?:ReactNode;
 /** Small card-local controls, kept out of the grab bar so they never start a drag. */
 corner?:ReactNode;
 /** Japanese rows put the editable info grid beside the picture. */
 rowInfo?:ReactNode};

/**
 * Card chrome shared by the storyboard grid and the Pending table: the same grab bar,
 * picture box and footer, so the two tables look and measure the same. Behaviour (drag,
 * selection, what the picture contains) stays with each caller.
 */
export function ShotCard(p:CardProps){
 const marker=p.kind==='board'?{'data-board-id':p.id}:{'data-pending-shot-id':p.id};
 return <article {...marker} ref={p.register} className={'wb-card'+(p.selected?' is-selected':'')+(p.className?' '+p.className:'')}
  onPointerDown={p.onPointerDown} onClick={p.onClick}>
  {p.handle}
  {p.corner&&<div className="wb-card-corner">{p.corner}</div>}
  <div className="wb-card-picture" style={{aspectRatio:p.aspectRatio}} {...p.pictureProps}>{p.picture}</div>
  {p.footer}
  {p.rowInfo}
 </article>;
}

type HandleProps={label:string;
 /** Active boards show their running number; Pending has no formal number, so it passes none. */
 index?:number;attributes?:HTMLAttributes<HTMLButtonElement>;listeners?:HTMLAttributes<HTMLButtonElement>;
 grip?:boolean;disabled?:boolean;className?:string;
 /** False when the card body starts the drag, so the handle must not start a second one. */
 pointerDrag?:boolean;
 onPointerDownCapture?:PointerEventHandler<HTMLButtonElement>;onKeyDownCapture?:()=>void;
 onContextMenu?:HTMLAttributes<HTMLButtonElement>['onContextMenu'];onClick?:MouseEventHandler<HTMLButtonElement>};

/** The grab bar: number (when the table numbers boards), drag grip, and the drag listeners. */
export function ShotCardHandle(p:HandleProps){
 // A handle inside an already-draggable card keeps only the keyboard listener: the pointer
 // press bubbles to the card, and listening twice would start two drags.
 const listeners=p.pointerDrag===false?{onKeyDown:p.listeners?.onKeyDown}:p.listeners;
 return <button type="button" className={'wb-card-handle'+(p.className?' '+p.className:'')} aria-label={p.label} disabled={p.disabled}
  {...p.attributes} {...listeners} onPointerDownCapture={p.onPointerDownCapture} onKeyDownCapture={p.onKeyDownCapture}
  onContextMenu={p.onContextMenu} onClick={p.onClick}>
  {p.index!==undefined&&<b>{String(p.index+1).padStart(3,'0')}</b>}
  {p.grip!==false&&<span className="wb-card-grip" aria-hidden="true">⠿</span>}
 </button>;
}
