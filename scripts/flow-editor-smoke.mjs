// Two real Electron processes, synthetic project/userData only. Build first.
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {openFlowAssetDepot} from '../dist-electron/core/persistence/depot.js';
import {createProjectStore} from '../dist-electron/core/persistence/index.js';
const require=createRequire(import.meta.url),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-editor-smoke-')),root=path.join(run,'project');await mkdir(root);
const get=r=>{if(!r.ok)throw Error(r.error.message);return r.value};
const depot=get(await openFlowAssetDepot({root,sessionId:'seed',maxPixels:1000000,maxPngBytes:1000000}));
const blobs=[];
for(const [i,color]of ['#ffffff','#00000000'].entries()){
 const png=await sharp({create:{width:640,height:360,channels:4,background:color}}).png().toBuffer();
 blobs.push(get(await depot.put({operationId:'seed'+i,png,width:640,height:360})).assetId);
}
const project={schema:'storyboard-flow.project',version:1,id:'synthetic',revision:0,name:'G2 synthetic',shots:[],parkedShots:[],dialogues:[],images:{}};
for(let i=0;i<5;i++){
 const imageId='image'+i,shot={id:'shot'+i,imageId,name:String(i+1),scriptText:''};
 (i===4?project.parkedShots:project.shots).push(shot);
 project.images[imageId]={id:imageId,revision:0,width:640,height:360,layers:Array.from({length:3},(_,l)=>({id:'layer'+l,name:'Layer '+l,kind:l?'paint':'image',visible:true,locked:false,opacity:1,blendMode:'normal',width:640,height:360,assetId:blobs[l?1:0]}))};
}
get(await createProjectStore().saveCheckpoint(root,project,async id=>get(await depot.read(id))));
const identity={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run};
for(const phase of ['edit','reopen']){
 const userData=path.join(run,phase+'-userData');await mkdir(userData);
 const driver=path.join(run,phase+'.cjs');
 await writeFile(driver,`
const {app,BrowserWindow,clipboard,shell}=require('electron');
const fs=require('node:fs');const assert=require('node:assert/strict');
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard forbidden')};
shell.trashItem=()=>{throw Error('Trash forbidden')};
process.argv=[process.argv[0],${JSON.stringify(path.join(repo,'dist-electron/main/flowEditorEntry.js'))},${JSON.stringify(root)},${JSON.stringify(userData)}];
const delay=ms=>new Promise(r=>setTimeout(r,ms));let win;const phase=${JSON.stringify(phase)};
const manifest=${JSON.stringify(path.join(root,'.storyboard-flow/checkpoints/project.json'))};
const read=()=>JSON.parse(fs.readFileSync(manifest,'utf8'));
async function wait(fn,label){for(let i=0;i<300;i++){try{const v=await fn();if(v)return v}catch{}await delay(50)}throw Error('Timed out: '+label)}
const js=code=>win.webContents.executeJavaScript(code);
async function rect(selector){return js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');e.scrollIntoView({block:"center"});const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()')}
async function mouse(type,x,y){win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});await delay(60)}
async function click(selector){const r=await rect(selector);await mouse('mouseDown',r.x+r.width/2,r.y+r.height/2);await mouse('mouseUp',r.x+r.width/2,r.y+r.height/2)}
async function button(text){await js('Array.from(document.querySelectorAll("button")).find(e=>e.textContent==='+JSON.stringify(text)+').click()');await delay(100)}
app.on('window-all-closed',()=>fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-closed.json'))},JSON.stringify({normalClose:true,phase})));
import(${JSON.stringify('file://'+path.join(repo,'dist-electron/main/flowEditorEntry.js'))}).then(async()=>{
 await app.whenReady();win=await wait(()=>BrowserWindow.getAllWindows()[0],'window');
 win.webContents.on('console-message',e=>console.log('renderer',e.message));
 await wait(()=>js('!!document.querySelector("[data-flow-editor]")'),'editor');
 await wait(()=>js('document.querySelectorAll(".image-stage img").length>0 && Array.from(document.querySelectorAll(".image-stage img")).every(x=>x.complete&&x.naturalWidth>0)'),'images');
 if(phase==='edit'){
  await click('[aria-label="Script shot0"]');await win.webContents.insertText('镜头中文测试');
  await wait(()=>read().shots[0].scriptText==='镜头中文测试','text checkpoint');
  const from=await rect('[aria-label="Move shot1"]'),to=await rect('[aria-label="Move shot0"]');
  await mouse('mouseDown',from.x+20,from.y+10);await mouse('mouseMove',from.x+35,from.y+10);await mouse('mouseMove',to.x+20,to.y+10);await mouse('mouseUp',to.x+20,to.y+10);
  await wait(()=>read().shots[0].id==='shot1','drag order');
  const canvas=await rect('[data-shot-id="shot0"] .image-stage');console.log('canvas rect',canvas);
  await mouse('mouseDown',canvas.x+canvas.width*.4,canvas.y+canvas.height*.5);await mouse('mouseMove',canvas.x+canvas.width*.6,canvas.y+canvas.height*.5);await mouse('mouseUp',canvas.x+canvas.width*.6,canvas.y+canvas.height*.5);
  await wait(()=>read().images.image0.layers[2].assetId!==${JSON.stringify(blobs[1])},'paint');
  const painted=read().images.image0.layers[2].assetId;
  await js('Array.from(document.querySelector("[data-shot-id=shot0]").querySelectorAll("button")).find(e=>e.textContent==="Layers").click()');await delay(200);
  const row=await rect('[data-shot-id="shot0"] .layer-row[data-layer-id="layer2"]');
  await mouse('mouseDown',row.x+row.width*.8,row.y+row.height-3);await mouse('mouseMove',row.x+row.width*.65,row.y+row.height-3);await mouse('mouseMove',row.x+row.width*.55,row.y+row.height-3);await mouse('mouseMove',row.x+row.width*.5,row.y+row.height-3);await mouse('mouseUp',row.x+row.width*.5,row.y+row.height-3);
  await wait(()=>read().images.image0.layers[2].opacity<.8,'opacity');
  const opacity=read().images.image0.layers[2].opacity;
  await button('Undo');await wait(()=>read().images.image0.layers[2].opacity===1,'undo opacity');
  await button('Undo');await wait(()=>read().images.image0.layers[2].assetId===${JSON.stringify(blobs[1])},'undo paint');
  await button('Redo');await button('Redo');
  await wait(()=>{const p=read();return p.images.image0.layers[2].assetId===painted&&p.images.image0.layers[2].opacity===opacity},'redo');
  const revision=read().revision;
  await button('Japanese view');
  await wait(()=>js('!!document.querySelector(".japanese-storyboard-view")'),'Japanese view');
  assert.equal(read().revision,revision);
  assert.equal(await js('document.querySelector("[data-shot-id=shot0] textarea[aria-label*=action]").value'),'镜头中文测试');
  await js('document.querySelector(".flow-editor").scrollTop=0');
  const [cutFrom,cutTo]=await js('["shot0","shot1"].map(id=>{const r=document.querySelector("[data-shot-id="+id+"] button[aria-label*=reorder]").getBoundingClientRect();return {x:r.x,y:r.y}})');
  await mouse('mouseDown',cutFrom.x+10,cutFrom.y+10);await mouse('mouseMove',cutFrom.x+20,cutFrom.y+10);
  await mouse('mouseMove',cutTo.x+10,cutTo.y+10);await mouse('mouseUp',cutTo.x+10,cutTo.y+10);
  await wait(()=>read().shots[0].id==='shot0','Japanese reorder');
  await button('Undo');await wait(()=>read().shots[0].id==='shot1','Japanese reorder undo');
  await click('[data-shot-id="shot0"] textarea[aria-label*=dialogue]');
  await win.webContents.insertText('第一句\\n第二句');
  await wait(()=>read().dialogues.filter(d=>d.shotId==='shot0').length===2,'Japanese dialogue');
  fs.writeFileSync(${JSON.stringify(path.join(run,'japanese.png'))},(await win.webContents.capturePage()).toPNG());
  const dialogues=read().dialogues;
  await button('Undo');await wait(()=>read().dialogues.length===0,'undo dialogue');
  assert.equal(read().images.image0.layers[2].assetId,painted);
  await button('Redo');await wait(()=>read().dialogues.length===2,'redo dialogue');
  assert.deepEqual(read().dialogues,dialogues);
  const picture=await rect('[data-shot-id="shot0"] .image-stage');
  await mouse('mouseDown',picture.x+picture.width*.3,picture.y+picture.height*.3);
  await button('Grid view');
  assert.equal(await js('!!document.querySelector(".japanese-storyboard-view")'),true);
  await mouse('mouseMove',picture.x+picture.width*.4,picture.y+picture.height*.3);
  await mouse('mouseUp',picture.x+picture.width*.4,picture.y+picture.height*.3);
  await wait(()=>read().images.image0.layers[2].assetId!==painted,'Japanese drawing');
  await button('Undo');await wait(()=>read().images.image0.layers[2].assetId===painted,'Japanese drawing undo');
  await button('Grid view');
  assert.equal(await js('Array.from(document.querySelectorAll("textarea")).find(e=>e.getAttribute("aria-label")==="Dialogue shot0").value'),'第一句\\n第二句');
  fs.writeFileSync(${JSON.stringify(path.join(run,'expected.json'))},JSON.stringify(read()));
 }else{
  assert.deepEqual(read(),JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run,'expected.json'))},'utf8')));
  assert.equal(await js('Array.from(document.querySelectorAll("textarea")).find(e=>e.getAttribute("aria-label")==="Script shot0").value'),'镜头中文测试');
  assert.equal(await js('document.querySelector("[data-shot-id]").dataset.shotId'),'shot1');
  await button('Japanese view');
  assert.equal(await js('document.querySelector("[data-shot-id=shot0] textarea[aria-label*=dialogue]").value'),'第一句\\n第二句');
  await button('Grid view');
  const original=read().images.image0.layers[2].assetId;
  await button('Eraser');const canvas=await rect('[data-shot-id="shot0"] .image-stage');
  await mouse('mouseDown',canvas.x+canvas.width*.5,canvas.y+canvas.height*.5);
  win.close();await delay(200);assert.equal(win.isDestroyed(),false);
  assert.equal(await js('document.querySelector("[data-flow-editor]").dataset.phase'),'active');
  await mouse('mouseUp',canvas.x+canvas.width*.5,canvas.y+canvas.height*.5);
  await wait(()=>read().images.image0.layers[2].assetId!==original,'reopened eraser');
  await button('Undo');await wait(()=>read().images.image0.layers[2].assetId===original,'restore exact reopened pixels');
 }
 fs.writeFileSync(${JSON.stringify(path.join(run,phase+'.png'))},(await win.webContents.capturePage()).toPNG());
 win.close();
}).catch(async error=>{if(win&&!win.isDestroyed()){fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-failure.png'))},(await win.webContents.capturePage()).toPNG());console.error(await js('document.body.innerText'));}fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-failure.txt'))},String(error.stack||error));console.error(error);app.exit(1)});
`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});const chunks=[];
 child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>chunks.push(b));
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
 await writeFile(path.join(run,phase+'.log'),Buffer.concat(chunks));
 console.log(phase,code,run);if(code!==0)throw Error('GUI failed; retained '+run);
 await readFile(path.join(run,phase+'-closed.json'));
}
const final=get(await createProjectStore().loadCheckpoint(root));
const pixels=await sharp(await final.readAsset(final.project.images.image0.layers[2].assetId)).raw().toBuffer();
if(!pixels.some((v,i)=>i%4===3&&v>0))throw Error('No painted pixels');
await writeFile(path.join(run,'receipt.json'),JSON.stringify({...identity,passed:true,cases:['Chinese text','real drag reorder','SketchPad pointer stroke','LayerPanel opacity drag','Undo twice','Redo twice','checkpoint','certified normal Close','new-process reopen','close while pointer active refused','reopened eraser and exact Undo','Japanese view shares script/order','view switch creates no revision','multiline dialogue Undo/Redo','Japanese pointer drawing and exact Undo','view switch during stroke refused','dialogue shared with grid and fresh reopen']},null,2));
console.log('PASS real editor workflow; evidence:',run);
