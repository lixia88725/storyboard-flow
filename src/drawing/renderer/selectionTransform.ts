import type { FlowSelection, FlowTransform } from '../../platform/contracts/flowSelection';
/** Carries gesture intent and the exact displayed source to the new pixel pipeline. */
export type SelectionTransformIntent = { sourcePath: string; selection: FlowSelection; matrix: FlowTransform };
export function selectionMatrix(start: {x:number;y:number;width:number;height:number}, target: {x:number;y:number;width:number;height:number}, rotation = 0): FlowTransform {
  if (rotation) {
    const c=Math.cos(rotation),s=Math.sin(rotation),x=start.x+start.width/2,y=start.y+start.height/2;
    return [c,s,-s,c,x-c*x+s*y,y-s*x-c*y];
  }
  const x=target.width/start.width,y=target.height/start.height;
  return [x,0,0,y,target.x-start.x*x,target.y-start.y*y];
}

export function transformSelectionPoints(points: FlowSelection, matrix: FlowTransform): {x:number;y:number}[] {
  const [a,b,c,d,e,f]=matrix;
  return points.map(p=>({x:a*p.x+c*p.y+e,y:b*p.x+d*p.y+f}));
}
