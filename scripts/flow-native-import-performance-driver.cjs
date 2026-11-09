// Actual Electron pointer input, isolated project/profile, certified close/reopen.
const {app,BrowserWindow,dialog,clipboard,shell,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const out=process.env.FLOW_OUT,repo=process.env.FLOW_REPO,phase=process.env.FLOW_PERF_PHASE,reopen=phase==='reopen',saveRetry=phase==='save-retry';
if(!out?.startsWith('/private/tmp/flow-native-workbench-'))throw Error('Synthetic fixture required');
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard prohibited');};
shell.trashItem=()=>{throw Error('Trash prohibited');};
const source=process.env.FLOW_ARTIST_SOURCE||path.join(out,'sources'),sourceCount=Number(process.env.FLOW_SOURCE_COUNT||300),parent=path.join(out,'destination'),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const originals=Object.fromEntries(fs.readdirSync(source,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>[e.name,sha(path.join(source,e.name))]));
fs.writeFileSync(path.join(out,'source-hashes-'+phase+'-before.json'),JSON.stringify(originals,null,2));
const previous=(reopen||saveRetry)?JSON.parse(fs.readFileSync(path.join(out,saveRetry?'performance-paint-failed.json':process.env.FLOW_ARTIST_RESUME_OUT?'performance-save-retry.json':'performance-paint.json'),'utf8')):null;
process.argv=[process.execPath,__filename,(reopen||saveRetry)?previous.root:path.join(out,'project'),path.join(out,'performance-userData')];
dialog.showOpenDialog=async(_win,options)=>{assert.ok(['打开项目或图片文件夹','选择项目保存位置'].includes(options.title));return{canceled:false,filePaths:[options.title==='打开项目或图片文件夹'?source:parent]};};
let win,certified=0,activationDelay=0,extraRevisions=0;const inputEvents=[],commandOutcomes=[];const report={phase,strokes:[],stage:'boot'};Object.defineProperty(report,'stage',{enumerable:true,get(){return this._stage??'boot'},set(value){this._stage=value;fs.writeFileSync(path.join(out,'performance-'+phase+'-progress.json'),JSON.stringify({...this,at:Date.now()},null,2));}});
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{if(name==='flow-image-workspace:input')inputEvents.push(args[2]);if(activationDelay&&name==='flow-image-workspace:request'&&args[1]?.command?.kind==='activateShot')await new Promise(r=>setTimeout(r,activationDelay));const result=await fn(...args);if(name==='flow-image-workspace:request')commandOutcomes.push({command:args[1]?.command,result});if(name==='flow-editor:finish-native-close'&&result?.ok)certified++;return result;});
const pause=ms=>new Promise(r=>setTimeout(r,ms)),js=s=>win.webContents.executeJavaScript(s),boot=async()=>(await js('window.flowEditor.imageWorkspace.bootstrap()')).snapshot;
const wait=async(fn,label,ms=60000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){if(await fn())return;await pause(30);}throw Error('timeout '+label);};
const button=label=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('button missing');b.click()})()`);
(async()=>{
 await import(pathToFileURL(path.join(repo,'dist-electron/platform/main/flowEditorEntry.js')).href);await app.whenReady();await wait(()=>!!(win=BrowserWindow.getAllWindows()[0]),'window');win.setSize(1400,1000);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'initial workbench');
 if(!reopen&&!saveRetry){
  await js(`document.querySelector('.wb-project-menu').open=true`);await button('打开…');
  await wait(()=>js('!!document.querySelector("[data-create-sheet]")'),'create sheet');await button('选择位置…');
  await wait(()=>js(`document.querySelector('[data-create-destination]')?.textContent==='destination'`),'destination');
  const started=Date.now();await button('创建并打开');await wait(async()=>{try{return(await boot()).session.project.shots.length===sourceCount;}catch{return false;}},'source references');report.enteredMs=Date.now()-started;
  const dirs=fs.readdirSync(parent);assert.equal(dirs.length,1);report.root=path.join(parent,dirs[0]);
 }else report.root=previous.root;
 if(saveRetry){
  const s=await boot();report.revisionBeforeRecovery=s.session.project.revision;
  if(s.files.status==='unfinished'||s.files.recovery||s.session.phase==='recovering'){
   await wait(()=>js('!!document.querySelector(".wb-file-recovery button:not(:disabled)")'),'recovery action');
   const seen=commandOutcomes.length;await js('document.querySelector(".wb-file-recovery button:not(:disabled)").click()');
   await wait(()=>commandOutcomes.slice(seen).some(o=>o.command?.kind==='recover'),'explicit test-project recovery',180000);
   const outcome=commandOutcomes.slice(seen).find(o=>o.command?.kind==='recover').result;assert.ok(['settled','recovered'].includes(outcome.kind),JSON.stringify(outcome));
  }
  assert.equal((await boot()).session.project.revision,report.revisionBeforeRecovery,'recovery preserves accepted drawing history');
 }
 await wait(()=>js('document.querySelectorAll("canvas[data-frame-status=ready]").length===2'),'first image');
 const initial=await boot(),first=initial.session.project.shots[0];assert.equal(initial.session.project.shots.length,sourceCount);
 const selector=`[data-surface="viewer:${first.id}"] canvas`,pixels=()=>js(`(()=>{const c=document.querySelector(${JSON.stringify(selector)});if(c.dataset.frameStatus!=='ready')return null;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let s='';for(let i=0;i<d.length;i+=16384)s+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(s)})()`);
 await wait(()=>pixels(),'exact imported first-board frame');
 if(saveRetry){
  report.stage='retry-save';const before=await pixels(),project=initial.session.project,seen=commandOutcomes.length,started=Date.now();
  await wait(()=>js('!document.querySelector(".wb-save").disabled'),'retry Save enabled');await js('document.querySelector(".wb-save").click()');
  await wait(()=>commandOutcomes.slice(seen).some(o=>o.command?.kind==='save'),'retry Save completes',1800000);
  assert.equal(commandOutcomes.slice(seen).find(o=>o.command?.kind==='save').result.kind,'settled',JSON.stringify(commandOutcomes.at(-1)));
  report.saveMs=Date.now()-started;await wait(()=>pixels(),'saved frame');assert.equal(await pixels(),before);assert.deepEqual((await boot()).session.project,project);
  report.outputFiles=fs.readdirSync(report.root).filter(n=>/\.tiff?$/i.test(n)).length;assert.equal(report.outputFiles,sourceCount);report.revision=project.revision;report.pixelSha256=createHash('sha256').update(before).digest('hex');
 }else if(reopen){assert.equal(initial.session.project.revision,previous.revision);assert.equal(createHash('sha256').update(await pixels()).digest('hex'),previous.pixelSha256);
  if(process.env.FLOW_ARTIST_SOURCE){
   report.stage='reopen-first-stroke';const baseline=await pixels(),revision=initial.session.project.revision;
   const r=await js(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),r=c.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width*.2,r.y+r.height*.85);if(hit!==c&&!hit?.closest('[data-canvas-input]'))throw Error('Reopen stroke misses canvas');return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
   win.webContents.sendInputEvent({type:'keyDown',keyCode:'b'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'b'});
   for(const [type,x]of [['mouseDown',.2],['mouseMove',.75],['mouseUp',.75]]){win.webContents.sendInputEvent({type,x:Math.round(r.x+r.w*x),y:Math.round(r.y+r.h*.85),button:'left',clickCount:1});await pause(40);}
   await wait(async()=>(await boot()).session.project.revision===revision+1,'first stroke after reopening');await wait(async()=>await pixels()!==baseline,'reopened stroke visible');
   assert.equal(await js('!!document.querySelector("[aria-label=待处理笔迹]")'),false);
   await wait(()=>js('!document.querySelector("[aria-label=撤销]").disabled'),'reopened undo ready');await js('document.querySelector("[aria-label=撤销]").click()');await wait(async()=>await pixels()===baseline,'undo reopened stroke restores saved drawing');report.reopenDrawingAndUndo=true;
  }
 }
 else{
  report.sourceCount=sourceCount;report.realSource=!!process.env.FLOW_ARTIST_SOURCE;report.remainingAtFirstStroke=Object.values(initial.images).filter(i=>['queued','retaining','hydrating'].includes(i.availability)).length;assert.ok(report.remainingAtFirstStroke>0,'painting must overlap background loading');
  const before=await pixels();assert.ok(before);await js(`window.__flowPerf={frames:[],last:performance.now(),active:true};requestAnimationFrame(function tick(now){const p=window.__flowPerf;if(!p.active)return;p.frames.push(now-p.last);p.last=now;requestAnimationFrame(tick)})`);
  const r=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  const mouse=(type,x,y)=>win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'b'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'b'});
  if(process.env.FLOW_CANCEL_REGRESSION==='1'){
   report.stage='cancel-preview-before-paint';const revision=(await boot()).session.project.revision;
   for(let repeat=0;repeat<2;repeat++){
    mouse('mouseDown',r.x+r.w*.3,r.y+r.h*.6);await pause(80);mouse('mouseMove',r.x+r.w*.6,r.y+r.h*.6);
    await wait(async()=>(await pixels())!==before,'cancel fixture live stroke visible');
    win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});mouse('mouseUp',r.x+r.w*.6,r.y+r.h*.6);
    await wait(async()=>(await pixels())===before,'cancel restores original pixels');
    assert.equal((await boot()).session.project.revision,revision,'cancel must not add history');
   }
   report.cancelledPreviews=2;
  }
  await js('window.__flowPerf.frames=[];window.__flowPerf.last=performance.now()');
  for(let i=0;i<12;i++){
   report.stage='stroke-'+i;const revision=(await boot()).session.project.revision,started=Date.now(),y=r.y+r.h*(.2+i*.04);
   mouse('mouseDown',r.x+r.w*.2,y);
   for(let n=1;n<=8;n++){await pause(16);mouse('mouseMove',r.x+r.w*(.2+.04*n),y);}
   mouse('mouseUp',r.x+r.w*.52,y);
   await wait(async()=>{const s=await boot();assert.equal(s.session.phase,'active','ordinary drawing must not enter recovery');return s.session.project.revision===revision+1;},'stroke confirmed',15000);
   report.strokes.push({totalMs:Date.now()-started});
  }
  report.frameIntervals=await js('window.__flowPerf.active=false;window.__flowPerf.frames');
  const intervals=report.frameIntervals.slice(1).sort((a,b)=>a-b);report.frameP95=intervals[Math.floor(intervals.length*.95)];report.frameMax=intervals.at(-1);
  assert.ok(report.frameP95<80,`renderer frame p95 ${report.frameP95}ms`);
  assert.ok(Math.max(...report.strokes.map(s=>s.totalMs))<2000,'no multi-second stall per stroke');
  await wait(async()=>(await pixels())!==before,'visible paint');
  assert.equal(await js('!!document.querySelector("[aria-label=待处理笔迹]")'),false);
  assert.equal(await js('!!document.querySelector(".wb-file-recovery")'),false);
  if(process.env.FLOW_ADMISSION_REGRESSION==='1')extraRevisions=await require('./flow-native-admission-cases.cjs')({win,js,boot,wait,pause,report,inputEvents,setActivationDelay:value=>{activationDelay=value;}});
  report.stage='idle-background-completion';const idleStart=Date.now();
  await wait(async()=>Object.values((await boot()).images).every(i=>!['queued','retaining'].includes(i.availability)),'source custody finishes after drawing',process.env.FLOW_ARTIST_SOURCE?600000:60000);
  report.idleCompletionMs=Date.now()-idleStart;
  if(process.env.FLOW_ARTIST_SOURCE){
   report.stage='artist-undo-redo-save';const painted=await pixels(),revisionBeforeHistory=(await boot()).session.project.revision;
   report.stage='artist-browse';report.switches=[];
   for(const index of [1,2,3,9,30,75,150,250,303,0]){
    const shot=(await boot()).session.project.shots[index],started=Date.now();
    await js(`(()=>{const n=document.querySelector('[data-board-id="${shot.id}"] .wb-card-handle');n.scrollIntoView({block:'center'});n.click()})()`);
    await wait(async()=>(await boot()).context.shotId===shot.id,'artist selection');
    await wait(()=>js(`!!document.querySelector('[data-surface="viewer:${shot.id}"] canvas[data-frame-status=ready]')`),'artist target ready');
    report.switches.push({index,readyMs:Date.now()-started});
   }
   report.stage='artist-new-layer';await wait(()=>js('!document.querySelector("[aria-label=新增图层]").disabled'),'new layer ready');
   const beforeLayer=await boot(),layerCount=beforeLayer.images[beforeLayer.context.imageId].layers.length;
   await js('document.querySelector("[aria-label=新增图层]").click()');await wait(async()=>{const s=await boot();return s.images[s.context.imageId].layers.length===layerCount+1;},'new layer created');
   await wait(()=>js('!document.querySelector("[aria-label=新增图层]").disabled'),'new layer settled');
   const layerSnapshot=await boot(),rev=layerSnapshot.session.project.revision;report.newLayerContext={context:layerSnapshot.context,image:layerSnapshot.images[layerSnapshot.context.imageId]};
   const fresh=await js(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),r=c.getBoundingClientRect();for(const x of [.2,.7]){const hit=document.elementFromPoint(r.x+r.width*x,r.y+r.height*.75);if(hit!==c&&!hit?.closest('[data-canvas-input]'))throw Error('Artist stroke misses canvas');}return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
   mouse('mouseDown',fresh.x+fresh.w*.2,fresh.y+fresh.h*.75);await pause(40);mouse('mouseMove',fresh.x+fresh.w*.7,fresh.y+fresh.h*.75);mouse('mouseUp',fresh.x+fresh.w*.7,fresh.y+fresh.h*.75);
   await wait(async()=>(await boot()).session.project.revision===rev+1,'new layer stroke');
   await wait(async()=>(await pixels())!==painted,'new layer pixels visible');const modified=await pixels();assert.notEqual(modified,painted,'artist new layer visibly changes image');
   await js('document.querySelector("[aria-label=撤销]").click()');await wait(async()=>(await boot()).session.redoDepth>0,'undo');
   await wait(()=>js('!document.querySelector("[aria-label=重做]").disabled'),'redo button ready');await js('document.querySelector("[aria-label=重做]").click()');await wait(async()=>(await boot()).session.redoDepth===0,'redo');await wait(async()=>(await pixels())===modified,'redo preserves current board');
   await wait(()=>js('!document.querySelector(".wb-save").disabled'),'save button ready');report.stage='artist-save';const seen=commandOutcomes.length,saveStarted=Date.now();await js('document.querySelector(".wb-save").click()');
   await wait(()=>commandOutcomes.slice(seen).some(o=>o.command?.kind==='save'),'artist save completes',600000);
   const result=commandOutcomes.slice(seen).find(o=>o.command?.kind==='save').result;assert.equal(result.kind,'settled',JSON.stringify(result));report.saveMs=Date.now()-saveStarted;extraRevisions+=(await boot()).session.project.revision-revisionBeforeHistory;
   await wait(()=>pixels(),'saved display');report.outputFiles=fs.readdirSync(report.root).filter(n=>/\.tiff?$/i.test(n)).length;assert.equal(report.outputFiles,sourceCount);
  }
  report.pixelSha256=createHash('sha256').update(await pixels()).digest('hex');
  report.revision=(await boot()).session.project.revision;assert.equal(report.revision,initial.session.project.revision+12+extraRevisions);
 }
 const afterHashes=Object.fromEntries(fs.readdirSync(source,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>[e.name,sha(path.join(source,e.name))]));assert.deepEqual(afterHashes,originals);fs.writeFileSync(path.join(out,'source-hashes-'+phase+'-after.json'),JSON.stringify(afterHashes,null,2));report.originalsUnchanged=true;
 report.stage='close';fs.writeFileSync(path.join(out,'performance-'+phase+'.png'),(await win.webContents.capturePage()).toPNG());win.on('closed',()=>{assert.ok(certified>0,'normal close certified');report.ok=true;report.certified=certified;fs.writeFileSync(path.join(out,'performance-'+phase+'.json'),JSON.stringify(report,null,2));});win.close();
 setTimeout(()=>{if(!win.isDestroyed()){fs.writeFileSync(path.join(out,'performance-'+phase+'-failed.json'),JSON.stringify(report));app.exit(1);}},60000).unref();
})().catch(async error=>{if(win&&!win.isDestroyed())try{fs.writeFileSync(path.join(out,'performance-'+phase+'-failed.png'),(await win.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(out,'performance-'+phase+'-failed-dom.txt'),await js('document.body.innerText'));}catch{}try{report.failureSnapshot=await boot();}catch{}report.commandOutcomes=commandOutcomes.map(o=>({command:o.command?.kind,result:o.result?.kind,error:o.result?.error}));report.inputEvents=inputEvents;report.error=String(error.stack??error);fs.writeFileSync(path.join(out,'performance-'+phase+'-failed.json'),JSON.stringify(report,null,2));console.error(error);app.exit(1);});
