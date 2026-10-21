import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';

test('Main applies independent JSON logical limits before parsing original metadata or publishing',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'json-before-parse-root-')),rel='.storyboard-workbench/layers/s/a.png',file=path.join(root,rel),metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),script=path.join(root,'storyboard-script.md'),tiff=path.join(root,'s.tiff');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const png=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();await fs.writeFile(file,png,{mode:0o600});await fs.writeFile(tiff,await sharp(png).tiff().toBuffer(),{mode:0o600});
  const project={id:'p',name:'JSON pre-parse resource check',shots:[{id:'s',imagePath:tiff,fileName:'s.tiff',swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'a',kind:'paint',bitmapPath:rel,width:2,height:2}]}],dialogues:[]},text=JSON.stringify(project,null,2)+'\n';
  await fs.writeFile(metadata,text,{mode:0o600});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project as any),{mode:0o600});
  const files=[metadata,script,tiff,file],originals=await Promise.all(files.map(f=>fs.readFile(f))),names=(await fs.readdir(path.dirname(metadata))).sort();
  const service=createPreparedWorkspaceSave({python:'python3',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80},memoryBudgetBytes:16*1024*1024,memoryJSON:{maximumSourceBytes:1024*1024,maximumTokens:1,maximumStringSourceBytes:1024*1024,maximumNesting:81}});
  const frame={},event:any={sender:{mainFrame:frame},senderFrame:frame};let writes=0;const parse=vi.spyOn(JSON,'parse');
  try{
    await expect(service.run(event,{folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}},async()=>{writes++;return {project,normalSaveOutputs:[]};})).rejects.toMatchObject({code:'RAM_ADMISSION'});
    expect(parse.mock.calls.filter(args=>args[0]===text)).toHaveLength(0);
  }finally{parse.mockRestore();}
  expect(writes).toBe(0);expect(await Promise.all(files.map(f=>fs.readFile(f)))).toEqual(originals);expect((await fs.readdir(path.dirname(metadata))).sort()).toEqual(names);
  const roomy=createPreparedWorkspaceSave({python:'python3',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80},memoryBudgetBytes:16*1024*1024,memoryJSON:{maximumSourceBytes:1024*1024,maximumTokens:100000,maximumStringSourceBytes:1024*1024,maximumNesting:81}});
  const saved=await roomy.run(event,{folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}},async()=>{writes++;return {project,normalSaveOutputs:[]};});
  expect(saved.recoverySaveNonce).toEqual(expect.any(String));expect(writes).toBe(1);expect(await Promise.all(files.map(f=>fs.readFile(f)))).toEqual(originals);
},120000);
