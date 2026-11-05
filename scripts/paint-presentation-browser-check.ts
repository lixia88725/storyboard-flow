// Bundled only by the synthetic GUI runner; never imported by the product.
import { createPaintPresentation, type PaintReceipt } from '../src/drawing/renderer/paintPresentation';
import { paintPresentationCanvas } from '../src/drawing/renderer/paintPresentationCanvas';
import { createFlowPixels } from '../src/drawing/renderer';
import type { SketchStroke } from '../src/drawing/contracts/types';
import { strokeBrushFor } from '../src/drawing/renderer/brushPresets';

export async function runPaintRasterChecks() {
  const assert = (ok: unknown, message: string) => { if(!ok) throw Error(message); };
  const wait = async (fn: () => boolean) => { for(let i=0;i<500;i++){if(fn())return;await new Promise(r=>setTimeout(r,5));}throw Error('raster check timeout'); };
  const checks: unknown[] = [];
  for (const preset of ['hard','soft','pencil','eraser-hard','eraser-soft'] as const) {
    const erasing = preset.startsWith('eraser');
    const W=96,H=64, blank=document.createElement('canvas');blank.width=W;blank.height=H;
    if(erasing){const c=blank.getContext('2d')!;c.fillStyle='#38a0ef';c.fillRect(0,0,W,H);}
    const bytes=async (canvas: HTMLCanvasElement)=>new Uint8Array(await (await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!), 'image/png'))).arrayBuffer());
    const assets=new Map<string,Uint8Array>([['0'.repeat(64),await bytes(blank)]]), urls=new Map<string,string>();
    const source=async(id:string)=>{if(!urls.has(id))urls.set(id,URL.createObjectURL(new Blob([assets.get(id)! as Uint8Array<ArrayBuffer>],{type:'image/png'})));return urls.get(id)!;};
    const rgba=(canvas:HTMLCanvasElement)=>canvas.getContext('2d')!.getImageData(0,0,W,H).data;
    const compare=(a:Uint8ClampedArray,b:Uint8ClampedArray,label:string)=>{let count=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d){count++;max=Math.max(max,d);}}assert(count===0,`${preset} ${label}: ${count} differing channels, max ${max}`);return {label,channels:a.length,differences:count};};
    const pixelProducer=createFlowPixels({maxPixels:W*H,maxPngBytes:1024*1024,maxPoints:1000});
    let assetId='0'.repeat(64), revision=0;
    const commits: {stroke:SketchStroke;resolve:(value:PaintReceipt)=>void}[]=[];
    const raster=paintPresentationCanvas(source);
    const owner=createPaintPresentation({raster,current:()=>({shotId:'s',imageId:'i',layerId:'ink',width:W,height:H,assetId}),
      commit:async(_t,stroke)=>new Promise<PaintReceipt>(resolve=>commits.push({stroke,resolve})),report:message=>{throw Error(message);}});
    const points=[20,28,34,28,48,28,34,28,20,28,48,28];
    const full:SketchStroke={id:'first',tool:erasing?'eraser':'brush',color:'#dd3344',size:24,opacity:.35,softness:0,points,pressures:[1,.8,.7,.8,1,.7],brush:{...strokeBrushFor(preset,1),seed:71}};
    const image=()=>({id:'i',revision,width:W,height:H,layers:[{id:'ink',name:'Ink',kind:'paint' as const,visible:true,locked:false,opacity:1,blendMode:'normal' as const,width:W,height:H,assetId}]});
    const oracle=async(stroke:SketchStroke)=>{
      // Independent committed path: PNG decode -> FlowPixels -> PNG encode -> decode.
      // It receives exactly the captured stroke/seed, never another natural drag.
      const result=await pixelProducer.produce({image:image(),layerId:'ink',stroke:{...stroke,opacity:stroke.opacity!,softness:stroke.softness!}},async id=>assets.get(id)!);
      if(!result.ok)throw Error(result.error.message);return result.value.png;
    };
    const open=async(png:Uint8Array)=>{const bitmap=await createImageBitmap(new Blob([png as Uint8Array<ArrayBuffer>],{type:'image/png'}));const c=document.createElement('canvas');c.width=W;c.height=H;c.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();return c;};
    assert(owner.begin('s','ink',{...full,points:points.slice(0,2),pressures:[1]}),'begin');await wait(()=>owner.frame().status==='ready');
    for(let n=2;n<=points.length/2;n++)owner.update({...full,points:points.slice(0,n*2),pressures:full.pressures!.slice(0,n)});
    const first=await oracle(full), firstCanvas=await open(first);
    const one=compare(rgba(owner.frame().canvas!),rgba(firstCanvas),'active fixed-seed stroke');
    const alpha=rgba(firstCanvas).filter((_v,i)=>i%4===3);assert(erasing?Math.min(...alpha)>=Math.floor(255*.65):Math.max(...alpha)<=Math.ceil(255*.35),'single-stroke opacity cap');
    owner.end('first');
    const second={...full,id:'second',brush:{...full.brush!,seed:72}};
    owner.begin('s','ink',second);owner.end('second');
    assetId='1'.repeat(64);assets.set(assetId,first);revision++;
    const secondPng=await oracle(second),secondCanvas=await open(secondPng);
    const two=compare(rgba(owner.frame().canvas!),rgba(secondCanvas),'second stroke accumulates before ACK');
    const firstAlpha=rgba(firstCanvas),secondAlpha=rgba(secondCanvas);
    assert(firstAlpha.some((v,i)=>i%4===3&&(erasing?secondAlpha[i]<v:secondAlpha[i]>v)),'cross-stroke accumulation');
    commits[0].resolve({assetId,revision});await wait(()=>owner.stats().through===1);
    const rebased=compare(rgba(owner.frame().canvas!),rgba(secondCanvas),'first ACK rebase preserves second stroke once');
    assetId='2'.repeat(64);assets.set(assetId,secondPng);revision++;commits[1].resolve({assetId,revision});await wait(()=>owner.stats().records===0);
    const settled=compare(rgba(owner.frame().canvas!),rgba(secondCanvas),'settled asset');
    checks.push({preset,one,two,rebased,settled,resources:owner.stats()});owner.dispose();for(const url of urls.values())URL.revokeObjectURL(url);
    blank.width=firstCanvas.width=secondCanvas.width=0;
  }
  return checks;
}

/** Test-only fixed inputs and independent committed-PNG oracle, used against the
 * real mounted owner and real Session by the recovery contract GUI driver. */
export function recoveryContractStrokes() {
  const common = { size: 70, opacity: .55, softness: 0, points: [220,180,340,180,220,180], pressures: [1,.8,1] };
  const a: SketchStroke = { ...common, id:'contract-A', tool:'brush', color:'#dd3344', brush:{...strokeBrushFor('hard',1),seed:71} };
  const b: SketchStroke = { ...common, id:'contract-B', tool:'eraser', color:'#000000', opacity:.6, brush:{...strokeBrushFor('eraser-hard',1),seed:72} };
  return [a,b];
}
export async function comparePaintSequence(base: Uint8Array, width: number, height: number, strokes: SketchStroke[], actual: HTMLCanvasElement | Uint8Array) {
  const producer=createFlowPixels({maxPixels:width*height,maxPngBytes:4*1024*1024,maxPoints:1000});
  let png=base;
  for(const stroke of strokes){
    const assetId='0'.repeat(64);
    const result=await producer.produce({image:{id:'oracle',revision:0,width,height,layers:[{id:'ink',name:'Ink',kind:'paint',visible:true,locked:false,opacity:1,blendMode:'normal',width,height,assetId}]},layerId:'ink',stroke:{...stroke,opacity:stroke.opacity!,softness:stroke.softness!}},async()=>png);
    if(!result.ok)throw Error(result.error.message);png=result.value.png;
  }
  const open=async(bytes:Uint8Array)=>{
    const bitmap=await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>],{type:'image/png'}));
    const c=document.createElement('canvas');c.width=width;c.height=height;c.getContext('2d')!.drawImage(bitmap,0,0);bitmap.close();return c;
  };
  const expected=await open(png), observed=actual instanceof HTMLCanvasElement?actual:await open(actual);
  const a=expected.getContext('2d')!.getImageData(0,0,width,height).data,b=observed.getContext('2d')!.getImageData(0,0,width,height).data;
  let differences=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);if(d){differences++;max=Math.max(max,d);}}
  expected.width=0;if(!(actual instanceof HTMLCanvasElement))observed.width=0;
  return {channels:a.length,differences,max};
}
