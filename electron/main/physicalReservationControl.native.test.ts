import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOriginWorkspaceAccounting, type ReservationPhysicalControl } from './originWorkspaceAccounting';

const fixture=async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'physical-control-root-')),userData=await fs.mkdtemp(path.join(os.tmpdir(),'physical-control-data-'));await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
  const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
  return {root,accounting,budget:{bytes:1024*1024,records:1000,assets:16,jsonDepth:80}};
};
// Actual Native census at the public allocator seam; legacy (non-durable)
// configuration isolates private callback lifetime. Durable cold refusal is
// covered separately through the real registered Main Add entry.
test('physical unknown is sticky even when the callback returns and a predeclared handler completes',async()=>{
  const f=await fixture();let handled=0,effects=0;
  await expect(f.accounting.reserve(f.root,f.budget,32768,1,async control=>{control!.unknown();return 'not permission to succeed';},async()=>{handled++;})).rejects.toThrow(/unknown/);
  expect(handled).toBe(1);
  await expect(f.accounting.reserve(f.root,f.budget,32768,1,async()=>{effects++;})).rejects.toThrow(/unknown/);expect(effects).toBe(0);
},120000);

test('handling an operation error cannot make a physically unknown legacy scope report successful settlement',async()=>{
  const f=await fixture();
  await expect(f.accounting.run(async()=>{
    await f.accounting.reserve(f.root,f.budget,32768,1,async control=>{control!.unknown();throw new Error('original uncertain effect');},async()=>{}).catch(()=>{});
    return 'body handled the error, not the physical outcome';
  })).rejects.toThrow(/physical.*unknown/);
},120000);

test('a physical control cannot be used outside its callback or after its original task settled',async()=>{
  const f=await fixture();let control:ReservationPhysicalControl|undefined;
  let ready!:()=>void,release!:()=>void;const entered=new Promise<void>(resolve=>{ready=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  await f.accounting.run(async()=>{
    const task=f.accounting.reserve(f.root,f.budget,32768,1,async value=>{control=value;ready();await gate;});
    await entered;
    try{expect(()=>control!.unknown()).toThrow(/Original active physical reservation/);}finally{release();}
    await task;
  });
  expect(()=>control!.unknown()).toThrow(/Original active physical reservation/);
  await f.accounting.reserve(f.root,f.budget,32768,1,async()=>{expect(()=>control!.unknown()).toThrow(/Original active physical reservation/);});
},120000);
