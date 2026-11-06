import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { flowAppRoot } from '../../../platform/main/flowRuntimePaths.js';
import type { ConvertedSource } from '../imageSourceConversion.js';

export const PHOTOCRAFT_COMMIT = 'a259993118ac7ce1d4c828a385abbc3191841e86';
const BYTE_CAP = 128 * 1024 * 1024, PNG_CAP = 32 * 1024 * 1024, PIXEL_CAP = 16 * 1024 * 1024;
let running = false;
export function photocraftBinary() {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return process.env.FLOW_PHOTOCRAFT_BIN || (path.basename(flowAppRoot) === 'app' && resources
    ? path.join(resources, 'photocraft', process.platform === 'win32' ? 'flow-photocraft.exe' : 'flow-photocraft')
    : path.join(flowAppRoot, 'native/photocraft/target/debug', process.platform === 'win32' ? 'flow-photocraft.exe' : 'flow-photocraft'));
}
/** Read-only, one-shot worker. All its writes stay in a private job. A timeout
 * kills and reaps the process before cleanup/return; no original paths cross it. */
export async function readPhotocraft(bytes: Uint8Array, format: 'psd' | 'tiff', binary = photocraftBinary()): Promise<{ value: ConvertedSource; reference: boolean; warnings: string[] }> {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > BYTE_CAP) throw Error('PhotoCraft source exceeds byte limit');
  if (running) throw Error('PhotoCraft reader is busy');
  const captured = Buffer.from(bytes);
  running = true;
  let root: string | undefined, succeeded = false;
  try {
    await fs.access(binary).catch(() => { throw Error('PhotoCraft 读取组件未准备好；请运行 npm run setup:photocraft 和 npm run build:photocraft'); });
    root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'flow-photocraft-job-'));
    await fs.writeFile(path.join(root, 'source.bin'), captured, { flag: 'wx' });
    await fs.writeFile(path.join(root, 'request.json'), JSON.stringify({ protocol: 1, format }), { flag: 'wx' });
    await new Promise<void>((resolve, reject) => execFile(binary, [root!], {
      cwd: root, timeout: 60_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
      env: { ...process.env, RAYON_NUM_THREADS: '2', TMPDIR: root }
    }, (error, _stdout, stderr) => error ? reject(Error(`PhotoCraft worker failed: ${error.message}; ${stderr.slice(0, 2048)}`)) : resolve()));
    const responsePath = path.join(root, 'response.json');
    if ((await fs.stat(responsePath)).size > 1024 * 1024) throw Error('PhotoCraft response exceeds metadata limit');
    const response = JSON.parse(await fs.readFile(responsePath, 'utf8'));
    if (response.ok !== true) throw Error(String(response.error?.message ?? 'PhotoCraft decode failed'));
    const result = response.value;
    if (result?.protocol !== 1 || result.upstream !== PHOTOCRAFT_COMMIT || typeof result.reference !== 'boolean' ||
      !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) || result.width < 1 || result.height < 1 ||
      result.width > 8192 || result.height > 8192 || !Array.isArray(result.layers) || result.layers.length < 1 || result.layers.length > 64 ||
      result.width * result.height * result.layers.length > PIXEL_CAP || !Array.isArray(result.warnings) || result.warnings.length > 64 || result.warnings.some((w:unknown)=>typeof w !== 'string' || (!w.startsWith('the vertical resolution (') && !w.startsWith('PSD 层合成与内嵌画面不一致（最大 '))))
      throw Error('PhotoCraft protocol, geometry or compatibility mismatch');
    const layers: ConvertedSource['layers'] = [];
    for (const [i, layer] of result.layers.entries()) {
      if (typeof layer.name !== 'string' || layer.name.includes('\0') || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' ||
        !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || !['normal', 'multiply', 'screen'].includes(layer.blendMode))
        throw Error('PhotoCraft returned invalid layer properties');
      const file = path.join(root, `${i}.png`), stat = await fs.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > PNG_CAP) throw Error('PhotoCraft returned invalid PNG');
      const png = await fs.readFile(file);
      const meta = await sharp(png, { limitInputPixels: PIXEL_CAP }).metadata();
      if (meta.format !== 'png' || meta.width !== result.width || meta.height !== result.height || meta.depth !== 'uchar' || (meta.pages ?? 1) !== 1)
        throw Error('PhotoCraft PNG geometry mismatch');
      await sharp(png, { limitInputPixels: PIXEL_CAP }).raw().toBuffer();
      layers.push({ id: `photocraft-${i}`, name: layer.name, visible: layer.visible, locked: layer.locked,
        opacity: layer.opacity, blendMode: layer.blendMode, width: result.width, height: result.height, kind: 'image', png });
    }
    if (result.reference && (layers.length !== 1 || !layers[0].locked || !layers[0].visible || layers[0].opacity !== 1 || layers[0].blendMode !== 'normal'))
      throw Error('PhotoCraft reference protection mismatch');
    const value: ConvertedSource = {kind:'tiff',width:result.width,height:result.height,layers,text:null};
    const checked = format === 'tiff' ? await checkTiffDisplay(captured,value,result.reference) : {value,reference:result.reference,warnings:[]};
    succeeded = true;
    return {...checked,warnings:[...result.warnings,...checked.warnings]};
  } catch (error) {
    throw Error(`${error instanceof Error ? error.message : String(error)}${root ? '; read-only worker evidence retained at ' + root : ''}`);
  } finally {
    // Job paths are unique and never escape to callers. Child has exited before cleanup.
    try { if (root && succeeded) await fs.rm(root, { recursive: true }); } finally { running = false; }
  }
}

/** A TIFF can have a stale layer section next to a different merged image. The
 * independently decoded embedded composite decides display; disagreement never
 * becomes an editable stack, even when every individual layer decodes. */
async function checkTiffDisplay(bytes: Buffer, value: ConvertedSource, reference: boolean) {
  const expected = await sharp(bytes,{failOn:'error',limitInputPixels:PIXEL_CAP}).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});
  if(expected.info.width!==value.width || expected.info.height!==value.height || expected.info.channels!==4)throw Error('TIFF embedded composite geometry disagrees with PhotoCraft');
  const composite=new Float32Array(value.width*value.height*4);
  for(const layer of value.layers) {
    if(!layer.visible)continue;
    const raw=await sharp(layer.png,{limitInputPixels:PIXEL_CAP}).ensureAlpha().raw().toBuffer();
    for(let k=0;k<raw.length;k+=4) {
      const sa=raw[k+3]/255*layer.opacity,da=composite[k+3],oa=sa+da*(1-sa);
      for(let c=0;c<3;c++) {
        const s=raw[k+c]/255,b=composite[k+c],blend=layer.blendMode==='multiply'?s*b:layer.blendMode==='screen'?s+b-s*b:s;
        composite[k+c]=oa ? (sa*(1-da)*s+sa*da*blend+da*(1-sa)*b)/oa : 0;
      }
      composite[k+3]=oa;
    }
  }
  let max=0;
  for(let k=0;k<expected.data.length;k++) {
    // RGB under fully transparent pixels has no visible meaning.
    if(k%4!==3 && !expected.data[k-k%4+3] && !composite[k-k%4+3])continue;
    max=Math.max(max,Math.abs(Math.round(composite[k]*255)-expected.data[k]));
  }
  if(max<=2)return {value,reference,warnings:[] as string[]};
  const png=await sharp(expected.data,{raw:{width:value.width,height:value.height,channels:4}}).png().toBuffer();
  if(png.length>PNG_CAP)throw Error('Embedded TIFF composite exceeds PNG budget');
  return {reference:true,value:{...value,layers:[{...value.layers[0],id:'photocraft-reference',name:'PhotoCraft · 受保护的 TIFF 内嵌画面',png,visible:true,locked:true,opacity:1,blendMode:'normal' as const}]},
    warnings:[`TIFF 层合成与内嵌画面不一致（最大 ${max} 色阶）；采用文件内嵌画面作为受保护底图，原始层数据完整保留在原件中。`]};
}
