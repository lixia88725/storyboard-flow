// Synthetic external TIFF changes through real Refresh/Undo/Redo/Save/reopen UI.
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
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-refresh-smoke-'));
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
const identity={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run};
const variants={};
for(const [name,index,color] of [['base',0,'#ff0000'],['conflict',1,'#00ff00']]){
 const changed=structuredClone(image);
 const png=await sharp({create:{width:640,height:360,channels:4,background:color}}).png().toBuffer();
 const id=createHash('sha256').update(png).digest('hex');assets.set(id,png);changed.layers[index].assetId=id;
 if(name==='conflict')changed.layers[0].assetId=variants.baseId;
 else variants.baseId=id;
 const encoded=get(await codec.encode({image:changed,text:null},async id=>assets.get(id)));
 variants[name]=path.join(run,name+'.tif');await writeFile(variants[name],encoded);
}
for(const phase of ['edit','reopen']){
 const userData=path.join(run,phase+'-userData');await mkdir(userData);const driver=path.join(run,phase+'.cjs');
 await writeFile(driver,`
const {app,BrowserWindow,clipboard,shell,dialog,ipcMain}=require('electron');const fs=require('node:fs');const assert=require('node:assert/strict');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};shell.trashItem=()=>{throw Error('Trash forbidden')};
// Script the native dialog's selected folder, not the import/runtime implementation.
dialog.showErrorBox=(title,message)=>{console.error(title,message);app.exit(1)};
dialog.showOpenDialog=async()=>({canceled:${JSON.stringify(phase==='cancel')},filePaths:[${JSON.stringify(root)}]});
process.argv=[process.argv[0],${JSON.stringify(path.join(repo,'dist-electron/main/flowEditorEntry.js'))},'--choose',${JSON.stringify(userData)}];
let hold=false,release,entered=false;const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(channel,fn)=>handle(channel,async(...args)=>{const result=await fn(...args);if(channel==='flow-editor:refresh'&&hold){entered=true;await new Promise(r=>release=r)}return result});
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
 assert.equal(p.shots.length,2);assert.equal(p.parkedShots.length,phase==='edit'?1:2);assert.equal(p.dialogues.length,3);
 assert.notEqual(p.id,'source-project');assert.equal(new Set([...p.shots,...p.parkedShots].map(s=>s.id)).size,phase==='edit'?3:4);
 assert.equal(new Set([...p.shots,...p.parkedShots].map(s=>s.imageId)).size,phase==='edit'?3:4);assert.equal(new Set(p.dialogues.map(d=>d.id)).size,3);
 const initial=image.layers[1].assetId;
 if(phase==='edit'){
  assert.deepEqual(fs.readFileSync(${JSON.stringify(path.join(root,'01.tif'))}),Buffer.from(${JSON.stringify(Buffer.from(original).toString('base64'))},'base64'));
  assert.deepEqual(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/originals'))}+'/'+shot.id+'.tif'),Buffer.from(${JSON.stringify(Buffer.from(original).toString('base64'))},'base64'));
  await js('(()=>{const e=Array.from(document.querySelectorAll("textarea")).find(e=>e.getAttribute("aria-label")==='+JSON.stringify('Script '+shot.id)+');e.focus();e.select()})()');
  await win.webContents.insertText('导入后编辑');await wait(()=>read().shots[0].scriptText==='导入后编辑','script edit');
  const box=await rect('[data-shot-id="'+shot.id+'"] .image-stage');
  await mouse('mouseDown',box.x+box.width*.4,box.y+box.height*.5);await mouse('mouseMove',box.x+box.width*.6,box.y+box.height*.5);await mouse('mouseUp',box.x+box.width*.6,box.y+box.height*.5);
  await wait(()=>read().images[shot.imageId].layers[1].assetId!==initial,'paint');
  const painted=read().images[shot.imageId].layers[1].assetId;
  const local=read(),localBase=local.images[shot.imageId].layers[0].assetId;
  fs.copyFileSync(${JSON.stringify(variants.base)},${JSON.stringify(path.join(root,'01.tif'))});
  const external=fs.readFileSync(${JSON.stringify(path.join(root,'01.tif'))});
  await button('Refresh images');
  await wait(()=>read().images[shot.imageId].layers[0].assetId!==localBase,'external base adopted');
  await wait(()=>js('Array.from(document.querySelectorAll("span")).some(e=>e.getAttribute("aria-label")==="External image status"&&e.textContent==="1 images updated")'),'refresh reply');
  const adopted=read();assert.equal(adopted.images[shot.imageId].layers[1].assetId,painted);assert.equal(adopted.shots[0].scriptText,'导入后编辑');assert.equal(adopted.parkedShots.length,1);
  assert.deepEqual(fs.readFileSync(${JSON.stringify(path.join(root,'01.tif'))}),external);
  await button('Undo');await wait(()=>read().images[shot.imageId].layers[0].assetId===localBase,'Undo refresh');
  assert.deepEqual(fs.readFileSync(${JSON.stringify(path.join(root,'01.tif'))}),external);
  await button('Redo');await wait(()=>read().images[shot.imageId].layers[0].assetId===adopted.images[shot.imageId].layers[0].assetId,'Redo refresh');
  fs.copyFileSync(${JSON.stringify(variants.conflict)},${JSON.stringify(path.join(root,'01.tif'))});
  await button('Refresh images');await wait(()=>read().parkedShots.length===2,'conflict preserved');
  await wait(()=>js('Array.from(document.querySelectorAll("span")).some(e=>e.getAttribute("aria-label")==="External image status"&&e.textContent.includes("1 external versions"))'),'conflict reply');
  assert.equal(read().images[shot.imageId].layers[1].assetId,painted);
  await button('Refresh images');await wait(()=>js('Array.from(document.querySelectorAll("span")).some(e=>e.getAttribute("aria-label")==="External image status"&&e.textContent==="0 images updated")'),'deduplicated');assert.equal(read().parkedShots.length,2);
  await button('Undo');await wait(()=>read().parkedShots.length===1,'Undo conflict');
  await button('Redo');await wait(()=>read().parkedShots.length===2,'Redo conflict');
  await save();fs.copyFileSync(outputFile(),${JSON.stringify(path.join(run,'painted.tif'))});
  fs.writeFileSync(${JSON.stringify(path.join(run,'expected.json'))},JSON.stringify(read()));
 }else{
  assert.deepEqual(read(),JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run,'expected.json'))},'utf8')));
  await button('Refresh images');await wait(()=>js('Array.from(document.querySelectorAll("span")).some(e=>e.getAttribute("aria-label")==="External image status"&&e.textContent==="0 images updated")'),'reopen deduplicated');
  await save();
  hold=true;await button('Refresh images');await wait(()=>entered,'delayed refresh response');win.close();await delay(300);assert.equal(win.isDestroyed(),false);release();
  await wait(()=>win.isDestroyed(),'Close waits for refresh');return;
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
const painted=await decode(path.join(run,'painted.tif'));
const raw=async layer=>sharp(layer.png).ensureAlpha().raw().toBuffer();
const base=await raw(painted.image.layers[0]),ink=await raw(painted.image.layers[1]);
if(base[0]!==255||base[1]!==0||base[2]!==0||!ink.some((v,i)=>i%4===3&&v>0))throw Error('Refreshed base or local drawing missing');
if(painted.text.scriptText!=='导入后编辑'||painted.text.dialogues[0].text!=='源对白')throw Error('Project text lost');
const ledger=JSON.parse(await readFile(path.join(root,'.storyboard-flow/tiff-output.json'),'utf8'));
const alternative=loaded.project.parkedShots.at(-1),entry=ledger.entries.find(e=>e.shotId===alternative.id);
const other=await decode(path.join(root,entry.location==='parked'?'Pending':'',entry.name)),green=await raw(other.image.layers[1]);
if(green[0]!==0||green[1]!==255||green[2]!==0)throw Error('External conflict pixels missing');
if(!(await readFile(path.join(root,'.storyboard-flow/originals',shot.id+'.tif'))).equals(Buffer.from(original)))throw Error('Original backup changed');
await writeFile(path.join(run,'receipt.json'),JSON.stringify({...identity,passed:true,cases:['external base refresh preserves real pointer drawing','local text and dialogue preserved','Refresh leaves source TIFF untouched','one Undo restores base without disk writes','Redo restores refresh','same-layer conflict enters Pending','repeated Refresh deduplicates','Undo removes alternative','Redo restores alternative','explicit Save writes both versions with exact pixels','first original backup byte-exact','fresh-process reopen without duplication','normal Close waits for delayed refresh response']},null,2));
console.log('PASS external refresh workflow; evidence:',run);
