import { expect, it, vi } from 'vitest';
import { createNativeSettlementQueue } from './nativeSettlementQueue';
const record=(n:number)=>({operationId:`op${n}`,commitHash:String(n).repeat(64),native:{storeId:'store',documentId:'document',versionId:String(n).repeat(64),manifestSha256:String(n).repeat(64),width:64,height:64}});
it('bounds accepted confirmation credits, flushes a partial idle batch and delays settled acknowledgements',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r),batches:string[][]=[],accepted:string[]=[],settled:string[]=[];
 const q=createNativeSettlementQueue({confirm:async records=>{batches.push(records.map(r=>r.operationId));if(batches.length===1)await gate;},onFault:()=>{throw Error('Unexpected queue fault');}});
 const work=Array.from({length:5},(_,i)=>{const r=record(i+1);return q.enqueue(r,async()=>{accepted.push(r.operationId);}).then(()=>settled.push(r.operationId));});
 await vi.waitFor(()=>expect(batches).toHaveLength(1));expect(batches[0]).toEqual(['op1','op2','op3','op4']);expect(accepted).toEqual(['op1','op2','op3','op4']);expect(settled).toEqual([]);expect(q.capacityAvailable).toBe(false);
 release();await q.drain();await Promise.all(work);expect(batches[1]).toEqual(['op5']);expect(settled).toEqual(['op1','op2','op3','op4','op5']);expect(q.capacityAvailable).toBe(true);
});
it('rejects confirmation and waiting credits on unknown IO, quiesces without claiming cancellation',async()=>{
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let faults=0;
 const q=createNativeSettlementQueue({confirm:async()=>{await gate;throw Error('unknown directory sync');},onFault:()=>{faults++;}});
 const outcomes=Array.from({length:5},(_,i)=>q.enqueue(record(i+1),async()=>{}).then(()=>false,()=>true));await new Promise(r=>setTimeout(r,5));release();expect(await Promise.all(outcomes)).toEqual([true,true,true,true,true]);await q.quiesce();await expect(q.drain()).rejects.toThrow('unknown directory sync');expect(faults).toBe(1);expect(q.capacityAvailable).toBe(false);
});
