// Real owned TIFF deletion through Electron system Trash; never inspect personal Trash.
// Retains all synthetic evidence, including the files intentionally sent to Trash.
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
const run=await mkdtemp(path.join(await realpath(os.tmpdir()),'flow-trash-smoke-'));
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
for(const phase of ['edit','reopen']){
 const userData=path.join(run,phase+'-userData');await mkdir(userData);const driver=path.join(run,phase+'.cjs');
 await writeFile(driver,`
const {app,BrowserWindow,clipboard,shell,dialog}=require('electron');const fs=require('node:fs');const path=require('node:path');const assert=require('node:assert/strict');
const root=${JSON.stringify(root)},run=${JSON.stringify(run)},phase=${JSON.stringify(phase)};
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard forbidden')};
const nativeTrash=shell.trashItem.bind(shell),nativeCalls=[];let refuse=true;
const rootIdentity=fs.lstatSync(root,{bigint:true});
shell.trashItem=async(file)=>{
 const now=fs.lstatSync(root,{bigint:true});assert.equal(now.ino,rootIdentity.ino);assert.equal(now.dev,rootIdentity.dev);
 const relative=path.relative(root,file),parts=relative.split(path.sep);
 assert.equal(parts.length,4);assert.equal(parts[0],'.storyboard-flow');assert.equal(parts[1],'deletions');assert.match(parts[2],/^[a-f0-9-]{36}$/);
 assert.equal(fs.realpathSync(file),file);assert.equal(fs.lstatSync(file).isFile(),true);
 const ledger=JSON.parse(fs.readFileSync(path.join(root,'.storyboard-flow/tiff-output.json'),'utf8'));
 const entry=ledger.entries.find(e=>e.deletion?.token===parts[2]);assert.ok(entry);assert.equal(entry.name,parts[3]);assert.equal(entry.deletion.phase,'dispatching');
 const stat=fs.lstatSync(file,{bigint:true});assert.equal(String(stat.ino),entry.deletion.ino);assert.equal(String(stat.dev),entry.deletion.dev);
 assert.equal(require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'),entry.deletion.digest);
 if(refuse){refuse=false;throw Error('Synthetic refusal before OS dispatch');}
 await nativeTrash(file);assert.equal(fs.existsSync(file),false);nativeCalls.push({file,ack:true});
 fs.writeFileSync(path.join(run,'native-trash.json'),JSON.stringify(nativeCalls,null,2));
};
dialog.showErrorBox=(title,message)=>{console.error(title,message);app.exit(1)};
dialog.showOpenDialog=async()=>({canceled:false,filePaths:[root]});
process.argv=[process.argv[0],${JSON.stringify(path.join(repo,'dist-electron/main/flowEditorEntry.js'))},'--choose',${JSON.stringify(userData)}];
const delay=ms=>new Promise(r=>setTimeout(r,ms));let win;
const read=()=>JSON.parse(fs.readFileSync(path.join(root,'.storyboard-flow/checkpoints/project.json'),'utf8'));
const ledger=()=>JSON.parse(fs.readFileSync(path.join(root,'.storyboard-flow/tiff-output.json'),'utf8'));
async function wait(fn,label){for(let i=0;i<600;i++){try{const v=await fn();if(v)return v}catch{}await delay(50)}throw Error('Timed out: '+label)}
const js=code=>win.webContents.executeJavaScript(code);
async function button(text){await js('Array.from(document.querySelectorAll("button")).find(e=>e.textContent==='+JSON.stringify(text)+').click()');await delay(100)}
async function save(){await button('Save TIFF');await wait(()=>js('Array.from(document.querySelectorAll("span")).find(e=>e.getAttribute("aria-label")==="TIFF output status").textContent==="TIFF saved"'),'TIFF Save')}
app.on('window-all-closed',()=>fs.writeFileSync(path.join(run,phase+'-closed.json'),JSON.stringify({normalClose:true})));
import(${JSON.stringify('file://'+path.join(repo,'dist-electron/main/flowEditorEntry.js'))}).then(async()=>{
 await app.whenReady();win=await wait(()=>BrowserWindow.getAllWindows()[0],'window');
 await wait(()=>js('!!document.querySelector("[data-flow-editor]")'),'editor');
 await wait(()=>js('document.querySelector("[role=status]").textContent==="Editable project saved"'),'checkpoint');
 const before=read(),shot=before.shots[0];
 if(phase==='edit'){
  await js('document.querySelector('+JSON.stringify('[aria-label="Move '+shot.id+'"]')+').click()');
  await button('Delete shot');await wait(()=>read().shots.length===1,'logical delete');
  assert.equal(fs.existsSync(path.join(root,'01.tif')),true);assert.equal(nativeCalls.length,0);
  await button('Undo');await wait(()=>read().shots.length===2,'Undo before Save');assert.deepEqual(read().shots,before.shots);
  await save();const names=ledger().entries.filter(e=>!e.retired).map(e=>e.name);
  await button('Delete shot');await wait(()=>read().shots.length===1,'delete again');
  await button('Save TIFF');await wait(()=>js('document.body.innerText.includes("Synthetic refusal before OS dispatch")'),'honest failure');
  assert.equal(nativeCalls.length,0);assert.equal(ledger().saved,undefined);
  const intent=ledger().entries.find(e=>e.shotId===shot.id).deletion;
  assert.equal(fs.existsSync(path.join(root,'.storyboard-flow/deletions',intent.token,names[0])),true);
  await save();assert.equal(nativeCalls.length,1);
  assert.equal(ledger().entries.find(e=>e.shotId===shot.id).retired,'trashed');
  assert.deepEqual(read().images,before.images);
  await button('Undo');await wait(()=>read().shots.length===2,'Undo after Save');await save();
  assert.equal(nativeCalls.length,1);assert.deepEqual(read().shots,before.shots);
  assert.deepEqual(ledger().entries.filter(e=>!e.retired).map(e=>e.name),names);
  const entry=ledger().entries.find(e=>e.shotId===shot.id);
  fs.copyFileSync(path.join(root,entry.name),path.join(run,'restored.tif'));
  fs.writeFileSync(path.join(run,'expected.json'),JSON.stringify(read()));
 }else{
  assert.deepEqual(read(),JSON.parse(fs.readFileSync(path.join(run,'expected.json'),'utf8')));
  await save();assert.equal(nativeCalls.length,0);
 }
 fs.writeFileSync(path.join(run,phase+'.png'),(await win.webContents.capturePage()).toPNG());win.close();
}).catch(async error=>{if(win&&!win.isDestroyed()){console.error(await js('document.body.innerText'));fs.writeFileSync(path.join(run,phase+'-failure.png'),(await win.webContents.capturePage()).toPNG());}fs.writeFileSync(path.join(run,phase+'-failure.txt'),String(error.stack||error));console.error(error);app.exit(1)});
`);
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const child=spawn(require('electron'),[driver],{cwd:repo,env,stdio:['ignore','pipe','pipe']});const chunks=[];
 child.stdout.on('data',b=>chunks.push(b));child.stderr.on('data',b=>chunks.push(b));
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)});
 await writeFile(path.join(run,phase+'.log'),Buffer.concat(chunks));console.log(phase,code,run);
 if(code!==0)throw Error('Trash GUI failed; retained '+run);
 await readFile(path.join(run,phase+'-closed.json'));
}
const expected=JSON.parse(await readFile(path.join(run,'expected.json'),'utf8')),shot=expected.shots[0];
const restored=get(await codec.decode(await readFile(path.join(run,'restored.tif'))));
if(restored.text.shotId!==shot.id||restored.text.scriptText!==shot.scriptText)throw Error('Restored TIFF metadata mismatch');
for(let i=0;i<image.layers.length;i++){
 const pixels=await sharp(restored.image.layers[i].png).raw().toBuffer();
 if(!pixels.equals(await sharp(assets.get(image.layers[i].assetId)).raw().toBuffer()))throw Error('Restored pixels mismatch');
}
if(!(await readFile(path.join(root,'.storyboard-flow/originals',shot.id+'.tif'))).equals(Buffer.from(original)))throw Error('Original backup changed');
await writeFile(path.join(run,'receipt.json'),JSON.stringify({...identity,passed:true,cases:['logical deletion leaves TIFF intact','Undo before Save leaves Trash untouched','injected OS refusal retains staged file and no successful Save','retry calls real Electron system Trash for owned synthetic TIFF','retired output frees ordered filename','retained project images unchanged','Undo after Save regenerates original layered pixels and text','original backup byte-exact','fresh-process reopen and Save without repeated Trash','normal certified Close in both processes'],limits:['macOS local filesystem only','one owned synthetic TIFF intentionally retained in system Trash; personal Trash never enumerated']},null,2));
console.log('PASS real system Trash workflow; evidence:',run);
