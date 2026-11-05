// Real Session + native choice buttons + normal Close/reopen. Synthetic paths only.
const {app,BrowserWindow,clipboard,shell,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const repo=process.env.FLOW_REPO,root=process.env.FLOW_ROOT,out=process.env.FLOW_OUT,phase=process.env.FLOW_PAINT_PHASE;
if(!root.startsWith(path.join(fs.realpathSync(require('node:os').tmpdir()),'flow-paint-presentation-'))||!['none','unknown','unknown-reopen','retained','retained-reopen'].includes(phase))throw Error('isolated paths/phase required');
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard prohibited');};
shell.trashItem=()=>{throw Error('Trash prohibited');};
const delay=ms=>new Promise(r=>setTimeout(r,ms)),effect=phase.split('-')[0],reopen=phase.endsWith('-reopen');
const report={phase,puts:0,close:[],normalClosed:false,error:null};let failNext,win,exported=false;
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{
  if(name==='flow-editor:put'){
    report.puts++;const failure=failNext;failNext=undefined;await delay(700);
    if(failure==='none')return {ok:false,error:{code:'io-failure',message:'synthetic none paint refusal',effect:failure}};
    const result=await fn(...args);
    if(failure)return {ok:false,error:{code:'io-failure',message:`synthetic ${failure} paint acknowledgement`,effect:failure}};
    return result;
  }
  const result=await fn(...args);
  // Observe the original host certifier; never replace, null, or approve its input.
  if(name==='flow-editor:finish-close')report.close.push({project:args[3],result});
  return result;
});
const slot=app.isPackaged?1:2;process.argv[slot]=root;process.argv[slot+1]=path.join(out,'userData');
const receipt=()=>fs.writeFileSync(path.join(out,phase+'-result.json'),JSON.stringify(report,null,2));
const js=async code=>{const value=await win.webContents.executeJavaScript(`Promise.resolve().then(()=>eval(${JSON.stringify(code)})).catch(e=>({__probeError:String(e.stack||e)}))`);if(value?.__probeError)throw Error(value.__probeError);return value;};
const wait=async(fn,label)=>{for(let i=0;i<700;i++){if(await fn())return;await delay(20);}throw Error('timeout '+label);};
const snapshot=()=>js('window.__editor.flow.snapshot()');
const readInstalled=()=>js(`(async()=>{const s=window.__editor.flow.snapshot(),image=s.project.images.image0,assetId=image.layers.find(l=>l.id==='ink').assetId,r=await window.__editor.api.read(assetId);if(!r.ok)throw Error(r.error.message);return{project:s.project,lastError:s.lastError,assetId,png:Array.from(r.value)}})()`);
const ready=()=>wait(()=>js('window.__paint.frame().status==="ready"&&window.__paint.stats().records===0'),'presentation settled');
async function click(text){
  const r=await js(`(()=>{const b=Array.from(document.querySelectorAll('.wb-viewer button')).find(b=>b.textContent===${JSON.stringify(text)});if(!b||b.disabled)throw Error('unavailable button');const r=b.getBoundingClientRect();if(r.width<=0||r.height<=0)throw Error('invisible choice');return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for(const type of ['mouseDown','mouseUp']){win.webContents.sendInputEvent({type,x:Math.round(r.x),y:Math.round(r.y),button:'left',clickCount:1});await delay(20);}
}
const display=()=>js(`Array.from(document.querySelectorAll('.wb-viewer [data-paint-layer="ink"]')).map(c=>({width:c.width,height:c.height,status:c.dataset.paintStatus,staticDisplay:getComputedStyle(c.parentElement.querySelector('.paint-static-layer')).display}))`);
(async()=>{
  await import(pathToFileURL(path.join(repo,'dist-electron/platform/main/flowEditorEntry.js')).href);await app.whenReady();
  await wait(()=>!!(win=BrowserWindow.getAllWindows()[0]),'window');win.setSize(1400,1000);
  win.once('closed',()=>{report.normalClosed=true;receipt();});
  win.webContents.session.on('will-download',(_event,item)=>{assert.equal(item.getFilename(),'paint-recovery.json');item.setSavePath(path.join(out,effect+'-recovery.json'));item.once('done',(_event,state)=>{exported=state==='completed';});});
  await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');
  await wait(()=>js('document.querySelector(".wb-status")?.innerText.includes("已自动暂存")'),'checkpoint');
  await js(`(()=>{const node=document.querySelector('.wb-viewer .image-stage');let f=node[Object.keys(node).find(k=>k.startsWith('__reactFiber$'))];for(;f;f=f.return){const p=f.memoizedProps;if(p?.paintPresentation)window.__paint=p.paintPresentation;if(p?.flow&&p?.paintInput)window.__editor=p;}if(!window.__paint||!window.__editor)throw Error('mounted owners not found');return true})()`);
  await js(fs.readFileSync(path.join(out,'raster-check.js'),'utf8')+';window.PaintRasterCheck=PaintRasterCheck;true');
  const start=await readInstalled();
  if(reopen){
    const expected=JSON.parse(fs.readFileSync(path.join(out,effect+'-expected.json'),'utf8'));
    assert.deepEqual(start.project,expected.project);assert.deepEqual(start.png,expected.png);assert.equal(report.puts,0);
    const evidence=JSON.parse(fs.readFileSync(path.join(out,effect+'-recovery.json'),'utf8'));assert.equal(evidence.entries[0].failure.effect,effect);
    report.staticPixels=await js(`(async()=>{const node=document.querySelector('.wb-viewer [data-paint-layer="ink"]').parentElement.querySelector('.paint-static-layer img');await node.decode();if(getComputedStyle(node).visibility!=='visible')await new Promise(r=>requestAnimationFrame(r));if(getComputedStyle(node).visibility!=='visible')throw Error('static image hidden');const c=document.createElement('canvas');c.width=640;c.height=360;c.getContext('2d').drawImage(node,0,0);const result=await PaintRasterCheck.comparePaintSequence(new Uint8Array(${JSON.stringify(start.png)}),640,360,[],c);c.width=0;return result})()`);
    assert.equal(report.staticPixels.differences,0);report.evidenceRetained=true;report.projectPreserved=true;
  }else{
    await js(`window.__base=new Uint8Array(${JSON.stringify(start.png)});window.__strokes=PaintRasterCheck.recoveryContractStrokes();true`);
    failNext=effect;
    // Exact same fixed inputs feed mounted owner and independent committed oracle.
    await js(`(()=>{for(const s of window.__strokes){if(!window.__paint.begin('shot0','ink',s))throw Error('stroke rejected');window.__paint.end(s.id);}return true})()`);
    await wait(()=>js('window.__paint.frame().status==="error"&&window.__editor.flow.snapshot().pending===0'),'failed A and successful B settled');
    const beforeChoice=await readInstalled(),shown=await display();assert.equal(report.puts,2);assert.equal(beforeChoice.project.revision,start.project.revision+1);
    report.savedB=await js(`PaintRasterCheck.comparePaintSequence(window.__base,640,360,[window.__strokes[1]],new Uint8Array(${JSON.stringify(beforeChoice.png)}))`);assert.equal(report.savedB.differences,0);
    report.bChangedPixels=await js(`PaintRasterCheck.comparePaintSequence(window.__base,640,360,[],new Uint8Array(${JSON.stringify(beforeChoice.png)}))`);assert.ok(report.bChangedPixels.differences>0);
    await delay(120);assert.deepEqual(await readInstalled(),beforeChoice);assert.deepEqual(await display(),shown);assert.equal(report.puts,2);
    const choiceText=await js('document.querySelector(".wb-viewer .paint-decisions").innerText');report.choiceText=choiceText;report.beforeChoiceUnchanged=true;
    fs.writeFileSync(path.join(out,phase+'-choice.png'),(await win.webContents.capturePage()).toPNG());
    if(effect==='none'){
      assert.ok(choiceText.includes('后续成功的笔迹已经保存；重新绘制失败笔迹会把它们放在当前画面最上面，原来的先后顺序可能改变（例如先画后擦）'));
      assert.ok(choiceText.includes('把未成功笔迹重新画到当前画面上'));
      await click('把未成功笔迹重新画到当前画面上');await ready();const chosen=await readInstalled();
      assert.equal(report.puts,3);assert.equal(chosen.project.revision,start.project.revision+2);
      report.chosenBA=await js(`PaintRasterCheck.comparePaintSequence(window.__base,640,360,[window.__strokes[1],window.__strokes[0]],window.__paint.frame().canvas)`);
      report.installedBA=await js(`PaintRasterCheck.comparePaintSequence(window.__base,640,360,[window.__strokes[1],window.__strokes[0]],new Uint8Array(${JSON.stringify(chosen.png)}))`);
      report.originalAB=await js(`PaintRasterCheck.comparePaintSequence(window.__base,640,360,window.__strokes,new Uint8Array(${JSON.stringify(chosen.png)}))`);
      assert.equal(report.chosenBA.differences,0);assert.equal(report.installedBA.differences,0);assert.ok(report.originalAB.differences>0,'fixture must distinguish original A-B from explicitly chosen B-A');
      report.newOperationChosen=true;
    }else{
      assert.equal(beforeChoice.lastError.effect,effect);assert.ok(choiceText.includes('放弃的只是未确认输入，不会撤销已经保存的画面；原始错误仍保留'));
      assert.ok(!choiceText.includes('把未成功笔迹重新画到当前画面上'));
      await click('导出保留笔迹');await wait(()=>exported,'evidence download completed');
      const evidence=JSON.parse(fs.readFileSync(path.join(out,effect+'-recovery.json'),'utf8'));
      assert.equal(evidence.entries.length,1);assert.equal(evidence.entries[0].failure.effect,effect);assert.equal(evidence.entries[0].stroke.id,'contract-A');
      await click('已保存导出文件，放弃未确认输入');await ready();const after=await readInstalled();
      assert.deepEqual(after,beforeChoice);assert.equal(report.puts,2);
      report.afterDiscard=await js(`PaintRasterCheck.comparePaintSequence(window.__base,640,360,[window.__strokes[1]],window.__paint.frame().canvas)`);assert.equal(report.afterDiscard.differences,0);
      report.originalError=after.lastError;report.status=await js('document.querySelector(".wb-status").innerText');assert.ok(report.status.includes(after.lastError.message));
      fs.writeFileSync(path.join(out,effect+'-expected.json'),JSON.stringify(after));report.projectPreserved=true;
    }
  }
  const expected=(await snapshot()).project;report.expectedProject=expected;
  // Actual native close, original finishClose certification, then next process reopens.
  // There is no app.exit success path and no certifier substitution in this driver.
  win.close();await wait(()=>win.isDestroyed(),'normal certified close');
})().catch(error=>{report.error=String(error.stack||error);console.error(report.error);receipt();app.exit(1);});
