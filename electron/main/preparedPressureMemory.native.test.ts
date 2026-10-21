import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';

test('real Main pressure refuses before Save effects despite sufficient backing quota',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'prepared-pressure-root-')),rel='.storyboard-workbench/layers/s/a.png',file=path.join(root,rel),metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),script=path.join(root,'storyboard-script.md'),tiff=path.join(root,'s.tiff');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const png=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();await fs.writeFile(file,png,{mode:0o600});await fs.writeFile(tiff,await sharp(png).tiff().toBuffer(),{mode:0o600});
  const project={id:'p',name:'Actual Main pressure',shots:[{id:'s',imagePath:tiff,fileName:'s.tiff',swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'a',kind:'paint',bitmapPath:rel,width:2,height:2}]}],dialogues:[]};
  await fs.writeFile(metadata,JSON.stringify(project,null,2)+'\n',{mode:0o600});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project as any),{mode:0o600});
  const originals=await Promise.all([metadata,script,tiff,file].map(f=>fs.readFile(f))),names=(await fs.readdir(path.dirname(metadata))).sort();
  // Real process sensor, not a fake measurement; the tiny cutoff is test-only.
  const service=createPreparedWorkspaceSave({python:'python3',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80},memoryBudgetBytes:16*1024*1024,memoryPressure:{rssBytes:1,externalBytes:1,heapBytes:1,minimumFreeBytes:0,operationHeadroomBytes:0}});
  const frame={},event:any={sender:{mainFrame:frame},senderFrame:frame};let writes=0;
  await expect(async()=>service.run(event,{folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}},async()=>{writes++;return {project,normalSaveOutputs:[]};})).rejects.toMatchObject({code:'RAM_ADMISSION'});
  expect(writes).toBe(0);expect(await Promise.all([metadata,script,tiff,file].map(f=>fs.readFile(f)))).toEqual(originals);expect((await fs.readdir(path.dirname(metadata))).sort()).toEqual(names);
  const roomy=createPreparedWorkspaceSave({python:'python3',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80},memoryBudgetBytes:16*1024*1024,memoryPressure:{rssBytes:1024*1024*1024,externalBytes:1024*1024*1024,heapBytes:1024*1024*1024,minimumFreeBytes:0,operationHeadroomBytes:1024*1024}});
  const result=await roomy.run(event,{folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}},async()=>{writes++;return {project,normalSaveOutputs:[]};});
  expect(result.recoverySaveNonce).toEqual(expect.any(String));expect(writes).toBe(1);expect(await Promise.all([metadata,script,tiff,file].map(f=>fs.readFile(f)))).toEqual(originals);
},120000);
