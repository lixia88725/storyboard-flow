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
async function geometry(label){await delay(200);const g=await js(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height,width:r.width}};return {columns:[...document.querySelectorAll('.wb-column')].map(c=>({rect:rect(c),collapsed:c.classList.contains('is-collapsed'),scroll:c.scrollHeight,client:c.clientHeight,panels:[...c.querySelectorAll(':scope>.wb-panel')].filter(p=>getComputedStyle(p).display!=='none').map(p=>({id:p.dataset.panel,rect:rect(p),resize:getComputedStyle(p).resize}))})),canvas:[...document.querySelectorAll('.wb-panel-canvas .wb-panel-body,.wb-viewer .image-stage')].map(e=>rect(e)),seams:[...document.querySelectorAll('.wb-row-divider')].map(e=>({rect:rect(e),cursor:getComputedStyle(e).cursor}))}})()`);
 for(const c of g.columns){if(c.collapsed){assert.equal(c.rect.width,40);continue;}assert.ok(c.scroll<=c.client+2,label+' column fits');for(const p of c.panels){assert.equal(p.resize,'none');assert.ok(p.rect.bottom<=c.rect.bottom+2,label+' panel fits');}}
 for(const s of g.seams){assert.equal(s.rect.height,5);assert.equal(s.cursor,'row-resize');}
 if(g.canvas[1]?.height>0){assert.ok(g.canvas[1].bottom<=g.canvas[0].bottom+2,label+' canvas fit');}
 return {label,...g};}
async function mouse(type,x,y){win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});await delay(90);}
async function dragStart(){const r=await js(`(()=>{const e=document.querySelector('[aria-label="调整画布与动作与对白高度"]'),r=e.getBoundingClientRect();window.dockPointer=undefined;window.addEventListener('pointerdown',e=>window.dockPointer=e.pointerId,{once:true});return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);await mouse('mouseMove',r.x,r.y);await mouse('mouseDown',r.x,r.y);return r;}
app.on('window-all-closed',()=>save(phase+'-closed.json',{}));
process.argv=[process.argv[0],entry,root,userData,'--workbench'];
import(pathToFileURL(entry).href).then(async()=>{
 await app.whenReady();await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');win.setSize(1500,950);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("已自动暂存")'),'checkpoint');
 if(phase==='reopen'){
  assert.deepEqual(read(),JSON.parse(fs.readFileSync(path.join(run,'expected.json'))));assert.deepEqual((await prefs()).collapsed,[true,true]);
  assert.equal(await js(`document.querySelectorAll('.wb-column.is-collapsed').length`),2);
  assert.equal(await js(`[...document.querySelectorAll('.wb-panel')].filter(e=>getComputedStyle(e).display!=='none').length`),0);
  await click('展开左栏');await click('展开右栏');const expected=JSON.parse(fs.readFileSync(path.join(run,'expected-heights.json')));const current=await sizes();for(const k of Object.keys(expected))assert.ok(Math.abs(expected[k]-current[k])<2,'restored '+k);
  await geometry('reopen expanded');save(phase+'-done.json',{ok:true,phase});win.close();return;
 }
 const cases=[],before=read();cases.push(await geometry('default'));const initial=await sizes();
 const at=await dragStart();await mouse('mouseMove',at.x,at.y+45);const preview=await sizes();assert.ok(preview.canvas>initial.canvas+40);assert.ok(preview.info<initial.info-40);assert.ok(Math.abs(preview.layers-initial.layers)<1);assert.deepEqual((await prefs()).heights,{});
 await mouse('mouseUp',at.x,at.y+45);await delay(200);const committed=await sizes();assert.ok(Math.abs(committed.canvas-preview.canvas)<2);assert.ok((await prefs()).heights.canvas>initial.canvas+40);
 const stored=JSON.stringify((await prefs()).heights);
 // Esc cancellation must survive an accidental arrow key during the pointer gesture.
 const cancel=await dragStart();await mouse('mouseMove',cancel.x,cancel.y-30);win.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await mouse('mouseUp',cancel.x,cancel.y-30);assert.equal(JSON.stringify((await prefs()).heights),stored);assert.ok(Math.abs((await sizes()).canvas-committed.canvas)<2);
 const blur=await dragStart();await mouse('mouseMove',blur.x,blur.y+25);await js(`window.dispatchEvent(new Event('blur'))`);await mouse('mouseUp',blur.x,blur.y+25);assert.equal(JSON.stringify((await prefs()).heights),stored);
 const ptr=await dragStart();await mouse('mouseMove',ptr.x,ptr.y+25);await js(`window.dispatchEvent(new PointerEvent('pointercancel',{pointerId:window.dockPointer}))`);await mouse('mouseUp',ptr.x,ptr.y+25);assert.equal(JSON.stringify((await prefs()).heights),stored);
 // Keyboard-only adjustment commits one step; column arrows must not navigate storyboards.
 const selected=await js(`document.querySelector('.wb-card.is-selected').dataset.boardId`);await js(`document.querySelector('.wb-row-divider').focus()`);win.webContents.sendInputEvent({type:'keyDown',keyCode:'Down'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Down'});await delay(200);assert.equal(await js(`document.querySelector('.wb-card.is-selected').dataset.boardId`),selected);
 const expanded=await sizes();await click('折叠右栏');cases.push(await geometry('right collapsed'));assert.equal(await js(`document.querySelectorAll('[data-dock-column="1"] .wb-dock-icons button').length`),3);
 await click('打开画布面板');cases.push(await geometry('canvas flyout'));fs.writeFileSync(path.join(run,'canvas-flyout.png'),(await win.webContents.capturePage()).toPNG());
 await click('打开动作与对白面板');assert.equal(await js(`getComputedStyle(document.querySelector('[data-panel="canvas"]')).display`),'none');assert.notEqual(await js(`getComputedStyle(document.querySelector('[data-panel="info"]')).display`),'none');
 // Explicit composition event verifies the host's navigation guard without claiming OS IME coverage.
 await js(`document.querySelector('[data-panel="info"] textarea.flow-dialogue-text').dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}))`);
 await click('展开右栏');assert.equal(await js(`document.querySelector('[data-dock-column="1"]').classList.contains('is-collapsed')`),true);
 await js(`document.querySelector('[data-panel="info"] textarea.flow-dialogue-text').dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:''}))`);await delay(250);
 await click('关闭动作与对白');await click('展开右栏');const restored=await sizes();for(const k of Object.keys(expanded))assert.ok(Math.abs(expanded[k]-restored[k])<2,'restore expanded '+k);
 await click('折叠左栏');await click('打开故事板面板');cases.push(await geometry('board flyout'));await click('关闭故事板');await click('折叠右栏');cases.push(await geometry('both collapsed'));
 await click('打开图层面板');fs.writeFileSync(path.join(run,'both-collapsed.png'),(await win.webContents.capturePage()).toPNG());await click('关闭图层');
 win.setSize(1000,650);cases.push(await geometry('short collapsed'));await click('展开左栏');await click('展开右栏');cases.push(await geometry('short expanded'));win.setSize(1500,950);await delay(250);
 const finalHeights=await sizes();await click('折叠左栏');await click('折叠右栏');await delay(250);
 assert.deepEqual(read(),before,'layout must not write project state');save('expected.json',before);save('expected-heights.json',finalHeights);save('cases.json',cases);save(phase+'-done.json',{ok:true,phase});win.close();
}).catch(async e=>{console.error(e);if(win&&!win.isDestroyed()){console.error(await js('document.body.innerText'));fs.writeFileSync(path.join(run,'failure.png'),(await win.webContents.capturePage()).toPNG());win.destroy();}app.exit(1)});
