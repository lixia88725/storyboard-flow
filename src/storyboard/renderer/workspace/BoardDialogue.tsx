import {useContext, type ReactNode} from 'react';
import {CanvasPresentationContext} from '../../../drawing/renderer/canvasPresentation';

type Props = {shotId:string;footer?:boolean;text?:string;height:number;editing:boolean;disabled:boolean;editor:ReactNode;
  /** True while this editor holds unconfirmed IME text: never end the edit on a focus move. */
  composing?:boolean;
  /** True while a dialogue commit for this board is unsettled: keep the editor, and its text, mounted. */
  holding?:boolean;begin:()=>boolean;end:()=>void};
/** Only the focused card mounts an input; the existing presentation supplies idle text. */
export function BoardDialogue(p:Props) {
 const presentation=useContext(CanvasPresentationContext)[p.shotId];
 if(!p.footer&&!presentation?.dialogue)return null;
 const height=75/(p.height+(presentation?.mode==='expanded'?150:0))*100;
 return <div data-board-dialogue="true" className={p.footer?"wb-dialogue-footer":"wb-board-dialogue"} style={p.footer?undefined:{height:height+'%'}}
   onPointerDown={e=>e.stopPropagation()}
   onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}
   onBlur={e=>{if(p.composing||p.holding)return;if(!e.currentTarget.contains(e.relatedTarget))p.end();}}>
   {p.editing?p.editor:<button type="button" aria-label={'编辑故事板台词 '+p.shotId}
       title="点击编辑台词" disabled={p.disabled} onClick={()=>p.begin()}>{p.footer?(p.text||'写台词…'):null}</button>}
 </div>;
}
