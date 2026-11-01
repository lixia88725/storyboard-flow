import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import sharp from 'sharp';
import {openFlowAssetDepot} from '../dist-electron/core/persistence/depot.js';
import {createProjectStore} from '../dist-electron/core/persistence/index.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),get=r=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-workbench-smoke-')),root=path.join(run,'project');await mkdir(root);
const depot=get(await openFlowAssetDepot({root,sessionId:'seed',maxPixels:1000000,maxPngBytes:1000000}));
const count=Number(process.env.FLOW_WORKBENCH_COUNT||6);
const clear=await sharp({create:{width:640,height:360,channels:4,background:'#00000000'}}).png().toBuffer();
const transparent=get(await depot.put({operationId:'clear',png:clear,width:640,height:360})).assetId;
const project={schema:'storyboard-flow.project',version:1,id:'workbench',revision:0,name:'Workbench acceptance',shots:[],parkedShots:[],dialogues:[],images:{}};
for(let i=0;i<count+1;i++){
 const png=await sharp({create:{width:640,height:360,channels:4,background:{r:220+i%30,g:220+Math.floor(i/30)%30,b:245,alpha:1}}}).png().toBuffer();
 const assetId=get(await depot.put({operationId:'base'+i,png,width:640,height:360})).assetId;
 const shot={id:'shot'+i,imageId:'image'+i,name:String(i+1).padStart(4,'0'),scriptText:'动作 '+i};
 (i===count?project.parkedShots:project.shots).push(shot);
 project.images[shot.imageId]={id:shot.imageId,revision:0,width:640,height:360,layers:[{id:'base',name:'背景',kind:'image',locked:true,assetId},{id:'ink',name:'绘画',kind:'paint',locked:false,assetId:transparent}].map(l=>({...l,visible:true,opacity:1,blendMode:'normal',width:640,height:360}))};
}
get(await createProjectStore().saveCheckpoint(root,project,async id=>get(await depot.read(id))));
const identity={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run,count};
for(const phase of (count<100 ? ['edit','reopen','recovery'] : ['edit','reopen'])){
 const userData=path.join(run,'userData');await mkdir(userData,{recursive:true});const driver=path.join(run,phase+'.cjs');
 await writeFile(driver,String.raw`
 const {app,BrowserWindow,clipboard,shell,ipcMain}=require('electron'),fs=require('node:fs'),assert=require('node:assert/strict');
 for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};shell.trashItem=()=>{throw Error('Trash forbidden')};
 const reads=new Set(),handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,name==='flow-editor:read'?async(e,token,id)=>{reads.add(id);return fn(e,token,id)}:fn);
 process.argv=[process.argv[0],${JSON.stringify(path.join(repo,'dist-electron/main/flowEditorEntry.js'))},${JSON.stringify(root)},${JSON.stringify(userData)},'--workbench'];
 let win;const phase=${JSON.stringify(phase)},count=${count};const delay=ms=>new Promise(r=>setTimeout(r,ms));const read=()=>JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/checkpoints/project.json'))},'utf8'));const js=c=>win.webContents.executeJavaScript(c);
 async function wait(fn,label){for(let i=0;i<400;i++){try{if(await fn())return}catch{}await delay(50)}throw Error('Timeout '+label)}
 async function button(text){await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==='+JSON.stringify(text)+').click()');await delay(100)}
 async function rect(s){return js('(()=>{const e=document.querySelector('+JSON.stringify(s)+');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()')}
 async function mouse(type,x,y){win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});await delay(65)}
 const current=()=>js('document.querySelector("[data-current-shot]").dataset.currentShot');
 const key=k=>js('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:'+JSON.stringify(k)+',bubbles:true}))');
 const selected=()=>js('Array.from(document.querySelectorAll(".wb-card.is-selected")).map(e=>e.dataset.boardId)');
 app.on('window-all-closed',()=>fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-closed.json'))},'{}'));
 const started=Date.now();
 import(${JSON.stringify('file://'+path.join(repo,'dist-electron/main/flowEditorEntry.js'))}).then(async()=>{
 await app.whenReady();await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');win.setSize(1600,1000);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');
 await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("Flow 内已保存")'),'checkpoint');
 await wait(()=>js('document.querySelector(".wb-viewer .image-stage img")?.naturalWidth>0'),'viewer raster');
 const openingMs=Date.now()-started;
 const folderSays=text=>wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.includes('+JSON.stringify(text)+')'),text);
 if(phase==='recovery'){
   const source=fs.readFileSync(${JSON.stringify(path.join(run,'staged-path.txt'))},'utf8');
   const held=${JSON.stringify(path.join(run,'simulated-trash.tif'))};
   const notice=()=>js('document.querySelector(".wb-recovery")?.textContent||""');
   await wait(async()=>(await notice()).includes('放回'),'missing acknowledgement after restart');
   assert.ok((await notice()).includes(require('node:path').basename(source)));
   await button('保存 TIFF');
   await wait(async()=>(await notice()).includes('放回'),'unknown outcome remains blocked');
   assert.ok(fs.existsSync(held));assert.ok(!fs.existsSync(source));
   fs.copyFileSync(held,source);
   await js("window.dispatchEvent(new Event('focus'))");
   await wait(async()=>(await notice()).includes('身份或内容'),'substitute refused');
   fs.renameSync(source,held+'.rejected-copy');
   fs.renameSync(held,source);
   await js("window.dispatchEvent(new Event('focus'))");
   await wait(async()=>(await notice()).includes('重试保存 TIFF'),'restored original verified');
   let calls=0;
   shell.trashItem=async file=>{assert.equal(file,source);calls++;fs.renameSync(file,held);};
   await button('重试保存 TIFF');await folderSays('文件夹中的故事板已更新');
   assert.equal(calls,1);assert.equal(await notice(),'');win.close();return;
 }
 if(phase==='edit'){
 await folderSays('文件夹中的故事板待更新');
 const before=read();assert.equal(before.shots.length,count);
 await js('document.querySelector(\'[aria-label="选择故事板 shot2"]\').dispatchEvent(new MouseEvent("click",{bubbles:true,shiftKey:true}))');
 await wait(async()=>JSON.stringify(await selected())==='["shot0","shot1","shot2"]','range selection');assert.equal(await current(),'shot0');
 await key('ArrowRight');await wait(async()=>await current()==='shot1','right navigation');assert.deepEqual(await selected(),['shot1']);
 await key('ArrowLeft');await wait(async()=>await current()==='shot0','left navigation');await key('ArrowLeft');assert.equal(await current(),'shot0');
 assert.deepEqual(read(),before);
 const target=await rect('[data-board-id="shot2"] .wb-card-picture');
 await mouse('mouseMove',target.x+target.width*.4,target.y+target.height*.5);
 await wait(()=>js('!!document.querySelector(\'[data-surface="grid:shot2"] .stage-overlay\')'),'hover editable canvas');
 await mouse('mouseDown',target.x+target.width*.4,target.y+target.height*.5);
 await mouse('mouseMove',target.x+target.width*.6,target.y+target.height*.5);
 assert.equal(await current(),'shot2');assert.deepEqual(await selected(),['shot2']);
 await wait(()=>js('Array.from(document.querySelectorAll("[data-live-mirror]")).some(c=>{const a=c.getContext("2d").getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i]>170&&a[i+1]<100&&a[i+2]<130)return true;return false})'),'live red stroke mirrored before release');
 await key('ArrowRight');assert.equal(await current(),'shot2');assert.equal(read().images.image2.layers[1].assetId,${JSON.stringify(transparent)});
 await mouse('mouseUp',target.x+target.width*.6,target.y+target.height*.5);
 await wait(()=>read().images.image2.layers[1].assetId!==${JSON.stringify(transparent)},'grid stroke checkpoint');
 const painted=read().images.image2.layers[1].assetId;
 await wait(()=>js('!document.querySelector("[data-live-mirror]")'),'settled mirror');
 await button('撤销');await wait(()=>read().images.image2.layers[1].assetId===${JSON.stringify(transparent)},'one undo');
 await button('重做');await wait(()=>read().images.image2.layers[1].assetId===painted,'redo');
 // Native text input owns arrow keys rather than flipping the current board.
 await js('document.querySelector(\'[aria-label="动作说明 shot2"]\').focus()');await win.webContents.insertText('文字');
 await js('document.querySelector(\'[aria-label="动作说明 shot2"]\').dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');assert.equal(await current(),'shot2');
 const revision=read().revision;
 await js('document.querySelector(\'[aria-label="隐藏图层"]\').click()');assert.equal(await js('!!document.querySelector(\'[data-panel="layers"]\')'),false);
 await js('document.querySelector(".wb-header summary").click()');await button('恢复默认布局');assert.equal(await js('!!document.querySelector(\'[data-panel="layers"]\')'),true);
 // Panel docking is metadata-free native drag/drop; the board ordering uses a separate drag type.
 await js('(()=>{const d=new DataTransfer();d.setData("application/x-flow-panel","info");document.querySelector(".wb-column").dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:d}))})()');
 assert.equal(await js('document.querySelector(".wb-column").querySelectorAll(\'[data-panel="info"]\').length'),1);
 await button('恢复默认布局');
 const divider=await rect('.wb-divider');await mouse('mouseDown',divider.x+3,divider.y+40);await mouse('mouseMove',divider.x+90,divider.y+40);await mouse('mouseUp',divider.x+90,divider.y+40);
 await button('移入 Pending');await wait(()=>read().parkedShots.some(s=>s.id==='shot2'),'Pending membership');
 await button('撤销');await wait(()=>read().shots.some(s=>s.id==='shot2'),'restore membership');
 await js('document.querySelector(\'[aria-label="选择故事板 shot0"]\').click()');
 await delay(500);
 const from=await rect('[aria-label="选择故事板 shot1"]'),to=await rect('[aria-label="选择故事板 shot0"]');
 await mouse('mouseDown',from.x+25,from.y+12);await mouse('mouseMove',from.x+40,from.y+12);await wait(()=>js('document.querySelector(\'[aria-label="选择故事板 shot1"]\').getAttribute("aria-pressed")=="true"'),'drag activated');await delay(250);await mouse('mouseMove',to.x+25,to.y+12);await delay(300);await mouse('mouseUp',to.x+25,to.y+12);
 await wait(()=>read().shots[0].id==='shot1','header reorder');await button('撤销');await wait(()=>read().shots[0].id==='shot0','reorder undo');
 // Reverse direction: a viewer stroke is visible in the grid before release.
 const viewer=await rect('.wb-viewer .wb-surface');
 await mouse('mouseMove',viewer.x+viewer.width*.4,viewer.y+viewer.height*.4);
 await mouse('mouseDown',viewer.x+viewer.width*.4,viewer.y+viewer.height*.4);
 await mouse('mouseMove',viewer.x+viewer.width*.6,viewer.y+viewer.height*.4);
 await wait(()=>js('Array.from(document.querySelectorAll(".wb-grid [data-live-mirror]")).some(c=>{const a=c.getContext("2d").getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i]>170&&a[i+1]<100&&a[i+2]<130)return true;return false})'),'viewer stroke mirrored into grid');
 await mouse('mouseUp',viewer.x+viewer.width*.6,viewer.y+viewer.height*.4);
 await wait(()=>read().images.image0.layers[1].assetId!==${JSON.stringify(transparent)},'viewer stroke checkpoint');
 await wait(()=>js('!document.querySelector("[data-live-mirror]")'),'viewer mirror settled');
 await button('撤销');await wait(()=>read().images.image0.layers[1].assetId===${JSON.stringify(transparent)},'viewer stroke undo');
 if(count<100){
   const revisionBefore=read().revision;
   await button('日式分镜');
   await wait(()=>js('!!document.querySelector(".wb-japanese .wb-row-info textarea")'),'Japanese rows');
   assert.equal(read().revision,revisionBefore);
   await js('document.querySelector(".wb-row-info textarea").focus()');
   await win.webContents.insertText('日式动作');
   await wait(()=>read().shots.some(s=>s.scriptText.includes('日式动作')),'Japanese row text checkpoint');
 }
 if(count<100){await button('保存 TIFF');await wait(()=>js('!Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="保存中…")'),'Save settles');assert.ok(fs.existsSync(${JSON.stringify(path.join(root,'.storyboard-flow/tiff-output.json'))}));}
 if(count<100) await folderSays('文件夹中的故事板已更新');
 fs.writeFileSync(${JSON.stringify(path.join(run,'expected.json'))},JSON.stringify(read()));
 }else{assert.deepEqual(read(),JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run,'expected.json'))},'utf8')));}
 if(phase==='reopen' && count<100){
   await wait(()=>js('!!document.querySelector(".wb-japanese .wb-row-info textarea")'),'layout restored after new process');
   await button('日式分镜');
   await folderSays('文件夹中的故事板已更新');
   const entry=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/tiff-output.json'))})).entries.find(e=>!e.retired && e.location!=='parked');
   const target=require('node:path').join(${JSON.stringify(root)},entry.name),original=fs.readFileSync(target);
   fs.appendFileSync(require('node:path').join(${JSON.stringify(root)},entry.name),'test external edit');
   await js("window.dispatchEvent(new Event('focus'))");
   await folderSays('文件夹中的故事板有改动');
   fs.writeFileSync(target,original);
   await button('删除');await wait(()=>read().shots.length===count-1,'checkpoint logical removal');
   shell.trashItem=async file=>{
     assert.equal(require('node:path').dirname(require('node:path').dirname(file)),${JSON.stringify(path.join(root,'.storyboard-flow/deletions'))});
     fs.writeFileSync(${JSON.stringify(path.join(run,'staged-path.txt'))},file);
     fs.renameSync(file,${JSON.stringify(path.join(run,'simulated-trash.tif'))});throw Error('Synthetic lost OS reply');
   };
   await button('保存 TIFF');await wait(()=>js('document.querySelector(".wb-recovery")?.textContent.includes("放回")'),'actionable recovery');

 }
 await js('document.querySelector(".wb-header details").open=false');await delay(400);
 await wait(()=>js('Array.from(document.querySelectorAll(".wb-card")).slice(0,3).every(e=>e.querySelector("img")?.naturalWidth>0)'), 'visible cards remain rendered after reorder');
 const metrics=await js('({canvases:document.querySelectorAll(".stage-overlay").length,rasterImages:document.querySelectorAll(".wb-grid img").length,cards:document.querySelectorAll(".wb-card").length,heap:performance.memory?.usedJSHeapSize})');
 fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-metrics.json'))},JSON.stringify({openingMs,readAssets:reads.size,...metrics}));
 if(count>=100){assert.ok(reads.size<100,'only visible assets requested');assert.ok(metrics.canvases<=2,'bounded editable canvases');assert.ok(metrics.rasterImages<100,'offscreen rasters unmounted');}
 fs.writeFileSync(${JSON.stringify(path.join(run,phase+'.png'))},(await win.webContents.capturePage()).toPNG());win.close();
 }).catch(async e=>{console.error(e);if(win&&!win.isDestroyed()){console.error(await js('document.body.innerText'));fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-failure.png'))},(await win.webContents.capturePage()).toPNG());}app.exit(1)});
 `);
 execFileSync(process.execPath,['--check',driver]);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const chunks=[],child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>{chunks.push(b);process.stderr.write(b)});
 const code=await new Promise(resolve=>child.on('exit',resolve));await writeFile(path.join(run,phase+'.log'),Buffer.concat(chunks));console.log(phase,code,run);if(code!==0)throw Error('Workbench verification failed: '+run);await readFile(path.join(run,phase+'-closed.json'));
}
await writeFile(path.join(run,'receipt.json'),JSON.stringify({...identity,passed:true,cases:['workbench connected to real Session','multi-select displays earliest board','arrows cancel multi-select and stop at boundary','navigation never edits project','hover enables grid painting','drawing selects and follows current board','live stroke mirrored in both directions before pointer release','unsettled stroke blocks navigation','single Undo and Redo restores stroke','text arrows do not navigate','panels hide and restore','panel docking is separate from board ordering','split resize','Pending membership and Undo','header pointer reorder and Undo',...(count<100?['explicit Save for small fixture','Japanese row edit and layout reopen','interrupted Trash: missing and substituted files refused, verified original retry']:[]),'normal Close and reopen retains edits',...(count>=100?['bounded visible rasters and editable canvases at scale']:[])]},null,2));console.log('PASS',run);
