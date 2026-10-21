import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';
import { createControlledMemoryBudget, withControlledMemory } from './controlledMemory';

// A valid completed Root, not a corrupt/unknown namespace refusal. Calls the
// real installed predicate outside every service API/controlled ALS scope.
test('the installed retirement predicate cannot bypass its service snapshot RAM budget',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'retirement-ram-root-')),bitmapPath='.storyboard-workbench/layers/s/a.png',file=path.join(root,bitmapPath),metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),script=path.join(root,'storyboard-script.md'),tiff=path.join(root,'s.tiff');await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const png=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();await fs.writeFile(file,png,{mode:0o600});await fs.writeFile(tiff,await sharp(png).tiff().toBuffer(),{mode:0o600});
  const project={id:'p',name:'retirement memory ownership',shots:[{id:'s',imagePath:tiff,fileName:'s.tiff',swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'a',kind:'paint',bitmapPath,width:2,height:2}]}],dialogues:[]};
  const json=Buffer.from(JSON.stringify(project,null,2)+'\n'),persist=async()=>{await fs.writeFile(metadata,json,{mode:0o600});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project as any),{mode:0o600});return {};};await persist();
  const options={python:'python3',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80}};
  const original=createPreparedWorkspaceSave(options),frame={},event:any={sender:{mainFrame:frame},senderFrame:frame},payload={folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  const saved=await original.run(event,payload,async()=>({project,normalSaveOutputs:[]}));await original.persist(event,{...payload,recoverySaveNonce:saved.recoverySaveNonce},persist);await original.acknowledge(event,{folderPath:root,nonce:saved.recoverySaveNonce,project});
  await assertPhysicalWorkspaceWriterTargets([file]); // independently demonstrate the valid completed Root
  const originals=await Promise.all([metadata,script,tiff,file].map(f=>fs.readFile(f)));
  createPreparedWorkspaceSave({...options,memoryBudgetBytes:1}); // installs a new, cold predicate
  const alloc=vi.spyOn(Buffer,'alloc');
  try{await expect(assertPhysicalWorkspaceWriterTargets([file])).rejects.toThrow(/protected|RAM_ADMISSION/);expect(alloc.mock.calls.filter(args=>args[0]===json.length+1)).toHaveLength(0);}finally{alloc.mockRestore();}
  const foreign=createControlledMemoryBudget(2*1024*1024);
  await expect(withControlledMemory(foreign,()=>assertPhysicalWorkspaceWriterTargets([file]))).rejects.toThrow(/Conflicting Main memory ownership/);expect(foreign.usage().usedBytes).toBe(0);
  expect(await Promise.all([metadata,script,tiff,file].map(f=>fs.readFile(f)))).toEqual(originals);
},120000);
