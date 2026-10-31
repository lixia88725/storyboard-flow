import {createContext,useContext,type ReactNode} from 'react';
import type {FlowPresentation} from '../../electron/shared/flowPresentation';
export type CanvasPresentation=FlowPresentation&{text:string};
export const CanvasPresentationContext=createContext<Readonly<Record<string,CanvasPresentation>>>({});
/** Screen-only decoration; pointer interception keeps matte pixels outside drawing. */
export function PresentationBars({value,width}: {value:CanvasPresentation;width:number}){
 const height=width*75;
 const style={position:'absolute' as const,left:0,right:0,height,background:'#000',zIndex:30,overflow:'hidden',pointerEvents:'auto' as const};
 return <><div data-flow-matte="top" style={{...style,top:0}} onPointerDown={e=>e.stopPropagation()}/><div data-flow-matte="bottom" style={{...style,bottom:0,display:'flex',alignItems:'center',paddingLeft:width*24,color:'#fff',fontFamily:'sans-serif',fontSize:width*24,whiteSpace:'nowrap',boxSizing:'border-box'}} onPointerDown={e=>e.stopPropagation()}>{value.dialogue?value.text:''}</div></>;
}

/** Static previews share settings without materializing another bitmap asset. */
export function PresentationPreview({shotId,width,height,children}:{shotId:string;width:number;height:number;children:ReactNode}){
 const value=useContext(CanvasPresentationContext)[shotId];
 if(!value)return <>{children}</>;
 const h=height+(value.mode==='expanded'?150:0);
 return <div style={{position:'relative',paddingBlock:value.mode==='expanded'?`${75/width*100}%`:undefined}}>{children}
  <svg aria-hidden="true" data-flow-presentation-preview="true" viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>
   <rect width={width} height={75}/><rect y={h-75} width={width} height={75}/>
   {value.dialogue&&<text x={24} y={h-27} fontSize={24} fontFamily="sans-serif" fill="white">{value.text}</text>}
  </svg></div>;
}
