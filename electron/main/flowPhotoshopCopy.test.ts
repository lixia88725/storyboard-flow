import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { temporaryWorkspace } from '../../test/temporaryWorkspace';
import { createPhotoshopCopy } from './flowPhotoshopCopy';
import { createProjectStore } from '../core/persistence';

it('publishes a portable two-layer copy and refuses to overwrite an existing copy',async()=>{
  const root=await temporaryWorkspace('ps-copy-');
  const source=path.join(root,'分镜.tif');
  const original=await sharp({create:{width:64,height:32,channels:3,background:'#ff0000'}}).tiff().toBuffer();
  await fs.writeFile(source,original);
  const target=await createPhotoshopCopy(source);
  const manifest=path.join(target,'.storyboard-flow/checkpoints/project.json');
  const before=await fs.readFile(manifest);
  await expect(createPhotoshopCopy(source)).rejects.toThrow('已存在');
  expect(await fs.readFile(manifest)).toEqual(before);
  expect(await fs.readFile(source)).toEqual(original);
  await fs.rename(source,source+'.moved');
  const loaded=await createProjectStore().loadCheckpoint(target);
  if(!loaded.ok)throw Error(loaded.error.message);
  const image=Object.values(loaded.value.project.images)[0];
  expect(image.layers.map(layer=>[layer.kind,layer.locked])).toEqual([['image',true],['paint',false]]);
  expect(image.width).toBe(64);
});
it('rejects disguised input without publishing a project',async()=>{
  const root=await temporaryWorkspace('ps-copy-invalid-');
  const source=path.join(root,'错.tif');
  await fs.writeFile(source,await sharp({create:{width:8,height:8,channels:3,background:'#123456'}}).png().toBuffer());
  await expect(createPhotoshopCopy(source)).rejects.toThrow('TIFF');
  expect(await fs.readdir(root)).toEqual(['错.tif']);
});
