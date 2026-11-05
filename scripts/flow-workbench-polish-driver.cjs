// A synthetic-project Electron check. Native DND is approximated with DataTransfer;
// actual pointer selection is exercised by the separate board-selection smoke.
const {app,BrowserWindow,clipboard,shell}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
shell.trashItem=()=>{throw Error('Trash forbidden')};
const root=process.env.FLOW_DIALOGUE_ROOT,userData=process.env.FLOW_DIALOGUE_USERDATA,run=process.env.FLOW_DIALOGUE_RUN,phase=process.env.FLOW_DIALOGUE_PHASE,entry=process.env.FLOW_DIALOGUE_ENTRY;
const read=()=>JSON.parse(fs.readFileSync(path.join(root,'.storyboard-flow/checkpoints/project.json'),'utf8'));
let win;const delay=ms=>new Promise(r=>setTimeout(r,ms)),js=c=>win.webContents.executeJavaScript(c);
async function wait(fn,label){for(let i=0;i<200;i++){try{if(await fn())return}catch{}await delay(50)}throw Error('Timeout '+label)}
async function button(text){await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);await delay(100)}
async function geometry(label){
 await delay(200);
 const g=await js(`(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,width:r.width}};return {canvas:[...document.querySelectorAll('.wb-panel-canvas .wb-panel-body,.wb-viewer,.wb-viewer .image-stage')].map(e=>({class:e.className,rect:rect(e),client:e.clientHeight,scroll:e.scrollHeight})),cols:[...document.querySelectorAll('.wb-column')].map(c=>({rect:rect(c),scroll:c.scrollHeight,client:c.clientHeight,overflow:getComputedStyle(c).overflowY,panels:[...c.querySelectorAll(':scope>.wb-panel')].map(p=>({id:p.dataset.panel,rect:rect(p),body:rect(p.querySelector('.wb-panel-body'))}))})),rail:rect(document.querySelector('.wb-tool-rail')),range:rect(document.querySelector('[aria-label="画笔大小"]')),header:document.querySelector('.wb-header').textContent}})()`);
 for(const c of g.cols){assert.equal(c.overflow,'hidden',label+' column not scrollable');assert.ok(c.scroll<=c.client+2,label+' column contents fit');for(const p of c.panels){assert.ok(p.rect.bottom<=c.rect.bottom+2,label+' '+p.id+' fits');assert.ok(p.body.height>16,label+' '+p.id+' body accessible');}}
 if(['default','short window','restored','reopened'].includes(label)&&g.canvas.length===3){const [body,viewer,stage]=g.canvas;assert.ok(stage.rect.bottom<=body.rect.bottom+2,label+' fit canvas bottom inside panel');assert.ok(stage.rect.top>=body.rect.top,label+' fit canvas top inside panel');assert.ok(body.scroll<=body.client+2,label+' fit mode needs no vertical scroll');}
 assert.ok(g.rail.width<=50);assert.ok(g.range.height>g.range.width*3);assert.ok(!g.header.includes('Storyboard'));assert.ok(g.header.includes('项目')&&g.header.includes('保存'));
 return {label,...g};
}
const save=(name,data)=>fs.writeFileSync(path.join(run,name),JSON.stringify(data,null,2));
app.on('window-all-closed',()=>save(phase+'-closed.json',{}));
process.argv=[process.argv[0],entry,root,userData,'--workbench'];
import(pathToFileURL(entry).href).then(async()=>{
 await app.whenReady();await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');win.setSize(1500,950);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("已自动暂存")'),'checkpoint');
 if(phase==='reopen'){assert.deepEqual(read().dialogues,JSON.parse(fs.readFileSync(path.join(run,'expected.json'))).dialogues);await geometry('reopened');save(phase+'-done.json',{ok:true,phase});win.close();return;}
 const cases=[],before=read();cases.push(await geometry('default'));
 assert.equal(await js('document.querySelectorAll(".wb-card .flow-dialogue-handle").length'),0,'card dialogue lists stay read-only in the normal grid');
 assert.ok(await js('document.querySelectorAll(".wb-panel-info .flow-dialogue-handle").length')>=1,'right panel offers a grip per line');
 // Open a footer editor and confirm its drag surface is also disabled.
 await js(`document.querySelector('[data-board-id="shot0"] .wb-dialogue-footer button').click()`);
 await wait(()=>js('!!document.querySelector(".wb-dialogue-footer textarea")'),'footer editor');
 assert.equal(await js('document.querySelectorAll(".wb-dialogue-footer .flow-dialogue-handle").length'),0,'footer editor stays read-only');
 await js(`document.activeElement.blur()`);
 win.setSize(1000,650);cases.push(await geometry('short window'));
 // Even oversized saved panel preferences must share the viewport; no column scrolling.
 await js(`document.querySelector('[data-panel="board"]').style.height='1600px';document.querySelector('[data-panel="board"]').dispatchEvent(new PointerEvent('pointerup',{bubbles:true}))`);
 cases.push(await geometry('oversized panel'));
 // Move all modules into one column; each header/body stays reachable.
 await js(`(()=>{for(const id of ['canvas','info','layers']){const d=new DataTransfer();d.setData('application/x-flow-panel',id);document.querySelector('.wb-column').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:d}));}})()`);
 cases.push(await geometry('all panels in one column'));
 // A wrapped toolbar must scroll out of the way even in the narrowest dock.
 await js(`(()=>{const d=document.querySelector('.wb-divider');for(let i=0;i<30;i++)d.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true}));})()`);
 cases.push(await geometry('all panels narrow column'));
 const reachable=await js(`(()=>{const b=document.querySelector('[data-panel=board] .wb-panel-body'),t=b.querySelector('.wb-board-tools');b.scrollTop=t.offsetHeight;const r=b.getBoundingClientRect(),c=b.querySelector('.wb-card').getBoundingClientRect();return {body:r.height,top:r.top,cardTop:c.top,cardBottom:c.bottom,toolbarPosition:getComputedStyle(t).position};})()`);
 assert.equal(reachable.toolbarPosition,'static');assert.ok(reachable.cardTop<reachable.top+reachable.body&&reachable.cardBottom>reachable.top,'board content remains reachable below wrapped tools');
 await js(`document.querySelector('.wb-header .wb-panel-menu').open=true`);await button('恢复默认布局');await js(`document.querySelector('.wb-header .wb-panel-menu').open=false`);
 win.setSize(1500,950);cases.push(await geometry('restored'));
 // Native vertical range keyboard semantics: Up increases the brush diameter.
 await js(`document.querySelector('[aria-label="画笔大小"]').focus()`);const size=await js(`Number(document.activeElement.value)`);
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Up'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Up'});
 await wait(()=>js(`Number(document.querySelector('[aria-label="画笔大小"]').value)>${size}`),'vertical range Up');
 await button('日式分镜');await wait(()=>js('!!document.querySelector(".wb-japanese .flow-dialogue-handle")'),'Japanese handles');
 assert.equal(await js('document.querySelector(".wb-panel-info .flow-dialogue-blocks").dataset.allowDrag'),'true','info panel is a drag surface in Japanese mode');
 assert.ok(await js('document.querySelectorAll(".wb-panel-info .flow-dialogue-handle").length')>=1,'info panel offers a grip per line');
 const handle=await js(`(()=>{const e=document.querySelector('.wb-japanese .flow-dialogue-handle'),r=e.getBoundingClientRect();return {w:r.width,h:r.height,circles:e.querySelectorAll('circle').length,bg:getComputedStyle(e).backgroundColor}})()`);
 assert.ok(handle.w>=20&&handle.h>=20);assert.equal(handle.circles,6);assert.equal(handle.bg,'rgba(0, 0, 0, 0)');
 fs.writeFileSync(path.join(run,'japanese.png'),(await win.webContents.capturePage()).toPNG());
 // Same-board reorder uses the real component handlers and Session; one undo restores it.
 await js(`(()=>{const h=document.querySelector('.wb-japanese [aria-label="Drag dialogue line1"]');const box=h.closest('.flow-dialogue-blocks'),r=box.getBoundingClientRect(),d=new DataTransfer();h.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:d}));box.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:d,clientY:r.top}));window.polishDrag={h,box,d,y:r.top};})()`);
 await delay(100);
 await js(`(()=>{const {h,box,d,y}=window.polishDrag;box.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:d,clientY:y}));h.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:d}));delete window.polishDrag;})()`);
 await wait(()=>read().dialogues[0]?.id==='line1','Japanese reorder');await button('撤销');await wait(()=>read().dialogues[0]?.id==='line0','undo Japanese reorder');
 // Cross-board move to a blank Japanese row, followed by one undo.
 await js(`(()=>{const h=document.querySelector('.wb-japanese [aria-label="Drag dialogue line0"]'),box=document.querySelector('[data-board-id="shot1"] .flow-dialogue-blocks'),r=box.getBoundingClientRect(),d=new DataTransfer();h.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:d}));box.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:d,clientY:r.top}));h.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:d}));})()`);
 await wait(()=>read().dialogues.find(d=>d.id==='line0')?.shotId==='shot1','Japanese cross-board');await button('撤销');await wait(()=>read().dialogues.find(d=>d.id==='line0')?.shotId==='shot0','undo cross-board');
 await button('网格视图');
 assert.equal(await js('document.querySelectorAll(".wb-japanese .flow-dialogue-handle").length'),0,'Japanese handles disappear with the sheet view');
 assert.equal(await js('document.querySelectorAll(".wb-card .flow-dialogue-handle").length'),0,'cards stay read-only after leaving the sheet view');
 assert.ok(await js('document.querySelectorAll(".wb-panel-info .flow-dialogue-handle").length')>=1,'info panel keeps its grips in the normal grid');
 assert.deepEqual(read().dialogues,before.dialogues);save('expected.json',read());save('cases.json',cases);save(phase+'-done.json',{phase,ok:true});fs.writeFileSync(path.join(run,'final.png'),(await win.webContents.capturePage()).toPNG());win.close();
}).catch(async e=>{console.error(e);if(win&&!win.isDestroyed()){console.error(await js('document.body.innerText'));fs.writeFileSync(path.join(run,'failure.png'),(await win.webContents.capturePage()).toPNG());}app.exit(1)});
