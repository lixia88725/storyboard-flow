import {useCallback,type CSSProperties,type ReactNode} from 'react';
import {useDroppable} from '@dnd-kit/core';
import {useMarqueeSelection} from './useMarqueeSelection';

export const boardDropId='flow:board-drop';
type Props={children:ReactNode;japanese:boolean;tile:number;selected:string[];order:string[];disabled:boolean;canSelect:()=>boolean;onSelect:(ids:string[])=>void};

/**
 * Only the grid's blank background starts a selection. Cards retain their own input.
 * The marquee itself lives in `useMarqueeSelection` so the Pending table selects the
 * same way; this component only adds the drop target and the tile layout.
 */
export function BoardGrid(p:Props){
 const drop=useDroppable({id:boardDropId,disabled:p.disabled});
 const marquee=useMarqueeSelection({idAttribute:'data-board-id',selected:p.selected,order:p.order,disabled:p.disabled,
  canSelect:p.canSelect,onSelect:p.onSelect,resetKeys:[p.japanese,p.tile,p.disabled]});
 const setGrid=useCallback((node:HTMLDivElement|null)=>{marquee.setElement(node);drop.setNodeRef(node);},[drop.setNodeRef,marquee.setElement]);
 return <div ref={setGrid} className={p.japanese?'wb-grid wb-japanese':'wb-grid'} style={{'--tile':p.tile+'px'} as CSSProperties} onPointerDown={marquee.onPointerDown}>{p.children}</div>;
}
