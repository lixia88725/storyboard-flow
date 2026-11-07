import type { ProjectConfirmation } from '../../project-files/main/image-engine/projectStore.js';

function deferred(){let resolve!:()=>void,reject!:(e:unknown)=>void;const promise=new Promise<void>((a,b)=>{resolve=a;reject=b;});void promise.catch(()=>{});return{promise,resolve,reject};}
type Item={record:ProjectConfirmation;accept():Promise<void>;done:ReturnType<typeof deferred>;reserved:boolean};
/** Native accepts are FIFO. Derived confirmation IO is a separate bounded lane;
 * a native-accepted receipt is not the caller's final settled acknowledgement. */
export function createNativeSettlementQueue(options:{confirm(records:readonly ProjectConfirmation[]):Promise<void>;onFault(error:unknown):void}){
 const pending:Item[]=[],all=new Set<Item>(),waiters:Array<ReturnType<typeof deferred>>=[];
 let acceptTail=Promise.resolve(),running:Promise<void>|undefined,timer:ReturnType<typeof setTimeout>|undefined,credits=0,failed:unknown;
 const fail=(error:unknown)=>{
  if(failed)return;failed=error??Error('Native settlement failed');if(timer)clearTimeout(timer);timer=undefined;
  for(const waiter of waiters.splice(0))waiter.reject(failed);for(const item of all)item.done.reject(failed);
  options.onFault(failed);
 };
 const reserve=async()=>{
  while(credits>=4){const waiter=deferred();waiters.push(waiter);await waiter.promise;if(failed)throw failed;}
  if(failed)throw failed;credits++;
 };
 const release=()=>{credits--;waiters.shift()?.resolve();};
 const flush=()=>{
  if(running||failed||!pending.length)return;
  if(timer)clearTimeout(timer);timer=undefined;
  const batch=pending.splice(0,4);
  running=(async()=>{
   try{await options.confirm(batch.map(item=>item.record));for(const item of batch){all.delete(item);release();item.done.resolve();}}
   catch(error){fail(error);}
  })().finally(()=>{running=undefined;if(pending.length&&!failed)flush();});
 };
 const schedule=()=>{if(timer||running||failed)return;timer=setTimeout(()=>{timer=undefined;flush();},0);};
 return{
  enqueue(record:ProjectConfirmation,accept:()=>Promise<void>):Promise<void>{
   const item:Item={record:structuredClone(record),accept,done:deferred(),reserved:false};all.add(item);
   const work=acceptTail.then(async()=>{
    if(failed)throw failed;await reserve();item.reserved=true;
    // Only the durable accepted event releases this FIFO, never acceptQueued.
    await item.accept();if(failed)throw failed;pending.push(item);schedule();
   }).catch(error=>{item.done.reject(error);fail(error);});acceptTail=work.then(()=>undefined,()=>undefined);return item.done.promise;
  },
  fence:fail,
  get capacityAvailable(){return !failed&&credits<4;},
  async drain(){await acceptTail;if(failed)throw failed;flush();while(running||pending.length){if(running)await running;else flush();if(failed)throw failed;}},
  /** Recovery first fences input and exits the old worker, then waits all Main
   * writes. No timeout turns an in-flight confirmation into cancellation. */
  async quiesce(){await acceptTail;if(timer){clearTimeout(timer);timer=undefined;}if(!failed)flush();if(running)await running;},
 };
}
