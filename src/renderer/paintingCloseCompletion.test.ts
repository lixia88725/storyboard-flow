import {test,expect,vi} from 'vitest';
import ts from 'typescript';
import {readFileSync} from 'node:fs';
import {createWorkspaceSlots} from './workspaceSlots';
import {createProject} from '../shared/projectOps';
import {createBitmapLayerWriteQueue} from './bitmapLayerWriteQueue';
import {useBitmapLayerPaintingController} from './bitmapLayerPaintingController';
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
// Actual painting/queue/slot/owner/admission composition. Native PNG and Main are
// explicit ports here; mounted early-producer evidence covers those separately.
test.each([false,true,'ACK','history','source'] as const)('already-written painting Close preserves original history and truthfully completes (persist refusal=%s)',async failure=>{
 const queue=createBitmapLayerWriteQueue(),started=deferred(),release=deferred(),calls:string[]=[];
 const p={...createProject('A'),shots:[{id:'s',fileName:'s.tiff',imagePath:'/A/s.tiff',order:0,layers:[{id:'l',name:'Paint',kind:'paint' as const,bitmapPath:'layers/l.png',visible:true,locked:false,opacity:1,blendMode:'normal' as const,order:0,width:1,height:1}]}],pendingBake:{version:1 as const,shots:{s:{state:'synced' as const,acceptedOutputIdentity:'0'.repeat(64)}}}};
 const slots=createWorkspaceSlots({initialProject:createProject('initial'),observe:async()=>({binding:'A',folderPath:'/A',metadataPath:'/A/project.json'}),publishProject:()=>{},captureView:()=>({history}),certifyHandoff:async()=>true,drain:()=>queue.drain(),publishActive:()=>{},adapterPorts:slot=>({queue,freshToken:()=> 'paint-token',assertAdmission:()=>{if(slot.lifecycle!=='active')throw Error('Frozen');},assertRequiredPersistence:()=>{},api:()=>({readOutputIdentity:async()=> '0'.repeat(64),saveWorkspace:async()=>{throw Error('Not a Save fixture');},autosaveWorkspace:async payload=>{calls.push('persist:'+payload.folderPath);if(failure===true)throw Error('original EACCES');return {ordinaryPersistenceNonce:'original-nonce'};},acknowledgeSave:async payload=>{calls.push('ACK:'+payload.nonce);return failure!=='ACK';}}),onSave:()=>{},onError:()=>{}})});
 const history:unknown[]=[];
 await slots.requestOpen('/A',async(slot,root)=>{const scan={...root,folderName:'A',images:[],project:p};await slot.adapter.load(async()=>scan,()=>{});return scan;});
 const slot=slots.active,recordUndoEntry=vi.fn(),updateProject=vi.fn(),markShotsDirty=vi.fn();
 const controller=useBitmapLayerPaintingController({api:{readLayerPng:async()=> 'old-pixels',writeLayerPng:async()=>{calls.push('PNG');started.resolve();await release.promise;}} as never,captureWorkspace:()=>slots.captureScope(slot),captureEffectCompletion:()=>slot.adapter.owner.captureEffectCompletion(),admitAssetIntent:(id,bytes,run)=>slots.submitAssetIntent(slot,id,bytes,run),projectRef:slot.projectRef,folderPath:'/A',bitmapLayerWriteQueueRef:{current:queue},createHistoryEntryFromLayerAssets:assets=>({project:p,assets}),recordUndoEntry,markShotsDirty,updateProject,
 // Explicit original-slot history port: generation may revoke UI publication,
 // but Close/handoff still drains before replacing this installed history.
 captureCompletedHistory:failure==='history'?undefined:()=>entry=>{if(!slots.isActive(slot))throw Error('History moved to B');history.push(entry);}});
 const painting=controller.handleBitmapSelectionTransform(p.shots[0],'l','data:image/png;base64,desired');void painting.catch(()=>{});
 await started.promise;
 if(failure==='source')slot.projectRef.current={...slot.projectRef.current,shots:slot.projectRef.current.shots.map(s=>({...s,imagePath:'/B/s.tiff'}))};
 const closing=slots.freezeForClose();release.resolve();
 if(failure)await expect(painting).rejects.toThrow(failure===true?'original EACCES':failure==='ACK'?'ACK refused':failure==='history'?'original history unavailable':'source changed');else await expect(painting).resolves.toBeUndefined();
 const capture=await closing;
 expect(history).toEqual(failure==='source'||failure==='history'?[]:[{project:p,assets:[{bitmapPath:'layers/l.png',dataUrl:'old-pixels'}]}]);
 expect(recordUndoEntry).not.toHaveBeenCalled();expect(updateProject).not.toHaveBeenCalled();expect(markShotsDirty).not.toHaveBeenCalled();
 expect(slot.projectRef.current.pendingBake?.shots.s.state).toBe(failure==='source'?'unknown':'pending');
 expect(calls).toEqual(failure==='source'||failure==='history'?['PNG']:failure===true?['PNG','persist:/A']:['PNG','persist:/A','ACK:original-nonce']);
 expect(capture.slots[0].content.retainedAssetIntents).toHaveLength(failure?1:0);
 expect(capture.slots[0].content.desiredAssets).toHaveLength(failure?1:0);
 if(failure){expect(capture.slots[0].content.retainedAssetIntents[0].state).toBe('failed');expect(capture.slots[0].content.effectFacts.unsettled).toBe(true);}
});

// Execute the actual SketchPad callback body (not a rewritten approximation).
// React/canvas preparation are explicit ports; mounted stroke covers real GUI.
test('selection callback stops all old selection publication after completed-without-publication',async()=>{
 const text=readFileSync(new URL('./SketchPad.tsx',import.meta.url),'utf8');
 const source=ts.createSourceFile('SketchPad.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 let initializer:ts.Expression|undefined;
 const visit=(node:ts.Node)=>{if(ts.isVariableDeclaration(node)&&node.name.getText(source)==='commitSelectionTransform')initializer=node.initializer;ts.forEachChild(node,visit);};visit(source);
 expect(initializer).toBeDefined();
 const code=ts.transpileModule(`const callback=${initializer!.getText(source)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 const setLayerDataUrls=vi.fn(),updateBitmapSelectionState=vi.fn();
 const names=['bitmapSelectionRef','activeLayer','preparedTransformRef','prepareTransformPreview','drawPreparedTransformPreview','onSelectionTransform','setLayerDataUrls','updateBitmapSelectionState'];
 const callback=new Function(...names,`${code};return callback;`)({current:{bounds:{x:0,y:0,width:1,height:1},points:[]}}, {id:'l'}, {current:{}},async()=>{},()=> 'desired',async()=>undefined,setLayerDataUrls,updateBitmapSelectionState);
 await callback({type:'move',currentBounds:{x:1,y:1,width:1,height:1}});
 expect(setLayerDataUrls).not.toHaveBeenCalled();expect(updateBitmapSelectionState).not.toHaveBeenCalled();
});
