import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { readBoundFile } from '../core/persistence/fileOps.js';
import { createProjectStore } from '../core/persistence/index.js';
import { publishDirectoryExclusive } from '../core/platform/index.js';
import { defaultTiffLimits } from '../core/formats/index.js';
import { createHash } from 'node:crypto';
import type { ProjectV1 } from '../shared/refactorV1.js';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate.js';

/** Take a snapshot of the composite. The source is never registered as a writable output. */
export async function createPhotoshopCopy(file: string): Promise<string> {
  if (!path.isAbsolute(file) || !/\.tiff?$/i.test(file) || await fs.realpath(file) !== file)
    throw Error('请选择普通 TIFF 文件');
  const name = path.parse(file).name + '-Flow';
  const parent = path.dirname(file), target = path.join(parent, name);
  await assertPhysicalWorkspaceWriterTargets([target]);
  try {
    await fs.lstat(target);
    throw Error('同名工作副本已存在，请使用“打开项目”打开：' + target);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const limits = defaultTiffLimits;
  const source = await readBoundFile(file, limits.maxTiffBytes);
  if (!source) throw Error('找不到所选文件');
  const pixels = sharp(source, {failOn:'error', limitInputPixels:limits.maxTotalPixels / 2});
  const meta = await pixels.metadata();
  if (meta.format !== 'tiff' || (meta.pages ?? 1) !== 1 || meta.depth !== 'uchar' ||
      !['srgb','rgb'].includes(meta.space) || meta.width > limits.maxDimension || meta.height > limits.maxDimension ||
      meta.width * meta.height * 2 > limits.maxTotalPixels)
    throw Error('工作副本支持单页 8 位 RGB TIFF，画布须符合双图层大小限制');
  const {data:base,info:{width,height}} = await pixels.rotate().toColourspace('srgb').ensureAlpha().png().toBuffer({resolveWithObject:true});
  const ink = await sharp({create:{width,height,channels:4,background:'#00000000'}}).png().toBuffer();
  const assets = new Map<string,Buffer>();
  const layers = [base,ink].map((png,i) => {
    if (png.length > limits.maxPngBytes) throw Error('工作副本图层过大');
    const assetId = createHash('sha256').update(png).digest('hex');
    assets.set(assetId,png);
    return {id:i?'ink':'base', name:i?'Flow 绘画':'Photoshop 合成底图', kind:i?'paint' as const:'image' as const,
      visible:true, locked:!i, opacity:1, blendMode:'normal' as const, width,height,assetId};
  });
  const imageId=randomUUID();
  const project:ProjectV1={schema:'storyboard-flow.project', version:1, id:randomUUID(), revision:0, name,
    naming:{sceneCode:'scene',artistName:'artist',version:'v001'},
    shots:[{id:randomUUID(),imageId,name:path.parse(file).name,scriptText:''}],parkedShots:[],dialogues:[],
    images:{[imageId]:{id:imageId,revision:0,width,height,layers}}};
  const stage=await fs.mkdtemp(path.join(parent,'.flow-copy-'));
  const identity=await fs.lstat(stage,{bigint:true});
  try {
    const result=await createProjectStore().saveCheckpoint(stage,project,async id=>assets.get(id)!);
    if (!result.ok) throw Error(result.error.message);
    await assertPhysicalWorkspaceWriterTargets([target]);
    await publishDirectoryExclusive(stage,target);
    return target;
  } finally {
    const left=await fs.lstat(stage,{bigint:true}).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});
    if(left && left.dev===identity.dev && left.ino===identity.ino && await fs.realpath(stage)===stage)
      await fs.rm(stage,{recursive:true});
  }
}
