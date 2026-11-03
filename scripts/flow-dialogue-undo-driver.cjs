// Electron driver for the dialogue undo-grouping smoke check. Spawned by
// scripts/flow-dialogue-undo-smoke.mjs; it never touches real user data.
const {app,BrowserWindow,clipboard,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
shell.trashItem=()=>{throw Error('Trash forbidden')};

const root=process.env.FLOW_DIALOGUE_ROOT,userData=process.env.FLOW_DIALOGUE_USERDATA;
const run=process.env.FLOW_DIALOGUE_RUN,phase=process.env.FLOW_DIALOGUE_PHASE,entry=process.env.FLOW_DIALOGUE_ENTRY;
const ime=process.env.FLOW_DIALOGUE_IME==='1';
const checkpoint=path.join(root,'.storyboard-flow/checkpoints/project.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const read=()=>JSON.parse(fs.readFileSync(checkpoint,'utf8'));
const dialogueText=id=>read().dialogues.find(item=>item.id===id)?.text;
let win;
const js=code=>win.webContents.executeJavaScript(code);
async function wait(check,label){for(let i=0;i<400;i++){try{if(await check())return}catch{}await delay(50)}throw Error('Timeout '+label)}
async function button(label){
  await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==='+JSON.stringify(label)+').click()');
  await delay(150);
}
async function selectBoard(id){await js('document.querySelector(\'[aria-label="选择故事板 '+id+'"]\').click()');await delay(150);}
async function focusDialogue(id){
  await js('(()=>{const e=document.querySelector(\'.wb-panel-info .flow-dialogue-text[data-dialogue-id="'+id+'"]\');e.focus();e.setSelectionRange(e.value.length,e.value.length);})()');
  await delay(80);
}
/** One character per event: insertText would be a single input and would hide per-key grouping. */
async function typeChars(text,gap){for(const ch of text){win.webContents.sendInputEvent({type:'char',keyCode:ch});await delay(gap);}}
/** The info-panel textarea's value and selection, read from the DOM, not from the project. */
const field=()=>js('(()=>{const e=document.querySelector(\'.wb-panel-info .flow-dialogue-text[data-dialogue-id="line0"]\');return e?{value:e.value,start:e.selectionStart,end:e.selectionEnd}:null})()');
/** Poll without throwing: used where a CDP commit may need a second attempt. */
const commits=async expected=>{for(let i=0;i<20;i++){if(dialogueText('line0')===expected)return true;await delay(100)}return false};
/**
 * Commit the open composition. Chromium's insertText usually finishes it; Enter confirms the
 * candidate when it does not. Enter cannot split the block here because the editor ignores
 * structural keys while composing.
 */
const finishComposition=async (text,base)=>{
  await win.webContents.debugger.sendCommand('Input.insertText',{text});
  if(await commits(base+text))return;
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await win.webContents.debugger.sendCommand('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,nativeVirtualKeyCode:13});
  await wait(()=>dialogueText('line0')===base+text,'composition commit');
};
/** Composition must start at the end of the text and stay uncommitted past the checkpoint debounce. */
const startComposition=async candidate=>{
  await focusDialogue('line0');
  await js(`(()=>{if(window.flowImeEvents)return;window.flowImeEvents=[];for(const type of ['compositionstart','compositionupdate','compositionend','beforeinput','input','focusout'])document.addEventListener(type,e=>{if(e.target.tagName==='TEXTAREA')window.flowImeEvents.push({type,data:e.data,inputType:e.inputType,isComposing:e.isComposing,value:e.target.value,start:e.target.selectionStart,end:e.target.selectionEnd});},true);})()`);
  const before=await field();
  assert.equal(before.start,before.value.length,'caret sits at the end before composing');
  assert.equal(before.end,before.value.length,'no selection before composing');
  const revision=read().revision;
  // Explicit replacement offsets use the confirmed end of the textarea. The
  // composition selection stays inside the candidate text (0..candidate.length).
  await win.webContents.debugger.sendCommand('Input.imeSetComposition',{text:candidate,
    selectionStart:candidate.length,selectionEnd:candidate.length,replacementStart:before.start,replacementEnd:before.end});
  // Beyond the 600ms autosave debounce: a committed candidate would already be in the checkpoint.
  await delay(950);
  const during=await field();
  assert.ok(during.value.includes(candidate),'the candidate stays in the textarea');
  assert.equal(read().revision,revision,'no revision while composing');
  assert.ok(!JSON.stringify(read()).includes(candidate),'candidates are not persisted');
  return before.value;
};

const undo=async check=>{await button('撤销');await wait(check,'undo '+run);};
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
    assert.deepEqual(read().dialogues,expected.dialogues,'reopened project keeps the committed text');
    assert.ok(!JSON.stringify(read()).includes('"edit"'),'typing metadata is never persisted');
    await js('document.querySelector(".wb-panel-info .flow-dialogue-text").focus()');
    fs.writeFileSync(path.join(run,phase+'-done.json'),JSON.stringify({phase,ok:true,cases:0}));
    win.close();
    return;
  }

  const base=dialogueText('line0');
  assert.equal(typeof base,'string');
  const cases=[];
  const expectText=(value,label)=>{const current=dialogueText('line0');assert.equal(current,value,label+' (got '+JSON.stringify(current)+')');};

  // 1) Fast typing inside the window is one undo step.
  await focusDialogue('line0');
  await typeChars('abc',120);
  await wait(()=>dialogueText('line0')===base+'abc','fast typing persisted');
  await delay(900);
  await undo(()=>dialogueText('line0')===base);
  expectText(base,'one undo removed the whole run');
  cases.push({case:'fast typing (120ms gaps) is one undo step',revision:read().revision});

  // 2) A pause longer than the window starts a new step.
  await focusDialogue('line0');
  await typeChars('de',120);
  await delay(1000);
  await typeChars('f',120);
  await wait(()=>dialogueText('line0')===base+'def','typing after a pause persisted');
  await undo(()=>dialogueText('line0')===base+'de');
  await undo(()=>dialogueText('line0')===base);
  cases.push({case:'a >window pause splits the run',revision:read().revision});

  // 3) A caret jump ends the run even though the text is unchanged. The caret is moved to the
  // start, so the next character is inserted before the text: 'h' + base + 'g'.
  await focusDialogue('line0');
  await typeChars('g',120);
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Home'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Home'});
  await wait(async()=>{const value=await field();return value.start===0&&value.end===0;},'keyboard moved caret to start');
  await delay(150);
  await typeChars('h',120);
  await wait(()=>dialogueText('line0')==='h'+base+'g','typing at the jumped caret persisted');
  await undo(()=>dialogueText('line0')===base+'g');
  await undo(()=>dialogueText('line0')===base);
  cases.push({case:'caret jump starts a new step',revision:read().revision});

  // 4) Cmd+Z inside the textarea routes to Session history (whole run).
  await focusDialogue('line0');
  await typeChars('ij',100);
  await wait(()=>dialogueText('line0')===base+'ij','typing before the shortcut persisted');
  await js('document.querySelector(\'.wb-panel-info .flow-dialogue-text[data-dialogue-id="line0"]\').dispatchEvent(new KeyboardEvent("keydown",{key:"z",metaKey:true,bubbles:true}))');
  await wait(()=>dialogueText('line0')===base,'textarea Cmd+Z undid the run');
  cases.push({case:'textarea Cmd+Z undoes the run',revision:read().revision});

  // 5) A to B to A: the remounted editor starts a fresh run.
  await focusDialogue('line0');
  await typeChars('k',110);
  await selectBoard('shot1');
  await selectBoard('shot0');
  await focusDialogue('line0');
  await typeChars('m',110);
  await wait(()=>dialogueText('line0')===base+'km','typing after the board round trip persisted');
  await undo(()=>dialogueText('line0')===base+'k');
  await undo(()=>dialogueText('line0')===base);
  cases.push({case:'A to B to A splits the run',revision:read().revision});

  // 6) IME candidates stay local; the committed text is one step. Opt-in: the exact CDP
  // composition sequence still needs a real-input-method check on the target machine.
  if(ime){
    win.webContents.debugger.attach('1.3');
    await startComposition('nihao');
    await finishComposition('你好',base);
    const committed=await field();
    assert.equal(committed.value,base+'你好','composition installs the final text at the end');
    assert.equal(committed.start,(base+'你好').length,'caret after the committed text');
    await delay(900);
    await undo(()=>dialogueText('line0')===base);
    win.webContents.debugger.detach();
    cases.push({case:'IME candidates stay local and commit once',revision:read().revision});
  }

  // 7) Closing while composing is refused and the window is retained. Opt-in with the IME run.
  if(ime){
    win.webContents.debugger.attach('1.3');
    await startComposition('zhong');
    win.close();
    await delay(400);
    assert.equal(win.isDestroyed(),false,'close refused while the IME candidate is open');
    await finishComposition('中',base);
    const committed=await field();
    assert.equal(committed.value,base+'中','the final text is committed at the end');
    assert.equal(committed.start,(base+'中').length,'caret after the committed text');
    await delay(900);
    win.webContents.debugger.detach();
    cases.push({case:'close refused while composing, accepted after commit',revision:read().revision});
  }

  assert.ok(!JSON.stringify(read()).includes('"edit"'),'typing metadata is never persisted');
  fs.writeFileSync(path.join(run,'expected.json'),JSON.stringify(read()));
  fs.writeFileSync(path.join(run,'cases.json'),JSON.stringify(cases,null,2));
  fs.writeFileSync(path.join(run,'ime-events.json'),JSON.stringify(await js('window.flowImeEvents||[]'),null,2));
  fs.writeFileSync(path.join(run,phase+'-done.json'),JSON.stringify({phase,ok:true,cases:cases.length}));
  fs.writeFileSync(path.join(run,phase+'.png'),(await win.webContents.capturePage()).toPNG());
  win.close();
}).catch(async error=>{
  console.error(error);
  if(win&&!win.isDestroyed()){
    fs.writeFileSync(path.join(run,'ime-events.json'),JSON.stringify(await js('window.flowImeEvents||[]'),null,2));
    console.error(await js('document.body.innerText'));
    fs.writeFileSync(path.join(run,phase+'-failure.png'),(await win.webContents.capturePage()).toPNG());
  }
  app.exit(1);
});
