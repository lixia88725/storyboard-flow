import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';

const fixture=async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'pressure-contract-root-')),rel='.storyboard-workbench/layers/s/a.png',file=path.join(root,rel),metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),script=path.join(root,'storyboard-script.md'),tiff=path.join(root,'s.tiff');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const png=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();await fs.writeFile(file,png,{mode:0o600});await fs.writeFile(tiff,await sharp(png).tiff().toBuffer(),{mode:0o600});
  const project={id:'p',name:'Pressure contract',shots:[{id:'s',imagePath:tiff,fileName:'s.tiff',swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'a',kind:'paint',bitmapPath:rel,width:2,height:2}]}],dialogues:[]};
  await fs.writeFile(metadata,JSON.stringify(project,null,2)+'\n',{mode:0o600});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project as any),{mode:0o600});
  const files=[metadata,script,tiff,file],originals=await Promise.all(files.map(f=>fs.readFile(f))),frame={},event:any={sender:{mainFrame:frame},senderFrame:frame};
  const payload={folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  const service=(cutoff:number)=>createPreparedWorkspaceSave({python:'python3',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80},memoryBudgetBytes:16*1024*1024,memoryPressure:{rssBytes:cutoff,externalBytes:cutoff,heapBytes:cutoff,minimumFreeBytes:0,operationHeadroomBytes:0}});
  return {root,event,payload,project,files,originals,service};
};

test('Save IPC wraps pressure refusal in its existing no-source-effects failure result',async()=>{
  const f=await fixture(),service=f.service(1);let writes=0;
  await expect(Promise.resolve().then(()=>service.runIpc(f.event,f.payload,async()=>{writes++;return {project:f.project,normalSaveOutputs:[]};}))).resolves.toMatchObject({ok:false,error:{code:'SAVE_RECOVERY_INCOMPLETE',sourceEffects:0,publicationOrCleanup:'not-started',metadata:'not-started',message:expect.stringContaining('RAM_ADMISSION')}});
  expect(writes).toBe(0);expect(await Promise.all(f.files.map(file=>fs.readFile(file)))).toEqual(f.originals);
},120000);

test('document revocation still invalidates a real live Save capability while pressure is high',async()=>{
  const f=await fixture(),service=f.service(1024*1024*1024);
  const saved=await service.run(f.event,f.payload,async()=>({project:f.project,normalSaveOutputs:[]}));
  // Only the pressure observation is synthetic; lease, Native authority and
  // stale-document rejection use the real production implementation.
  const usage=process.memoryUsage(),sensor=vi.spyOn(process,'memoryUsage').mockReturnValue({...usage,rss:2*1024*1024*1024});let failure:unknown;
  try{service.invalidateDocument(f.event.sender);}catch(error){failure=error;}finally{sensor.mockRestore();}
  expect(failure).toBeUndefined();let writes=0;
  await expect(service.persist(f.event,{...f.payload,recoverySaveNonce:saved.recoverySaveNonce},async()=>{writes++;return {};})).rejects.toThrow(/caller\/document\/physical binding mismatch/);
  expect(writes).toBe(0);expect(await Promise.all(f.files.map(file=>fs.readFile(file)))).toEqual(f.originals);
},120000);
