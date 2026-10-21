import { expect, test, vi } from 'vitest';
import { scanJSONResources, inspectJSONValueResources, type JSONResourceLimits } from './jsonMemoryResources';
import { createControlledMemoryBudget, withControlledMemory, parseControlledJSON, serializeControlledJSON } from './controlledMemory';

const limits:JSONResourceLimits={maximumSourceBytes:1024*1024,maximumTokens:300000,maximumStringSourceBytes:1024*1024,maximumNesting:81};
test('census counts encoded lexical resources without treating quoted brackets as structure',()=>{
  expect(scanJSONResources(Buffer.from('{"a":[1,true,null,"x"]}'),limits)).toMatchObject({sourceBytes:23,tokens:7,strings:2,stringSourceBytes:2,maxStringSourceBytes:1,maximumObservedNesting:2});
  const escaped=scanJSONResources(Buffer.from(JSON.stringify({a:'[[["\\end'})),limits);
  expect(escaped).toMatchObject({tokens:3,strings:2,maximumObservedNesting:1});
  expect(scanJSONResources(Buffer.from('{"中文":"é😀"}'),limits)).toMatchObject({tokens:3,strings:2,stringSourceBytes:12,maxStringSourceBytes:6});
});

test.each([
  {bytes:'[1,2]',policy:{...limits,maximumSourceBytes:4}},
  {bytes:'[1,2]',policy:{...limits,maximumTokens:2}},
  {bytes:'["aa","bb"]',policy:{...limits,maximumStringSourceBytes:3}},
  {bytes:'[[[]]]',policy:{...limits,maximumNesting:2}},
])('each logical dimension refuses independently',({bytes,policy})=>{
  expect(()=>scanJSONResources(Buffer.from(bytes),policy)).toThrow(/RAM_ADMISSION/);
});

test('large flat input is inspected without invoking an object-building parser',()=>{
  const input=Buffer.from('['+'0,'.repeat(199999)+'0]'),parse=vi.spyOn(JSON,'parse');
  try{expect(scanJSONResources(input,limits)).toMatchObject({sourceBytes:400001,tokens:200001,maximumObservedNesting:1});expect(parse).not.toHaveBeenCalled();}finally{parse.mockRestore();}
});

test('only the supplied byte view is scanned and ordinary JSON syntax checks are still performed',()=>{
  const storage=Buffer.from('{"ok":1}not JSON'),view=storage.subarray(0,storage.indexOf('}')+1);
  const budget=createControlledMemoryBudget(1024,undefined,limits);
  expect(withControlledMemory(budget,()=>parseControlledJSON(view))).toEqual({ok:1});
  // The census intentionally is not a full grammar validator; parsing cannot
  // accidentally be bypassed merely because the resource census succeeded.
  expect(()=>withControlledMemory(budget,()=>parseControlledJSON(Buffer.from('[1,]')))).toThrow(SyntaxError);
});

test.each(['{]','"unfinished','[1','"line\nbreak"'])('malformed delimiters and unfinished strings do not pass the census: %s',text=>{
  expect(()=>scanJSONResources(Buffer.from(text),limits)).toThrow(SyntaxError);
});

test('value census agrees with trusted native encoding across Unicode code units and numeric boundaries',()=>{
  const allUnits=Array.from({length:65536},(_,i)=>String.fromCharCode(i)).join('');
  const sparse:unknown[]=[];sparse.length=3;sparse[1]=true;
  const shared={text:'shared'};
  for(const value of [allUnits,{'\u0000"\\\ud800':'é😀\udfff'},[-0,Number.MIN_VALUE,Number.MAX_VALUE,1e21],sparse,{a:shared,b:shared}]){
    const actual=inspectJSONValueResources(value,limits),reference=scanJSONResources(Buffer.from(JSON.stringify(value)),limits);
    expect(actual).toEqual(reference);
  }
});

test('value census does not invoke getters, proxies or custom serializers',()=>{
  let calls=0;
  const getter=Object.defineProperty({},'a',{enumerable:true,get(){calls++;return 'bad';}});
  const hook=Object.defineProperty({},'toJSON',{value:()=>{calls++;return 'bad';}});
  const proxy=new Proxy({},{ownKeys(){calls++;return [];}});
  for(const value of [getter,hook,proxy])expect(()=>inspectJSONValueResources(value,limits)).toThrow();
  expect(calls).toBe(0);
});

test('huge sparse arrays are rejected by their minimum token count before reading an index',()=>{
  const sparse:unknown[]=[];sparse.length=1000000;const descriptor=vi.spyOn(Object,'getOwnPropertyDescriptor');
  try{expect(()=>inspectJSONValueResources(sparse,{...limits,maximumTokens:10})).toThrow(/RAM_ADMISSION/);expect(descriptor.mock.calls.filter(args=>args[1]==='0')).toHaveLength(0);}finally{descriptor.mockRestore();}
});

test('controlled JSON backs its exact native bytes only after admission, preserving the input',()=>{
  const value={text:'é😀',items:[1,null]},budget=createControlledMemoryBudget(1024,undefined,limits),expected=Buffer.from(JSON.stringify(value));
  const encoded=withControlledMemory(budget,()=>serializeControlledJSON(value,()=>{}));
  expect(encoded).toEqual(expected);expect(encoded.buffer.byteLength).toBe(expected.length);expect(budget.usage().usedBytes).toBe(expected.length);expect(value).toEqual({text:'é😀',items:[1,null]});
  const tiny=createControlledMemoryBudget(1,undefined,limits),stringify=vi.spyOn(JSON,'stringify');
  try{expect(()=>withControlledMemory(tiny,()=>serializeControlledJSON(value,()=>{}))).toThrow(/RAM_ADMISSION/);expect(stringify).not.toHaveBeenCalled();}finally{stringify.mockRestore();}
});
