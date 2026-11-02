import {useContext, type ReactNode} from 'react';
import {CanvasPresentationContext} from '../../canvasPresentation';

type Props = {shotId:string;width:number;height:number;editing:boolean;disabled:boolean;editor:ReactNode;
  begin:()=>boolean;end:()=>void};
/** Only the focused card mounts an input; the existing presentation supplies idle text. */
export function BoardDialogue(p:Props) {
 const presentation=useContext(CanvasPresentationContext)[p.shotId];
 if(!presentation?.dialogue)return null;
 const height=75/(p.height+(presentation.mode==='expanded'?150:0))*100;
 return <div data-board-dialogue="true" className="wb-board-dialogue" style={{height:height+'%'}}
   onPointerDownCapture={e=>{e.stopPropagation();if(!p.editing){e.preventDefault();p.begin();}}}
   onClick={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}
   onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget))p.end();}}>
   {p.editing?p.editor:<button type="button" aria-label={'编辑故事板台词 '+p.shotId}
       disabled={p.disabled} onClick={()=>p.begin()}/>}
 </div>;
}
