import {test,expect,vi,afterEach} from 'vitest';
vi.mock('react',()=>({useState:(v:unknown)=>[v,vi.fn()],useRef:(v:unknown)=>({current:v}),useEffect:(f:()=>void)=>f(),useCallback:(f:unknown)=>f}));
import {useProjectHistoryController} from './projectHistoryController';
import {useBitmapLayerActions} from './bitmapLayerActions';
import {createBitmapLayerWriteQueue} from './bitmapLayerWriteQueue';
import {createNormalSaveProjectOwner} from './normalSaveProjectOwner';
import {addGeneratedShot,createProject} from '../shared/projectOps';
afterEach(()=>vi.unstubAllGlobals());
// Real controllers/private stacks; explicit bitmap-memory I/O ports.
test.each(['clear','down','add'])('original %s Undo is installed before original persist after owner refusal',async action=>{
 const queue=createBitmapLayerWriteQueue(),project=addGeneratedShot(createProject('A'),{imagePath:'/A/s.tiff',fileName:'s.tiff',width:2,height:2});
 const shot=project.shots[0],layer=shot.layers![1],base=shot.layers![0];project.pendingBake={version:1,shots:{[shot.id]:{state:'synced',acceptedOutputIdentity:'0'.repeat(64)}}};
 const ref={current:project},pixels=new Map([[base.bitmapPath,'base-PNG'],[layer.bitmapPath,'drawing-PNG']]),beforePixels=new Map(pixels);
 let current=true,history!:ReturnType<typeof useProjectHistoryController>;const persisted:unknown[]=[];
 const owner=createNormalSaveProjectOwner({projectRef:ref,setProject:p=>{ref.current=p;},queue,freshToken:()=> 'next',readIdentity:async()=> '0'.repeat(64),output:async()=>[],persist:async()=>{},captureEffectPersistence:()=>({folderPath:'/A',metadataPath:'/A/project.json',persist:async()=>{persisted.push(history.captureHistoryData());}})});
 const api={readLayerPng:async({bitmapPath}:{bitmapPath:string})=>pixels.get(bitmapPath),writeLayerPng:async({bitmapPath,dataUrl}:{bitmapPath:string;dataUrl:string})=>{pixels.set(bitmapPath,dataUrl);current=false;return {} as never;},deleteLayerPng:async({bitmapPath}:{bitmapPath:string})=>{pixels.delete(bitmapPath);return {} as never;},mergeLayerDown:async()=>{pixels.set(base.bitmapPath,'merged-PNG');pixels.delete(layer.bitmapPath);current=false;return {} as never;},createLayerPng:async(payload:any)=>{pixels.set(payload.bitmapPath,payload.dataUrl);current=false;return {ok:true,...payload};}};
 vi.stubGlobal('window',{storyboard:api});
 history=useProjectHistoryController({captureWorkspace:()=>()=>true,captureEffectCompletion:owner.captureEffectCompletion,captureInstalledHistory:()=>()=>true,isImageImportLocked:()=>false,api,bitmapLayerWriteQueueRef:{current:queue},folderPathRef:{current:'/A'},fileNameSyncStateRef:{current:'synced'},projectRef:ref,selectedShotIdsRef:{current:[shot.id]},scriptImportCheckIdRef:{current:0},maxEntries:60,publishProject:(p,ids)=>owner.publishEdit(p,ids),setProject:()=>{},markShotsDirty:()=>{},selectShotsByIds:()=>{},setAutosaveRevision:()=>{},setFileNameSyncState:()=>{},setScriptImportNeeded:()=>{},setStatus:()=>{},setWorkspaceSaveState:()=>{}});
 history.restoreHistoryData({undo:[],redo:[{project,selectedShotIds:[],fileNameSyncState:'synced'}]});
 const ui=vi.fn();const options={captureEnsureScope:()=>()=>current,captureEffectCompletion:owner.captureEffectCompletion,captureCompletedHistory:()=>history.recordUndoEntry,isImageImportLocked:()=>false,projectRef:ref,folderPath:'/A',bitmapLayerWriteQueueRef:{current:queue},createHistoryEntry:history.createHistoryEntry,getHistoryLayerAssets:(entry:any)=>entry.layerAssets,rebaseAddHistoryEntry:(entry:any,p:any)=>({...entry,project:p}),createTransparentLayerDataUrl:async()=> 'blank-PNG',recordUndoEntry:ui,markShotsDirty:ui,updateProject:ui,setStatus:()=>{}};
 const actions=useBitmapLayerActions(options);
 if(action==='clear')await actions.handleClearBitmapLayer(shot.id,layer.id);else if(action==='down')await actions.handleMergeBitmapLayerDown(shot.id,layer.id);else await actions.handleAddBitmapLayer(shot.id);
 const stacks=history.captureHistoryData();expect(stacks.undo).toHaveLength(1);expect(stacks.redo).toEqual([]);expect(stacks.undo[0].project).toEqual(project);expect(persisted).toEqual([stacks]);expect(ui).not.toHaveBeenCalled();
 const afterPixels=new Map(pixels);await history.applyUndoEntry();expect(pixels).toEqual(beforePixels);await history.applyRedoEntry();expect(pixels).toEqual(afterPixels);expect(history.captureHistoryData().redo).toEqual([]);await queue.drain();
});
