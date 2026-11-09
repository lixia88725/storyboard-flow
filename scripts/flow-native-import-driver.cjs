// Synthetic source import through the real picker/UI. No user project or system Trash.
const {app,BrowserWindow,clipboard,shell,dialog,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const out=process.env.FLOW_OUT,repo=process.env.FLOW_REPO,reopen=process.env.FLOW_IMPORT_REOPEN==='1',protectedImport=process.env.FLOW_PROTECTED_IMPORT==='1';
if(!out?.startsWith('/private/tmp/flow-native-workbench-'))throw Error('isolated fixture required');
let certified=0,layerFailureInjected=false;const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{if(process.env.FLOW_LAYER_FAILURE_NOTICE==='1'&&!reopen&&!layerFailureInjected&&name==='flow-image-workspace:request'&&args[1]?.command?.kind==='imageEdit'){layerFailureInjected=true;return{kind:'rejected',operationId:'synthetic-layer-failure',error:{code:'stale-context',effect:'none',message:'context generation changed; query summary before retry'}};}const value=await fn(...args);if(name==='flow-editor:finish-native-close'&&value?.ok)certified++;return value;});
const phase=reopen?'import-reopen':'import',source=path.join(out,'sources'),parent=path.join(out,'destination');
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard prohibited');};shell.trashItem=()=>{throw Error('Trash prohibited');};
dialog.showOpenDialog=async(_window,options)=>{assert.ok(['打开项目或图片文件夹','选择项目保存位置'].includes(options.title),'unexpected chooser '+options.title);return{canceled:false,filePaths:[options.title==='打开项目或图片文件夹'?source:parent]};};
const receipt=reopen?JSON.parse(fs.readFileSync(path.join(out,'import-result.json'),'utf8')):null;
process.argv=[process.execPath,__filename,reopen?receipt.root:path.join(out,'project'),path.join(out,'import-userData')];
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex'),sourceHashes=Object.fromEntries(fs.readdirSync(source).map(name=>[name,sha(path.join(source,name))]));
let win;const report={cases:[],stage:'boot'},pause=ms=>new Promise(r=>setTimeout(r,ms)),js=async s=>{try{return await win.webContents.executeJavaScript(s);}catch(error){throw Error('Renderer expression failed: '+s+'; '+String(error));}},boot=()=>js('window.flowEditor.imageWorkspace.bootstrap()');
async function wait(fn,label){const deadline=Date.now()+45000;while(Date.now()<deadline){if(await fn())return;await pause(60);}throw Error('timeout '+label);}
(async()=>{
 await import(pathToFileURL(path.join(repo,'dist-electron/platform/main/flowEditorEntry.js')).href);await app.whenReady();await wait(()=>!!(win=BrowserWindow.getAllWindows()[0]),'window');win.setSize(1400,1000);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');
 if(!reopen){
  await js(`document.querySelector('.wb-project-menu').open=true;Array.from(document.querySelectorAll('.wb-project-menu button')).find(b=>b.textContent==='打开…').click()`);
  await wait(()=>js('!!document.querySelector("[data-create-sheet]")'),'import confirmation');
  await js(`Array.from(document.querySelectorAll('[data-create-sheet] button')).find(b=>b.textContent==='选择位置…').click()`);
  await wait(()=>js(`document.querySelector('[data-create-destination]')?.textContent==='destination'`),'isolated destination');
  report.stage='create';const started=Date.now();await js(`Array.from(document.querySelectorAll('[data-create-sheet] button')).find(b=>b.textContent==='创建并打开').click()`);
  await wait(async()=>{try{return(await boot()).snapshot.session.project.shots.length===3;}catch{return false;}},'all three source references registered');report.enteredMs=Date.now()-started;
  const dirs=fs.readdirSync(parent);assert.equal(dirs.length,1);report.root=path.join(parent,dirs[0]);report.cases.push('external folder creates a separate source-backed project via UI');
 }
 await wait(()=>js('!document.querySelector("[data-create-sheet]")'),'create sheet closed after owner binding');report.stage='first-source';
 const first=(await boot()).snapshot.session.project.shots[0];
 await wait(()=>js('document.querySelectorAll("canvas[data-frame-status=ready]").length===2'),'first source visible');
 const initial=(await boot()).snapshot;assert.equal(initial.session.project.shots.length,3);assert.equal(initial.context.shotId,first.id);
 if(reopen){assert.equal(initial.session.project.revision,receipt.revision);report.root=receipt.root;report.cases.push('new process reopens imported project and exact durable revision');if(protectedImport){assert.deepEqual(initial.session.project.images[first.imageId].protectedSource,receipt.protectedSource);for(const f of receipt.savedFiles)assert.equal(sha(path.join(receipt.root,f.name)),f.sha256);assert.equal(initial.images[first.imageId].availability,'reference');report.cases.push('reopen preserves protected source identity and all saved files');}}
 else{
  if(protectedImport){assert.equal(initial.images[first.imageId].availability,'reference');assert.ok(initial.images[first.imageId].layers.some(l=>!l.capabilities.paint));assert.ok(initial.images[first.imageId].layers.some(l=>l.capabilities.paint));report.cases.push('severe display difference retains a protected base and editable upper layer');}
  assert.equal(initial.session.project.images[first.imageId].content.kind,'source');
  const selector=`[data-surface="viewer:${first.id}"] canvas`,r=await js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  const mouse=(type,x,y)=>win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'b'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'b'});
  mouse('mouseDown',r.x+r.w*.3,r.y+r.h*.5);await pause(30);mouse('mouseMove',r.x+r.w*.6,r.y+r.h*.5);await pause(30);mouse('mouseUp',r.x+r.w*.6,r.y+r.h*.5);
  await wait(async()=> (await boot()).snapshot.session.project.revision===initial.session.project.revision+1,'first imported drawing committed');
  assert.equal((await boot()).snapshot.session.project.images[first.imageId].content.kind,'native');
  if(process.env.FLOW_IMPORT_LAYER_REGRESSION==='1'){
   report.stage='paint-then-layers';
   const pixels=()=>js(`(()=>{const c=document.querySelector(${JSON.stringify(selector)});if(c.dataset.frameStatus!=='ready')return null;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let s='';for(let i=0;i<d.length;i+=16384)s+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(s);})()`);
   const draw=async y=>{const before=(await boot()).snapshot.session.project.revision;mouse('mouseDown',r.x+r.w*.2,r.y+r.h*y);await pause(30);mouse('mouseMove',r.x+r.w*.55,r.y+r.h*y);await pause(30);mouse('mouseUp',r.x+r.w*.55,r.y+r.h*y);await wait(async()=>(await boot()).snapshot.session.project.revision===before+1,'additional stroke confirmed');await wait(()=>js('!document.querySelector("[aria-label=新增图层]").disabled'),'layer controls ready after painting');};
   // No Undo/Save/navigation between drawing and the layer action: those used
   // to refresh the stale context and conceal this user-reported defect.
   await draw(.65);const beforeLayers=(await boot()).snapshot.images[first.imageId].layers.length;
   if(process.env.FLOW_LAYER_FAILURE_NOTICE==='1'){
    const beforeFailure=(await boot()).snapshot.session.project.revision,beforePixels=await pixels();
    await js('document.querySelector("[aria-label=新增图层]").click()');
    await wait(()=>js(`document.body.innerText.includes('上一项图层操作未完成，请先处理下方提示。')`),'failed operation is described as pending, not missing capability');
    assert.equal(await js(`document.body.innerText.includes('当前引擎未提供图层编辑能力')||document.body.innerText.includes('context generation changed')`),false);
    assert.equal((await boot()).snapshot.session.project.revision,beforeFailure);assert.equal(await pixels(),beforePixels);
    await js(`Array.from(document.querySelectorAll('.native-layer-host button')).find(b=>b.textContent==='放弃未提交的图层操作').click()`);
    await wait(()=>js('!document.querySelector("[aria-label=新增图层]").disabled'),'synthetic no-effect operation released');
    report.cases.push('injected no-effect layer failure keeps pixels/history, shows accurate Chinese notice and releases only the failed operation');
   }
   await js('document.querySelector("[aria-label=新增图层]").click()');
   await wait(async()=>(await boot()).snapshot.images[first.imageId].layers.length===beforeLayers+1,'new layer immediately after two strokes');
   await wait(()=>js('!document.querySelector("[aria-label=新增图层]").disabled'),'new layer ready');
   await draw(.3);const afterPaint=(await boot()).snapshot,layerId=afterPaint.context.layerId,painted=await pixels();assert.ok(painted);
   const row=`.native-layer-panel [data-layer-id="${layerId}"][role=treeitem]`;
   await js(`document.querySelector(${JSON.stringify(row+' [aria-label=隐藏图层]')}).click()`);
   await wait(async()=>(await boot()).snapshot.images[first.imageId].layers.find(l=>l.id===layerId)?.visible===false,'hide layer after painting');
   await wait(async()=>{const p=await pixels();return p&&p!==painted;},'hidden layer changes displayed pixels');
   await wait(()=>js('!document.querySelector("[aria-label=新增图层]").disabled'),'visibility operation settled');
   await js(`document.querySelector(${JSON.stringify(row+' [aria-label=显示图层]')}).click()`);
   await wait(async()=>await pixels()===painted,'show layer restores exact displayed pixels');
   assert.equal(await js(`document.body.innerText.includes('当前引擎未提供图层编辑能力')||document.body.innerText.includes('context generation changed')`),false);
   // Return to the first stroke so the existing source Undo/Redo assertions
   // below still check their original contract, without weakening them.
   for(let i=0;i<5;i++){await wait(()=>js('!document.querySelector("[aria-label=撤销]").disabled'),'Undo enabled');const revision=(await boot()).snapshot.session.project.revision;await js('document.querySelector("[aria-label=撤销]").click()');await wait(async()=>(await boot()).snapshot.session.project.revision===revision+1,'one history step');}
   report.cases.push('two imported strokes then new layer; another stroke then hide/show exact pixels; five ordinary Undo steps');
  }
  await js('document.querySelector("[aria-label=撤销]").click()');
  await wait(async()=> (await boot()).snapshot.session.project.images[first.imageId].content.kind==='source','Undo returns to original source identity');
  await js('document.querySelector("[aria-label=重做]").click()');
  await wait(async()=> (await boot()).snapshot.session.project.images[first.imageId].content.kind==='native','Redo retains image edit');
  report.revision=(await boot()).snapshot.session.project.revision;report.cases.push('source drawing and ordinary Undo/Redo use one shared history');
  if(!protectedImport){await wait(()=>js(`document.body.innerText.includes('这张图片暂时无法读取，其他图片仍可使用')`),'bad source isolated with readable explanation');report.cases.push('bad source has a readable message without blocking good images');}else{
   const state=(await boot()).snapshot,protectedSource=state.session.project.images[first.imageId].protectedSource;assert.ok(protectedSource,'paint retains original source identity');assert.equal(protectedSource.original.digest,sourceHashes['01.psd']);
   await js('document.querySelector(".wb-save").click()');await wait(async()=>{const s=(await boot()).snapshot;return s.files.savedRevision===report.revision&&!s.files.outputPending;},'protected source Save receipt');
   const saved=(await boot()).snapshot;assert.equal(saved.files.outputNames.length,3);const mild=saved.session.project.shots[1];assert.equal(saved.images[mild.imageId].availability,'editable','small difference remains editable');assert.equal(saved.session.project.images[mild.imageId].protectedSource,undefined);report.cases.push('small visual difference is accepted without protecting the image');
   report.savedFiles=saved.files.outputNames.map(item=>({name:item.name,sha256:sha(path.join(report.root,item.name))}));report.protectedSource=protectedSource;
   await wait(()=>js('document.querySelectorAll("canvas[data-frame-status=ready]").length===2'),'protected Save display restored');
   const canvas=await js(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let s='';for(let i=0;i<d.length;i+=16384)s+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(s);})()`);
   const output=saved.files.outputNames.find(item=>item.shotId===first.id);const actual=await require('sharp')(path.join(report.root,output.name)).ensureAlpha().raw().toBuffer(),expected=Buffer.from(canvas,'base64');assert.equal(actual.length,expected.length);let max=0;for(let i=0;i<actual.length;i++)max=Math.max(max,Math.abs(actual[i]-expected[i]));report.outputMaxDifference=max;fs.writeFileSync(path.join(out,'protected-output.rgba'),actual);fs.writeFileSync(path.join(out,'protected-display.rgba'),expected);assert.ok(max<=8,'protected working TIFF differs from displayed picture: '+max);report.cases.push('protected source and added paint Save together without losing provenance');
   if(process.env.FLOW_PROTECTED_REFRESH==='1'){
    report.stage='protected-refresh';
    const working=path.join(report.root,output.name),external=path.join(out,'protected-external.tiff');
    await require('node:util').promisify(require('node:child_process').execFile)(process.env.FLOW_SOURCE_GUARD_PYTHON??'/opt/homebrew/bin/python3.14',[path.join(repo,'native/photocraft/tests/working_refresh_fixture.py'),working,external,'good'],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:process.env.FLOW_SOURCE_GUARD_PYTHONPATH??'/private/tmp/flow-image-engine-export-python'}});
    fs.renameSync(external,working);
    const getPixels=()=>js(`(()=>{const c=document.querySelector(${JSON.stringify(selector)});if(c.dataset.frameStatus!=='ready')return null;const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let s='';for(let i=0;i<d.length;i+=16384)s+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(s);})()`);
    await js('document.querySelector("[aria-label=从文件夹取回外部改动]").click()');await wait(()=>js('!!document.querySelector("[aria-label=取回外部改动]")'),'protected Refresh choice');
    assert.equal(await js(`document.querySelector('[aria-label="取回外部改动"] select').value`),'useExternal');
    await js(`document.querySelector('[aria-label="取回外部改动"] .primary').click()`);await wait(()=>js('!document.querySelector("[aria-label=取回外部改动]")'),'protected Refresh applied');
    const externalPixels=(await require('sharp')(working).ensureAlpha().raw().toBuffer()).toString('base64');
    // Compare independent TIFF pixels after the browser's documented Canvas
    // premultiply/unpremultiply storage conversion, still byte-for-byte. File
    // pixels remain independently checked exactly after Save below.
    const externalDisplay=await js(`(()=>{const c=document.querySelector(${JSON.stringify(selector)}),v=atob(${JSON.stringify(externalPixels)}),p=Uint8ClampedArray.from(v,x=>x.charCodeAt(0)),oracle=document.createElement('canvas');oracle.width=c.width;oracle.height=c.height;const ctx=oracle.getContext('2d');ctx.putImageData(new ImageData(p,c.width,c.height),0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let s='';for(let i=0;i<d.length;i+=16384)s+=String.fromCharCode(...d.subarray(i,i+16384));return btoa(s);})()`);
    const externalRaw=Buffer.from(externalPixels,'base64'),displayRaw=Buffer.from(externalDisplay,'base64');report.externalCanvasRoundTripMaxDifference=Math.max(...externalRaw.map((v,i)=>Math.abs(v-displayRaw[i])));
    await wait(async()=>await getPixels()===externalDisplay,'protected external upper pixels');
    assert.deepEqual((await boot()).snapshot.session.project.images[first.imageId].protectedSource,protectedSource);
    await js('document.querySelector("[aria-label=撤销]").click()');await wait(async()=>await getPixels()===canvas,'protected Refresh Undo');
    await js('document.querySelector("[aria-label=重做]").click()');await wait(async()=>await getPixels()===externalDisplay,'protected Refresh Redo');
    report.revision=(await boot()).snapshot.session.project.revision;
    await js('document.querySelector(".wb-save").click()');await wait(async()=>{const s=(await boot()).snapshot;return s.files.savedRevision===report.revision&&!s.files.outputPending;},'protected Refresh Save');
    const final=(await boot()).snapshot;assert.deepEqual(final.session.project.images[first.imageId].protectedSource,protectedSource);assert.deepEqual(await require('sharp')(working).ensureAlpha().raw().toBuffer(),externalRaw,'saved protected Refresh pixels match independent external TIFF exactly');report.protectedRefreshSavedPixelsExact=true;
    report.savedFiles=final.files.outputNames.map(item=>({name:item.name,sha256:sha(path.join(report.root,item.name))}));
    report.cases.push('authorized protected working TIFF external upper edit returns through real Refresh, one Undo/Redo and Save without changing original binding');
   }

  }
 }
 for(const [name,digest]of Object.entries(sourceHashes))assert.equal(sha(path.join(source,name)),digest);report.cases.push('all external originals unchanged');
 fs.writeFileSync(path.join(out,phase+'.png'),(await win.webContents.capturePage()).toPNG());report.stage='close';win.once('closed',()=>{try{assert.equal(certified,1);report.ok=true;}catch(error){report.ok=false;report.error=String(error);}fs.writeFileSync(path.join(out,phase+'-result.json'),JSON.stringify(report,null,2));});win.close();await wait(()=>win.isDestroyed(),'normal close');assert.equal(certified,1);assert.equal(report.ok,true,'closed receipt must certify normal close');app.quit();
})().catch(async error=>{report.error=String(error.stack||error);if(win&&!win.isDestroyed())try{fs.writeFileSync(path.join(out,phase+'-failed.png'),(await win.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(out,phase+'-failed-dom.txt'),await js('document.body.innerText'));}catch{}fs.writeFileSync(path.join(out,phase+'-result.json'),JSON.stringify(report,null,2));console.error(error);app.exit(1);});
