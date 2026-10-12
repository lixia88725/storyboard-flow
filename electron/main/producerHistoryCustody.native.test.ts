import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {createLayerPng,deleteLayerPng} from './layerAssetService';
import {serializeStoryboardScriptMarkdown} from './storyboardScript';

// Authorized seams: real Main service + actual exclusive PNG producer/delete,
// native metadata adapter and sealed store. Mounted bootstrap remains separate.
test('original exclusive Add then original Undo retains exact History PNG on cold read without changing namespace policy',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'producer-custody-native-'));
 const png=path.join(folder,'.storyboard-workbench/layers/s/base.png'),tiff=path.join(folder,'a.tiff'),metadata=path.join(folder,'.storyboard-workbench/storyboard.project.json'),md=path.join(folder,'storyboard-script.md');
 await fs.mkdir(path.dirname(png),{recursive:true,mode:0o700});
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer(),base=await sharp(bytes).tiff().toBuffer();
 await fs.writeFile(png,bytes,{mode:0o600});await fs.writeFile(tiff,base,{mode:0o600});
 const project:any={id:'p',name:'custody',shots:[{id:'s',imagePath:tiff,fileName:'a.tiff',order:0,swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'base',kind:'paint',width:2,height:2,bitmapPath:path.relative(folder,png)}]}],dialogues:[],pendingBake:{version:1,shots:{s:{state:'synced',acceptedOutputIdentity:createHash('sha256').update(base).digest('hex')}}}};
 const write=async(p:any)=>{await fs.writeFile(metadata,`${JSON.stringify(p,null,2)}\n`,{mode:0o600});await fs.writeFile(md,serializeStoryboardScriptMarkdown(p),{mode:0o600});return {};};await write(project);
 const frame={},event:any={sender:{mainFrame:frame},senderFrame:frame},options={budget:{bytes:1048576,records:2000,assets:64,jsonDepth:80},python:'/opt/homebrew/opt/python@3.12/libexec/bin/python3',script:path.resolve('scripts/recovery-content-permissions.py')},service=createPreparedWorkspaceSave(options);
 const content=(p:any)=>({projectRaw:p,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}});
 const save=async()=>{const payload={folderPath:folder,metadataPath:metadata,normalSave:true,project,recoveryContent:content(project)};const output=await service.run(event,payload,async()=>({project,normalSaveOutputs:[]}));await service.persist(event,{...payload,recoverySaveNonce:output.recoverySaveNonce},()=>write(project));expect(await service.acknowledge(event,{folderPath:folder,nonce:output.recoverySaveNonce,project})).toBe(true);};await save();
 const namespace=path.join(folder,'.storyboard-workbench/workspace-recovery-v1/namespace.json'),policy=await fs.readFile(namespace);
 const bitmapPath='.storyboard-workbench/layers/s/added.png',target=path.join(folder,bitmapPath),dataUrl='data:image/png;base64,'+bytes.toString('base64');
 const added:any={...project,shots:[{...project.shots[0],layers:[...project.shots[0].layers,{id:'added',kind:'paint',width:2,height:2,bitmapPath}]}]};
 const ack=async(p:any)=>{const payload={folderPath:folder,metadataPath:metadata,project:p};const result=await service.ordinary(event,'workspace:autosave',payload,[metadata,md],()=>write(p));expect(await service.acknowledge(event,{folderPath:folder,nonce:result.ordinaryPersistenceNonce,project:p})).toBe(true);};
 const result=await service.ordinary(event,'layers:createPng',{folderPath:folder,bitmapPath},[target],()=>createLayerPng({folderPath:folder,bitmapPath,project,shotId:'s',layerId:'added',width:2,height:2,dataUrl}));expect(result.ok).toBe(true);await ack(added);
 await service.ordinary(event,'layers:deletePng',{folderPath:folder,bitmapPath},[target],()=>deleteLayerPng({folderPath:folder,bitmapPath}));await ack(project);await save();
 const history={undo:[],redo:[{project:added,selectedShotIds:['s'],fileNameSyncState:'synced',layerAssets:[{bitmapPath,dataUrl}]}]};
 const capture={folderPath:folder,content:content(project),history,canvas:{captures:[],hasUnsettledGesture:false},selectedShotIds:['s'],dirtyShotIds:[],workspaceSaveState:'saved',fileNameSyncState:'synced'};
 expect(await service.certifyRetainedSet(event,{slots:[capture]})).toBe(true);
 const coldService=createPreparedWorkspaceSave(options),cold=await coldService.readReadonly(folder);expect((cold.viewState as any).history).toEqual(history);expect(cold.assets.find(a=>a.role==='history/redo/0/0')?.sourceDataUrl).toBe(dataUrl);expect(await fs.readFile(namespace)).toEqual(policy);await expect(fs.lstat(target)).rejects.toMatchObject({code:'ENOENT'});
 // Renderer hashes/paths and another document cannot mint or borrow authority.
 const forged=structuredClone(capture);forged.history.redo[0].layerAssets[0].dataUrl='data:image/png;base64,'+(await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer()).toString('base64');
 await expect(service.certifyRetainedSet(event,{slots:[forged]})).rejects.toThrow('source not authenticated');
 const unknown=structuredClone(capture);unknown.history.redo[0].layerAssets[0].bitmapPath='.storyboard-workbench/layers/s/unknown.png';unknown.history.redo[0].project.shots[0].layers.at(-1)!.bitmapPath=unknown.history.redo[0].layerAssets[0].bitmapPath;
 await expect(service.certifyRetainedSet(event,{slots:[unknown]})).rejects.toThrow('source not authenticated');
 await expect(service.certifyRetainedSet({...event,senderFrame:{}},{slots:[capture]})).rejects.toThrow();
 await fs.writeFile(target,bytes,{mode:0o600});await expect(service.certifyRetainedSet(event,{slots:[capture]})).rejects.toThrow('deleted path replaced');
 expect(await fs.readFile(namespace)).toEqual(policy);
},120000);
