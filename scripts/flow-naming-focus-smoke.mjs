// Real-window naming checks:
//   - focus stays in a naming field while a settled typing run reaches the checkpoint
//   - IME composition is not guessed
//   - one undo step for a typing run, not one per key
//   - empty/invalid values auto-checkpoint but explicit Save stays refused
//   - a valid Save uses the current name and never renames the project folder
//   - close/reopen without Save restores the auto-checkpointed name
//
// Requires `npm run build`; synthetic project only.
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
const electron = require('electron');
const run = await realpath(await mkdtemp(path.join(os.tmpdir(), 'flow-naming-focus-')));
const evidence = path.join(repo, '.hermes', 'naming-focus-nov04', path.basename(run));
await mkdir(evidence, { recursive: true });
const root = path.join(run, 'naming-seed');
await mkdir(root);
const userData = path.join(run, 'userData');
await mkdir(userData);
const get = result => { if (!result.ok) throw Error(result.error.message); return result.value; };
const depot = get(await openFlowAssetDepot({ root, sessionId: 'seed', maxPixels: 1_000_000, maxPngBytes: 1_000_000 }));
const png = await sharp({ create: { width: 320, height: 180, channels: 4, background: '#dddddd' } }).png().toBuffer();
const { assetId } = get(await depot.put({ operationId: 'seed', png, width: 320, height: 180 }));
const project = {
  schema: 'storyboard-flow.project', version: 1, id: 'naming-seed', name: '初始项目',
  naming: { sceneCode: 'S01', artistName: '画师', version: 'v001' }, revision: 0,
  shots: [{ id: 'seed-shot', imageId: 'seed-image', name: '0010', scriptText: '' }], parkedShots: [], dialogues: [],
  images: { 'seed-image': { id: 'seed-image', revision: 0, width: 320, height: 180, layers: [
    { id: 'seed-ink', name: 'Drawing', kind: 'paint', locked: false, visible: true, opacity: 1, blendMode: 'normal', width: 320, height: 180, assetId }
  ] } }
};
get(await createProjectStore().saveCheckpoint(root, project, async id => get(await depot.read(id))));

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
dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});
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
const button=(label)=>exec('(()=>{const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==='+JSON.stringify(label)+');if(!b)return false;b.click();return true})()');
const openNaming=()=>wait(()=>exec('(()=>{if(document.querySelector("[data-project-naming]"))return true;document.querySelector("[data-project-title]:not(:disabled)")?.click();return false})()'),'open project naming');
const field=async()=>{await openNaming();return exec(sel('[data-project-field=name]')+'.value');};
const waitField=value=>wait(async()=>(await field())===value,'name '+value);
const checkpoint=()=>{try{return JSON.parse(fs.readFileSync(path.join(plan.root,'.storyboard-flow/checkpoints/project.json'),'utf8'))}catch{return null}};
const waitCheckpoint=value=>wait(()=>checkpoint()?.name===value,'checkpoint '+value);
const rootTifs=()=>{try{return fs.readdirSync(plan.root).filter(name=>name.endsWith('.tif')).sort()}catch{return []}};
const folderLabel=async()=>{await openNaming();return exec(sel('[data-project-naming] .wb-project-folder')+'.textContent');};
const saveDisabled=()=>exec('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="保存").disabled');
const focusName=async()=>{await openNaming();return exec('(()=>{const i='+sel('[data-project-field=name]')+';i.focus();return document.activeElement===i})()');};
const typeName=async(value)=>{
  await focusName();
  const chars=[...value];
  if(!chars.length){
    await exec('(()=>{const i='+sel('[data-project-field=name]')+';const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,"");i.dispatchEvent(new Event("input",{bubbles:true}));})()');
    return;
  }
  for(let i=1;i<=chars.length;i++){
    const text=chars.slice(0,i).join('');
    await exec('(()=>{const i='+sel('[data-project-field=name]')+';const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,'+JSON.stringify(text)+');i.dispatchEvent(new Event("input",{bubbles:true}));})()');
    await sleep(45);
  }
};
const shot=async name=>{const image=await win.webContents.capturePage();fs.writeFileSync(path.join(evidence,name+'.png'),image.toPNG())};
const runPhase=async()=>{
 if(plan.phase==='focus'){
  await wait(()=>exists('[data-workbench]'),'workbench');
  await waitField('初始项目');
  await focusName();
  await exec('(()=>{const i='+sel('[data-project-field=name]')+';i.dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}));const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(i,"组字中");i.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await sleep(900);
  if((checkpoint()?.name)!=='初始项目')throw Error('IME text reached the checkpoint before compositionend');
  if(!(await saveDisabled()))throw Error('Save enabled during IME composition');
  await exec('(()=>{const i='+sel('[data-project-field=name]')+';i.dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}));})()');
  await waitCheckpoint('组字中');
  await typeName('自动暂存名');
  await waitCheckpoint('自动暂存名');
  const focused=await exec('document.activeElement==='+sel('[data-project-field=name]'));
  if(!focused)throw Error('naming field lost focus during autosave');
  if((await folderLabel())!==('文件夹 '+path.basename(plan.root)))throw Error('folder label changed');
  if(rootTifs().length)throw Error('autosave wrote an output TIFF');
  await shot('01-focus-autosave');
  return {ok:true,phase:'focus',name:checkpoint()?.name,focused,root:rootTifs(),folder:await folderLabel()};
 }
 if(plan.phase==='focus-reopen'){
  await wait(()=>exists('[data-workbench]'),'reopened workbench');
  await waitField('自动暂存名');
  if(rootTifs().length)throw Error('reopen wrote an output TIFF');
  await typeName('ABCDE');
  await waitCheckpoint('ABCDE');
  await button('撤销');
  await waitCheckpoint('自动暂存名');
  await waitField('自动暂存名');
  await button('重做');
  await waitCheckpoint('ABCDE');
  await waitField('ABCDE');
  await typeName('自动暂存名');
  await waitCheckpoint('自动暂存名');
  await shot('02-undo-redo');
  return {ok:true,phase:'focus-reopen',name:checkpoint()?.name,root:rootTifs()};
 }
 if(plan.phase==='invalid-save'){
  await wait(()=>exists('[data-workbench]'),'invalid workbench');
  await waitField('自动暂存名');
  await typeName('');
  await waitCheckpoint('');
  if(!(await saveDisabled()))throw Error('Save enabled for an empty name');
  if(!String(await exec('document.body.innerText')).includes('项目名称不能为空'))throw Error('empty-name error missing');
  await button('保存');
  await sleep(500);
  if(rootTifs().length)throw Error('Save wrote output with an empty name');
  await typeName('a/b');
  await waitCheckpoint('a/b');
  if(!(await saveDisabled()))throw Error('Save enabled for an invalid name');
  if(rootTifs().length)throw Error('invalid name wrote an output TIFF');
  if((await folderLabel())!==('文件夹 '+path.basename(plan.root)))throw Error('invalid name changed the folder');
  await shot('03-invalid-save-refused');
  await typeName('保存名');
  await waitCheckpoint('保存名');
  const disabled=await saveDisabled();
  if(disabled)throw Error('Save disabled for a valid name');
  await button('保存');
  await wait(()=>rootTifs().some(name=>name.startsWith('保存名_')),'valid Save output');
  const tifs=rootTifs();
  if((await folderLabel())!==('文件夹 '+path.basename(plan.root)))throw Error('valid name changed the folder');
  return {ok:true,phase:'invalid-save',name:checkpoint()?.name,tifs,folder:await folderLabel()};
 }
 if(plan.phase==='final-reopen'){
  await wait(()=>exists('[data-workbench]'),'final workbench');
  await waitField('保存名');
  await wait(()=>rootTifs().some(name=>name.startsWith('保存名_')),'final output');
  return {ok:true,phase:'final-reopen',name:checkpoint()?.name,tifs:rootTifs()};
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
  { phase: 'focus' },
  { phase: 'focus-reopen' },
  { phase: 'invalid-save' },
  { phase: 'final-reopen' }
];
let failed = null;
try {
  for (const phase of phases) {
    await writeFile(path.join(run, 'plan.json'), JSON.stringify({ ...phase, root, userData, evidence }));
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
}
if (failed) process.exit(1);
