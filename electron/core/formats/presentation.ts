import sharp from 'sharp';
import {snapshotProject} from '../persistence/validate.js';
import {createHash} from 'node:crypto';
import {validPresentation,MATTE_HEIGHT,type FlowPresentation} from '../../shared/flowPresentation.js';
import type {TiffCodec,TiffCandidate,TiffText} from './index.js';
import type {AssetReaderV1,ImageDocumentV1,LayerV1} from '../../shared/refactorV1.js';
export type PresentationReceipt={settings:FlowPresentation;sourceHeight:number;contentIds:string[];overlays:{id:string;pixels:string}[]};
export function validPresentationReceipt(v:unknown):v is PresentationReceipt{
 if(!v||typeof v!=='object'||Array.isArray(v))return false;const r=v as PresentationReceipt;
 return Object.keys(r).sort().join()===['contentIds','overlays','settings','sourceHeight'].sort().join()&&validPresentation(r.settings)&&Number.isSafeInteger(r.sourceHeight)&&r.sourceHeight>0&&r.sourceHeight<=8192&&Array.isArray(r.contentIds)&&r.contentIds.length>0&&r.contentIds.length<=64&&Array.from(r.contentIds).every(id=>typeof id==='string'&&/^[\w-]{1,80}$/.test(id))&&new Set(r.contentIds).size===r.contentIds.length&&Array.isArray(r.overlays)&&r.overlays.length===(r.settings.dialogue?2:1)&&Array.from(r.overlays).every(o=>o&&Object.keys(o).sort().join()==='id,pixels'&&typeof o.id==='string'&&/^[\w-]{1,80}$/.test(o.id)&&typeof o.pixels==='string'&&/^[a-f0-9]{64}$/.test(o.pixels))&&new Set([...r.contentIds,...r.overlays.map(o=>o.id)]).size===r.contentIds.length+r.overlays.length;
}
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const pixels=async(b:Uint8Array)=>hash(await sharp(b,{limitInputPixels:16*1024*1024}).ensureAlpha().raw().toBuffer());
const xml=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]!));
/** Output-only derived layers. Editable assets are never resized or rewritten. */
export function createPresentationCodec(codec:TiffCodec):TiffCodec{
 return {
  async encode(input,read){
   try{
    if(!input||typeof input!=='object'||Array.isArray(input)||!Object.hasOwn(input,'image')||!Object.hasOwn(input,'text')||Object.keys(input).some(k=>!['image','text','presentation'].includes(k)))throw Error('Unsupported presentation input fields');
    const captured=structuredClone(input),settings=captured.presentation;
    if(!Object.hasOwn(captured,'presentation'))return codec.encode({image:captured.image,text:captured.text},read);
    if(!validPresentation(settings)||!captured.text)throw Error('Presentation requires valid settings and portable text');
    const t=captured.text;
    snapshotProject({schema:'storyboard-flow.project',version:1,id:t.projectId,name:t.projectName,revision:0,shots:[{id:t.shotId,imageId:captured.image.id,name:t.shotName,scriptText:t.scriptText}],parkedShots:[],dialogues:t.dialogues,images:{[captured.image.id]:captured.image}});
    const image=captured.image,w=image.width,h=image.height+(settings.mode==='expanded'?MATTE_HEIGHT*2:0),n=image.layers.length+(settings.dialogue?2:1);
    if(w<1||h<1||w>8192||h>8192||w*h*n>16*1024*1024||n>64)throw Error('Presentation exceeds TIFF pixel/layer limits');
    const bytes=new Map<string,Uint8Array>(),layers:LayerV1[]=[];
    const put=(b:Uint8Array)=>{const id=hash(b);bytes.set(id,b);return id;};
    for(const layer of image.layers){
     const source=Uint8Array.from(await read(layer.assetId));if(source.length>32*1024*1024||hash(source)!==layer.assetId)throw Error('Invalid immutable presentation source');
     const meta=await sharp(source).metadata();if(meta.width!==w||meta.height!==image.height)throw Error('Source dimensions changed');
     const png=settings.mode==='expanded'?await sharp(source).extend({top:MATTE_HEIGHT,bottom:MATTE_HEIGHT,left:0,right:0,background:'#00000000'}).png().toBuffer():source;
     layers.push({...layer,height:h,assetId:put(png)});
    }
    const overlays:PresentationReceipt['overlays']=[];
    const add=async(name:string,svg:string)=>{
     let id=`flow_${name==='Matte Overlay'?'matte':'dialogue'}`;while(layers.some(l=>l.id===id))id+='x';if(id.length>80)throw Error('Presentation layer identity collision');
     const png=await sharp(Buffer.from(svg)).png().toBuffer();
     overlays.push({id,pixels:await pixels(png)});
     layers.push({id,name,kind:'paint',visible:true,locked:true,opacity:1,blendMode:'normal',width:w,height:h,assetId:put(png)});
    };
    await add('Matte Overlay',`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${Math.min(MATTE_HEIGHT,h)}"/><rect y="${Math.max(0,h-MATTE_HEIGHT)}" width="${w}" height="${MATTE_HEIGHT}"/></svg>`);
    if(settings.dialogue){const text=captured.text.dialogues.map(d=>d.text.trim()).filter(Boolean).join(' ').replace(/\s+/g,' ');await add('Dialogue Overlay',`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><text x="24" y="${h-27}" font-family="sans-serif" font-size="24" fill="white">${xml(text)}</text></svg>`);}
    const receipt:PresentationReceipt={settings,sourceHeight:image.height,contentIds:image.layers.map(l=>l.id),overlays};
    return codec.encode({image:{...image,height:h,layers},text:{...captured.text,presentation:receipt}},async id=>{const b=bytes.get(id);if(!b)throw Error('Missing derived asset');return b;});
   }catch(e){return {ok:false,error:{code:'invalid-input',message:String(e)}};}
  },
  async decode(input){
   const result=await codec.decode(input);if(!result.ok)return result;
   const candidate=result.value,receipt=candidate.text?.presentation;if(!receipt)return result;
   const fallback=()=>{const text={...candidate.text!};delete text.presentation;return {ok:true as const,value:{...candidate,identity:'unverified' as const,text}};};
   try{
    if(!validPresentationReceipt(receipt))return fallback();
    const {image}=candidate,expectedHeight=receipt.sourceHeight+(receipt.settings.mode==='expanded'?150:0);
    if(image.height!==expectedHeight||image.layers.map(l=>l.id).join()!==[...receipt.contentIds,...receipt.overlays.map(o=>o.id)].join())return fallback();
    for(const [index,o] of receipt.overlays.entries()){const layer=image.layers.find(l=>l.id===o.id)!;if(layer.kind!=='paint'||layer.name!==(index===0?'Matte Overlay':'Dialogue Overlay')||!layer.visible||!layer.locked||layer.opacity!==1||layer.blendMode!=='normal'||await pixels(layer.png)!==o.pixels)return fallback();}
    const layers:TiffCandidate['image']['layers']=[];
    for(const id of receipt.contentIds){const layer=image.layers.find(l=>l.id===id)!;let png=layer.png;
     if(receipt.settings.mode==='expanded'){
      const raw=await sharp(png).ensureAlpha().raw().toBuffer();
      for(let y=0;y<image.height;y++)if(y<75||y>=image.height-75)for(let x=0;x<image.width;x++)if(raw[(y*image.width+x)*4+3]!==0)return fallback();
      png=await sharp(png).extract({left:0,top:75,width:image.width,height:receipt.sourceHeight}).png().toBuffer();
     }
     layers.push({...layer,height:receipt.sourceHeight,png});
    }
    return {ok:true,value:{...candidate,image:{...image,height:receipt.sourceHeight,layers}}};
   }catch{return fallback();}
  }
 };
}
