// Isolated native Electron check of the package's default, no-argument entry.
import {mkdtemp,mkdir,writeFile,readFile,realpath} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {openFlowAssetDepot} from '../dist-electron/project-files/main/persistence/depot.js';
import {createProjectStore} from '../dist-electron/project-files/main/persistence/index.js';
const require=createRequire(import.meta.url),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-default-startup-'));
const root=path.join(run,'project');await mkdir(root);
const get=r=>{if(!r.ok)throw Error(r.error.message);return r.value;};
const depot=get(await openFlowAssetDepot({root,sessionId:'seed',maxPixels:1000000,maxPngBytes:1000000}));
const png=await sharp({create:{width:320,height:180,channels:4,background:'#eee'}}).png().toBuffer();
const {assetId}=get(await depot.put({operationId:'seed',png,width:320,height:180}));
const project={schema:'storyboard-flow.project',version:1,id:'startup',name:'Default entry synthetic',revision:0,
 shots:[{id:'shot0',imageId:'image0',name:'0010',scriptText:''}],parkedShots:[],dialogues:[],images:{image0:{id:'image0',revision:0,width:320,height:180,layers:[{id:'ink',name:'Drawing',kind:'paint',locked:false,visible:true,opacity:1,blendMode:'normal',width:320,height:180,assetId}]}}};
get(await createProjectStore().saveCheckpoint(root,project,async id=>get(await depot.read(id))));
const pkg=JSON.parse(await readFile(path.join(repo,'package.json'),'utf8'));
if(pkg.main!=='dist-electron/platform/main/flowEditorEntry.js')throw Error('Default package entry is not Workbench');
for(const phase of ['cancel','open','reopen']){
 const done=path.join(run,phase+'-done.json'),driver=path.join(run,phase+'.cjs');
 await writeFile(driver,`
 const {app,BrowserWindow,dialog,shell,clipboard}=require('electron');
 const fs=require('node:fs'),assert=require('node:assert/strict');
 const phase=${JSON.stringify(phase)},done=${JSON.stringify(done)};
 shell.trashItem=()=>{throw Error('Trash forbidden')};
 for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
 let picked=false,verified=false;
 dialog.showOpenDialog=async()=>{picked=true;return {canceled:phase==='cancel',filePaths:phase==='cancel'?[]:[${JSON.stringify(root)}]}};
 dialog.showErrorBox=(_title,message)=>{throw Error(message)};
 process.argv=[process.execPath,${JSON.stringify(repo)}];
 app.on('will-quit',()=>{if(picked&&(phase==='cancel'||verified))fs.writeFileSync(done,JSON.stringify({ok:true,phase,picked,verified}))});
 const wait=async fn=>{for(let i=0;i<300;i++){try{if(await fn())return}catch{}await new Promise(r=>setTimeout(r,50))}throw Error('Startup timeout')};
 import(${JSON.stringify('file://'+path.join(repo,pkg.main))}).then(async()=>{
  if(phase==='cancel')return;
  await app.whenReady();let win;
  await wait(()=>{win=BrowserWindow.getAllWindows()[0];return win});
  await wait(()=>win.webContents.executeJavaScript('!!document.querySelector("[data-workbench]")'));
  assert.deepEqual(await win.webContents.executeJavaScript('({bridge:!!window.flowEditor,old:!!window.storyboard,hash:location.hash,classic:!!document.querySelector(".flow-editor-grid")})'),{bridge:true,old:false,hash:'#flow-workbench',classic:false});
  await wait(()=>win.webContents.executeJavaScript('document.body.innerText.includes("已自动暂存")'));
  assert.equal(app.getPath('userData'),process.env.FLOW_USER_DATA_DIR);
  verified=true;win.close();
 }).catch(e=>{console.error(e);app.exit(1)});
 `);
 const env={...process.env,FLOW_USER_DATA_DIR:path.join(run,'userData')};delete env.ELECTRON_RUN_AS_NODE;delete env.VITE_DEV_SERVER_URL;
 const child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});let log='';
 child.stdout.on('data',x=>log+=x);child.stderr.on('data',x=>log+=x);
 const watchdog=setTimeout(()=>child.kill('SIGKILL'),60000);
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)}).finally(()=>clearTimeout(watchdog));
 await writeFile(path.join(run,phase+'.log'),log);
 if(code!==0)throw Error(phase+' failed: '+run+'\n'+log);
 const result=JSON.parse(await readFile(done,'utf8'));if(!result.ok)throw Error('Missing completion');
 console.log(phase,'PASS');
}
await writeFile(path.join(run,'receipt.json'),JSON.stringify({passed:true,entry:pkg.main,phases:['cancel','open','reopen']},null,2));
console.log('PASS',run);
