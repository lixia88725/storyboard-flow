import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';

test('Prepared Save admits encoded desired PNG bytes before decoding a valid same-sized raster',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'desired-base64-ram-root-')),bitmapPath='.storyboard-workbench/layers/s/a.png',file=path.join(root,bitmapPath),metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),script=path.join(root,'storyboard-script.md'),tiff=path.join(root,'s.tiff');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const png=await sharp({create:{width:1024,height:1024,channels:4,background:'blue'}}).png().toBuffer(),desired=await sharp({create:{width:1024,height:1024,channels:4,background:'green'}}).png({compressionLevel:0}).toBuffer();
  expect(png.length).toBeLessThan(65536);expect(desired.length).toBeGreaterThan(1024*1024);await fs.writeFile(file,png,{mode:0o600});await fs.writeFile(tiff,await sharp(png).tiff().toBuffer(),{mode:0o600});
  const project={id:'p',name:'Desired encoded byte admission',shots:[{id:'s',imagePath:tiff,fileName:'s.tiff',swb:{status:'owned',canvasWidth:1024,canvasHeight:1024},layers:[{id:'a',kind:'paint',bitmapPath,width:1024,height:1024}]}],dialogues:[]};
  await fs.writeFile(metadata,JSON.stringify(project,null,2)+'\n',{mode:0o600});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project as any),{mode:0o600});
  const files=[metadata,script,tiff,file],originals=await Promise.all(files.map(f=>fs.readFile(f))),names=(await fs.readdir(path.dirname(metadata))).sort(),base64=desired.toString('base64');
  const service=createPreparedWorkspaceSave({python:'python3',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:32*1024*1024,records:1000,assets:16,jsonDepth:80},memoryBudgetBytes:1024*1024});
  const frame={},event:any={sender:{mainFrame:frame},senderFrame:frame};let writes=0;const from=vi.spyOn(Buffer,'from');
  try{
    await expect(service.run(event,{folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[{folderPath:root,shotId:'s',layerId:'a',bitmapPath,dataUrl:'data:image/png;base64,'+base64}],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}},async()=>{writes++;return {project,normalSaveOutputs:[]};})).rejects.toMatchObject({code:'RAM_ADMISSION'});
    expect(from.mock.calls.filter(args=>args[0]===base64&&args[1]==='base64')).toHaveLength(0);
  }finally{from.mockRestore();}
  expect(writes).toBe(0);expect(await Promise.all(files.map(f=>fs.readFile(f)))).toEqual(originals);expect((await fs.readdir(path.dirname(metadata))).sort()).toEqual(names);
  const roomy=createPreparedWorkspaceSave({python:'python3',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:32*1024*1024,records:1000,assets:16,jsonDepth:80},memoryBudgetBytes:128*1024*1024});
  const saved=await roomy.run(event,{folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[{folderPath:root,shotId:'s',layerId:'a',bitmapPath,dataUrl:'data:image/png;base64,'+base64}],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}},async()=>{writes++;return {project,normalSaveOutputs:[]};});
  expect(saved.recoverySaveNonce).toEqual(expect.any(String));expect(writes).toBe(1);expect(await Promise.all(files.map(f=>fs.readFile(f)))).toEqual(originals);
},120000);
