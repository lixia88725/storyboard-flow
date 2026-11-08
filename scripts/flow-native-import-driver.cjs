// Synthetic source import through the real picker/UI. No user project or system Trash.
const {app,BrowserWindow,clipboard,shell,dialog,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const out=process.env.FLOW_OUT,repo=process.env.FLOW_REPO,reopen=process.env.FLOW_IMPORT_REOPEN==='1',protectedImport=process.env.FLOW_PROTECTED_IMPORT==='1';
if(!out?.startsWith('/private/tmp/flow-native-workbench-'))throw Error('isolated fixture required');
let certified=0;const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{const value=await fn(...args);if(name==='flow-editor:finish-native-close'&&value?.ok)certified++;return value;});
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
  }
 }
 for(const [name,digest]of Object.entries(sourceHashes))assert.equal(sha(path.join(source,name)),digest);report.cases.push('all external originals unchanged');
 fs.writeFileSync(path.join(out,phase+'.png'),(await win.webContents.capturePage()).toPNG());report.stage='close';win.once('closed',()=>{try{assert.equal(certified,1);report.ok=true;}catch(error){report.ok=false;report.error=String(error);}fs.writeFileSync(path.join(out,phase+'-result.json'),JSON.stringify(report,null,2));});win.close();await wait(()=>win.isDestroyed(),'normal close');assert.equal(certified,1);assert.equal(report.ok,true,'closed receipt must certify normal close');app.quit();
})().catch(async error=>{report.error=String(error.stack||error);if(win&&!win.isDestroyed())try{fs.writeFileSync(path.join(out,phase+'-failed.png'),(await win.webContents.capturePage()).toPNG());fs.writeFileSync(path.join(out,phase+'-failed-dom.txt'),await js('document.body.innerText'));}catch{}fs.writeFileSync(path.join(out,phase+'-result.json'),JSON.stringify(report,null,2));console.error(error);app.exit(1);});
