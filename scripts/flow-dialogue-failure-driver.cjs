// Electron driver for failure injection and dual-editor recoverability.
//
// Spawned by scripts/flow-dialogue-failure-smoke.mjs. It injects a real Session rejection by
// holding the asset-write IPC channel, which backs up the Session request queue; the next
// dialogue commit is then refused by the Session itself (resource-limit), not by a stub.
// Everything runs in a throwaway project; clipboard and Trash are forbidden.
//
// Two editors of the same board are involved: the always-mounted info-panel editor (owner A)
// and the dialogue track (owner B), which is mounted and focused first. Owner A is driven with
// a synthetic `input` event so focus never leaves B; moving focus would unmount B.
const {app,BrowserWindow,clipboard,shell,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
shell.trashItem=()=>{throw Error('Trash forbidden')};

// Controlled fault injection: while holding, every asset write waits, so queued Session work
// cannot drain and new admissions hit the queue limit.
const gate={hold:false,waiters:[],entered:0};
const register=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,fn)=>register(name,async(...args)=>{
  if(name==='flow-editor:put'&&gate.hold){gate.entered++;await new Promise(resolve=>gate.waiters.push(resolve));}
  return fn(...args);
});
const releaseWrites=()=>{gate.hold=false;for(const resolve of gate.waiters.splice(0))resolve();};

const root=process.env.FLOW_DIALOGUE_ROOT,userData=process.env.FLOW_DIALOGUE_USERDATA;
const run=process.env.FLOW_DIALOGUE_RUN,phase=process.env.FLOW_DIALOGUE_PHASE,entry=process.env.FLOW_DIALOGUE_ENTRY;
const checkpoint=path.join(root,'.storyboard-flow/checkpoints/project.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=()=>JSON.parse(fs.readFileSync(checkpoint,'utf8'));
const lineText=()=>read().dialogues.find(item=>item.id==='line0')?.text;
let win;
const js=code=>win.webContents.executeJavaScript(code);
async function wait(check,label){for(let i=0;i<400;i++){try{if(await check())return}catch{}await delay(50)}throw Error('Timeout '+label)}
const status=()=>js('document.querySelector(".wb-status [role=status]").textContent');
const infoField=()=>js('(()=>{const e=document.querySelector(\'.wb-panel-info .flow-dialogue-text[data-dialogue-id="line0"]\');return e?{value:e.value,start:e.selectionStart}:null})()');
const trackField=()=>js('(()=>{const e=document.querySelector(\'[data-board-id="shot0"] .wb-dialogue-footer textarea\');return e?{value:e.value,start:e.selectionStart}:null})()');
/**
 * Drive one editor without moving focus: React reads the native value setter on `input`.
 * Moving focus is not an option here — the textarea blur would retry the failed owner and the
 * track editor would unmount, destroying the two-owner situation this check needs.
 */
const setFieldValue=async (selector,value)=>{
  await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');'
    +'const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set;'
    +'setter.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await delay(250);
};
const INFO_TEXTAREA = '.wb-panel-info .flow-dialogue-text[data-dialogue-id="line0"]';
const TRACK_TEXTAREA = '[data-board-id="shot0"] .wb-dialogue-footer textarea';
const done=payload=>fs.writeFileSync(path.join(run,phase+'-done.json'),JSON.stringify({phase,ok:true,...payload}));

app.on('window-all-closed',()=>fs.writeFileSync(path.join(run,phase+'-closed.json'),'{}'));
process.argv=[process.argv[0],entry,root,userData,'--workbench'];
import(pathToFileURL(entry).href).then(async()=>{
  await app.whenReady();
  await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');
  win.setSize(1500,1000);
  await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');
  await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("Flow 内已保存")'),'checkpoint');
  await wait(()=>js('!!document.querySelector(".wb-panel-info .flow-dialogue-text[data-dialogue-id=\\"line0\\"]")'),'info dialogue editor');

  if(phase==='reopen'){
    const expected=JSON.parse(fs.readFileSync(path.join(run,'expected.json'),'utf8'));
    assert.deepEqual(read().dialogues,expected.dialogues,'reopen keeps the recovered text');
    assert.ok(!JSON.stringify(read()).includes('"edit"'),'typing metadata is never persisted');
    done({cases:0});
    win.close();
    return;
  }

  const base=lineText();
  assert.equal(typeof base,'string');
  assert.equal((await infoField()).value,base,'info panel shows the stored text');
  const cases=[];

  // Owner B: mount and focus the dialogue track for the same board before anything fails.
  await js('document.querySelector(\'[data-board-id="shot0"] .wb-dialogue-footer button\').click()');
  await wait(()=>js('!!document.querySelector(\'[data-board-id="shot0"] .wb-dialogue-footer textarea\')'),'track editor mounted');
  await wait(()=>js('document.activeElement===(document.querySelector(\'[data-board-id="shot0"] .wb-dialogue-footer textarea\'))'),'track editor focused');
  assert.equal((await trackField()).value,base);

  // 1) Back the Session queue up with real asset writes, then commit owner A's text.
  gate.hold=true;
  await js('(()=>{const b=document.querySelector(\'[aria-label="Add layer"]\');for(let i=0;i<40;i++)b.click()})()');
  await delay(800);
  assert.ok(gate.entered>0,'asset writes are gated');
  await setFieldValue(INFO_TEXTAREA,base+'x');
  await wait(async()=>/Session request queue is full/.test(await status()),'Session rejection surfaced');
  assert.equal((await infoField()).value,base+'x','the failed text stays in owner A\'s editor');
  assert.equal(lineText(),base,'the failed text is not persisted');
  cases.push({case:'Session rejects the commit and the text stays local',revision:read().revision});

  // 2) Close is refused while that obligation exists, and the window is retained.
  win.close();
  await delay(600);
  assert.equal(win.isDestroyed(),false,'close refused after a failed commit');
  assert.match(await status(),/Finish the current dialogue input first/);
  cases.push({case:'close refused while a commit is unsettled'});

  // 3) Drain the queue; the failure is still unsettled afterwards.
  releaseWrites();
  await wait(async()=>(await status()).startsWith('Flow 内已保存'),'queue drained');
  assert.equal((await infoField()).value,base+'x','the failed text is still local after draining');
  assert.equal(lineText(),base,'draining did not silently install the failed text');

  // 4) Owner B (the other editor of the same board) commits successfully. A success for a
  // different owner must not clear owner A's obligation. Driven without focus changes.
  await setFieldValue(TRACK_TEXTAREA,base+'y');
  await wait(()=>lineText()===base+'y','track commit persisted');
  assert.equal((await infoField()).value,base+'x','owner A still holds its unsaved text');
  win.close();
  await delay(600);
  assert.equal(win.isDestroyed(),false,'another owner success does not release the obligation');
  assert.match(await status(),/Finish the current dialogue input first/);
  cases.push({case:'another owner succeeds without clearing the failed obligation',revision:read().revision});

  // 5) Owner A retries its own text; only its own success clears the obligation and allows Close.
  await setFieldValue(INFO_TEXTAREA,base+'xz');
  await wait(()=>lineText()===base+'xz','owner retry persisted');
  assert.equal((await infoField()).value,base+'xz');
  fs.writeFileSync(path.join(run,'expected.json'),JSON.stringify(read()));
  fs.writeFileSync(path.join(run,'cases.json'),JSON.stringify(cases,null,2));
  done({cases:cases.length});
  fs.writeFileSync(path.join(run,phase+'.png'),(await win.webContents.capturePage()).toPNG());
  win.close();
  await wait(()=>win.isDestroyed(),'close after the owner retried');
}).catch(async error=>{
  console.error(error);
  if(win&&!win.isDestroyed()){
    console.error(await status());
    fs.writeFileSync(path.join(run,phase+'-failure.png'),(await win.webContents.capturePage()).toPNG());
  }
  app.exit(1);
});
