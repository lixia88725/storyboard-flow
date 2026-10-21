import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorkspacePhysicalWriterGate } from './workspacePhysicalWriterGate';
import { registerLayerIpcHandlers } from './ipc/layerHandlers';
import { registerWorkspacePersistenceIpcHandlers } from './ipc/workspacePersistenceHandlers';
import { registerWorkspacePendingIpcHandlers } from './ipc/workspacePendingHandlers';
import { registerImageIpcHandlers } from './ipc/imageHandlers';
const fixture = async () => { const root=await fs.mkdtemp(path.resolve('gate-fixture-')); await fs.mkdir(path.join(root,'.storyboard-workbench/workspace-recovery-v1'),{recursive:true,mode:0o700}); return root; };
const setup = () => { const handlers=new Map<string,Function>(); const ipc=createWorkspacePhysicalWriterGate({handle:(channel,handler)=>{handlers.set(channel,handler);}} as any); const frame={};const sender={mainFrame:frame}; return {ipc,handlers,event:{sender,senderFrame:frame}}; };
test('real layer, persistence, pending and blank handlers reject before their first effect despite false or omitted normalSave',async()=>{
 const root=await fixture(); const {ipc,handlers,event}=setup();let effects=0;const effect=()=>{effects++;};
 registerLayerIpcHandlers(ipc,{cleanupMergeSources:effect,createPng:effect,writePng:effect,readPng:()=> 'readable',deletePng:effect,copyPng:effect,mergeDown:effect,mergeVisible:effect});
 registerWorkspacePersistenceIpcHandlers(ipc,{ensureProjectLayerAssets:effect,writeProjectFiles:effect});
 registerWorkspacePendingIpcHandlers(ipc,{moveShotsToPending:effect,restoreShotsFromPending:effect});
 registerImageIpcHandlers(ipc,{createBlankShot:effect});
 for(const [channel,handler] of handlers){ if(channel==='layers:readPng')continue;
  for(const normalSave of [false,undefined]){
   const payload=channel==='images:createBlankShot'?root:{folderPath:root,metadataPath:path.join(root,'.storyboard-workbench/storyboard.project.json'),project:{},normalSave};
   let refused=false;try{await handler(event,payload,[]);}catch{refused=true;}
   expect(refused,channel).toBe(true);expect(effects,channel).toBe(0);
  }
 }
 expect(await handlers.get('layers:readPng')!(event,{folderPath:root})).toBe('readable');
});
test('physical alias and external metadata inside protected A cannot hide behind clean B',async()=>{
 const root=await fixture();const b=await fs.mkdtemp(path.resolve('gate-clean-'));const alias=root+'-alias';await fs.symlink(root,alias);
 const {ipc,handlers,event}=setup();let effects=0;ipc.handle('workspace:autosave',async()=>{effects++;});
 for(const payload of [{folderPath:alias},{folderPath:b,metadataPath:path.join(root,'.storyboard-workbench/storyboard.project.json')}])await expect(handlers.get('workspace:autosave')!(event,payload)).rejects.toThrow('protected');
 expect(effects).toBe(0);await handlers.get('workspace:autosave')!(event,{folderPath:b});expect(effects).toBe(1);
});
test('a subframe has no physical writer authority, even with a clean destination',async()=>{
 const root=await fs.mkdtemp(path.resolve('gate-clean-'));const {ipc,handlers,event}=setup();let effects=0;ipc.handle('layers:writePng',async()=>{effects++;});
 await expect(handlers.get('layers:writePng')!({...event,senderFrame:{}},{folderPath:root})).rejects.toThrow();expect(effects).toBe(0);
});

test('a v2-only partial inventory blocks original writers before any effect', async () => {
 const root = await fs.mkdtemp(path.resolve('gate-v2-partial-'));
 await fs.mkdir(path.join(root, '.storyboard-workbench/workspace-recovery-v2'), { recursive: true, mode: 0o700 });
 const { ipc, handlers, event } = setup(); let effects = 0;
 ipc.handle('layers:writePng', async () => { effects++; });
 await expect(handlers.get('layers:writePng')!(event, { folderPath: root })).rejects.toThrow('protected');
 expect(effects).toBe(0);
});
