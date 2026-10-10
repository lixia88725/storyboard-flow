import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {afterEach,it,expect,vi} from 'vitest';
import {createProject} from '../shared/projectOps';
import {createNormalSaveProjectOwner} from './normalSaveProjectOwner';
import {createBitmapLayerWriteQueue} from './bitmapLayerWriteQueue';
import {useBitmapLayerActions} from './bitmapLayerActions';
import {readLayerAssetSnapshots} from './bitmapLayerHistory';
import type {ProjectHistoryEntry} from './projectHistoryController';
import {createLayerAppHandlers} from '../../electron/main/layerAppRuntime';
afterEach(()=>vi.unstubAllGlobals());
it.each([false,true])('production merge conflict preserves latest P2; gate retirement only for byte-identical sources (changed=%s)',async changed=>{
 const folder=await mkdtemp(path.join(os.tmpdir(),'merge-no-published-effect-'));
 const hash=async(f:string)=>createHash('sha256').update(await readFile(f)).digest('hex');
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer();
 const image=path.join(folder,'a.tiff');await sharp(bytes).tiff().toFile(image);const h=await hash(image);
 const p=createProject('P');p.shots=[{id:'s',imagePath:image,fileName:'a.tiff',order:0,swb:{status:'owned',version:1,canvasWidth:2,canvasHeight:2},layers:['a','b','c'].map((id,order)=>({id,order,name:id,kind:'paint' as const,visible:true,locked:false,opacity:1,blendMode:'normal' as const,bitmapPath:'.storyboard-workbench/layers/s/'+id+'.png',width:2,height:2}))}];p.pendingBake={version:1,shots:{s:{state:'synced',acceptedOutputIdentity:h}}};for(const l of p.shots[0].layers!){const f=path.join(folder,l.bitmapPath);await mkdir(path.dirname(f),{recursive:true});await writeFile(f,bytes);}
 const ref={current:p},queue=createBitmapLayerWriteQueue(),owner=createNormalSaveProjectOwner({projectRef:ref,setProject:()=>{},freshToken:()=> 'P2-token',queue,readIdentity:s=>hash(s.imagePath),persist:async project=>{await writeFile(path.join(folder,'project.json'),JSON.stringify(project));},captureEffectPersistence:()=>({folderPath:folder,metadataPath:path.join(folder,'project.json'),persist:async()=>{}}),output:async()=>[]});
 const api={readOutputIdentity:hash,readLayerPng:async({bitmapPath}:{bitmapPath:string})=>{try{return 'data:image/png;base64,'+(await readFile(path.join(folder,bitmapPath))).toString('base64');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}},mergeVisibleLayers:async(payload:unknown)=>{const result=await createLayerAppHandlers().mergeVisible(payload);owner.publishEdit(old=>({...old,name:'latest P2',shots:old.shots.map(s=>({...s,layers:s.layers!.map((l,i)=>i===0?{...l,visible:false}:l)}))}),['s']);if(changed)await writeFile(path.join(folder,p.shots[0].layers![0].bitmapPath),await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer());return result;}};
 vi.stubGlobal('window',{storyboard:api});const statuses:string[]=[];
 const actions=useBitmapLayerActions<ProjectHistoryEntry>({captureEnsureScope:()=>owner.captureEffectAdmission(),captureEffectCompletion:()=>owner.captureEffectCompletion(),isImageImportLocked:()=>false,projectRef:ref,folderPath:folder,bitmapLayerWriteQueueRef:{current:queue},createTransparentLayerDataUrl:async()=>'',createHistoryEntry:async paths=>({project:ref.current,selectedShotIds:['s'],fileNameSyncState:'synced',layerAssets:await readLayerAssetSnapshots(api,folder,paths??[])}),getHistoryLayerAssets:entry=>entry.layerAssets,recordUndoEntry:()=>{},markShotsDirty:()=>{},updateProject:()=>{throw Error('Conflict must not publish merge');},setStatus:s=>statuses.push(s)} as Parameters<typeof useBitmapLayerActions<ProjectHistoryEntry>>[0]);
 await actions.handleMergeVisibleBitmapLayers('s');expect(ref.current.name).toBe('latest P2');expect(ref.current.shots[0].layers![0].visible).toBe(false);expect(ref.current.shots[0].layers).toHaveLength(3);
 for(const l of p.shots[0].layers!.slice(changed?1:0))expect(await readFile(path.join(folder,l.bitmapPath))).toEqual(bytes);
 if(changed){expect(ref.current.pendingBake!.shots.s.state).toBe('unknown');expect(await owner.autosave()).toBe(false);}else{expect(ref.current.pendingBake!.shots.s.state).toBe('pending');expect(ref.current.pendingBake!.shots.s.editToken).toBe('P2-token');expect(owner.captureEffectAdmission()()).toBe(true);expect(await owner.autosave()).toBe(true);expect(JSON.parse(await readFile(path.join(folder,'project.json'),'utf8')).name).toBe('latest P2');expect(statuses.join(' ')).toContain('verified intact');}
});
