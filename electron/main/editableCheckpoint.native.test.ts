import { test, expect, onTestFinished } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate';

test('first import autosave creates an editable checkpoint without baking or clearing pending output; failure cannot close silently',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'editable-checkpoint-'));onTestFinished(()=>fs.rm(root,{recursive:true,force:true}));
 const metadata=path.join(root,'.storyboard-flow/storyboard.project.json'),bitmap=path.join(root,'.storyboard-flow/layers/s/paint.png'),image=path.join(root,'a.tiff');
 await fs.mkdir(path.dirname(bitmap),{recursive:true,mode:0o700});
 const png=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer(),tiff=await sharp(png).tiff().toBuffer();
 await fs.writeFile(bitmap,png,{mode:0o600});await fs.writeFile(image,tiff,{mode:0o600});
 const project:any={id:'p',name:'checkpoint',shots:[{id:'s',fileName:'a.tiff',imagePath:image,order:0,flow:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'paint',kind:'paint',width:2,height:2,bitmapPath:path.relative(root,bitmap)}]}],dialogues:[]};
 const options={automaticCheckpoints:true,budget:{bytes:1048576,records:2000,assets:64,jsonDepth:80},python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')};
 const service=createPreparedWorkspaceSave(options),frame={},event:any={sender:{mainFrame:frame},senderFrame:frame};
 const binding=await service.observeWorkspace(event,root),payload={folderPath:root,metadataPath:metadata,project};
 await service.ordinary(event,'workspace:autosave',payload,[metadata],async()=>{await fs.writeFile(metadata,JSON.stringify(project,null,2)+'\n',{mode:0o600});await fs.writeFile(path.join(root,'storyboard-script.md'),serializeStoryboardScriptMarkdown(project),{mode:0o600});return {};});
 expect(await fs.readFile(image)).toEqual(tiff);expect(JSON.parse(await fs.readFile(metadata,'utf8'))).toEqual(project);
 const capture={...binding,content:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],effectFacts:{receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:[],dirtyShotIds:[],fileNameSyncState:'unsynced',workspaceSaveState:'unsaved'};
 expect(await service.certifyEditableSet(event,{slots:[capture]})).toBe(true);
 const fresh=createPreparedWorkspaceSave(options);expect((await fresh.readReadonly(root)).continuationState).toMatchObject({stage:'completed'});
 await expect(assertPhysicalWorkspaceWriterTargets([bitmap])).resolves.toBeUndefined();
 expect(await service.certifyEditableSet(event,{slots:[{...capture,content:{...capture.content,effectFacts:{unsettled:true}}}]})).toBe(false);
 expect(await service.certifyEditableSet(event,{slots:[{...capture,binding:'forged'}]})).toBe(false);
},120000);
