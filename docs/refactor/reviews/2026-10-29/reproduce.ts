// Coordinator-owned synthetic reproduction, not an automatic test-suite input.
// Run from main as documented in REVIEW.md. Leaves its own temp evidence intact.
import { applyImageEdit } from '../../../../.worktrees/hermes-drawing/src/core/drawing/index';
import { applyStoryboardEdit, createProjectHistory } from '../../../../.worktrees/hermes-storyboard/src/core/storyboard/index';
import { createProjectStore } from '../../../../.worktrees/hermes-persistence/electron/core/persistence/index';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
async function main() {
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'storyboard-independent-review-'));
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'#ff0000'}}).png().toBuffer();
 const assetId=createHash('sha256').update(bytes).digest('hex');
 const image:any={id:'i',revision:0,width:2,height:2,layers:[{id:'l',name:'Layer',kind:'image',visible:true,locked:false,opacity:1,blendMode:'normal',width:2,height:2,assetId}]};
 const project:any={schema:'storyboard-flow.project',version:1,id:'p',revision:0,name:'Test',shots:[{id:'s',imageId:'i',name:'Shot',scriptText:''}],parkedShots:[],dialogues:[],images:{i:image}};
 const out:any={root};
 try { out.unknownCommand=applyImageEdit(image,{kind:'constructor'} as any); } catch(e) { out.unknownCommand={threw:String(e)}; }
 out.maxRevisionNoop=applyImageEdit({...image,revision:Number.MAX_SAFE_INTEGER},{kind:'setLayer',layerId:'l',patch:{name:'Layer'}});
 const store=createProjectStore();
 out.initial=await store.saveCheckpoint(root,project,async()=>bytes);
 const wrong=structuredClone(project);wrong.revision=1;wrong.images.i.width=3;wrong.images.i.layers[0].width=3;
 out.reusedAssetWrongDimensions=await store.saveCheckpoint(root,wrong,async()=>bytes);
 const loaded=await store.loadCheckpoint(root);out.loadedDimensions=loaded.ok?loaded.value.project.images.i.width:loaded;
 const shared=structuredClone(project);shared.revision=2;shared.shots.push({id:'s2',imageId:'i',name:'Shared',scriptText:''});
 out.sharedImageStore=await store.saveCheckpoint(root,shared,async()=>bytes);
 out.sharedImageStoryboard=applyStoryboardEdit(shared,{kind:'setScriptText',shotId:'s',text:'new'});
 const retained=structuredClone(project);retained.revision=3;Object.defineProperty(retained.images,'__proto__',{value:{...structuredClone(image),id:'__proto__'},enumerable:true,writable:true,configurable:true});
 out.retainedInputKeys=Object.keys(retained.images);
 out.retainedSpecialId=await store.saveCheckpoint(root,retained,async()=>bytes);
 const reread=await store.loadCheckpoint(root);out.retainedLoadedKeys=reread.ok?Object.keys(reread.value.project.images):reread;
 const p2=structuredClone(project);p2.images.j={...structuredClone(image),id:'j'};p2.shots.push({id:'t',imageId:'j',name:'T',scriptText:''});
 const h=createProjectHistory(p2,{maxEntries:3});if(h.ok){h.value.apply({kind:'moveShots',shotIds:['s'],destination:'active'});out.undoReorder=h.value.undo();}
 console.log(JSON.stringify(out,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
