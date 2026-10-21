import {test,expect,onTestFinished,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import sharp from 'sharp';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {createWorkspacePhysicalWriterGate,assertPhysicalWorkspaceWriterTargets} from './workspacePhysicalWriterGate';
import {serializeStoryboardScriptMarkdown} from './storyboardScript';
import {withLayerFileOperation} from './layerFileOperationQueue';
import {scanRecoveryWorkspace} from './recoveryWorkspaceAccounting';
import {createLayerAppHandlers} from './layerAppRuntime';
import {registerLayerIpcHandlers} from './ipc/layerHandlers';
test.each(['parked', 'pending-deleted', 'empty'])('finite %s Save preserves complete dependency input before the original effect', async kind => {
 const f=await fixture();
 const p:any=structuredClone(f.project);
 if(kind==='parked') { await fs.mkdir(path.join(f.root,'Pending'),{mode:0o700}); const moved=path.join(f.root,'Pending/a.tiff');await fs.rename(p.shots[0].imagePath,moved);p.shots[0].imagePath=moved;p.parkedShots=p.shots;p.shots=[]; }
 if(kind==='pending-deleted'){p.pendingDeletedShots=p.shots.map(({id,imagePath,fileName}:any)=>({id,imagePath,fileName}));p.shots=[];}
 if(kind==='empty'){p.shots=[];}
 await fs.writeFile(f.metadata,JSON.stringify(p));const payload={...f.payload,project:p,recoveryContent:{...f.payload.recoveryContent,projectRaw:p,deletedDependencies:kind==='pending-deleted'?f.project.shots:[]}};
 const service=createPreparedWorkspaceSave(f.options);let called=false;
 await expect(service.run(f.event,payload,async()=>{called=true;const retained=await service.readReadonly(f.root);expect(retained.projectRaw).toEqual(p);expect(retained.assets).toHaveLength(kind==='empty'?0:3);throw new Error('Original effect test boundary (no Trash authorization)');})).rejects.toThrow('Original effect test boundary');
 expect(called).toBe(true);await expect(assertPhysicalWorkspaceWriterTargets([f.metadata])).rejects.toThrow('protected');
},30000);
test('ordinary metadata ACK refreshes terminal; a producer fault revokes both live and cold retirement for other callers', async()=>{
 const f=await fixture(),service=createPreparedWorkspaceSave(f.options);
 const write=async(p:any)=>{await fs.writeFile(f.metadata,`${JSON.stringify(p,null,2)}\n`);await fs.writeFile(path.join(f.root,'storyboard-script.md'),serializeStoryboardScriptMarkdown(p));return {project:p};};
 const result=await service.run(f.event,f.payload,async()=>({project:f.project,normalSaveOutputs:[]}));
 await service.persist(f.event,{...f.payload,recoverySaveNonce:result.recoverySaveNonce},()=>write(f.project));await service.acknowledge(f.event,{folderPath:f.root,nonce:result.recoverySaveNonce,project:f.project});
 const p={...f.project,name:'ordinary P2',parkedShots:undefined};
 const persisted=await (service as any).ordinary(f.event,'workspace:autosave',{...f.payload,project:p},[f.root,f.metadata],()=>write(p));
 expect(persisted.ordinaryPersistenceNonce).toBeTypeOf('string');expect(persisted.ordinaryPersistenceNonce).not.toBe(result.recoverySaveNonce);
 await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).rejects.toThrow('protected');
 await service.acknowledge(f.event,{folderPath:f.root,nonce:persisted.ordinaryPersistenceNonce,project:p});
 createPreparedWorkspaceSave(f.options);await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).resolves.toBeUndefined();
 const frame={},other={sender:{mainFrame:frame},senderFrame:frame} as any;
 await expect((service as any).ordinary(f.event,'layers:writePng',{folderPath:f.root,bitmapPath:path.relative(f.root,f.paint)},[f.paint],async()=>{throw new Error('Actual native effect boundary fault');})).rejects.toThrow('Actual native effect boundary fault');
 await expect((service as any).ordinary(other,'layers:writePng',{folderPath:f.root},[f.paint],async()=>{throw Error('must not reach effect');})).rejects.toThrow();
 createPreparedWorkspaceSave(f.options);await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).rejects.toThrow('protected');
},60000);
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'main-path-'));onTestFinished(()=>fs.rm(root,{recursive:true,force:true}));
 const metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),png=path.join(root,'.storyboard-workbench/layers/s/l.png'),paint=path.join(root,'.storyboard-workbench/layers/s/paint.png'),tiff=path.join(root,'a.tiff');await fs.mkdir(path.dirname(png),{recursive:true,mode:0o700});
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer();for(const f of [png,paint])await fs.writeFile(f,bytes,{mode:0o600});await fs.writeFile(tiff,await sharp(bytes).tiff().toBuffer(),{mode:0o600});
 const project={id:'p',name:'p',shots:[{id:'s',imagePath:tiff,fileName:'a.tiff',order:0,swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'l',kind:'image',width:2,height:2,bitmapPath:path.relative(root,png)},{id:'paint',kind:'paint',width:2,height:2,bitmapPath:path.relative(root,paint)}]}],dialogues:[]};await fs.writeFile(metadata,JSON.stringify(project),{mode:0o600});
 const frame={},sender={mainFrame:frame},event={sender,senderFrame:frame} as any;
 const payload={folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,desiredAssets:[],sequence:1,assetRevision:0,effectFacts:{receipt:[],deletions:[],remainingScript:null}}};
 const options={budget:{bytes:2097152,records:300,assets:32,jsonDepth:40},python:'python3',script:path.join(process.cwd(),'scripts/recovery-content-permissions.py')};return {root,metadata,paint,project,event,payload,options};
}
test('numeric watcher teardown is read-only, genuine writes stay protected',async()=>{
 const handlers=new Map<string,Function>();const gate=createWorkspacePhysicalWriterGate({handle:(c:string,h:Function)=>handlers.set(c,h)} as any);let received:any;
 gate.handle('workspace:stopFolderWatch',async(_e:any,id:any)=>{received=id;return true;});
 expect(await handlers.get('workspace:stopFolderWatch')!({},17)).toBe(true);expect(received).toBe(17);
 gate.handle('layers:writePng',async()=>{throw new Error('effect reached');});await expect(handlers.get('layers:writePng')!({},17)).rejects.toThrow('current top frame');
});
test('all bitmap layers prepare, exact completion retires live root, fresh current terminal permits normal writers and recaptures with new nonce',async()=>{
 const f=await fixture(),service=createPreparedWorkspaceSave(f.options);let effects=0;
 const save=async()=>{effects++;return {project:f.project,normalSaveOutputs:[]};};
 const result=await service.run(f.event,f.payload,save);expect(effects).toBe(1);
 await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).rejects.toThrow('protected');
 await service.persist(f.event,{...f.payload,recoverySaveNonce:result.recoverySaveNonce},async()=>{await fs.writeFile(f.metadata,`${JSON.stringify(f.project,null,2)}\n`);await fs.writeFile(path.join(f.root,'storyboard-script.md'),serializeStoryboardScriptMarkdown(f.project));return {};});
 await service.acknowledge(f.event,{folderPath:f.root,nonce:result.recoverySaveNonce,project:f.project});
 await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).resolves.toBeUndefined();
 const fresh=createPreparedWorkspaceSave(f.options);await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).resolves.toBeUndefined();
 const frame={},event={sender:{mainFrame:frame},senderFrame:frame} as any;
 const next=await fresh.run(event,f.payload,save);expect(next.recoverySaveNonce).not.toBe(result.recoverySaveNonce);expect(effects).toBe(2);
 await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).rejects.toThrow('protected');
},30000);
test.each(['sender','frame','window','document','metadata','Root'] as const)('namespace-publication failure cannot be continued by changed Main %s',async mode=>{
 const f=await fixture();let window:object={};
 const service=createPreparedWorkspaceSave({...f.options,ownerFromSender:()=>window}),link=fs.link.bind(fs);let fired=false;
 const spy=vi.spyOn(fs,'link').mockImplementation(async(from,to)=>{if(!fired&&String(to).endsWith('/workspace-recovery-v1/namespace.json')){fired=true;throw Object.assign(new Error('namespace publication EIO'),{code:'EIO'});}return link(from,to);});
 onTestFinished(()=>spy.mockRestore());
 await service.runIpc(f.event,f.payload,async()=>{throw Error('must not execute original Save');});spy.mockRestore();expect(fired).toBe(true);
 let event=f.event;
 if(mode==='sender'){const frame={};event={sender:{mainFrame:frame},senderFrame:frame} as any;}
 if(mode==='frame'){const frame={};f.event.sender.mainFrame=frame;event={sender:f.event.sender,senderFrame:frame} as any;}
 if(mode==='window')window={};
 if(mode==='document')service.invalidateDocument(f.event.sender);
 if(mode==='metadata'){await fs.rename(path.join(f.root,'.storyboard-workbench'),path.join(f.root,'original-metadata'));await fs.mkdir(path.join(f.root,'.storyboard-workbench'),{mode:0o700});}
 if(mode==='Root'){await fs.rename(f.root,f.root+'-original');await fs.mkdir(path.join(f.root,'.storyboard-workbench'),{recursive:true,mode:0o700});}
 await expect(service.certifyRetained(event,{folderPath:f.root,content:f.payload.recoveryContent,canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:[],dirtyShotIds:['s'],fileNameSyncState:'unsynced',workspaceSaveState:'error'})).rejects.toThrow();
 await expect(fs.lstat(path.join(f.root,'.storyboard-workbench/workspace-recovery-v1/namespace.json'))).rejects.toMatchObject({code:'ENOENT'});
 const original=mode==='Root'?f.root+'-original':f.root;
 const base=path.join(original,mode==='metadata'?'original-metadata':'.storyboard-workbench','workspace-recovery-v1');
 expect((await fs.readdir(base)).some(name=>name.startsWith('namespace.json.staging-'))).toBe(true);
},30000);

test('a protected existing Root preserves a later failed ordinary producer for normal Close without a second Save',async()=>{
 const f=await fixture(),service=createPreparedWorkspaceSave(f.options);
 const observation=await service.observeWorkspace(f.event,f.root);
 const output=await service.run(f.event,f.payload,async()=>({project:f.project,normalSaveOutputs:[]}));
 await service.persist(f.event,{...f.payload,recoverySaveNonce:output.recoverySaveNonce},async()=>{await fs.writeFile(f.metadata,`${JSON.stringify(f.project,null,2)}\n`);await fs.writeFile(path.join(f.root,'storyboard-script.md'),serializeStoryboardScriptMarkdown(f.project));return {};});
 await service.acknowledge(f.event,{folderPath:f.root,nonce:output.recoverySaveNonce,project:f.project});
 const before=await fs.readFile(f.paint);
 // Exact settled-before-write failure at the real Main ordinary producer seam.
 // This is not a native write refusal, real TIFF encoder or actual GUI Close.
 await expect(service.ordinary(f.event,'layers:writePng',{folderPath:f.root,bitmapPath:path.relative(f.root,f.paint)},[f.paint],async()=>{throw new Error('settled ordinary effect failed before write');})).rejects.toThrow('settled ordinary effect failed before write');
 const capture={...observation,content:{...f.payload.recoveryContent,retainedAssetIntents:[],effectFacts:{unsettled:true,error:'settled ordinary effect failed before write',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},history:{undo:[],redo:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error'};
 expect(await service.certifyRetainedSet(f.event,{activeBinding:observation.binding,slots:[capture]})).toBe(true);
 const cold=await createPreparedWorkspaceSave(f.options).readReadonly(f.root);
 expect(cold.projectRaw).toEqual(f.project);expect((cold.viewState as any).history).toEqual(capture.history);
 expect(cold.continuationState).toMatchObject({notExecutable:true});
 expect(JSON.stringify(cold.effectFacts)).toContain('settled ordinary effect failed before write');
 expect(await fs.readFile(f.paint)).toEqual(before);
 await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).rejects.toThrow('protected');
},30000);

test('registered production writePng parsing failure reaches original failed ordinary preservation without starting a layer operation',async()=>{
 const f=await fixture(),service=createPreparedWorkspaceSave(f.options),observation=await service.observeWorkspace(f.event,f.root);
 const output=await service.run(f.event,f.payload,async()=>({project:f.project,normalSaveOutputs:[]}));
 await service.persist(f.event,{...f.payload,recoverySaveNonce:output.recoverySaveNonce},async()=>{await fs.writeFile(f.metadata,`${JSON.stringify(f.project,null,2)}\n`);await fs.writeFile(path.join(f.root,'storyboard-script.md'),serializeStoryboardScriptMarkdown(f.project));return {};});
 await service.acknowledge(f.event,{folderPath:f.root,nonce:output.recoverySaveNonce,project:f.project});
 const handlers=new Map<string,Function>(),gate=createWorkspacePhysicalWriterGate({handle:(channel:string,handler:Function)=>handlers.set(channel,handler)} as any,{ordinary:service.ordinary});
 registerLayerIpcHandlers(gate,createLayerAppHandlers());
 const original=await fs.readFile(f.paint);
 await expect(handlers.get('layers:writePng')!(f.event,{folderPath:f.root,bitmapPath:path.relative(f.root,f.paint),dataUrl:'invalid data URL'})).rejects.toThrow('Layer asset must be a PNG data URL');
 const capture={...observation,content:{...f.payload.recoveryContent,retainedAssetIntents:[],effectFacts:{unsettled:true,error:'Layer asset must be a PNG data URL',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},history:{undo:[],redo:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error'};
 expect(await service.certifyRetainedSet(f.event,{slots:[capture]})).toBe(true);
 const cold=await createPreparedWorkspaceSave(f.options).readReadonly(f.root);
 expect(cold.continuationState).toMatchObject({stage:'failed-ordinary',notExecutable:true});
 expect(JSON.stringify(cold.effectFacts)).toContain('Layer asset must be a PNG data URL');
 expect(await fs.readFile(f.paint)).toEqual(original);
 await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).rejects.toThrow('protected');
},30000);

test('registered production PNG commit followed by parsing failure cannot borrow zero-effect preservation',async()=>{
 const f=await fixture(),service=createPreparedWorkspaceSave(f.options),observation=await service.observeWorkspace(f.event,f.root);
 const output=await service.run(f.event,f.payload,async()=>({project:f.project,normalSaveOutputs:[]}));
 await service.persist(f.event,{...f.payload,recoverySaveNonce:output.recoverySaveNonce},async()=>{await fs.writeFile(f.metadata,`${JSON.stringify(f.project,null,2)}\n`);await fs.writeFile(path.join(f.root,'storyboard-script.md'),serializeStoryboardScriptMarkdown(f.project));return {};});
 await service.acknowledge(f.event,{folderPath:f.root,nonce:output.recoverySaveNonce,project:f.project});
 const handlers=new Map<string,Function>(),gate=createWorkspacePhysicalWriterGate({handle:(channel:string,handler:Function)=>handlers.set(channel,handler)} as any,{ordinary:service.ordinary});
 registerLayerIpcHandlers(gate,createLayerAppHandlers());
 const invoke=handlers.get('layers:writePng')!,original=await fs.readFile(f.paint),payload={folderPath:f.root,bitmapPath:path.relative(f.root,f.paint)};
 const written=await invoke(f.event,{...payload,dataUrl:`data:image/png;base64,${original.toString('base64')}`});
 expect(written.filePath).toBe(f.paint);
 await expect(invoke(f.event,{...payload,dataUrl:'invalid data URL'})).rejects.toThrow('Layer asset must be a PNG data URL');
 const capture={...observation,content:{...f.payload.recoveryContent,retainedAssetIntents:[],effectFacts:{unsettled:true,error:'Layer asset must be a PNG data URL',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},history:{undo:[],redo:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error'},before=await scanRecoveryWorkspace(f.root,f.options.budget);
 await expect(service.certifyRetainedSet(f.event,{slots:[capture]})).rejects.toThrow('Ordinary failed producer exact no-effect settlement unavailable');
 expect(await scanRecoveryWorkspace(f.root,f.options.budget)).toEqual(before);
 expect(await fs.readFile(f.paint)).toEqual(original);
 await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).rejects.toThrow('protected');
},30000);

test.each(['bytes','identity','restrictions','document','missing History','started sibling'] as const)('failed ordinary inert Close refuses %s without another sidecar effect',async mode=>{
 const f=await fixture(),service=createPreparedWorkspaceSave(f.options),observation=await service.observeWorkspace(f.event,f.root);
 const output=await service.run(f.event,f.payload,async()=>({project:f.project,normalSaveOutputs:[]}));
 await service.persist(f.event,{...f.payload,recoverySaveNonce:output.recoverySaveNonce},async()=>{await fs.writeFile(f.metadata,`${JSON.stringify(f.project,null,2)}\n`);await fs.writeFile(path.join(f.root,'storyboard-script.md'),serializeStoryboardScriptMarkdown(f.project));return {};});
 await service.acknowledge(f.event,{folderPath:f.root,nonce:output.recoverySaveNonce,project:f.project});
 let release!:()=>void,entered!:()=>void;
 const held=new Promise<void>(r=>release=r),started=new Promise<void>(r=>entered=r);let sibling:Promise<unknown>|undefined;
 const failed=service.ordinary(f.event,'layers:writePng',{folderPath:f.root},[f.paint],async()=>{
  if(mode==='started sibling')sibling=withLayerFileOperation(async()=>{entered();await held;});
  throw new Error('exact original ordinary failure');
 }).catch(error=>error);
 if(mode==='started sibling'){
  await started;let settled=false;void failed.then(()=>{settled=true;});
  try{await new Promise(r=>setImmediate(r));expect(settled).toBe(false);}finally{release();await sibling;}
 }
 expect(String(await failed)).toContain('exact original ordinary failure');
 if(mode==='bytes')await fs.writeFile(f.paint,Buffer.from('different actual source'));
 if(mode==='identity'){const b=await fs.readFile(f.paint);await fs.rename(f.paint,f.paint+'.original');await fs.writeFile(f.paint,b,{mode:0o600});}
 if(mode==='restrictions')await fs.chmod(f.paint,0o400);
 if(mode==='document')service.invalidateDocument(f.event.sender);
 const capture={...observation,content:{...f.payload.recoveryContent,retainedAssetIntents:[],effectFacts:{unsettled:false,receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},...(mode==='missing History'?{}:{history:{undo:[],redo:[]}}),selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error'};
 const before=await scanRecoveryWorkspace(f.root,f.options.budget);
 await expect(service.certifyRetainedSet(f.event,{slots:[capture]})).rejects.toThrow();
 expect((await scanRecoveryWorkspace(f.root,f.options.budget)).fingerprint).toBe(before.fingerprint);
},30000);

test('original Main lease preserves content after namespace publication failure without admitting a fresh preparation',async()=>{
 const f=await fixture(),service=createPreparedWorkspaceSave(f.options),link=fs.link.bind(fs);let fired=false,effects=0;
 const before=await Promise.all([f.metadata,f.paint,f.project.shots[0].imagePath].map(file=>fs.readFile(file)));
 const spy=vi.spyOn(fs,'link').mockImplementation(async(from,to)=>{if(!fired&&String(to).endsWith('/workspace-recovery-v1/namespace.json')){fired=true;throw Object.assign(new Error('namespace publication EIO'),{code:'EIO'});}return link(from,to);});
 onTestFinished(()=>spy.mockRestore());
 const result=await service.runIpc(f.event,f.payload,async()=>{effects++;return {};});spy.mockRestore();
 expect(fired).toBe(true);expect(effects).toBe(0);expect(result.error.sourceEffects).toBe(0);
 await expect(fs.lstat(path.join(f.root,'.storyboard-workbench/workspace-recovery-v1/namespace.json'))).rejects.toMatchObject({code:'ENOENT'});
 expect(await service.certifyRetained(f.event,{folderPath:f.root,content:f.payload.recoveryContent,canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:[],dirtyShotIds:['s'],fileNameSyncState:'unsynced',workspaceSaveState:'error'})).toBe(true);
 const recovery=await createPreparedWorkspaceSave(f.options).readReadonly(f.root);
 expect(recovery.state).toBe('protectedIncomplete');expect(recovery.projectRaw).toEqual(f.project);expect(recovery.assets).toHaveLength(3);
 expect(await Promise.all([f.metadata,f.paint,f.project.shots[0].imagePath].map(file=>fs.readFile(file)))).toEqual(before);
 await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).rejects.toThrow('protected');
},30000);

test('production preparation partial owns live content before sidecar effect and certifies latest close without retiring unknown inventory',async()=>{
 const f=await fixture(),service=createPreparedWorkspaceSave(f.options),link=fs.link.bind(fs);let fired=false,effects=0;
 const spy=vi.spyOn(fs,'link').mockImplementation(async(from,to)=>{if(!fired&&String(from).includes('/assets/')){fired=true;throw Object.assign(new Error('actual sidecar publication EIO'),{code:'EIO'});}return link(from,to);});
 onTestFinished(()=>spy.mockRestore());
 const result=await service.runIpc(f.event,f.payload,async()=>{effects++;return {};});spy.mockRestore();
 expect(fired).toBe(true);expect(effects).toBe(0);expect(result.error.sourceEffects).toBe(0);expect(result.error.sidecarEffects.sidecarEffects).toBe('partial-or-unknown');
 expect(await service.certifyRetained(f.event,{folderPath:f.root,content:f.payload.recoveryContent,canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:[],dirtyShotIds:['s'],fileNameSyncState:'unsynced',workspaceSaveState:'error'})).toBe(true);
 const fresh=createPreparedWorkspaceSave(f.options),recovery=await fresh.readReadonly(f.root);expect(recovery.state).toBe('protectedIncomplete');expect(recovery.projectRaw).toEqual(f.project);expect(recovery.assets).toHaveLength(3);
 expect(recovery).toMatchObject({viewState:{canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:[],dirtyShotIds:['s'],fileNameSyncState:'unsynced',workspaceSaveState:'error'},continuationState:{stage:'failed',notExecutable:true}});
 await expect(assertPhysicalWorkspaceWriterTargets([f.paint])).rejects.toThrow('protected');
},30000);
