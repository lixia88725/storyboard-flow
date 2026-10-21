import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { createOriginWorkspaceAccounting } from './originWorkspaceAccounting';
import { createRecoveryClaimRecords } from './recoveryClaimRecords';
import { createControlledMemoryBudget, withControlledMemory } from './controlledMemory';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';
import { writeLayerPng } from './layerAssetService';

test('real ordinary PNG before-capture funds its native typed-backing clone before source effects',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordinary-clone-ram-')),userData=await fs.mkdtemp(path.join(os.tmpdir(),'ordinary-clone-userdata-')),bitmapPath='.storyboard-workbench/layers/s/a.png',file=path.join(root,bitmapPath),metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),script=path.join(root,'storyboard-script.md'),tiff=path.join(root,'s.tiff'),python='python3';
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});const blue=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer(),green=await sharp({create:{width:2,height:2,channels:4,background:'green'}}).png().toBuffer();await fs.writeFile(file,blue,{mode:0o600});await fs.writeFile(tiff,await sharp(blue).tiff().toBuffer(),{mode:0o600});
  const project={id:'p',name:'Ordinary clone',shots:[{id:'s',imagePath:tiff,fileName:'s.tiff',swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'a',kind:'paint',bitmapPath,width:2,height:2}]}],dialogues:[]};
  const persist=async()=>{await fs.writeFile(metadata,JSON.stringify(project,null,2)+'\n',{mode:0o600});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project as any),{mode:0o600});return {};};await persist();
  const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python,script:path.resolve('scripts/recovery-origin-permissions.py'),claimRecords:()=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py')}),claimWriter:(_root,restrictions)=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py'),restrictions:()=>restrictions})});
  // External private Main memory owner makes its pending ledger observable;
  // production Native/claim/Store/producer ports are real, not replaced.
  const service=createPreparedWorkspaceSave({accounting,python,script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:8*1024*1024,records:2000,assets:32,jsonDepth:80}}),budget=createControlledMemoryBudget(128*1024*1024),frame={},event:any={sender:{mainFrame:frame},senderFrame:frame};
  const payload={folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  await withControlledMemory(budget,async()=>{
    const saved=await service.run(event,payload,async()=>({project,normalSaveOutputs:[]}));await service.persist(event,{...payload,recoverySaveNonce:saved.recoverySaveNonce},persist);await service.acknowledge(event,{folderPath:root,nonce:saved.recoverySaveNonce,project});
    const native=globalThis.structuredClone;let captured=0;const clone=vi.spyOn(globalThis,'structuredClone').mockImplementation((value:any)=>{
      if(Array.isArray(value?.assets)&&value.assets.some((a:any)=>a.bytes instanceof Uint8Array)){
        captured++;expect(budget.usage().pendingBytes).toBeGreaterThan(0);expect(readFileSync(file)).toEqual(blue);
      }
      return native(value);
    });
    try{await service.ordinary(event,'layers:writePng',{folderPath:root,bitmapPath,dataUrl:'data:image/png;base64,'+green.toString('base64')},[root,file],()=>writeLayerPng({folderPath:root,bitmapPath,dataUrl:'data:image/png;base64,'+green.toString('base64')}));}finally{clone.mockRestore();}
    expect(captured).toBeGreaterThan(0);expect(await fs.readFile(file)).toEqual(green);expect(budget.usage().pendingBytes).toBe(0);
  });
},120000);
