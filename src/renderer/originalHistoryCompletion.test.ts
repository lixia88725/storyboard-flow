import {test,expect,vi} from 'vitest';
vi.mock('react',()=>({useState:(v:unknown)=>[v,vi.fn()],useRef:(v:unknown)=>({current:v}),useEffect:(f:()=>void)=>f(),useCallback:(f:unknown)=>f}));
import {useProjectHistoryController} from './projectHistoryController';
import {createBitmapLayerWriteQueue} from './bitmapLayerWriteQueue';
import {createNormalSaveProjectOwner} from './normalSaveProjectOwner';
import {addGeneratedShot,createProject} from '../shared/projectOps';
// Actual private two stacks, owner, bitmap restoration and required persistence.
// Pixel I/O is a declared in-memory port, NOT native/mounted verification.
test('refused post-restore publication commits exact reciprocal two stacks before original ACK',async()=>{
 const queue=createBitmapLayerWriteQueue(),project=addGeneratedShot(createProject('A'),{imagePath:'/A/s.tiff',fileName:'s.tiff',width:2,height:2});
 const shot=project.shots[0],path=shot.layers![1].bitmapPath;
 project.pendingBake={version:1,shots:{[shot.id]:{state:'synced',acceptedOutputIdentity:'0'.repeat(64)}}};
 const ref={current:project},pixels=new Map([[path,'new-PNG']]);let refuse=true,history!:ReturnType<typeof useProjectHistoryController>;
 const persisted:unknown[]=[];
 const owner=createNormalSaveProjectOwner({projectRef:ref,setProject:p=>{ref.current=p;},queue,freshToken:()=> 'next',readIdentity:async()=> '0'.repeat(64),output:async()=>[],persist:async()=>{},captureEffectPersistence:()=>({folderPath:'/A',metadataPath:'/A/project.json',persist:async()=>{persisted.push(history.captureHistoryData());}})});
 history=useProjectHistoryController({captureInstalledHistory:()=>()=>true,captureWorkspace:()=>()=>true,captureEffectCompletion:owner.captureEffectCompletion,isImageImportLocked:()=>false,
 api:{readLayerPng:async({bitmapPath})=>pixels.get(bitmapPath),writeLayerPng:async({bitmapPath,dataUrl})=>{pixels.set(bitmapPath,dataUrl);return {} as never;},deleteLayerPng:async({bitmapPath})=>{pixels.delete(bitmapPath);return {} as never;}},bitmapLayerWriteQueueRef:{current:queue},folderPathRef:{current:'/A'},fileNameSyncStateRef:{current:'synced'},projectRef:ref,selectedShotIdsRef:{current:[shot.id]},scriptImportCheckIdRef:{current:0},maxEntries:60,
 publishProject:(p,ids)=>refuse?false:owner.publishEdit(p,ids),setProject:()=>{},markShotsDirty:()=>{},selectShotsByIds:()=>{},setAutosaveRevision:()=>{},setFileNameSyncState:()=>{},setScriptImportNeeded:()=>{},setStatus:()=>{},setWorkspaceSaveState:()=>{}});
 const old={...project,name:'old'};history.recordUndoEntry({project:old,selectedShotIds:[shot.id],fileNameSyncState:'synced',layerAssets:[{bitmapPath:path,dataUrl:'old-PNG'}]});
 await history.applyUndoEntry();
 expect(pixels.get(path)).toBe('old-PNG');expect(persisted).toHaveLength(1);
 const stacks=history.captureHistoryData();expect(stacks.undo).toEqual([]);expect(stacks.redo).toHaveLength(1);expect(stacks.redo[0].project).toEqual(project);expect(stacks.redo[0].layerAssets).toEqual([{bitmapPath:path,dataUrl:'new-PNG'}]);expect(persisted[0]).toEqual(stacks);
 refuse=false;await history.applyRedoEntry();expect(pixels.get(path)).toBe('new-PNG');expect(history.captureHistoryData().redo).toEqual([]);expect(history.captureHistoryData().undo[0].layerAssets).toEqual([{bitmapPath:path,dataUrl:'old-PNG'}]);
 await queue.drain();
});
