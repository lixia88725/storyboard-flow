// Isolated native Electron acceptance for the simplified project entry.
// Covers: two entry actions, one folder picker that opens a Flow project or offers
// to create from images, ignored .storyboard-workbench metadata, a damaged Flow
// marker refused without falling back to import, blank project creation and reopen.
//
// Requires a complete build with the real creation backends.
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { openFlowAssetDepot } from '../dist-electron/project-files/main/persistence/depot.js';
import { createProjectStore } from '../dist-electron/project-files/main/persistence/index.js';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backend = path.join(repo, 'dist-electron/project-files/main/createImageProject.js');
const blankBackend = path.join(repo, 'dist-electron/project-files/main/createBlankProject.js');
if (!existsSync(backend) || !existsSync(blankBackend))
  throw Error('Missing built creation backends; run npm run build before testing project entry');
const electron = require('electron');
const run = await realpath(await mkdtemp(path.join(os.tmpdir(), 'flow-project-entry-')));
const evidence = path.join(repo, '.hermes', 'project-entry-simplified', path.basename(run));
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
const goodSource = path.join(run, 'source-good');
await images(goodSource, ['0010.png', '0020.png']);
const legacySource = path.join(run, 'source-legacy');
await images(legacySource, ['0010.png', '0020.png', '0030.png']);
await mkdir(path.join(legacySource, '.storyboard-workbench'));
await writeFile(path.join(legacySource, '.storyboard-workbench', 'document.json'), JSON.stringify({ old: 'ordering and dialogue' }));
const damagedSource = path.join(run, 'source-damaged');
await images(damagedSource, ['0010.png']);
await mkdir(path.join(damagedSource, '.storyboard-flow', 'checkpoints'), { recursive: true });
await writeFile(path.join(damagedSource, '.storyboard-flow', 'checkpoints', 'project.json'), '{ not a checkpoint');
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
dialog.showOpenDialog=async(_win,options)=>{const title=options&&options.title||'';const key=title.includes('打开项目或图片文件夹')?'open':title.includes('添加到 Pending')?'pending':title.includes('保存位置')?'destination':null;if(!key||!queues[key]||!queues[key].length)throw Error('Unexpected dialog: '+title);const value=queues[key].shift();if(value===null||value.canceled)return {canceled:true,filePaths:[]};return {canceled:false,filePaths:Array.isArray(value)?value:[value]};};
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
const boardCount=()=>exec('document.querySelectorAll("[data-board-id]").length');
const openNaming=()=>wait(()=>exec('(()=>{if(document.querySelector("[data-project-naming]"))return true;document.querySelector("[data-project-title]:not(:disabled)")?.click();return false})()'),'open project naming');
const dismissNaming=async()=>{if(await exists('[data-project-naming]')){win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});await wait(async()=>!(await exists('[data-project-naming]')),'dismiss project naming');}};
const field=async key=>{if(key==='name')return exec(sel('[data-project-title]')+'.textContent.trim()');await openNaming();return exec(sel('[data-project-field='+key+']')+'.value');};
const waitField=(key,value)=>wait(async()=>(await field(key))===value,'field '+key);
const setInput=(selector,value)=>exec('(()=>{const i='+sel(selector)+';if(!i)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,'+JSON.stringify(value)+');i.dispatchEvent(new Event("input",{bubbles:true}));i.blur();return true})()');
const setValue=(selector,value)=>exec('(()=>{const i='+sel(selector)+';if(!i)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,'+JSON.stringify(value)+');i.dispatchEvent(new Event("input",{bubbles:true}));return true})()');
const shot=async(name)=>{try{for(let attempt=0;attempt<3;attempt++){const image=await win.webContents.capturePage();const png=image.toPNG();if(png.length){fs.writeFileSync(path.join(plan.evidence,name+'.png'),png);return}await sleep(150)}}catch{}};
const sheetFolder=()=>exec(sel('[data-create-folder]')+'.textContent');
const alertText=()=>exec('document.querySelector("[data-flow-alert]")?.innerText ?? ""');
const createButtonEnabled=()=>exec('(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="创建并打开");return !!b&&!b.disabled})()');
const runPhase=async()=>{
 if(plan.phase==='home'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  const actions=await exec('[...document.querySelectorAll(".launcher-actions button")].map(b=>b.textContent.trim())');
  if(JSON.stringify(actions)!==JSON.stringify(['打开…','新建项目…']))throw Error('entry actions '+JSON.stringify(actions));
  if(await exists('.launcher-recent'))throw Error('empty recent projects should be hidden');
  const bridge=await exec('(async()=>{const s=await window.flowEditor.launcherState();const d=await window.flowEditor.createDraft("blank");await window.flowEditor.createDiscard(d.id);return {open:s.open,recent:s.recent.length,methods:Object.keys(window.flowEditor).length,mode:d.mode}})()');
  if(bridge.open!==false)throw Error('home reported an open project');
  if(bridge.mode!=='blank')throw Error('blank draft mode '+bridge.mode);
  await shot('01-home');
  await button('打开…');await sleep(300);
  if(await exists('[data-workbench]')||await exists('[data-create-sheet]'))throw Error('cancel started something');
  // A damaged Flow marker is refused and never offered as an import.
  await button('打开…');
  await wait(()=>exists('[data-flow-alert]'),'damaged alert');
  const alert=await alertText();
  if(!alert.includes('项目数据不完整')&&!alert.includes('读不出来'))throw Error('damaged alert text: '+alert);
  if(alert.includes('/private/')||alert.includes('Error invoking remote method'))throw Error('damaged alert leaks internals: '+alert);
  if(await exists('[data-create-sheet]'))throw Error('damaged folder offered an import');
  if(await exists('[data-workbench]'))throw Error('damaged folder opened');
  await shot('02-damaged-alert');
  await button('关闭');
  await wait(async()=>!(await exists('[data-flow-alert]')),'alert dismissed');
  return {ok:true,phase:'home',bridge,actions};
 }
 if(plan.phase==='import'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  await button('打开…');
  await wait(()=>exists('[data-create-sheet]'),'import sheet');
  if(await exec(sel('[data-create-sheet]')+'.dataset.createMode')!=='images')throw Error('import sheet mode');
  if((await exec(sel('[data-create-field=name]')+'.value'))!==path.basename(plan.goodSource))throw Error('import default name');
  const note=String(await exec(sel('[data-create-source-note]')+'.textContent'));
  if(!note.includes('2 张图片')||!note.includes('来源图片不会被移动或修改'))throw Error('import note: '+note);
  if(!(await sheetFolder()).includes(path.basename(plan.goodSource)+' 分镜'))throw Error('import folder hint: '+await sheetFolder());
  if(await exists('[data-create-legacy]'))throw Error('legacy notice on a plain image folder');
  await shot('03-import-sheet');
  await button('选择位置…');
  await wait(async()=>String(await exec(sel('[data-create-destination]')+'.textContent')).length>0,'destination');
  await wait(createButtonEnabled,'create enabled');
  await button('创建并打开');
  await wait(()=>exists('[data-workbench]'),'import workbench');
  await waitField('name',path.basename(plan.goodSource));
  await wait(async()=>await boardCount()===2,'two boards');
  await dismissNaming();
  await exec(sel('.wb-project-menu summary')+'.click()');
  await wait(async()=>String(await exec(sel('.wb-project-menu-list')+'.textContent')).includes(path.basename(plan.goodSource)),'recent menu');
  await shot('04-imported-workbench');
  const tifs=fs.readdirSync(plan.createdFolder).filter(name=>name.endsWith('.tif')).sort();
  if(tifs.length!==2)throw Error('expected two TIFF outputs, got '+tifs.length);
  return {ok:true,phase:'import',boards:2,tifs};
 }
 if(plan.phase==='blank'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  await button('新建项目…');
  await wait(()=>exists('[data-create-sheet]'),'blank sheet');
  if(await exec(sel('[data-create-sheet]')+'.dataset.createMode')!=='blank')throw Error('blank sheet mode');
  if(await exists('[data-create-source-note]'))throw Error('blank sheet asked for images');
  if(!String(await exec(sel('.wb-sheet')+'.textContent')).includes('新建项目'))throw Error('blank sheet title');
  await setValue('[data-create-field=name]','空白故事');
  if(await exists('[data-create-folder]'))throw Error('blank project repeats its name as a folder hint');
  if(await exists('[data-create-destination]')||await createButtonEnabled())throw Error('blank project can be created before choosing a location');
  await shot('05-blank-sheet');
  await button('选择位置…');
  await wait(async()=>String(await exec(sel('[data-create-destination]')+'.textContent')).length>0,'blank destination');
  await wait(createButtonEnabled,'blank create enabled');
  await button('创建并打开');
  await wait(()=>exists('[data-workbench]'),'blank workbench');
  await waitField('name','空白故事');
  await wait(async()=>await boardCount()===0,'empty board grid');
  if(!String(await exec('document.body.innerText')).includes('选择一张故事板开始绘制'))throw Error('missing empty canvas notice');
  await shot('06-blank-workbench');
  await dismissNaming();
  await button('新建板','.wb-board-actions');
  await wait(async()=>await boardCount()===1,'first board');
  await button('保存');
  await wait(async()=>{const label=await exec('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="保存")?.textContent');return label==='保存'},'blank save finished');
  await wait(()=>{try{return fs.readdirSync(plan.blankFolder).some(name=>name.endsWith('.tif'))}catch{return false}},'blank TIFF');
  const tifs=fs.readdirSync(plan.blankFolder).filter(name=>name.endsWith('.tif'));
  return {ok:true,phase:'blank',boards:1,tifs};
 }
 if(plan.phase==='legacy'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  await button('打开…');
  await wait(()=>exists('[data-create-sheet]'),'legacy sheet');
  if(await exists('[data-create-legacy]'))throw Error('retired metadata must not add an import warning');
  if(fs.readFileSync(path.join(plan.legacySource,'.storyboard-workbench','document.json'),'utf8')!==JSON.stringify({old:'ordering and dialogue'}))throw Error('retired metadata changed');
  if((await exec(sel('[data-create-field=name]')+'.value'))!==path.basename(plan.legacySource))throw Error('legacy default name');
  await shot('07-legacy-sheet');
  await button('取消');
  await wait(async()=>!(await exists('[data-create-sheet]')),'legacy sheet closed');
  if(fs.existsSync(path.join(plan.destination2, path.basename(plan.legacySource))))throw Error('cancel created a folder');
  if(await exists('[data-workbench]'))throw Error('cancel opened a project');
  return {ok:true,phase:'legacy',ignoredMetadata:true};
 }
 if(plan.phase==='reopen'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  await wait(async()=>String(await exec(sel('.launcher-recent')+'.textContent')).includes('空白故事'),'recent list');
  await exec('[...document.querySelectorAll(".launcher-recent button")].find(b=>b.textContent.includes("空白故事")).click()');
  await wait(()=>exists('[data-workbench]'),'reopened workbench');
  await waitField('name','空白故事');
  await wait(async()=>await boardCount()===1,'reopened one board');
  return {ok:true,phase:'reopen'};
 }
 if(plan.phase==='open'){
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  await button('打开…');
  await wait(()=>exists('[data-workbench]'),'seeded workbench');
  await waitField('name','合成项目');
  if(await exists('[data-create-sheet]'))throw Error('Flow project offered an import');
  return {ok:true,phase:'open'};
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
  await button('继续添加');
  await wait(async()=>await pendingCount()===2,'pending two');
  await shot('08-pending-shelf');
  return {ok:true,phase:'pending',pending:await pendingCount()};
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
  { phase: 'home', dialogs: { open: [null, damagedSource], pending: [], destination: [] } },
  { phase: 'import', dialogs: { open: [goodSource], pending: [], destination: [destination] } },
  { phase: 'blank', dialogs: { open: [], pending: [], destination: [destination2] } },
  { phase: 'legacy', dialogs: { open: [legacySource], pending: [], destination: [] } },
  { phase: 'reopen', dialogs: { open: [], pending: [], destination: [] } },
  { phase: 'open', dialogs: { open: [seed], pending: [], destination: [] } },
  { phase: 'pending', root: seed, dialogs: { open: [], pending: [pendingSource], destination: [] } }
];

let failed = null;
try {
  for (const phase of phases) {
    const plan = {
      ...phase, userData, evidence, seed, goodSource, legacySource, damagedSource, pendingSource, destination, destination2,
      createdFolder: path.join(destination, path.basename(goodSource) + ' 分镜'),
      blankFolder: path.join(destination2, '空白故事')
    };
    await writeFile(path.join(run, 'plan.json'), JSON.stringify(plan));
    await rm(resultPath, { force: true });
    await rm(quitPath, { force: true });
    const log = [];
    const child = spawn(electron, [driverPath], { cwd: repo, env: { ...process.env, FLOW_USER_DATA_DIR: userData }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => log.push(String(chunk)));
    child.stderr.on('data', chunk => log.push(String(chunk)));
    const code = await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 120000);
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
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify({
    passed: true, backends: ['createImageProject', 'createBlankProject'], phases: phases.map(p => p.phase)
  }, null, 2));
  console.log('PASS', evidence);
} catch (error) {
  failed = error;
  console.error(error);
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify({ passed: false, reason: String(error) }, null, 2)).catch(() => {});
}
if (failed) process.exit(1);
