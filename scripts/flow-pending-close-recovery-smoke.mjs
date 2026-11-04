// Synthetic real-window checks for the Pending append contract:
//   close: add -> edit naming -> autosave -> close (no explicit Save) -> reopen
//   recovery: lose the bridge reply after the durable append -> retry the same
//             operation id -> no picker, no duplicate Pending output
//
// Requires `npm run build`. Uses only synthetic projects and an isolated userData.
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
const electron = require('electron');
const run = await realpath(await mkdtemp(path.join(os.tmpdir(), 'flow-pending-close-')));
const evidence = path.join(repo, '.hermes', 'pending-close-recovery-nov04', path.basename(run));
await mkdir(evidence, { recursive: true });
const userData = path.join(run, 'userData');
await mkdir(userData);
const get = result => { if (!result.ok) throw Error(result.error.message); return result.value; };

const seed = async (name, id) => {
  const root = path.join(run, name);
  await mkdir(root);
  const depot = get(await openFlowAssetDepot({ root, sessionId: 'seed', maxPixels: 1_000_000, maxPngBytes: 1_000_000 }));
  const png = await sharp({ create: { width: 320, height: 180, channels: 4, background: '#dddddd' } }).png().toBuffer();
  const { assetId } = get(await depot.put({ operationId: 'seed', png, width: 320, height: 180 }));
  const project = {
    schema: 'storyboard-flow.project', version: 1, id, name: '初始项目',
    naming: { sceneCode: 'S01', artistName: '画师', version: 'v001' }, revision: 0,
    shots: [{ id: `${id}_shot`, imageId: `${id}_image`, name: '0010', scriptText: '' }], parkedShots: [], dialogues: [],
    images: { [`${id}_image`]: { id: `${id}_image`, revision: 0, width: 320, height: 180, layers: [
      { id: `${id}_ink`, name: 'Drawing', kind: 'paint', locked: false, visible: true, opacity: 1, blendMode: 'normal', width: 320, height: 180, assetId }
    ] } }
  };
  get(await createProjectStore().saveCheckpoint(root, project, async asset => get(await depot.read(asset))));
  return root;
};
const source = path.join(run, 'source');
await mkdir(source);
for (const [index, name] of ['p1.png', 'p2.png'].entries())
  await sharp({ create: { width: 320, height: 180, channels: 4, background: index ? '#a9c6ff' : '#ffffff' } }).png().toFile(path.join(source, name));
const closeSeed = await seed('close-seed', 'close-project');
const recoverySeed = await seed('recovery-seed', 'recovery-project');

const driverPath = path.join(run, 'driver.cjs');
const resultPath = path.join(run, 'result.json');
const quitPath = path.join(run, 'quit.json');
await writeFile(driverPath, `const {app,BrowserWindow,dialog,shell,clipboard,ipcMain}=require('electron');
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
  picks++;
  return {canceled:false,filePaths:[plan.source]};
};
dialog.showErrorBox=(_t,m)=>{throw Error(m)};
process.argv=[process.execPath,repo,plan.root,plan.userData];
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
const button=(label,scope='')=>exec('(()=>{const list=[...document.querySelectorAll('+JSON.stringify(scope+((scope?' ':'')+'button'))+')];const b=list.find(x=>x.textContent.trim()==='+JSON.stringify(label)+')||list.find(x=>x.textContent.includes('+JSON.stringify(label)+'));if(!b)return false;b.click();return true})()');
const waitButton=async(label,scope='')=>wait(()=>button(label,scope),'button '+label);
const waitText=async(value)=>wait(async()=>String(await exec('document.body.innerText')).includes(value),'text '+value);
const field=key=>exec(sel('[data-project-field='+key+']')+'.value');
const waitField=(key,value)=>wait(async()=>(await field(key))===value,'field '+key);
const setInput=(selector,value)=>exec('(()=>{const i='+sel(selector)+';if(!i)return false;const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,'+JSON.stringify(value)+');i.dispatchEvent(new Event("input",{bubbles:true}));i.blur();return true})()');
const pendingCount=()=>exec('document.querySelectorAll("[data-pending-shot-id]").length');
const shot=async name=>{const image=await win.webContents.capturePage();fs.writeFileSync(path.join(evidence,name+'.png'),image.toPNG())};
const rootTifs=()=>{try{return fs.readdirSync(plan.root).filter(name=>name.endsWith('.tif')).sort()}catch{return []}};
const pendingTifs=()=>{try{return fs.readdirSync(path.join(plan.root,'Pending')).filter(name=>name.endsWith('.tif')).sort()}catch{return []}};
const add = async () => {
  await wait(()=>exists('.wb-pending-add'),'pending add');
  await button('添加图片');
  await wait(()=>exists('[data-pending-add]'),'pending sheet');
  await button('选择文件夹…');
};
const runPhase=async()=>{
 if(plan.phase==='close'){
  await wait(()=>exists('[data-workbench]'),'close workbench');
  await add();
  await wait(async()=>await pendingCount()===2,'close pending 2');
  await setInput('[data-project-field=name]','无保存关闭');
  await wait(async()=>String(await exec('document.body.innerText')).includes('已自动暂存'),'close autosave');
  await sleep(700);
  const before={root:rootTifs(),pending:pendingTifs(),count:await pendingCount(),picks};
  if(before.root.length)throw Error('active TIFF written before close');
  await shot('01-close-before');
  return {ok:true,phase:'close',before};
 }
 if(plan.phase==='close-reopen'){
  await wait(()=>exists('[data-workbench]'),'reopened close workbench');
  await waitField('name','无保存关闭');
  await wait(async()=>await pendingCount()===2,'reopened close pending 2');
  const after={root:rootTifs(),pending:pendingTifs(),count:await pendingCount(),picks};
  if(after.root.length)throw Error('reopen wrote an active TIFF without Save');
  if(after.pending.length!==2)throw Error('reopen pending TIFFs '+after.pending.length);
  await shot('02-close-reopened');
  return {ok:true,phase:'close-reopen',after};
 }
 if(plan.phase==='recovery'){
  await wait(()=>exists('[data-workbench]'),'recovery workbench');
  await wait(()=>ipcMain._invokeHandlers&&ipcMain._invokeHandlers.has('flow-editor:pending-add'),'pending handler');
  const channel='flow-editor:pending-add', original=ipcMain._invokeHandlers.get(channel);
  let injected=0;
  ipcMain._invokeHandlers.set(channel,async(event,...args)=>{
    const result=await original(event,...args);
    if(injected<2&&result&&result.ok){injected++;return {ok:false,error:{code:'io-failure',message:'injected lost bridge reply '+injected+' after durable append',effect:'unknown'}};}
    return result;
  });
  await add();
  await wait(async()=>await exec(sel('[data-pending-add]')+'.dataset.pendingPhase')==='error','injected error');
  await waitText('injected lost bridge reply');
  const afterFault={picks,injected,count:await pendingCount(),root:rootTifs(),pending:pendingTifs()};
  if(picks!==1)throw Error('first add picked '+picks+' times');
  if(afterFault.pending.length!==2)throw Error('durable append missing files');
  await shot('03-recovery-error');
  const closeChannel='flow-editor:finish-close', finish=ipcMain._invokeHandlers.get(closeChannel);
  let vetoed=false;
  ipcMain._invokeHandlers.set(closeChannel,async(event,...args)=>{
    const result=await finish(event,...args);
    if(!result.ok&&args[2]===null)vetoed=true;
    return result;
  });
  win.close();
  await wait(async()=>vetoed,'uncertain operation vetoes window close');
  await button('重试');
  await waitText('injected lost bridge reply 2');
  await button('重试');
  await wait(async()=>await pendingCount()===2,'recovered pending 2');
  const afterRecover={picks,count:await pendingCount(),root:rootTifs(),pending:pendingTifs()};
  if(picks!==1)throw Error('recover reopened the picker');
  if(afterRecover.pending.length!==2)throw Error('recover duplicated Pending output');
  if(afterRecover.count!==2)throw Error('recover duplicated Pending cards');
  if(afterRecover.root.length)throw Error('recover wrote an active TIFF');
  await shot('04-recovered');
  return {ok:true,phase:'recovery',afterFault,afterRecover,vetoed,lostReplies:injected};
 }
 if(plan.phase==='recovery-reopen'){
  await wait(()=>exists('[data-workbench]'),'recovery reopen workbench');
  await wait(async()=>await pendingCount()===2,'recovered pending persisted');
  const after={picks,count:await pendingCount(),root:rootTifs(),pending:pendingTifs()};
  if(after.root.length)throw Error('recovery reopen wrote an active TIFF without Save');
  await shot('05-recovery-reopened');
  return {ok:true,phase:'recovery-reopen',after};
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
  { phase: 'close', root: closeSeed, source },
  { phase: 'close-reopen', root: closeSeed, source },
  { phase: 'recovery', root: recoverySeed, source },
  { phase: 'recovery-reopen', root: recoverySeed, source }
];
let failed = null;
try {
  for (const phase of phases) {
    await writeFile(path.join(run, 'plan.json'), JSON.stringify({ ...phase, userData, evidence, source }));
    await rm(resultPath, { force: true });
    await rm(quitPath, { force: true });
    const log = [];
    const child = spawn(electron, [driverPath], { cwd: repo, env: { ...process.env, FLOW_USER_DATA_DIR: userData }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => log.push(String(chunk)));
    child.stderr.on('data', chunk => log.push(String(chunk)));
    const code = await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 90000);
      child.once('exit', value => { clearTimeout(timer); resolve(value); });
    });
    await writeFile(path.join(evidence, `${phase.phase}.log`), log.join(''));
    const result = JSON.parse(await readFile(resultPath, 'utf8'));
    const quit = existsSync(quitPath) ? JSON.parse(await readFile(quitPath, 'utf8')) : null;
    await writeFile(path.join(evidence, `${phase.phase}.json`), JSON.stringify({ result, quit, exit: code, log: log.join('') }, null, 2));
    if (!result.ok) throw Error(`${phase.phase} failed: ${result.reason}\n${log.join('')}`);
    if (!quit?.quit) throw Error(`${phase.phase} did not close cleanly (exit ${code})`);
    console.log(phase.phase, 'PASS', JSON.stringify(result));
  }
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify({ passed: true, phases: phases.map(phase => phase.phase) }, null, 2));
  console.log('PASS', evidence);
} catch (error) {
  failed = error;
  console.error(error);
  await writeFile(path.join(evidence, 'summary.json'), JSON.stringify({ passed: false, reason: String(error) }, null, 2)).catch(() => {});
} finally {
  await rm(path.join(run, 'userData'), { recursive: true, force: true }).catch(() => {});
}
if (failed) process.exit(1);
