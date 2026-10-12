import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {initializeNormalOpenPreviews} from './normalOpenPreviewService';
import {createPreview} from './previewService';
import {serializeStoryboardScriptMarkdown} from './storyboardScript';

// Authorized seams: real Main service + actual exclusive PNG producer/delete,
// native metadata adapter and sealed store. Mounted bootstrap remains separate.
test('fresh settled reader certifies only the actual Main-derived preview without an extra Save',async()=>{
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
 const cold=createPreparedWorkspaceSave(options),observation=await cold.observeWorkspace(event,folder);
 const opened=await cold.ordinary(event,'workspace:openFolderByPath',{},[folder],()=>initializeNormalOpenPreviews({folderPath:folder,metadataPath:metadata,project,images:[]},{createImageRecords:async(paths,root,opts)=>Promise.all(paths.map(async imagePath=>({imagePath,previewPath:opts.deferMissingPreviews?undefined:await createPreview(imagePath,root,true)})))}));
 expect(opened.project.shots[0].previewPath).toBeTruthy();
 const capture:any={...observation,content:content(opened.project),history:{undo:[],redo:[]},canvas:{captures:[],hasUnsettledGesture:false},selectedShotIds:['s'],dirtyShotIds:[],workspaceSaveState:'saved',fileNameSyncState:'synced'};
 expect(await cold.certifyRetainedSet(event,{slots:[capture]})).toBe(true);
 const forged=structuredClone(capture);forged.content.projectRaw.shots[0].previewPath='/arbitrary.png';
 await expect(cold.certifyRetainedSet(event,{slots:[forged]})).rejects.toThrow();
 const intent=structuredClone(capture);intent.content.retainedAssetIntents=[{assetId:'cancelled',state:'cancelled-before-effect'}];
 await expect(cold.certifyRetainedSet(event,{slots:[intent]})).rejects.toThrow('unpreserved obligations');
 const wrongHistory=structuredClone(capture);wrongHistory.history.undo=[{project}];
 await expect(cold.certifyRetainedSet(event,{slots:[wrongHistory]})).rejects.toThrow('History');
 await expect(cold.certifyRetainedSet({...event,senderFrame:{}},{slots:[capture]})).rejects.toThrow();
 await fs.chmod(png,0o400);
 await expect(cold.certifyRetainedSet(event,{slots:[capture]})).rejects.toThrow('restrictions changed');
 await fs.chmod(png,0o600);
 expect(await cold.certifyRetainedSet(event,{slots:[capture]})).toBe(true);
 cold.invalidateDocument(event.sender);
 await expect(cold.certifyRetainedSet(event,{slots:[capture]})).rejects.toThrow('incarnation changed');
 expect(await fs.readFile(metadata,'utf8')).toBe(`${JSON.stringify(project,null,2)}\n`);
},120000);
