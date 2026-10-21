import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createWorkspaceRecoveryStore } from './workspaceRecoveryStore';
import { createControlledMemoryBudget, withControlledMemory } from './controlledMemory';

test('retention checks JSON value resources before stringify builds its detached copy',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'json-value-admission-'));await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
  const project={id:'p',name:'Owner JSON'},offer={revision:'r',projectRaw:project,viewState:{},scriptState:{},effectFacts:{},continuationState:{},assets:[],requiredAssetIds:[]};let authorizations=0;
  const store=createWorkspaceRecoveryStore({budget:{bytes:1024*1024,records:1000,assets:16,jsonDepth:80},authorize:async()=>{authorizations++;throw new Error('authority must not precede failed JSON resource admission');}});
  const budget=createControlledMemoryBudget(16*1024*1024,undefined,{maximumSourceBytes:1024*1024,maximumTokens:1,maximumStringSourceBytes:1024*1024,maximumNesting:81}),stringify=vi.spyOn(JSON,'stringify');
  try{
    await expect(withControlledMemory(budget,()=>store.retain({sender:{},frame:{},window:{},document:{}},root,offer))).rejects.toMatchObject({code:'RAM_ADMISSION'});
    expect(stringify.mock.calls.filter(args=>(args[0] as any)?.projectRaw===project)).toHaveLength(0);
  }finally{stringify.mockRestore();}
  expect(authorizations).toBe(0);expect(await fs.readdir(path.join(root,'.storyboard-workbench'))).toEqual([]);expect(project).toEqual({id:'p',name:'Owner JSON'});
});
