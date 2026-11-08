import {randomUUID} from 'node:crypto';
import type {BrowserWindow,IpcMain,IpcMainInvokeEvent} from 'electron';
import type {ImageWorkspaceOwner} from '../contracts/imageWorkspace.js';
import type {ImageWorkspaceProjectPlan,ImageWorkspaceRuntime} from '../../project-files/main/image-engine/workspaceRuntimeContract.js';
import {registerImageWorkspaceIpc} from './imageWorkspaceIpc.js';
import {createImageWorkspaceLifecycle} from './imageWorkspaceLifecycle.js';

/** Window ownership, transport binding and certified close share one lifecycle.
 * The launcher supplies inspected plans; this adapter never interprets images,
 * installs project state, or turns a window close into an implicit Save. */
export function registerImageWorkspaceWindow(options:{
 ipc:IpcMain;window:BrowserWindow;caller(event:IpcMainInvokeEvent):void;
 open(plan:ImageWorkspaceProjectPlan):Promise<ImageWorkspaceRuntime>;
 report(error:unknown):void;
 defer?:(task:()=>void)=>void;
}){
 const bridge=registerImageWorkspaceIpc(options);
 const lifecycle=createImageWorkspaceLifecycle({open:options.open,publish:target=>bridge.bind(target?.runtime??null),report:options.report});
 let closeId:string|undefined,finishing=false,disposed=false;
 const finishChannel='flow-editor:finish-native-close';
 options.ipc.handle(finishChannel,async(event,owner:ImageWorkspaceOwner,id:string,ticket:string)=>{
  options.caller(event);
  if(disposed||!closeId||id!==closeId||finishing||typeof ticket!=='string'||!ticket)
   return{ok:false,message:'关闭请求已过期，请重新关闭窗口。'};
  finishing=true;
  try{
   const accepted=await lifecycle.certifyClose(owner,ticket);
   if(!accepted){closeId=undefined;return{ok:false,message:'项目尚未完成关闭，画稿和恢复记录已保留。'};}
   (options.defer??(task=>{setImmediate(task);}))(()=>{if(!options.window.isDestroyed())options.window.destroy();});
   return{ok:true};
  }catch(error){
   options.report(error);closeId=undefined;
   return{ok:false,message:'项目尚未完成关闭，画稿和恢复记录已保留。'};
  }finally{finishing=false;}
 });
 return{
  current:lifecycle.current,busy:lifecycle.busy,retainedCount:lifecycle.retainedCount,
  launch:lifecycle.launch,recoverRetained:lifecycle.recoverRetained,
  /** Return true when Entry must prevent the native close event. Empty launcher
   * creation/chooser obligations remain the launcher's responsibility. */
  requestClose(){
   if(disposed)return false;
   if(lifecycle.busy()||lifecycle.retainedCount()&&!lifecycle.current())return true;
   if(!lifecycle.current())return false;
   // A renderer may refuse before obtaining a close ticket (active pen/IME).
   // Another user close must be able to ask again with the same owned request.
   closeId??=randomUUID();options.window.webContents.send('flow-editor:close',closeId);
   return true;
  },
  disposeBridge(){
   if(disposed)return;disposed=true;bridge.dispose();options.ipc.removeHandler(finishChannel);
   if(lifecycle.current()||lifecycle.retainedCount())options.report(Error('窗口已退出，但项目关闭尚未认证；保留恢复义务。'));
  },
 };
}
