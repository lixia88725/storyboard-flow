import { expect, test, vi } from 'vitest';
import { createControlledMemoryBudget, withControlledMemory, cloneControlled } from './controlledMemory';
import { recoveryProjectAbsence } from '../shared/recoveryProjectAbsence';

test('clone pre-admits the whole native backing, not only the visible typed-array bytes',()=>{
  const backing=new ArrayBuffer(2048),input={pixel:new Uint8Array(backing,7,1)},budget=createControlledMemoryBudget(1),clone=vi.spyOn(globalThis,'structuredClone');
  try{expect(()=>withControlledMemory(budget,()=>cloneControlled(input))).toThrow(/RAM_ADMISSION/);expect(clone).not.toHaveBeenCalled();}finally{clone.mockRestore();}
  expect(budget.usage().usedBytes).toBe(0);expect(input.pixel.byteLength).toBe(1);
});

test('native clone preserves aliases, cycles and undefined while each new backing is charged once',()=>{
  const backing=new ArrayBuffer(64),view=new Uint8Array(backing,2,3),other=new DataView(backing,8,2);view[0]=7;
  const input:any={view,other,missing:undefined,map:new Map([['v',view]]),set:new Set([other])};input.self=input;
  const budget=createControlledMemoryBudget(96),copy=withControlledMemory(budget,()=>cloneControlled(input));
  expect(copy.self).toBe(copy);expect(copy.view.buffer).toBe(copy.other.buffer);expect(copy.view.buffer).not.toBe(backing);expect(copy.view.byteOffset).toBe(2);expect(copy.view[0]).toBe(7);expect(copy.map.get('v')).toBe(copy.view);expect(copy.set.has(copy.other)).toBe(true);expect(Object.hasOwn(copy,'missing')).toBe(true);
  expect(budget.usage()).toMatchObject({usedBytes:64,pendingBytes:0});view[0]=9;expect(copy.view[0]).toBe(7);
  expect(()=>withControlledMemory(budget,()=>cloneControlled(input))).toThrow(/RAM_ADMISSION/);expect(budget.usage().usedBytes).toBe(64);
});

test('logical clone limits reject before native cloning but do not JSON-normalize undefined',()=>{
  const budget=createControlledMemoryBudget(1024,undefined,{maximumSourceBytes:1024,maximumTokens:1,maximumStringSourceBytes:1024,maximumNesting:81}),clone=vi.spyOn(globalThis,'structuredClone');
  try{expect(()=>withControlledMemory(budget,()=>cloneControlled({a:undefined}))).toThrow(/RAM_ADMISSION/);expect(clone).not.toHaveBeenCalled();}finally{clone.mockRestore();}
});

test('a native clone failure cancels pending reservations, not observed process memory',()=>{
  const budget=createControlledMemoryBudget(64),input=new Uint8Array(16),clone=vi.spyOn(globalThis,'structuredClone').mockImplementation(()=>{throw new Error('native clone failed');});
  try{expect(()=>withControlledMemory(budget,()=>cloneControlled(input))).toThrow('native clone failed');}finally{clone.mockRestore();}
  expect(budget.usage()).toMatchObject({usedBytes:0,pendingBytes:0});
});

test('an adapter returning unquoted backing remains charged even with an originally empty quote',()=>{
  const unexpected=new Uint8Array(16),budget=createControlledMemoryBudget(16),clone=vi.spyOn(globalThis,'structuredClone').mockReturnValue(unexpected);
  try{expect(()=>withControlledMemory(budget,()=>cloneControlled({a:1}))).toThrow(/RAM_ADMISSION/);}finally{clone.mockRestore();}
  expect(budget.usage()).toMatchObject({usedBytes:16,pendingBytes:0});expect(()=>budget.allocate(1)).toThrow(/RAM_ADMISSION/);expect(unexpected.length).toBe(16);
});

test('typed buffer inspection uses intrinsics and does not invoke shadow getters',()=>{
  const input=new Uint8Array(16);let calls=0;
  Object.defineProperty(input,'buffer',{get(){calls++;throw new Error('shadow buffer getter');}});
  const budget=createControlledMemoryBudget(32),copy=withControlledMemory(budget,()=>cloneControlled(input));
  expect(calls).toBe(0);expect(copy.byteLength).toBe(16);expect(budget.usage().usedBytes).toBe(16);
});

test('shared memory is preserved as shared, not billed as a newly copied backing',()=>{
  const input=new Uint8Array(new SharedArrayBuffer(16)),budget=createControlledMemoryBudget(1),copy=withControlledMemory(budget,()=>cloneControlled(input));
  copy[0]=7;expect(input[0]).toBe(7);expect(budget.usage()).toMatchObject({usedBytes:0,pendingBytes:0});
});

test('optional-field normalization uses the supplied Main clone owner rather than a hidden native clone',()=>{
  const budget=createControlledMemoryBudget(1024,undefined,{maximumSourceBytes:1024,maximumTokens:1,maximumStringSourceBytes:1024,maximumNesting:81});
  expect(()=>withControlledMemory(budget,()=>recoveryProjectAbsence({id:'p'},cloneControlled))).toThrow(/RAM_ADMISSION/);
});

test('default and Main-owned normalization preserve unknown undefined fields and null values',()=>{
  const input={parkedShots:undefined,shots:[{presentation:undefined,unknown:undefined,swb:{sourceKind:undefined,other:null}}]},budget=createControlledMemoryBudget(1024);
  const plain:any=recoveryProjectAbsence(input),owned:any=withControlledMemory(budget,()=>recoveryProjectAbsence(input,cloneControlled));
  expect(owned).toEqual(plain);expect(Object.hasOwn(owned,'parkedShots')).toBe(false);expect(Object.hasOwn(owned.shots[0],'presentation')).toBe(false);expect(Object.hasOwn(owned.shots[0],'unknown')).toBe(true);expect(owned.shots[0].swb.other).toBeNull();expect(Object.hasOwn(input,'parkedShots')).toBe(true);expect(Object.hasOwn(input.shots[0],'presentation')).toBe(true);
});
