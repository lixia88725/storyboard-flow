import {test,expect,onTestFinished,vi} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import sharp from 'sharp';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {createWorkspacePhysicalWriterGate,assertPhysicalWorkspaceWriterTargets} from './workspacePhysicalWriterGate';
import {serializeStoryboardScriptMarkdown} from './storyboardScript';
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
 const options={budget:{bytes:2097152,records:300,assets:32,jsonDepth:40},python:'/opt/homebrew/bin/python3.12',script:path.join(process.cwd(),'scripts/recovery-content-permissions.py')};return {root,metadata,paint,project,event,payload,options};
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
