// Dedicated Pending-delete GUI smoke: synthetic project/userData only.
// Later phases rely on artifacts written by the edit phase. Build first.
// TODO: verify — written but not executed; coordinator schedules the build/GUI run.
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,readdir,realpath,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {openFlowAssetDepot} from '../dist-electron/project-files/main/persistence/depot.js';
import {createProjectStore} from '../dist-electron/project-files/main/persistence/index.js';
import {createTiffCodec} from '../dist-electron/project-files/main/formats/index.js';
import {openFlowTiffSave} from '../dist-electron/project-files/main/flowTiffSave.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const get=r=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const hashBytes=b=>createHash('sha256').update(b).digest('hex');
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-pending-delete-')),root=path.join(run,'project');
await mkdir(root);
const depot=get(await openFlowAssetDepot({root,sessionId:'seed',maxPixels:1000000,maxPngBytes:1000000}));
const png=await sharp({create:{width:320,height:180,channels:4,background:'#ffffff'}}).png().toBuffer();
const assetId=get(await depot.put({operationId:'base',png,width:320,height:180})).assetId;
const store=createProjectStore();
const codec=createTiffCodec({scriptPath:path.join(repo,'src/project-files/main/formats/codec.py'),depsDir:path.join(repo,'vendor/python/photoshop-tiff')});
const project={schema:'storyboard-flow.project',version:1,id:'pending-smoke',revision:0,name:'Pending delete smoke',shots:[],parkedShots:[],dialogues:[],images:{}};
for(const id of ['shot0','shot1','shot2','shot3']){
 project.images['image-'+id]={id:'image-'+id,revision:0,width:320,height:180,layers:[{id:'layer',name:'Drawing',kind:'paint',visible:true,locked:false,opacity:1,blendMode:'normal',width:320,height:180,assetId}]};
 project.shots.push({id,imageId:'image-'+id,name:id,scriptText:''});
}
const readAsset=async id=>get(await depot.read(id));
get(await store.saveCheckpoint(root,project,readAsset));
// Bind real imported sources, so .storyboard-flow/originals/ holds first-copy backups.
// Generated-only outputs never create originals, and the acceptance must prove retention.
const sources=[];
for(const shot of project.shots){
 const bytes=Buffer.from(get(await codec.encode({image:project.images[shot.imageId],text:null},readAsset)));
 const name=shot.id+'.tif';
 await writeFile(path.join(root,name),bytes);
 sources.push({shotId:shot.id,name,digest:hashBytes(bytes)});
}
const sink=path.join(run,'materialize-sink');await mkdir(sink);
const trash=async file=>{await (await import('node:fs/promises')).rename(file,path.join(sink,path.basename(file)+'-'+Math.random()));};
const binder=await openFlowTiffSave(root,project.id,codec,trash);
await binder.bindSources(project,sources);
const output=await openFlowTiffSave(root,project.id,codec,trash);
await output.save(project,readAsset);
const parked={...project,revision:1,shots:project.shots.slice(0,2),parkedShots:project.shots.slice(2)};
get(await store.saveCheckpoint(root,parked,readAsset));
await output.save(parked,readAsset);
const originalsDir=path.join(root,'.storyboard-flow/originals');
for(const id of ['shot0','shot1','shot2','shot3']){
 try{await stat(path.join(originalsDir,id+'.tif'));}catch{throw Error('Missing imported original backup: '+id);}
}
const originalDigest=hashBytes(await readFile(path.join(originalsDir,'shot2.tif')));
const originalDigest3=hashBytes(await readFile(path.join(originalsDir,'shot3.tif')));
const pendingNames=(await readdir(path.join(root,'Pending'))).sort();
if(JSON.stringify(pendingNames)!==JSON.stringify(['shot2.tif','shot3.tif']))throw Error('Synthetic Pending seed failed: '+pendingNames);
const identity={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run};
const entry=path.join(repo,'dist-electron/platform/main/flowEditorEntry.js');
for(const phase of ['edit','reopen']){
 const userData=path.join(run,'userData');await mkdir(userData,{recursive:true});
 const driver=path.join(run,phase+'.cjs');
 await writeFile(driver,String.raw`
const {app,BrowserWindow,clipboard,shell}=require('electron'),fs=require('node:fs'),assert=require('node:assert/strict');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
const trashCalls=[];
const ledgerFile=${JSON.stringify(path.join(root,'.storyboard-flow/tiff-output.json'))};
const sha=f=>require('node:crypto').createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const ORIGINAL=${JSON.stringify(originalDigest)},ORIGINAL3=${JSON.stringify(originalDigest3)};
shell.trashItem=async file=>{
 const ledger=JSON.parse(fs.readFileSync(ledgerFile,'utf8'));
 const intents=ledger.entries.filter(e=>e.deletion&&e.deletion.phase==='dispatching');
 if(intents.length!==1)throw Error('Expected exactly one durable dispatching deletion intent');
 const intent=intents[0];
 const expected=require('node:path').join(root,'.storyboard-flow/deletions',intent.deletion.token,intent.name);
 if(file!==expected)throw Error('Trash target is not the staged copy: '+file);
 trashCalls.push({file,shotId:intent.shotId,name:intent.name,from:intent.deletion.from,phase:intent.deletion.phase});
 fs.renameSync(file,${JSON.stringify(path.join(run,'simulated-trash-'))}+trashCalls.length+'.tif');
};
process.argv=[process.argv[0],${JSON.stringify(entry)},${JSON.stringify(root)},${JSON.stringify(userData)},'--workbench'];
let win;const phase=${JSON.stringify(phase)},run=${JSON.stringify(run)},root=${JSON.stringify(root)};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const projectFile=${JSON.stringify(path.join(root,'.storyboard-flow/checkpoints/project.json'))};
const read=()=>JSON.parse(fs.readFileSync(projectFile,'utf8'));
const js=c=>win.webContents.executeJavaScript(c);
async function wait(fn,label){for(let i=0;i<400;i++){try{if(await fn())return}catch{}await delay(50)}throw Error('Timeout '+label)}
async function button(text){await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==='+JSON.stringify(text)+').click()');await delay(100)}
async function rect(selector){return js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("missing "+'+JSON.stringify(selector)+');const r=e.getBoundingClientRect();if(r.width<=0||r.height<=0)throw Error("zero-size "+'+JSON.stringify(selector)+');return {x:r.x,y:r.y,width:r.width,height:r.height}})()')}
async function mouse(type,x,y){win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});await delay(60)}
async function clickAt(selector){const r=await rect(selector);const x=r.x+r.width/2,y=r.y+r.height/2;
 const hit=await js('(()=>{const e=document.elementFromPoint('+x+','+y+'),t=document.querySelector('+JSON.stringify(selector)+');return !!e&&(e===t||t.contains(e))})()');
 if(!hit)throw Error('Click target is not hit-testable: '+selector);
 await mouse('mouseMove',x,y);await mouse('mouseDown',x,y);await mouse('mouseUp',x,y);await delay(120)}
const status=()=>js('document.querySelector(".wb-status [role=status]").textContent');
const folderSays=text=>wait(async()=>(await status()).includes(text),text);
const pendingFiles=()=>fs.readdirSync(root+'/Pending').filter(n=>n.endsWith('.tif')).sort();
app.on('window-all-closed',()=>fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-closed.json'))},'{}'));
import(${JSON.stringify('file://'+entry)}).then(async()=>{
 await app.whenReady();await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');win.setSize(1600,1000);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');
 await wait(async()=>(await status()).startsWith('Flow 内已保存'),'checkpoint');
 if(phase==='edit'){
  assert.equal(read().parkedShots.length,2);assert.deepEqual(pendingFiles(),['shot2.tif','shot3.tif']);
  const activeSelectedBefore=await js('Array.from(document.querySelectorAll(".wb-card.is-selected")).map(e=>e.dataset.boardId)');
  // Pressing and moving from the checkbox must not start a sort drag (PointerSensor distance 6).
  const box=await rect('[aria-label="选择 Pending shot2"]');
  await mouse('mouseMove',box.x+box.width/2,box.y+box.height/2);
  await mouse('mouseDown',box.x+box.width/2,box.y+box.height/2);
  await mouse('mouseMove',box.x+box.width/2+40,box.y+box.height/2+24);await delay(220);
  await mouse('mouseUp',box.x+box.width/2+40,box.y+box.height/2+24);await delay(200);
  assert.deepEqual(read().parkedShots.map(s=>s.id),['shot2','shot3'],'checkbox drag attempt left Pending order unchanged');
  assert.deepEqual(await js('Array.from(document.querySelectorAll(".flow-pending")).map(e=>e.style.transform||"")'),['',''],'checkbox drag attempt left no sort transform');
  assert.deepEqual(await js('Array.from(document.querySelectorAll(".flow-pending-shelf input[type=checkbox]")).map(c=>c.checked)'),[false,false],'checkbox drag attempt did not toggle selection');
  // Real pointer input on the checkbox itself: it must toggle selection without starting a sort drag.
  await clickAt('[aria-label="选择 Pending shot2"]');
  await clickAt('[aria-label="选择 Pending shot3"]');
  await wait(()=>js('!!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="删除 Pending (2)")'),'delete count');
  assert.deepEqual(await js('Array.from(document.querySelectorAll(".wb-card.is-selected")).map(e=>e.dataset.boardId)'),activeSelectedBefore,'active selection unchanged by Pending checkboxes');
  assert.deepEqual(await js('Array.from(document.querySelectorAll(".flow-pending-shelf input[type=checkbox]")).map(c=>c.checked)'),[true,true],'both Pending checkboxes checked by pointer');
  assert.deepEqual(await js('Array.from(document.querySelectorAll(".flow-pending")).map(e=>e.style.transform||"")'),['',''],'checkbox pointer left no sort transform');
  assert.deepEqual(pendingFiles(),['shot2.tif','shot3.tif']);
  assert.equal(sha(root+'/.storyboard-flow/originals/shot2.tif'),ORIGINAL,'imported original retained before Save');
  const activeBefore=read().shots.map(s=>s.id);
  await clickAt('[aria-label="删除选中的 Pending (2)"]');
  await wait(()=>read().parkedShots.length===0,'logical delete before Save');
  assert.deepEqual(read().shots.map(s=>s.id),activeBefore);
  assert.deepEqual(pendingFiles(),['shot2.tif','shot3.tif'],'no file effect before Save');
  await button('撤销');await wait(()=>read().parkedShots.length===2,'one undo restores membership');
  await button('重做');await wait(()=>read().parkedShots.length===0,'redo removes membership');
  await wait(()=>js('!document.querySelector(\'[aria-label="选择 Pending shot2"]\')'),'selection pruned');
  await button('保存 TIFF');await folderSays('文件夹中的故事板已更新');
  assert.equal(trashCalls.length,2,'only the two deleted Pending TIFFs reach Trash');
  // Provenance comes from the durable intent captured inside the Trash callback, not from the path.
  assert.deepEqual(trashCalls.map(c=>[c.shotId,c.from,c.phase,c.name]).sort(),
    [['shot2','parked','dispatching','shot2.tif'],['shot3','parked','dispatching','shot3.tif']],'each intent binds shot, from=parked, dispatched name');
  assert.ok(trashCalls.every(c=>c.file.includes('/.storyboard-flow/deletions/')),'Trash receives the staged copy');
  assert.ok(trashCalls.every(c=>!c.file.includes('/Pending/')),'staged copy is no longer under Pending/');
  const ledger=JSON.parse(fs.readFileSync(root+'/.storyboard-flow/tiff-output.json','utf8'));
  for(const id of ['shot2','shot3']){
   const retired=ledger.entries.find(e=>e.shotId===id);
   assert.equal(retired.retired,'trashed');assert.equal(retired.location,'parked');
  }
  assert.deepEqual(pendingFiles(),[]);
  assert.equal(sha(root+'/.storyboard-flow/originals/shot2.tif'),ORIGINAL,'imported original byte-identical after delete');
  assert.equal(sha(root+'/.storyboard-flow/originals/shot3.tif'),ORIGINAL3,'second imported original byte-identical after delete');
  await button('撤销');await wait(()=>read().parkedShots.length===2,'undo after physical delete');
  await button('保存 TIFF');await folderSays('文件夹中的故事板已更新');
  assert.equal(trashCalls.length,2,'regeneration never reads Trash');
  const regenerated=pendingFiles();
  assert.equal(regenerated.length,2);
  assert.ok(regenerated.every(n=>/^shot[23]-[0-9a-f-]{36}\.tif$/.test(n)),'regenerated names are fresh: '+regenerated);
  assert.equal(sha(root+'/.storyboard-flow/originals/shot2.tif'),ORIGINAL,'original survives regeneration');
  fs.writeFileSync(${JSON.stringify(path.join(run,'expected.json'))},JSON.stringify(read()));
 }else{
  assert.deepEqual(read(),JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run,'expected.json'))},'utf8')));
  assert.equal(read().parkedShots.length,2);
  assert.equal(pendingFiles().length,2);
  await clickAt('[aria-label="选择 Pending shot2"]');
  await wait(()=>js('!!Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="删除 Pending (1)")'),'single delete count');
  await clickAt('[aria-label="删除选中的 Pending (1)"]');
  await wait(()=>read().parkedShots.length===1,'reopened Pending delete');
  assert.deepEqual(read().shots.map(s=>s.id),['shot0','shot1']);
 }
 // Written only after every assertion of this phase passed.
 fs.writeFileSync(${JSON.stringify(path.join(run,'phase-'))}+phase+'.done','{}');
 win.close();
}).catch(async e=>{console.error(e);try{if(win&&!win.isDestroyed())fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-failure.png'))},(await win.webContents.capturePage()).toPNG());}finally{if(win&&!win.isDestroyed())win.destroy();app.exit(1)}});
`);
 execFileSync(process.execPath,['--check',driver]);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const chunks=[],child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
 let spawnError;
 child.on('error',error=>{spawnError=error;console.error('spawn failed: '+error.message)});
 child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>{chunks.push(b);process.stderr.write(b)});
 let timedOut=false;
 const watchdog=setTimeout(()=>{timedOut=true;console.error('phase timeout: '+phase);child.kill('SIGKILL');},180000);
 const code=await new Promise(resolve=>child.on('exit',resolve));clearTimeout(watchdog);
 await writeFile(path.join(run,phase+'.log'),Buffer.concat(chunks));console.log(phase,code,run);
 if(spawnError||timedOut||code!==0)throw Error('Pending delete verification failed: '+run);
 await readFile(path.join(run,phase+'-closed.json'));
 // A zero exit plus a closed window is not enough: the phase must have reached its last assertion.
 await readFile(path.join(run,'phase-'+phase+'.done'));
}
await writeFile(path.join(run,'receipt.json'),JSON.stringify({...identity,passed:true,cases:[
 'Pending shelf exposes independent selection with an exact removal count',
 'active board selection remains unchanged while Pending is selected',
 'delete before Save changes membership only and keeps Pending TIFFs',
 'single Undo and Redo of a Pending delete',
 'explicit Save trashes only the owned Pending TIFFs and keeps originals',
 'Undo after physical delete regenerates Pending output without reading Trash',
 'reopened project deletes one Pending shot']},null,2));
console.log('PASS',run);
