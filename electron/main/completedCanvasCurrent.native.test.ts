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
test('completed current canvas cannot substitute different bytes for an original policy-observed layer',async()=>{
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
 const dataUrl='data:image/png;base64,'+bytes.toString('base64');
 const blueUrl='data:image/png;base64,'+(await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer()).toString('base64');
 const capture={folderPath:folder,content:content(project),history:{undo:[],redo:[]},canvas:{captures:[{shotId:'s',folderPath:folder,liveLayers:[{layerId:'base',dataUrl:blueUrl}]}],hasUnsettledGesture:false},selectedShotIds:['s'],dirtyShotIds:[],workspaceSaveState:'saved',fileNameSyncState:'synced'};
 await expect(service.certifyRetainedSet(event,{slots:[capture]})).rejects.toThrow('Completed canvas PNG not current');
 capture.canvas.captures[0].liveLayers[0].dataUrl=dataUrl;
 expect(await service.certifyRetainedSet(event,{slots:[capture]})).toBe(true);
 expect(await fs.readFile(png)).toEqual(bytes);expect(await fs.readFile(namespace)).toEqual(policy);
},120000);
