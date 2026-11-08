import type {ImageWorkspaceBridge,ImageWorkspaceFrameIdentity} from '../../../platform/contracts/imageWorkspace';

/** Electron cannot send MessagePort through contextBridge's function proxy.
 * The trusted preload transfers it with window.postMessage instead; ordinary
 * commands remain narrow invoke methods, with no exposed ipcRenderer/Event. */
export function imageWorkspaceBridge():ImageWorkspaceBridge{
 return {...window.flowEditor.imageWorkspace,onFramePort(listener){
  const handler=(event:MessageEvent)=>{
   if(event.source!==window||event.data?.type!=='flow-image-workspace:port')return;
   const identity=event.data.identity as ImageWorkspaceFrameIdentity,port=event.ports[0];
   if(!port||!identity?.owner||typeof identity.nonce!=='string'||!Number.isSafeInteger(identity.streamGeneration)){for(const p of event.ports)p.close();return;}
   listener({...identity,port});
  };
  window.addEventListener('message',handler);return()=>window.removeEventListener('message',handler);
 }};
}
