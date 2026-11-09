/** Serial immutable work with live priorities. A waiting low-priority job gets
 * every fifth turn, so navigating cannot indefinitely starve accepted work. */
export function createWorkspaceJobQueue(){
 type Job={priority:()=>number;run:()=>Promise<void>};
 const waiting:Job[]=[];let running=false,preferred=0;
 const pump=()=>{if(running||!waiting.length)return;running=true;
  let index=0;if(preferred<4){for(let i=1;i<waiting.length;i++)if(waiting[i].priority()<waiting[index].priority())index=i;preferred++;}else preferred=0;
  const [job]=waiting.splice(index,1);void job.run().finally(()=>{running=false;pump();});
 };
 return{run<T>(priority:()=>number,work:()=>Promise<T>):Promise<T>{return new Promise<T>((resolve,reject)=>{waiting.push({priority,run:async()=>{try{resolve(await work());}catch(e){reject(e);}}});queueMicrotask(pump);});}};
}
