// Export synthetic PSDs through the real native bridge, then check them with
// independently installed psd-tools/Pillow. All artifacts stay in one temp root.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {execFileSync}from'node:child_process';import{createHash}from'node:crypto';import sharp from'sharp';
import{publishPsdExclusive}from'../dist-electron/project-files/main/flowPsdExport.js';
import{readPhotocraft,writePhotocraftPsd}from'../dist-electron/project-files/main/formats/photocraft.js';
const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'flow-psd-oracle-'));execFileSync(path.resolve('native/photocraft/target/debug/examples/fixtures'),[root]);
const sha=b=>createHash('sha256').update(b).digest('hex');
const reports=[];
for(const [index,mode]of ['normal','multiply','screen','hidden','transparent','srgb'].entries()){
 const source=path.join(root,mode==='transparent'?'transparent.psd':mode==='srgb'?'srgb.psd':'complex.psd'),original=await fs.readFile(source),decoded=await readPhotocraft(original,'psd'),assets=new Map();
 const layers=decoded.value.layers.map(({png,...l})=>{assets.set(sha(png),png);return{...l,assetId:sha(png)};});
 const baseRaw=await sharp(decoded.value.layers[0].png).ensureAlpha().raw().toBuffer();
 layers[0].sourceReference={originalId:'source',digest:sha(original),format:'psd',previewPixels:sha(baseRaw)};
 const expected=new Float64Array(baseRaw.length);for(let k=0;k<baseRaw.length;k++)expected[k]=baseRaw[k]/255;
 const specs=[];
 for(let j=0;j<2;j++){
  const color=j===0?'#ff000080':'#40b4dc80',blendMode=mode==='hidden'?'normal':mode==='transparent'||mode==='srgb'?'normal':mode;
  const png=await sharp({create:{width:4,height:2,channels:4,background:color}}).png().toBuffer(),raw=await sharp(png).ensureAlpha().raw().toBuffer();assets.set(sha(png),png);
  const l={id:'ink'+j,name:'Flow 绘画 '+j,kind:'paint',width:4,height:2,assetId:sha(png),visible:!(mode==='hidden'&&j===1),locked:j===1,opacity:j===0?.5:.75,blendMode};layers.push(l);
  const pngFile=path.join(root,mode+'-layer-'+j+'.png');await fs.writeFile(pngFile,png);specs.push({...l,png:pngFile});
  if(l.visible)for(let k=0;k<raw.length;k+=4){const sa=raw[k+3]/255*l.opacity,da=expected[k+3],oa=sa+da*(1-sa);for(let c=0;c<3;c++){const s=raw[k+c]/255,b=expected[k+c],blend=blendMode==='multiply'?s*b:blendMode==='screen'?s+b-s*b:s;expected[k+c]=oa?(sa*(1-da)*s+sa*da*blend+da*(1-sa)*b)/oa:0;}expected[k+3]=oa;}
 }
 const image={id:'image',revision:0,width:4,height:2,layers};const bytes=await writePhotocraftPsd(original,image,async id=>assets.get(id));
 const file=path.join(root,mode+'-export.psd'),expectedFile=path.join(root,mode+'-expected.png'),specFile=path.join(root,mode+'-layers.json');await publishPsdExclusive(file,bytes);await fs.writeFile(specFile,JSON.stringify(specs));
 const pixels=Buffer.alloc(expected.length);
 for(let k=0;k<expected.length;k++)pixels[k]=Math.round(expected[k]*255);
 await sharp(pixels,{raw:{width:4,height:2,channels:4}}).png().toFile(expectedFile);
 const stdout=execFileSync('python3',['scripts/flow-psd-oracle.py',source,file,expectedFile,specFile],{encoding:'utf8',env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});const report=JSON.parse(stdout);reports.push(report);await fs.writeFile(path.join(root,mode+'-receipt.json'),JSON.stringify(report));
 if(sha(await fs.readFile(source))!==sha(original))throw Error('Original changed');
}
await fs.writeFile(path.join(root,'receipt.json'),JSON.stringify({passed:true,reports},null,2));console.log('PASS',root,JSON.stringify(reports));
