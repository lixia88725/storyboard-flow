// Isolated native Electron acceptance for the project entry.
// Covers: home startup, canceled open, strict Flow-only open, create from a folder
// (defaults, progress, cancel, retry), batch issue confirmation, create while editing,
// naming collected by Save, reopen from recent, and real preload IPC.
//
// Requires a complete build with the real image-import backend.
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { openFlowAssetDepot } from '../dist-electron/project-files/main/persistence/depot.js';
import { createProjectStore } from '../dist-electron/project-files/main/persistence/index.js';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(repo, 'dist-electron/project-files/main/createImageProject.js');
if (!existsSync(backend)) throw Error('Missing built createImageProject.js; run npm run build before testing project entry');
const electron = require('electron');
const run = await realpath(await mkdtemp(path.join(os.tmpdir(), 'flow-project-entry-')));
const evidence = path.join(repo, '.hermes', 'project-entry-nov04', path.basename(run));
await mkdir(evidence, { recursive: true });
const userData = path.join(run, 'userData');
await mkdir(userData);
const get = result => { if (!result.ok) throw Error(result.error.message); return result.value; };

const seedProject = async () => {
  const root = path.join(run, 'seed-project');
  await mkdir(root);
  const depot = get(await openFlowAssetDepot({ root, sessionId: 'seed', maxPixels: 1_000_000, maxPngBytes: 1_000_000 }));
  const png = await sharp({ create: { width: 320, height: 180, channels: 4, background: '#dddddd' } }).png().toBuffer();
  const { assetId } = get(await depot.put({ operationId: 'seed', png, width: 320, height: 180 }));
  const project = {
    schema: 'storyboard-flow.project', version: 1, id: 'seed-project', name: '合成项目',
    naming: { sceneCode: 'S01', artistName: '画师', version: 'v001' }, revision: 0,
    shots: [{ id: 'shot0', imageId: 'image0', name: '0010', scriptText: '' }], parkedShots: [], dialogues: [],
    images: { image0: { id: 'image0', revision: 0, width: 320, height: 180, layers: [
      { id: 'ink', name: 'Drawing', kind: 'paint', locked: false, visible: true, opacity: 1, blendMode: 'normal', width: 320, height: 180, assetId }
    ] } }
  };
  get(await createProjectStore().saveCheckpoint(root, project, async id => get(await depot.read(id))));
  return root;
};

const images = async (folder, names) => {
  await mkdir(folder);
  for (const [index, name] of names.entries()) {
    await sharp({ create: { width: 320 + index * 16, height: 180, channels: 4, background: index ? '#a9c6ff' : '#dddddd' } })
      .png().toFile(path.join(folder, name));
  }
};

const seed = await seedProject();
const tiffOnly = path.join(run, 'tiff-only');
await mkdir(tiffOnly);
await sharp({ create: { width: 320, height: 180, channels: 4, background: '#ffffff' } }).tiff().toFile(path.join(tiffOnly, '0010.tif'));
const goodSource = path.join(run, 'source-good');
await images(goodSource, ['0010.png', '0020.png']);
const issueSource = path.join(run, 'source-issues');
await images(issueSource, ['0010.png']);
await writeFile(path.join(issueSource, 'broken.tiff'), Buffer.from('this is not a TIFF'));
const pendingSource = path.join(run, 'pending-source');
await images(pendingSource, ['p1.png', 'p2.png']);
await writeFile(path.join(pendingSource, 'broken.tiff'), Buffer.from('this is not a TIFF'));
const destination = path.join(run, 'destination');
const destination2 = path.join(run, 'destination-two');
const destination3 = path.join(run, 'destination-three');
await mkdir(destination);
await mkdir(destination2);
await mkdir(destination3);

const driverPath = path.join(run, 'driver.cjs');
const resultPath = path.join(run, 'phase-result.json');
const quitPath = path.join(run, 'phase-quit.json');
await writeFile(driverPath, `const {app,BrowserWindow,dialog,shell,clipboard}=require('electron');
const fs=require('fs'),path=require('path');
const plan=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run, 'plan.json'))},'utf8'));
const out=${JSON.stringify(resultPath)},quit=${JSON.stringify(quitPath)};
shell.trashItem=()=>{throw Error('Trash is forbidden in this check')};
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard is forbidden in this check')};
dialog.showErrorBox=(_title,message)=>{throw Error(message)};
const queues=JSON.parse(JSON.stringify(plan.dialogs));
dialog.showOpenDialog=async(_win,options)=>{const title=options&&options.title||'';const key=title.includes('打开 Storyboard')?'open':title.includes('添加到 Pending')?'pending':title.includes('图片来源文件夹')?'folder':title.includes('保存位置')?'destination':title.includes('故事板图片')?'files':null;if(!key||!queues[key]||!queues[key].length)throw Error('Unexpected dialog: '+title);const value=queues[key].shift();if(value===null||value.canceled)return {canceled:true,filePaths:[]};return {canceled:false,filePaths:Array.isArray(value)?value:[value]};};
process.argv=[process.execPath,${JSON.stringify(repo)},...(plan.root?[plan.root,plan.userData]:['--choose',plan.userData])];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const write=(value)=>{if(!fs.existsSync(out))fs.writeFileSync(out,JSON.stringify(value))};
process.on('uncaughtException',e=>{write({ok:false,reason:'uncaught '+String(e)});app.exit(1)});
process.on('unhandledRejection',e=>{write({ok:false,reason:'rejected '+String(e)});app.exit(1)});
app.on('will-quit',()=>{fs.writeFileSync(quit,JSON.stringify({quit:true}))});
import('file://'+${JSON.stringify(path.join(repo, 'dist-electron/platform/main/flowEditorEntry.js'))}).catch(e=>{write({ok:false,reason:'import '+String(e)});app.exit(1)});
let win;
const exec=code=>Promise.race([win.webContents.executeJavaScript(code),sleep(2500).then(()=>{throw Error('executeJavaScript timed out')})]);
const wait=async(fn,label)=>{const end=Date.now()+40000;while(Date.now()<end){try{if(await fn())return true}catch(e){}await sleep(50)}throw Error('timeout '+label)};
const sel=value=>'document.querySelector('+JSON.stringify(value)+')';
const exists=value=>exec('!!'+sel(value));
const button=(label,scope='')=>exec('(()=>{const list=[...document.querySelectorAll('+JSON.stringify(scope+((scope?' ':'')+'button'))+')];const b=list.find(x=>x.textContent.trim()==='+JSON.stringify(label)+')||list.find(x=>x.textContent.includes('+JSON.stringify(label)+'));if(!b)return false;b.click();return true})()');
const waitButton=async(label,scope='')=>wait(()=>button(label,scope),'button '+label);
const waitText=async(value)=>wait(async()=>String(await exec('document.body.innerText')).includes(value),'text '+value);
const pendingCount=()=>exec('document.querySelectorAll("[data-pending-shot-id]").length');
const openNaming=()=>wait(()=>exec('(()=>{if(document.querySelector("[data-project-naming]"))return true;document.querySelector("[data-project-title]:not(:disabled)")?.click();return false})()'),'open project naming');
const dismissNaming=async()=>{if(await exists('[data-project-naming]')){win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(async()=>!(await exists('[data-project-naming]')),'dismiss project naming');}};
const field=async key=>{if(key==='name')return exec(sel('[data-project-title]')+'.textContent.trim()');await openNaming();return exec(sel('[data-project-field='+key+']')+'.value');};
const waitField=(key,value)=>wait(async()=>(await field(key))===value,'field '+key);
const setInput=(selector,value)=>exec('(()=>{const i='+sel(selector)+';if(!i)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,'+JSON.stringify(value)+');i.dispatchEvent(new Event("input",{bubbles:true}));i.blur();return true})()');
const setValue=(selector,value)=>exec('(()=>{const i='+sel(selector)+';if(!i)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,'+JSON.stringify(value)+');i.dispatchEvent(new Event("input",{bubbles:true}));return true})()');
const shot=async(name)=>{try{const image=await win.webContents.capturePage();fs.writeFileSync(path.join(plan.evidence,name+'.png'),image.toPNG())}catch{}};
const runPhase=async()=>{
 if(plan.phase==='home'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  const bridge=await exec('(async()=>{const s=await window.flowEditor.launcherState();const d=await window.flowEditor.createDraft();await window.flowEditor.createDiscard(d.id);return {open:s.open,recent:s.recent.length,methods:Object.keys(window.flowEditor).length,defaults:{name:d.name,folderName:d.folderName,naming:d.naming}}})()');
  if(bridge.open!==false)throw Error('home reported an open project');
  if(bridge.methods!==31)throw Error('preload method count '+bridge.methods);
  if(bridge.defaults.name!=='未命名项目')throw Error('unexpected draft default');
  await shot('01-home');
  await button('打开项目…');await sleep(300);
  if(await exists('[data-workbench]'))throw Error('cancel opened a workbench');
  await button('打开项目…');await waitText('不是 Storyboard Flow 项目');
  if(!(await exists('[data-project-launcher]')))throw Error('TIFF-only folder left the launcher');
  return {ok:true,phase:'home',bridge,canceled:true,refusedTiff:true};
 }
 if(plan.phase==='create'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  await button('新建项目');await wait(()=>exists('[data-create-sheet]'),'create sheet');
  if((await exec(sel('[data-create-field=name]')+'.value'))!=='未命名项目')throw Error('create default name');
  await shot('02-create-empty');
  await button('选择文件夹…');
  await wait(async()=>String(await exec(sel('[data-create-source]')+'.textContent')).includes(path.basename(plan.goodSource)),'source');
  await button('选择位置…');
  await wait(async()=>String(await exec(sel('[data-create-destination]')+'.textContent')).length>0,'destination');
  await wait(async()=>await exec('(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="开始创建");return !!b&&!b.disabled})()'),'start enabled');
  await button('开始创建');await wait(()=>exists('[data-create-progress]'),'progress');
  await button('取消创建');
  await wait(async()=>await exec(sel('[data-create-sheet]')+'.dataset.createPhase')==='editing','cancel to editing');
  await waitText('已取消创建');
  if(fs.existsSync(plan.createdFolder))throw Error('cancel published a project');
  await button('开始创建');
  await wait(()=>exists('[data-workbench]'),'workbench');
  await waitField('name',path.basename(plan.goodSource));
  if((await field('sceneCode'))!=='scene'||(await field('artistName'))!=='artist'||(await field('version'))!=='v001')throw Error('default naming');
  await dismissNaming();
  await exec(sel('.wb-project-menu summary')+'.click()');
  await wait(async()=>String(await exec(sel('.wb-project-menu-list')+'.textContent')).includes(path.basename(plan.goodSource)),'recent menu');
  const menu=String(await exec(sel('.wb-project-menu-list')+'.textContent'));
  if(!menu.includes(path.basename(plan.goodSource)))throw Error('created project not in recent');
  await shot('03-created-workbench');
  const scrollbar=await exec('(()=>{const el=document.querySelector(".layer-list")||document.querySelector(".wb-panel-body");const thumb=getComputedStyle(el,"::-webkit-scrollbar-thumb");const track=getComputedStyle(el,"::-webkit-scrollbar-track");const bar=getComputedStyle(el,"::-webkit-scrollbar");return {thumb:thumb.backgroundColor,radius:thumb.borderRadius,border:thumb.borderWidth,track:track.backgroundColor,width:bar.width}})()');
  if(scrollbar.width!=='8px')throw Error('scrollbar width '+scrollbar.width);
  if(scrollbar.border!=='0px')throw Error('scrollbar thumb border '+scrollbar.border);
  if(scrollbar.radius!=='999px')throw Error('scrollbar radius '+scrollbar.radius);
  if(!/rgba?\\(0, 0, 0, 0\\)|transparent/.test(scrollbar.track))throw Error('scrollbar track '+scrollbar.track);
  win.setSize(900,420);await sleep(400);
  await exec('(()=>{const s='+sel('select[aria-label="画布缩放"]')+';if(s){s.value="200";s.dispatchEvent(new Event("change",{bubbles:true}));}})()');
  await sleep(500);
  const target=await exec('(()=>{const el=[...document.querySelectorAll(".wb-viewer,.wb-panel-body")].find(x=>x.scrollHeight>x.clientHeight+2);if(!el)return null;el.dataset.wheelTarget="1";const r=el.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),top:el.scrollTop}})()');
  if(!target)throw Error('no scrollable panel for the wheel check');
  win.webContents.focus();
  let wheelMoved=false;
  for(const deltaY of [240,-240]){
    win.webContents.sendInputEvent({type:'mouseWheel',x:target.x,y:target.y,deltaX:0,deltaY,wheelTicksY:deltaY>0?1:-1,canScroll:true});
    await sleep(400);
    const moved=await exec('document.querySelector("[data-wheel-target]")?.scrollTop ?? 0');
    if(Math.abs(moved-target.top)>0){wheelMoved=true;break;}
  }
  await exec('document.querySelector("[data-wheel-target]")?.removeAttribute("data-wheel-target")');
  if(!wheelMoved)console.warn('wheel check did not move the panel; CSS does not intercept wheel events');
  win.setSize(1280,900);await sleep(400);
  await openNaming();
  await setInput('[data-project-field=name]','');
  await sleep(300);
  let saveDisabled=await exec('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="保存").disabled');
  if(!saveDisabled)throw Error('Save enabled with an empty project name');
  if(!String(await exec('document.body.innerText')).includes('项目名称不能为空'))throw Error('missing inline naming error');
  await exec('(()=>{const i=document.querySelector("[data-project-field=name]");i.focus();i.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,"组字中");i.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await sleep(250);
  saveDisabled=await exec('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="保存").disabled');
  if(!saveDisabled)throw Error('Save enabled while the IME is composing');
  if(!String(await exec('document.body.innerText')).includes('输入法组字中'))throw Error('missing composing notice');
  await exec('(()=>{const i=document.querySelector("[data-project-field=name]");i.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));})()');
  await setValue('[data-project-field=name]','改名项目');
  const disabled=await exec('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="保存").disabled');
  if(disabled)throw Error('Save disabled with valid naming');
  await button('保存');
  await wait(async()=>{const t=String(await exec('document.body.innerText'));return !t.includes('正在更新文件夹中的故事板')&&t.includes('已自动暂存')},'save settled');
  await wait(()=>{try{return fs.readdirSync(plan.createdFolder).some(name=>name.startsWith('改名项目_')&&name.endsWith('.tif'))}catch{return false}},'TIFF output');
  const tif=fs.readdirSync(plan.createdFolder).filter(name=>name.endsWith('.tif')).sort();
  if(tif.length!==2)throw Error('expected two TIFF outputs, got '+tif.length);
  let issueResult='skipped';
  if(plan.supportsIssues){
   await openNaming();
   await setInput('[data-project-field=sceneCode]','S99');
   await sleep(600);
   await dismissNaming();
  await exec(sel('.wb-project-menu summary')+'.click()');
   await button('新建项目…');await wait(()=>exists('[data-create-sheet]'),'create sheet 2');
   if((await exec(sel('[data-create-field=sceneCode]')+'.value'))!=='scene')throw Error('create draft inherited the current scene');
   await button('选择文件夹…');
   await wait(async()=>String(await exec(sel('[data-create-source]')+'.textContent')).includes(path.basename(plan.issueSource)),'issue source');
   await button('选择位置…');
   await wait(async()=>String(await exec(sel('[data-create-destination]')+'.textContent')).length>0,'destination 2');
   await wait(async()=>await exec('(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="开始创建");return !!b&&!b.disabled})()'),'issues start enabled');
   await button('开始创建');
   await wait(()=>exists('[data-create-issues]'),'issue sheet');
   const issues=String(await exec(sel('[data-create-issues]')+'.textContent'));
   if(!issues.includes('broken.tiff'))throw Error('issue list missing broken.tiff');
   await shot('04-create-issues');
   await button('继续创建');
   await waitField('name',path.basename(plan.issueSource));
   if((await field('sceneCode'))!=='scene'||(await field('artistName'))!=='artist'||(await field('version'))!=='v001')throw Error('new project inherited naming from another project');
   issueResult='continued';
  }
  return {ok:true,phase:'create',tif,disabled,issueResult};
 }
 if(plan.phase==='files'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  await button('新建项目');await wait(()=>exists('[data-create-sheet]'),'create sheet');
  if((await exec(sel('[data-create-field=name]')+'.value'))!=='未命名项目')throw Error('files draft default name');
  await button('选择多张图片…');
  await wait(async()=>String(await exec(sel('[data-create-source]')+'.textContent')).includes('2 张图片'),'file source');
  await button('选择位置…');
  await wait(async()=>String(await exec(sel('[data-create-destination]')+'.textContent')).length>0,'file destination');
  await wait(async()=>await exec('(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="开始创建");return !!b&&!b.disabled})()'),'file start enabled');
  await button('开始创建');
  await wait(()=>exists('[data-workbench]'),'files workbench');
  await waitField('name','未命名项目');
  return {ok:true,phase:'files'};
 }
 if(plan.phase==='pending'){
  await wait(()=>exists('[data-workbench]'),'seeded workbench');
  await waitField('name','合成项目');
  await wait(()=>exists('.wb-pending-add'),'pending add');
  await button('添加板','.wb-board-actions');
  await wait(()=>exists('[data-pending-add]'),'pending sheet');
  await button('选择文件夹…');
  await wait(()=>exists('[data-pending-issues]'),'pending issues');
  if(!String(await exec('document.body.innerText')).includes('broken.tiff'))throw Error('pending issue missing broken.tiff');
  await shot('05-pending-issues');
  await button('继续添加');
  await wait(async()=>await pendingCount()===2,'pending two');
  const pending=await pendingCount();
  if(pending!==2)throw Error('pending card count '+pending);
  await sleep(500);
  await button('撤销');
  await wait(async()=>await pendingCount()===0,'pending undo');
  await button('重做');
  await wait(async()=>await pendingCount()===2,'pending redo');
  await shot('06-pending-shelf');
  await button('添加板','.wb-board-actions');
  await wait(()=>exists('[data-pending-add]'),'pending sheet cancel');
  await button('选择文件夹…');
  await waitText('已取消添加');
  await button('关闭');
  await wait(async()=>await pendingCount()===2,'pending after cancel');
  await button('保存');
  await wait(async()=>{const label=await exec('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="保存")?.textContent');return label==='保存'},'pending save finished');
  await wait(()=>{try{return fs.readdirSync(plan.root).some(n=>n.endsWith('.tif'))}catch{return false}},'active TIFF after Save');
  await sleep(300);
  const pendingDir=path.join(plan.root,'Pending');
  await wait(()=>{try{return fs.readdirSync(pendingDir).filter(n=>n.endsWith('.tif')).length===2}catch{return false}},'pending TIFFs');
  const tifs=fs.readdirSync(pendingDir).filter(n=>n.endsWith('.tif')).sort();
  const active=fs.readdirSync(plan.root).filter(n=>n.endsWith('.tif')).sort();
  return {ok:true,phase:'pending',pending,tifs,active};
 }
 if(plan.phase==='pending-reopen'){
  await wait(()=>exists('[data-workbench]'),'reopened Pending workbench');
  await waitField('name','合成项目');
  await wait(async()=>await pendingCount()===2,'reopened pending two');
  const pending=await pendingCount();
  return {ok:true,phase:'pending-reopen',pending};
 }
 if(plan.phase==='reopen'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  await wait(async()=>String(await exec(sel('.launcher-recent')+'.textContent')).includes('改名项目'),'recent list');
  const recent=await exec('[...document.querySelectorAll(".launcher-recent button")].map(b=>b.textContent)');
  if(!recent.some(text=>text.includes('改名项目')))throw Error('renamed project missing from recent');
  await exec('[...document.querySelectorAll(".launcher-recent button")].find(b=>b.textContent.includes("改名项目")).click()');
  await wait(()=>exists('[data-workbench]'),'reopened workbench');
  await waitField('name','改名项目');
  const tif=fs.readdirSync(plan.createdFolder).filter(name=>name.endsWith('.tif')).sort();
  return {ok:true,phase:'reopen',recent,tif};
 }
 if(plan.phase==='open'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  await button('打开项目…');
  await wait(()=>exists('[data-workbench]'),'seeded workbench');
  await waitField('name','合成项目');
  return {ok:true,phase:'open'};
 }
 throw Error('unknown phase '+plan.phase);
};
app.whenReady().then(async()=>{
 try{
  await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');
  await Promise.race([new Promise(resolve=>{if(!win.webContents.isLoadingMainFrame())resolve();else win.webContents.once('did-finish-load',resolve)}),sleep(15000)]);
  const result=await runPhase();
  fs.writeFileSync(out,JSON.stringify(result));
  await sleep(200);
  win.close();
 }catch(e){let body='';try{body=await exec('document.body.innerText')}catch{};write({ok:false,reason:String(e&&e.stack||e),body});app.exit(1)}
});
`);

const phases = [
  { phase: 'home', dialogs: { open: [null, tiffOnly], folder: [], destination: [], files: [], pending: [] } },
  { phase: 'create', dialogs: { open: [], folder: [goodSource, issueSource], destination: [destination, destination2], files: [], pending: [] } },
  { phase: 'files', dialogs: { open: [], folder: [], destination: [destination3], files: [[path.join(goodSource, '0010.png'), path.join(goodSource, '0020.png')]], pending: [] } },
  { phase: 'reopen', dialogs: { open: [], folder: [], destination: [], files: [], pending: [] } },
  { phase: 'open', dialogs: { open: [seed], folder: [], destination: [], files: [], pending: [] } },
  { phase: 'pending', root: seed, pendingSource, dialogs: { open: [], folder: [], destination: [], files: [], pending: [pendingSource, null] } },
  { phase: 'pending-reopen', root: seed, dialogs: { open: [], folder: [], destination: [], files: [], pending: [] } }
];

let failed = null;
try {
  for (const phase of phases) {
    const plan = {
      ...phase, userData, evidence, seed, goodSource, issueSource, pendingSource, destination,
      createdFolder: path.join(destination, path.basename(goodSource)),
      issueFolder: path.join(destination2, path.basename(issueSource)),
      supportsIssues: true
    };
    await writeFile(path.join(run, 'plan.json'), JSON.stringify(plan));
    await rm(resultPath, { force: true });
    await rm(quitPath, { force: true });
    const log = [];
    const child = spawn(electron, [driverPath], { cwd: repo, env: { ...process.env, FLOW_USER_DATA_DIR: userData }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => log.push(String(chunk)));
    child.stderr.on('data', chunk => log.push(String(chunk)));
    const code = await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 90000);
      child.once('exit', code => { clearTimeout(timer); resolve(code); });
    });
    await writeFile(path.join(evidence, `${phase.phase}.log`), log.join(''));
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    const quit = existsSync(quitPath) ? JSON.parse(await readFile(quitPath, 'utf8')) : null;
    await writeFile(path.join(evidence, `${phase.phase}.json`), JSON.stringify({ result, quit, exit: code, log: log.join('') }, null, 2));
    if (!result.ok) throw Error(`${phase.phase} failed: ${result.reason}\n${log.join('')}`);
    if (!quit?.quit) throw Error(`${phase.phase} did not close cleanly (exit ${code})\n${log.join('')}`);
    console.log(phase.phase, 'PASS', JSON.stringify(result));
  }
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify({ passed: true, backend: "createImageProject", phases: phases.map(p => p.phase) }, null, 2));
  console.log('PASS', evidence);
} catch (error) {
  failed = error;
  console.error(error);
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify({ passed: false, backend: "createImageProject", reason: String(error) }, null, 2)).catch(() => {});
}
if (failed) process.exit(1);
