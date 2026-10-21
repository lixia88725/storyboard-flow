import { expect, test, vi } from 'vitest';
import { createControlledMemoryBudget, withControlledMemory, stringifyControlledJSON, encodeControlledUTF8 } from './controlledMemory';
import { inspectJSONValueResources, scanJSONResources } from './jsonMemoryResources';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';

test('Main JSON hashing/comparison refuses logical excess before native stringify',()=>{
  const input={id:'p'},budget=createControlledMemoryBudget(1024,undefined,{maximumSourceBytes:1024,maximumTokens:1,maximumStringSourceBytes:1024,maximumNesting:81}),native=vi.spyOn(JSON,'stringify');
  try{expect(()=>withControlledMemory(budget,()=>stringifyControlledJSON(input))).toThrow(/RAM_ADMISSION/);expect(native).not.toHaveBeenCalled();}finally{native.mockRestore();}
  expect(input).toEqual({id:'p'});
});

test('hash/transport projection preserves native undefined and nonfinite omission/null behavior',()=>{
  const input={missing:undefined,list:[undefined,NaN,Infinity,-Infinity],kept:null},budget=createControlledMemoryBudget(1024,undefined,{maximumSourceBytes:1024,maximumTokens:100,maximumStringSourceBytes:1024,maximumNesting:81});
  expect(withControlledMemory(budget,()=>stringifyControlledJSON(input))).toBe(JSON.stringify(input));
  expect(withControlledMemory(budget,()=>stringifyControlledJSON(undefined))).toBeUndefined();expect(Object.hasOwn(input,'missing')).toBe(true);
});

test('two-space metadata output includes all formatting bytes in the pre-stringify limit',()=>{
  const input={a:[{b:'中\ud800'},null]},expected=JSON.stringify(input,null,2),maximum=Buffer.byteLength(expected,'utf8'),limits={maximumSourceBytes:maximum-1,maximumTokens:100,maximumStringSourceBytes:1024,maximumNesting:81},budget=createControlledMemoryBudget(1024,undefined,limits),native=vi.spyOn(JSON,'stringify');
  try{expect(()=>withControlledMemory(budget,()=>stringifyControlledJSON(input,null,2))).toThrow(/RAM_ADMISSION/);expect(native).not.toHaveBeenCalled();}finally{native.mockRestore();}
  expect(withControlledMemory(createControlledMemoryBudget(1024,undefined,{...limits,maximumSourceBytes:maximum}),()=>stringifyControlledJSON(input,null,2))).toBe(expected);
});

test('metadata/script UTF8 backing is funded before encoding, including multibyte characters',()=>{
  const input='中🙂',budget=createControlledMemoryBudget(1),native=vi.spyOn(Buffer,'from');
  try{expect(()=>withControlledMemory(budget,()=>encodeControlledUTF8(input))).toThrow(/RAM_ADMISSION/);expect(native).not.toHaveBeenCalled();}finally{native.mockRestore();}
});

test('UTF8 output preserves exact bytes with standalone GC-charged backing',()=>{
  const text='中🙂\ud800\n',expected=Buffer.from(text),budget=createControlledMemoryBudget(1024),copy=withControlledMemory(budget,()=>encodeControlledUTF8(text));
  expect(copy).toEqual(expected);expect(budget.usage().usedBytes).toBe(expected.length);expect(copy.buffer.byteLength).toBe(expected.length);expect(budget.usage().pendingBytes).toBe(0);
});

test('native-data census matches actual compact and pretty JSON while finite Store mode stays strict',()=>{
  const holes=new Array(3);holes[0]=undefined;holes[2]='x';const input={missing:undefined,holes,number:NaN,nested:{a:[{},[]]}},limits={maximumSourceBytes:100000,maximumTokens:1000,maximumStringSourceBytes:100000,maximumNesting:81};
  for(const space of [undefined,2] as const){const actual=scanJSONResources(Buffer.from(JSON.stringify(input,null,space)),limits),quoted=inspectJSONValueResources(input,limits,{nativeData:true,space});expect(quoted).toEqual(actual);}
  expect(()=>inspectJSONValueResources({missing:undefined},limits)).toThrow();expect(()=>inspectJSONValueResources(NaN,limits)).toThrow();
});

test('actual Main Close collection entry checks logical resources before creating its transport string',async()=>{
  const service=createPreparedWorkspaceSave({budget:{bytes:1024*1024,records:1000,assets:100,jsonDepth:80},memoryBudgetBytes:1024*1024,memoryJSON:{maximumSourceBytes:1024,maximumTokens:1,maximumStringSourceBytes:1024,maximumNesting:81}}),frame={},event:any={sender:{mainFrame:frame},senderFrame:frame},native=vi.spyOn(JSON,'stringify');
  try{await expect(service.certifyRetainedSet(event,{slots:[]})).rejects.toThrow(/RAM_ADMISSION/);expect(native).not.toHaveBeenCalled();}finally{native.mockRestore();}
});
