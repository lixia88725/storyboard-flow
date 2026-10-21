import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {createLayerPng,deleteLayerPng,writeLayerPng} from './layerAssetService';
import {serializeStoryboardScriptMarkdown} from './storyboardScript';

// Authorized seams: real Main service + actual exclusive PNG producer/delete,
// native metadata adapter and sealed store. Mounted bootstrap remains separate.
test('cold reciprocal Undo preserves producer-authenticated original absence and rejects unrelated markers',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'producer-custody-native-'));
 const png=path.join(folder,'.storyboard-workbench/layers/s/base.png'),tiff=path.join(folder,'a.tiff'),metadata=path.join(folder,'.storyboard-workbench/storyboard.project.json'),md=path.join(folder,'storyboard-script.md');
 await fs.mkdir(path.dirname(png),{recursive:true,mode:0o700});
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer(),base=await sharp(bytes).tiff().toBuffer();
 await fs.writeFile(png,bytes,{mode:0o600});await fs.writeFile(tiff,base,{mode:0o600});
 const project:any={id:'p',name:'custody',shots:[{id:'s',imagePath:tiff,fileName:'a.tiff',order:0,swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'base',kind:'paint',width:2,height:2,bitmapPath:path.relative(folder,png)}]}],dialogues:[],pendingBake:{version:1,shots:{s:{state:'synced',acceptedOutputIdentity:createHash('sha256').update(base).digest('hex')}}}};
 const write=async(p:any)=>{await fs.writeFile(metadata,`${JSON.stringify(p,null,2)}\n`,{mode:0o600});await fs.writeFile(md,serializeStoryboardScriptMarkdown(p),{mode:0o600});return {};};await write(project);
 const frame={},event:any={sender:{mainFrame:frame},senderFrame:frame},options={budget:{bytes:1048576,records:2000,assets:64,jsonDepth:80},python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')},service=createPreparedWorkspaceSave(options);
 const content=(p:any)=>({projectRaw:p,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}});
 const save=async()=>{const payload={folderPath:folder,metadataPath:metadata,normalSave:true,project,recoveryContent:content(project)};const output=await service.run(event,payload,async()=>({project,normalSaveOutputs:[]}));await service.persist(event,{...payload,recoverySaveNonce:output.recoverySaveNonce},()=>write(project));expect(await service.acknowledge(event,{folderPath:folder,nonce:output.recoverySaveNonce,project})).toBe(true);};await save();
 const namespace=path.join(folder,'.storyboard-workbench/workspace-recovery-v1/namespace.json'),policy=await fs.readFile(namespace);
 const bitmapPath='.storyboard-workbench/layers/s/added.png',target=path.join(folder,bitmapPath),dataUrl='data:image/png;base64,'+bytes.toString('base64');
 const added:any={...project,shots:[{...project.shots[0],layers:[...project.shots[0].layers,{id:'added',kind:'paint',width:2,height:2,bitmapPath}]}]};
 const ack=async(p:any)=>{const payload={folderPath:folder,metadataPath:metadata,project:p};const result=await service.ordinary(event,'workspace:autosave',payload,[metadata,md],()=>write(p));expect(await service.acknowledge(event,{folderPath:folder,nonce:result.ordinaryPersistenceNonce,project:p})).toBe(true);};
 const result=await service.ordinary(event,'layers:createPng',{folderPath:folder,bitmapPath},[target],()=>createLayerPng({folderPath:folder,bitmapPath,project,shotId:'s',layerId:'added',width:2,height:2,dataUrl}));expect(result.ok).toBe(true);await ack(added);
 await service.ordinary(event,'layers:deletePng',{folderPath:folder,bitmapPath},[target],()=>deleteLayerPng({folderPath:folder,bitmapPath}));await ack(project);await save();
 const history={undo:[],redo:[{project:added,selectedShotIds:['s'],fileNameSyncState:'synced',layerAssets:[{bitmapPath,dataUrl}]}]};
 const capture:any={folderPath:folder,content:content(project),history,canvas:{captures:[],hasUnsettledGesture:false},selectedShotIds:['s'],dirtyShotIds:[],workspaceSaveState:'saved',fileNameSyncState:'synced'};
 await service.certifyRetainedSet(event,{slots:[capture]});
 const cold=createPreparedWorkspaceSave(options),observation=await cold.observeWorkspace(event,folder);
 await cold.ordinary(event,'workspace:openFolderByPath',{},[folder],async()=>({project}));
 await cold.ordinary(event,'layers:writePng',{folderPath:folder,bitmapPath,dataUrl},[target],()=>writeLayerPng({folderPath:folder,bitmapPath,dataUrl}));
 const redoPersist=await cold.ordinary(event,'workspace:autosave',{folderPath:folder,metadataPath:metadata,project:added},[metadata,md],()=>write(added));
 await cold.acknowledge(event,{folderPath:folder,nonce:redoPersist.ordinaryPersistenceNonce,project:added});
 const reciprocal={...capture,binding:observation.binding,content:content(added),history:{undo:[{project,selectedShotIds:['s'],fileNameSyncState:'synced',layerAssets:[{bitmapPath}]}],redo:[]}};
 expect(await cold.certifyRetainedSet(event,{slots:[reciprocal]})).toBe(true);
 const reopened=await createPreparedWorkspaceSave(options).readReadonly(folder);
 expect((reopened.viewState as any).history).toEqual(reciprocal.history);
 const unknown=structuredClone(reciprocal);unknown.history.undo[0].layerAssets[0].bitmapPath='.storyboard-workbench/layers/s/unknown.png';
 await expect(cold.certifyRetainedSet(event,{slots:[unknown]})).rejects.toThrow('source not authenticated');
 const wrong=structuredClone(reciprocal);wrong.history.undo[0].project.id='wrong-document';
 await expect(cold.certifyRetainedSet(event,{slots:[wrong]})).rejects.toThrow('History project binding');
 expect(await fs.readFile(namespace)).toEqual(policy);
},120000);
