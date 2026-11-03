// Board selection acceptance: header/picture modifiers, anchor stability, select-all scope,
// Cmd/Ctrl+A, no revision writes from selection, and multi-select block reorder.
// Isolated like flow-workbench-smoke: temp project + own userData, clipboard and Trash stubbed
// to throw, and the watchdog only kills this script's own Electron child.
// NOT executed in the authoring round: run `npm run build` first, then `node scripts/flow-board-selection-smoke.mjs`.
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import sharp from 'sharp';
import {openFlowAssetDepot} from '../dist-electron/project-files/main/persistence/depot.js';
import {createProjectStore} from '../dist-electron/project-files/main/persistence/index.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),get=r=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const entry=path.join(repo,'dist-electron/platform/main/flowEditorEntry.js');
if(!existsSync(entry))throw Error('Run npm run build first: '+entry+' is missing');
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-board-selection-')),root=path.join(run,'project');await mkdir(root);
const depot=get(await openFlowAssetDepot({root,sessionId:'seed',maxPixels:1000000,maxPngBytes:1000000}));
const scrollCase=process.env.FLOW_GESTURE_SCROLL==='1';
const count=Number(process.env.FLOW_SELECTION_COUNT||(scrollCase?50:5));
const clear=await sharp({create:{width:640,height:360,channels:4,background:'#00000000'}}).png().toBuffer();
const transparent=get(await depot.put({operationId:'clear',png:clear,width:640,height:360})).assetId;
const project={schema:'storyboard-flow.project',version:1,id:'selection',revision:0,name:'Board selection acceptance',shots:[],parkedShots:[],dialogues:[],images:{}};
for(let i=0;i<count+1;i++){
 const png=await sharp({create:{width:640,height:360,channels:4,background:{r:210+i%30,g:220+Math.floor(i/30)%30,b:245,alpha:1}}}).png().toBuffer();
 const assetId=get(await depot.put({operationId:'base'+i,png,width:640,height:360})).assetId;
 const shot={id:'shot'+i,imageId:'image'+i,name:String(i+1).padStart(4,'0'),scriptText:'动作 '+i};
 (i===count?project.parkedShots:project.shots).push(shot);
 project.images[shot.imageId]={id:shot.imageId,revision:0,width:640,height:360,layers:[{id:'base',name:'背景',kind:'image',locked:true,assetId},{id:'ink',name:'绘画',kind:'paint',locked:false,assetId:transparent}].map(l=>({...l,visible:true,opacity:1,blendMode:'normal',width:640,height:360}))};
}
if(scrollCase)for(let i=0;i<count;i++)project.dialogues.push({id:'line'+i,shotId:'shot'+i,text:'长行对白 '.repeat(12)});
get(await createProjectStore().saveCheckpoint(root,project,async id=>get(await depot.read(id))));
const identity={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run,count,order:Array.from({length:count},(_,i)=>'shot'+i)};
const userData=path.join(run,'userData');await mkdir(userData,{recursive:true});
const driver=path.join(run,'selection.cjs'),checkpoint=path.join(root,'.storyboard-flow/checkpoints/project.json');
await writeFile(driver,String.raw`
const {app,BrowserWindow,clipboard,shell}=require('electron'),fs=require('node:fs'),assert=require('node:assert/strict');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
shell.trashItem=async()=>{throw Error('Trash forbidden')};
process.argv=[process.argv[0],${JSON.stringify(entry)},${JSON.stringify(root)},${JSON.stringify(userData)},'--workbench'];
let win;const delay=ms=>new Promise(r=>setTimeout(r,ms));
const read=()=>JSON.parse(fs.readFileSync(${JSON.stringify(checkpoint)},'utf8'));
const js=c=>win.webContents.executeJavaScript(c).catch(e=>{throw Error(e.message+'\nEXPRESSION: '+c)});
const selected=()=>js('Array.from(document.querySelectorAll(".wb-card.is-selected")).map(e=>e.dataset.boardId)');
async function wait(fn,label){for(let i=0;i<400;i++){try{if(await fn())return}catch{}await delay(50)}throw Error('Timeout '+label)}
async function rect(s){return js('(()=>{const r=document.querySelector('+JSON.stringify(s)+').getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()')}
async function mouse(type,x,y,modifiers){win.webContents.sendInputEvent(Object.assign({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1},modifiers?{modifiers}:{}));await delay(70)}
async function clickAt(sel,modifiers){const r=await rect(sel);const x=r.x+r.width/2,y=r.y+r.height/2;await mouse('mouseMove',x,y);await mouse('mouseDown',x,y,modifiers);await mouse('mouseUp',x,y,modifiers)}
async function press(type,box,button,modifiers){win.webContents.sendInputEvent(Object.assign({type,x:Math.round(box.x+box.width/2),y:Math.round(box.y+box.height/2),button,clickCount:1},modifiers?{modifiers}:{}));await delay(70)}
const keyActive=init=>js('(()=>{const e=document.activeElement;return e.dispatchEvent(new KeyboardEvent("keydown",Object.assign({bubbles:true,cancelable:true},'+JSON.stringify(init)+')))})()');
const MOD={shiftKey:'shift',metaKey:'meta',ctrlKey:'control'};
const headerSel=id=>'[aria-label="选择故事板 '+id+'"]';
// Real pointer presses: the modifier branch now lives in onPointerDownCapture, so a synthetic
// click would bypass it (and the onClick dedupe) entirely.
async function clickHeader(id,init){const mods=Object.keys(init||{}).filter(k=>init[k]).map(k=>MOD[k]);await clickAt(headerSel(id),mods.length?mods:undefined)}
const contextMenu=(sel,init)=>js('(()=>{const e=document.querySelector('+JSON.stringify(sel)+');return e.dispatchEvent(new MouseEvent("contextmenu",Object.assign({bubbles:true,cancelable:true},'+JSON.stringify(init)+')))})()');
const key=(sel,init)=>js('(()=>{const e=document.querySelector('+JSON.stringify(sel)+');e.focus({preventScroll:true});return e.dispatchEvent(new KeyboardEvent("keydown",Object.assign({bubbles:true,cancelable:true},'+JSON.stringify(init)+')))})()');
const status=()=>js('document.querySelector(".wb-board-tools span").textContent');
app.on('window-all-closed',()=>fs.writeFileSync(${JSON.stringify(path.join(run,'selection-closed.json'))},'{}'));
import(${JSON.stringify('file://'+entry)}).then(async()=>{
 await app.whenReady();
 await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');
 win.setSize(1600,1000);
 await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');
 await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("Flow 内已保存")'),'checkpoint');
 await wait(()=>js('document.querySelector(".wb-viewer .image-stage img")?.naturalWidth>0'),'viewer raster');
 const count=${count},order=Array.from({length:count},(_,i)=>'shot'+i),baseline=read();
 assert.equal(baseline.shots.length,count);
 assert.equal(baseline.parkedShots.length,1);
 assert.equal(await js('document.querySelectorAll(".wb-card").length'),count);
 assert.deepEqual(await selected(),['shot0']);

 if(${JSON.stringify(scrollCase)}){
 // Long Japanese rows exercise changing near-window content during scrolling.
 await js('Array.from(document.querySelectorAll(".wb-board-tools button")).find(b=>b.textContent==="日式分镜").click()');
 await wait(()=>js('!!document.querySelector(".wb-japanese")'),'Japanese rows');
 const bodySelector='[data-panel=board] .wb-panel-body';
 const body=await rect(bodySelector);
 const start=await rect(headerSel('shot0'));
 await mouse('mouseMove',start.x+25,start.y+12);await mouse('mouseDown',start.x+25,start.y+12);await mouse('mouseMove',start.x+40,start.y+12);
 await wait(()=>js('!!document.querySelector(".wb-drag-ghost")'),'scroll drag');
 await mouse('mouseMove',body.x+body.width*.5,body.y+body.height-8);
 const scrollBefore=await js('document.querySelector('+JSON.stringify(bodySelector)+').scrollTop');await delay(500);
 assert.ok(await js('document.querySelector('+JSON.stringify(bodySelector)+').scrollTop')>scrollBefore,'drag auto-scroll advances the module');
 await mouse('mouseMove',body.x+body.width*.5,body.y+body.height*.4);
 for(let n=0;n<5;n++){await js('(()=>{const b=document.querySelector('+JSON.stringify(bodySelector)+'),c=document.querySelector("[data-board-id=shot30]");b.scrollTop+=c.getBoundingClientRect().top-b.getBoundingClientRect().top-100})()');await delay(120);}
 const target=await rect('[data-board-id=shot30]');
 const releaseY=Math.min(body.y+body.height-50,target.y+target.height-10);
 await mouse('mouseMove',target.x+40,releaseY);await delay(120);
 const actualTarget=await rect('[data-board-id=shot30]');
 assert.ok(releaseY>actualTarget.y+actualTarget.height/2,'target lower half visible');
 const marker=await rect('.wb-insertion-line');assert.ok(Math.abs(marker.y-(actualTarget.y+actualTarget.height-2))<3,'marker follows current row geometry '+JSON.stringify({marker,actualTarget,releaseY,hit:await js('document.elementFromPoint('+Math.round(target.x+40)+','+Math.round(releaseY)+')?.closest("[data-board-id]")?.dataset.boardId')}));
 await mouse('mouseUp',target.x+40,releaseY);
 await wait(()=>read().shots[30].id==='shot0','scroll insertion after shot30');
 assert.deepEqual(read().shots.map(s=>s.id),[...order.slice(1,31),'shot0',...order.slice(31)]);
 await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="撤销").click()');await wait(()=>read().shots[0].id==='shot0','scroll undo');
 await js('document.querySelector('+JSON.stringify(bodySelector)+').scrollTop=0');await delay(400);
 const g=await rect('.wb-grid');
 await mouse('mouseMove',g.x+3,g.y+3);await mouse('mouseDown',g.x+3,g.y+3);await mouse('mouseMove',g.x+60,g.y+50);
 await wait(()=>js('!!document.querySelector("[data-marquee-active=true]")'),'scroll marquee');
 for(let n=0;n<5;n++){await js('(()=>{const b=document.querySelector('+JSON.stringify(bodySelector)+'),c=document.querySelector("[data-board-id=shot30]");b.scrollTop+=c.getBoundingClientRect().top-b.getBoundingClientRect().top-100})()');await delay(120);}
 const t=await rect('[data-board-id=shot30]');const y=Math.min(body.y+body.height-30,t.y+t.height*.4);
 await mouse('mouseMove',t.x+60,y);await delay(100);
 const expected=await js('(()=>{const g=document.querySelector(".wb-grid").getBoundingClientRect();const end='+JSON.stringify({x:t.x+60,y})+';return Array.from(document.querySelectorAll("[data-board-id]")).filter(e=>{const r=e.getBoundingClientRect();return r.left<end.x&&r.right>g.left+3&&r.top<end.y&&r.bottom>g.top+3}).map(e=>e.dataset.boardId)})()');
 await mouse('mouseUp',t.x+60,y);assert.deepEqual(await selected(),expected);assert.ok(expected.length>20,'marquee crosses initial near window');
 }else{
 // Toolbar: 全选 covers every active board only; Pending keeps its own unticked selection.
 const buttons=await js('Array.from(document.querySelectorAll(".wb-board-selection button")).map(b=>({text:b.textContent,title:b.title,disabled:b.disabled}))');
 assert.equal(buttons.length,2);
 assert.equal(buttons[0].text,'全选');assert.ok(buttons[0].title.includes('⌘/Ctrl+A'));
 assert.equal(buttons[0].disabled,false);
 assert.equal(buttons[1].text,'取消选择');assert.equal(buttons[1].disabled,false);
 await clickAt('.wb-board-selection button');
 await wait(async()=>(await selected()).length===count,'toolbar select all');
 assert.deepEqual(await selected(),order);
 assert.equal(await js('document.querySelectorAll("[data-panel=pending] input[type=checkbox]:checked").length'),0);
 assert.equal(await status(),count+' 张 · '+count+' 已选');
 assert.equal(await js('document.querySelector(".wb-board-selection button:nth-of-type(2)").disabled'),false);
 // Select-all cleared the anchor, so a following Shift click is a fresh single-board range.
 await clickHeader('shot2',{shiftKey:true});
 await wait(async()=>JSON.stringify(await selected())==='["shot2"]','anchor cleared after select all');
 assert.deepEqual(await selected(),['shot2']);

 // 取消选择 empties the board selection without touching the project.
 await clickAt('.wb-board-selection button:nth-of-type(2)');
 await wait(async()=>(await selected()).length===0,'clear selection');
 assert.equal(await status(),count+' 张 · 0 已选');
 assert.equal(await js('document.querySelector(".wb-board-selection button:nth-of-type(2)").disabled'),true);

 // Header modifiers: stable anchor, reverse ranges, discrete toggles and additive ranges.
 await clickHeader('shot1');await wait(async()=>JSON.stringify(await selected())==='["shot1"]','plain click');
 await clickHeader('shot3',{shiftKey:true});assert.deepEqual(await selected(),['shot1','shot2','shot3']);
 await clickHeader('shot0',{shiftKey:true});assert.deepEqual(await selected(),['shot0','shot1']);
 await clickHeader('shot4',{shiftKey:true});assert.deepEqual(await selected(),['shot1','shot2','shot3','shot4']);
 await clickHeader('shot0',{shiftKey:true,metaKey:true});assert.deepEqual(await selected(),order);
 await clickHeader('shot2',{metaKey:true});assert.deepEqual(await selected(),['shot0','shot1','shot3','shot4']);
 await clickHeader('shot2',{ctrlKey:true});assert.deepEqual(await selected(),order);
 await clickHeader('shot3',{metaKey:true});assert.deepEqual(await selected(),['shot0','shot1','shot2','shot4']);
 await clickHeader('shot3',{metaKey:true});assert.deepEqual(await selected(),order);
 // A discrete toggle moved the anchor to shot3; Shift replaces with shot0..shot3.
 await clickHeader('shot0',{shiftKey:true});assert.deepEqual(await selected(),['shot0','shot1','shot2','shot3']);
 // Control-click must not surface a native context menu on the card or its picture.
 assert.equal(await contextMenu(headerSel('shot1'),{ctrlKey:true}),false);
 assert.equal(await contextMenu('[data-board-id=shot3] .wb-card-picture',{ctrlKey:true}),false);

 // Picture modifiers select instead of painting; the canvas is hovered first so a leaking
 // pointerdown would actually place a stroke.
 await clickHeader('shot1');await wait(async()=>JSON.stringify(await selected())==='["shot1"]','anchor for picture');
 const pic=await rect('[data-board-id=shot3] .wb-card-picture');
 await mouse('mouseMove',pic.x+pic.width*.5,pic.y+pic.height*.5);
 await wait(()=>js('!!document.querySelector("[data-board-id=shot3] .stage-overlay")'),'hover canvas');
 const inkBefore=read().images.image3.layers[1].assetId;
 await mouse('mouseDown',pic.x+pic.width*.5,pic.y+pic.height*.5,['shift']);
 await mouse('mouseMove',pic.x+pic.width*.6,pic.y+pic.height*.5,['shift']);
 await mouse('mouseUp',pic.x+pic.width*.6,pic.y+pic.height*.5,['shift']);
 await wait(async()=>JSON.stringify(await selected())==='["shot1","shot2","shot3"]','picture shift range');
 await delay(400);
 assert.equal(read().images.image3.layers[1].assetId,inkBefore);
 assert.equal(await js('!!document.querySelector("[data-live-mirror]")'),false);
 await mouse('mouseDown',pic.x+pic.width*.5,pic.y+pic.height*.5,['meta']);
 await mouse('mouseUp',pic.x+pic.width*.5,pic.y+pic.height*.5,['meta']);
 await wait(async()=>JSON.stringify(await selected())==='["shot1","shot2"]','picture meta toggle');

 // Board-scoped Cmd/Ctrl+A and Shift+Cmd/Ctrl+A; a textarea keeps the native shortcut.
 const prevented=await key('[data-panel=board]',{key:'a',metaKey:true});
 assert.equal(prevented,false);
 await wait(async()=>(await selected()).length===count,'Cmd+A select all');
 const cleared=await key('[data-panel=board]',{key:'a',metaKey:true,shiftKey:true});
 assert.equal(cleared,false);
 await wait(async()=>(await selected()).length===0,'Shift+Cmd+A clear');
 await clickHeader('shot0');
 // An input inside the board panel exercises the exclusion branch itself; the action textarea
 // sits outside the board scope and proves the same shortcut stays native there.
 const boardInput=await key('[aria-label="缩略图大小"]',{key:'a',metaKey:true});
 assert.equal(boardInput,true);
 assert.deepEqual(await selected(),['shot0']);
 const native=await key('[aria-label="动作说明 shot0"]',{key:'a',metaKey:true});
 assert.equal(native,true);
 assert.deepEqual(await selected(),['shot0']);
 assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'动作说明 shot0');

 // Right/middle modified presses must not select (button guard); Escape closes any native menu.
 await clickHeader('shot0');
 const guarded=await rect(headerSel('shot1'));
 await press('mouseDown',guarded,'right',['shift']);await press('mouseUp',guarded,'right',['shift']);
 await press('mouseDown',guarded,'middle',['meta']);await press('mouseUp',guarded,'middle',['meta']);
 await js('document.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
 await delay(150);
 assert.deepEqual(await selected(),['shot0']);

 // Focus starts in an input; a modifier header press must pull focus into the board so the
 // following Cmd+A is board-scoped instead of being left to the old element.
 await js('document.querySelector('+JSON.stringify('[aria-label="动作说明 shot0"]')+').focus()');
 assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'动作说明 shot0');
 await clickHeader('shot2',{metaKey:true});
 assert.equal(await js('document.activeElement.getAttribute("aria-label")'),'选择故事板 shot2');
 assert.deepEqual(await selected(),['shot0','shot2']);
 const scoped=await keyActive({key:'a',metaKey:true});
 assert.equal(scoped,false);
 await wait(async()=>(await selected()).length===count,'Cmd+A after modifier header press from input focus');

 // Selection is UI-only: the checkpoint is byte-identical and the revision never moved.
 assert.deepEqual(read(),baseline);
 assert.equal(await js('document.querySelector("[data-workbench]").dataset.revision'),String(baseline.revision));

 // A modifier press released away from the card never starts a drag and leaves no stale dedupe:
 // the next plain pointerdown must still select normally.
 const aborted=await rect(headerSel('shot1'));
 await mouse('mouseMove',aborted.x+25,aborted.y+12);
 await mouse('mouseDown',aborted.x+25,aborted.y+12,['meta']);
 await mouse('mouseMove',aborted.x+25,aborted.y+80);
 await mouse('mouseUp',aborted.x+25,aborted.y+80,['meta']);
 await delay(200);
 await clickHeader('shot2');
 await wait(async()=>JSON.stringify(await selected())==='["shot2"]','plain click after aborted modifier press');
 assert.deepEqual(read(),baseline);

 // Multi-select drag moves the whole contiguous block, not just the grabbed header.
 await clickHeader('shot1');await clickHeader('shot3',{shiftKey:true});
 assert.deepEqual(await selected(),['shot1','shot2','shot3']);
 const from=await rect('[aria-label="选择故事板 shot3"]'),to=await rect('[aria-label="选择故事板 shot0"]');
 await mouse('mouseMove',from.x+25,from.y+12);
 await mouse('mouseDown',from.x+25,from.y+12);
 await mouse('mouseMove',from.x+40,from.y+12);
 await wait(()=>js('document.querySelector(\'[aria-label="选择故事板 shot3"]\').getAttribute("aria-pressed")==="true"'),'drag activated');
 await delay(250);
 await mouse('mouseMove',to.x+25,to.y+12);
 await delay(300);
 await mouse('mouseUp',to.x+25,to.y+12);
 await wait(()=>read().shots[0].id==='shot1','group reorder');
 assert.deepEqual(read().shots.map(s=>s.id),['shot1','shot2','shot3','shot0','shot4']);
 assert.ok(read().revision>baseline.revision);
 await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="撤销").click()');
 await wait(()=>read().shots[0].id==='shot0','reorder undo');
 assert.deepEqual(read().shots.map(s=>s.id),baseline.shots.map(s=>s.id));
 assert.equal(await js('document.querySelector("[data-workbench]").dataset.revision'),String(read().revision));
 // Marquee starts only in blank grid padding; cards intersected even partly are selected.
 const grid=await rect('.wb-grid'),first=await rect('[data-board-id=shot0]');
 await mouse('mouseMove',grid.x+3,grid.y+3);await mouse('mouseDown',grid.x+3,grid.y+3);
 await mouse('mouseMove',first.x+first.width*.7,first.y+first.height*.5);
 await wait(()=>js('!!document.querySelector("[data-marquee-active=true]")'),'marquee active');
 fs.writeFileSync(${JSON.stringify(path.join(run,'marquee.png'))},(await win.webContents.capturePage()).toPNG());
 await mouse('mouseUp',first.x+first.width*.7,first.y+first.height*.5);
 assert.deepEqual(await selected(),['shot0']);
 const beforeMarquee=read();
 // Cmd toggles against selection at gesture start, not against every intermediate frame.
 await mouse('mouseMove',grid.x+3,grid.y+3);await mouse('mouseDown',grid.x+3,grid.y+3,['meta']);
 await mouse('mouseMove',first.x+first.width*.7,first.y+first.height*.5,['meta']);
 await mouse('mouseMove',first.x+first.width*.6,first.y+first.height*.4,['meta']);
 await mouse('mouseUp',first.x+first.width*.6,first.y+first.height*.4,['meta']);
 assert.deepEqual(await selected(),[]);
 await clickHeader('shot2');
 await mouse('mouseMove',grid.x+3,grid.y+3);await mouse('mouseDown',grid.x+3,grid.y+3);
 await mouse('mouseMove',first.x+first.width*.7,first.y+first.height*.5);
 win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await delay(100);
 await mouse('mouseUp',first.x+first.width*.7,first.y+first.height*.5);
 assert.deepEqual(await selected(),['shot2']);assert.deepEqual(read(),beforeMarquee);
 async function dragStart(id){const r=await rect(headerSel(id));await mouse('mouseMove',r.x+25,r.y+12);await mouse('mouseDown',r.x+25,r.y+12);await mouse('mouseMove',r.x+40,r.y+12);await wait(()=>js('!!document.querySelector(".wb-drag-ghost")'),'static ghost');}
 async function undoOrder(){await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="撤销").click()');await wait(()=>JSON.stringify(read().shots.map(s=>s.id))===JSON.stringify(order),'gesture undo');}
 // Non-contiguous group -> explicit end slot; original geometry must not shift during drag.
 await clickHeader('shot1');await clickHeader('shot3',{metaKey:true});
 const geometry=await js('Array.from(document.querySelectorAll("[data-board-id]")).map(e=>{const r=e.getBoundingClientRect();return [e.dataset.boardId,r.x,r.y]})');
 await dragStart('shot1');const last=await rect('[data-board-id=shot4]');
 await mouse('mouseMove',last.x+last.width-4,last.y+last.height*.5);
 assert.deepEqual(await js('Array.from(document.querySelectorAll("[data-board-id]")).map(e=>{const r=e.getBoundingClientRect();return [e.dataset.boardId,r.x,r.y]})'),geometry);
 assert.equal(await js('document.querySelector(".wb-drag-ghost span").textContent'),'2 张');
 assert.equal(await js('document.querySelector(".wb-insertion-line").hidden'),false);
 fs.writeFileSync(${JSON.stringify(path.join(run,'group-drag.png'))},(await win.webContents.capturePage()).toPNG());
 await mouse('mouseUp',last.x+last.width-4,last.y+last.height*.5);
 await wait(()=>JSON.stringify(read().shots.map(s=>s.id))==='["shot0","shot2","shot4","shot1","shot3"]','noncontiguous append');
 assert.deepEqual(await selected(),['shot1','shot3']);await undoOrder();
 // Escape and outside release do not write a reorder.
 await clickHeader('shot1');await clickHeader('shot3',{metaKey:true});const noDrop=read();
 await dragStart('shot1');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});await delay(100);await mouse('mouseUp',10,10);assert.deepEqual(read(),noDrop);
 await dragStart('shot1');await mouse('mouseMove',10,10);await mouse('mouseUp',10,10);await delay(700);assert.deepEqual(read(),noDrop);
 // Moving all active cards into Pending leaves an actual empty droppable board.
 await clickAt('.wb-board-selection button');await dragStart('shot1');
 const shelf=await rect('.flow-pending-shelf');await mouse('mouseMove',shelf.x+shelf.width-12,shelf.y+25);await mouse('mouseUp',shelf.x+shelf.width-12,shelf.y+25);
 await wait(()=>read().shots.length===0,'all to Pending');
 const restore=await rect('[aria-label="Move pending shot5"]');
 await mouse('mouseMove',restore.x+10,restore.y+10);await mouse('mouseDown',restore.x+10,restore.y+10);await mouse('mouseMove',restore.x+25,restore.y+10);
 const empty=await rect('.wb-grid');await mouse('mouseMove',empty.x+40,empty.y+40);await mouse('mouseUp',empty.x+40,empty.y+40);
 await wait(()=>read().shots.length===1&&read().shots[0].id==='shot5','Pending into empty board');
 assert.equal(read().parkedShots.length,count);
 }
 fs.writeFileSync(${JSON.stringify(path.join(run,'selection.done'))},JSON.stringify({count,order,baselineRevision:baseline.revision}));
 fs.writeFileSync(${JSON.stringify(path.join(run,'selection.png'))},(await win.webContents.capturePage()).toPNG());
 win.close();
}).catch(async e=>{console.error(e);try{if(win&&!win.isDestroyed()){console.error(await js('document.body.innerText'));fs.writeFileSync(${JSON.stringify(path.join(run,'selection-failure.png'))},(await win.webContents.capturePage()).toPNG())}}finally{if(win&&!win.isDestroyed())win.destroy();app.exit(1)}});
`);
execFileSync(process.execPath,['--check',driver]);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const chunks=[],child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>{chunks.push(b);process.stderr.write(b)});
let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL')},180000);
const result=await new Promise(resolve=>{child.on('error',error=>resolve({code:null,error}));child.on('exit',(code,signal)=>resolve({code,signal}))});
clearTimeout(timer);
await writeFile(path.join(run,'selection.log'),Buffer.concat(chunks));
if(timedOut)throw Error('Timed out after 180s: '+run);
if(result.error)throw Error('spawn failed: '+result.error.message);
if(result.code!==0)throw Error('Selection verification failed: '+run);
await readFile(path.join(run,'selection-closed.json'));
await readFile(path.join(run,'selection.done'));
const receipt={...identity,passed:true,scrollCase,cases:[
 'blank-space marquee replace/toggle/cancel, noncontiguous end insertion with stationary geometry, outside/Escape cancellation, Pending empty-board restore',
 'scrollCase: Japanese long-row drag auto-scroll, insertion marker geometry after near-window mounts, marquee across initial near window',
 'toolbar 全选 covers every active board and leaves Pending selection untouched',
 'toolbar 取消选择 empties the board selection and disables itself',
 'select-all clears the anchor so the next Shift click is a single-board range',
 'header plain click replaces, Cmd/Ctrl click toggles, discrete toggle moves the anchor',
 'header Shift ranges work in both directions and keep the anchor across repeated clicks',
 'header Shift+Cmd/Ctrl unions the range with the existing selection',
 'picture Shift/Cmd press selects without starting a stroke and without a live mirror',
 'board-scoped Cmd/Ctrl+A selects all, Shift+Cmd/Ctrl+A clears',
 'Cmd/Ctrl+A inside the action textarea is not hijacked and leaves the board selection alone',
 'right/middle modified presses on a header leave the selection untouched',
 'a modifier header press moves focus from an input into the board so the next Cmd+A is board-scoped',
 'selection never changes the checkpoint or the project revision',
 'multi-select drag moves the contiguous block and Undo restores the original order'
]};
await writeFile(path.join(run,'receipt.json'),JSON.stringify(receipt,null,2));
console.log('PASS',run);
