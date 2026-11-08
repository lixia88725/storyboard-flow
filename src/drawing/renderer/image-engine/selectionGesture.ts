import type {FlowSelection,FlowTransform} from '../../../platform/contracts/flowSelection';
import {bitmapSelectionBounds,bitmapSelectionCenter,bitmapSelectionHitTarget,rotationRadiansBetweenPoints,scaleBitmapSelectionBounds,type Point} from '../sketchGeometry';
import {selectionMatrix,transformSelectionPoints} from '../selectionTransform';

export function beginNativeSelectionGesture(selection:FlowSelection,point:Point,scale:number,height:number){
 if(!Number.isFinite(scale)||scale<=0)return null;
 const points=selection.map(p=>({...p})),bounds=bitmapSelectionBounds(points);if(!bounds)return null;
 const hit=bitmapSelectionHitTarget(point,bounds,8/scale,26/scale,height);if(hit.type==='none')return null;
 return{points,bounds,hit,start:{...point}};
}
export type NativeSelectionGesture=NonNullable<ReturnType<typeof beginNativeSelectionGesture>>;
export function updateNativeSelectionGesture(gesture:NativeSelectionGesture,point:Point):{matrix:FlowTransform;points:FlowSelection}{
 const {bounds,hit,start}=gesture;let matrix:FlowTransform;
 if(hit.type==='rotate')matrix=selectionMatrix(bounds,bounds,rotationRadiansBetweenPoints(bitmapSelectionCenter(bounds),start,point));
 else if(hit.type==='scale')matrix=selectionMatrix(bounds,scaleBitmapSelectionBounds(bounds,hit.corner,point));
 else matrix=[1,0,0,1,point.x-start.x,point.y-start.y];
 return{matrix,points:transformSelectionPoints(gesture.points,matrix)};
}
