// Pending table acceptance: the read-only table selects and sorts like the storyboard.
// Covers single-card and group sorting inside Pending (relative order preserved), a precise
// cross-table drop, one undo/redo, persistence across a reopen, and the keyboard path for the
// card's 移回 control. Isolated like the other GUI smokes: temp project, own userData, with
// clipboard and Trash stubbed to throw.
// Run `npm run build` first, then `node scripts/flow-pending-table-smoke.mjs`.
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';import sharp from 'sharp';
import {openFlowAssetDepot} from '../dist-electron/project-files/main/persistence/depot.js';
import {createProjectStore} from '../dist-electron/project-files/main/persistence/index.js';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(import.meta.url),
 get=r=>{if(!r.ok)throw Error(r.error.message);return r.value};
const entry=path.join(repo,'dist-electron/platform/main/flowEditorEntry.js');
if(!existsSync(entry))throw Error('Run npm run build first: '+entry+' is missing');

const phase=process.argv[2]==='reopen'?'reopen':'edit';
const run=phase==='reopen'
 ? process.argv[3]
 : await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-pending-table-'));
const root=path.join(run,'project'),userData=path.join(run,'userData'),checkpoint=path.join(root,'.storyboard-flow/checkpoints/project.json');
if(phase==='edit'){
 await mkdir(root,{recursive:true});await mkdir(userData,{recursive:true});
 const depot=get(await openFlowAssetDepot({root,sessionId:'seed',maxPixels:1000000,maxPngBytes:1000000}));
 const clear=await sharp({create:{width:640,height:360,channels:4,background:'#00000000'}}).png().toBuffer();
 const transparent=get(await depot.put({operationId:'clear',png:clear,width:640,height:360})).assetId;
 const project={schema:'storyboard-flow.project',version:1,id:'pending-table',revision:0,name:'Pending table acceptance',shots:[],parkedShots:[],dialogues:[],images:{}};
 const make=async(i,parked)=>{
  const png=await sharp({create:{width:640,height:360,channels:4,background:{r:200+i%20,g:215+i%25,b:245,alpha:1}}}).png().toBuffer();
  const assetId=get(await depot.put({operationId:'base'+i,png,width:640,height:360})).assetId;
  const shot={id:'shot'+i,imageId:'image'+i,name:String(i+1).padStart(4,'0'),scriptText:'动作 '+i};
  (parked?project.parkedShots:project.shots).push(shot);
  project.images[shot.imageId]={id:shot.imageId,revision:0,width:640,height:360,layers:[{id:'base',name:'背景',kind:'image',locked:true,assetId},
   {id:'ink',name:'绘画',kind:'paint',locked:false,assetId:transparent}].map(l=>({...l,visible:true,opacity:1,blendMode:'normal',width:640,height:360}))};
 };
 // Two boards stay active; four parked shots carry long, multi-paragraph, empty and short lines.
 await make(0);await make(1);
 for(const i of [2,3,4,5])await make(i,true);
 project.dialogues=[
  {id:'l2',shotId:'shot2',text:'这一场她想说的是：不是每一次沉默都等于放弃。\n\n窗外的风把纸门吹得轻轻响了一下，她又把杯子往前推了推。'},
  {id:'l4',shotId:'shot4',text:'门外的脚步声停了一瞬，又走远了；她数着那几步，直到走廊重新安静下来。'}];
 get(await createProjectStore().saveCheckpoint(root,project,async id=>get(await depot.read(id))));
}

const base=phase==='edit'?{head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run}:JSON.parse(await readFile(path.join(run,'identity.json'),'utf8'));
if(phase==='edit')await writeFile(path.join(run,'identity.json'),JSON.stringify(base));

const driver=path.join(run,'table-'+phase+'.cjs');
await writeFile(driver,String.raw`
const {app,BrowserWindow,clipboard,shell}=require('electron'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
shell.trashItem=async()=>{throw Error('Trash forbidden')};
process.argv=[process.argv[0],${JSON.stringify(entry)},${JSON.stringify(root)},${JSON.stringify(userData)},'--workbench'];
let win;const delay=ms=>new Promise(r=>setTimeout(r,ms));const js=c=>win.webContents.executeJavaScript(c);
const read=()=>JSON.parse(fs.readFileSync(${JSON.stringify(checkpoint)},'utf8'));
const order=()=>({active:read().shots.map(s=>s.id),parked:read().parkedShots.map(s=>s.id),dialogues:JSON.stringify(read().dialogues)});
async function wait(fn,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return true}catch{}await delay(60)}throw Error('Timeout '+label)}
const rect=s=>js('(()=>{const e=document.querySelector('+JSON.stringify(s)+');if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}})()');
const move=(x,y)=>win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(x),y:Math.round(y)});
const down=(x,y)=>win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
const up=(x,y)=>win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
async function click(x,y){move(x,y);await delay(40);down(x,y);await delay(60);up(x,y);await delay(200)}
async function dragTo(from,to,steps=8){move(from.x,from.y);await delay(60);down(from.x,from.y);await delay(90);move(from.x+8,from.y+4);await delay(90);
 for(let i=1;i<=steps;i++){move(from.x+(to.x-from.x)*i/steps,from.y+(to.y-from.y)*i/steps);await delay(70)}
 await delay(140);up(to.x,to.y);await delay(350)}
const settle=async()=>{await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("已自动暂存")'),'autostash');await delay(120)};
const selPending=()=>js('Array.from(document.querySelectorAll(".flow-pending-shelf [data-pending-shot-id].is-selected")).map(e=>e.dataset.pendingShotId)');
const cardPoint=async(id,sel)=>{await js('(()=>{const c=document.querySelector('+JSON.stringify('[data-pending-shot-id="'+id+'"]')+');if(!c)return;const b=c.closest(".wb-panel-body");b.scrollTop=Math.max(0,c.offsetTop-b.clientHeight/2+c.clientHeight/2)})()');await delay(280);
 return js('(()=>{const c=document.querySelector('+JSON.stringify('[data-pending-shot-id="'+id+'"]')+'),e=c.querySelector('+JSON.stringify(sel||'.wb-card-picture')+');if(!e)return null;const b=c.closest(".wb-panel-body"),br=b.getBoundingClientRect(),r=e.getBoundingClientRect();const top=Math.max(r.top,br.top,0),bottom=Math.min(r.bottom,br.bottom,innerHeight);if(bottom-top<10)return null;for(let y=Math.round((top+bottom)/2);y<bottom-2;y+=4){const h=document.elementFromPoint(Math.round(r.left+r.width/2),y);if(h&&c.contains(h)&&!h.closest("[data-no-drag]"))return {x:Math.round(r.left+r.width/2),y,hit:((h.className||"")+"|"+h.tagName)}}return null})()')};
const dropAbove=id=>js('(()=>{const c=document.querySelector('+JSON.stringify('[data-pending-shot-id="'+id+'"]')+'),r=c.getBoundingClientRect();for(let y=Math.round(r.top+5);y<r.top+40;y+=4){const h=document.elementFromPoint(Math.round(r.left+r.width/2),y);if(h&&c.contains(h))return {x:Math.round(r.left+r.width/2),y}}return null})()');
const undo=async()=>{await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="撤销").click()');await delay(250);await settle()};
const redo=async()=>{await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="重做").click()');await delay(250);await settle()};
const cardClick=(id,mods)=>js('(()=>{const e=document.querySelector('+JSON.stringify('[data-pending-shot-id="'+id+'"] .wb-card-picture')+');e.dispatchEvent(new MouseEvent("click",{bubbles:true,'+(mods||'')+'}))})()');

import('file://'+${JSON.stringify(entry)}).then(async()=>{
 await app.whenReady();
 await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');
 win.setSize(1500,980);win.show();win.focus();app.focus({steal:true});
 await wait(()=>js('!!document.querySelector(".flow-pending-shelf .wb-card")'),'pending cards');
 // A tall Pending panel so two cards and a drop anchor are on screen together.
 await js('localStorage.setItem("flow.workbench.layout.v2",JSON.stringify({layout:[["board","pending"],["canvas","info","layers"]],hidden:[],split:48,tile:220,zoom:"fit",japanese:false,collapsed:[false,false],heights:{board:400,pending:620},pendingTile:300}))');
 win.webContents.reload();
 await wait(()=>js('!!document.querySelector(".flow-pending-shelf .wb-card")'),'reload cards');
 await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("已自动暂存")'),'reload checkpoint');
 await delay(500);
 const canvasShot=()=>js('document.querySelector("[data-current-shot]")?.dataset.currentShot');
  const point=(id,where)=>js('(()=>{const c=document.querySelector('+JSON.stringify('[data-pending-shot-id="'+id+'"]')+'),r=c.getBoundingClientRect();'+
   'const y=Math.round(r.top+r.height/2);if('+JSON.stringify(where)+'==="left")return {x:Math.round(r.left+r.width*0.25),y};'+
   'if('+JSON.stringify(where)+'==="right")return {x:Math.round(r.left+r.width*0.75),y};'+
   'const cards=Array.from(document.querySelectorAll(".wb-pending-grid [data-pending-shot-id]"));'+
   'if('+JSON.stringify(where)+'==="below"){const last=cards[cards.length-1].getBoundingClientRect();return {x:Math.round(last.right+8),y:Math.round(last.top+last.height/2)}}'+
   'const i=cards.indexOf(c),n=cards[i+1];'+
   'const x=n?Math.round((r.right+n.getBoundingClientRect().left)/2):Math.round(r.right+24);return {x,y}})()');
  // Resolve the drop point after the grab point: centring a card can scroll the panel.
  const without=(from,moving)=>from.filter(x=>!(Array.isArray(moving)?moving:[moving]).includes(x));
  const before=(from,moving,target)=>{const rest=without(from,moving),m=Array.isArray(moving)?moving:[moving],at=rest.indexOf(target);return [...rest.slice(0,at),...m,...rest.slice(at)]};
  const after=(from,moving,target)=>{const rest=without(from,moving),m=Array.isArray(moving)?moving:[moving],at=rest.indexOf(target)+1;return [...rest.slice(0,at),...m,...rest.slice(at)]};
  const dragOnto=async(id,targetId,where)=>{const from=await cardPoint(id);assert.ok(from,'grab '+id);const to=await point(targetId,where);assert.ok(to,'drop '+targetId);await dragTo(from,to);await settle()};

 const start=order(),canvas0=await canvasShot();


 if(${JSON.stringify(phase)}==='edit'){
  assert.deepEqual(start.parked,['shot2','shot3','shot4','shot5'],'fixture parked order');
  assert.deepEqual(start.active,['shot0','shot1'],'fixture active order');
  // 1. single card sorted inside Pending
  await dragOnto('shot5','shot2','left');
  assert.deepEqual(order().parked,before(start.parked,'shot5','shot2'),'a card dropped on the left half moves in front');
  assert.equal(order().dialogues,start.dialogues,'sorting leaves dialogue untouched');
  await undo();assert.deepEqual(order().parked,start.parked,'one undo restores the sort');
  await redo();assert.deepEqual(order().parked,before(start.parked,'shot5','shot2'),'redo re-applies the sort');
  await undo();assert.deepEqual(order().parked,start.parked,'undo again');
  // 2. a selected group sorts inside Pending and keeps its relative order
  await cardClick('shot3');await cardClick('shot4','metaKey:true');await delay(200);
  assert.deepEqual(await selPending(),['shot3','shot4'],'group selected in Pending');
  await dragOnto('shot3','shot2','left');
  assert.deepEqual(order().parked,before(start.parked,['shot3','shot4'],'shot2'),'group keeps relative order when sorted up');
  assert.deepEqual(await selPending(),['shot3','shot4'],'selection follows the group');
  await undo();assert.deepEqual(order().parked,start.parked,'one undo restores the group sort');
  // 3. a precise cross-table drop, then undo and redo
  await cardClick('shot2');await cardClick('shot3','metaKey:true');await delay(200);
  const anchor=await js('(()=>{const c=document.querySelector("[data-board-id=\\"shot1\\"]"),r=c.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+10)}})()');
  await dragTo(await cardPoint('shot2'),anchor);await settle();
  assert.deepEqual(order().active,['shot0','shot2','shot3','shot1'],'group drops at the requested board position');
  assert.deepEqual(order().parked,['shot4','shot5'],'the other parked shots stay put');
  assert.equal(order().dialogues,start.dialogues,'cross-table move leaves dialogue untouched');
  await undo();assert.deepEqual(order().active,start.active,'one undo restores the cross-table move');
  assert.deepEqual(order().parked,start.parked,'undo returns the parked group');
  await redo();assert.deepEqual(order().active,['shot0','shot2','shot3','shot1'],'redo re-applies the move');
  await undo();assert.deepEqual(order().active,start.active,'undo again after redo');
  assert.equal(await canvasShot(),canvas0,'Pending work never switches the right-hand canvas');
  // 4. keyboard path for the card control: Tab reaches it, focus makes it visible, Enter moves
  // exactly that shot, focus stays on the card region, and one undo brings it back.
  await js('document.activeElement instanceof HTMLElement && document.activeElement.blur()');
  await js('document.querySelector(".wb-panel-board, [data-panel=board]")?.focus?.()');
  let reached=false;
  for(let i=0;i<40&&!reached;i++){
   win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
   await delay(90);
   reached=await js('document.activeElement?.getAttribute && document.activeElement.getAttribute("aria-label")==="Restore shot4"');
  }
  assert.ok(reached,'Tab reaches the card 移回 control');
  const focusState=await js('(()=>{const b=document.activeElement,c=b.closest(".wb-card"),corner=c.querySelector(".wb-card-corner");const s=getComputedStyle(corner),f=getComputedStyle(b);return {corner:s.opacity,outline:f.outlineStyle+" "+f.outlineWidth,shadow:f.boxShadow,visible:corner.getBoundingClientRect().width>0}})()');
  assert.equal(focusState.corner,'1','focus reveals the 移回 control');
  assert.ok(focusState.visible,'control has a box while focused');
  assert.ok(focusState.outline!=='none 0px'||focusState.shadow!=='none','focused control shows a focus indicator: '+JSON.stringify(focusState));
  const pendingCount=()=>js('document.querySelectorAll(".wb-pending-grid [data-pending-shot-id]").length');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
  win.webContents.sendInputEvent({type:'char',keyCode:'\r'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await wait(async()=>await pendingCount()===3,'Enter activates the focused control');
  await settle();
  assert.deepEqual(order().active,['shot0','shot1','shot4'],'Enter moves only the focused card back, to the end');
  assert.deepEqual(order().parked,['shot2','shot3','shot5'],'the rest of Pending is untouched');
  assert.equal(await js('document.activeElement?.getAttribute("aria-label")'),'Restore shot5','focus moves to the next Pending card control');
  assert.equal(await js('getComputedStyle(document.activeElement.closest(".wb-card").querySelector(".wb-card-corner")).opacity'),'1','the receiving control is visible too');
  await undo();assert.deepEqual(order().parked,start.parked,'one undo restores the keyboard move');
  assert.equal(await canvasShot(),canvas0,'keyboard work never switches the right-hand canvas');

  // 5. Two-dimensional insertion inside the Pending grid, the same rule as the board:
  // right half inserts after, left half before, a gap takes the next card's side, a card in
  // the second row wins over the first, and pointing past the last row appends.
  await dragOnto('shot5','shot3','right');
  assert.deepEqual(order().parked,after(start.parked,'shot5','shot3'),'right half inserts after the card');
  await undo();
  await dragOnto('shot4','shot2','left');
  assert.deepEqual(order().parked,before(start.parked,'shot4','shot2'),'left half inserts before the card');
  await undo();
  await dragOnto('shot5','shot2','gap');
  assert.deepEqual(order().parked,before(start.parked,'shot5','shot3'),'the gap between two cards takes the next side');
  await undo();
  await dragOnto('shot2','shot4','right');
  assert.deepEqual(order().parked,after(start.parked,'shot2','shot4'),'a second-row card wins over the first row');
  await undo();
  await dragOnto('shot2','shot5','below');
  assert.deepEqual(order().parked,[...without(start.parked,'shot2'),'shot2'],'dropping past the last row appends');
  await undo();
  assert.deepEqual(order().parked,start.parked,'every geometry case returns to the fixture');
  assert.equal(order().dialogues,start.dialogues,'geometry cases leave dialogue untouched');
  assert.equal(await canvasShot(),canvas0,'geometry cases never switch the canvas');

  // 6. A group dropped between two cards keeps its own order.
  await cardClick('shot4');await cardClick('shot5','metaKey:true');await delay(200);
  await dragOnto('shot4','shot2','left');
  assert.deepEqual(order().parked,before(start.parked,['shot4','shot5'],'shot2'),'group keeps relative order at the new slot');
  assert.deepEqual(await selPending(),['shot4','shot5'],'the group stays selected after a Pending move');
  await undo();
  assert.deepEqual(order().parked,start.parked,'one undo restores the group move');

  // 7. A target that starts outside the viewport: the drag scrolls the Pending panel itself
  // and the drop lands on the card that was hidden at pick-up time.
  // A narrow window keeps the Pending grid to a couple of columns, so with a short panel the
  // lower row really starts outside the visible box.
  win.setSize(900,760);await delay(300);
  await js('localStorage.setItem("flow.workbench.layout.v2",JSON.stringify({layout:[["board","pending"],["canvas","info","layers"]],hidden:[],split:60,tile:200,zoom:"fit",japanese:false,collapsed:[false,false],heights:{board:380,pending:170},pendingTile:300}))');
  win.webContents.reload();
  await wait(()=>js('!!document.querySelector(".flow-pending-shelf .wb-card")'),'reload small panel');
  await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("已自动暂存")'),'small panel checkpoint');
  await delay(500);
  await js('(()=>{const b=document.querySelector(".flow-pending-shelf").closest(".wb-panel-body");b.scrollTop=0})()');await delay(250);
  const hiddenBefore=await js('(()=>{const c=document.querySelector('+JSON.stringify('[data-pending-shot-id="shot5"]')+'),b=c.closest(".wb-panel-body"),r=c.getBoundingClientRect(),br=b.getBoundingClientRect();return {outside:r.top>br.bottom-8,scroll:b.scrollTop}})()');
  assert.equal(hiddenBefore.outside,true,'the last card starts outside the visible Pending panel');
  const boardScrollBefore=await js('document.querySelector("[data-panel=board] .wb-panel-body").scrollTop');
  const edgeBox=await js('(()=>{const b=document.querySelector(".flow-pending-shelf").closest(".wb-panel-body"),r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.bottom-6)}})()');
  const dragStart=await cardPoint('shot2');
  assert.ok(dragStart,'grab for the scroll case');
  move(dragStart.x,dragStart.y);await delay(80);down(dragStart.x,dragStart.y);await delay(100);move(dragStart.x+8,dragStart.y+4);await delay(100);
  move(edgeBox.x,edgeBox.y);await delay(1500);
  const scrolled=await js('document.querySelector(".flow-pending-shelf").closest(".wb-panel-body").scrollTop');
  assert.ok(scrolled>0,'dragging at the panel edge scrolls the Pending panel, not the board');
  const boardScroll=await js('document.querySelector("[data-panel=board] .wb-panel-body").scrollTop');
  assert.equal(boardScroll,boardScrollBefore,'the storyboard panel keeps its scroll while Pending scrolls');
  const lastCard=await js('(()=>{const c=document.querySelector('+JSON.stringify('[data-pending-shot-id="shot5"]')+'),r=c.getBoundingClientRect();return {x:Math.round(r.left+r.width*0.25),y:Math.round(r.top+r.height/2)}})()');
  move(lastCard.x,lastCard.y);await delay(300);up(lastCard.x,lastCard.y);await delay(400);await settle();
  assert.deepEqual(order().parked,before(start.parked,'shot2','shot5'),'the drop lands on a card revealed by auto-scroll');
  await undo();
  assert.deepEqual(order().parked,start.parked,'one undo restores the scrolled drop');

  // 8. Empty table: a board card drops into the empty Pending grid, and when the keyboard
  // empties it again focus lands on the toolbar, where the next Tab still reaches a control.
  win.setSize(1500,980);await delay(300);
  await js('localStorage.setItem("flow.workbench.layout.v2",JSON.stringify({layout:[["board","pending"],["canvas","info","layers"]],hidden:[],split:48,tile:220,zoom:"fit",japanese:false,collapsed:[false,false],heights:{board:400,pending:620}}))');
  win.webContents.reload();
  await wait(()=>js('!!document.querySelector(".flow-pending-shelf .wb-card")'),'reload for empty table');
  await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("已自动暂存")'),'empty table checkpoint');
  await delay(500);
  // The toolbar has no buttons for this any more: ⌘A selects the table, the selection drags out.
  await cardClick('shot2');await delay(120);
  await js('(()=>{const c=document.querySelector("[data-pending-shot-id=shot2] .wb-card-picture");c.dispatchEvent(new KeyboardEvent("keydown",{key:"a",metaKey:true,bubbles:true}))})()');
  await wait(async()=>(await selPending()).length===4,'⌘A selects the whole Pending table');
  const boardBody=await js('(()=>{const b=document.querySelector("[data-panel=board] .wb-panel-body"),r=b.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.bottom-24)}})()');
  await dragTo(await cardPoint('shot2'),boardBody);await settle();
  assert.deepEqual(order().parked,[],'the Pending table is now empty');
  assert.equal(await js('document.querySelectorAll(".wb-pending-grid [data-pending-shot-id]").length'),0,'no cards are rendered');
  const emptySpot=await js('(()=>{const s=document.querySelector(".flow-pending-shelf"),r=s.getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.bottom-40)}})()');
  await js('(()=>{const b=document.querySelector("[data-panel=board] .wb-panel-body");b.scrollTop=0})()');await delay(250);
  const boardCard=await js('(()=>{const c=document.querySelector("[data-board-id=shot0] .wb-card-handle"),r=c.getBoundingClientRect(),b=c.closest(".wb-panel-body").getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(Math.max(r.top+8,b.top+10))}})()');
  await dragTo(boardCard,emptySpot);await settle();
  assert.equal(order().parked.length,1,'a board card drops into the empty table');
  assert.equal(order().parked[0],'shot0','the empty table takes the dropped card');
  // Keyboard empties it again: focus must not fall back to the body.
  await cardPoint(order().parked[0]);
  const took=await js('(()=>{const b=document.querySelector(".wb-pending-restore");b.focus();return {ok:document.activeElement===b,now:(document.activeElement.className||"")+"|"+(document.activeElement.tagName)}})()');
  assert.equal(took.ok,true,'the last card control takes focus: '+JSON.stringify(took));
  await delay(200);
  assert.equal(await js('getComputedStyle(document.activeElement.closest(".wb-card").querySelector(".wb-card-corner")).opacity'),'1','focus reveals the control on the last card');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Enter'});
  win.webContents.sendInputEvent({type:'char',keyCode:'\r'});
  win.webContents.sendInputEvent({type:'keyUp',keyCode:'Enter'});
  await wait(()=>js('!document.querySelector(".wb-pending-grid [data-pending-shot-id]")'),'keyboard empties the table');
  await settle();
  assert.deepEqual(order().parked,[],'the keyboard emptied the table');
  assert.equal(await js('!!document.activeElement && document.activeElement.className.includes("wb-pending-tools")'),true,'focus lands on the Pending toolbar');
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
  await delay(250);
  const afterTab=await js('(()=>{const a=document.activeElement;return {isBody:a===document.body,tag:a.tagName,label:a.getAttribute&&a.getAttribute("aria-label"),text:(a.textContent||"").slice(0,12),inside:!!a.closest(".flow-workbench")}})()');
  assert.equal(afterTab.isBody,false,'the next Tab leaves the toolbar for a real control');
  assert.equal(afterTab.inside,true,'that control is inside the workbench: '+JSON.stringify(afterTab));
  // Restore the fixture state for the reopen phase.
  for(let i=0;i<6;i++){
   const state=order();
   if(JSON.stringify(state.parked)===JSON.stringify(start.parked)&&JSON.stringify(state.active)===JSON.stringify(start.active))break;
   await undo();
  }
  assert.deepEqual(order().parked,start.parked,'fixture parked order restored before reopen');
  assert.deepEqual(order().active,start.active,'fixture active order restored before reopen');
 }else{
  // Reopen: the committed order survived, Pending starts with no selection, and the same
  // control still works from the keyboard.
  const reopened=order();
  assert.deepEqual(reopened.parked,['shot2','shot3','shot4','shot5'],'parked order persisted across reopen');
  assert.deepEqual(reopened.active,['shot0','shot1'],'active order persisted across reopen');
  assert.deepEqual(await selPending(),[],'reopen starts with no Pending selection');
  assert.equal(await js('document.querySelectorAll(".flow-pending-shelf [data-pending-shot-id]").length'),4,'every parked card is rendered');
 }
 fs.writeFileSync(${JSON.stringify(path.join(run,'phase-'))}+${JSON.stringify(phase)}+'.done',JSON.stringify({order:order(),canvas:await canvasShot()}));
 win.close();
}).catch(async e=>{console.error(e);try{if(win&&!win.isDestroyed())fs.writeFileSync(${JSON.stringify(path.join(run,phase+'-failure.png'))},(await win.webContents.capturePage()).toPNG());}finally{if(win&&!win.isDestroyed())win.destroy();app.exit(1)}});
`);
execFileSync(process.execPath,['--check',driver]);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const chunks=[],child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
let spawnError;
child.on('error',error=>{spawnError=error;console.error('spawn failed: '+error.message)});
child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>chunks.push(b));
const code=await new Promise(resolve=>{const watchdog=setTimeout(()=>{try{child.kill('SIGKILL')}catch{}resolve('watchdog')},240000);child.on('exit',c=>{clearTimeout(watchdog);resolve(c)})});
const output=Buffer.concat(chunks).toString();
console.log(output.trim());
if(spawnError||code!==0)throw Error('Pending table verification failed ('+code+'): '+run);
if(phase==='edit'){
 const reopened=execFileSync(process.execPath,[fileURLToPath(import.meta.url),'reopen',run],{encoding:'utf8',stdio:'inherit'});
 console.log('reopen phase done');
}else{
 console.log('PASS '+run+' head='+base.head);
}
