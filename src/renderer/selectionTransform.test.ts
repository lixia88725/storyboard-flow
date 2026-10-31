import {expect,it} from 'vitest';
import {selectionMatrix,transformSelectionPoints} from './selectionTransform';
import {validSelection,validTransform} from '../../electron/shared/flowSelection';
it('maps source corners to moved and scaled bounds and rotates around the center',()=>{
 const start={x:10,y:20,width:40,height:20};
 const apply=(m:ReturnType<typeof selectionMatrix>,x:number,y:number)=>[m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
 const scaled=selectionMatrix(start,{x:30,y:40,width:80,height:10});
 expect(apply(scaled,10,20)).toEqual([30,40]);expect(apply(scaled,50,40)).toEqual([110,50]);
 const rotated=selectionMatrix(start,start,Math.PI/2);
 expect(apply(rotated,30,30)[0]).toBeCloseTo(30);expect(apply(rotated,30,30)[1]).toBeCloseTo(30);
 expect(apply(rotated,50,30)[0]).toBeCloseTo(30);expect(apply(rotated,50,30)[1]).toBeCloseTo(50);
});
it('bounds selection size and rejects holes, degenerate geometry and nonfinite or singular transforms',()=>{
 for(const p of [[],Array(3),Array(4097).fill({x:1,y:2}),[{x:0,y:0},{x:0,y:1},{x:0,y:2}], [{x:0,y:0},{x:2,y:0},{x:NaN,y:2}]])expect(validSelection(p)).toBe(false);
 for(const m of [Array(6),[1,0,0,0,1,2],[1,0,0,1,Infinity,0],[1,0,0,1,1e9,0]])expect(validTransform(m)).toBe(false);
 expect(validSelection([{x:0,y:0},{x:2,y:0},{x:1,y:2}])).toBe(true);
});

it('preserves an irregular lasso instead of replacing it with its bounding rectangle',()=>{
 const triangle=[{x:0,y:0},{x:10,y:0},{x:0,y:10}];
 expect(transformSelectionPoints(triangle,[2,0,0,3,5,7])).toEqual([{x:5,y:7},{x:25,y:7},{x:5,y:37}]);
 expect(triangle).toEqual([{x:0,y:0},{x:10,y:0},{x:0,y:10}]);
});
