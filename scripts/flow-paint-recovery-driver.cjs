// Real connected renderer/Session/IPC regressions. Only runner-owned synthetic data.
const {app,BrowserWindow,clipboard,shell,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const repo=process.env.FLOW_REPO,root=process.env.FLOW_ROOT,out=process.env.FLOW_OUT;
if(!root.startsWith(path.join(fs.realpathSync(require('node:os').tmpdir()),'flow-paint-presentation-'))||!path.isAbsolute(repo))throw Error('isolated paths required');
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard prohibited');};
shell.trashItem=()=>{throw Error('Trash prohibited');};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
let failNext,puts=0,refuseClose=false,exported=false,failCheckpoint=false;const closeCalls=[];let switchCalls=0;
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{
  if(name==='flow-editor:put'){
    puts++;const effect=failNext;failNext=undefined;await delay(700);
    if(effect==='none')return {ok:false,error:{code:'io-failure',message:'synthetic temporary refusal',effect}};
    const result=await fn(...args);
    if(effect==='unknown')return {ok:false,error:{code:'io-failure',message:'synthetic unknown depot acknowledgement',effect}};
    return result;
  }
  if(name==='flow-editor:checkpoint'&&failCheckpoint){failCheckpoint=false;return {ok:false,error:{code:'io-failure',message:'synthetic checkpoint refusal',effect:'none'}};}
  if(name==='flow-editor:switch-project'){switchCalls++;return null;}
  if(name==='flow-editor:finish-close'){
    closeCalls.push({certified:!!args[3]});
    if(refuseClose&&args[3])return fn(...args.slice(0,3),null);
  }
  return fn(...args);
});
const slot=app.isPackaged?1:2;process.argv[slot]=root;process.argv[slot+1]=path.join(out,'userData');
let win;const report={cases:[],error:null};
const js=async code=>{const value=await win.webContents.executeJavaScript(`Promise.resolve().then(()=>eval(${JSON.stringify(code)})).catch(e=>({__probeError:String(e.stack||e)}))`);if(value?.__probeError)throw Error(value.__probeError);return value;};
const wait=async(fn,label)=>{for(let i=0;i<700;i++){if(await fn())return;await delay(20);}throw Error('timeout '+label);};
const revision=()=>js('window.__editor.flow.snapshot().project.revision');
const state=()=>js('({frame:((f)=>({status:f.status,decision:f.decision,decisionReady:f.decisionReady,recovery:f.recovery}))(window.__paint.frame()),stats:window.__paint.stats(),paused:window.__editor.paintInput.isPaused(),phase:window.__editor.flow.snapshot().phase})');
const rect=selector=>js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
const mouse=(type,x,y)=>win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
async function dot(fx,fy){const r=await rect('[data-surface="viewer:shot0"] .image-stage');mouse('mouseDown',r.x+r.w*fx,r.y+r.h*fy);await delay(15);mouse('mouseUp',r.x+r.w*fx,r.y+r.h*fy);await delay(15);}
async function click(text){
  const r=await js(`(()=>{const b=Array.from(document.querySelectorAll('.wb-viewer button')).find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)throw Error('unavailable button '+${JSON.stringify(text)});const r=b.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  mouse('mouseDown',r.x,r.y);await delay(20);mouse('mouseUp',r.x,r.y);await delay(30);
}
const ready=()=>wait(async()=>{const s=await state();return s.frame.status==='ready'&&s.stats.records===0;},'settled presentation');
const alpha=points=>js(`(()=>{const c=window.__paint.frame().canvas;return ${JSON.stringify(points)}.map(([x,y])=>c.getContext('2d').getImageData(Math.floor(x*c.width),Math.floor(y*c.height),1,1).data[3])})()`);
async function overflow(fx,fy){
  await js('window.__overflow=true');const r=await rect('[data-surface="viewer:shot0"] .image-stage');
  mouse('mouseDown',r.x+r.w*fx,r.y+r.h*fy);await delay(20);mouse('mouseMove',r.x+r.w*(fx+.02),r.y+r.h*fy);await delay(30);
  assert.equal((await state()).frame.decision,true);assert.equal((await state()).frame.decisionReady,false);
  mouse('mouseUp',r.x+r.w*(fx+.02),r.y+r.h*fy);await delay(30);assert.equal((await state()).frame.decisionReady,true);
}
async function holdTransition(kind='close'){
  await js(`(()=>{const p=window.__editor,original=p.beforeTransition.current;window.__gap=false;p.beforeTransition.current=async()=>{p.beforeTransition.current=original;await original();window.__gap=true;await new Promise(r=>window.__releaseGap=r);};return true})()`);
  if(kind==='close')win.close();else await js("window.__switchResult=null;void window.__editor.openProject({kind:'pending'}).then(r=>window.__switchResult=r);true");await wait(()=>js('window.__gap'),'settled-to-freeze gap');
}
(async()=>{
  await import(pathToFileURL(path.join(repo,'dist-electron/platform/main/flowEditorEntry.js')).href);await app.whenReady();
  await wait(()=>!!(win=BrowserWindow.getAllWindows()[0]),'window');win.setSize(1400,1000);
  win.webContents.session.on('will-download',(_event,item)=>{if(item.getFilename()!=='paint-recovery.json')throw Error('unexpected download');item.setSavePath(path.join(out,'paint-recovery.json'));item.once('done',(_event,state)=>{exported=state==='completed';});});
  await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');
  await wait(()=>js('document.querySelector(".wb-status")?.innerText.includes("已自动暂存")'),'checkpoint');
  // Find the real mounted component props. No production debug hooks or second owner.
  await js(`(()=>{const node=document.querySelector('.wb-viewer .image-stage');let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber$'))];for(;f;f=f.return){const p=f.memoizedProps;if(p?.paintPresentation)window.__paint=p.paintPresentation;if(p?.flow&&p?.paintInput)window.__editor=p;}if(!window.__paint||!window.__editor)throw Error('mounted owners not found');const update=window.__paint.update;window.__paint.update=s=>{if(window.__overflow){window.__overflow=false;return update({...s,points:Array.from({length:200002},(_,i)=>i%2?100:120)});}return update(s);};return true})()`);
  await js(`(()=>{const e=document.querySelector('.wb-viewer .image-stage'),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+30,clientY:r.y+30}));})()`);
  await wait(()=>js('!!document.querySelector(".wb-brush-presets button[title=硬画笔]")'),'brush panel');
  await js('document.querySelector(".wb-brush-presets button[title=硬画笔]").click();window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');

  const budgetBefore=await revision(),budgetPuts=puts;
  await overflow(.15,.3);await delay(800);assert.equal(puts,budgetPuts);assert.equal(await revision(),budgetBefore);
  const budget=await state();assert.equal(budget.stats.points,1);
  await click('放弃该笔，重新绘画');assert.equal((await state()).stats.records,0);
  await overflow(.3,.3);assert.equal(puts,budgetPuts);await click('仅提交已接受部分');await ready();
  assert.equal(await revision(),budgetBefore+1);assert.equal(puts,budgetPuts+1);assert.deepEqual(await alpha([[.15,.3],[.3,.3]]),[0,255]);
  report.cases.push({name:'budget: native up cannot commit prefix; explicit discard/partial commit',budget,puts:puts-budgetPuts});

  const failBefore=await revision(),failPuts=puts;failNext='none';await dot(.5,.3);await dot(.7,.3);
  await wait(async()=>(await state()).frame.status==='error','none failure');
  await click('把未成功笔迹重新画到当前画面上');await ready();
  assert.equal(await revision(),failBefore+2);assert.equal(puts,failPuts+3);assert.deepEqual(await alpha([[.3,.3],[.5,.3],[.7,.3]]),[255,255,255]);
  report.cases.push({name:'explicit none reapply is a new operation over in-flight success without duplicate replay',puts:puts-failPuts,revisionDelta:2});

  const unknownBefore=await revision(),unknownPuts=puts;failNext='unknown';await dot(.5,.6);
  await wait(async()=>(await state()).frame.status==='error','unknown failure');
  assert.equal((await state()).frame.recovery.retry,false);assert.equal((await state()).frame.recovery.discard,false);
  await click('导出保留笔迹');await wait(()=>exported,'explicit recovery export completed');
  const evidence=JSON.parse(fs.readFileSync(path.join(out,'paint-recovery.json'),'utf8'));
  assert.equal(evidence.entries.length,1);assert.equal(evidence.entries[0].failure.effect,'unknown');assert.equal(evidence.target.shotId,'shot0');assert.ok(evidence.identity.sessionId);assert.equal(evidence.identity.projectId,'admission');
  await click('已保存导出文件，放弃未确认输入');await ready();assert.equal(await revision(),unknownBefore);assert.equal(puts,unknownPuts+1);assert.deepEqual(await alpha([[.5,.6]]),[0]);
  await dot(.7,.6);await ready();assert.equal(await revision(),unknownBefore+1);
  report.cases.push({name:'unknown export + explicit discard restores authority and admits new input',export:path.join(out,'paint-recovery.json'),puts:puts-unknownPuts});

  refuseClose=true;const closeBefore=await revision(),closePuts=puts;
  await holdTransition();assert.equal((await state()).paused,true);await dot(.85,.6);
  assert.equal((await state()).stats.records,0);assert.equal(puts,closePuts);await js('window.__releaseGap()');
  await wait(async()=>(await state()).phase==='active'&&!(await state()).paused,'refused close resumes');
  assert.equal(await revision(),closeBefore);assert.ok(closeCalls.some(c=>c.certified));
  // Re-read actual props after the refusal; beforeTransition may have refreshed.
  await js(`(()=>{let f=document.querySelector('.wb-viewer .image-stage');f=f[Object.keys(f).find(k=>k.startsWith('__reactFiber$'))];for(;f;f=f.return)if(f.memoizedProps?.flow&&f.memoizedProps?.paintInput)window.__editor=f.memoizedProps;return true})()`);
  const calls=closeCalls.length;await holdTransition();
  await js(`(()=>{const p=window.__editor,request=p.flow.request;p.flow.request=async r=>{const result=await request(r);if(r.kind==='freeze'&&result.ok){p.flow.request=request;window.__afterFreezePhase=result.value.snapshot.phase;p.paintInput.connect(()=>{throw Error('synthetic unsubmitted owner obligation after freeze');});}return result;};window.__releaseGap();return true})()`);
  await wait(async()=>(await state()).phase==='active'&&!(await state()).paused,'post-freeze rejection resumes');
  assert.deepEqual(closeCalls.slice(calls),[{certified:false}]);assert.equal(await js('window.__afterFreezePhase'),'frozen');
  await js('window.__editor.paintInput.connect(window.__paint.assertSettled);true');
  await dot(.85,.6);await ready();assert.equal(await revision(),closeBefore+1);
  report.cases.push({name:'close gap rejects new input; post-freeze owner obligation refuses certification; resume works',afterFreezePhase:await js('window.__afterFreezePhase'),closeCalls});
  const switchBefore=await revision(),switchPuts=puts;
  await holdTransition('switch');assert.equal((await state()).paused,true);await dot(.9,.8);assert.equal(puts,switchPuts);assert.equal((await state()).stats.records,0);
  await js('window.__releaseGap()');await wait(()=>js('window.__switchResult==="unchanged"'),'cancelled switch');assert.equal((await state()).paused,false);assert.equal(switchCalls,1);
  await holdTransition('switch');await js(`window.__editor.paintInput.connect(()=>{throw Error('synthetic switch obligation');});window.__releaseGap()`);
  await wait(()=>js('!!window.__switchResult?.error'),'switch post-freeze refusal');assert.equal(switchCalls,1);assert.equal((await state()).paused,false);
  await js('window.__editor.paintInput.connect(window.__paint.assertSettled);true');assert.equal(await revision(),switchBefore);
  report.cases.push({name:'switch gap rejects input; cancel resumes; post-freeze obligation blocks IPC',switchCalls});
  // A failed freeze remains `freezing` in Session; recovery must finish that fence
  // before reopening admission, and must leave the host close request retryable.
  await js(`window.__editor.flow.request({kind:'board',command:{kind:'setScriptText',shotId:'shot0',text:'checkpoint failure probe'}}).then(r=>{if(!r.ok)throw Error(r.error.message);return true})`);
  failCheckpoint=true;const freezeCalls=closeCalls.length;await holdTransition();await js('window.__releaseGap()');
  await wait(async()=>!failCheckpoint&&(await state()).phase==='active'&&!(await state()).paused,'failed freeze explicitly resumes');
  assert.deepEqual(closeCalls.slice(freezeCalls),[{certified:false}]);
  report.cases.push({name:'transient freeze failure completes fence before reopening input',phase:(await state()).phase});
  fs.writeFileSync(path.join(out,'recovery-final.png'),(await win.webContents.capturePage()).toPNG());
})().catch(async error=>{report.error=String(error.stack||error);console.error(report.error);if(win&&!win.isDestroyed()){report.state=await state().catch(()=>null);report.status=await js('document.querySelector(".wb-status")?.innerText');fs.writeFileSync(path.join(out,'recovery-failure.png'),(await win.webContents.capturePage()).toPNG());}}).finally(()=>{
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
  if(!report.error&&win&&!win.isDestroyed()){refuseClose=false;win.close();}else app.exit(report.error?1:0);
});
