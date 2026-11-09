// Actual Electron pointer input, synthetic source folder, certified close/reopen.
const {app,BrowserWindow,dialog,clipboard,shell,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const out=process.env.FLOW_OUT,repo=process.env.FLOW_REPO,phase=process.env.FLOW_PERF_PHASE,reopen=phase==='reopen';
if(!out?.startsWith('/private/tmp/flow-native-workbench-'))throw Error('Synthetic fixture required');
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard prohibited');};
shell.trashItem=()=>{throw Error('Trash prohibited');};
const source=path.join(out,'sources'),parent=path.join(out,'destination'),sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const originals=Object.fromEntries(fs.readdirSync(source).map(n=>[n,sha(path.join(source,n))]));
const previous=reopen?JSON.parse(fs.readFileSync(path.join(out,'performance-paint.json'),'utf8')):null;
process.argv=[process.execPath,__filename,reopen?previous.root:path.join(out,'project'),path.join(out,'performance-userData')];
dialog.showOpenDialog=async(_win,options)=>{assert.ok(['打开项目或图片文件夹','选择项目保存位置'].includes(options.title));return{canceled:false,filePaths:[options.title==='打开项目或图片文件夹'?source:parent]};};
let win,certified=0;const report={phase,strokes:[],stage:'boot'};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{const result=await fn(...args);if(name==='flow-editor:finish-native-close'&&result?.ok)certified++;return result;});
const pause=ms=>new Promise(r=>setTimeout(r,ms)),js=s=>win.webContents.executeJavaScript(s),boot=async()=>(await js('window.flowEditor.imageWorkspace.bootstrap()')).snapshot;
const wait=async(fn,label,ms=60000)=>{const deadline=Date.now()+ms;while(Date.now()<deadline){if(await fn())return;await pause(30);}throw Error('timeout '+label);};
const button=label=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b)throw Error('button missing');b.click()})()`);
(async()=>{
 await import(pathToFileURL(path.join(repo,'dist-electron/platform/main/flowEditorEntry.js')).href);await app.whenReady();await wait(()=>!!(win=BrowserWindow.getAllWindows()[0]),'window');win.setSize(1400,1000);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'initial workbench');
 if(!reopen){
  await js(`document.querySelector('.wb-project-menu').open=true`);await button('打开…');
  await wait(()=>js('!!document.querySelector("[data-create-sheet]")'),'create sheet');await button('选择位置…');
  await wait(()=>js(`document.querySelector('[data-create-destination]')?.textContent==='destination'`),'destination');
  const started=Date.now();await button('创建并打开');await wait(async()=>{try{return(await boot()).session.project.shots.length===300;}catch{return false;}},'300 source references');report.enteredMs=Date.now()-started;
  const dirs=fs.readdirSync(parent);assert.equal(dirs.length,1);report.root=path.join(parent,dirs[0]);
 }else report.root=previous.root;
 await wait(()=>js('document.querySelectorAll("canvas[data-frame-status=ready]").length===2'),'first image');
 const initial=await boot(),first=initial.session.project.shots[0];assert.equal(initial.session.project.shots.length,300);
 const selector=`[data-surface="viewer:${first.id}"] canvas`,pixels=()=>js(`(()=>{const c=document.querySelector(${JSON.stringify(selector)});if(c.dataset.frameStatus!=='ready')return null;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let s='';for(let i=0;i<d.length;i+=16384)s+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(s)})()`);
 if(reopen){assert.equal(initial.session.project.revision,previous.revision);assert.equal(createHash('sha256').update(await pixels()).digest('hex'),previous.pixelSha256);}
 else{
  report.remainingAtFirstStroke=Object.values(initial.images).filter(i=>['queued','retaining','hydrating'].includes(i.availability)).length;assert.ok(report.remainingAtFirstStroke>0,'painting must overlap background loading');
  const before=await pixels();assert.ok(before);await js(`window.__flowPerf={frames:[],last:performance.now(),active:true};requestAnimationFrame(function tick(now){const p=window.__flowPerf;if(!p.active)return;p.frames.push(now-p.last);p.last=now;requestAnimationFrame(tick)})`);
  const r=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  const mouse=(type,x,y)=>win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'b'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'b'});
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
  report.stage='idle-background-completion';const idleStart=Date.now();
  await wait(async()=>Object.values((await boot()).images).every(i=>!['queued','retaining'].includes(i.availability)),'source custody finishes after drawing',60000);
  report.idleCompletionMs=Date.now()-idleStart;
  report.pixelSha256=createHash('sha256').update(await pixels()).digest('hex');
  report.revision=(await boot()).session.project.revision;assert.equal(report.revision,initial.session.project.revision+12);
 }
 assert.deepEqual(Object.fromEntries(fs.readdirSync(source).map(n=>[n,sha(path.join(source,n))])),originals);
 report.stage='close';win.on('closed',()=>{assert.ok(certified>0,'normal close certified');report.ok=true;report.certified=certified;fs.writeFileSync(path.join(out,'performance-'+phase+'.json'),JSON.stringify(report,null,2));});win.close();
 setTimeout(()=>{if(!win.isDestroyed()){fs.writeFileSync(path.join(out,'performance-'+phase+'-failed.json'),JSON.stringify(report));app.exit(1);}},60000).unref();
})().catch(error=>{report.error=String(error.stack??error);fs.writeFileSync(path.join(out,'performance-'+phase+'-failed.json'),JSON.stringify(report,null,2));console.error(error);app.exit(1);});
