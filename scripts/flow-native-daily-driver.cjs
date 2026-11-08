// Real Electron input and UI over a synthetic workspace; no personal resources.
const {app,BrowserWindow,clipboard,shell,dialog,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const repo=process.env.FLOW_REPO,out=process.env.FLOW_OUT,reopen=process.env.FLOW_DAILY_REOPEN==='1',phase=reopen?'daily-reopen':'daily';
if(!out?.startsWith('/private/tmp/flow-native-workbench-'))throw Error('Synthetic root required');
const root=path.join(out,'project'),source=path.join(out,'daily-sources'),sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const originals=Object.fromEntries(fs.readdirSync(source).map(name=>[name,sha(path.join(source,name))]));
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard prohibited');};shell.trashItem=()=>{throw Error('Trash prohibited');};
let certified=0;const outcomes=[],handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{const result=await fn(...args);if(name==='flow-editor:finish-native-close'&&result?.ok)certified++;if(name==='flow-image-workspace:request')outcomes.push({command:args[1]?.command,result});return result;});
dialog.showOpenDialog=async(_w,options)=>{assert.equal(options.title,'添加图片到 Pending');return{canceled:false,filePaths:options.properties.includes('openDirectory')?[source]:fs.readdirSync(source).map(n=>path.join(source,n))};};
process.argv=[process.execPath,__filename,root,path.join(out,'daily-userData')];
let win;const report={stage:'boot',cases:[]},pause=ms=>new Promise(r=>setTimeout(r,ms));
const js=code=>win.webContents.executeJavaScript(code),boot=async()=>(await js('window.flowEditor.imageWorkspace.bootstrap()')).snapshot;
async function wait(fn,label){const until=Date.now()+60000;while(Date.now()<until){if(await fn())return;await pause(60);}throw Error('timeout '+label);}
const click=label=>js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!b||b.disabled)throw Error('Button unavailable: '+${JSON.stringify(label)});b.click();})()`);
const pixels=()=>js(`(()=>{const c=document.querySelector('[data-surface="viewer:a"] canvas[data-frame-status=ready]');if(!c)return null;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let text='';for(let i=0;i<d.length;i+=16384)text+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(text);})()`);
async function stroke(y){const before=(await boot()).session.project.revision;const r=await js(`(()=>{const r=document.querySelector('[data-surface="viewer:a"] canvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};})()`);const mouse=(type,x,y)=>win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});mouse('mouseDown',r.x+r.w*.2,r.y+r.h*y);await pause(30);mouse('mouseMove',r.x+r.w*.55,r.y+r.h*y);await pause(30);mouse('mouseUp',r.x+r.w*.55,r.y+r.h*y);await wait(async()=>(await boot()).session.project.revision>before,'stroke commit');await wait(()=>pixels(),'stroke frame');}
async function save(){const count=outcomes.length;await js('document.querySelector(".wb-save").click()');await wait(()=>outcomes.slice(count).some(o=>o.command.kind==='save'),'save result');const result=outcomes.slice(count).find(o=>o.command.kind==='save').result;assert.equal(result.kind,'settled',JSON.stringify(result));await wait(()=>js('!document.querySelector(".wb-save").disabled'),'save UI resume');await wait(()=>pixels(),'save display');}
async function preview(){await js('document.querySelector("[aria-label=从文件夹取回外部改动]").click()');await wait(()=>js('!!document.querySelector("[aria-label=取回外部改动]")'),'refresh choice');}
async function choose(name,decision){await js(`(()=>{const s=document.querySelector('select[aria-label='+CSS.escape(${JSON.stringify('采用的版本 '+name)})+']');if(!s)throw Error('No choice');s.value=${JSON.stringify(decision)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);}
(async()=>{
 await import(pathToFileURL(path.join(repo,'dist-electron/platform/main/flowEditorEntry.js')).href);await app.whenReady();await wait(()=>!!(win=BrowserWindow.getAllWindows()[0]),'window');win.setSize(1400,1000);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');await wait(()=>pixels(),'ready canvas');
 if(reopen){const expected=JSON.parse(fs.readFileSync(path.join(out,'daily-expected.json'),'utf8'));assert.equal(await pixels(),expected.pixels);const state=await boot();assert.equal(state.session.project.revision,expected.revision);assert.equal(state.session.project.parkedShots.length,expected.pendingCount);for(const f of expected.files)assert.equal(sha(path.join(root,f.name)),f.sha);report.cases.push('new process preserves final picture, Pending, revision and files');}
 else{
  report.stage='baseline-save';await stroke(.3);await save();const baseline=await boot(),file=baseline.files.outputNames.find(n=>n.shotId==='a').name,oldDigest=sha(path.join(root,file));
  await stroke(.65);let unsaved=await pixels();
  if(process.env.FLOW_DAILY_RECOVERY_ONLY!=='1'){
  report.stage='add-pending';await js(`[...document.querySelectorAll('.wb-actions details')].find(d=>d.querySelector('summary')?.textContent==='添加图片').open=true`);await click('选择图片…');
  await wait(async()=>(await boot()).session.project.parkedShots.length===8,'registered Pending batch');
  await wait(()=>outcomes.some(o=>o.command.kind==='addImages'),'Add registration reply');assert.equal(outcomes.find(o=>o.command.kind==='addImages').result.kind,'imagesRegistered');
  const registrationState=await boot();report.additionAtDraw=registrationState.files.backgroundImports;
  assert.ok(registrationState.files.backgroundImports.some(b=>!['completed','paused','needsAttention','recovering'].includes(b.phase)),'fixture must still be processing during drawing');
  const started=Date.now();await stroke(.5);report.drawingDuringImportMs=Date.now()-started;unsaved=await pixels();
  report.cases.push('real pointer drawing commits while newly added images are still processing');
  await wait(async()=>{const s=await boot();return s.files.backgroundImports?.length&&s.files.backgroundImports.every(b=>b.phase==='completed');},'new batch materialized');
  assert.equal(sha(path.join(root,file)),oldDigest,'Add must not save existing unsaved drawing');assert.equal(await pixels(),unsaved);report.cases.push('Add registers Pending and writes only new batch; unsaved drawing and old working file unchanged');
  report.stage='external-conflict';const sharp=require('sharp');await sharp({create:{width:640,height:360,channels:4,background:{r:210,g:60,b:80,alpha:1}}}).tiff().toFile(path.join(root,file+'.external.tif'));fs.renameSync(path.join(root,file+'.external.tif'),path.join(root,file));const externalDigest=sha(path.join(root,file));
  await preview();assert.equal(await js(`document.querySelector('[aria-label="取回外部改动"]').textContent.includes('都改过')`),true);assert.equal(await js(`document.querySelector('[aria-label="取回外部改动"] button.primary').disabled`),true,'conflicting version requires explicit choice');
  assert.equal(await pixels(),unsaved);assert.equal(sha(path.join(root,file)),externalDigest);fs.writeFileSync(path.join(out,'refresh-conflict.png'),(await win.webContents.capturePage()).toPNG());
  await choose(file,'useExternal');await click('确认选择');await wait(()=>js('!document.querySelector("[aria-label=取回外部改动]")'),'Refresh accepted');
  const external=(await sharp(path.join(root,file)).ensureAlpha().raw().toBuffer()).toString('base64');await wait(async()=>await pixels()===external,'external RGBA installed');
  await js('document.querySelector("[aria-label=撤销]").click()');await wait(async()=>await pixels()===unsaved,'one Undo restores unsaved drawing');await js('document.querySelector("[aria-label=重做]").click()');await wait(async()=>await pixels()===external,'Redo restores external picture');
  report.cases.push('Refresh conflict is explicit, then one Undo and Redo restore exact prior and external pictures');
  report.stage='keep-flow';await sharp({create:{width:640,height:360,channels:4,background:{r:40,g:210,b:90,alpha:1}}}).tiff().toFile(path.join(root,file+'.external.tif'));fs.renameSync(path.join(root,file+'.external.tif'),path.join(root,file));await preview();await choose(file,'keepFlow');await click('确认选择');await wait(()=>js('!document.querySelector("[aria-label=取回外部改动]")'),'keepFlow accepted');assert.equal(await pixels(),external);await save();assert.equal((await sharp(path.join(root,file)).ensureAlpha().raw().toBuffer()).toString('base64'),external);report.cases.push('keep Flow preserves displayed image and permits explicit later Save');
  }
  report.stage='worker-recovery';const beforeRecovery=await pixels(),pidPath=process.env.FLOW_DAILY_HOST_PID;
  assert.equal(pidPath,path.join(out,'daily-host.pid'));const pid=Number(fs.readFileSync(pidPath,'utf8'));assert.ok(Number.isSafeInteger(pid)&&pid>1);
  process.kill(pid,'SIGKILL');await wait(async()=>(await boot()).session.phase==='recovering','owned worker failure surfaced');
  await wait(()=>js(`[...document.querySelectorAll('[aria-label="图片与文件待处理"] button')].some(b=>b.textContent==='核对并恢复'&&!b.disabled)`),'usable recovery action');
  fs.writeFileSync(path.join(out,'recovery-action.png'),(await win.webContents.capturePage()).toPNG());await click('核对并恢复');await wait(async()=>(await boot()).session.phase==='active','same-window recovery');await wait(async()=>await pixels()===beforeRecovery,'recovery restores exact pixels');
  await stroke(.8);await save();report.cases.push('owned worker interruption recovers in the same window and accepts new drawing');
  const final=await boot();fs.writeFileSync(path.join(out,'daily-expected.json'),JSON.stringify({pixels:await pixels(),revision:final.session.project.revision,pendingCount:final.session.project.parkedShots.length,files:final.files.outputNames.map(f=>({name:f.name,sha:sha(path.join(root,f.name))}))}));
 }
 for(const [name,digest]of Object.entries(originals))assert.equal(sha(path.join(source,name)),digest);
 fs.writeFileSync(path.join(out,`${phase}.png`),(await win.webContents.capturePage()).toPNG());win.close();await wait(()=>win.isDestroyed(),'certified close');assert.equal(certified,1);report.cases.push('normal close; imported originals unchanged');report.ok=true;fs.writeFileSync(path.join(out,`${phase}-result.json`),JSON.stringify(report,null,2));app.quit();
})().catch(async error=>{report.error=String(error.stack||error);if(win&&!win.isDestroyed())try{fs.writeFileSync(path.join(out,`${phase}-failed.txt`),await js('document.body.innerText'));fs.writeFileSync(path.join(out,`${phase}-failed.png`),(await win.webContents.capturePage()).toPNG());}catch{}fs.writeFileSync(path.join(out,`${phase}-result.json`),JSON.stringify(report,null,2));console.error(error);app.exit(1);});
