import {randomUUID} from 'node:crypto';
import type {ImageWorkspaceOwner,ImageWorkspaceBootstrap,ImageWorkspaceCommand} from '../contracts/imageWorkspace.js';
import type {ImageWorkspaceRuntime,ImageWorkspaceProjectPlan,ImageWorkspaceTarget} from '../../project-files/main/image-engine/workspaceRuntimeContract.js';

const sameOwner=(a:ImageWorkspaceOwner,b:ImageWorkspaceOwner)=>a.sessionId===b.sessionId&&a.incarnation===b.incarnation&&a.workspaceEpoch===b.workspaceEpoch;
/** Platform lifecycle, not project authority. Old and candidate owners are
 * retained until their own Main Session certifies the corresponding close. */
export function createImageWorkspaceLifecycle(options:{
 open(plan:ImageWorkspaceProjectPlan):Promise<ImageWorkspaceRuntime>;
 publish(target:ImageWorkspaceTarget|null):void;
 report(error:unknown):void;
}){
 let current:ImageWorkspaceTarget|null=null,busy=false;
 let closingTicket:string|undefined;
 const retained=new Map<ImageWorkspaceRuntime,'unclosed'|'certified'>();
 const invoke=(runtime:ImageWorkspaceRuntime,command:ImageWorkspaceCommand)=>runtime.request({owner:runtime.open().snapshot.owner,requestId:`lifecycle-${randomUUID()}`,command});
 const dispose=async(runtime:ImageWorkspaceRuntime)=>{try{await runtime.dispose();retained.delete(runtime);return true;}catch(error){retained.set(runtime,'certified');options.report(error);return false;}};
 async function closeCandidate(runtime:ImageWorkspaceRuntime){
  retained.set(runtime,'unclosed');
  const prepared=await invoke(runtime,{kind:'prepareClose'});
  if(prepared.kind!=='closePrepared')throw Error('候选项目尚未安全关闭，已保留其恢复状态。');
  const closed=await invoke(runtime,{kind:'certifyClose',ticket:prepared.ticket});
  if(closed.kind!=='closed')throw Error('候选项目关闭结果未确认，已保留其恢复状态。');
  await dispose(runtime);
 }
 const authorized=(owner:ImageWorkspaceOwner|undefined)=>{
  if(current?!owner||!sameOwner(current.runtime.open().snapshot.owner,owner):owner!==undefined)throw Error('项目归属已变化，拒绝旧窗口请求。');
 };
 return {
  current:()=>current,
  busy:()=>busy,
  retainedCount:()=>retained.size,
  async recoverRetained(){
   if(busy)throw Error('项目正在切换。');busy=true;
   try{for(const [runtime,state] of retained){
    if(state==='certified'){await dispose(runtime);continue;}
    const recovered=await invoke(runtime,{kind:'recover'});
    if(recovered.kind!=='recovered'&&recovered.kind!=='settled')throw Error('候选项目仍有未解决操作，已保留现场。');
    await closeCandidate(runtime);
   }return retained.size===0;}finally{busy=false;}
  },
  async launch(plan:ImageWorkspaceProjectPlan,owner?:ImageWorkspaceOwner):Promise<ImageWorkspaceBootstrap>{
   if(busy)throw Error('项目正在切换。');authorized(owner);
   if(closingTicket)throw Error('项目正在完成资源释放，不能重新打开或切换。');
   if(current?.root===plan.root)return current.runtime.open();
   if(retained.size)throw Error('仍有未完成的项目资源处理，暂不能切换。');
   busy=true;const previous=current;let ticket:string|undefined,candidate:ImageWorkspaceRuntime|undefined,previousClosed=false;
   try{
    if(previous){const prepared=await invoke(previous.runtime,{kind:'prepareClose'});if(prepared.kind!=='closePrepared')throw Error(prepared.kind==='rejected'?prepared.error.message:'原项目尚未完成暂存。');ticket=prepared.ticket;}
    candidate=await options.open(plan);
    // Validate the candidate before retiring the old project.
    const bootstrap=candidate.open();
    if(previous){const closed=await invoke(previous.runtime,{kind:'certifyClose',ticket:ticket!});if(closed.kind!=='closed')throw Error('原项目尚未确认关闭。');previousClosed=true;}
    current={kind:'native',root:plan.root,runtime:candidate};candidate=undefined;
    options.publish(current);
    if(previous)await dispose(previous.runtime);
    return bootstrap;
   }catch(error){
    if(candidate)try{await closeCandidate(candidate);}catch(cleanup){options.report(cleanup);}
    if(previous&&ticket&&!previousClosed){
     try{const resumed=await invoke(previous.runtime,{kind:'resume',ticket});if(resumed.kind!=='settled'&&resumed.kind!=='recovered')options.report(Error('原项目恢复未确认，输入保持暂停。'));}catch(resume){options.report(resume);}
    }
    throw error;
   }finally{busy=false;}
  },
  async certifyClose(owner:ImageWorkspaceOwner,ticket:string){
   if(busy)throw Error('项目正在切换。');authorized(owner);if(!current)throw Error('没有可关闭项目。');
   if([...retained].some(([runtime,state])=>runtime!==current!.runtime||state!=='certified'))throw Error('仍有未确认关闭的项目资源，不能退出。');
   if(closingTicket&&closingTicket!==ticket)throw Error('关闭凭据已变化。');
   busy=true;
   try{const target=current;
    if(!closingTicket){const result=await invoke(target.runtime,{kind:'certifyClose',ticket});if(result.kind!=='closed')return false;closingTicket=ticket;}
    // A certified Session can no longer resume. Retain its owner until resource
    // release succeeds, and retry release without certifying the Session twice.
    if(!await dispose(target.runtime))return false;
    current=null;closingTicket=undefined;options.publish(null);return true;
   }finally{busy=false;}
  },
 };
}
