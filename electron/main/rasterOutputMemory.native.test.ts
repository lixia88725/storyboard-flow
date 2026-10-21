import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';

// Small compressed real images whose decoded output exceeds the private RAM
// test budget. Real Native/store/full-raster validation, not a metadata-only stub.
test('cold recovery inspection reserves decoded raster output separately from its small encoded snapshots',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'raw-raster-ram-root-')),bitmapPath='.storyboard-workbench/layers/s/a.png',file=path.join(root,bitmapPath),metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),script=path.join(root,'storyboard-script.md'),tiff=path.join(root,'s.tiff');await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const png=await sharp({create:{width:1024,height:1024,channels:4,background:'blue'}}).png().toBuffer();await fs.writeFile(file,png,{mode:0o600});await fs.writeFile(tiff,await sharp(png).tiff({compression:'lzw'}).toBuffer(),{mode:0o600});
  const project={id:'p',name:'decoded output memory',shots:[{id:'s',imagePath:tiff,fileName:'s.tiff',swb:{status:'owned',canvasWidth:1024,canvasHeight:1024},layers:[{id:'a',kind:'paint',bitmapPath,width:1024,height:1024}]}],dialogues:[]};
  const persist=async()=>{await fs.writeFile(metadata,JSON.stringify(project,null,2)+'\n',{mode:0o600});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project as any),{mode:0o600});return {};};await persist();
  const options={python:'python3',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:64*1024*1024,records:2000,assets:16,jsonDepth:80}};
  const original=createPreparedWorkspaceSave(options),frame={},event:any={sender:{mainFrame:frame},senderFrame:frame},payload={folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  const saved=await original.run(event,payload,async()=>({project,normalSaveOutputs:[]}));await original.persist(event,{...payload,recoverySaveNonce:saved.recoverySaveNonce},persist);await original.acknowledge(event,{folderPath:root,nonce:saved.recoverySaveNonce,project});
  const paths=[metadata,script,tiff,file],before=await Promise.all(paths.map(f=>fs.readFile(f)));expect(before.every(b=>b.length<64*1024)).toBe(true);
  const limited=createPreparedWorkspaceSave({...options,memoryBudgetBytes:1024*1024});
  await expect(limited.readReadonly(root)).rejects.toThrow(/RAM_ADMISSION/);
  expect(await Promise.all(paths.map(f=>fs.readFile(f)))).toEqual(before);
  const sufficient=createPreparedWorkspaceSave({...options,memoryBudgetBytes:128*1024*1024}),restored=await sufficient.readReadonly(root);
  expect(restored.projectRaw).toEqual(project);expect(restored.assets.length).toBe(2);
  for(const asset of restored.assets){const decoded=await sharp(Buffer.from(asset.dataUrl.split(',')[1],'base64')).metadata();expect([decoded.width,decoded.height]).toEqual([1024,1024]);}
},120000);
