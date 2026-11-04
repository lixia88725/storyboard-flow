import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import sharp from 'sharp';
import {openFlowAssetDepot} from '../dist-electron/project-files/main/persistence/depot.js';
import {createProjectStore} from '../dist-electron/project-files/main/persistence/index.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),get=r=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const entryPath=path.join(repo,'dist-electron/platform/main/flowEditorEntry.js');
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-workbench-smoke-')),root=path.join(run,'project');await mkdir(root);
const depot=get(await openFlowAssetDepot({root,sessionId:'seed',maxPixels:1000000,maxPngBytes:1000000}));
const count=Number(process.env.FLOW_WORKBENCH_COUNT||6);
const clear=await sharp({create:{width:640,height:360,channels:4,background:'#00000000'}}).png().toBuffer();
const transparent=get(await depot.put({operationId:'clear',png:clear,width:640,height:360})).assetId;
const project={schema:'storyboard-flow.project',version:1,id:'workbench',revision:0,name:'Workbench acceptance',shots:[],parkedShots:[],dialogues:[],images:{}};
for(let i=0;i<count+1;i++){
 const png=await sharp({create:{width:640,height:360,channels:4,background:{r:220+i%30,g:220+Math.floor(i/30)%30,b:245,alpha:1}}}).png().toBuffer();
 const assetId=get(await depot.put({operationId:'base'+i,png,width:640,height:360})).assetId;
 const shot={id:'shot'+i,imageId:'image'+i,name:String(i+1).padStart(4,'0'),scriptText:'动作 '+i,...(i<2?{presentation:{mode:'embedded',dialogue:true}}:{})};
 (i===count?project.parkedShots:project.shots).push(shot);
 project.images[shot.imageId]={id:shot.imageId,revision:0,width:640,height:360,layers:[{id:'base',name:'背景',kind:'image',locked:true,assetId},{id:'ink',name:'绘画',kind:'paint',locked:false,assetId:transparent}].map(l=>({...l,visible:true,opacity:1,blendMode:'normal',width:640,height:360}))};
}
project.dialogues.push({id:'line0',shotId:'shot0',text:'第一段'},{id:'line1',shotId:'shot0',text:'第二段'});
get(await createProjectStore().saveCheckpoint(root,project,async id=>get(await depot.read(id))));
const identity={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run,count};
const layersOnly=process.argv.includes('--layers');
for(const phase of (layersOnly?['edit','reopen']:count<100 ? ['edit','reopen','recovery'] : ['edit','reopen'])){
 const userData=path.join(run,'userData');await mkdir(userData,{recursive:true});const driver=path.join(run,phase+'.cjs');
 await writeFile(driver,String.raw`
 const {app,BrowserWindow,clipboard,shell,ipcMain}=require('electron'),fs=require('node:fs'),assert=require('node:assert/strict');
 for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};shell.trashItem=()=>{throw Error('Trash forbidden')};
 let gateSave=false,releaseSave;
 const reads=new Set(),handle=ipcMain.handle.bind(ipcMain);
 ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{
   if(name==='flow-editor:read')reads.add(args[2]);
   if(name==='flow-editor:saveTiff' && gateSave)await new Promise(resolve=>releaseSave=resolve);
   return fn(...args);
 });
 process.argv=[process.argv[0],${JSON.stringify(entryPath)},${JSON.stringify(root)},${JSON.stringify(userData)},'--workbench'];
 let win;const phase=${JSON.stringify(phase)},count=${count};const delay=ms=>new Promise(r=>setTimeout(r,ms));const read=()=>JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/checkpoints/project.json'))},'utf8'));const js=c=>win.webContents.executeJavaScript(c).catch(e=>{throw Error('executeJavaScript failed: '+String(c).slice(0,200)+' :: '+e.message)});
 async function wait(fn,label){for(let i=0;i<400;i++){try{if(await fn())return}catch{}await delay(50)}throw Error('Timeout '+label)}
 async function button(text){await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==='+JSON.stringify(text)+').click()');await delay(100)}
 async function rect(s){return js('(()=>{const e=document.querySelector('+JSON.stringify(s)+');const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()')}
 async function mouse(type,x,y){win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});await delay(65)}
 const current=()=>js('document.querySelector("[data-current-shot]").dataset.currentShot');
 const key=k=>js('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:'+JSON.stringify(k)+',bubbles:true}))');
 const selected=()=>js('Array.from(document.querySelectorAll(".wb-card.is-selected")).map(e=>e.dataset.boardId)');
 app.on('window-all-closed',()=>fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-closed.json'))},'{}'));
 const started=Date.now();
 import(${JSON.stringify('file://'+entryPath)}).then(async()=>{
 await app.whenReady();await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');win.setSize(1600,1000);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');
 await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("已自动暂存")'),'checkpoint');
 await wait(()=>js('document.querySelector(".wb-viewer .image-stage img")?.naturalWidth>0'),'viewer raster');
 const openingMs=Date.now()-started;
 if(${JSON.stringify(layersOnly)}){
   await require(${JSON.stringify(path.join(repo,'scripts/workbench-layer-checks.cjs'))})({phase,js,win,mouse,rect,button,wait,delay,read,run:${JSON.stringify(run)}});
   win.close();return;
 }
 const folderSays=text=>wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.includes('+JSON.stringify(text)+')'),text);
 if(phase==='recovery'){
   const source=fs.readFileSync(${JSON.stringify(path.join(run,'staged-path.txt'))},'utf8');
   const held=${JSON.stringify(path.join(run,'simulated-trash.tif'))};
   const notice=()=>js('document.querySelector(".wb-recovery")?.textContent||""');
   await wait(async()=>(await notice()).includes('放回'),'missing acknowledgement after restart');
   assert.ok((await notice()).includes(require('node:path').basename(source)));
   await button('保存');
   await wait(async()=>(await notice()).includes('放回'),'unknown outcome remains blocked');
   assert.ok(fs.existsSync(held));assert.ok(!fs.existsSync(source));
   fs.copyFileSync(held,source);
   await js("window.dispatchEvent(new Event('focus'))");
   await wait(async()=>(await notice()).includes('身份或内容'),'substitute refused');
   fs.renameSync(source,held+'.rejected-copy');
   fs.renameSync(held,source);
   await js("window.dispatchEvent(new Event('focus'))");
   await wait(async()=>(await notice()).includes('重试保存 TIFF'),'restored original verified');
   let calls=0;
   shell.trashItem=async file=>{assert.equal(file,source);calls++;fs.renameSync(file,held);};
   await button('重试保存 TIFF');await folderSays('文件夹中的故事板已更新');
   assert.equal(calls,1);assert.equal(await notice(),'');win.close();return;
 }
 if(phase==='edit'){
 const initialDialogue=read().dialogues;
 async function clickTrack(selector){
   const r=await rect(selector);const x=r.x+r.width/2,y=r.y+r.height/2;
   await mouse('mouseMove',x,y);await mouse('mouseDown',x,y);await mouse('mouseUp',x,y);
 }
 for(const [selector,id] of [['[data-board-id="shot2"] .wb-dialogue-footer button','shot2'],['.wb-viewer [data-board-dialogue] button','shot0']]){
   if(id==='shot0')await js('document.querySelector(\'[aria-label="选择故事板 shot0"]\').click()');
   await clickTrack(selector);
   await wait(()=>js('document.activeElement?.matches("[data-board-dialogue] textarea")'),'track keyboard focus '+id);
   await win.webContents.insertText('轨道验收');
   await wait(()=>read().dialogues.some(d=>d.shotId===id&&d.text.includes('轨道验收')),'track write '+id);
   await js('document.activeElement.blur()');await button('撤销');
   await wait(()=>JSON.stringify(read().dialogues)===JSON.stringify(initialDialogue),'track undo '+id);
 }
 await clickTrack('[data-board-id="shot0"] [data-board-dialogue] button');
 await wait(()=>js('document.activeElement?.getAttribute("data-dialogue-id")==="line0"'),'static dialogue focus');
 await js('document.activeElement.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true,data:"中"}));document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{bubbles:true,key:"ArrowRight",isComposing:true}));');
 await win.webContents.insertText('中文输入 ');
 await js('document.activeElement.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true,data:"中文输入"}))');
 await wait(()=>read().dialogues.some(d=>d.text.includes('中文输入')),'inline dialogue checkpoint');
 assert.equal(read().dialogues.filter(d=>d.shotId==='shot0').length,2);
 assert.equal(await js('document.querySelector(\'.wb-panel-info [data-dialogue-id="line0"]\').value.includes("中文输入")'),true);
 await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}));document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true}));');
 assert.equal(await current(),'shot0');

 const aSlot=await rect('[data-board-id="shot1"] [data-board-dialogue]');
 await mouse('mouseDown',aSlot.x+aSlot.width/2,aSlot.y+aSlot.height/2);await mouse('mouseUp',aSlot.x+aSlot.width/2,aSlot.y+aSlot.height/2);
 await wait(()=>js('!!document.querySelector(\'[data-board-id="shot1"] .wb-board-dialogue\')?.contains(document.activeElement)'),'switch directly to B');
 const aReturn=await rect('[data-board-id="shot0"] [data-board-dialogue]');
 await mouse('mouseDown',aReturn.x+aReturn.width/2,aReturn.y+aReturn.height/2);await mouse('mouseUp',aReturn.x+aReturn.width/2,aReturn.y+aReturn.height/2);
 await wait(()=>js('document.activeElement?.getAttribute("data-dialogue-id")==="line0"'),'switch directly back to A');
 assert.ok(read().dialogues.find(d=>d.id==='line0').text.includes('中文输入'));
 assert.equal(read().dialogues.find(d=>d.id==='line1').text,'第二段');
 await js('document.activeElement.blur()');await button('撤销');
 await wait(()=>JSON.stringify(read().dialogues)===JSON.stringify(initialDialogue),'inline undo preserves multiple dialogues');
 // Hovered drawing path, empty dialogue slot, single-click selects the new card.
 const empty=await rect('[data-board-id="shot1"] [data-board-dialogue]');
 await mouse('mouseMove',empty.x+empty.width/2,empty.y+empty.height/2);
 await mouse('mouseDown',empty.x+empty.width/2,empty.y+empty.height/2);await mouse('mouseUp',empty.x+empty.width/2,empty.y+empty.height/2);
 await wait(()=>js('!!document.querySelector(\'[data-board-id="shot1"] .wb-board-dialogue\')?.contains(document.activeElement)'),'empty hovered dialogue focus');
 assert.equal(await current(),'shot1');assert.deepEqual(await selected(),['shot1']);
 await win.webContents.insertText('空位台词');await wait(()=>read().dialogues.some(d=>d.shotId==='shot1'&&d.text==='空位台词'),'empty dialogue checkpoint');
 assert.equal(read().images.image1.layers[1].assetId,${JSON.stringify(transparent)});
 await js('document.activeElement.blur()');await button('撤销');await wait(()=>!read().dialogues.some(d=>d.shotId==='shot1'),'empty dialogue undo');
 await js('document.querySelector(\'[aria-label="选择故事板 shot0"]\').click()');
 await js('(()=>{const e=document.querySelector(\'.wb-panel-info [data-dialogue-id="line0"]\');e.focus();e.setSelectionRange(2,2);e.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",shiftKey:true,bubbles:true}));})()');
 await wait(()=>read().dialogues.find(d=>d.id==='line0').text==='第一\n段','Shift Enter keeps id and soft break');
 assert.equal(read().dialogues.filter(d=>d.shotId==='shot0').length,2);
 await js('document.activeElement.blur()');await button('撤销');await wait(()=>JSON.stringify(read().dialogues)===JSON.stringify(initialDialogue),'soft break undo');
 await js('(()=>{const e=document.querySelector(\'.wb-panel-info [data-dialogue-id="line0"]\');e.focus();e.setSelectionRange(1,1);e.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true}));})()');
 await wait(()=>read().dialogues.filter(d=>d.shotId==='shot0').length===3,'Enter splits one block');
 assert.equal(read().dialogues.find(d=>d.id==='line0').text,'一段');assert.equal(read().dialogues[0].text,'第');assert.notEqual(read().dialogues[0].id,'line0');assert.ok(read().dialogues.some(d=>d.id==='line1'&&d.text==='第二段'));
 await js('document.activeElement.blur()');await button('撤销');await wait(()=>JSON.stringify(read().dialogues)===JSON.stringify(initialDialogue),'split undo');
 // Dialogue drag is explicit opt-in (allowDrag): both the Japanese row and the right panel pass
 // renderInfo(shot, true), so both surfaces reorder lines and move them between boards. The
 // compact lists inside cards and the canvas track stay read-only.
 async function dragDialogue(selector,id,source,y,drop=true){
   await js('(()=>{window.__dialogueDrag=new DataTransfer();window.__dialogueDrag.setData("application/x-flow-dialogue",'+JSON.stringify(JSON.stringify({id,shotId:source}))+');const e=document.querySelector('+JSON.stringify(selector)+');e.dispatchEvent(new DragEvent("dragover",{bubbles:true,dataTransfer:window.__dialogueDrag,clientY:'+y+'}));})()');
   await delay(100);
   await js(drop?'document.querySelector('+JSON.stringify(selector)+').dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:window.__dialogueDrag}))':'window.dispatchEvent(new DragEvent("dragend"))');
   await delay(150);
 }
 const panelZone='.wb-panel-info .flow-dialogue-blocks';
 assert.equal(await js('document.querySelector('+JSON.stringify(panelZone)+').dataset.allowDrag'),'true','right panel accepts dialogue drags');
 assert.ok(await js('document.querySelectorAll('+JSON.stringify('.wb-panel-info [aria-label^=Drag]')+').length')>=2,'right panel offers a grip per line');
 const panelLine=await rect('.wb-panel-info [data-block-id="line0"]');
 await dragDialogue(panelZone,'line1','shot0',panelLine.y);
 await wait(()=>read().dialogues[0].id==='line1','right panel same-board insertion');
 await button('撤销');await wait(()=>read().dialogues[0].id==='line0','right panel same-board undo');
 const panelCancelRevision=read().revision;
 await dragDialogue(panelZone,'line1','shot0',panelLine.y,false);
 assert.equal(read().revision,panelCancelRevision,'right panel cancel keeps the revision');
 assert.equal(await js('document.querySelector('+JSON.stringify(panelZone)+').hasAttribute("data-drop-index")'),false,'right panel cancel clears the drop index');
 assert.equal(read().dialogues.find(d=>d.id==='line0').text,'第一段');
 // A drop on a storyboard card carries no dialogue list, so nothing may move: not the lines,
 // not the board order, and no leftover drop index.
 const cardBox=await rect('[data-board-id="shot2"]');
 const invalidRevision=read().revision;const invalidOrder=read().shots.map(s=>s.id).join('');
 await dragDialogue('[data-board-id="shot2"]','line1','shot0',cardBox.y+10);
 assert.equal(read().revision,invalidRevision,'invalid drop keeps the revision');
 assert.equal(read().dialogues[0].id,'line0','invalid drop keeps the dialogue order');
 assert.equal(read().shots.map(s=>s.id).join(''),invalidOrder,'invalid drop keeps the board order');
 assert.equal(await js('document.querySelector('+JSON.stringify(panelZone)+').hasAttribute("data-drop-index")'),false,'invalid drop leaves no drop index');

 // The same gestures on the Japanese row still move, insert and undo.
 await button('日式分镜');
 await wait(()=>js('!!document.querySelector(".wb-japanese .wb-row-info .flow-dialogue-blocks")'),'japanese row drag surface');
 const rowZone='[data-board-id="shot0"] .wb-row-info .flow-dialogue-blocks';
 assert.equal(await js('document.querySelector('+JSON.stringify(rowZone)+').dataset.allowDrag'),'true','japanese row accepts dialogue drags');
 assert.ok(await js('document.querySelectorAll('+JSON.stringify(rowZone+' [aria-label^=Drag]')+').length')>=2,'japanese row offers a grip per line');
 const rowLine=await rect('[data-board-id="shot0"] .wb-row-info [data-block-id="line0"]');
 const cancelRevision=read().revision;
 await dragDialogue(rowZone,'line1','shot0',rowLine.y,false);
 assert.equal(read().revision,cancelRevision,'japanese cancel keeps the revision');
 assert.equal(await js('document.querySelector('+JSON.stringify(rowZone)+').hasAttribute("data-drop-index")'),false,'cancel clears the drop index');
 await dragDialogue(rowZone,'line1','shot0',rowLine.y);
 await wait(()=>read().dialogues[0].id==='line1','same-board insertion');
 await button('撤销');await wait(()=>read().dialogues[0].id==='line0','same-board reorder undo');
 await js('document.querySelector(\'[aria-label="选择故事板 shot1"]\').click()');
 await wait(()=>js('!!document.querySelector(\'[data-board-id="shot1"] .wb-row-info .flow-dialogue-blocks\')'),'empty japanese row');
 const emptyZone='[data-board-id="shot1"] .wb-row-info .flow-dialogue-blocks';
 const emptyBox=await rect(emptyZone);
 await dragDialogue(emptyZone,'line0','shot0',emptyBox.y+4);
 await wait(()=>read().dialogues.find(d=>d.id==='line0').shotId==='shot1','drop into empty board');
 assert.equal(read().dialogues.find(d=>d.id==='line1').shotId,'shot0');
 await button('撤销');await wait(()=>JSON.stringify(read().dialogues)===JSON.stringify(initialDialogue),'cross-board move undo');
 await js('document.querySelector(\'[data-board-id="shot1"] .wb-row-info .flow-dialogue-text\').focus()');await win.webContents.insertText('目标块');
 await wait(()=>read().dialogues.some(d=>d.shotId==='shot1'),'seed nonempty target');
 const targetBlock=read().dialogues.find(d=>d.shotId==='shot1');
 const destination=await rect('[data-board-id="shot1"] .wb-row-info .flow-dialogue-block');
 await dragDialogue(emptyZone,'line1','shot0',destination.y+2);
 await wait(()=>read().dialogues.filter(d=>d.shotId==='shot1').map(d=>d.id).join()===['line1',targetBlock.id].join(),'cross-board insertion before target');
 await button('撤销');await wait(()=>read().dialogues.find(d=>d.id==='line1').shotId==='shot0','insert undo');
 await button('撤销');await wait(()=>JSON.stringify(read().dialogues)===JSON.stringify(initialDialogue),'target creation undo');
 // Right panel and Japanese rows share one protocol, in both directions. The panel always shows
 // the current board, so a row's line dropped into it crosses boards whenever the panel is on a
 // different board; nothing may be lost and the board order must not move.
 const crossIds=read().dialogues.map(d=>d.id).sort().join();
 const crossCount=read().dialogues.length;
 const crossOrder=read().shots.map(s=>s.id).join('');
 const crossBaseline=JSON.stringify(read().dialogues);
 await js('Array.from(document.querySelectorAll(".wb-card-handle")).find(h=>h.getAttribute("aria-label").includes("shot2")).click()');
 await wait(()=>js('document.querySelector(".wb-panel-info .flow-dialogue-blocks")?.dataset.allowDrag==="true"'),'panel drag surface on the other board');
 const panelOther=await rect('.wb-panel-info .flow-dialogue-blocks');
 await dragDialogue('.wb-panel-info .flow-dialogue-blocks','line0','shot0',panelOther.y+4);
 await wait(()=>read().dialogues.find(d=>d.id==='line0').shotId==='shot2','row to panel cross-board move');
 assert.equal(read().dialogues.length,crossCount,'row to panel keeps every line');
 assert.equal(read().dialogues.map(d=>d.id).sort().join(),crossIds,'row to panel keeps the line ids');
 assert.equal(read().shots.map(s=>s.id).join(''),crossOrder,'row to panel keeps the board order');
 await button('撤销');await wait(()=>JSON.stringify(read().dialogues)===crossBaseline,'row to panel undo');
 await js('Array.from(document.querySelectorAll(".wb-card-handle")).find(h=>h.getAttribute("aria-label").includes("shot0")).click()');
 await wait(()=>js('Array.from(document.querySelectorAll(".wb-panel-info .flow-dialogue-text")).some(t=>t.dataset.dialogueId==="line0")'),'panel back on shot0');
 const rowOther=await rect('[data-board-id="shot2"] .wb-row-info .flow-dialogue-blocks');
 await dragDialogue('[data-board-id="shot2"] .wb-row-info .flow-dialogue-blocks','line0','shot0',rowOther.y+4);
 await wait(()=>read().dialogues.find(d=>d.id==='line0').shotId==='shot2','panel to row cross-board move');
 assert.equal(read().dialogues.length,crossCount,'panel to row keeps every line');
 assert.equal(read().dialogues.map(d=>d.id).sort().join(),crossIds,'panel to row keeps the line ids');
 assert.equal(read().shots.map(s=>s.id).join(''),crossOrder,'panel to row keeps the board order');
 await button('撤销');await wait(()=>JSON.stringify(read().dialogues)===crossBaseline,'panel to row undo');
 await button('日式分镜');await wait(()=>js('!document.querySelector(".wb-japanese")'),'back to the normal grid');
 await js('document.querySelector(\'[aria-label="选择故事板 shot0"]\').click()');

 await folderSays('文件夹中的故事板待更新');
 const before=read();assert.equal(before.shots.length,count);
 await js('document.querySelector(\'[aria-label="隐藏Pending"]\').click()');
 assert.equal(await js('!!document.querySelector(\'[data-panel="pending"]\')'),false);
 assert.equal(await js('Array.from(document.querySelectorAll("button")).some(b=>b.textContent==="显示Pending")'),false);
 await js('document.querySelector(".wb-header .wb-panel-menu summary").click()');
 assert.equal(await js('document.querySelector("[data-panel-toggle=pending]").checked'),false);
 await js('document.querySelector("[data-panel-toggle=pending]").click()');
 await js('document.querySelector(".wb-header .wb-panel-menu summary").click()');
 assert.equal(await js('!!document.querySelector(\'[data-panel="pending"]\')'),true);
 assert.equal(await js('getComputedStyle(document.querySelector(".layer-toggle")).display'),'none');
 assert.equal(await js('!!document.querySelector(".wb-board-actions button")'),true);
 await js('document.querySelector(\'[aria-label="模糊"]\').click()');
 assert.equal(await js('!!document.querySelector(\'[aria-label="模糊半径"]\')'),true);
 await js('document.querySelector(\'[aria-label="画笔"]\').click()');

 await js('Array.from(document.querySelectorAll(".wb-card-handle")).find(h=>h.getAttribute("aria-label").includes("shot2")).dispatchEvent(new MouseEvent("click",{bubbles:true,shiftKey:true}))');
 await wait(async()=>JSON.stringify(await selected())==='["shot0","shot1","shot2"]','range selection');assert.equal(await current(),'shot0');
 await key('ArrowRight');await wait(async()=>await current()==='shot1','right navigation');assert.deepEqual(await selected(),['shot1']);
 await key('ArrowLeft');await wait(async()=>await current()==='shot0','left navigation');await key('ArrowLeft');assert.equal(await current(),'shot0');
 assert.deepEqual(read(),before);
 const target=await rect('[data-board-id="shot2"] .wb-card-picture');
 await mouse('mouseMove',target.x+target.width*.4,target.y+target.height*.5);
 await wait(()=>js('!!document.querySelector(\'[data-surface="grid:shot2"] .stage-overlay\')'),'hover editable canvas');
 await mouse('mouseDown',target.x+target.width*.4,target.y+target.height*.5);
 await mouse('mouseMove',target.x+target.width*.6,target.y+target.height*.5);
 assert.equal(await current(),'shot2');assert.deepEqual(await selected(),['shot2']);
 await wait(()=>js('Array.from(document.querySelectorAll("[data-live-mirror]")).some(c=>{const a=c.getContext("2d").getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i]>170&&a[i+1]<100&&a[i+2]<130)return true;return false})'),'live red stroke mirrored before release');
 await key('ArrowRight');assert.equal(await current(),'shot2');assert.equal(read().images.image2.layers[1].assetId,${JSON.stringify(transparent)});
 await mouse('mouseUp',target.x+target.width*.6,target.y+target.height*.5);
 await wait(()=>read().images.image2.layers[1].assetId!==${JSON.stringify(transparent)},'grid stroke checkpoint');
 const painted=read().images.image2.layers[1].assetId;
 await wait(()=>js('!document.querySelector("[data-live-mirror]")'),'settled mirror');
 await button('撤销');await wait(()=>read().images.image2.layers[1].assetId===${JSON.stringify(transparent)},'one undo');
 await button('重做');await wait(()=>read().images.image2.layers[1].assetId===painted,'redo');
 // Native text input owns arrow keys rather than flipping the current board.
 await js('document.querySelector(\'[aria-label="动作说明 shot2"]\').focus()');await win.webContents.insertText('文字');
 await js('document.querySelector(\'[aria-label="动作说明 shot2"]\').dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true}))');assert.equal(await current(),'shot2');
 const revision=read().revision;
 await js('document.querySelector(\'[aria-label="隐藏图层"]\').click()');assert.equal(await js('!!document.querySelector(\'[data-panel="layers"]\')'),false);
 await js('document.querySelector(".wb-header .wb-panel-menu summary").click()');await button('恢复默认布局');assert.equal(await js('!!document.querySelector(\'[data-panel="layers"]\')'),true);
 // Panel docking is metadata-free native drag/drop; the board ordering uses a separate drag type.
 await js('(()=>{const d=new DataTransfer();d.setData("application/x-flow-panel","info");document.querySelector(".wb-column").dispatchEvent(new DragEvent("drop",{bubbles:true,dataTransfer:d}))})()');
 assert.equal(await js('document.querySelector(".wb-column").querySelectorAll(\'[data-panel="info"]\').length'),1);
 await button('恢复默认布局');
 const divider=await rect('.wb-divider');await mouse('mouseDown',divider.x+3,divider.y+40);await mouse('mouseMove',divider.x+90,divider.y+40);await mouse('mouseUp',divider.x+90,divider.y+40);
 await button('移入 Pending');await wait(()=>read().parkedShots.some(s=>s.id==='shot2'),'Pending membership');
 await button('撤销');await wait(()=>read().shots.some(s=>s.id==='shot2'),'restore membership');
 await js('document.querySelector(\'[aria-label="选择故事板 shot0"]\').click()');
 await delay(500);
 const from=await rect('[aria-label="选择故事板 shot1"]'),to=await rect('[aria-label="选择故事板 shot0"]');
 await mouse('mouseDown',from.x+25,from.y+12);await mouse('mouseMove',from.x+40,from.y+12);await wait(()=>js('document.querySelector(\'[aria-label="选择故事板 shot1"]\').getAttribute("aria-pressed")=="true"'),'drag activated');await delay(250);await mouse('mouseMove',to.x+25,to.y+12);await delay(300);await mouse('mouseUp',to.x+25,to.y+12);
 await wait(()=>read().shots[0].id==='shot1','header reorder');await button('撤销');await wait(()=>read().shots[0].id==='shot0','reorder undo');
 // Starting a drag on an unselected board selects it by design, so the viewer now shows
 // shot1. Return to shot0 before sampling both of its surfaces.
 await js('document.querySelector(\'[aria-label="选择故事板 shot0"]\').click()');
 await wait(()=>js('!!document.querySelector(\'[data-surface="viewer:shot0"]\')'),'viewer back on shot0');
 await delay(300);
 // Reverse direction: a viewer stroke is visible in the grid before release.
 // Sample both surfaces throughout the press and commit; a final screenshot misses a one-frame blink.
 await js("("+(()=>{
   const surfaces=['viewer:shot0','grid:shot0'].map(id=>document.querySelector('[data-surface="'+id+'"]'));
   const rects=surfaces.map(s=>s.querySelector('.image-stage').getBoundingClientRect());
   window.strokeFrames={count:0,errors:[],stop:false};
   const sample=()=>{const f=window.strokeFrames;if(f.stop)return;f.count++;
     surfaces.forEach((s,i)=>{const stage=s.querySelector('.image-stage'),r=stage.getBoundingClientRect();
       const matte=s.querySelector('[data-flow-matte], [data-flow-presentation-preview]');
       if(!matte||getComputedStyle(matte).visibility==='hidden')f.errors.push('matte hidden '+i);
       if(stage.querySelectorAll(':scope > img').length<2)f.errors.push('layer removed '+i);
       if(['x','y','width','height'].some(k=>Math.abs(rects[i][k]-r[k])>1))f.errors.push('stage moved '+i);
     });requestAnimationFrame(sample);};sample();
 }).toString()+")()");
 const viewer=await rect('.wb-viewer .wb-surface');
 await mouse('mouseMove',viewer.x+viewer.width*.4,viewer.y+viewer.height*.4);
 await mouse('mouseDown',viewer.x+viewer.width*.4,viewer.y+viewer.height*.4);
 await mouse('mouseMove',viewer.x+viewer.width*.6,viewer.y+viewer.height*.4);
 await wait(()=>js('Array.from(document.querySelectorAll(".wb-grid [data-live-mirror]")).some(c=>{const a=c.getContext("2d").getImageData(0,0,c.width,c.height).data;for(let i=0;i<a.length;i+=4)if(a[i]>170&&a[i+1]<100&&a[i+2]<130)return true;return false})'),'viewer stroke mirrored into grid');
 await mouse('mouseUp',viewer.x+viewer.width*.6,viewer.y+viewer.height*.4);
 await wait(()=>read().images.image0.layers[1].assetId!==${JSON.stringify(transparent)},'viewer stroke checkpoint');
 await wait(()=>js('!document.querySelector("[data-live-mirror]")'),'viewer mirror settled');
 const sampling=await js('(()=>{window.strokeFrames.stop=true;return window.strokeFrames})()');
 assert.ok(sampling.count>2);assert.deepEqual([...new Set(sampling.errors)],[]);
 await button('撤销');await wait(()=>read().images.image0.layers[1].assetId===${JSON.stringify(transparent)},'viewer stroke undo');
 if(count<100){
   const revisionBefore=read().revision;
   await button('日式分镜');
   await wait(()=>js('!!document.querySelector(".wb-japanese .wb-row-info textarea")'),'Japanese rows');
   assert.equal(read().revision,revisionBefore);
   await js('document.querySelector(\'.wb-row-info [data-dialogue-id="line0"]\').focus()');await win.webContents.insertText('日式台词');
   await js('document.activeElement.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",shiftKey:true,bubbles:true}))');
   await wait(()=>read().dialogues.find(d=>d.id==='line0').text.includes('日式台词\n'),'Japanese block soft break persisted');
   await js('document.querySelector(".wb-row-info textarea").focus()');
   await win.webContents.insertText('日式动作');
   await wait(()=>read().shots.some(s=>s.scriptText.includes('日式动作')),'Japanese row text checkpoint');
 }
 if(count<100){
   const viewId=await current(),before=read(),shot=before.shots.find(s=>s.id===viewId),ink=before.images[shot.imageId].layers[1].assetId;
   gateSave=true;await button('保存');await wait(()=>releaseSave,'Save captured');
   const box=await rect('.wb-viewer .image-stage');
   await mouse('mouseDown',box.x+box.width*.7,box.y+box.height*.6);
   await mouse('mouseMove',box.x+box.width*.75,box.y+box.height*.6);
   await mouse('mouseUp',box.x+box.width*.75,box.y+box.height*.6);
   await wait(()=>read().images[shot.imageId].layers[1].assetId!==ink,'new stroke while TIFF Save pending');
   gateSave=false;releaseSave();
   await folderSays('文件夹中的故事板待更新');
   const ledger=()=>JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/tiff-output.json'))},'utf8'));
   await wait(()=>ledger().saved?.revision===before.revision,'first output belongs to captured revision');
   assert.equal(ledger().entries.find(e=>e.shotId===shot.id).baseline.layers[1].assetId,ink);
   await button('保存');await folderSays('文件夹中的故事板已更新');
   assert.equal(ledger().entries.find(e=>e.shotId===shot.id).baseline.layers[1].assetId,read().images[shot.imageId].layers[1].assetId);
 }
 fs.writeFileSync(${JSON.stringify(path.join(run,'expected.json'))},JSON.stringify(read()));
 }else{assert.deepEqual(read(),JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run,'expected.json'))},'utf8')));}
 if(phase==='reopen' && count<100){
   await wait(()=>js('!!document.querySelector(".wb-japanese .wb-row-info textarea")'),'layout restored after new process');
   await button('日式分镜');
   await folderSays('文件夹中的故事板已更新');
   const entry=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'.storyboard-flow/tiff-output.json'))})).entries.find(e=>!e.retired && e.location!=='parked');
   const target=require('node:path').join(${JSON.stringify(root)},entry.name),original=fs.readFileSync(target);
   fs.appendFileSync(require('node:path').join(${JSON.stringify(root)},entry.name),'test external edit');
   await js("window.dispatchEvent(new Event('focus'))");
   await folderSays('文件夹中的故事板有改动');
   fs.writeFileSync(target,original);
   await button('删除');await wait(()=>read().shots.length===count-1,'checkpoint logical removal');
   shell.trashItem=async file=>{
     assert.equal(require('node:path').dirname(require('node:path').dirname(file)),${JSON.stringify(path.join(root,'.storyboard-flow/deletions'))});
     fs.writeFileSync(${JSON.stringify(path.join(run,'staged-path.txt'))},file);
     fs.renameSync(file,${JSON.stringify(path.join(run,'simulated-trash.tif'))});throw Error('Synthetic lost OS reply');
   };
   await button('保存');await wait(()=>js('document.querySelector(".wb-recovery")?.textContent.includes("放回")'),'actionable recovery');

 }
 await js('document.querySelector(".wb-header .wb-panel-menu").open=false');await delay(400);
 await wait(()=>js('Array.from(document.querySelectorAll(".wb-card")).slice(0,3).every(e=>e.querySelector("img")?.naturalWidth>0)'), 'visible cards remain rendered after reorder');
 const metrics=await js('({canvases:document.querySelectorAll(".stage-overlay").length,rasterImages:document.querySelectorAll(".wb-grid img").length,cards:document.querySelectorAll(".wb-card").length,heap:performance.memory?.usedJSHeapSize})');
 fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-metrics.json'))},JSON.stringify({openingMs,readAssets:reads.size,...metrics}));
 if(count>=100){assert.ok(reads.size<100,'only visible assets requested');assert.ok(metrics.canvases<=2,'bounded editable canvases');assert.ok(metrics.rasterImages<100,'offscreen rasters unmounted');}
 fs.writeFileSync(${JSON.stringify(path.join(run,phase+'.png'))},(await win.webContents.capturePage()).toPNG());win.close();
 }).catch(async e=>{console.error(e);if(win&&!win.isDestroyed()){console.error(await js('document.body.innerText'));fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-failure.png'))},(await win.webContents.capturePage()).toPNG());}app.exit(1)});
 `);
 execFileSync(process.execPath,['--check',driver]);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const chunks=[],child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>{chunks.push(b);process.stderr.write(b)});
 const code=await new Promise(resolve=>child.on('exit',resolve));await writeFile(path.join(run,phase+'.log'),Buffer.concat(chunks));console.log(phase,code,run);if(code!==0)throw Error('Workbench verification failed: '+run);await readFile(path.join(run,phase+'-closed.json'));
}
await writeFile(path.join(run,'receipt.json'),JSON.stringify({...identity,passed:true,cases:layersOnly?['workbench layer audit: target isolation, display, gestures, history, checkpoint reopen']:['workbench connected to real Session','multi-select displays earliest board','arrows cancel multi-select and stop at boundary','navigation never edits project','hover enables grid painting','drawing selects and follows current board','live stroke mirrored in both directions before pointer release','unsettled stroke blocks navigation','single Undo and Redo restores stroke','text arrows do not navigate','panels hide and restore','panel docking is separate from board ordering','split resize','Pending membership and Undo','header pointer reorder and Undo',...(count<100?['explicit Save for small fixture','Japanese row edit and layout reopen','interrupted Trash: missing and substituted files refused, verified original retry']:[]),'normal Close and reopen retains edits','inline static/hovered/blank dialogue selection and input','A to B to A retains stable records','Enter splits and Shift Enter retains id','same/cross/empty-board dialogue insertion and cancellation','structure actions each undo once','Japanese dialogue soft break survives reopen',...(count>=100?['bounded visible rasters and editable canvases at scale']:[])]},null,2));console.log('PASS',run);
