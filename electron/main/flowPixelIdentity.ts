import sharp from 'sharp';
import {createHash} from 'node:crypto';
import type {AssetReaderV1,ImageDocumentV1} from '../shared/refactorV1.js';
import {reconcileExternalImage} from './flowImageReconciliation.js';
export async function pixelDigest(png:Uint8Array):Promise<string>{
 const pixels=await sharp(png,{limitInputPixels:32_000_000}).ensureAlpha().raw().toBuffer();
 return createHash('sha256').update(pixels).digest('hex');
}
export async function imagePixelDigests(image:ImageDocumentV1,reader:AssetReaderV1){
 const hashes:Record<string,string>={};
 for(const layer of image.layers)hashes[layer.id]=await pixelDigest(await reader(layer.assetId));
 return hashes;
}
/** Compare actual RGBA, then restore immutable PNG IDs in the chosen result. */
export async function reconcileTiffPixels(baseline:ImageDocumentV1,baselinePixels:Record<string,string>,local:ImageDocumentV1,external:ImageDocumentV1,identified:boolean,reader:AssetReaderV1){
 const localPixels=await imagePixelDigests(local,reader),externalPixels=await imagePixelDigests(external,reader);
 const semantic=(image:ImageDocumentV1,pixels:Record<string,string>)=>({...image,layers:image.layers.map(l=>({...l,assetId:pixels[l.id]}))});
 const planned=reconcileExternalImage(semantic(baseline,baselinePixels),semantic(local,localPixels),semantic(external,externalPixels),identified);
 if(planned.kind==='replace')for(const layer of planned.image.layers){
  const original=local.layers.find(l=>l.id===layer.id&&localPixels[l.id]===layer.assetId)??external.layers.find(l=>l.id===layer.id&&externalPixels[l.id]===layer.assetId);
  if(!original)throw Error('Reconciled pixel identity is unavailable');layer.assetId=original.assetId;
 }
 return {planned,externalPixels};
}
