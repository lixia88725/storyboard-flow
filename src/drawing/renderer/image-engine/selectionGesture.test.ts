import {expect,it} from 'vitest';
import {beginNativeSelectionGesture,updateNativeSelectionGesture} from './selectionGesture';
const points=[{x:20,y:20},{x:80,y:20},{x:80,y:80},{x:20,y:80}];
it('moves relative to a fixed original rather than accumulating preview pixels',()=>{
 const g=beginNativeSelectionGesture(points,{x:50,y:50},1,200)!;
 expect(updateNativeSelectionGesture(g,{x:60,y:60}).matrix).toEqual([1,0,0,1,10,10]);
 expect(updateNativeSelectionGesture(g,{x:70,y:70}).points[0]).toEqual({x:40,y:40});expect(points[0]).toEqual({x:20,y:20});
});
it('scales around the opposite handle and leaves outside down available for a new lasso',()=>{
 const g=beginNativeSelectionGesture(points,{x:80,y:80},1,200)!;
 expect(updateNativeSelectionGesture(g,{x:140,y:140}).points.at(-2)).toEqual({x:140,y:140});
 expect(beginNativeSelectionGesture(points,{x:180,y:180},1,200)).toBeNull();
});
it('rotates around the fixed selection center',()=>{
 const g=beginNativeSelectionGesture(points,{x:50,y:106},1,200)!;
 // Top handle would lie outside the canvas, so the existing geometry puts it below.
 expect(g.hit.type).toBe('rotate');const moved=updateNativeSelectionGesture(g,{x:106,y:50});
 expect(moved.points[0].x).toBeCloseTo(20);expect(moved.points[0].y).toBeCloseTo(80);
});
