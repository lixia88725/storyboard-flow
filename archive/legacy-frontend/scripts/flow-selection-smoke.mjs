// Real TIFF-only folder -> isolated editor -> Save/Undo/Save -> relocate -> reopen.
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rename,cp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createTiffCodec} from '../dist-electron/core/formats/index.js';
import {createProjectStore} from '../dist-electron/core/persistence/index.js';
const require=createRequire(import.meta.url),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-selection-smoke-'));
let root=path.join(run,'tiff-folder');await mkdir(root);await mkdir(path.join(root,'Pending'));
const get=r=>{if(!r.ok)throw Error(r.error.message);return r.value};
const codec=createTiffCodec({scriptPath:path.join(repo,'electron/core/formats/codec.py'),depsDir:path.join(repo,'vendor/python/photoshop-tiff')});
const assets=new Map();const image={id:'shared-image',revision:0,width:640,height:360,layers:[]};
for(const [i,color] of ['#ffffff','#00000000'].entries()){
 const png=await sharp({create:{width:640,height:360,channels:4,background:color}}).png().toBuffer();
 const assetId=createHash('sha256').update(png).digest('hex');assets.set(assetId,png);
 image.layers.push({id:i?'ink':'base',name:i?'绘画':'背景',kind:i?'paint':'image',visible:true,locked:false,opacity:1,blendMode:'normal',width:640,height:360,assetId});
}
const original=get(await codec.encode({image,text:{projectId:'source-project',projectName:'source',shotId:'shared-shot',shotName:'镜头',scriptText:'源脚本',dialogues:[{id:'same-line',shotId:'shared-shot',text:'源对白'}]}},async id=>assets.get(id)));
for(const name of ['01.tif','02.tif','Pending/03.tif'])await writeFile(path.join(root,name),original);
const japanese=process.env.FLOW_SELECTION_JAPANESE==='1';
const identity={japanese,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run};
for(const phase of ['cancel','edit','reopen']){
 if(phase==='reopen'){
  const retained=root+'-original';await rename(root,retained);root=path.join(run,'relocated-project');await cp(retained,root,{recursive:true});
 }
 const userData=path.join(run,phase+'-userData');await mkdir(userData);const driver=path.join(run,phase+'.cjs');
 await writeFile(driver,`
const {app,BrowserWindow,clipboard,shell,dialog,ipcMain}=require('electron');const fs=require('node:fs');const assert=require('node:assert/strict');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};shell.trashItem=()=>{throw Error('Trash forbidden')};
// Script the native dialog's selected folder, not the import/runtime implementation.
dialog.showErrorBox=(title,message)=>{console.error(title,message);app.exit(1)};
dialog.showOpenDialog=async()=>({canceled:${JSON.stringify(phase==='cancel')},filePaths:[${JSON.stringify(root)}]});
process.argv=[process.argv[0],${JSON.stringify(path.join(repo,'dist-electron/main/flowEditorEntry.js'))},'--choose',${JSON.stringify(userData)}];
let holdPut=false,putEntered=false,releasePut;const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>handle(channel,async(...args)=>{const result=await fn(...args);if(channel==='flow-editor:put'&&holdPut){putEntered=true;await new Promise(r=>releasePut=r)}return result});
const delay=ms=>new Promise(r=>setTimeout(r,ms));let win;const phase=${JSON.stringify(phase)};
const outputFile=()=>{const p=read();const ledger=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/tiff-output.json'))},'utf8'));return ${JSON.stringify(root)}+'/'+ledger.entries.find(e=>e.shotId===p.shots[0].id).name};
const read=()=>JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/checkpoints/project.json'))},'utf8'));
async function wait(fn,label){for(let i=0;i<600;i++){try{const v=await fn();if(v)return v}catch{}await delay(50)}throw Error('Timed out: '+label)}
const js=code=>win.webContents.executeJavaScript(code);
async function rect(selector){return js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()')}
async function mouse(type,x,y){win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});await delay(60)}
async function button(text){await js('Array.from(document.querySelectorAll("button")).find(e=>e.textContent==='+JSON.stringify(text)+').click()');await delay(100)}
async function save(){await button('Save TIFF');await wait(()=>js('Array.from(document.querySelectorAll("span")).find(e=>e.getAttribute("aria-label")==="TIFF output status").textContent==="TIFF saved"'),'TIFF Save')}
app.on('window-all-closed',()=>fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-closed.json'))},JSON.stringify({normalClose:true})));
import(${JSON.stringify('file://'+path.join(repo,'dist-electron/main/flowEditorEntry.js'))}).then(async()=>{
 await app.whenReady();win=await wait(()=>BrowserWindow.getAllWindows()[0],'window');
 win.webContents.on('console-message',e=>console.log('renderer',e.message));
 await wait(()=>js('!!document.querySelector("[data-flow-editor]")'),'editor');
 await wait(()=>js('document.querySelector("[role=status]").textContent==="Editable project saved"'),'initial checkpoint');
 await wait(()=>js('document.querySelectorAll(".image-stage img").length>0&&Array.from(document.querySelectorAll(".image-stage img")).every(i=>i.complete&&i.naturalWidth>0)'),'images');
 const p=read(),shot=p.shots[0],image=p.images[shot.imageId];
 assert.equal(p.shots.length,2);assert.equal(p.parkedShots.length,1);assert.equal(p.dialogues.length,3);
 assert.notEqual(p.id,'source-project');assert.equal(new Set([...p.shots,...p.parkedShots].map(s=>s.id)).size,3);
 assert.equal(new Set([...p.shots,...p.parkedShots].map(s=>s.imageId)).size,3);assert.equal(new Set(p.dialogues.map(d=>d.id)).size,3);
 const initial=image.layers[1].assetId;
 if(phase==='edit'){
  assert.deepEqual(fs.readFileSync(${JSON.stringify(path.join(root,'01.tif'))}),Buffer.from(${JSON.stringify(Buffer.from(original).toString('base64'))},'base64'));
  assert.deepEqual(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/originals'))}+'/'+shot.id+'.tif'),Buffer.from(${JSON.stringify(Buffer.from(original).toString('base64'))},'base64'));
  await js('(()=>{const e=Array.from(document.querySelectorAll("textarea")).find(e=>e.getAttribute("aria-label")==='+JSON.stringify('Script '+shot.id)+');e.focus();e.select()})()');
  await win.webContents.insertText('导入后编辑');await wait(()=>read().shots[0].scriptText==='导入后编辑','script edit');
  const box=await rect('[data-shot-id="'+shot.id+'"] .image-stage');
  await mouse('mouseDown',box.x+box.width*.4,box.y+box.height*.5);await mouse('mouseMove',box.x+box.width*.6,box.y+box.height*.5);await mouse('mouseUp',box.x+box.width*.6,box.y+box.height*.5);
  await wait(()=>read().images[shot.imageId].layers[1].assetId!==initial,'paint');
  const sharpAsset=read().images[shot.imageId].layers[1].assetId;
  await save();fs.copyFileSync(outputFile(),${JSON.stringify(path.join(run,'before-blur.tif'))});
  await button('Layers');
  const layerId=read().images[shot.imageId].layers[1].id;
  const lock=()=>js('document.querySelector('+JSON.stringify('.layer-row[data-layer-id="'+layerId+'"] .layer-lock')+').click()');
  await lock();await wait(()=>read().images[shot.imageId].layers[1].locked,'locked layer');
  const locked=read();await button('Blur');await button('Apply blur');await delay(800);assert.deepEqual(read(),locked);
  await lock();await wait(()=>!read().images[shot.imageId].layers[1].locked,'unlocked layer');
  if(${JSON.stringify(japanese)})await button('Japanese view');
  await button('Select');
  const selectionBox=await rect('[data-shot-id="'+shot.id+'"] .image-stage');
  async function lasso(points){for(let i=0;i<points.length;i++)await mouse(i===0?'mouseDown':'mouseMove',selectionBox.x+selectionBox.width*points[i][0],selectionBox.y+selectionBox.height*points[i][1]);const last=points.at(-1);await mouse('mouseUp',selectionBox.x+selectionBox.width*last[0],selectionBox.y+selectionBox.height*last[1]);await delay(150);}
  await lasso([[.3,.3],[.5,.3],[.5,.7],[.3,.7],[.3,.3]]);
  await wait(()=>js('!!document.querySelector(".bitmap-selection-outline")'),'lasso');
  const boundary=await js('(()=>{const p=document.querySelector(".bitmap-selection-outline"),svg=p.ownerSVGElement;return Math.max(...Array.from(p.points).map(p=>p.x))/svg.viewBox.baseVal.width})()');
  fs.writeFileSync(${JSON.stringify(path.join(run,'selection-boundary.json'))},JSON.stringify({right:Math.ceil(boundary*image.width)}));
  await button('Blur');
  const beforeBlur=read(),sourceBytes=fs.readFileSync(outputFile());
  await button('Apply blur');await wait(()=>read().images[shot.imageId].layers[1].assetId!==sharpAsset,'blur changes PNG');
  await wait(()=>js('document.querySelector("[role=status]").textContent==="Editable project saved"'),'successful retry clears refusal');
  assert.equal(read().revision,beforeBlur.revision+1);assert.deepEqual(read().images[shot.imageId].layers[0],beforeBlur.images[shot.imageId].layers[0]);
  assert.deepEqual(fs.readFileSync(outputFile()),sourceBytes);
  const painted=read().images[shot.imageId].layers[1].assetId;
  await save();fs.copyFileSync(outputFile(),${JSON.stringify(path.join(run,'painted.tif'))});
  await button('Undo');await wait(()=>read().images[shot.imageId].layers[1].assetId===sharpAsset,'Undo blur');
  await save();fs.copyFileSync(outputFile(),${JSON.stringify(path.join(run,'undone.tif'))});
  await button('Redo');await wait(()=>read().images[shot.imageId].layers[1].assetId===painted,'Redo paint');await save();
  fs.copyFileSync(outputFile(),${JSON.stringify(path.join(run,'selected-blur.tif'))});
  await button('Select');
  // Escape clears the preceding selection without modifying pixels.
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(100);
  await lasso([[.25,.25],[.75,.25],[.75,.75],[.25,.75],[.25,.25]]);
  const beforeCancel=read();
  await mouse('mouseDown',selectionBox.x+selectionBox.width*.5,selectionBox.y+selectionBox.height*.5);await delay(250);
  await mouse('mouseMove',selectionBox.x+selectionBox.width*.6,selectionBox.y+selectionBox.height*.5);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await mouse('mouseUp',selectionBox.x+selectionBox.width*.6,selectionBox.y+selectionBox.height*.5);await delay(800);assert.deepEqual(read(),beforeCancel);
  await lasso([[.25,.25],[.75,.25],[.75,.75],[.25,.75],[.25,.25]]);
  async function transform(from,to,label){
    const before=read(),old=before.images[shot.imageId].layers[1].assetId;
    await mouse('mouseDown',from.x,from.y);await delay(250);await mouse('mouseMove',to.x,to.y);await mouse('mouseUp',to.x,to.y);
    await wait(()=>read().images[shot.imageId].layers[1].assetId!==old,label);
    const next=read().images[shot.imageId].layers[1].assetId;assert.equal(read().revision,before.revision+1);
    await button('Undo');await wait(()=>read().images[shot.imageId].layers[1].assetId===old,label+' Undo');
    await button('Redo');await wait(()=>read().images[shot.imageId].layers[1].assetId===next,label+' Redo');
  }
  const prior=read().images[shot.imageId].layers[1].assetId;holdPut=true;
  await mouse('mouseDown',selectionBox.x+selectionBox.width*.5,selectionBox.y+selectionBox.height*.5);await delay(200);
  await mouse('mouseMove',selectionBox.x+selectionBox.width*.6,selectionBox.y+selectionBox.height*.5);await mouse('mouseUp',selectionBox.x+selectionBox.width*.6,selectionBox.y+selectionBox.height*.5);
  await wait(()=>putEntered,'delayed transform asset');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await lasso([[.2,.2],[.4,.2],[.4,.4],[.2,.4],[.2,.2]]);
  await mouse('mouseDown',selectionBox.x+selectionBox.width*.3,selectionBox.y+selectionBox.height*.3);await delay(200);
  await mouse('mouseMove',selectionBox.x+selectionBox.width*.35,selectionBox.y+selectionBox.height*.35);
  const newer=await js('document.querySelector(".bitmap-selection-bounds").getAttribute("points")');
  holdPut=false;releasePut();await wait(()=>read().images[shot.imageId].layers[1].assetId!==prior,'first transform settles');await delay(200);
  assert.equal(await js('document.querySelector(".bitmap-selection-bounds").getAttribute("points")'),newer);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await mouse('mouseUp',selectionBox.x+selectionBox.width*.35,selectionBox.y+selectionBox.height*.35);
  await button('Undo');await wait(()=>read().images[shot.imageId].layers[1].assetId===prior,'Undo delayed transform');
  await lasso([[.25,.25],[.75,.25],[.75,.75],[.25,.75],[.25,.25]]);
  await transform({x:selectionBox.x+selectionBox.width*.5,y:selectionBox.y+selectionBox.height*.5},{x:selectionBox.x+selectionBox.width*.6,y:selectionBox.y+selectionBox.height*.5},'move');
  let handle=await rect('.bitmap-selection-handle');
  await transform({x:handle.x+4,y:handle.y+4},{x:handle.x+34,y:handle.y+24},'scale');
  handle=await rect('.bitmap-selection-rotation-handle');
  await transform({x:handle.x+handle.width/2,y:handle.y+handle.height/2},{x:handle.x+80,y:handle.y+40},'rotate');
  await save();fs.copyFileSync(outputFile(),${JSON.stringify(path.join(run,'painted.tif'))});
  fs.writeFileSync(${JSON.stringify(path.join(run,'expected.json'))},JSON.stringify(read()));
 }else{
  assert.deepEqual(read(),JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run,'expected.json'))},'utf8')));
  assert.equal(await js('Array.from(document.querySelectorAll("textarea")).find(e=>e.getAttribute("aria-label")==='+JSON.stringify('Script '+shot.id)+').value'),'导入后编辑');
  await button('Eraser');const box=await rect('[data-shot-id="'+shot.id+'"] .image-stage');
  const sharp=require(${JSON.stringify(require.resolve('sharp'))});
  const rgba=await sharp(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/checkpoints/assets'))}+'/'+initial+'.png')).ensureAlpha().raw().toBuffer();
  let peak=3;for(let i=7;i<rgba.length;i+=4)if(rgba[i]>rgba[peak])peak=i;
  assert(rgba[peak]>0);const pixelIndex=(peak-3)/4,px=(pixelIndex%image.width+.5)/image.width,py=(Math.floor(pixelIndex/image.width)+.5)/image.height;
  await mouse('mouseDown',box.x+box.width*px,box.y+box.height*py);await mouse('mouseUp',box.x+box.width*px,box.y+box.height*py);
  await wait(()=>read().images[shot.imageId].layers[1].assetId!==initial,'reopened editable eraser');
  await button('Undo');await wait(()=>read().images[shot.imageId].layers[1].assetId===initial,'exact reopened Undo');
  await save();
 }
 fs.writeFileSync(${JSON.stringify(path.join(run,phase+'.png'))},(await win.webContents.capturePage()).toPNG());win.close();
}).catch(async error=>{if(win&&!win.isDestroyed()){console.error(await js('document.body.innerText'));fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-failure.png'))},(await win.webContents.capturePage()).toPNG());}fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-failure.txt'))},String(error.stack||error));console.error(error);app.exit(1)});
`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});const chunks=[];
 child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>chunks.push(b));
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
 await writeFile(path.join(run,phase+'.log'),Buffer.concat(chunks));console.log(phase,code,run);
 if(code!==0)throw Error('Import GUI failed; retained '+run);
 if(phase==='cancel'){if((await readdir(root)).some(n=>n.startsWith('.flow-import-')||n==='.storyboard-flow'))throw Error('Cancel changed folder');continue;}
 await readFile(path.join(run,phase+'-closed.json'));
}
const loaded=get(await createProjectStore().loadCheckpoint(root));const shot=loaded.project.shots[0];
const decode=async name=>get(await codec.decode(await readFile(name)));
const painted=await decode(path.join(run,'painted.tif')),undone=await decode(path.join(run,'undone.tif')),final=await decode(path.join(root,JSON.parse(await readFile(path.join(root,'.storyboard-flow/tiff-output.json'),'utf8')).entries.find(e=>e.shotId===shot.id).name));
const raw=async image=>sharp(image.image.layers[1].png).ensureAlpha().raw().toBuffer();
const firstPixels=await raw(painted),undoPixels=await raw(undone),finalPixels=await raw(final);
if(!firstPixels.some((v,i)=>i%4===3&&v>0)||!undoPixels.some((v,i)=>i%4===3&&v>0)||!firstPixels.equals(finalPixels))throw Error('Imported TIFF Save/Undo pixel mismatch');
if(!firstPixels.some((v,i)=>i%4===3&&v>0&&undoPixels[i]===0)||!firstPixels.some((v,i)=>i%4===3&&v<undoPixels[i]&&undoPixels[i]>0))throw Error('Blur did not replace/sharpen alpha as expected');
const selectedPixels=await raw(await decode(path.join(run,'selected-blur.tif')));
const boundary=JSON.parse(await readFile(path.join(run,'selection-boundary.json'),'utf8'));
for(let y=0;y<360;y++)for(let x=boundary.right;x<640;x++)for(let c=0;c<4;c++)if(selectedPixels[(y*640+x)*4+c]!==undoPixels[(y*640+x)*4+c])throw Error('Blur changed pixels outside selection');
if(final.text.scriptText!=='导入后编辑'||final.text.dialogues[0].text!=='源对白')throw Error('Imported text lost');
if(!(await readFile(path.join(root,'.storyboard-flow/originals',shot.id+'.tif'))).equals(Buffer.from(original)))throw Error('Original backup changed');
await writeFile(path.join(run,'receipt.json'),JSON.stringify({...identity,passed:true,cases:['cancel chooser leaves folder unchanged','TIFF-only folder bootstrap through native chooser result','duplicate portable IDs remapped','layered pixels and Unicode text editable','original TIFF read-only until Save','real pointer paint and TIFF Save','Undo blur then Save restores exact pre-blur pixels','Redo and Save restores painted pixels','first original backup byte-exact','whole project relocated with old root unavailable','fresh-process reopen and eraser Undo Save','Pending TIFF imported and retained','locked target refuses blur without checkpoint change','Apply blur publishes one revision and keeps other layers unchanged','blur does not write TIFF before Save','Gaussian alpha spreads while replacing the sharp core','certified normal Close in both processes','lasso limits blur','old asset response cannot clear newer transform preview','Escape cancels transform preview without checkpoint change','move one revision and exact Undo Redo','scale one revision and exact Undo Redo','rotate one revision and exact Undo Redo']},null,2));
console.log('PASS TIFF folder workflow; evidence:',run);
