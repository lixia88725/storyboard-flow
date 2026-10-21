import { expect, test, vi } from 'vitest';
import { createControlledMemoryBudget } from './controlledMemory';

// Explicit synthetic sensor seam tests pressure arithmetic, not real RSS bounds.
const policy={rssBytes:100,externalBytes:100,heapBytes:90,minimumFreeBytes:20,operationHeadroomBytes:5};
const sample=()=>({rssBytes:80,externalBytes:40,heapUsedBytes:20,freeBytes:200});
test('pressure can refuse a real allocation even when its controlled backing quota fits',()=>{
  const budget=createControlledMemoryBudget(100,{policy,sample});const alloc=vi.spyOn(Buffer,'alloc');
  try{expect(()=>budget.allocate(16)).toThrow(/RAM_ADMISSION/);expect(alloc.mock.calls.filter(a=>a[0]===16)).toHaveLength(0);}finally{alloc.mockRestore();}
  expect(budget.usage().usedBytes).toBe(0);
});

test('pending outputs forecast together, but adoption ends only the pending forecast',()=>{
  let rss=50;
  const budget=createControlledMemoryBudget(100,{policy,sample:()=>({...sample(),rssBytes:rss})});
  const first=budget.reserve(30);expect(()=>budget.reserve(16)).toThrow(/RAM_ADMISSION/);expect(budget.usage().pendingBytes).toBe(30);
  first.cancel();const second=budget.reserve(16),kept=second.adopt(Buffer.alloc(16));second.cancel();
  expect(budget.usage().pendingBytes).toBe(0);expect(budget.usage().usedBytes).toBe(16);
  rss=100;expect(()=>budget.reserve(1)).toThrow(/RAM_ADMISSION/);expect(kept.length).toBe(16);
});

test('RSS, external and heap observations are not incorrectly summed',()=>{
  const budget=createControlledMemoryBudget(100,{policy,sample:()=>({rssBytes:80,externalBytes:70,heapUsedBytes:60,freeBytes:200})});
  expect(budget.allocate(10).length).toBe(10);
});

test.each([
  {rssBytes:20,externalBytes:20,heapUsedBytes:86,freeBytes:200},
  {rssBytes:20,externalBytes:20,heapUsedBytes:20,freeBytes:35},
  {rssBytes:20,externalBytes:95,heapUsedBytes:20,freeBytes:200},
])('each independent pressure dimension can refuse before allocation',snapshot=>{
  const budget=createControlledMemoryBudget(100,{policy,sample:()=>snapshot});
  expect(()=>budget.allocate(16)).toThrow(/RAM_ADMISSION/);expect(budget.usage().usedBytes).toBe(0);
});

test('missing pressure observation is refused, not silently interpreted as available memory',()=>{
  const budget=createControlledMemoryBudget(100,{policy,sample:()=>({rssBytes:1} as any)});
  expect(()=>budget.allocate(1)).toThrow(/RAM_ADMISSION/);
});
