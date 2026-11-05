// Real Electron input regression, confined to its runner-owned synthetic project.
const {app,BrowserWindow,clipboard,shell,ipcMain}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const repo=process.env.FLOW_REPO,root=process.env.FLOW_ROOT,out=process.env.FLOW_OUT;
if(!root.startsWith(path.join(fs.realpathSync(require('node:os').tmpdir()),'flow-paint-presentation-'))||!path.isAbsolute(repo))throw Error('isolated paths required');
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard prohibited');};
shell.trashItem=()=>{throw Error('Trash prohibited');};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const handle=ipcMain.handle.bind(ipcMain);
ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{if(name==='flow-editor:put')await delay(700);return fn(...args);});
const slot=app.isPackaged?1:2;process.argv[slot]=root;process.argv[slot+1]=path.join(out,'userData');
let win;const report={cases:[],raster:[],error:null};
const js=code=>win.webContents.executeJavaScript(code);
const wait=async(fn,label)=>{for(let i=0;i<700;i++){if(await fn())return;await delay(20);}throw Error('timeout '+label);};
const revision=()=>js('Number(document.querySelector("[data-workbench]").dataset.revision)');
const saved=()=>JSON.parse(fs.readFileSync(path.join(root,'.storyboard-flow/checkpoints/project.json'),'utf8'));
const state=()=>js(`Array.from(document.querySelectorAll('[data-paint-layer="ink"]')).map(c=>({surface:c.closest('.wb-surface').dataset.surface,status:c.dataset.paintStatus,width:c.width,staticDisplay:getComputedStyle(c.parentElement.querySelector('.paint-static-layer')).display}))`);
const rect=selector=>js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
const mouse=(type,x,y)=>win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
async function dot(surface,fx,fy){
  const r=await rect(`[data-surface="${surface}"] .image-stage`);
  // No mouseMove/hover warmup. A direct down must be sufficient.
  mouse('mouseDown',r.x+r.w*fx,r.y+r.h*fy);await delay(15);mouse('mouseUp',r.x+r.w*fx,r.y+r.h*fy);await delay(15);
}
const canvasAlpha=points=>js(`Array.from(document.querySelectorAll('[data-paint-layer="ink"][data-paint-status="ready"]')).map(c=>({surface:c.closest('.wb-surface').dataset.surface,alpha:${JSON.stringify(points)}.map(([x,y])=>c.getContext('2d').getImageData(Math.floor(x*c.width),Math.floor(y*c.height),1,1).data[3])}))`);
async function pixels(imageId,points){
  const sharp=(await import(pathToFileURL(path.join(repo,'node_modules/sharp/lib/index.js')).href)).default;
  const p=saved(),assetId=p.images[imageId].layers.find(l=>l.id==='ink').assetId;
  const {data,info}=await sharp(path.join(root,'.storyboard-flow/checkpoints/assets',assetId+'.png')).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return points.map(([x,y])=>data[(Math.floor(y*info.height)*info.width+Math.floor(x*info.width))*4+3]);
}
(async()=>{
  await import(pathToFileURL(path.join(repo,'dist-electron/platform/main/flowEditorEntry.js')).href);await app.whenReady();
  await wait(()=>!!(win=BrowserWindow.getAllWindows()[0]),'window');win.setSize(1400,1000);
  await wait(()=>js('!!document.querySelector("[data-workbench]")'),'workbench');await wait(()=>js('document.querySelector(".wb-status")?.innerText.includes("已自动暂存")'),'checkpoint');
  await js(fs.readFileSync(path.join(out,'raster-check.js'),'utf8'));report.raster=await js('PaintRasterCheck.runPaintRasterChecks()');
  // Decode is delayed independently of writes. During preparation all input remains
  // accepted, but neither surface may expose its obsolete layer as current pixels.
  await js(`(()=>{const decode=HTMLImageElement.prototype.decode;window.__decodeDelay=500;HTMLImageElement.prototype.decode=async function(){await new Promise(r=>setTimeout(r,window.__decodeDelay));return decode.call(this)};return true})()`);
  await js(`(()=>{const e=document.querySelector('.wb-viewer .image-stage'),r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+30,clientY:r.y+30}));})()`);
  await wait(()=>js('!!document.querySelector(".wb-brush-presets button[title=硬画笔]")'),'brush panel');
  await js('document.querySelector(".wb-brush-presets button[title=硬画笔]").click()');
  await js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}))');
  await wait(()=>js('!document.querySelector(".wb-brush-presets")'),'brush panel closed');
  const before=await revision(),points=[[.2,.35],[.5,.35],[.8,.35]];
  await dot('viewer:shot0',...points[0]);await dot('grid:shot0',...points[1]);await dot('viewer:shot0',...points[2]);
  const preparing=await state();assert.equal(preparing.filter(s=>s.status==='preparing').length,2);assert.ok(preparing.every(s=>s.width===0&&s.staticDisplay==='none'));
  fs.writeFileSync(path.join(out,'cold-preparing.png'),(await win.webContents.capturePage()).toPNG());
  await wait(async()=>await revision()===before+3,'all three alternating strokes installed');await wait(()=>js('Array.from(document.querySelectorAll("[data-paint-layer=ink]")).every(c=>c.dataset.paintStatus==="ready")'),'both ready');
  await wait(()=>saved().revision===before+3,'checkpoint');const alpha=await pixels('image0',points),shown=await canvasAlpha(points);
  assert.deepEqual(alpha,[255,255,255]);assert.equal(shown.length,2);for(const s of shown)assert.deepEqual(s.alpha,alpha);
  report.cases.push({name:'700ms A-B-A; cold full down/up before decode',revisionDelta:3,preparing,alpha,shown});

  const undoBefore=await revision(),undoAt=Date.now();await js('document.querySelector("button[aria-label=撤销]").click()');
  const early=await state();assert.ok(early.every(s=>s.status==='preparing'&&s.width===0&&s.staticDisplay==='none'));
  await dot('grid:shot0',.5,.7);
  const frames=[];for(let i=0;i<17;i++){frames.push({at:Date.now()-undoAt,state:await state()});await delay(20);}
  assert.ok(frames.at(-1).at>=320,'history observation spans at least 320ms');
  for(const f of frames)for(const s of f.state)if(s.status==='preparing'){assert.equal(s.width,0);assert.equal(s.staticDisplay,'none');}
  await wait(async()=>await revision()===undoBefore+2,'Undo and new input installed');await wait(()=>saved().revision===undoBefore+2,'undo/new checkpoint');
  const undoPoints=[...points,[.5,.7]],undoAlpha=await pixels('image0',undoPoints);assert.deepEqual(undoAlpha,[255,255,0,255]);
  await wait(()=>js('Array.from(document.querySelectorAll("[data-paint-layer=ink]")).every(c=>c.dataset.paintStatus==="ready")'),'undo ready');
  for(const s of await canvasAlpha(undoPoints))assert.deepEqual(s.alpha,undoAlpha);
  report.cases.push({name:'Undo barrier + immediate cross surface input, 0..320ms frames',early,frames,alpha:undoAlpha});

  // A never-hovered, unselected card has a static media target at down time.
  const noHoverBefore=await revision();const r=await rect('[data-surface="grid:shot1"]');
  report.noHover={rect:r,hit:await js(`(()=>{const e=document.elementFromPoint(${r.x+r.w*.45},${r.y+r.h*.45});return e?.outerHTML.slice(0,600)})()`)};
  await js(`(()=>{window.__trace=[];document.addEventListener('pointerdown',e=>window.__trace.push({type:e.type,primary:e.isPrimary,id:e.pointerId,forwarded:e.flowForwarded,target:e.target.outerHTML.slice(0,200)}),true);return true})()`);
  mouse('mouseDown',r.x+r.w*.45,r.y+r.h*.45);await delay(20);mouse('mouseUp',r.x+r.w*.45,r.y+r.h*.45);
  await wait(async()=>await revision()===noHoverBefore+1,'unhovered first input');await wait(()=>saved().revision===noHoverBefore+1,'unhovered checkpoint');
  const noHoverAlpha=await pixels('image1',[[.45,.45]]);assert.deepEqual(noHoverAlpha,[255]);
  report.cases.push({name:'first down on never-hovered card',revisionDelta:1,alpha:noHoverAlpha});
  fs.writeFileSync(path.join(out,'final.png'),(await win.webContents.capturePage()).toPNG());
})().catch(async error=>{report.error=String(error.stack||error);console.error(report.error);if(win){report.diagnostic=await js(`({trace:window.__trace,status:document.querySelector('.wb-status')?.innerText,selected:document.querySelector('.wb-viewer')?.dataset.currentShot,stage:document.querySelector('[data-surface="grid:shot1"]')?.outerHTML.slice(0,4000)})`);fs.writeFileSync(path.join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());}}).finally(()=>{
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));
  if(!report.error && win && !win.isDestroyed()) win.close(); else app.exit(report.error?1:0);
});
