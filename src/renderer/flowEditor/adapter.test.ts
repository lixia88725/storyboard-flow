import { it, expect } from 'vitest';
import { bitmapLayersForShot } from '../../shared/projectOps';
import { projectView, dialogueCommand, projectShots, pixelStroke, settledStrokePreview } from './adapter';
import type { ProjectV1 } from '../../../electron/shared/refactorV1';
it('projects order/layers without sharing writable layer objects',()=>{
 const image={id:'i',revision:0,width:640,height:360,layers:[{id:'l',name:'layer',kind:'paint' as const,visible:true,locked:false,opacity:0.5,blendMode:'normal' as const,width:640,height:360,assetId:'a'}]};
 const p:ProjectV1={schema:'storyboard-flow.project',version:1,id:'p',revision:0,name:'p',shots:[{id:'s',imageId:'i',name:'1',scriptText:'中文'}],parkedShots:[{id:'p',imageId:'i',name:'pending',scriptText:''}],dialogues:[],images:{i:image}};
 image.layers.push({...image.layers[0],id:'l2'});
 const shots=projectShots(p,{s:'l'});expect(bitmapLayersForShot(shots[0])).toHaveLength(2);expect(shots.map(s=>s.id)).toEqual(['s','p']);
 expect(shots[0].layers![0].bitmapPath).toBe('s/l/a');expect(shots[0].flow!.canvasWidth).toBe(640);
 shots[0].layers![0].opacity=1;expect(image.layers[0].opacity).toBe(.5);
});
it('does not scale SketchPad pixel coordinates or replay pending strokes',()=>{
 const s={id:'stroke',tool:'brush' as const,color:'#f00',size:12,points:[320,180]};
 const result=pixelStroke(s);s.points[0]=0;
 expect(result).toEqual({tool:'brush',color:'#f00',size:12,opacity:1,softness:0,points:[320,180]});
});

it('drops a delayed stroke preview after Undo or target removal; keeps the current asset preview',async()=>{
 const project = {shots:[{id:'shot',imageId:'image'}],images:{image:{layers:[{id:'layer',assetId:'painted'}]}}} as unknown as ProjectV1;
 let release!: (url:string)=>void;
 const pending=settledStrokePreview(()=>project,'shot','layer','painted',()=>new Promise(resolve=>{release=resolve;}));
 project.images.image.layers[0].assetId='before';release('blob:painted');
 expect(await pending).toBeUndefined();
 expect(await settledStrokePreview(()=>project,'shot','layer','before',async()=> 'blob:before')).toBe('blob:before');
 project.shots=[];
 expect(await settledStrokePreview(()=>project,'shot','layer','before',async()=> 'blob:before')).toBeUndefined();
});

it('projects independent dialogue records and reuses existing multiline editing semantics', () => {
 const p = {id:'p',name:'p',shots:[],parkedShots:[],images:{},dialogues:[
   {id:'d',shotId:'s',text:'old'}, {id:'other',shotId:'t',text:'retained'}
 ]} as unknown as ProjectV1;
 const view=projectView(p);view.dialogues[0].text='foreign';
 expect(p.dialogues[0].text).toBe('old');
 const command=dialogueCommand(p,'s','  中文  \r\n 第二句 ');
 expect(command).toMatchObject({kind:'setDialogues',shotId:'s',dialogues:[{id:'d',shotId:'s',text:'中文'},{shotId:'s',text:'第二句'}]});
 expect(p.dialogues).toHaveLength(2);
});
