import { it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
function exposed(source: string) {
 let api: any;const calls:unknown[]=[];let handler: ((...args:unknown[])=>void)|undefined;
 const electron={contextBridge:{exposeInMainWorld:(name:string,value:unknown)=>{expect(name).toBe('flowEditor');api=value;}},ipcRenderer:{
  invoke:(...args:unknown[])=>{calls.push(args);return Promise.resolve({ok:true});},
  on:(channel:string,fn:typeof handler)=>{expect(channel).toBe('flow-editor:close');handler=fn;},
  removeListener:(channel:string,fn:typeof handler)=>{expect(channel).toBe('flow-editor:close');expect(fn).toBe(handler);handler=undefined;}
 }};
 vm.runInNewContext(source,{require:(name:string)=>{expect(name).toBe('electron');return electron;},exports:{}});
 return {api,calls,notify:(id:string)=>handler?.({},id)};
}
it('typed and sandbox CommonJS bridges have identical bounded calls and removable Close subscription',async()=>{
 const a=exposed(ts.transpileModule(fs.readFileSync(new URL('./flowEditor.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText);
 const b=exposed(fs.readFileSync(new URL('./flowEditor.cjs',import.meta.url),'utf8'));
 expect(Object.keys(a.api)).toEqual(Object.keys(b.api));
 for(const value of [a,b]){
  await value.api.open();await value.api.read('asset');await value.api.put({operationId:'op'});await value.api.checkpoint({id:'p'});await value.api.saveTiff({id:'p',revision:1});await value.api.finishClose('close',null);
  const seen:string[]=[];const off=value.api.onClose((id:string)=>seen.push(id));value.notify('one');off();value.notify('two');expect(seen).toEqual(['one']);
 }
 expect(a.calls).toEqual(b.calls);expect(a.calls).toEqual([['flow-editor:open'],['flow-editor:read','asset'],['flow-editor:put',{operationId:'op'}],['flow-editor:checkpoint',{id:'p'}],['flow-editor:saveTiff',{id:'p',revision:1}],['flow-editor:finish-close','close',null]]);
});
