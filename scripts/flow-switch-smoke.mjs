// Real TIFF-only folder -> isolated editor -> Save/Undo/Save -> relocate -> reopen.
import {createRequire} from 'node:module';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,readFile,realpath,rename,cp,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';
import {createTiffCodec} from '../dist-electron/core/formats/index.js';
import {createProjectStore} from '../dist-electron/core/persistence/index.js';
const require=createRequire(import.meta.url),repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-switch-smoke-'));
let root=path.join(run,'tiff-folder');await mkdir(root);await mkdir(path.join(root,'Pending'));
const get=r=>{if(!r.ok)throw Error(r.error.message);return r.value};
const codec=createTiffCodec({scriptPath:path.join(repo,'electron/core/formats/codec.py'),depsDir:path.join(repo,'vendor/python/photoshop-tiff')});
const assets=new Map();const image={id:'shared-image',revision:0,width:640,height:360,layers:[]};
for(const [i,color] of ['#ffffff','#00000000'].entries()){
 const png=await sharp({create:{width:640,height:360,channels:4,background:color}}).png().toBuffer();
 const assetId=createHash('sha256').update(png).digest('hex');assets.set(assetId,png);
 image.layers.push({id:i?'ink':'base',name:i?'绘画':'背景',kind:i?'paint':'image',visible:true,locked:false,opacity:1,blendMode:'normal',width:640,height:360,assetId});
}
const original=get(await codec.encode({image,text:{projectId:'source-project',projectName:'source',shotId:'shared-shot',shotName:'镜头',scriptText:'源脚本',dialogues:[{id:'same-line',shotId:'shared-shot',text:'源对白'}]}},async id=>assets.get(id)));
for(const name of ['01.tif','02.tif','Pending/03.tif'])await writeFile(path.join(root,name),original);
const identity={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),status:execFileSync('git',['status','--short'],{encoding:'utf8'}).trim(),run};
const other=path.join(run,'copy'),bad=path.join(run,'invalid');await mkdir(bad);
const userData=path.join(run,'userData');await mkdir(userData);const driver=path.join(run,'driver.cjs');
await writeFile(driver,`
const {app,BrowserWindow,clipboard,shell,dialog,ipcMain}=require('electron');const fs=require('node:fs');const assert=require('node:assert/strict');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};shell.trashItem=()=>{throw Error('Trash forbidden')};
const root=${JSON.stringify(root)},other=${JSON.stringify(other)},bad=${JSON.stringify(bad)};
let choice=null,choices=0,saveRelease,saveEntered=false,delaySave=false;
dialog.showOpenDialog=async()=>{choices++;return {canceled:choice===null,filePaths:choice?[choice]:[]}};
const handle=ipcMain.handle.bind(ipcMain);ipcMain.handle=(name,fn)=>handle(name,async(...args)=>{
 if(name==='flow-editor:saveTiff'&&delaySave){saveEntered=true;await new Promise(r=>{saveRelease=r})}return fn(...args);
});
process.argv=[process.argv[0],${JSON.stringify(path.join(repo,'dist-electron/main/flowEditorEntry.js'))},root,${JSON.stringify(userData)}];
const delay=ms=>new Promise(r=>setTimeout(r,ms));let win;const cases=[];
const read=p=>JSON.parse(fs.readFileSync(p+'/.storyboard-flow/checkpoints/project.json','utf8'));
async function wait(fn,label){for(let i=0;i<600;i++){try{const v=await fn();if(v)return v}catch{}await delay(50)}throw Error('Timed out: '+label)}
const js=code=>win.webContents.executeJavaScript(code);
async function button(text){await js('Array.from(document.querySelectorAll("button")).find(e=>e.textContent==='+JSON.stringify(text)+').click()');await delay(100)}
async function ready(){await wait(()=>js('Array.from(document.querySelectorAll("button")).some(e=>e.textContent==="Open project"&&!e.disabled)'),'switch settled');await wait(()=>js('document.querySelector("[role=status]").textContent==="Editable project saved"'),'checkpoint')}
async function edit(text){const id=read((await js('window.flowEditor.open()')).sessionId===bToken?other:root).shots[0].id;await js('(()=>{const e=Array.from(document.querySelectorAll("textarea")).find(e=>e.getAttribute("aria-label")==='+JSON.stringify('Script '+id)+');e.focus();e.select()})()');await win.webContents.insertText(text)}
let bToken;
app.on('window-all-closed',()=>fs.writeFileSync(${JSON.stringify(path.join(run,'closed.json'))},JSON.stringify({normalClose:true})));
import(${JSON.stringify('file://'+path.join(repo,'dist-electron/main/flowEditorEntry.js'))}).then(async()=>{
 await app.whenReady();win=await wait(()=>BrowserWindow.getAllWindows()[0],'window');await ready();
 const a=await js('window.flowEditor.open()');
 await edit('A edited');await wait(()=>read(root).shots[0].scriptText==='A edited','A checkpoint');
 fs.cpSync(root,other,{recursive:true});
 await button('Open project');await ready();assert.equal((await js('window.flowEditor.open()')).sessionId,a.sessionId);cases.push('cancel preserves A session and edits');
 choice=bad;await button('Open project');await wait(()=>js('document.querySelector("[role=status]").textContent.includes("Error")'),'invalid folder refused');
 assert.equal((await js('window.flowEditor.open()')).sessionId,a.sessionId);
 await button('Undo');await wait(()=>read(root).shots[0].scriptText==='源脚本','original history remains');await button('Redo');await wait(()=>read(root).shots[0].scriptText==='A edited','Redo after failed open');cases.push('invalid B preserves A editing and history');
 await button('Naming');
 for(const [label,value] of [['Project name','电影'],['Scene code','S01'],['Artist name','甲'],['Output version','2']]){
  await js('(()=>{const e=Array.from(document.querySelectorAll("input")).find(e=>e.getAttribute("aria-label")==='+JSON.stringify(label)+');e.focus();e.select()})()');await win.webContents.insertText(value);
 }
 await button('Apply naming');await wait(()=>read(root).naming.version==='2','naming checkpoint');
 assert.equal(fs.existsSync(root+'/01.tif'),true);assert.equal(fs.existsSync(root+'/电影_S01_stb_甲_v002_0010.tif'),false);
 await button('Undo');await wait(()=>read(root).naming.version==='v001','Undo naming');await button('Redo');await wait(()=>read(root).naming.version==='2','Redo naming');cases.push('naming fields checkpoint together with Undo/Redo and no early filesystem rename');
 choice=other;delaySave=true;await button('Save TIFF');await wait(()=>saveEntered,'Save admitted');const before=choices;
 await button('Open project');await delay(200);assert.equal(choices,before);assert.equal((await js('window.flowEditor.open()')).sessionId,a.sessionId);
 saveRelease();delaySave=false;await wait(async()=>{bToken=(await js('window.flowEditor.open()')).sessionId;return bToken!==a.sessionId},'B owner');await ready();cases.push('switch waits for actual Save completion');
 assert.equal(fs.existsSync(root+'/01.tif'),false);assert.equal(fs.existsSync(root+'/电影_S01_stb_甲_v002_0010.tif'),true);assert.equal(fs.existsSync(root+'/Pending/03.tif'),true);cases.push('explicit Save applies configured ordered names while retaining Pending names');
 const b=await js('window.flowEditor.open()');assert.equal(b.project.id,a.project.id);
 for(const method of ['read','checkpoint','saveTiff','put']){
  const arg=method==='read'?a.project.images[a.project.shots[0].imageId].layers[0].assetId:method==='put'?{operationId:'late',png:new Uint8Array(),width:4,height:4}:a.project;
  assert.equal(await js('window.flowEditor['+JSON.stringify(method)+']('+JSON.stringify(a.sessionId)+','+JSON.stringify(arg)+').then(()=>false,()=>true)'),true);
 }cases.push('real IPC rejects stale read put checkpoint and Save for copied same-ID project');
 const aDisk=JSON.stringify(read(root));await edit('B only');await wait(()=>read(other).shots[0].scriptText==='B only','B edit');assert.equal(JSON.stringify(read(root)),aDisk);cases.push('B edits cannot mutate A');
 choice=root;await button('Open project');await wait(async()=>(await js('window.flowEditor.open()')).sessionId!==bToken,'return A');await ready();
 const reopened=await js('window.flowEditor.open()');assert.notEqual(reopened.sessionId,a.sessionId);assert.equal(reopened.project.shots[0].scriptText,'A edited');
 assert.equal(await js('window.flowEditor.checkpoint('+JSON.stringify(a.sessionId)+','+JSON.stringify(a.project)+').then(()=>false,()=>true)'),true);cases.push('A reopen keeps checkpoint with a new token');
 // Close while a delayed Save and switch are pending must wait for the new owner.
 choice=other;delaySave=true;saveEntered=false;await button('Save TIFF');await wait(()=>saveEntered,'second Save admitted');await button('Open project');win.close();await delay(200);assert.equal(win.isDestroyed(),false);saveRelease();
 cases.push('Close waits for pending switch and certifies the selected owner');
 fs.writeFileSync(${JSON.stringify(path.join(run,'cases.json'))},JSON.stringify(cases));
}).catch(async error=>{console.error(error);if(win&&!win.isDestroyed())console.error(await js('document.body.innerText'));fs.writeFileSync(${JSON.stringify(path.join(run,'failure.txt'))},String(error.stack||error));app.exit(1)});
`);
execFileSync(process.execPath,['--check',driver]);
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});const chunks=[];
child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>chunks.push(b));
const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
await writeFile(path.join(run,'output.log'),Buffer.concat(chunks));console.log('switch',code,run);
if(code!==0)throw Error('Switch GUI failed; retained '+run);
const closed=JSON.parse(await readFile(path.join(run,'closed.json'),'utf8'));if(!closed.normalClose)throw Error('No certified Close');
const cases=JSON.parse(await readFile(path.join(run,'cases.json'),'utf8'));
await writeFile(path.join(run,'receipt.json'),JSON.stringify({...identity,code,cases,closed},null,2));console.log(cases);
