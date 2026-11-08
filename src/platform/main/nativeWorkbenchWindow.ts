import {app,dialog,session,shell,type BrowserWindow,type IpcMain} from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {registerNativeProjectEntry} from './nativeProjectEntry.js';
import {createImageWorkspaceCreation} from '../../project-files/main/image-engine/workspaceCreation.js';
import {createWorkspaceRecoveryBudget} from '../../project-files/main/image-engine/workspaceBudget.js';
import {nativeComponentPaths} from './photocraftPackage.js';
import {probeImageWorkspaceProject} from '../../project-files/main/image-engine/workspaceProbe.js';
import type {ImageWorkspaceRuntime,ImageWorkspaceRuntimeOptions} from '../../project-files/main/image-engine/workspaceRuntimeContract.js';

/** Private integration entry until native resources and the complete product
 * matrix are certified. The default entry must not silently fall back between
 * image authorities. Binaries are explicit Main launch configuration, never IPC. */
export async function openNativeWorkbenchWindow(options:{window:BrowserWindow;ipc:IpcMain;repo:string;userData:string;requestedRoot:string}){
 const {window:win,ipc,repo}=options;
 let platformEarly:{requestClose():boolean;disposeBridge():void}|undefined,initializing=true,wantClose=false;
 win.on('close',event=>{if(initializing){wantClose=true;event.preventDefault();}else if(platformEarly?.requestClose())event.preventDefault();});
 win.once('closed',()=>platformEarly?.disposeBridge());
 try{
 const prepared=process.env.FLOW_IMAGE_HOST&&process.env.FLOW_PROJECT_LEASE_BINARY?undefined:nativeComponentPaths({repoRoot:repo,resourcesPath:process.resourcesPath,packaged:app.isPackaged});
 const binary=process.env.FLOW_IMAGE_HOST??prepared?.host,leaseBinary=process.env.FLOW_PROJECT_LEASE_BINARY??prepared?.lease;
 for(const file of [binary,leaseBinary]){
  if(!file||!path.isAbsolute(file)||path.normalize(file)!==file)throw Error('新版图片引擎尚未准备好，请先准备已验证的原生组件。');
  const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||await fs.realpath(file)!==file)throw Error('原生组件位置无效。');
 }
 const entry=path.join(repo,'dist/index.html'),hash='flow-workbench';
 const dev=!app.isPackaged&&process.env.VITE_DEV_SERVER_URL?new URL(process.env.VITE_DEV_SERVER_URL):null;
 if(dev&&(dev.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(dev.hostname)))throw Error('Development server must be local HTTP');
 if(dev)dev.hash=hash;
 const documentUrl=dev?dev.href:pathToFileURL(entry).href+'#'+hash;
 const caller=(event:Electron.IpcMainInvokeEvent)=>{
  if(event.sender!==win.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==documentUrl)throw Error('Current editor document required');
 };
 let epoch=0;
 const creation=createImageWorkspaceCreation({leaseBinary:leaseBinary!,budgetFactory:createWorkspaceRecoveryBudget,
  prepare:async({root,projectId})=>{const plan=await probeImageWorkspaceProject(root);if(plan.identity.id!==projectId)throw Error('新项目身份未确认，已保留创建现场。');}});
 // The implementation is independently owned; absence fails before opening a
 // project, rather than routing a native root through the legacy image writer.
 const specifier='../../project-files/main/image-engine/workspaceRuntime.js';
 const runtimeModule=await import(specifier) as {openImageWorkspaceRuntime?:(input:ImageWorkspaceRuntimeOptions)=>Promise<ImageWorkspaceRuntime>};
 if(typeof runtimeModule.openImageWorkspaceRuntime!=='function')throw Error('新版工作台运行组件尚未准备好。');
 const platform=await registerNativeProjectEntry({ipc,window:win,userData:options.userData,requestedRoot:options.requestedRoot,caller,creation:{
  createProject:creation.createImageProject,createBlankProject:creation.createBlankProject,inspectUpgrade:creation.inspectUpgrade,copyUpgrade:creation.copyUpgrade
 },onRegistered:platform=>{platformEarly=platform;},report:error=>console.error('[native-workspace]',error),open:plan=>runtimeModule.openImageWorkspaceRuntime!({
  root:plan.root,binary:binary!,leaseBinary:leaseBinary!,workspaceEpoch:++epoch,projectRootLabel:path.basename(plan.root),permissions:{
   async chooseImages(mode){
    if(mode==='folder'){
     const picked=await dialog.showOpenDialog(win,{title:'添加图片到 Pending',buttonLabel:'选择',properties:['openDirectory']});
     return picked.canceled||!picked.filePaths[0]?null:{kind:'folder',folder:await fs.realpath(picked.filePaths[0])};
    }
    const picked=await dialog.showOpenDialog(win,{title:'添加图片到 Pending',buttonLabel:'选择',properties:['openFile','multiSelections'],filters:[{name:'图片',extensions:['png','jpg','jpeg','tif','tiff','psd']}]});
    return picked.canceled?null:{kind:'files',files:await Promise.all(picked.filePaths.map(file=>fs.realpath(file)))};
   },
   async chooseExportTarget(input){
    const extension=input.format==='psd'?'psd':'tif';
    const picked=await dialog.showSaveDialog(win,{title:input.format==='psd'?'另存为 PSD…':'另存为 TIFF…',defaultPath:path.basename(input.suggestedName),filters:[{name:extension.toUpperCase(),extensions:[extension]}]});
    return picked.canceled||!picked.filePath?null:picked.filePath;
   },
   trashItem:file=>shell.trashItem(file),
   async chooseRecoveryInputTarget(input){
    const picked=await dialog.showSaveDialog(win,{title:'导出未确认输入副本',defaultPath:path.basename(input.suggestedName),filters:[{name:'输入记录',extensions:['json']}]});
    return picked.canceled||!picked.filePath?null:picked.filePath;
   }
  }
 })});

 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 win.webContents.on('will-navigate',event=>event.preventDefault());
 win.webContents.on('will-prevent-unload',()=>{});
 session.defaultSession.setPermissionRequestHandler((_w,_p,callback)=>callback(false));
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']},(details,callback)=>{
  const url=new URL(details.url),local=dev&&url.host===dev.host&&(url.protocol==='http:'||url.protocol==='ws:');callback({cancel:!local});
 });
 if(dev)await win.loadURL(documentUrl);else await win.loadFile(entry,{hash});
 initializing=false;
 if(wantClose||platform.consumeInitialClose())setImmediate(()=>{if(!win.isDestroyed())win.close();});
 return platform;
 }finally{initializing=false;if(wantClose)setImmediate(()=>{if(!win.isDestroyed())win.close();});}
}
