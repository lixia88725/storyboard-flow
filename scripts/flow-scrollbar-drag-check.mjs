// Isolated native check: a synthetic overflow panel inside the real workbench CSS,
// dragged by holding the visible scrollbar thumb with the mouse. No wheel events and
// no programmatic scrollTop changes are used for the scroll itself.
//
// Requires `npm run build`. The panel is test-only DOM inside the otherwise real
// Electron window; no userData, project, clipboard or Trash is touched.
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electron = require('electron');
const run = await realpath(await mkdtemp(path.join(os.tmpdir(), 'flow-scrollbar-drag-')));
const evidence = path.join(repo, '.hermes', 'scrollbar-drag-nov04', path.basename(run));
await mkdir(evidence, { recursive: true });
const userData = path.join(run, 'userData');
const resultPath = path.join(run, 'result.json');
const quitPath = path.join(run, 'quit.json');
await mkdir(userData);
const driverPath = path.join(run, 'driver.cjs');

await writeFile(driverPath, `const {app,BrowserWindow,dialog,shell,clipboard}=require('electron');
const fs=require('fs'),path=require('path');
const out=${JSON.stringify(resultPath)},quit=${JSON.stringify(quitPath)},evidence=${JSON.stringify(evidence)};
const repo=${JSON.stringify(repo)};
shell.trashItem=()=>{throw Error('Trash is forbidden')};
for(const key of Object.keys(clipboard))if(typeof clipboard[key]==='function')clipboard[key]=()=>{throw Error('Clipboard is forbidden')};
dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});
dialog.showErrorBox=(_t,m)=>{throw Error(m)};
process.argv=[process.execPath,repo,'--choose',${JSON.stringify(userData)}];
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
app.whenReady().then(async()=>{
 try{
  await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win},'window');
  await wait(()=>exec('!!document.querySelector(".flow-launcher")'),'launcher');
  const injected=await exec('(()=>{try{const host=document.querySelector(".flow-launcher");if(!host)return "NO-HOST";const panel=document.createElement("div");panel.id="flow-scrollbar-drag-panel";panel.style.cssText="position:fixed;left:60px;top:120px;width:340px;height:180px;overflow:auto;background:#202427;border:1px solid #3f474d;z-index:99999;color:#ccd;font-size:12px";const content=document.createElement("div");content.style.height="4200px";content.style.padding="10px";for(let i=0;i<84;i++){const row=document.createElement("div");row.style.height="50px";row.textContent="row "+i;content.appendChild(row)}panel.appendChild(content);host.appendChild(panel);return "ok"}catch(e){return "ERR:"+(e&&e.message||e)}})()');
  if(injected!=='ok')throw Error('panel injection '+injected);
  await sleep(400);
  const rect=await exec('(()=>{const p=document.getElementById("flow-scrollbar-drag-panel");const r=p.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height,clientHeight:p.clientHeight,scrollHeight:p.scrollHeight,scrollTop:p.scrollTop}})()');
  const style=await exec('(()=>{const p=document.getElementById("flow-scrollbar-drag-panel");const t=getComputedStyle(p,"::-webkit-scrollbar-thumb");const k=getComputedStyle(p,"::-webkit-scrollbar-track");const b=getComputedStyle(p,"::-webkit-scrollbar");return {width:b.width,thumb:t.backgroundColor,radius:t.borderRadius,border:t.borderWidth,track:k.backgroundColor}})()');
  win.focus();win.webContents.focus();
  win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(rect.left+40),y:Math.round(rect.top+40)});
  await sleep(250);
  await shot('01-before-drag');
  const thumb=Math.max(20,Math.round(rect.height*rect.height/rect.scrollHeight));
  const attempts=[
    {x:rect.right-4,y:rect.top+Math.max(6,Math.round(thumb/2)),dy:70},
    {x:rect.right-3,y:rect.top+12,dy:90},
    {x:rect.right-5,y:rect.top+20,dy:120}
  ];
  let before=rect.scrollTop,after=before,used=null;
  for(const a of attempts){
    win.webContents.sendInputEvent({type:'mouseDown',x:Math.round(a.x),y:Math.round(a.y),button:'left',clickCount:1});
    for(let step=1;step<=8;step++){
      win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(a.x),y:Math.round(a.y+a.dy*step/8),button:'left'});
      await sleep(30);
    }
    win.webContents.sendInputEvent({type:'mouseUp',x:Math.round(a.x),y:Math.round(a.y+a.dy),button:'left',clickCount:1});
    await sleep(500);
    after=await exec('document.getElementById("flow-scrollbar-drag-panel").scrollTop');
    if(after>before){used=a;break;}
  }
  await sleep(200);
  await shot('02-after-drag');
  const result={ok:after>before,rect,style,thumb,before,after,used,evidence};
  if(!result.ok)throw Error('thumb drag did not change scrollTop: '+JSON.stringify(result));
  fs.writeFileSync(out,JSON.stringify(result));
  await sleep(200);
  win.close();
 }catch(e){write({ok:false,reason:String(e&&e.stack||e)});app.exit(1)}
});
`);

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
const quit = JSON.parse(await readFile(quitPath, 'utf8'));
await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ ...result, exit: code, quit, log: log.join('') }, null, 2));
if (!result.ok) {
  console.error('FAIL', evidence, result);
  process.exit(1);
}
console.log('PASS', evidence, JSON.stringify({ before: result.before, after: result.after, thumb: result.thumb, style: result.style }));
