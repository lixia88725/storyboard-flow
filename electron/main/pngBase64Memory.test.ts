import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createControlledMemoryBudget, withControlledMemory } from './controlledMemory';
import { prepareLayerPngWrite, writeLayerPng } from './layerAssetService';

// Actual public preparation seam used by queued Main PNG writes. Deliberately
// never invokes its returned effect closure; this does not certify the writer.
test('Main PNG preparation refuses the decoded allocation before retaining its queued bytes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-base64-ram-root-'));
  const png=await sharp({create:{width:2,height:2,channels:4,background:'green'}}).png().toBuffer();
  const payload={folderPath:root,bitmapPath:'.storyboard-workbench/layers/s/a.png',dataUrl:'data:image/png;base64,'+png.toString('base64')};
  const budget=createControlledMemoryBudget(1);
  expect(()=>withControlledMemory(budget,()=>prepareLayerPngWrite(payload))).toThrow(/RAM_ADMISSION/);
  expect(await fs.readdir(root)).toEqual([]);expect(budget.usage().usedBytes).toBe(0);
});

test('sufficient Main preparation budget keeps a real queued PNG without touching the workspace',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-base64-ram-enough-'));
  const png=await sharp({create:{width:2,height:2,channels:4,background:'green'}}).png().toBuffer();
  const payload={folderPath:root,bitmapPath:'.storyboard-workbench/layers/s/a.png',dataUrl:'data:image/png;base64,'+png.toString('base64')};
  const budget=createControlledMemoryBudget(png.length),queued=withControlledMemory(budget,()=>prepareLayerPngWrite(payload));
  expect(typeof queued).toBe('function');expect(budget.usage().usedBytes).toBe(png.length);expect(await fs.readdir(root)).toEqual([]);
});

test('admitted queued bytes reach the real protected Native PNG writer unchanged',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-base64-ram-native-')),relative='.storyboard-workbench/layers/s/a.png',file=path.join(root,relative);
  const old=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer(),png=await sharp({create:{width:2,height:2,channels:4,background:'green'}}).png().toBuffer();
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});await fs.writeFile(file,old,{mode:0o600});
  const budget=createControlledMemoryBudget(1024*1024);
  const result=await withControlledMemory(budget,()=>writeLayerPng({folderPath:root,bitmapPath:relative,dataUrl:'data:image/png;base64,'+png.toString('base64')}));
  expect(result.filePath).toBe(file);expect(await fs.readFile(file)).toEqual(png);expect(budget.usage().usedBytes).toBeGreaterThanOrEqual(png.length);
});
