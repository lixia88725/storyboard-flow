import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createLayerAppHandlers } from './layerAppRuntime';
import { registerLayerIpcHandlers } from './ipc/layerHandlers';
import { createControlledMemoryBudget, withControlledMemory } from './controlledMemory';

test('registered Add refuses a small compressed PNG before its oversized raw output or final creation',async()=>{
  const folderPath=await fs.mkdtemp(path.join(os.tmpdir(),'add-raw-memory-')),bitmapPath='.storyboard-workbench/layers/s/new.png',file=path.join(folderPath,bitmapPath),originalPath=path.join(folderPath,'.storyboard-workbench/layers/s/image.png'),imagePath=path.join(folderPath,'s.tiff');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const png=await sharp({create:{width:1024,height:1024,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();expect(png.length).toBeLessThan(65536);
  const original=await sharp({create:{width:1024,height:1024,channels:4,background:'blue'}}).png().toBuffer(),tiff=await sharp(original).tiff({compression:'lzw'}).toBuffer();
  await fs.writeFile(originalPath,original,{mode:0o600});await fs.writeFile(imagePath,tiff,{mode:0o600});
  const project={shots:[{id:'s',imagePath,fileName:'s.tiff',swb:{status:'owned',canvasWidth:1024,canvasHeight:1024},layers:[{id:'image',bitmapPath:'.storyboard-workbench/layers/s/image.png'}]}],pendingBake:{version:1,shots:{s:{state:'synced',acceptedOutputIdentity:createHash('sha256').update(tiff).digest('hex')}}}};
  const callbacks=new Map<string,(...args:any[])=>any>();registerLayerIpcHandlers({handle:((name:string,fn:(...args:any[])=>any)=>{callbacks.set(name,fn);})as any},createLayerAppHandlers());
  const payload={folderPath,bitmapPath,dataUrl:'data:image/png;base64,'+png.toString('base64'),project,shotId:'s',layerId:'new',width:1024,height:1024};
  const create=callbacks.get('layers:createPng');expect(create).toBeTypeOf('function');
  const result=await withControlledMemory(createControlledMemoryBudget(1024*1024),()=>create!({},payload));
  expect(result).toMatchObject({ok:false,effect:'refused',message:expect.stringContaining('RAM_ADMISSION')});
  await expect(fs.readFile(file)).rejects.toMatchObject({code:'ENOENT'});expect(await fs.readFile(originalPath)).toEqual(original);expect(await fs.readFile(imagePath)).toEqual(tiff);
  const enough=await withControlledMemory(createControlledMemoryBudget(16*1024*1024),()=>create!({},payload));
  expect(enough).toMatchObject({ok:true,filePath:file});expect(await fs.readFile(file)).toEqual(png);expect(await fs.readFile(originalPath)).toEqual(original);expect(await fs.readFile(imagePath)).toEqual(tiff);
},120000);
