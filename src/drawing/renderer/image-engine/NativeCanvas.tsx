import {useContext,useEffect,useLayoutEffect,useMemo,useRef,useState,type ReactNode,type PointerEvent as ReactPointerEvent} from 'react';
import {CanvasPresentationContext,PresentationBars} from '../canvasPresentation';
import type {FlowStroke} from '../../../platform/contracts/flowWave2';
import {beginNativeSelectionGesture,updateNativeSelectionGesture,type NativeSelectionGesture} from './selectionGesture';
import {bitmapSelectionBounds,bitmapSelectionBoundsCorners,bitmapSelectionRotationHandlePoint} from '../sketchGeometry';
import type {FlowTransform,FlowSelection} from '../../../platform/contracts/flowSelection';
import {bindImageFrameCanvas,type FrameViewSource} from './canvas';
import type {CaptureTarget,CaptureSample,createImageInputCapture} from './capture';

export type NativeCanvasProps={
 shotId:string;documentId:string|null;dimensionsKnown:boolean;cursorSize:number;width:number;height:number;source:FrameViewSource;
 capture:ReturnType<typeof createImageInputCapture>;
 unavailableReason?:string;preview?:ReactNode;
 target:CaptureTarget|null;tool:'brush'|'eraser'|'select'|'blur';
 style(tool:'brush'|'eraser'):Omit<FlowStroke,'points'|'pressures'>;
 selection:FlowSelection|null;onion?:ReactNode;
 onSelection(selection:FlowSelection|null,target:CaptureTarget):void;
 onTransform(phase:'begin'|'update'|'commit'|'cancel',selection:FlowSelection,matrix:FlowTransform,target:CaptureTarget):boolean;
 onGestureChange(id:string,active:boolean,kind:'brush'|'eraser'|'select'):void;
 onIssue(message:string):void;
 onPickColor?(hex:string):void;
 onOpenBrushPanel?(position:{x:number;y:number}):void;
};
type Gesture={pointerId:number;captureId?:number;kind:'brush'|'eraser'|'select'|'transform';transform?:NativeSelectionGesture;matrix?:FlowTransform;coordinateSpace:'pixels'|'normalized';target:CaptureTarget|null;last:CaptureSample;points:CaptureSample[]};

/** A surface owns pointer capture only. Both grid and viewer paint from the same
 * native FrameStore; neither exports its canvas or submits a bitmap as authority. */
export function NativeCanvas(p:NativeCanvasProps){
 const root=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),gesture=useRef<Gesture|undefined>(undefined);
 const surfaceId=useRef(crypto.randomUUID());
 const latest=useRef(p);latest.current=p;
 const presentation=useContext(CanvasPresentationContext)[p.shotId];
 const [scale,setScale]=useState(1);
 useEffect(()=>{const element=root.current;if(!element)return;const observer=new ResizeObserver(()=>setScale(element.getBoundingClientRect().width/p.width));observer.observe(element);return()=>observer.disconnect();},[p.width]);
 const [cursor,setCursor]=useState<CaptureSample|null>(null);
 const source=useMemo(()=>{const onlyOwn=(view:ReturnType<FrameViewSource['view']>)=>view.header?.documentId===p.documentId?view:{...view,header:null,needsKeyframe:true,damage:[],readRegion:()=>null};return{view:()=>onlyOwn(p.source.view()),subscribe:(listener:Parameters<FrameViewSource['subscribe']>[0])=>p.source.subscribe(view=>listener(onlyOwn(view)))};},[p.source,p.documentId]);
 const [status,setStatus]=useState('preparing'),[outline,setOutline]=useState<FlowSelection|null>(null);
 useLayoutEffect(()=>{if(!canvas.current)return;const binding=bindImageFrameCanvas(canvas.current,source,{onStatus:setStatus});return()=>binding.dispose();},[source]);
 const coordinates=(event:PointerEvent,space: 'pixels'|'normalized'=gesture.current?.coordinateSpace??(latest.current.dimensionsKnown?'pixels':'normalized')):CaptureSample=>{
  const box=root.current!.getBoundingClientRect();
  return{x:(event.clientX-box.left)*(space==='pixels'?latest.current.width:1)/box.width,y:(event.clientY-box.top)*(space==='pixels'?latest.current.height:1)/box.height,
   pressure:event.pointerType==='pen'?Math.max(0,Math.min(1,event.pressure)):1};
 };
 const end=(cancel:boolean)=>{
  const g=gesture.current;if(!g)return;gesture.current=undefined;latest.current.onGestureChange(surfaceId.current,false,g.kind==='transform'?'select':g.kind);setOutline(null);
  if(g.kind==='transform'&&g.transform&&g.target){latest.current.onTransform(cancel?'cancel':'commit',g.transform.points,g.matrix!,g.target);}
  if(g.captureId!==undefined){cancel?latest.current.capture.cancel(g.captureId):latest.current.capture.end(g.captureId);}
  else if(g.kind==='select'&&!cancel&&g.points.length>=3&&g.target)latest.current.onSelection(g.points.map(({x,y})=>({x,y})),g.target);
  const element=root.current;if(element?.hasPointerCapture(g.pointerId))element.releasePointerCapture(g.pointerId);
 };
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&gesture.current){e.preventDefault();end(true);}};
  const blur=()=>end(true);
  window.addEventListener('keydown',key);window.addEventListener('blur',blur);
  return()=>{window.removeEventListener('keydown',key);window.removeEventListener('blur',blur);end(true);};
 },[]);
 useEffect(()=>{
  const g=gesture.current;if(!g||g.kind===p.tool)return;
  // Lasso stays a lasso until its pointer ends. Temporary E is refused by the
  // editor during that gesture. Returning from borrowed E to L ends E exactly once.
  if(g.kind==='select'||g.kind==='transform')return;
  if(g.captureId!==undefined)p.capture.end(g.captureId);
  if(p.tool==='brush'||p.tool==='eraser'){
   const next=p.capture.begin(g.target??p.target??{shotId:p.shotId,layerId:null,expectedContextGeneration:null},p.style(p.tool),g.last,g.coordinateSpace);
   if(next.ok){g.captureId=next.id;g.kind=p.tool;latest.current.onGestureChange(surfaceId.current,true,g.kind);return;}
   p.onIssue(next.reason);
  }
  gesture.current=undefined;latest.current.onGestureChange(surfaceId.current,false,g.kind);
  if(root.current?.hasPointerCapture(g.pointerId))root.current.releasePointerCapture(g.pointerId);
 },[p.tool]);
 const down=(event:ReactPointerEvent<HTMLDivElement>)=>{
  if(event.button!==0||!event.isPrimary||gesture.current||event.metaKey||event.ctrlKey||event.shiftKey)return;
  if(p.unavailableReason){event.preventDefault();p.onIssue(p.unavailableReason);return;}
  if(p.capture.state().paused){p.onIssue('正在保存或切换项目，请稍候。');return;}
  event.preventDefault();event.stopPropagation();const point=coordinates(event.nativeEvent);
  if(event.altKey&&p.onPickColor){const view=source.view();if(view.header){const x=Math.floor(point.x),y=Math.floor(point.y);if(x>=0&&y>=0&&x<view.header.width&&y<view.header.height){const rgba=view.readRegion({x,y,w:1,h:1});if(rgba)p.onPickColor('#'+Array.from(rgba.subarray(0,3),v=>v.toString(16).padStart(2,'0')).join(''));}}return;}
  if(p.tool==='blur')return;
  if(p.tool==='select'&&!p.target){p.onIssue('请等待图层准备完成后圈选。');return;}
  if(p.tool==='select'&&p.selection&&p.target){
   const bounds=root.current!.getBoundingClientRect(),transform=beginNativeSelectionGesture(p.selection,point,bounds.width/p.width,p.height);
   if(transform){const matrix:FlowTransform=[1,0,0,1,0,0];if(!p.onTransform('begin',transform.points,matrix,p.target))return;
    gesture.current={pointerId:event.pointerId,kind:'transform',transform,matrix,coordinateSpace:'pixels',target:{...p.target},last:point,points:[]};
    p.onGestureChange(surfaceId.current,true,'select');root.current?.setPointerCapture(event.pointerId);return;}
  }
  let captureId:number|undefined;
  if(p.tool==='brush'||p.tool==='eraser'){const result=p.capture.begin(p.target??{shotId:p.shotId,layerId:null,expectedContextGeneration:null},p.style(p.tool),point,p.dimensionsKnown?'pixels':'normalized');if(!result.ok){p.onIssue(result.reason);return;}captureId=result.id;}
  gesture.current={pointerId:event.pointerId,captureId,kind:p.tool,coordinateSpace:p.dimensionsKnown?'pixels':'normalized',target:p.target?{...p.target}:null,last:point,points:[point]};
  p.onGestureChange(surfaceId.current,true,p.tool);
  root.current?.setPointerCapture(event.pointerId);if(p.tool==='select')setOutline([point]);
 };
 const move=(event:ReactPointerEvent<HTMLDivElement>)=>{
  setCursor(coordinates(event.nativeEvent,'pixels'));
  const g=gesture.current;if(!g||g.pointerId!==event.pointerId)return;event.preventDefault();event.stopPropagation();
  const coalesced=event.nativeEvent.getCoalescedEvents?.()??[];
  const samples=(coalesced.length?coalesced:[event.nativeEvent]).map(event=>coordinates(event));
  if(!samples.length)return;g.last=samples.at(-1)!;
  if(g.captureId!==undefined){if(!p.capture.append(g.captureId,samples))p.onIssue('本笔输入已暂停，请处理保留的笔迹。');}
  else if(g.kind==='transform'&&g.transform&&g.target){const next=updateNativeSelectionGesture(g.transform,g.last);g.matrix=next.matrix;setOutline(next.points);p.onTransform('update',g.transform.points,next.matrix,g.target);}
  else if(g.kind==='select'){
   if(g.points.length+samples.length>4096){p.onIssue('选区点数过多，请重新圈选。');end(true);return;}
   g.points.push(...samples);setOutline(g.points.map(({x,y})=>({x,y})));
  }
 };
 const shown=outline??p.selection;
 const selectionBounds=shown?bitmapSelectionBounds([...shown]):undefined;
 const rotationHandle=selectionBounds?bitmapSelectionRotationHandlePoint(selectionBounds,26/scale,p.height):undefined;
 return <div style={presentation?{position:"relative",background:"#000",paddingBlock:presentation.mode==='expanded'?`${75/p.width*100}%`:undefined}:undefined}><div className="image-stage stage-overlay flow-native-canvas" style={{position:'relative',width:'100%',aspectRatio:`${p.width}/${p.height}`,touchAction:'none'}}>
  <canvas ref={canvas} style={{display:'block',width:'100%',height:'100%',position:'absolute',inset:0}}/>
  {p.preview&&<div data-native-preview style={{display:status==='ready'||p.unavailableReason?'none':undefined,position:'absolute',inset:0,pointerEvents:'none'}}>{p.preview}</div>}
  {((status!=='ready'&&!p.preview)||p.unavailableReason)&&<div role="status" style={{position:'absolute',inset:0,display:'grid',placeItems:'center',background:'#25272a',color:'#aeb5bf'}}>{p.unavailableReason??'正在准备画面…'}</div>}
  {p.onion}
  <div ref={root} data-canvas-input="native" style={{position:'absolute',inset:0,touchAction:'none',cursor:p.tool==='select'?'crosshair':'none'}}
   onPointerDown={down} onPointerMove={move} onPointerLeave={()=>{if(!gesture.current)setCursor(null);}}
   onPointerUp={e=>{if(gesture.current?.pointerId===e.pointerId){e.preventDefault();const g=gesture.current,point=coordinates(e.nativeEvent);if(g.kind==='transform'&&g.transform&&g.target){const next=updateNativeSelectionGesture(g.transform,point);g.matrix=next.matrix;p.onTransform('update',g.transform.points,next.matrix,g.target);}
    if(g.captureId!==undefined&&(point.x!==g.last.x||point.y!==g.last.y))p.capture.append(g.captureId,[{...point,pressure:g.last.pressure}]);end(false);}}}
   onPointerCancel={e=>{if(gesture.current?.pointerId===e.pointerId)end(true);}}
   onLostPointerCapture={e=>{if(gesture.current?.pointerId===e.pointerId)end(true);}}
   onContextMenu={e=>{e.preventDefault();if(p.tool==='brush'||p.tool==='eraser')p.onOpenBrushPanel?.({x:e.clientX,y:e.clientY});}}>
   {cursor&&(p.tool==='brush'||p.tool==='eraser')&&<svg viewBox={`0 0 ${p.width} ${p.height}`} style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}><circle cx={cursor.x} cy={cursor.y} r={p.cursorSize/2} fill="none" stroke="#fff" strokeWidth="1" vectorEffect="non-scaling-stroke"/><circle cx={cursor.x} cy={cursor.y} r={p.cursorSize/2} fill="none" stroke="#333" strokeWidth="1" strokeDasharray="2 2" vectorEffect="non-scaling-stroke"/></svg>}
   {shown&&<svg viewBox={`0 0 ${p.width} ${p.height}`} style={{width:'100%',height:'100%',pointerEvents:'none'}}><polygon points={shown.map(v=>`${v.x},${v.y}`).join(' ')} fill="none" stroke="#fff" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke"/>{p.tool==='select'&&selectionBounds&&<>{bitmapSelectionBoundsCorners(selectionBounds).map((point,index)=><rect key={index} x={point.x-4/scale} y={point.y-4/scale} width={8/scale} height={8/scale} fill="#fff" stroke="#222" strokeWidth={1/scale}/>)}{rotationHandle&&<circle cx={rotationHandle.x} cy={rotationHandle.y} r={5/scale} fill="#fff" stroke="#222" strokeWidth={1/scale}/>}</>}</svg>}
  </div>
 </div>{presentation&&<PresentationBars value={presentation} width={scale}/>}</div>;
}
