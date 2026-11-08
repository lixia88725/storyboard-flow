import {MessageChannelMain,type BrowserWindow,type IpcMain,type IpcMainInvokeEvent,type MessagePortMain} from 'electron';
import type {ImageWorkspaceRuntime,ImageWorkspaceFrameTransport} from '../../project-files/main/image-engine/workspaceRuntimeContract.js';
import type {ImageWorkspaceClientInput,ImageWorkspaceFrameIdentity,ImageWorkspaceFrameReply,ImageWorkspaceInput,ImageWorkspaceOwner,ImageWorkspaceRequest} from '../contracts/imageWorkspace.js';

/** Window ownership is verified for every invoke by the existing entry policy.
 * Runtime remains responsible for owner capabilities and bounded payloads.
 * No file paths, native handles or arbitrary IPC channels cross this Adapter. */
export function registerImageWorkspaceIpc(options:{
 ipc:IpcMain;window:BrowserWindow;caller(event:IpcMainInvokeEvent):void;
 channel?:()=>{port1:MessagePortMain;port2:MessagePortMain};
}){
 let current:ImageWorkspaceRuntime|undefined,unsubscribe:(()=>void)|undefined;
 const ports=new Set<MessagePortMain>(),channels:string[]=[];
 const requireRuntime=(event:IpcMainInvokeEvent)=>{options.caller(event);if(!current)throw Error('请先打开项目。');return current;};
 function route(name:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown){const channel=`flow-image-workspace:${name}`;channels.push(channel);options.ipc.handle(channel,handler);}
 route('bootstrap',event=>requireRuntime(event).open());
 route('request',(event,request:ImageWorkspaceRequest)=>requireRuntime(event).request(request));
 route('input',(event,owner:ImageWorkspaceOwner,input:ImageWorkspaceInput,identity:ImageWorkspaceClientInput)=>requireRuntime(event).input(owner,input,identity));
 route('wait',(event,owner:ImageWorkspaceOwner,id:string)=>requireRuntime(event).waitOperation(owner,id));
 route('thumbnail',(event,owner:ImageWorkspaceOwner,id:string)=>requireRuntime(event).thumbnail(owner,id));
 route('connect',async(event,identity:ImageWorkspaceFrameIdentity)=>{
  const runtime=requireRuntime(event);
  const {port1,port2}=(options.channel??(()=>new MessageChannelMain()))();
  ports.add(port1);
  const transport:ImageWorkspaceFrameTransport={
   send:message=>port1.postMessage(message),
   subscribe(listener){const receive=(event:Electron.MessageEvent)=>listener(event.data as ImageWorkspaceFrameReply);port1.on('message',receive);return()=>{port1.removeListener('message',receive);};},
   onClose(listener){port1.on('close',listener);return()=>{port1.removeListener('close',listener);};},
   close(){ports.delete(port1);port1.close();},
  };
  port1.once('close',()=>ports.delete(port1));port1.start();
  try{
   // Install the runtime listener before transferring the other end. Awaiting a
   // ready ACK before transfer would deadlock the first canvas connection.
   const connected=runtime.connectFrames(identity,transport);
   options.window.webContents.postMessage('flow-image-workspace:port',identity,[port2]);
   await connected;
  }catch(error){transport.close();port2.close();throw error;}
 });
 return{
  bind(runtime:ImageWorkspaceRuntime|null){
   unsubscribe?.();unsubscribe=undefined;
   for(const port of ports)port.close();ports.clear();current=runtime??undefined;
   if(runtime)unsubscribe=runtime.subscribe(event=>{
    if(current!==runtime||options.window.isDestroyed()||options.window.webContents.isDestroyed())return;
    options.window.webContents.send('flow-image-workspace:event',event);
   });
  },
  dispose(){unsubscribe?.();unsubscribe=undefined;current=undefined;for(const port of ports)port.close();ports.clear();for(const channel of channels)options.ipc.removeHandler(channel);},
 };
}
