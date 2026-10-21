import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createWorkspaceRecoveryStore } from './workspaceRecoveryStore';
import { createControlledMemoryBudget, withControlledMemory } from './controlledMemory';

// Public content-store allocation seam BEFORE any authority request. The
// authority port deliberately throws if reached; this is not Native proof.
test('recovery retention admits the real asset copy before copying caller-owned bytes',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'asset-copy-ram-root-'));await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
  const bytes=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();let authorizations=0;
  const store=createWorkspaceRecoveryStore({budget:{bytes:1024*1024,records:1000,assets:16,jsonDepth:80},authorize:async()=>{authorizations++;throw new Error('authorization must not precede failed memory admission');}});
  const budget=createControlledMemoryBudget(1),copy=vi.spyOn(Buffer,'from');
  try{
    await expect(withControlledMemory(budget,()=>store.retain({sender:{},frame:{},window:{},document:{}},root,{revision:'copy',projectRaw:{id:'p'},viewState:{},scriptState:{},effectFacts:{},continuationState:{},assets:[{assetId:'a',bytes,role:'original/s/a',width:2,height:2,encoding:'png'}],requiredAssetIds:['a']}))).rejects.toThrow(/RAM_ADMISSION/);
    expect(copy.mock.calls.filter(args=>args[0]===bytes)).toHaveLength(0);
  }finally{copy.mockRestore();}
  expect(authorizations).toBe(0);expect((await fs.readdir(path.join(root,'.storyboard-workbench'))).length).toBe(0);expect(bytes.subarray(0,8)).toEqual(Buffer.from([137,80,78,71,13,10,26,10]));
});
