// Real-window recent-target management:
//   - a missing target is not a dead click: remove it or re-locate the same project
//   - re-location rejects a different project identity
//   - only a successful re-location becomes openable again
//
// Requires `npm run build`; synthetic projects and an isolated userData.
import { mkdtemp, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
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
const run = await realpath(await mkdtemp(path.join(os.tmpdir(), 'flow-recent-manage-')));
const evidence = path.join(repo, '.hermes', 'recent-manage-nov04', path.basename(run));
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
    schema: 'storyboard-flow.project', version: 1, id, name, revision: 0,
    shots: [{ id: `${id}_shot`, imageId: `${id}_image`, name: '0010', scriptText: '' }], parkedShots: [], dialogues: [],
    images: { [`${id}_image`]: { id: `${id}_image`, revision: 0, width: 320, height: 180, layers: [
      { id: `${id}_ink`, name: 'Drawing', kind: 'paint', locked: false, visible: true, opacity: 1, blendMode: 'normal', width: 320, height: 180, assetId }
    ] } }
  };
  get(await createProjectStore().saveCheckpoint(root, project, async asset => get(await depot.read(asset))));
  return root;
};

const moveSource = await seed('移动项目', 'move-project');
const removeSource = await seed('移除项目', 'remove-project');
const movedRoot = path.join(run, '移动项目-新位置');
await rename(moveSource, movedRoot);
await rename(removeSource, path.join(run, '移除项目-已丢失'));
await writeFile(path.join(userData, 'recent-projects.json'), JSON.stringify({ version: 1, projects: [
  { id: 'recent-move', root: moveSource, projectId: 'move-project', name: '移动项目', lastOpenedAt: Date.now() },
  { id: 'recent-remove', root: removeSource, projectId: 'remove-project', name: '移除项目', lastOpenedAt: Date.now() - 1000 }
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
let relocates=0;
dialog.showOpenDialog=async(_win,options)=>{
  const title=options&&options.title||'';
  if(!title.includes('重新定位最近项目'))throw Error('Unexpected dialog: '+title);
  relocates++;
  return {canceled:false,filePaths:[plan.movedRoot]};
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
const shot=async name=>{const image=await win.webContents.capturePage();fs.writeFileSync(path.join(evidence,name+'.png'),image.toPNG())};
const rows=()=>exec('[...document.querySelectorAll("[data-recent-project]")].map(row=>({id:row.dataset.recentProject,text:row.textContent,available:!row.textContent.includes("不可用")}))');
const clickRowButton=(name,label)=>exec('(()=>{const row=[...document.querySelectorAll("[data-recent-project]")].find(row=>row.textContent.includes('+JSON.stringify(name)+'));if(!row)return false;const button=[...row.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(label)+');if(!button)return false;button.click();return true})()');
app.whenReady().then(async()=>{
 try{
  await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');
  await wait(()=>exec('!!document.querySelector("[data-project-launcher]")'),'launcher');
  await wait(async()=>(await rows()).filter(row=>!row.available).length===2,'two missing');
  const before=await rows();
  await shot('01-missing');
  if(!(await clickRowButton('移除项目','移除')))throw Error('remove button missing');
  await wait(async()=>!(await rows()).some(row=>row.text.includes('移除项目')),'removed row');
  if(!(await clickRowButton('移动项目','重新定位…')))throw Error('relocate button missing');
  await wait(async()=>{const row=(await rows()).find(row=>row.text.includes('移动项目'));return row&&row.available},'relocated row');
  if(relocates!==1)throw Error('relocate dialog count '+relocates);
  const after=await rows();
  await shot('02-relocated');
  await exec('(()=>{const row=[...document.querySelectorAll("[data-recent-project]")].find(row=>row.textContent.includes("移动项目"));const b=row&&[...row.querySelectorAll("button")].find(x=>x.textContent.includes("移动项目"));if(!b)return false;b.click();return true})()');
  await wait(()=>exec('!!document.querySelector("[data-workbench]")'),'relocated workbench');
  await wait(()=>exec('document.querySelector("[data-project-title]")?.textContent.trim()==="移动项目"'),'relocated name');
  fs.writeFileSync(out,JSON.stringify({ok:true,before,after,relocates,opened:true}));
  await sleep(200);
  win.close();
 }catch(e){let body='';try{body=await exec('document.body.innerText')}catch{};write({ok:false,reason:String(e&&e.stack||e),body});app.exit(1)}
});
`);

await writeFile(path.join(run, 'plan.json'), JSON.stringify({ userData, evidence, movedRoot }));
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
console.log('PASS', evidence, JSON.stringify({ before: result.before, after: result.after, relocates: result.relocates }));
