import {it,expect,vi} from 'vitest';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createTiffCodec,type TiffResult} from '.';
import {createPresentationCodec} from './presentation';
const get=<T>(r:TiffResult<T>)=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const depsDir=process.env.FLOW_PYTHON_DEPS_DIR??path.join(path.dirname(path.dirname(await fs.realpath('node_modules/sharp'))),'vendor/python/photoshop-tiff');
const native=()=>createTiffCodec({scriptPath:path.resolve('src/project-files/main/formats/codec.py'),depsDir});
const raw=(b:Uint8Array)=>sharp(b).ensureAlpha().raw().toBuffer();
it.each(['expanded','embedded'] as const)('derives %s output and restores editable pixels without duplicate overlays',async mode=>{
 const png=await sharp({create:{width:320,height:180,channels:4,background:'#cc2244'}}).png().toBuffer();
 const image={id:'image',revision:0,width:320,height:180,layers:[{id:'base',name:'Base',kind:'image' as const,visible:true,locked:false,opacity:1,blendMode:'normal' as const,width:320,height:180,assetId:sha(png)}]};
 const text={projectId:'p',projectName:'场',shotId:'s',shotName:'图',scriptText:'原文',dialogues:[{id:'d',shotId:'s',text:'你好 <&>'}]};
 const codec=createPresentationCodec(native()),encoded=get(await codec.encode({image,text,presentation:{mode,dialogue:true}},async()=>png));
 const exported=get(await native().decode(encoded));expect(exported.image.height).toBe(mode==='expanded'?330:180);expect(exported.image.layers).toHaveLength(3);
 expect(exported.image.layers.slice(1).every(l=>l.locked&&l.visible)).toBe(true);
 const restored=get(await codec.decode(encoded));expect(restored.image.height).toBe(180);expect(restored.image.layers).toHaveLength(1);expect(await raw(restored.image.layers[0].png)).toEqual(await raw(png));expect(restored.text?.presentation?.settings).toEqual({mode,dialogue:true});
 // An external edit to a generated layer is retained as ordinary pixels, never stripped.
 if(mode==='expanded'){
  const padded=structuredClone(exported);padded.image.layers[0].png=await sharp(padded.image.layers[0].png).composite([{input:Buffer.from('<svg width="1" height="1"><rect width="1" height="1" fill="red"/></svg>'),left:0,top:0}]).png().toBuffer();
  const retained=get(await createPresentationCodec({decode:async()=>({ok:true,value:padded}),encode:native().encode}).decode(encoded));
  expect(retained.identity).toBe('unverified');expect(retained.image.height).toBe(330);expect(await raw(retained.image.layers[0].png)).toEqual(await raw(padded.image.layers[0].png));
 }
 const altered=structuredClone(exported);altered.image.layers[1].png=await sharp({create:{width:320,height:exported.image.height,channels:4,background:'#00ff00'}}).png().toBuffer();
 const fake={decode:async()=>({ok:true as const,value:altered}),encode:native().encode};
 const preserved=get(await createPresentationCodec(fake).decode(encoded));expect(preserved.identity).toBe('unverified');expect(preserved.image.layers).toHaveLength(3);expect(preserved.text?.presentation).toBeUndefined();
});

it('refuses unknown envelope fields before reading assets or invoking the codec',async()=>{
 const read=vi.fn(),encode=vi.fn(),codec=createPresentationCodec({encode,decode:vi.fn()});
 for(const presentation of [undefined,{mode:'expanded',dialogue:false}]){
  const input={image:{},text:null,unexpected:'must not disappear',...(presentation?{presentation}:{})};
  expect(await codec.encode(input as never,read)).toMatchObject({ok:false,error:{code:'invalid-input'}});
 }
 expect(read).not.toHaveBeenCalled();expect(encode).not.toHaveBeenCalled();
});
