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
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-inspection-smoke-'));
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
const japanese=process.env.FLOW_INSPECTION_JAPANESE==='1';
const identity={japanese,head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run};
for(const phase of ['cancel','edit','reopen']){
 if(phase==='reopen'){
  const retained=root+'-original';await rename(root,retained);root=path.join(run,'relocated-project');await cp(retained,root,{recursive:true});
 }
 const userData=path.join(run,phase+'-userData');await mkdir(userData);const driver=path.join(run,phase+'.cjs');
 await writeFile(driver,`
const {app,BrowserWindow,clipboard,shell,dialog}=require('electron');const fs=require('node:fs');const assert=require('node:assert/strict');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};shell.trashItem=()=>{throw Error('Trash forbidden')};
// Script the native dialog's selected folder, not the import/runtime implementation.
dialog.showErrorBox=(title,message)=>{console.error(title,message);app.exit(1)};
dialog.showOpenDialog=async()=>({canceled:${JSON.stringify(phase==='cancel')},filePaths:[${JSON.stringify(root)}]});
process.argv=[process.argv[0],${JSON.stringify(path.join(repo,'dist-electron/main/flowEditorEntry.js'))},'--choose',${JSON.stringify(userData)}];
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
  if(${JSON.stringify(japanese)})await button('Japanese view');
  const beforePresentation=read();
  const choose=mode=>js('(()=>{const e=document.querySelector("select");Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,"value").set.call(e,'+JSON.stringify(mode)+');e.dispatchEvent(new Event("change",{bubbles:true}))})()');
  await choose('expanded');await wait(()=>read().presentation?.mode==='expanded','expanded setting');
  await button('Dialogue overlay');await wait(()=>read().presentation?.dialogue,'dialogue setting');
  assert.deepEqual(read().images,beforePresentation.images);assert.equal(read().revision,beforePresentation.revision+2);
  await wait(()=>js('document.querySelector("[data-flow-matte=bottom]").textContent.includes("源对白")'),'live dialogue');
  const matte=await rect('[data-flow-matte="top"]'),beforeMatteStroke=read();
  await mouse('mouseDown',matte.x+matte.width*.5,matte.y+matte.height*.5);await mouse('mouseMove',matte.x+matte.width*.6,matte.y+matte.height*.5);await mouse('mouseUp',matte.x+matte.width*.6,matte.y+matte.height*.5);await delay(800);assert.deepEqual(read(),beforeMatteStroke);
  await choose('embedded');await wait(()=>read().presentation?.mode==='embedded','embedded setting');assert.deepEqual(read().images,beforePresentation.images);
  await button('Undo');await wait(()=>read().presentation?.mode==='expanded','Undo restores expanded');
  await choose('off');await wait(()=>!read().presentation,'matte off');assert.deepEqual(read().images,beforePresentation.images);
  assert.equal(await js('document.querySelectorAll("[data-flow-matte]").length'),0);
  await button('Undo');await wait(()=>read().presentation?.mode==='expanded'&&read().presentation?.dialogue,'Undo restores presentation');

  const beforeInspection=read();
  await button('Inspect');await wait(()=>js('!!document.querySelector("dialog[open]")'),'inspection open');
  assert.equal(await js('document.querySelectorAll(".flow-editor-grid .image-stage").length'),0);
  assert.equal(await js('document.querySelector(".flow-inspection span[aria-label]").textContent'),'1 / 2');
  await button('Onion skin');assert.equal(await js('document.querySelectorAll(".onion-skin-ghost-next").length'),1);assert.equal(await js('document.querySelectorAll(".onion-skin-ghost-previous").length'),0);
  await button('Next');assert.equal(await js('document.querySelectorAll(".onion-skin-ghost-previous").length'),1);assert.equal(await js('document.querySelectorAll(".onion-skin-ghost-next").length'),0);
  await button('Previous');assert.deepEqual(read(),beforeInspection);
  await button('Play');await wait(()=>js('document.querySelector("[data-playing]").dataset.playing==="true"'),'play started');
  assert.equal(await js('document.querySelectorAll(".onion-skin-overlay").length'),0);
  assert.equal(await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="Onion skin").disabled'),true);
  await wait(()=>js('document.querySelector("[data-playing]").dataset.playing==="false"&&document.querySelector(".flow-inspection span[aria-label]").textContent==="2 / 2"'),'play ends without wrapping');
  assert.deepEqual(read(),beforeInspection);
  await button('Previous');
  await js('window.inspectionDecode=HTMLImageElement.prototype.decode;HTMLImageElement.prototype.decode=function(){return Promise.reject(new Error("Synthetic decode failure"))};void 0');
  await button('Play');await wait(()=>js('document.querySelector(".flow-inspection [role=status]").textContent.includes("could not be displayed")'),'decode failure pauses');
  assert.equal(await js('document.querySelector("[data-playing]").dataset.playing'),'false');
  await js('HTMLImageElement.prototype.decode=window.inspectionDecode;void 0');assert.deepEqual(read(),beforeInspection);
  await js('HTMLImageElement.prototype.decode=function(){return new Promise(resolve=>{(window.inspectionDecodeWaiters??=[]).push(resolve)})};void 0');
  await button('Play');await delay(800);
  assert.equal(await js('document.querySelector(".flow-inspection span[aria-label]").textContent'),'1 / 2');
  await js('HTMLImageElement.prototype.decode=window.inspectionDecode;void 0');await button('Pause');
  await js('window.inspectionDecodeWaiters.forEach(resolve=>resolve())');await delay(800);
  assert.equal(await js('document.querySelector("[data-playing]").dataset.playing'),'false');
  assert.equal(await js('document.querySelector(".flow-inspection span[aria-label]").textContent'),'1 / 2');
  await button('Play');await js('window.dispatchEvent(new Event("blur"))');await delay(700);
  assert.equal(await js('document.querySelector("[data-playing]").dataset.playing'),'false');
  assert.deepEqual(read(),beforeInspection);
  fs.writeFileSync(${JSON.stringify(path.join(run,'inspection.png'))},(await win.webContents.capturePage()).toPNG());
  const box=await rect('.flow-inspection .image-stage');
  await mouse('mouseDown',box.x+box.width*.4,box.y+box.height*.5);await button('Play');assert.equal(await js('document.querySelector("[data-playing]").dataset.playing'), 'false');await mouse('mouseMove',box.x+box.width*.6,box.y+box.height*.5);await mouse('mouseUp',box.x+box.width*.6,box.y+box.height*.5);
  await wait(()=>read().images[shot.imageId].layers[1].assetId!==initial,'paint');
  const painted=read().images[shot.imageId].layers[1].assetId;
  await button('Back to board');await wait(()=>js('!document.querySelector("dialog[open]")'),'return to board');
  await save();fs.copyFileSync(outputFile(),${JSON.stringify(path.join(run,'painted.tif'))});
  await button('Undo');await wait(()=>read().images[shot.imageId].layers[1].assetId===initial,'Undo paint');
  await save();fs.copyFileSync(outputFile(),${JSON.stringify(path.join(run,'undone.tif'))});
  await button('Redo');await wait(()=>read().images[shot.imageId].layers[1].assetId===painted,'Redo paint');await save();
  fs.writeFileSync(${JSON.stringify(path.join(run,'expected.json'))},JSON.stringify(read()));
 }else{
  assert.deepEqual(read(),JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run,'expected.json'))},'utf8')));
  assert.equal(await js('Array.from(document.querySelectorAll("textarea")).find(e=>e.getAttribute("aria-label")==='+JSON.stringify('Script '+shot.id)+').value'),'导入后编辑');
  await button('Eraser');const box=await rect('[data-shot-id="'+shot.id+'"] .image-stage');
  await mouse('mouseDown',box.x+box.width*.5,box.y+box.height*.5);await mouse('mouseUp',box.x+box.width*.5,box.y+box.height*.5);
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
if(!firstPixels.some((v,i)=>i%4===3&&v>0)||undoPixels.some((v,i)=>i%4===3&&v!==0)||!firstPixels.equals(finalPixels))throw Error('Imported TIFF Save/Undo pixel mismatch');
if(final.image.height!==510||final.image.layers.length!==4||final.text.presentation?.settings.mode!=='expanded')throw Error('Missing derived TIFF presentation');
if(final.text.scriptText!=='导入后编辑'||final.text.dialogues[0].text!=='源对白')throw Error('Imported text lost');
if(!(await readFile(path.join(root,'.storyboard-flow/originals',shot.id+'.tif'))).equals(Buffer.from(original)))throw Error('Original backup changed');
await writeFile(path.join(run,'receipt.json'),JSON.stringify({...identity,passed:true,cases:['cancel chooser leaves folder unchanged','TIFF-only folder bootstrap through native chooser result','duplicate portable IDs remapped','layered pixels and Unicode text editable','original TIFF read-only until Save','real pointer paint and TIFF Save','Undo then Save restores exact transparent pixels','Redo and Save restores painted pixels','first original backup byte-exact','whole project relocated with old root unavailable','fresh-process reopen and eraser Undo Save','Pending TIFF imported and retained','matte and dialogue settings do not mutate editable assets','expanded matte intercepts drawing','embedded switch and Undo retain original pixels','live dialogue overlay','turning off does not crop editable content','presentation persists through relocated reopen','certified normal Close in both processes','inspection only mounts current canvas','active sequence excludes Pending','onion neighbors do not wrap','navigation and playback do not change project','playback hides onion and stops at final shot','active stroke blocks playback transition','onion-assisted painting survives Save Undo Redo','decode failure pauses without editing','frame waits for image decoding','late decode after pause cannot advance','window blur stops playback']},null,2));
console.log('PASS TIFF folder workflow; evidence:',run);
