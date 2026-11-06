// Isolated dock integration: real Electron pointer input; cancellation and IME guards use explicit events.
const {app,BrowserWindow,clipboard,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
shell.trashItem=()=>{throw Error('Trash forbidden')};
const root=process.env.FLOW_DIALOGUE_ROOT,userData=process.env.FLOW_DIALOGUE_USERDATA,run=process.env.FLOW_DIALOGUE_RUN,phase=process.env.FLOW_DIALOGUE_PHASE,entry=process.env.FLOW_DIALOGUE_ENTRY;
const read=()=>JSON.parse(fs.readFileSync(path.join(root,'.storyboard-flow/checkpoints/project.json'),'utf8'));
let win;const delay=ms=>new Promise(r=>setTimeout(r,ms)),js=c=>win.webContents.executeJavaScript(c);
async function wait(fn,label){for(let i=0;i<200;i++){try{if(await fn())return}catch{}await delay(50)}throw Error('Timeout '+label)}
async function click(label){await js(`document.querySelector('[aria-label="${label}"]').click()`);await delay(150)}
const prefs=()=>js(`JSON.parse(localStorage.getItem('flow.workbench.layout.v2'))`);
const sizes=()=>js(`Object.fromEntries([...document.querySelectorAll('.wb-panel')].filter(e=>getComputedStyle(e).display!=='none').map(e=>[e.dataset.panel,e.getBoundingClientRect().height]))`);
const save=(name,data)=>fs.writeFileSync(path.join(run,name),JSON.stringify(data,null,2));
const dividerFacts=()=>js(`(()=>{const e=document.querySelector('.wb-divider');const r=e.getBoundingClientRect();const dock=e.parentElement.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},dock:{x:dock.x,width:dock.width},tabIndex:e.tabIndex,disabled:e.getAttribute('aria-disabled'),now:e.getAttribute('aria-valuenow'),text:e.getAttribute('aria-valuetext'),label:e.getAttribute('aria-label'),state:e.dataset.collapsed}})()`);
async function geometry(label){await delay(200);const g=await js(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,width:r.width}};return {columns:[...document.querySelectorAll('.wb-column')].map(c=>({rect:rect(c),collapsed:c.classList.contains('is-collapsed'),scroll:c.scrollHeight,client:c.clientHeight,panels:[...c.querySelectorAll(':scope>.wb-panel')].filter(p=>getComputedStyle(p).display!=='none').map(p=>({id:p.dataset.panel,rect:rect(p),resize:getComputedStyle(p).resize}))})),canvas:[...document.querySelectorAll('.wb-panel-canvas .wb-panel-body,.wb-viewer .image-stage')].map(e=>rect(e)),seams:[...document.querySelectorAll('.wb-row-divider')].map(e=>({rect:rect(e),cursor:getComputedStyle(e).cursor})),dock:{rect:rect(document.querySelector('.wb-dock')),scroll:document.querySelector('.wb-dock').scrollWidth,client:document.querySelector('.wb-dock').clientWidth}}})()`);
 g.divider=await dividerFacts();
 for(const c of g.columns){if(c.collapsed){assert.equal(c.rect.width,40);continue;}assert.ok(c.scroll<=c.client+2,label+' column fits');for(const p of c.panels){assert.equal(p.resize,'none');assert.ok(p.rect.bottom<=c.rect.bottom+2,label+' panel fits');}}
 for(const s of g.seams){assert.equal(s.rect.height,5);assert.equal(s.cursor,'row-resize');}
 assert.ok(g.dock.scroll<=g.dock.client+2,label+' dock does not scroll horizontally');
 assert.ok(g.divider.rect.width>=5,label+' divider is reachable');
 assert.ok(g.divider.rect.x>=g.dock.rect.left-1&&g.divider.rect.x<=g.dock.rect.right+1,label+' divider inside dock');
 assert.equal(g.divider.tabIndex,0,label+' divider stays focusable');
 assert.equal(g.divider.disabled,null,label+' divider is never disabled');
 if(g.canvas[1]?.height>0){assert.ok(g.canvas[1].bottom<=g.canvas[0].bottom+2,label+' canvas fit');}
 return {label,...g};}
async function mouse(type,x,y){win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});await delay(90);}
async function dragStart(){
 const r=await js(`(()=>{const e=document.querySelector('[aria-label="调整画布与动作与对白高度"]'),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 for(let attempt=0;attempt<5;attempt++){
  await js(`window.dockPointer=undefined;window.addEventListener('pointerdown',e=>window.dockPointer=e.pointerId,{once:true,capture:true})`);
  await mouse('mouseMove',r.x,r.y);await mouse('mouseDown',r.x,r.y);
  if(await js(`document.querySelector('[aria-label="调整画布与动作与对白高度"]').dataset.resizing==='true'`))return r;
  await mouse('mouseUp',r.x,r.y);await delay(300);
 }
 throw Error('row divider refused the press');
}
const dividerPoint=()=>js(`(()=>{const r=document.querySelector('.wb-divider').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
async function grabDivider(){
 const p=await dividerPoint();
 // The host refuses layout input while a request or gesture is unsettled; wait for the
 // separator to accept the press instead of racing it.
 for(let attempt=0;attempt<5;attempt++){
  await js(`window.dockPointer=undefined;window.addEventListener('pointerdown',e=>window.dockPointer=e.pointerId,{once:true,capture:true})`);
  await mouse('mouseMove',p.x,p.y);await mouse('mouseDown',p.x,p.y);
  if(await js(`document.querySelector('.wb-divider').dataset.resizing==='true'`))return p;
  await mouse('mouseUp',p.x,p.y);await delay(300);
 }
 throw Error('divider refused the press');
}
async function releaseDivider(p,dx=0){await mouse('mouseUp',p.x+dx,p.y);await delay(400);}
// Preferences are written after a debounce; poll instead of assuming one timer tick.
async function prefsWhen(test,label){for(let i=0;i<20;i++){const value=await prefs();if(test(value))return value;await delay(100);}throw Error('preferences did not settle: '+label);}
async function dragDivider(dx,steps){const p=await grabDivider();const count=steps??Math.max(6,Math.ceil(Math.abs(dx)/20));for(let i=1;i<=count;i++){await mouse('mouseMove',p.x+dx*i/count,p.y);}await releaseDivider(p,dx);}
async function moveDivider(dx){const p=await dividerPoint();await mouse('mouseMove',p.x+dx,p.y);}
const collapsedDom=()=>js(`[...document.querySelectorAll('.wb-column')].map(c=>c.classList.contains('is-collapsed'))`);
const keyCodeOf={ArrowLeft:'Left',ArrowRight:'Right',Home:'Home',End:'End'};
async function keyDivider(key,shift=false){const code=keyCodeOf[key]??key;await js(`document.querySelector('.wb-divider').focus()`);win.webContents.sendInputEvent({type:'keyDown',keyCode:code,modifiers:shift?['shift']:[]});win.webContents.sendInputEvent({type:'keyUp',keyCode:code,modifiers:shift?['shift']:[]});await delay(220);}
// Drag distance that reaches 8px past a column's fold threshold. Measured from the live
// columns, because preferences are written after a debounce and can lag the real split.
async function foldDistance(side){const g=await js(`(()=>{const d=document.querySelector('.wb-dock').getBoundingClientRect();const c=[...document.querySelectorAll('.wb-column')].map(x=>x.getBoundingClientRect().width);return {width:d.width,left:c[0],right:c[1]}})()`);
 if(side==='left')return -(g.left-(240-24-8));
 return g.right-(260-24-8);}
app.on('window-all-closed',()=>save(phase+'-closed.json',{}));
process.argv=[process.argv[0],entry,root,userData,'--workbench'];
import(pathToFileURL(entry).href).then(async()=>{
 await app.whenReady();await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');win.setSize(1500,950);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("已自动暂存")'),'checkpoint');
 // The folder check runs a request of its own; layout input is refused until it settles.
 await wait(()=>js('!document.querySelector(".wb-status [role=status]").textContent.includes("正在")'),'idle');await delay(400);
 if(phase==='reopen'){
  assert.deepEqual(read(),JSON.parse(fs.readFileSync(path.join(run,'expected.json'))));assert.deepEqual((await prefs()).collapsed,[true,true]);
  assert.equal(await js(`document.querySelectorAll('.wb-column.is-collapsed').length`),2);
  assert.equal(await js(`[...document.querySelectorAll('.wb-panel')].filter(e=>getComputedStyle(e).display!=='none').length`),0);
  assert.equal((await dividerFacts()).text,'两栏已折叠');
  // A saved double fold is restored from the separator alone, with no permanent buttons.
  await keyDivider('ArrowRight');await keyDivider('ArrowLeft');
  const expected=JSON.parse(fs.readFileSync(path.join(run,'expected-heights.json')));const current=await sizes();for(const k of Object.keys(expected))assert.ok(Math.abs(expected[k]-current[k])<2,'restored '+k);
  await geometry('reopen expanded');save(phase+'-done.json',{ok:true,phase});win.close();return;
 }
 const cases=[],before=read();const selectedBefore=await js(`document.querySelector('.wb-card.is-selected')?.dataset.boardId??null`);
 assert.equal(await js(`document.querySelectorAll('.wb-column-cap').length`),0,'no permanent fold buttons');
 cases.push(await geometry('default'));const initial=await sizes();
 const at=await dragStart();await mouse('mouseMove',at.x,at.y+45);const preview=await sizes();assert.ok(preview.canvas>initial.canvas+40);assert.ok(preview.info<initial.info-40);assert.ok(Math.abs(preview.layers-initial.layers)<1);assert.deepEqual((await prefs()).heights,{});
 await mouse('mouseUp',at.x,at.y+45);await delay(200);const committed=await sizes();assert.ok(Math.abs(committed.canvas-preview.canvas)<2);assert.ok((await prefs()).heights.canvas>initial.canvas+40);
 const stored=JSON.stringify((await prefs()).heights);
 // Esc cancellation must survive an accidental arrow key during the pointer gesture.
 const cancel=await dragStart();await mouse('mouseMove',cancel.x,cancel.y-30);win.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await mouse('mouseUp',cancel.x,cancel.y-30);assert.equal(JSON.stringify((await prefs()).heights),stored);assert.ok(Math.abs((await sizes()).canvas-committed.canvas)<2);
 const blur=await dragStart();await mouse('mouseMove',blur.x,blur.y+25);await js(`window.dispatchEvent(new Event('blur'))`);await mouse('mouseUp',blur.x,blur.y+25);assert.equal(JSON.stringify((await prefs()).heights),stored);
 const ptr=await dragStart();await mouse('mouseMove',ptr.x,ptr.y+25);await js(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.dockPointer}))`);await mouse('mouseUp',ptr.x,ptr.y+25);assert.equal(JSON.stringify((await prefs()).heights),stored);
 // Keyboard-only adjustment commits one step; column arrows must not navigate storyboards.
 const selected=await js(`document.querySelector('.wb-card.is-selected').dataset.boardId`);await js(`document.querySelector('.wb-row-divider').focus()`);win.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});await delay(200);assert.equal(await js(`document.querySelector('.wb-card.is-selected').dataset.boardId`),selected);
 const expanded=await sizes();
 // ---- horizontal divider: resize, fold, same-gesture restore, cancel ----
 const splitBase=(await prefs()).split;
 await dragDivider(70);const widerLeft=await prefsWhen(v=>v.split>splitBase+2,'drag right widens the left column');
 await delay(300);assert.equal((await prefs()).split,widerLeft.split,'pointerup result is not rolled back by its release event');assert.deepEqual(widerLeft.collapsed,[false,false]);assert.deepEqual(read(),before,'resizing writes no project state');
 await dragDivider(-70);const widerRight=await prefsWhen(v=>v.split<widerLeft.split-2,'drag left widens the right column');assert.deepEqual(widerRight.collapsed,[false,false]);
 const beforeReverse=JSON.stringify(await prefs());
 // Recompute the fold distance for every gesture: the split moves, and the pointer target
 // must stay inside the window.
 const leftDx=await foldDistance('left');
 const p=await grabDivider();
 await mouse('mouseMove',p.x+leftDx,p.y);
 assert.deepEqual(await collapsedDom(),[true,false],'past the band folds the left column mid-drag');
 // Reversing inside the same gesture restores it without releasing capture.
 await mouse('mouseMove',p.x+leftDx+36,p.y);assert.deepEqual(await collapsedDom(),[false,false],'reversing the same drag unfolds');
 await releaseDivider(p,leftDx+36);assert.deepEqual((await prefs()).collapsed,[false,false]);assert.deepEqual(read(),before);
 // Escape rolls the whole gesture back, including a fold.
 const cancelSplit=JSON.stringify(await prefs());
 const cancelDx=await foldDistance('left');
 const cp=await grabDivider();
 await mouse('mouseMove',cp.x+cancelDx,cp.y);assert.deepEqual(await collapsedDom(),[true,false]);
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(120);
 assert.deepEqual(await collapsedDom(),[false,false],'Escape restores the pre-drag layout');await mouse('mouseUp',cp.x+cancelDx,cp.y);await delay(200);
 assert.equal(JSON.stringify(await prefs()),cancelSplit,'cancelled drag is not persisted');
 // Pointer cancellation does the same.
 const pointerDx=await foldDistance('left');const pp=await grabDivider();await mouse('mouseMove',pp.x+pointerDx,pp.y);const pid=await js('window.dockPointer');await js(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:${pid}}))`);await delay(120);assert.deepEqual(await collapsedDom(),[false,false]);await mouse('mouseUp',pp.x+pointerDx,pp.y);
 // Window blur and a lost capture restore too, and neither one writes the profile.
 const blurDx=await foldDistance('left');const bp=await grabDivider();await mouse('mouseMove',bp.x+blurDx,bp.y);await js(`window.dispatchEvent(new Event('blur'))`);await delay(150);assert.deepEqual(await collapsedDom(),[false,false],'blur restores the pre-drag layout');await mouse('mouseUp',bp.x+blurDx,bp.y);await delay(200);assert.equal(JSON.stringify(await prefs()),cancelSplit);
 const lostDx=await foldDistance('left');const lp=await grabDivider();await mouse('mouseMove',lp.x+lostDx,lp.y);const lid=await js('window.dockPointer');await js(`document.querySelector('.wb-divider').dispatchEvent(new PointerEvent('lostpointercapture',{pointerId:${lid}}))`);await delay(150);assert.deepEqual(await collapsedDom(),[false,false],'lost capture restores the pre-drag layout');await mouse('mouseUp',lp.x+lostDx,lp.y);await delay(200);assert.equal(JSON.stringify(await prefs()),cancelSplit);
 // A layout key during a pointer drag must not end the gesture or write the profile; a
 // second pointerdown must not stack another gesture on top.
 const keyGuardStart=JSON.stringify(await prefs());
 const startSplit=(await prefs()).split;
 const kg=await grabDivider();
 await mouse('mouseMove',kg.x+60,kg.y);
 const previewValue=await js(`document.querySelector('.wb-divider').getAttribute('aria-valuenow')`);
 await mouse('mouseDown',kg.x+60,kg.y);
 assert.equal(await js(`document.querySelector('.wb-divider').dataset.resizing`),'true','a second down keeps the original gesture');
 await keyDivider('Home');await keyDivider('End');await keyDivider('ArrowRight',true);await keyDivider('ArrowLeft');
 assert.deepEqual(await collapsedDom(),[false,false],'layout keys are ignored while the pointer owns the layout');
 assert.equal(await js(`document.querySelector('.wb-divider').getAttribute('aria-valuenow')`),previewValue,'keys do not move the pointer preview');
 await delay(350);
 assert.equal(JSON.stringify(await prefs()),keyGuardStart,'no write while the pointer gesture is active');
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await delay(150);
 assert.deepEqual(await collapsedDom(),[false,false],'Escape still cancels during a drag');
 assert.equal(await js(`document.querySelector('.wb-divider').getAttribute('aria-valuenow')`),String(Math.round(startSplit)),'Escape restores the pre-drag width');
 await mouse('mouseUp',kg.x+60,kg.y);await delay(250);
 assert.equal(JSON.stringify(await prefs()),keyGuardStart,'the cancelled drag never reaches the profile');
 // A normal pointerup still commits exactly once.
 const commitDx=40;await dragDivider(commitDx);const committedSplit=(await prefs()).split;
 assert.ok(committedSplit>startSplit+1,'an ordinary drag commits');await delay(400);
 assert.equal((await prefs()).split,committedSplit,'the committed value is stable');
 // Fold the right column by dragging well past its minimum.
 const rightDx=await foldDistance('right');await dragDivider(rightDx);assert.deepEqual((await prefs()).collapsed,[false,true]);cases.push(await geometry('right collapsed'));
 assert.equal(await js(`document.querySelectorAll('[data-dock-column="1"] .wb-dock-icons button').length`),3);
 await click('打开画布面板');cases.push(await geometry('canvas flyout'));fs.writeFileSync(path.join(run,'canvas-flyout.png'),(await win.webContents.capturePage()).toPNG());
 await click('打开动作与对白面板');assert.equal(await js(`getComputedStyle(document.querySelector('[data-panel="canvas"]')).display`),'none');assert.notEqual(await js(`getComputedStyle(document.querySelector('[data-panel="info"]')).display`),'none');
 // Explicit composition event verifies the host's navigation guard without claiming OS IME coverage.
 await js(`document.querySelector('[data-panel="info"] textarea.flow-dialogue-text').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`);
 await keyDivider('ArrowLeft');assert.deepEqual(await collapsedDom(),[false,true],'composition blocks the separator shortcut');
 await js(`document.querySelector('[data-panel="info"] textarea.flow-dialogue-text').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}))`);await delay(250);
 await click('关闭动作与对白');await keyDivider('ArrowLeft');assert.deepEqual(await collapsedDom(),[false,false]);const restored=await sizes();for(const k of Object.keys(expanded))assert.ok(Math.abs(expanded[k]-restored[k])<2,'restore expanded '+k);
 // Keyboard: fold both with Home/End, then unfold from the separator alone.
 await keyDivider('Home');await keyDivider('End');cases.push(await geometry('both collapsed'));assert.equal((await dividerFacts()).text,'两栏已折叠');
 fs.writeFileSync(path.join(run,'both-collapsed.png'),(await win.webContents.capturePage()).toPNG());
 await click('打开图层面板');assert.equal(await js(`document.querySelectorAll('[data-dock-column="0"] .wb-dock-icons button').length`),2);await click('关闭图层');
 win.setSize(1000,650);cases.push(await geometry('short both collapsed'));
 await keyDivider('ArrowRight');await keyDivider('ArrowLeft');assert.deepEqual(await collapsedDom(),[false,false]);cases.push(await geometry('short expanded'));
 win.setSize(1500,950);await delay(250);
 // Arrow keys resize by 2 and stay inside the accepted preference range.
 await keyDivider('ArrowRight',true);const afterKeys=await prefs();assert.ok(afterKeys.split<=75);assert.deepEqual(afterKeys.collapsed,[false,false]);
 await dragDivider(await foldDistance('left'));assert.deepEqual((await prefs()).collapsed,[true,false]);
 await keyDivider('ArrowRight');assert.deepEqual((await prefs()).collapsed,[false,false]);
 const finalHeights=await sizes();await keyDivider('Home');await keyDivider('End');await delay(250);
 assert.deepEqual(read(),before,'layout must not write project state');
 assert.equal(await js(`document.querySelector('.wb-card.is-selected')?.dataset.boardId??null`),selectedBefore,'layout keeps the board selection');
 save('expected.json',before);save('expected-heights.json',finalHeights);save('cases.json',cases);save(phase+'-done.json',{ok:true,phase});win.close();
}).catch(async e=>{console.error(e);if(win&&!win.isDestroyed()){console.error(await js('document.body.innerText'));fs.writeFileSync(path.join(run,'failure.png'),(await win.webContents.capturePage()).toPNG());win.destroy();}app.exit(1)});
