import {test,expect,onTestFinished} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {assertPhysicalWorkspaceWriterTargets} from './workspacePhysicalWriterGate';
import {serializeStoryboardScriptMarkdown} from './storyboardScript';
import {createRecoveryCloseBarrier} from './recoveryCloseBarrier';

// Original safeHandoffNative fixture/native Save seam; not Main bootstrap/GUI.
// Every source is now owner-readonly, not a shared-new-root permission surrogate.
const root=os.tmpdir();
const options={budget:{bytes:1048576,records:2000,assets:64,jsonDepth:80},python:'/opt/homebrew/opt/python@3.12/libexec/bin/python3',script:path.resolve('scripts/recovery-content-permissions.py')};
function actor(){const frame={},sender={mainFrame:frame};return {sender,senderFrame:frame} as any;}
async function fixture(label:string){
 const folder=await fs.mkdtemp(path.join(root,'native-'+label+'-'));
 onTestFinished(()=>fs.rm(folder,{recursive:true,force:true}));
 const metadata=path.join(folder,'.storyboard-workbench/storyboard.project.json');
 const png=path.join(folder,'.storyboard-workbench/layers/s/paint.png'),tiff=path.join(folder,'a.tiff'),script=path.join(folder,'storyboard-script.md');
 await fs.mkdir(path.dirname(png),{recursive:true,mode:0o700});
 const original=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer();
 const desired=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();
 await fs.writeFile(png,original,{mode:0o400});await fs.writeFile(tiff,await sharp(original).tiff().toBuffer(),{mode:0o400});
 const project:any={id:'p',name:label,shots:[{id:'s',imagePath:tiff,fileName:'a.tiff',order:0,swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'paint',kind:'paint',width:2,height:2,bitmapPath:path.relative(folder,png)}]}],dialogues:[]};
 await fs.writeFile(metadata,JSON.stringify(project),{mode:0o400});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project),{mode:0o400});
 const content:any={projectRaw:project,desiredAssets:[{folderPath:folder,bitmapPath:path.relative(folder,png),shotId:'s',layerId:'paint',dataUrl:'data:image/png;base64,'+desired.toString('base64')}],sequence:7,assetRevision:3,effectFacts:{receipt:[],deletions:[],remainingScript:null}};
 const payload={folderPath:folder,metadataPath:metadata,normalSave:true,project,recoveryContent:content};
 const capture:any={folderPath:folder,content,canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'unsynced',workspaceSaveState:'error'};
 const files=[metadata,script,png,tiff],before=await Promise.all(files.map(f=>fs.readFile(f)));
 const attempt=async(service:ReturnType<typeof createPreparedWorkspaceSave>,event:any)=>{
  let effects=0;const result=await service.runIpc(event,payload,async()=>{effects++;await fs.writeFile(script,'real blocked MD write');return {project,normalSaveOutputs:[]};});
  expect(effects).toBe(1);expect(result.ok).toBe(false);expect(result.error.message).toMatch(/EACCES|permission denied/);
 };
 const intact=async()=>{for(let i=0;i<files.length;i++){expect(await fs.readFile(files[i])).toEqual(before[i]);expect((await fs.stat(files[i])).mode&0o777).toBe(0o400);}await expect(assertPhysicalWorkspaceWriterTargets([png])).rejects.toThrow('protected');};
 const namespace=()=>fs.readFile(path.join(folder,'.storyboard-workbench/workspace-recovery-v1/namespace.json'),'utf8');
 const inventory=async()=>{const entries:any[]=[];const visit=async(file:string)=>{const st=await fs.lstat(file);entries.push([path.relative(folder,file),st.ino,st.mode,st.ctimeMs,st.size,st.isFile()?(await fs.readFile(file)).toString('base64'):null]);if(st.isDirectory())for(const name of (await fs.readdir(file)).sort())await visit(path.join(file,name));};await visit(path.join(folder,'.storyboard-workbench/workspace-recovery-v1'));return entries;};
 return {folder,metadata,png,script,project,content,capture,desired,attempt,intact,namespace,inventory};
}
async function pair(){const A=await fixture('held-A'),B=await fixture('stage-B'),event=actor(),window={};let actualWindow:any=window;const service=createPreparedWorkspaceSave({...options,ownerFromSender:sender=>sender===event.sender?actualWindow:sender});await A.attempt(service,event);await B.attempt(service,event);return {A,B,event,service,set:{slots:[A.capture,B.capture]},changeWindow:()=>{actualWindow={};},restoreWindow:()=>{actualWindow=window;}};}

test('whole Close preserves real completed B terminal so fresh ordinary B remains editable; flags cannot substitute exact current bytes',async()=>{
 const A=await fixture('failed-A-clean-B'),B=await fixture('completed-B'),event=actor(),service=createPreparedWorkspaceSave(options);
 // Actual fresh normal-open rebase creates an own absent optional collection.
 // Its disk JSON omits it; this must not turn a healthy Save into g1 unknown.
 B.project.parkedShots=undefined;
 await A.attempt(service,event);
 for(const f of [B.metadata,B.script,B.png,B.project.shots[0].imagePath])await fs.chmod(f,0o600);
 const payload={folderPath:B.folder,metadataPath:B.metadata,normalSave:true,project:B.project,recoveryContent:B.content};
 const output=await service.run(event,payload,async()=>{await fs.writeFile(B.png,B.desired);return {project:B.project,normalSaveOutputs:[]};});
 await service.persist(event,{...payload,recoverySaveNonce:output.recoverySaveNonce},async()=>{
  await fs.writeFile(B.metadata,`${JSON.stringify(B.project,null,2)}\n`);await fs.writeFile(B.script,serializeStoryboardScriptMarkdown(B.project));return {};
 });
 expect(await service.acknowledge(event,{folderPath:B.folder,nonce:output.recoverySaveNonce,project:B.project})).toBe(true);
 const collection={slots:[A.capture,{...B.capture,workspaceSaveState:'saved'}]};
 expect(await service.certifyRetainedSet(event,collection)).toBe(true);
 const fresh=createPreparedWorkspaceSave(options),readonly=await fresh.readReadonly(B.folder);
 expect(readonly.continuationState).toMatchObject({stage:'completed',terminal:{schema:'swb.current-terminal.v1'}});
 await expect(assertPhysicalWorkspaceWriterTargets([B.png])).resolves.toBeUndefined();
 const other=actor();expect(await fresh.ordinary(other,'layers:writeBitmap',{},[B.png],async()=>{await fs.writeFile(B.png,B.desired);return {ok:true};})).toEqual({ok:true});
 // An unACKed ordinary effect must retain protection on another fresh process.
 createPreparedWorkspaceSave(options);await expect(assertPhysicalWorkspaceWriterTargets([B.png])).rejects.toThrow('protected');
 await A.intact();
},120000);

test('cold ordinary first metadata and paint ACK use immutable namespace policy after a new source capture',async()=>{
 const A=await fixture('cold-policy'),event=actor(),service=createPreparedWorkspaceSave(options);
 for(const f of [A.metadata,A.script,A.png,A.project.shots[0].imagePath])await fs.chmod(f,0o600);
 const payload={folderPath:A.folder,metadataPath:A.metadata,normalSave:true,project:A.project,recoveryContent:A.content};
 const save=async()=>{const output=await service.run(event,payload,async()=>({project:A.project,normalSaveOutputs:[]}));await service.persist(event,{...payload,recoverySaveNonce:output.recoverySaveNonce},async()=>{await fs.writeFile(A.metadata,`${JSON.stringify(A.project,null,2)}\n`);await fs.writeFile(A.script,serializeStoryboardScriptMarkdown(A.project));return {};});expect(await service.acknowledge(event,{folderPath:A.folder,nonce:output.recoverySaveNonce,project:A.project})).toBe(true);};
 await save();const namespace=await A.namespace();await save();expect(await A.namespace()).toBe(namespace);
 const cold=createPreparedWorkspaceSave(options),other=actor(),ro=await cold.readReadonly(A.folder),ns=JSON.parse(namespace);
 expect(ro.original.sourcePolicy).not.toEqual(ns.sourcePolicy);expect(ro.original.sourcePolicy.expected).toEqual(ns.sourcePolicy.expected);
 const edited={...A.project,name:'cold first edit'};
 const persist=async()=>cold.ordinary(other,'workspace:autosave',{...payload,project:edited},[A.metadata,A.script],async()=>{await fs.writeFile(A.metadata,`${JSON.stringify(edited,null,2)}\n`);await fs.writeFile(A.script,serializeStoryboardScriptMarkdown(edited));return {};});
 let persisted=await persist();expect(await cold.acknowledge(other,{folderPath:A.folder,nonce:persisted.ordinaryPersistenceNonce,project:edited})).toBe(true);
 await cold.ordinary(other,'layers:writeBitmap',{},[A.png],async()=>{await fs.writeFile(A.png,A.desired);return {ok:true};});persisted=await persist();expect(await cold.acknowledge(other,{folderPath:A.folder,nonce:persisted.ordinaryPersistenceNonce,project:edited})).toBe(true);
 expect(await A.namespace()).toBe(namespace);createPreparedWorkspaceSave(options);await expect(assertPhysicalWorkspaceWriterTargets([A.png])).resolves.toBeUndefined();
 // Equivalent observations may vary, but changed restrictions are never compatible.
 await fs.chmod(A.metadata,0o400);const changed=createPreparedWorkspaceSave(options);let effects=0;
 await expect(changed.ordinary(actor(),'workspace:autosave',{...payload,project:edited},[A.metadata,A.script],async()=>{effects++;return {};})).rejects.toThrow(/protected|restriction intersection changed/);expect(effects).toBe(0);
 createPreparedWorkspaceSave(options);await expect(assertPhysicalWorkspaceWriterTargets([A.png])).rejects.toThrow('protected');
},120000);

test('actual two failed Roots receive whole certification only after both native g2 readbacks',async()=>{
 const {A,B,event,service,set}=await pair();
 expect(await service.certifyRetainedSet(event,set)).toBe(true);
 const fresh=createPreparedWorkspaceSave(options);
 for(const f of [A,B]){const ro=await fresh.readReadonly(f.folder);expect(ro.revision).toMatch(/^close:/);expect(ro.projectRaw).toEqual(f.project);expect(ro.effectFacts).toMatchObject({owner:f.content.effectFacts});expect(ro.viewState).toMatchObject({selectedShotIds:['s'],dirtyShotIds:['s']});expect(ro.assets.some(a=>a.sourceDataUrl==='data:image/png;base64,'+f.desired.toString('base64'))).toBe(true);await f.intact();const ns=JSON.parse(await f.namespace());expect(ns.sourcePolicy.expected).toMatchObject({mode:256,flags:0});for(const [file,info] of ns.sourcePolicy.observed){expect(file.startsWith(f.folder+path.sep)).toBe(true);expect(info.kind).toBe('ordinary');expect(info.mode).toBe(256);expect(info.flags).toBe(0);expect(info.xattrs).toEqual(ns.sourcePolicy.expected.xattrs);}}
},120000);

test('omitted A, duplicate and alias/unknown Roots refuse before any Root namespace write; old single guard survives',async()=>{
 const {A,B,event,service,set}=await pair();const before=await Promise.all([A.inventory(),B.inventory()]);
 const alias=path.join(root,'alias-'+path.basename(A.folder));await fs.symlink(A.folder,alias);onTestFinished(()=>fs.unlink(alias));
 for(const bad of [{slots:[B.capture]},{slots:[A.capture,A.capture,B.capture]},{slots:[A.capture,{...A.capture,folderPath:alias},B.capture]},{slots:[...set.slots,{...B.capture,folderPath:B.folder+'-unknown'}]},{slots:[]},{...set,bypassSet:[A.folder,B.folder]}]){
  if('bypassSet' in bad){await expect(service.certifyRetained(event,{...B.capture,...bad})).rejects.toThrow('Hidden unfinished');continue;}
  await expect(service.certifyRetainedSet(event,bad)).rejects.toThrow();expect(await Promise.all([A.inventory(),B.inventory()])).toEqual(before);
 }
 const clean=await fixture('unprepared-clean-C');await expect(service.certifyRetainedSet(event,{slots:[...set.slots,clean.capture]})).rejects.toThrow('no Main-owned');expect(await Promise.all([A.inventory(),B.inventory()])).toEqual(before);await expect(fs.access(path.join(clean.folder,'.storyboard-workbench/workspace-recovery-v1'))).rejects.toMatchObject({code:'ENOENT'});
 await expect(service.certifyRetained(event,{...B.capture,...set})).rejects.toThrow('Hidden unfinished');await A.intact();await B.intact();
},120000);

test('all preflight authenticates frame/caller/window/document and metadata inode without early g2',async()=>{
 const {A,B,event,service,set,changeWindow,restoreWindow}=await pair();const before=await Promise.all([A.inventory(),B.inventory()]);
 for(const wrong of [{...event,senderFrame:{}},actor()]){await expect(service.certifyRetainedSet(wrong,set)).rejects.toThrow();expect(await Promise.all([A.inventory(),B.inventory()])).toEqual(before);}
 const moved=B.folder+'-old-inode';await fs.rename(B.folder,moved);await fs.mkdir(B.folder,{mode:0o700});await expect(service.certifyRetainedSet(event,set)).rejects.toThrow('binding mismatch');expect(await A.inventory()).toEqual(before[0]);await fs.rmdir(B.folder);await fs.rename(moved,B.folder);
 const old=path.join(B.folder,'.storyboard-workbench-old');await fs.rename(path.dirname(B.metadata),old);await fs.mkdir(path.dirname(B.metadata),{mode:0o700});await expect(service.certifyRetainedSet(event,set)).rejects.toThrow('binding mismatch');expect(await A.inventory()).toEqual(before[0]);await fs.rmdir(path.dirname(B.metadata));await fs.rename(old,path.dirname(B.metadata));
 changeWindow();await expect(service.certifyRetainedSet(event,set)).rejects.toThrow('binding mismatch');restoreWindow();service.invalidateDocument(event.sender);await expect(service.certifyRetainedSet(event,set)).rejects.toThrow('binding mismatch');expect(await Promise.all([A.inventory(),B.inventory()])).toEqual(before);
},120000);

test('other-window obligations are not borrowed or included in caller inventory',async()=>{
 const {A,B,event,service,set}=await pair();const C=await fixture('other-window'),other=actor();await C.attempt(service,other);const before=await C.namespace();expect(await service.certifyRetainedSet(event,set)).toBe(true);expect(await C.namespace()).toBe(before);await expect(service.certifyRetainedSet(event,{slots:[...set.slots,C.capture]})).rejects.toThrow('binding mismatch');await C.intact();
},120000);

test('a native g2 readback refusal gives no whole permit and never rolls back another Root or forgets old facts',async()=>{
 const {A,B,event,service,set}=await pair();
 // Inject only native readback transport failure; actual store/bytes/policies run.
 const helper=path.join(root,'readback-fail-'+randomUUID()+'.py');onTestFinished(()=>fs.unlink(helper));await fs.writeFile(helper,`import sys,json,subprocess,os\nr=json.load(sys.stdin)\npth=r.get('path','')\nif r.get('phase')=='readback' and r.get('root')==${JSON.stringify(B.folder)} and pth.endswith('/content.json') and os.path.isfile(pth) and json.load(open(pth)).get('revision','').startswith('close:'):\n print(json.dumps({'authorized':False,'reason':'injected native g2 readback'}));sys.exit(1)\np=subprocess.run([${JSON.stringify(options.python)},${JSON.stringify(options.script)}],input=json.dumps(r),text=True,capture_output=True);sys.stdout.write(p.stdout);sys.stderr.write(p.stderr);sys.exit(p.returncode)\n`);
 // Separate service needs its own real leases, so create a new fixture pair below.
 const D=await fixture('g2-A'),E=await fixture('g2-B'),ev=actor();
 const actualHelper=(await fs.readFile(helper,'utf8')).replace(B.folder,E.folder);await fs.writeFile(helper,actualHelper);
 const faulty=createPreparedWorkspaceSave({...options,script:helper});await D.attempt(faulty,ev);await E.attempt(faulty,ev);
 let permit=false;await expect((async()=>{permit=await faulty.certifyRetainedSet(ev,{slots:[D.capture,E.capture]});})()).rejects.toThrow('injected');expect(permit).toBe(false);
 expect((await createPreparedWorkspaceSave(options).readReadonly(D.folder)).revision).toMatch(/^close:/);await D.intact();await E.intact();await expect(faulty.certifyRetained(ev,E.capture)).rejects.toThrow('Hidden unfinished');
},120000);

test('executing source work cannot be snapshotted as ACK; shared queue waits real settlement and reentrant calls refuse',async()=>{
 const A=await fixture('executing-A'),event=actor(),service=createPreparedWorkspaceSave(options);
 let enter!:()=>void,release!:()=>void;const entered=new Promise<void>(r=>enter=r),gate=new Promise<void>(r=>release=r);let reentrantRefused=false;
 const save=service.runIpc(event,{folderPath:A.folder,metadataPath:A.metadata,normalSave:true,project:A.project,recoveryContent:A.content},async()=>{
  await expect(service.certifyRetainedSet(event,{slots:[A.capture]})).rejects.toThrow('settled');reentrantRefused=true;enter();await gate;await fs.writeFile(A.script,'blocked actual MD write');return {};
 });
 await entered;let settled=false;const certification=service.certifyRetainedSet(event,{slots:[A.capture]}).then(v=>{settled=true;return v;});await Promise.resolve();expect(settled).toBe(false);release();expect((await save).ok).toBe(false);expect(reentrantRefused).toBe(true);expect(await certification).toBe(true);await A.intact();
},120000);

test('private ordinary pending/failed obligations cannot be omitted or washed by renderer saved flags',async()=>{
 const A=await fixture('ordinary-A'),B=await fixture('failed-B'),event=actor(),service=createPreparedWorkspaceSave(options);
 for(const file of [A.metadata,A.script,A.png,A.project.shots[0].imagePath])await fs.chmod(file,0o600);
 const payload={folderPath:A.folder,metadataPath:A.metadata,normalSave:true,project:A.project,recoveryContent:A.content};
 const output=await service.run(event,payload,async()=>({project:A.project,normalSaveOutputs:[]}));
 await service.persist(event,{...payload,recoverySaveNonce:output.recoverySaveNonce},async()=>{await fs.writeFile(A.metadata,`${JSON.stringify(A.project,null,2)}\n`);await fs.writeFile(A.script,serializeStoryboardScriptMarkdown(A.project));return {};});
 expect(await service.acknowledge(event,{folderPath:A.folder,nonce:output.recoverySaveNonce,project:A.project})).toBe(true);
 await service.ordinary(event,'layers:writeBitmap',{},[A.png],async()=>{await fs.writeFile(A.png,A.desired);return {ok:true};});
 await B.attempt(service,event);const before=await Promise.all([A.inventory(),B.inventory()]);
 await expect(service.certifyRetainedSet(event,{slots:[B.capture],saved:true})).rejects.toThrow('omitted');
 await expect(service.certifyRetainedSet(event,{slots:[B.capture,{...A.capture,saved:true}]})).rejects.toThrow('ACK');expect(await Promise.all([A.inventory(),B.inventory()])).toEqual(before);
 await expect(service.ordinary(event,'layers:writeBitmap',{},[A.png],async()=>fs.writeFile(path.dirname(A.png),'cannot write directory'))).rejects.toThrow();
 await expect(service.certifyRetainedSet(event,{slots:[B.capture,A.capture]})).rejects.toThrow('Ordinary failed');expect(await Promise.all([A.inventory(),B.inventory()])).toEqual(before);
 await expect(service.certifyRetained(event,B.capture)).rejects.toThrow('Hidden unfinished');
},120000);

test('unprepared parked/deleted asset inventory in any slot refuses before the first Root g2',async()=>{
 const {A,B,event,service,set}=await pair();const before=await Promise.all([A.inventory(),B.inventory()]);
 const forged=structuredClone(B.capture);forged.content.projectRaw.parkedShots=[{...forged.content.projectRaw.shots[0],id:'new-unprepared'}];
 await expect(service.certifyRetainedSet(event,{slots:[A.capture,forged]})).rejects.toThrow('inventory');expect(await Promise.all([A.inventory(),B.inventory()])).toEqual(before);
},120000);

test('whole barrier requests a second exact collection and does not authorize a changed slot',async()=>{
 const {A,B,event,service,set}=await pair();let destroyed=0;const sent:any[]=[],cancelled:string[]=[];const win:any={destroy:()=>destroyed++,webContents:event.sender};event.sender.send=(...args:any[])=>sent.push(args);
 const barrier=createRecoveryCloseBarrier({requestId:()=> 'whole',showMessageBox:async()=>({response:0}),cancelled:(_w,reason)=>cancelled.push(reason),certifyRetainedSet:service.certifyRetainedSet});
 barrier.begin(win);const result={requestId:'whole',captureAvailable:true,recoveryRequired:true,busy:false,hasUnsavedChanges:true,capture:set};await barrier.finishCapture(event,result);expect(sent).toHaveLength(2);expect(destroyed).toBe(0);
 await barrier.finishCapture(event,{...result,capture:{slots:[A.capture,{...B.capture,selectedShotIds:[]}]}});expect(destroyed).toBe(0);expect(cancelled).toHaveLength(1);
 barrier.begin(win);await barrier.finishCapture(event,result);await barrier.finishCapture(event,result);expect(destroyed).toBe(1);await A.intact();await B.intact();
},120000);
