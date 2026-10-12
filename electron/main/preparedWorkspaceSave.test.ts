import { test, expect } from 'vitest';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

test('preparation refuses unsupported deleted inventory before invoking original Save', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'prepared-refuse-'));
 await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
 const frame={},sender={mainFrame:frame};let effects=0;
 const service=createPreparedWorkspaceSave({budget:{bytes:1048576,records:100,assets:16,jsonDepth:40},python:'/opt/homebrew/bin/python3.12',script:path.join(process.cwd(),'scripts/recovery-content-permissions.py')});
 await expect(service.run({sender,senderFrame:frame} as any,{folderPath:root,metadataPath:path.join(root,'.storyboard-workbench/storyboard.project.json'),normalSave:true,project:{shots:[],pendingDeletedShots:[{}]},recoveryContent:{projectRaw:{shots:[]},desiredAssets:[],effectFacts:{}}},async()=>{effects++;return {}; })).rejects.toThrow();
 expect(effects).toBe(0);
 expect(await fs.readdir(path.join(root,'.storyboard-workbench'))).toEqual([]);
});

test('g1 full-byte readback precedes original effect and cold read survives source replacement',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'prepared-original-'));
 const meta=path.join(root,'.storyboard-workbench/storyboard.project.json'),png=path.join(root,'.storyboard-workbench/layers/s/l.png'),tiff=path.join(root,'a.tiff');
 await fs.mkdir(path.dirname(png),{recursive:true,mode:0o700});
 const oldTiff=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).tiff().toBuffer(),oldPNG=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();
 const project={id:'p',shots:[{id:'s',imagePath:tiff,fileName:'a.tiff',swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'l',kind:'image',width:2,height:2,bitmapPath:path.relative(root,png)}]}],futureRaw:{unknown:42}};
 const json=Buffer.from(JSON.stringify(project)+'\n');
 await fs.writeFile(meta,json,{mode:0o600});await fs.writeFile(png,oldPNG,{mode:0o600});await fs.writeFile(tiff,oldTiff,{mode:0o600});
 const frame={},sender={mainFrame:frame};
 const opts={budget:{bytes:1048576,records:100,assets:16,jsonDepth:40},python:'/opt/homebrew/bin/python3.12',script:path.join(process.cwd(),'scripts/recovery-content-permissions.py')};
 const service=createPreparedWorkspaceSave(opts);let invoked=0;
 await expect(service.run({sender,senderFrame:frame} as any,{folderPath:root,metadataPath:meta,normalSave:true,project,recoveryContent:{projectRaw:project,desiredAssets:[],sequence:1,assetRevision:0,effectFacts:{receipt:[],deletions:[],remainingScript:null}}},async()=>{
  invoked++;const before=await service.readReadonly(root);expect(before.assets.find((a:any)=>a.role==='original/s/base').sourceDataUrl).toContain(oldTiff.toString('base64'));
  await fs.writeFile(meta,'{}');await fs.unlink(tiff);throw new Error('disk MD failure after JSON');
 })).rejects.toThrow('disk MD failure after JSON');
 expect(invoked).toBe(1);
 const cold=await createPreparedWorkspaceSave(opts).readReadonly(root);
 expect(cold.original.metadataBytes).toBe(json.toString('base64'));expect(cold.projectRaw.futureRaw.unknown).toBe(42);
});
