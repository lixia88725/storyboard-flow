// Explicit macOS synthetic-only Photoshop verification. Requires zero open docs.
// No activation, color-settings change, personal input, clipboard or Trash.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {promisify}from'node:util';import{execFile}from'node:child_process';import{createHash}from'node:crypto';import sharp from'sharp';
const jsxTemplate=String.raw`(function(){
function quote(s){return '"'+String(s).replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\r/g,'\\r').replace(/\n/g,'\\n')+'"';}
function json(v){if(v===null)return 'null';if(typeof v==='string')return quote(v);if(typeof v==='number'||typeof v==='boolean')return String(v);if(v instanceof Array){var a=[];for(var i=0;i<v.length;i++)a.push(json(v[i]));return '['+a.join(',')+']';}var p=[];for(var k in v)if(v.hasOwnProperty(k))p.push(quote(k)+':'+json(v[k]));return '{'+p.join(',')+'}';}
var plan=__PLAN__,report=new File(plan.report),result={version:app.version,before:[],cases:[],ok:false},owned=[],oldDialogs=app.displayDialogs;
for(var b=0;b<app.documents.length;b++)result.before.push(app.documents[b].id);
if(result.before.length)throw Error('Existing documents appeared; synthetic check refused without touching them');
if(report.exists)throw Error('Report already exists');
function layers(items,depth){if(depth>16)throw Error('Depth limit');var rows=[];for(var i=0;i<items.length;i++){var l=items[i],r={name:l.name,kind:l.typename,opacity:l.opacity,visible:l.visible,blend:String(l.blendMode)};if(l.typename==='LayerSet')r.children=layers(l.layers,depth+1);rows.push(r);}return rows;}
try{
 app.displayDialogs=DialogModes.NO;
 for(var i=0;i<plan.cases.length;i++){
  var c=plan.cases[i],f=new File(c.source),png=new File(c.png),psd=new File(c.psd);
  if(!f.exists||png.exists||psd.exists)throw Error('Unsafe synthetic source/output');
  var doc=app.open(f);owned.push(doc.id);
  var profile='untagged';try{profile=doc.colorProfileName;}catch(e){}
  var row={mode:c.mode,width:doc.width.as('px'),height:doc.height.as('px'),profile:profile,depth:String(doc.bitsPerChannel),layers:layers(doc.layers,0)};
  var po=new PhotoshopSaveOptions();po.layers=true;po.alphaChannels=true;po.embedColorProfile=true;
  doc.saveAs(psd,po,true,Extension.LOWERCASE);
  var opts=new PNGSaveOptions();opts.interlaced=false;opts.compression=9;doc.saveAs(png,opts,true,Extension.LOWERCASE);
  result.cases.push(row);doc.close(SaveOptions.DONOTSAVECHANGES);
 }
 result.ok=true;
}catch(e){result.error=String(e)+';line='+e.line;}
finally{
 for(var j=app.documents.length-1;j>=0;j--){var d=app.documents[j];for(var k=0;k<owned.length;k++)if(d.id===owned[k]){d.close(SaveOptions.DONOTSAVECHANGES);break;}}
 app.displayDialogs=oldDialogs;result.after=[];for(var j=0;j<app.documents.length;j++)result.after.push(app.documents[j].id);
 report.encoding='UTF8';if(!report.open('w'))throw Error('Cannot record native result');report.write(json(result));report.close();
}
return json(result);
})();`;
const root=await fs.realpath(process.argv[2]),temp=await fs.realpath(os.tmpdir());
if(process.platform!=='darwin'||path.dirname(root)!==temp||!path.basename(root).startsWith('flow-psd-oracle-'))throw Error('Only this task synthetic oracle directory is allowed');
const receipt=JSON.parse(await fs.readFile(path.join(root,'receipt.json'),'utf8'));if(!receipt.passed)throw Error('Independent oracle has not passed');
const sha=b=>createHash('sha256').update(b).digest('hex'),modes=['normal','multiply','screen','hidden','transparent','srgb'],before={};
const out=await fs.mkdtemp(path.join(root,'photoshop-guarded-'));
const cases=[];
for(const mode of modes){const source=path.join(root,mode+'-export.psd'),b=await fs.readFile(source);if(b.length>128*1024*1024||b.subarray(0,4).toString()!=='8BPS'||b.readUInt32BE(14)!==2||b.readUInt32BE(18)!==4)throw Error('Only4x2syntheticPSD fixtures are allowed');before[source]=sha(b);cases.push({mode,source,png:path.join(out,mode+'.png'),psd:path.join(out,mode+'-photoshop.psd')});}
const plan={root,report:path.join(out,'result.json'),cases},jsx=path.join(out,'validate.jsx'),apple=path.join(out,'run.applescript');
await fs.writeFile(path.join(out,'before-sha.json'),JSON.stringify(before,null,2));await fs.writeFile(jsx,jsxTemplate.replace('__PLAN__',JSON.stringify(plan)));
await fs.writeFile(apple,'with timeout of 120 seconds\n tell application "/Applications/Adobe Photoshop 2026/Adobe Photoshop 2026.app"\n  do javascript file (POSIX file '+JSON.stringify(jsx)+')\n end tell\nend timeout\n');
let output;try{output=await promisify(execFile)('osascript',[apple],{timeout:130000,maxBuffer:1024*1024});}catch(error){throw Error('Photoshop check did not return; outcome may still be in flight. Do not retry automatically; inspect '+out+'; '+error);}
await fs.writeFile(path.join(out,'applescript.log'),output.stdout+'\n'+output.stderr);
const result=JSON.parse(await fs.readFile(plan.report,'utf8'));if(!result.ok||result.before.length||result.after.length)throw Error('Native check refused or did not close its own documents: '+JSON.stringify(result));
const pixels=[];
for(const c of cases){if(sha(await fs.readFile(c.source))!==before[c.source])throw Error('Synthetic input bytes changed');const a=await sharp(path.join(root,c.mode+'-expected.png')).ensureAlpha().raw().toBuffer(),b=await sharp(c.png).ensureAlpha().raw().toBuffer();if(a.length!==b.length)throw Error('Native render dimensions changed');let max=0;for(let i=0;i<a.length;i++)max=Math.max(max,Math.abs(a[i]-b[i]));if(max>2)throw Error('Photoshop render differs: '+c.mode+' max='+max);pixels.push({mode:c.mode,maxDifference:max});}
await fs.writeFile(path.join(out,'receipt.json'),JSON.stringify({passed:true,version:result.version,sourceHashesUnchanged:true,before:result.before,after:result.after,pixels},null,2));console.log('PASS',out,JSON.stringify(pixels));
