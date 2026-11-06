import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
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
async function readJobFile(root:string,leaf:string,cap:number):Promise<Buffer>{
  if(typeof constants.O_NOFOLLOW!=='number')throw Error('Native no-follow reads unavailable');
  const handle=await fs.open(path.join(root,leaf),constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const stat=await handle.stat();if(!stat.isFile()||stat.size>cap)throw Error('PhotoCraft worker file exceeds limits or is not regular');
    const bytes=await handle.readFile();if(bytes.length>cap)throw Error('PhotoCraft worker file grew beyond limits');return bytes;
  }finally{await handle.close();}
}
export function photocraftBinary() {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return (process.env.FLOW_PHOTOCRAFT_BIN ? path.resolve(process.env.FLOW_PHOTOCRAFT_BIN) : undefined) || (path.basename(flowAppRoot) === 'app' && resources
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
    const response = JSON.parse((await readJobFile(root,'response.json',1024*1024)).toString('utf8'));
    if (response.ok !== true) throw Error(String(response.error?.message ?? 'PhotoCraft decode failed'));
    const result = response.value;
    if (Object.keys(result??{}).sort().join()!=='height,layers,protocol,reference,upstream,warnings,width' || result?.protocol !== 1 || result.upstream !== PHOTOCRAFT_COMMIT || typeof result.reference !== 'boolean' ||
      !Number.isSafeInteger(result.width) || !Number.isSafeInteger(result.height) || result.width < 1 || result.height < 1 ||
      result.width > 8192 || result.height > 8192 || !Array.isArray(result.layers) || result.layers.length < 1 || result.layers.length > 64 ||
      result.width * result.height * result.layers.length > PIXEL_CAP || !Array.isArray(result.warnings) || result.warnings.length > 64 || result.warnings.some((w:unknown)=>typeof w !== 'string' || (!w.startsWith('the vertical resolution (') && !w.startsWith('PSD 层合成与内嵌画面不一致（最大 '))))
      throw Error('PhotoCraft protocol, geometry or compatibility mismatch');
    const layers: ConvertedSource['layers'] = [];
    for (const [i, layer] of result.layers.entries()) {
      if (Object.keys(layer??{}).sort().join()!=='blendMode,locked,name,opacity,visible' || typeof layer.name !== 'string' || layer.name.includes('\0') || typeof layer.visible !== 'boolean' || typeof layer.locked !== 'boolean' ||
        !Number.isFinite(layer.opacity) || layer.opacity < 0 || layer.opacity > 1 || !['normal', 'multiply', 'screen'].includes(layer.blendMode))
        throw Error('PhotoCraft returned invalid layer properties');
      const png = await readJobFile(root,`${i}.png`,PNG_CAP);
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

/** Append-only PSD export; the caller has already bound the retained original.
 * No destination path enters the worker. Main publishes the resulting bytes. */
export async function writePhotocraftPsd(original: Uint8Array, image: import('../../../platform/contracts/refactorV1.js').ImageDocumentV1,
  readAsset: import('../../../platform/contracts/refactorV1.js').AssetReaderV1, binary = photocraftBinary()): Promise<Uint8Array> {
  if (!(original instanceof Uint8Array) || original.length < 1 || original.length > BYTE_CAP) throw Error('PSD source exceeds byte limit');
  if (running) throw Error('PhotoCraft reader/exporter is busy');
  const source = Buffer.from(original), captured = structuredClone(image);
  if (!captured.layers[0]?.sourceReference || captured.layers[0].sourceReference.format !== 'psd' || captured.layers.length < 2 ||
    captured.layers.slice(1).some(l=>l.sourceReference || l.kind !== 'paint') || captured.width * captured.height * captured.layers.length > PIXEL_CAP)
    throw Error('PSD另存需要底部的受保护PSD来源及其上方的Flow绘画层；TIFF复杂来源到PSD暂不支持');
  if(createHash('sha256').update(source).digest('hex')!==captured.layers[0].sourceReference.digest)throw Error('PSD保管原件摘要与capture不一致');
  running = true;
  let root: string | undefined, succeeded = false;
  try {
    root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'flow-photocraft-export-'));
    await fs.writeFile(path.join(root,'source.bin'),source,{flag:'wx'});
    for (const [i,layer] of captured.layers.entries()) {
      const png=Buffer.from(await readAsset(layer.assetId));
      if(png.length>PNG_CAP || createHash('sha256').update(png).digest('hex')!==layer.assetId)throw Error('PSD export asset identity mismatch');
      await fs.writeFile(path.join(root,i===0?'base.png':`${i-1}.png`),png,{flag:'wx'});
    }
    const request={protocol:1,operation:'export-psd',width:captured.width,height:captured.height,layers:captured.layers.slice(1).map(l=>({name:l.name,visible:l.visible,locked:l.locked,opacity:l.opacity,blendMode:l.blendMode}))};
    const metadata=JSON.stringify(request);if(Buffer.byteLength(metadata)>1024*1024)throw Error('PSD export metadata exceeds1MiB limit');
    await fs.writeFile(path.join(root,'request.json'),metadata,{flag:'wx'});
    await new Promise<void>((resolve,reject)=>execFile(binary,[root!],{cwd:root,timeout:60_000,killSignal:'SIGKILL',maxBuffer:64*1024,env:{...process.env,RAYON_NUM_THREADS:'2',TMPDIR:root}},(error,_out,stderr)=>error?reject(Error(`PSD worker failed: ${error.message}; ${stderr.slice(0,2048)}`)):resolve()));
    const response=JSON.parse((await readJobFile(root,'response.json',1024*1024)).toString('utf8'));
    if(response.ok!==true)throw Error(String(response.error?.message??'PSD export failed'));
    const v=response.value;
    if(Object.keys(v??{}).sort().join()!=='height,layersAdded,operation,protocol,retainedLayers,upstream,width'||!Number.isSafeInteger(v.retainedLayers)||v.retainedLayers<1||v.retainedLayers+v.layersAdded>64||v?.protocol!==1||v.upstream!==PHOTOCRAFT_COMMIT||v.operation!=='export-psd'||v.width!==captured.width||v.height!==captured.height||v.layersAdded!==captured.layers.length-1)throw Error('PSD export receipt mismatch');
    const bytes=await readJobFile(root,'output.psd',BYTE_CAP);if(!bytes.subarray(0,4).equals(Buffer.from('8BPS')))throw Error('PSD output signature mismatch');
    succeeded=true;return bytes;
  } catch(error) { throw Error(`${error instanceof Error?error.message:String(error)}${root?'; private export evidence retained at '+root:''}`); }
  finally { try {if(root&&succeeded)await fs.rm(root,{recursive:true});}finally{running=false;} }
}
