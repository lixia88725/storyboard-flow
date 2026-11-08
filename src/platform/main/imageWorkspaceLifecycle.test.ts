import {describe,it,expect} from 'vitest';
import {createImageWorkspaceLifecycle} from './imageWorkspaceLifecycle.js';
import type {ImageWorkspaceRuntime,ImageWorkspaceProjectPlan} from '../../project-files/main/image-engine/workspaceRuntimeContract.js';
import type {ImageWorkspaceBootstrap,ImageWorkspaceOutcome,ImageWorkspaceRequest} from '../contracts/imageWorkspace.js';
const plan=(id:string):ImageWorkspaceProjectPlan=>({kind:'native',root:`/fixture/${id}`,identity:{id,name:id},format:'journal'});
function runtime(id:string,log:string[]){
 const owner={sessionId:id,incarnation:id,workspaceEpoch:1};
 const snapshot={owner,session:{phase:'active'}};
 let rejectClose=false;
 const r={open:()=>({snapshot}) as ImageWorkspaceBootstrap,
 request:async({command}:ImageWorkspaceRequest):Promise<ImageWorkspaceOutcome>=>{
  log.push(`${id}:${command.kind}`);
  if(command.kind==='prepareClose')return{kind:'closePrepared',operationId:id,ticket:id,snapshot} as ImageWorkspaceOutcome;
  if(command.kind==='certifyClose')return rejectClose?{kind:'rejected',operationId:id,error:{code:'unknown',message:'unknown',effect:'unknown'}}:{kind:'closed',operationId:id,ticket:id};
  return{kind:'settled',operationId:id,snapshot} as ImageWorkspaceOutcome;
 },dispose:async()=>{log.push(`${id}:dispose`);}} as ImageWorkspaceRuntime;
 return{r,owner,rejectClose:()=>{rejectClose=true;}};
}
describe('native project lifecycle',()=>{
 it('freezes old before opening candidate and certifies before publishing',async()=>{
  const log:string[]=[],a=runtime('a',log),b=runtime('b',log);
  const life=createImageWorkspaceLifecycle({open:async p=>{log.push(`open:${p.identity.id}`);return p.identity.id==='a'?a.r:b.r;},publish:t=>log.push(`publish:${t?.root}`),report:()=>{}});
  await life.launch(plan('a'));log.length=0;await life.launch(plan('b'),a.owner);
  expect(log).toEqual(['a:prepareClose','open:b','a:certifyClose','publish:/fixture/b','a:dispose']);
  expect(life.current()?.runtime).toBe(b.r);
 });
 it('preserves and resumes old history if opening candidate fails',async()=>{
  const log:string[]=[],a=runtime('a',log);
  const life=createImageWorkspaceLifecycle({open:async p=>{if(p.identity.id==='b')throw Error('open failed');return a.r;},publish:()=>{},report:()=>{}});
  await life.launch(plan('a'));await expect(life.launch(plan('b'),a.owner)).rejects.toThrow('open failed');
  expect(log).toEqual(['a:prepareClose','a:resume']);expect(life.current()?.runtime).toBe(a.r);
 });
 it('closes candidate and resumes old if old certification refuses',async()=>{
  const log:string[]=[],a=runtime('a',log),b=runtime('b',log);a.rejectClose();
  const life=createImageWorkspaceLifecycle({open:async p=>p.identity.id==='a'?a.r:b.r,publish:()=>{},report:()=>{}});
  await life.launch(plan('a'));await expect(life.launch(plan('b'),a.owner)).rejects.toThrow('原项目');
  expect(log).toEqual(['a:prepareClose','a:certifyClose','b:prepareClose','b:certifyClose','b:dispose','a:resume']);
  expect(life.retainedCount()).toBe(0);expect(life.current()?.runtime).toBe(a.r);
 });
 it('retains unresolved candidate ownership and blocks another switch',async()=>{
  const log:string[]=[],a=runtime('a',log),b=runtime('b',log);a.rejectClose();b.rejectClose();
  const errors:unknown[]=[];
  const life=createImageWorkspaceLifecycle({open:async p=>p.identity.id==='a'?a.r:b.r,publish:()=>{},report:e=>errors.push(e)});
  await life.launch(plan('a'));await expect(life.launch(plan('b'),a.owner)).rejects.toThrow();
  expect(life.retainedCount()).toBe(1);expect(log).not.toContain('b:dispose');expect(errors).toHaveLength(1);
  await expect(life.launch(plan('c'),a.owner)).rejects.toThrow('资源处理');
  await expect(life.certifyClose(a.owner,'a')).rejects.toThrow('不能退出');
 });
 it('refuses stale callers and reuses the same root without another writer',async()=>{
  const log:string[]=[],a=runtime('a',log);let opened=0;
  const life=createImageWorkspaceLifecycle({open:async()=>{opened++;return a.r;},publish:()=>{},report:()=>{}});
  await life.launch(plan('a'));await expect(life.launch(plan('b'))).rejects.toThrow('归属');
  await life.launch(plan('a'),a.owner);expect(opened).toBe(1);expect(log).toEqual([]);
  expect(await life.certifyClose(a.owner,'a')).toBe(true);expect(log).toEqual(['a:certifyClose','a:dispose']);
 });
 it('keeps a certified owner when release fails and retries release without a second certification',async()=>{
  const log:string[]=[],a=runtime('a',log);let attempts=0;
  a.r.dispose=async()=>{log.push('a:dispose');if(++attempts===1)throw Error('release failed');};
  const life=createImageWorkspaceLifecycle({open:async()=>a.r,publish:()=>{},report:()=>{}});
  await life.launch(plan('a'));
  expect(await life.certifyClose(a.owner,'ticket')).toBe(false);
  expect(life.current()?.runtime).toBe(a.r);expect(life.retainedCount()).toBe(1);
  await expect(life.launch(plan('b'),a.owner)).rejects.toThrow('资源释放');
  expect(await life.certifyClose(a.owner,'ticket')).toBe(true);
  expect(log).toEqual(['a:certifyClose','a:dispose','a:dispose']);
  expect(life.current()).toBeNull();expect(life.retainedCount()).toBe(0);
 });

});
