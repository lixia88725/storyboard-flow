// Japanese sheet sizing acceptance: the storyboard toolbar's one size slider drives the
// Japanese rows too. Covers: the slider value survives the mode switch, the picture column
// follows the tile size and the row height follows the picture's aspect ratio, the slider
// control sits at the same place in both modes, a narrow panel clamps the picture column
// instead of overflowing, the row stays editable, sorting still works, and a reopen keeps
// the chosen size. Isolated: temp project, own userData, clipboard and Trash stubbed.
// Run `npm run build` first, then `node scripts/flow-japanese-sizing-smoke.mjs`.
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

const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-japanese-sizing-'));
const root=path.join(run,'project'),userData=path.join(run,'userData'),checkpoint=path.join(root,'.storyboard-flow/checkpoints/project.json');

{
 await mkdir(root,{recursive:true});await mkdir(userData,{recursive:true});
 const depot=get(await openFlowAssetDepot({root,sessionId:'seed',maxPixels:1000000,maxPngBytes:1000000}));
 const clear=await sharp({create:{width:640,height:360,channels:4,background:'#00000000'}}).png().toBuffer();
 const transparent=get(await depot.put({operationId:'clear',png:clear,width:640,height:360})).assetId;
 const project={schema:'storyboard-flow.project',version:1,id:'japanese-sizing',revision:0,name:'Japanese sizing acceptance',shots:[],parkedShots:[],dialogues:[],images:{}};
 for(const i of [0,1,2]){
  const png=await sharp({create:{width:640,height:360,channels:4,background:{r:205+i*10,g:212,b:240,alpha:1}}}).png().toBuffer();
  const assetId=get(await depot.put({operationId:'base'+i,png,width:640,height:360})).assetId;
  const shot={id:'shot'+i,imageId:'image'+i,name:String(i+1).padStart(4,'0'),scriptText:'动作说明 '+i+'：她停在门口，听见走廊尽头的水声。'};
  project.shots.push(shot);
  project.images[shot.imageId]={id:shot.imageId,revision:0,width:640,height:360,layers:[{id:'base',name:'背景',kind:'image',locked:true,assetId},
   {id:'ink',name:'绘画',kind:'paint',locked:false,assetId:transparent}].map(l=>({...l,visible:true,opacity:1,blendMode:'normal',width:640,height:360}))};
 }
 project.dialogues=[{id:'l0',shotId:'shot0',text:'她：门没关。'}];
 get(await createProjectStore().saveCheckpoint(root,project,async id=>get(await depot.read(id))));
}

const base={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run};

const driver=path.join(run,'jp.cjs');
await writeFile(driver,String.raw`
const {app,BrowserWindow,clipboard,shell}=require('electron'),fs=require('node:fs'),assert=require('node:assert/strict');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
shell.trashItem=async()=>{throw Error('Trash forbidden')};
process.argv=[process.argv[0],${JSON.stringify(entry)},${JSON.stringify(root)},${JSON.stringify(userData)},'--workbench'];
let win;const delay=ms=>new Promise(r=>setTimeout(r,ms));const js=c=>win.webContents.executeJavaScript(c);
const read=()=>JSON.parse(fs.readFileSync(${JSON.stringify(checkpoint)},'utf8'));
const order=()=>read().shots.map(s=>s.id);
async function wait(fn,label,ms=25000){const end=Date.now()+ms;while(Date.now()<end){try{if(await fn())return true}catch{}await delay(60)}throw Error('Timeout '+label)}
const settle=async()=>{await wait(()=>js('document.querySelector(".wb-status [role=status]").textContent.startsWith("已自动暂存")'),'autostash');await delay(120)};
const move=(x,y)=>win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(x),y:Math.round(y)});
const down=(x,y)=>win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
const up=(x,y)=>win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
const setTile=async value=>{await js('(()=>{const i=document.querySelector(".wb-board-tools input[type=range]");const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,'+JSON.stringify(String(value))+');i.dispatchEvent(new Event("input",{bubbles:true}));i.dispatchEvent(new Event("change",{bubbles:true}))})()');await delay(320);await settle()};
const slider=()=>js('(()=>{const i=document.querySelector(".wb-board-tools input[type=range]"),r=i.getBoundingClientRect();return {value:Number(i.value),x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width)}})()');
const mode=async japanese=>{await js('document.querySelector('+JSON.stringify(japanese?'[title="日式分镜（镜号、画面、动作与台词）"]':'[title="网格视图（美式故事板）"]')+').click()');await delay(450);await settle()};
const shot=()=>js('(()=>{try{const g=document.querySelector(".wb-grid"),c=g.querySelector("[data-board-id]");if(!c)return null;'+
 'const pic=c.querySelector(".wb-card-picture"),info=c.querySelector(".wb-info"),body=g.closest(".wb-panel-body");'+
 'const r=pic.getBoundingClientRect(),cr=c.getBoundingClientRect(),br=body.getBoundingClientRect();'+
 'const ta=c.querySelector("textarea");'+
 'return {japanese:g.classList.contains("wb-japanese"),picWidth:Math.round(r.width*10)/10,picHeight:Math.round(r.height*10)/10,'+
 'ratio:Math.round(r.height/r.width*1000)/1000,cardWidth:Math.round(cr.width*10)/10,cardHeight:Math.round(cr.height*10)/10,'+
 'infoWidth:info?Math.round(info.getBoundingClientRect().width*10)/10:null,panelWidth:Math.round(br.width*10)/10,'+
 'overflowX:g.scrollWidth-g.clientWidth,bodyOverflowX:body.scrollWidth-body.clientWidth,'+
 'handle:!!c.querySelector(".wb-card-handle"),textarea:!!ta,grip:!!c.querySelector(".wb-card-grip")}}catch(e){return {error:String(e&&e.message||e)}}})()');
const textEditable=async()=>{const ok=await js('(()=>{const ta=document.querySelector(".wb-grid [data-board-id] textarea");if(!ta)return "missing";ta.focus();return document.activeElement===ta?"focused":"not-focused"})()');if(ok!=="focused")return ok;
 win.webContents.sendInputEvent({type:'char',keyCode:'x'});await delay(120);return js('(()=>{const ta=document.activeElement;return ta&&ta.tagName==="TEXTAREA"?"typed":"lost"})()')};

import('file://'+${JSON.stringify(entry)}).then(async()=>{
 await app.whenReady();
 await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');
 win.setSize(1500,980);win.show();win.focus();app.focus({steal:true});
 await wait(()=>js('!!document.querySelector(".wb-grid [data-board-id]")'),'cards');
 await js('localStorage.setItem("flow.workbench.layout.v2",JSON.stringify({layout:[["board","pending"],["canvas","info","layers"]],hidden:["pending"],split:48,tile:220,pendingTile:170,zoom:"fit",japanese:false,collapsed:[false,false],heights:{board:760}}))');
 win.webContents.reload();
 await wait(()=>js('!!document.querySelector(".wb-grid [data-board-id]")'),'reload cards');
 await settle();await delay(400);

 if(true){
  // 1. The grid view already scales with the slider; record it as the reference.
  await setTile(150);
  const grid150=await shot();assert.equal(grid150.error,undefined,'shot measurement: '+JSON.stringify(grid150));
  assert.equal(grid150.japanese,false,'starts in the grid view');
  assert.ok(Math.abs(grid150.picWidth-150)<=30,'the grid card follows the same slider: '+grid150.picWidth);
  const sliderGrid150=await slider();

  // 2. Switching to the Japanese sheet keeps the value and applies it to the row.
  await mode(true);
  const jp150=await shot(),sliderJp150=await slider();assert.equal(jp150.error,undefined,'shot measurement: '+JSON.stringify(jp150));
  assert.equal(jp150.japanese,true,'the Japanese view is on');
  assert.equal(sliderJp150.value,150,'the switch does not reset the size slider');
  assert.equal(jp150.picWidth,150,'the Japanese picture column is the same 150: '+jp150.picWidth);
  assert.deepEqual({x:sliderJp150.x,y:sliderJp150.y,width:sliderJp150.width},{x:sliderGrid150.x,y:sliderGrid150.y,width:sliderGrid150.width},'the slider sits at the same place in both modes');
  assert.ok(Math.abs(jp150.ratio-0.5625)<0.02,'the row keeps the picture aspect ratio: '+jp150.ratio);
  assert.ok(jp150.handle&&jp150.textarea&&jp150.grip,'the number rail, the text field and the grip are all still there');
  assert.equal(await textEditable(),'typed','a Japanese row is still editable');
  await js('document.activeElement.blur()');

  // 3. Dragging right grows the picture and the row, and the grid view keeps the value.
  const sizes=[];
  for(const v of [300,460]){
   await setTile(v);
   const s=await shot();
   // The picture column is the tile size until the panel can no longer spare 210px of text.
   const expected=Math.max(88,Math.min(v,s.cardWidth-254));
   assert.ok(Math.abs(s.picWidth-expected)<=2,'at '+v+' the Japanese picture is '+Math.round(expected)+': '+s.picWidth);
   assert.ok(Math.abs(s.picHeight-s.picWidth*0.5625)<3,'the row height follows the picture: '+s.picHeight);
   assert.ok(s.infoWidth>=200,'动作与台词 keep their column: '+s.infoWidth);
   assert.ok(s.overflowX<=1&&s.bodyOverflowX<=1,'a wide row does not overflow');
   sizes.push(s);
  }
  assert.ok(sizes[1].picWidth>sizes[0].picWidth&&sizes[1].cardHeight>sizes[0].cardHeight,'the row grows with the slider');
  const sliderJp460=await slider();
  await mode(false);
  const sliderGrid460=await slider();
  assert.equal(sliderGrid460.value,460,'switching back to the grid keeps the size');
  assert.deepEqual({x:sliderGrid460.x,y:sliderGrid460.y},{x:sliderJp460.x,y:sliderJp460.y},'the slider never moves between modes');

  // 4. A narrow board panel clamps the picture column instead of pushing the text out.
  await mode(true);
  win.setSize(620,900);await delay(700);await settle();
  const narrow=await shot();
  assert.ok(narrow.picWidth<460,'the narrow panel shrinks the picture column: '+narrow.picWidth);
  assert.ok(narrow.picWidth>=88,'the picture column keeps its floor: '+narrow.picWidth);
  assert.ok(narrow.infoWidth>=100,'动作与台词 keep usable width: '+narrow.infoWidth);
  assert.ok(narrow.overflowX<=1&&narrow.bodyOverflowX<=1,'the narrow row does not overflow: '+JSON.stringify({g:narrow.overflowX,b:narrow.bodyOverflowX}));
  assert.ok(narrow.cardWidth<=narrow.panelWidth+1,'the row stays inside the panel');
  assert.equal(await textEditable(),'typed','a narrow Japanese row is still editable');
  await js('document.activeElement.blur()');

  // 5. Sorting still works on the sheet: drop the first row on the last row's lower half.
  win.setSize(1500,980);await delay(600);await settle();
  const start=order();
  // The grab and the drop must both land on their own rows: a drop that slips onto the
  // Pending shelf would move the board there instead of sorting the sheet.
  await js('(()=>{const b=document.querySelector("[data-panel=board] .wb-panel-body");b.scrollTop=0})()');await delay(260);
  const grab=await js('(()=>{const c=document.querySelector("[data-board-id=shot0]"),h=c.querySelector(".wb-card-handle"),r=h.getBoundingClientRect();'+
   'const x=Math.round(r.left+r.width/2),y=Math.round(r.top+10);const hit=document.elementFromPoint(x,y);'+
   'return hit&&hit.closest("[data-board-id=shot0]")?{x,y}:null})()');
  assert.ok(grab,'the grab point sits on the first row');
  const target=await js('(()=>{const c=document.querySelector("[data-board-id=shot2]"),r=c.getBoundingClientRect(),b=c.closest(".wb-panel-body").getBoundingClientRect();'+
   'const x=Math.round(r.left+r.width/2);'+
   'for(let y=Math.round(Math.min(r.bottom,b.bottom)-10);y>r.top+4;y-=4){const hit=document.elementFromPoint(x,y);'+
   'const card=hit&&hit.closest("[data-board-id]");if(card&&card.dataset.boardId==="shot2")return {x,y}}return null})()');
  assert.ok(target,'the drop point sits on the last row, not on the Pending shelf');
  move(grab.x,grab.y);await delay(80);down(grab.x,grab.y);await delay(100);move(grab.x+8,grab.y+6);await delay(100);
  for(let i=1;i<=8;i++){move(grab.x+(target.x-grab.x)*i/8,grab.y+(target.y-grab.y)*i/8);await delay(70)}
  await delay(160);up(target.x,target.y);await delay(400);await settle();
  assert.deepEqual(order(),['shot1','shot2','shot0'],'a Japanese row sorts by dragging its number rail');
  assert.deepEqual(read().parkedShots.map(s=>s.id),[],'sorting the sheet leaves Pending empty');
  await js('Array.from(document.querySelectorAll("button")).find(b=>b.textContent==="撤销").click()');await delay(300);await settle();
  assert.deepEqual(order(),start,'one undo restores the row order');
  // 6. A reload re-reads the stored layout: the sheet opens in Japanese at the same size.
  win.webContents.session.flushStorageData();await delay(300);
  win.webContents.reload();
  await wait(()=>js('!!document.querySelector(".wb-grid [data-board-id]")'),'reload');
  await delay(900);await settle();
  const back=await shot(),backSlider=await slider();
  assert.equal(back.japanese,true,'the Japanese view survives a reopen');
  assert.equal(backSlider.value,460,'the chosen size survives a reopen');
  assert.ok(Math.abs(back.picWidth-Math.max(88,Math.min(460,back.cardWidth-254)))<=2,'the row opens at the stored width: '+back.picWidth);
  console.log('PASS japanese sizing, reopen included');
 }
 app.exit(0);
}).catch(e=>{console.error(e&&e.stack||e);app.exit(1)});
`);

const child=spawn(require('electron'),[driver],{env:{...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'1'},stdio:['ignore','pipe','pipe']});
let out='';child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>out+=d);
const code=await new Promise(r=>child.on('exit',r));
if(process.env.FLOW_DEBUG)console.log(out.split('\n').filter(l=>l.trim()).slice(-30).join('\n'));
if(code!==0){
 console.error(out.split('\n').slice(-25).join('\n'));
 throw Error('Japanese sizing verification failed ('+code+'): '+run);
}
console.log('PASS '+run+' head='+base.head);
// The layout is re-read by the reload above; no second process is needed (a fresh process
// would start from its own profile rather than the layout under test).
