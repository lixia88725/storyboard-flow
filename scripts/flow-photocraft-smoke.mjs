// Owned Electron only. Sources are read-only; all writes/logs/userData stay under
// one new system-temp container. No clipboard, Trash or existing windows.
import {mkdtemp,mkdir,writeFile,readFile,realpath,readdir,rename} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url);
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-photocraft-gui-'));
const source=path.join(run,'sources'),destination=path.join(run,'out'),userData=path.join(run,'userData');
for(const p of [source,destination,userData])await mkdir(p);
execFileSync(path.join(repo,'native/photocraft/target/debug/examples/fixtures'),[source]);
// The untagged-CMYK fixture is an intentional rejection covered by the native
// adapter test; keep it outside this all-positive import folder.
await rename(path.join(source,'untagged-cmyk.tiff'),path.join(run,'untagged-cmyk-negative.tiff'));
// The caller may explicitly supply an authorized read-only real TIFF. It is
// copied once to this owned test input; no source directory scan or mutation.
const realFile=process.argv[2];let original=null;
if(realFile){original=await readFile(realFile);await writeFile(path.join(source,'01-real.tiff'),original);}
const sha=b=>createHash('sha256').update(b).digest('hex');
const before=new Map();for(const name of await readdir(source))before.set(name,sha(await readFile(path.join(source,name))));
const projectRoot=path.join(destination,'sources 分镜');
for(const phase of ['import','reopen']){
 const driver=path.join(run,phase+'.cjs');
 await writeFile(driver, String.raw`
 const {app,BrowserWindow,dialog,shell,clipboard}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
 shell.trashItem=()=>{throw Error('Trash forbidden')};for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
 dialog.showErrorBox=(_t,m)=>{throw Error(m)};
 dialog.showOpenDialog=async(_win,o)=>({canceled:false,filePaths:[o.title.includes('保存位置')?${JSON.stringify(destination)}:${JSON.stringify(source)}]});
 process.argv=[process.execPath,${JSON.stringify(repo)},${phase==='reopen'?JSON.stringify(projectRoot):"'--choose'"},${JSON.stringify(userData)}];
 const result=${JSON.stringify(path.join(run,phase+'.json'))},phase=${JSON.stringify(phase)};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));let win;
 const js=c=>win.webContents.executeJavaScript(c);
 async function wait(fn,label){const end=Date.now()+180000;while(Date.now()<end){try{if(await fn())return;}catch{}await sleep(70)}throw Error('Timeout '+label)}
 async function click(selector){const done=await js('(()=>{const b=document.querySelector('+JSON.stringify(selector)+');if(!b||b.disabled)return false;b.click();return true})()');if(!done)throw Error('Unavailable '+selector);await sleep(100);}
 async function button(text){const done=await js('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+');if(!b||b.disabled)return false;b.click();return true})()');if(!done)throw Error('Unavailable button '+text);await sleep(100);}
 const checkpoint=()=>JSON.parse(fs.readFileSync(path.join(${JSON.stringify(projectRoot)},'.storyboard-flow/checkpoints/project.json'),'utf8'));
 app.on('window-all-closed',()=>fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-closed.json'))},'{}'));
 import(${JSON.stringify('file://'+path.join(repo,'dist-electron/platform/main/flowEditorEntry.js'))}).then(async()=>{
 await app.whenReady();await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');win.setSize(1600,1000);
 if(phase==='import'){
  await wait(()=>js('!!document.querySelector("[data-project-launcher]")'),'launcher');await button('打开…');
  await wait(()=>js('!!document.querySelector("[data-create-sheet]")'),'creation sheet');await button('选择位置…');await button('创建并打开');
  await wait(()=>js('!!document.querySelector("[data-create-issues]")'),'compatibility confirmation');
  const note=await js('document.querySelector("[data-create-issues]").textContent');assert.ok(note.includes('不是原复杂结构的往返文件'));assert.ok(!note.includes('跳过'),'fixture was skipped: '+note);
  fs.writeFileSync(${JSON.stringify(path.join(run,'01-confirmation.png'))},(await win.webContents.capturePage()).toPNG());await button('继续创建');
 }
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');
 await wait(()=>js('(()=>{const e=document.querySelector("[data-photocraft-reference]");if(!e)return false;const r=e.getBoundingClientRect();return r.height>0&&r.top>=0&&r.bottom<=innerHeight})()'),'visible persistent source notice');
 const read=checkpoint(),shot=read.shots[0],image=read.images[shot.imageId];assert.ok(image.layers[0].sourceReference);
 if(phase==='import'){
  await click('.wb-card[data-board-id]');await click('button[aria-label="Add layer"]');
  await wait(()=>checkpoint().images[shot.imageId].layers.length===image.layers.length+1,'new drawing layer');
  const ink=checkpoint().images[shot.imageId].layers.at(-1).assetId;
  const box=await js('(()=>{const e=document.querySelector(".viewer-section .stage-overlay")||document.querySelector(".stage-overlay");const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}})()');
  const mouse=async(type,x,y)=>{win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});await sleep(100)};
  await mouse('mouseMove',box.x+box.w*.4,box.y+box.h*.4);await mouse('mouseDown',box.x+box.w*.4,box.y+box.h*.4);await mouse('mouseMove',box.x+box.w*.6,box.y+box.h*.6);await mouse('mouseUp',box.x+box.w*.6,box.y+box.h*.6);
  await wait(()=>checkpoint().images[shot.imageId].layers.at(-1).assetId!==ink,'paint pixels');
  await button('保存');await wait(()=>js('document.body.textContent.includes("文件夹中的故事板已更新")'),'Save published');
  fs.writeFileSync(${JSON.stringify(path.join(run,'expected.json'))},JSON.stringify(checkpoint()));
 }else{assert.deepEqual(checkpoint(),JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run,'expected.json'))},'utf8')));}
 fs.writeFileSync(${JSON.stringify(path.join(run,phase+'.png'))},(await win.webContents.capturePage()).toPNG());
 fs.writeFileSync(result,JSON.stringify({ok:true,phase,boards:checkpoint().shots.length,protected:true,revision:checkpoint().revision}));win.close();
 }).catch(async error=>{let body='';try{body=await js('document.body.innerText');fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-failure.png'))},(await win.webContents.capturePage()).toPNG())}catch{};fs.writeFileSync(result,JSON.stringify({ok:false,error:String(error.stack||error),body}));app.exit(1)});
 `);
 execFileSync(process.execPath,['--check',driver]);
 const log=[],env={...process.env,FLOW_USER_DATA_DIR:userData};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
 child.stdout.on('data',b=>log.push(b));child.stderr.on('data',b=>log.push(b));
 const code=await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve('timeout')},240000);child.once('exit',c=>{clearTimeout(timer);resolve(c)})});
 await writeFile(path.join(run,phase+'.log'),Buffer.concat(log));
 const result=JSON.parse(await readFile(path.join(run,phase+'.json'),'utf8'));if(code!==0||!result.ok)throw Error(JSON.stringify({run,code,result}));await readFile(path.join(run,phase+'-closed.json'));console.log(JSON.stringify(result));
}
for(const [name,hash] of before)if(sha(await readFile(path.join(source,name)))!==hash)throw Error('Test source changed: '+name);
if(realFile&&sha(await readFile(realFile))!==sha(original))throw Error('Authorized real source changed');
await writeFile(path.join(run,'receipt.json'),JSON.stringify({passed:true,head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),sourceUnchanged:true,realSource:realFile??null}));
console.log('PASS',run);
