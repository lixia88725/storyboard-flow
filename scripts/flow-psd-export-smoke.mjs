// Isolated real UI/IPC export, synthetic PSD source only; no user windows/data.
import fs from'node:fs/promises';import path from'node:path';import os from'node:os';import{spawn,execFileSync}from'node:child_process';import{createRequire}from'node:module';import{createHash}from'node:crypto';import{fileURLToPath}from'node:url';
import{createImageProject}from'../dist-electron/project-files/main/createImageProject.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const run=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'flow-psd-export-gui-')),source=path.join(run,'source'),out=path.join(run,'out'),profile=path.join(run,'userData');for(const dir of[source,out,profile])await fs.mkdir(dir);
execFileSync(path.resolve('native/photocraft/target/debug/examples/fixtures'),[source]);const sourceFile=path.join(source,'complex.psd'),sourceHash=sha(await fs.readFile(sourceFile));
const{root}=await createImageProject({source:{kind:'files',files:[sourceFile]},destinationParent:out,folderName:'Proj',name:'Proj',naming:{sceneCode:'S',artistName:'A',version:'1'}},{signal:new AbortController().signal,decideIssues:async()=> 'continue'});
const target=path.join(run,'Flow-edited.psd');
for(const phase of['export','reopen']){
 const driver=path.join(run,phase+'.cjs');await fs.writeFile(driver,String.raw`
 const{app,BrowserWindow,dialog,clipboard,shell}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
 for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard forbidden')};shell.trashItem=()=>{throw Error('Trash forbidden')};
 let picks=0;dialog.showSaveDialog=async()=>++picks===1?{canceled:true}:{canceled:false,filePath:${JSON.stringify(target)}};
 process.argv=[process.execPath,${JSON.stringify(repo)},${JSON.stringify(root)},${JSON.stringify(profile)}];
 let win;const phase=${JSON.stringify(phase)},result=${JSON.stringify(path.join(run,phase+'.json'))};
 const js=c=>win.webContents.executeJavaScript(c),sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const read=()=>JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/checkpoints/project.json'))},'utf8'));
 async function wait(fn,label){const end=Date.now()+90000;while(Date.now()<end){try{if(await fn())return;}catch{}await sleep(60)}throw Error('Timeout '+label);}
 async function click(selector){const done=await js('(()=>{const b=document.querySelector('+JSON.stringify(selector)+');if(!b||b.disabled)return false;b.click();return true})()');if(!done)throw Error('Unavailable '+selector);await sleep(120);}
 const openExport=async()=>{await click('.wb-project-menu summary');await click('[data-export-psd]');};
 app.on('window-all-closed',()=>fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-closed.json'))},'{}'));
 import(${JSON.stringify('file://'+path.join(repo,'dist-electron/platform/main/flowEditorEntry.js'))}).then(async()=>{
  await app.whenReady();await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');win.setSize(1400,1000);
  await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');const first=read(),shot=first.shots[0],image=first.images[shot.imageId];assert.ok(image.layers[0].sourceReference);
  if(phase==='export'){
   await click('.wb-card[data-board-id]');await click('button[aria-label="Add layer"]');await wait(()=>read().images[shot.imageId].layers.length===2,'drawing layer');
   const before=read().images[shot.imageId].layers[1].assetId;
   const box=await js('(()=>{const e=document.querySelector(".wb-viewer .stage-overlay")||document.querySelector(".stage-overlay");const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()');
   for(const[type,dx,dy]of[['mouseMove',.3,.4],['mouseDown',.3,.4],['mouseMove',.7,.6],['mouseUp',.7,.6]]){win.webContents.sendInputEvent({type,x:Math.round(box.x+box.w*dx),y:Math.round(box.y+box.h*dy),button:'left',clickCount:1});await sleep(120);}
   await wait(()=>read().images[shot.imageId].layers[1].assetId!==before,'paint pixels');
   const stable=read();await openExport();await wait(()=>picks===1,'cancel picker');await wait(()=>js('!document.querySelector("[data-export-psd]").disabled'),'cancel settled');assert.ok(!fs.existsSync(${JSON.stringify(target)}));assert.deepEqual(read(),stable);
   await openExport();await wait(()=>fs.existsSync(${JSON.stringify(target)}),'PSD published');await wait(()=>js('document.body.textContent.includes("已另存 Flow-edited.psd")'),'success receipt');
   const digest=crypto.createHash('sha256').update(fs.readFileSync(${JSON.stringify(target)})).digest('hex');
   await openExport();await wait(()=>js('document.body.textContent.includes("PSD目标已存在")'),'existing file refused visibly');assert.equal(crypto.createHash('sha256').update(fs.readFileSync(${JSON.stringify(target)})).digest('hex'),digest);
   assert.deepEqual(read(),stable);fs.writeFileSync(${JSON.stringify(path.join(run,'expected.json'))},JSON.stringify(read()));
  }else{assert.deepEqual(read(),JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run,'expected.json'))},'utf8')));}
  fs.writeFileSync(${JSON.stringify(path.join(run,phase+'.png'))},(await win.webContents.capturePage()).toPNG());fs.writeFileSync(result,JSON.stringify({ok:true,phase,pickers:picks,revision:read().revision}));win.close();
 }).catch(async error=>{let body='';try{body=await js('document.body.innerText');fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-failure.png'))},(await win.webContents.capturePage()).toPNG())}catch{}fs.writeFileSync(result,JSON.stringify({ok:false,error:String(error.stack||error),body}));app.exit(1)});
 `);
 execFileSync(process.execPath,['--check',driver]);const env={...process.env,FLOW_USER_DATA_DIR:profile};delete env.ELECTRON_RUN_AS_NODE;
 const logs=[],child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs.push(b));child.stderr.on('data',b=>logs.push(b));
 const exit=await new Promise(resolve=>{const timer=setTimeout(()=>{child.kill('SIGKILL');resolve('timeout')},150000);child.once('exit',code=>{clearTimeout(timer);resolve(code)})});await fs.writeFile(path.join(run,phase+'.log'),Buffer.concat(logs));
 const r=JSON.parse(await fs.readFile(path.join(run,phase+'.json'),'utf8'));if(exit!==0||!r.ok)throw Error(JSON.stringify({run,exit,result:r}));await fs.readFile(path.join(run,phase+'-closed.json'));console.log(JSON.stringify(r));
}
if(sha(await fs.readFile(sourceFile))!==sourceHash)throw Error('Synthetic source changed');
await fs.writeFile(path.join(run,'receipt.json'),JSON.stringify({passed:true,sourceUnchanged:true,target,projectRoot:root,head:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim()}));console.log('PASS',run);
