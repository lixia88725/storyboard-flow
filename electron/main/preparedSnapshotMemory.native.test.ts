import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';

// Real Prepared Save / Native authorization / store. The private injected
// snapshot allocation budget is a test value, not the production RAM policy.
test.each([
  {memoryBudgetBytes:1,refuse:true,name:'Prepared Save refuses its metadata snapshot allocation before allocating or publishing when RAM cannot fund it'},
  {memoryBudgetBytes:16*1024*1024,refuse:false,name:'Prepared Save retains and reads back real rasters with a sufficient private snapshot budget'}
])('$name',async({memoryBudgetBytes,refuse})=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'prepared-ram-root-')),bitmapPath='.storyboard-workbench/layers/s/a.png',file=path.join(root,bitmapPath),metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),script=path.join(root,'storyboard-script.md'),tiff=path.join(root,'s.tiff');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const png=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();await fs.writeFile(file,png,{mode:0o600});await fs.writeFile(tiff,await sharp(png).tiff().toBuffer(),{mode:0o600});
  const project={id:'p',name:'RAM snapshot admission',shots:[{id:'s',imagePath:tiff,fileName:'s.tiff',swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'a',kind:'paint',bitmapPath,width:2,height:2}]}],dialogues:[]};
  const json=Buffer.from(JSON.stringify(project,null,2)+'\n');await fs.writeFile(metadata,json,{mode:0o600});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project as any),{mode:0o600});
  const originals=await Promise.all([metadata,script,tiff,file].map(f=>fs.readFile(f))),names=(await fs.readdir(path.dirname(metadata))).sort();
  const service=createPreparedWorkspaceSave({python:'python3',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80},memoryBudgetBytes});
  const frame={},event:any={sender:{mainFrame:frame},senderFrame:frame},payload={folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  let writes=0;const allocations=vi.spyOn(Buffer,'alloc');
  try{
    const result=service.run(event,payload,async()=>{writes++;return {project,normalSaveOutputs:[]};});
    if(refuse){await expect(result).rejects.toMatchObject({code:'RAM_ADMISSION'});expect(allocations.mock.calls.filter(args=>args[0]===json.length+1)).toHaveLength(0);}
    else {expect((await result).recoverySaveNonce).toEqual(expect.any(String));expect(allocations.mock.calls.some(args=>args[0]===json.length+1)).toBe(true);}
  }finally{allocations.mockRestore();}
  expect(writes).toBe(refuse?0:1);expect(await Promise.all([metadata,script,tiff,file].map(f=>fs.readFile(f)))).toEqual(originals);if(refuse)expect((await fs.readdir(path.dirname(metadata))).sort()).toEqual(names);
},120000);
