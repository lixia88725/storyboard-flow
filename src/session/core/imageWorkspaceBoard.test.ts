import {expect,it} from 'vitest';
import type {ImageProjectEdit,ProjectV2} from '../../platform/contracts/imageProject';
import {applyImageProjectEdit,validImageProject} from './imageProjectModel';
import {createSnapshotHistory} from './snapshotHistory';
const initial=():ProjectV2=>({schema:'storyboard-flow.project',version:2,id:'p',revision:0,name:'old',shots:[{id:'a',imageId:'ia',name:'A',scriptText:''},{id:'b',imageId:'ib',name:'B',scriptText:''}],parkedShots:[{id:'c',imageId:'ic',name:'C',scriptText:'pending'}],dialogues:[{id:'line',shotId:'a',text:'hello'},{id:'second',shotId:'b',text:'world'}],images:Object.fromEntries(['a','b','c'].map(id=>['i'+id,{id:'i'+id,content:{kind:'source',source:{importId:'batch',itemId:id,interpretationId:'r'}}}]))});
const value=<T>(r:{ok:true;value:T}|{ok:false;error:{message:string}})=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const history=()=>value(createSnapshotHistory<ProjectV2,ImageProjectEdit>(initial(),{maxEntries:60},{valid:validImageProject,reduce:applyImageProjectEdit}));
it('uses one mixed history for names, presentation, cross-shot dialogue move, Pending and deletion; keeps opaque images for Undo',()=>{
 const h=history(),edit=(e:ImageProjectEdit)=>value(h.commit(value(h.prepare(e))));
 edit({kind:'setProjectNaming',name:'new',naming:{sceneCode:'S01',artistName:'artist',version:'v01'}});edit({kind:'setPresentation',presentation:{mode:'expanded',dialogue:true}});expect(value(h.current()).parkedShots[0].presentation).toBeUndefined();edit({kind:'moveDialogues',dialogueIds:['line'],targetShotId:'b',beforeId:'second'});expect(value(h.current()).dialogues.map(d=>d.id)).toEqual(['line','second']);edit({kind:'moveShots',shotIds:['b'],destination:'pending'});edit({kind:'removeShots',shotIds:['b','c']});expect(value(h.current()).dialogues).toEqual([]);expect(Object.keys(value(h.current()).images)).toHaveLength(3);expect(h.undoDepth()).toBe(5);
 for(let n=0;n<5;n++)value(h.commit(value(h.prepareUndo())));expect({...value(h.current()),revision:0}).toEqual(initial());for(let n=0;n<5;n++)value(h.commit(value(h.prepareRedo())));expect(value(h.current()).revision).toBe(15);expect(value(h.current()).parkedShots).toEqual([]);
});
it('atomically inserts retained references and only their own metadata, with inherited active presentation and stable input ownership',()=>{
 const p={...initial(),presentation:{mode:'embedded' as const,dialogue:false}},shots=[{id:'d',imageId:'id',name:'D',scriptText:''}],images={id:{id:'id',content:{kind:'source' as const,source:{importId:'new',itemId:'d',interpretationId:'r'}}}};
 const result=value(applyImageProjectEdit(p,{kind:'appendShots',shots,images,destination:'active',beforeId:'b',dialogues:[{id:'new-line',shotId:'d',text:'new'}]}));expect(result.after.shots.map(s=>s.id)).toEqual(['a','d','b']);expect(result.after.shots[1].presentation).toEqual(p.presentation);shots[0].name='forged';images.id.content.source.itemId='forged';expect(result.after.shots[1].name).toBe('D');expect(result.after.images.id.content).toMatchObject({source:{itemId:'d'}});
 expect(applyImageProjectEdit(p,{kind:'appendShots',shots,images,destination:'pending',dialogues:[{id:'bad-line',shotId:'a',text:'unrelated'}]}).ok).toBe(false);
});
it('refuses malformed, duplicate and Pending dialogue edits without changing revisions or stacks',()=>{
 const h=history();for(const e of [{kind:'removeShots',shotIds:['a','a']},{kind:'moveDialogues',dialogueIds:['line'],targetShotId:'c'},{kind:'appendShots',shots:[initial().shots[0]],images:{ia:initial().images.ia},destination:'active'},{kind:'setPresentation',presentation:{mode:'unknown',dialogue:true}}])expect(h.prepare(e as ImageProjectEdit).ok).toBe(false);expect(value(h.current())).toEqual(initial());expect(h.undoDepth()).toBe(0);
});
