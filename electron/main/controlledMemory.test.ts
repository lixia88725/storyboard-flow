import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createControlledMemoryBudget, withControlledMemory, withControlledBufferOutput, copyControlledBuffer, decodeControlledBase64 } from './controlledMemory';
import sharp from 'sharp';
import { readSnapshotFile } from './snapshotFileRead';

// Real snapshot allocations/FD identity checks. Tiny limits exercise cumulative
// ownership without allocating large images or depending on GC timing.
test('retained snapshot views keep their backing charged across calls and cumulative reads refuse before allocation',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'snapshot-ram-cumulative-')),one=path.join(root,'one'),two=path.join(root,'two');await fs.writeFile(one,'123456',{mode:0o600});await fs.writeFile(two,'abcdef',{mode:0o600});
  const budget=createControlledMemoryBudget(10),kept=await withControlledMemory(budget,()=>readSnapshotFile(one,100));
  expect(kept.toString()).toBe('123456');expect(kept.buffer.byteLength).toBe(7);expect(budget.usage().usedBytes).toBe(7);
  const alloc=vi.spyOn(Buffer,'alloc');
  try{await expect(withControlledMemory(budget,()=>readSnapshotFile(two,100))).rejects.toMatchObject({code:'RAM_ADMISSION'});expect(alloc.mock.calls.filter(args=>args[0]===7)).toHaveLength(0);}finally{alloc.mockRestore();}
  expect(kept.toString()).toBe('123456');expect(budget.usage().usedBytes).toBe(7);expect(await fs.readFile(two,'utf8')).toBe('abcdef');
});

test('nested controlled allocations share their original budget and cannot silently replace it',()=>{
  const budget=createControlledMemoryBudget(10),other=createControlledMemoryBudget(100);let kept:Buffer|undefined;
  withControlledMemory(budget,()=>{
    kept=budget.allocate(7);
    expect(()=>withControlledMemory(budget,()=>budget.allocate(4))).toThrow(/RAM_ADMISSION/);
    expect(()=>withControlledMemory(other,()=>other.allocate(1))).toThrow(/Conflicting Main memory ownership/);
  });
  expect(kept!.byteLength).toBe(7);expect(budget.usage().usedBytes).toBe(7);expect(other.usage().usedBytes).toBe(0);
});

test('an allocation that throws before returning a backing does not retain a fictitious charge',()=>{
  const budget=createControlledMemoryBudget(10),failure=new Error('synthetic allocator refusal'),alloc=vi.spyOn(Buffer,'alloc').mockImplementationOnce(()=>{throw failure;});
  try{expect(()=>budget.allocate(7)).toThrow(failure);}finally{alloc.mockRestore();}
  expect(budget.usage().usedBytes).toBe(0);expect(budget.allocate(10).byteLength).toBe(10);
});

test('native buffer output is admitted before execution and its real backing remains charged',async()=>{
  const small=createControlledMemoryBudget(15);let started=0;
  await expect(withControlledMemory(small,()=>withControlledBufferOutput(16,async()=>{started++;return Buffer.alloc(16);}))).rejects.toMatchObject({code:'RAM_ADMISSION'});expect(started).toBe(0);
  const enough=createControlledMemoryBudget(16),output=await withControlledMemory(enough,()=>withControlledBufferOutput(16,()=>sharp({create:{width:2,height:2,channels:4,background:'blue'}}).ensureAlpha().raw().toBuffer()));
  expect(output.length).toBe(16);expect(output.buffer.byteLength).toBe(16);expect(enough.usage().usedBytes).toBe(16);
});

test('native failure cancels only its pending quote, never an already returned oversized backing',async()=>{
  const budget=createControlledMemoryBudget(16),error=new Error('synthetic decoder refusal');
  await expect(withControlledMemory(budget,()=>withControlledBufferOutput(8,async()=>{throw error;}))).rejects.toBe(error);expect(budget.usage().usedBytes).toBe(0);
  const kept=Buffer.alloc(16);
  await expect(withControlledMemory(budget,()=>withControlledBufferOutput(8,async()=>kept))).rejects.toMatchObject({code:'RAM_ADMISSION'});
  expect(budget.usage().usedBytes).toBe(16);expect(()=>budget.allocate(1)).toThrow(/RAM_ADMISSION/);expect(kept.length).toBe(16);
});

test('detached copies are individually backed and cumulatively admitted without aliasing their input',()=>{
  const budget=createControlledMemoryBudget(10),source=new Uint8Array([1,2,3,4,5,6]);
  const copy=withControlledMemory(budget,()=>copyControlledBuffer(source));
  expect([...copy]).toEqual([1,2,3,4,5,6]);expect(copy.buffer.byteLength).toBe(6);expect(budget.usage().usedBytes).toBe(6);
  source[0]=9;expect(copy[0]).toBe(1);
  expect(()=>withControlledMemory(budget,()=>copyControlledBuffer(source))).toThrow(/RAM_ADMISSION/);expect(budget.usage().usedBytes).toBe(6);
});

test('base64 decode owns exact independent backing and keeps cumulative charges',()=>{
  const budget=createControlledMemoryBudget(12);
  const first=withControlledMemory(budget,()=>decodeControlledBase64('AAECAwQF'));
  const second=withControlledMemory(budget,()=>decodeControlledBase64('AAECAwQF'));
  expect([...first]).toEqual([0,1,2,3,4,5]);expect(first.buffer.byteLength).toBe(6);expect(second.buffer).not.toBe(first.buffer);expect(budget.usage().usedBytes).toBe(12);
  expect(()=>withControlledMemory(budget,()=>decodeControlledBase64('AAECAwQF'))).toThrow(/RAM_ADMISSION/);expect(budget.usage().usedBytes).toBe(12);
});

test('permissive base64 input preserves Node bytes without uncharging its larger backing',()=>{
  const budget=createControlledMemoryBudget(64),value=withControlledMemory(budget,()=>decodeControlledBase64('AAEC \nAwQF'));
  expect([...value]).toEqual([0,1,2,3,4,5]);expect(budget.usage().usedBytes).toBe(value.buffer.byteLength);
});
