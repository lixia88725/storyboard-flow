// Real-window rules:
//   - same-name recent projects show distinct display-only target suffixes in the
//     home and project menu, while opening still uses only the opaque id
//   - the top-bar 添加图片 entry works while the Pending panel is hidden and uses
//     the same operation/form as the panel entry
//
// Requires `npm run build`; synthetic projects, isolated userData, no Save/Trash.
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
const electron = require('electron');
const run = await realpath(await mkdtemp(path.join(os.tmpdir(), 'flow-target-rules-')));
const evidence = path.join(repo, '.hermes', 'target-rules-nov04', path.basename(run));
await mkdir(evidence, { recursive: true });
const userData = path.join(run, 'userData');
await mkdir(userData);
const get = result => { if (!result.ok) throw Error(result.error.message); return result.value; };

const seed = async (folder, id, scene) => {
  const root = path.join(run, folder, '同名项目');
  await mkdir(root, { recursive: true });
  const depot = get(await openFlowAssetDepot({ root, sessionId: 'seed', maxPixels: 1_000_000, maxPngBytes: 1_000_000 }));
  const png = await sharp({ create: { width: 320, height: 180, channels: 4, background: '#dddddd' } }).png().toBuffer();
  const { assetId } = get(await depot.put({ operationId: 'seed', png, width: 320, height: 180 }));
  const project = {
    schema: 'storyboard-flow.project', version: 1, id, name: '同名项目', revision: 0,
    naming: { sceneCode: scene, artistName: '画师', version: 'v001' },
    shots: [{ id: `${id}_shot`, imageId: `${id}_image`, name: '0010', scriptText: '' }], parkedShots: [], dialogues: [],
    images: { [`${id}_image`]: { id: `${id}_image`, revision: 0, width: 320, height: 180, layers: [
      { id: `${id}_ink`, name: 'Drawing', kind: 'paint', locked: false, visible: true, opacity: 1, blendMode: 'normal', width: 320, height: 180, assetId }
    ] } }
  };
  get(await createProjectStore().saveCheckpoint(root, project, async asset => get(await depot.read(asset))));
  return root;
};
const first = await seed('same-a', 'same-a', 'A');
const second = await seed('same-b', 'same-b', 'B');
const source = path.join(run, 'source');
await mkdir(source);
for (const [index, name] of ['p1.png', 'p2.png'].entries())
  await sharp({ create: { width: 320, height: 180, channels: 4, background: index ? '#a9c6ff' : '#ffffff' } }).png().toFile(path.join(source, name));
await writeFile(path.join(userData, 'recent-projects.json'), JSON.stringify({ version: 1, projects: [
  { id: 'recent-a', root: first, projectId: 'same-a', name: '同名项目', lastOpenedAt: Date.now() },
  { id: 'recent-b', root: second, projectId: 'same-b', name: '同名项目', lastOpenedAt: Date.now() - 1000 }
] }, null, 2));

const driverPath = path.join(run, 'driver.cjs');
const resultPath = path.join(run, 'result.json');
const quitPath = path.join(run, 'quit.json');
await writeFile(driverPath, `const {app,BrowserWindow,dialog,shell,clipboard}=require('electron');
const fs=require('fs'),path=require('path');
const plan=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(run, 'plan.json'))},'utf8'));
const out=${JSON.stringify(resultPath)},quit=${JSON.stringify(quitPath)},evidence=${JSON.stringify(evidence)};
const repo=${JSON.stringify(repo)};
shell.trashItem=()=>{throw Error('Trash is forbidden')};
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard is forbidden')};
let picks=0;
dialog.showOpenDialog=async(_win,options)=>{
  const title=options&&options.title||'';
  if(!title.includes('添加到 Pending'))throw Error('Unexpected dialog: '+title);
  picks++;return {canceled:false,filePaths:[plan.source]};
};
dialog.showErrorBox=(_t,m)=>{throw Error(m)};
process.argv=[process.execPath,repo,'--choose',plan.userData];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const write=value=>{if(!fs.existsSync(out))fs.writeFileSync(out,JSON.stringify(value))};
process.on('uncaughtException',e=>{write({ok:false,reason:String(e)});app.exit(1)});
process.on('unhandledRejection',e=>{write({ok:false,reason:String(e)});app.exit(1)});
app.on('will-quit',()=>fs.writeFileSync(quit,JSON.stringify({quit:true})));
import('file://'+repo+'/dist-electron/platform/main/flowEditorEntry.js').catch(e=>{write({ok:false,reason:String(e)});app.exit(1)});
let win;
const exec=code=>Promise.race([win.webContents.executeJavaScript(code),sleep(2500).then(()=>{throw Error('executeJavaScript timed out')})]);
const wait=async(fn,label)=>{const end=Date.now()+40000;while(Date.now()<end){try{if(await fn())return true}catch(e){}await sleep(50)}throw Error('timeout '+label)};
const sel=value=>'document.querySelector('+JSON.stringify(value)+')';
const exists=value=>exec('!!'+sel(value));
const button=(label)=>exec('(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==='+JSON.stringify(label)+');if(!b)return false;b.click();return true})()');
const field=key=>exec(sel('[data-project-field='+key+']')+'.value');
const waitField=(key,value)=>wait(async()=>(await field(key))===value,'field '+key+' '+value);
const targets=scope=>exec('[...document.querySelectorAll('+JSON.stringify(scope+' [data-recent-target]')+')].map(e=>e.dataset.recentTarget)');
const checkpoint=()=>{try{return JSON.parse(fs.readFileSync(path.join(plan.second,'.storyboard-flow/checkpoints/project.json'),'utf8'))}catch{return null}};
const shot=async name=>{const image=await win.webContents.capturePage();fs.writeFileSync(path.join(evidence,name+'.png'),image.toPNG())};
const clickRecent=(target)=>exec('(()=>{const e=[...document.querySelectorAll("[data-recent-target]")].find(e=>e.dataset.recentTarget==='+JSON.stringify(target)+');if(!e)return false;const b=e.closest("button")||e.querySelector("button");if(!b)return false;b.click();return true})()');
const togglePending=async()=>{
  await exec(sel('.wb-panel-menu summary')+'.click()');
  await exec('(()=>{const box=document.querySelector("[data-panel-toggle=pending]");if(!box)return false;box.click();return true})()');
  await exec(sel('.wb-panel-menu')+'.open=false');
};
app.whenReady().then(async()=>{
 try{
  await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');
  await wait(()=>exists('[data-project-launcher]'),'launcher');
  await wait(async()=>(await targets('.launcher-recent')).length===2,'home targets');
  const homeTargets=await targets('.launcher-recent');
  if(!homeTargets.some(target=>target.includes('same-a/同名项目'))||!homeTargets.some(target=>target.includes('same-b/同名项目')))throw Error('same-name home targets missing: '+homeTargets);
  if(new Set(homeTargets).size!==2)throw Error('home targets not unique');
  await shot('01-home-targets');
  if(!(await clickRecent(homeTargets.find(target=>target.includes('same-a/同名项目')))))throw Error('home recent A not clickable');
  await wait(()=>exists('[data-workbench]'),'workbench A');
  await waitField('sceneCode','A');
  await exec(sel('.wb-project-menu summary')+'.click()');
  await wait(async()=>(await targets('.wb-project-menu-list')).length===2,'menu targets');
  const menuTargets=await targets('.wb-project-menu-list');
  if(!menuTargets.some(target=>target.includes('same-a/同名项目'))||!menuTargets.some(target=>target.includes('same-b/同名项目')))throw Error('same-name menu targets missing: '+menuTargets);
  await shot('02-menu-targets');
  if(!(await clickRecent(menuTargets.find(target=>target.includes('same-b/同名项目')))))throw Error('menu recent B not clickable');
  await waitField('sceneCode','B');
  await togglePending();
  await wait(()=>exec('!document.querySelector("[data-panel=pending]")'),'pending hidden');
  if(!(await exists('.wb-pending-add')))throw Error('top-bar add missing while Pending hidden');
  await button('添加图片');
  await wait(()=>exists('[data-pending-add]'),'pending sheet');
  await button('选择文件夹…');
  await wait(()=>checkpoint()?.parkedShots?.length===2,'pending checkpoint while hidden');
  await wait(()=>exec('document.querySelectorAll("[data-pending-shot-id]").length===0'),'no hidden cards');
  await shot('03-hidden-add');
  await sleep(800);
  for(let i=0;i<20&&(await exec('!document.querySelector("[data-panel=pending]")'));i++){await togglePending();await sleep(250);}
  await wait(async()=>await exec('document.querySelectorAll("[data-pending-shot-id]").length')===2,'pending cards shown');
  const result={ok:true,homeTargets,menuTargets,picks,parked:checkpoint()?.parkedShots?.length,cards:await exec('document.querySelectorAll("[data-pending-shot-id]").length')};
  fs.writeFileSync(out,JSON.stringify(result));
  await sleep(200);
  win.close();
 }catch(e){let body='';try{body=await exec('document.body.innerText')}catch{};write({ok:false,reason:String(e&&e.stack||e),body});app.exit(1)}
});
`);

await writeFile(path.join(run, 'plan.json'), JSON.stringify({ userData, evidence, source, second }));
const log = [];
const child = spawn(electron, [driverPath], { cwd: repo, env: { ...process.env, FLOW_USER_DATA_DIR: userData }, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', chunk => log.push(String(chunk)));
child.stderr.on('data', chunk => log.push(String(chunk)));
const code = await new Promise(resolve => {
  const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 90000);
  child.once('exit', value => { clearTimeout(timer); resolve(value); });
});
await writeFile(path.join(evidence, 'run.log'), log.join(''));
const result = JSON.parse(await readFile(resultPath, 'utf8'));
const quit = existsSync(quitPath) ? JSON.parse(await readFile(quitPath, 'utf8')) : null;
await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ ...result, exit: code, quit, log: log.join('') }, null, 2));
if (!result.ok) { console.error('FAIL', evidence, result); process.exit(1); }
if (!quit?.quit) { console.error('FAIL did not close cleanly', evidence, code); process.exit(1); }
console.log('PASS', evidence, JSON.stringify(result));
