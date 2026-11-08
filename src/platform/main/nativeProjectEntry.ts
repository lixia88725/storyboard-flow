import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {dialog,type BrowserWindow,type IpcMain,type IpcMainInvokeEvent} from 'electron';
import {createFlowProjectLauncher,isProjectCreationCanceled,type FlowProjectLauncherDeps} from './flowProjectLauncher.js';
import {registerImageWorkspaceWindow} from './imageWorkspaceWindow.js';
import {probeImageWorkspaceProject,inspectImageWorkspaceFolder,LegacyImageWorkspaceProjectError} from '../../project-files/main/image-engine/workspaceProbe.js';
import type {ImageWorkspaceProjectPlan,ImageWorkspaceRuntime} from '../../project-files/main/image-engine/workspaceRuntimeContract.js';
import type {ImageWorkspaceOwner,ImageWorkspaceUpgradeDraft,ImageWorkspaceUpgradePatch} from '../contracts/imageWorkspace.js';
import type {FlowCreateMode,FlowCreatePatch,FlowLaunchResult,FlowOpenChoice,FlowProjectTarget} from '../contracts/flowEditor.js';

/** Native launcher/Window integration. Image creation and writable Runtime are
 * injected file modules; this platform adapter owns only pickers, opaque draft
 * routing and the exact calling window. */
export async function registerNativeProjectEntry(options:{
 ipc:IpcMain;window:BrowserWindow;userData:string;requestedRoot:string;
 caller(event:IpcMainInvokeEvent):void;
 open(plan:ImageWorkspaceProjectPlan):Promise<ImageWorkspaceRuntime>;
 creation:Pick<FlowProjectLauncherDeps<ImageWorkspaceProjectPlan>,'createProject'|'createBlankProject'|'inspectUpgrade'|'copyUpgrade'>;
 report(error:unknown):void;
 onRegistered?(platform:{requestClose():boolean;disposeBridge():void}):void;
}){
 const {ipc,window:win}=options;
 const workspace=registerImageWorkspaceWindow(options);
 const channels:string[]=[],issues=new Map<string,{draftId:string;resolve(decision:'continue'|'cancel'):void}>();
 let pendingOpen:string|undefined,initialUpgrade:ImageWorkspaceUpgradeDraft|undefined,activeLaunch:Promise<FlowLaunchResult>|undefined,wantClose=false,initializing=true,rendererReady=false,initialIssue:string|undefined;
 const send=(channel:string,payload:unknown)=>{if(!win.isDestroyed()&&!win.webContents.isDestroyed())win.webContents.send(channel,payload);};
 const settleIssues=(draftId?:string)=>{for(const [id,pending] of issues)if(draftId===undefined||pending.draftId===draftId){issues.delete(id);pending.resolve('cancel');}};
 const launcher=createFlowProjectLauncher<ImageWorkspaceProjectPlan>({
  userData:options.userData,prepare:probeImageWorkspaceProject,describe:plan=>plan.identity,...options.creation,
  onProgress:(draftId,progress)=>send('flow-editor:create-progress',{draftId,...progress}),
  decideIssues:(draftId,items)=>new Promise(resolve=>{
   if(win.isDestroyed()){resolve('cancel');return;}
   const requestId=randomUUID();issues.set(requestId,{draftId,resolve});
   const labels=items.map(item=>path.basename(item.file)),duplicates=new Set(labels.filter((label,i)=>labels.indexOf(label)!==i));
   send('flow-editor:create-issues',{requestId,draftId,issues:items.map(item=>({...item,file:duplicates.has(path.basename(item.file))?`${path.basename(path.dirname(item.file))}/${path.basename(item.file)}`:path.basename(item.file)}))});
  })
 });
 const route=(name:string,handler:(event:IpcMainInvokeEvent,...args:any[])=>unknown)=>{
  const channel='flow-editor:'+name;channels.push(channel);
  ipc.handle(channel,(event,...args)=>{options.caller(event);return handler(event,...args);});
 };
 const pickFolder=async(title:string,create=false)=>{
  const chosen=await dialog.showOpenDialog(win,{title,buttonLabel:'选择',properties:create?['openDirectory','createDirectory']:['openDirectory']});
  return chosen.canceled||!chosen.filePaths[0]?null:fs.realpath(chosen.filePaths[0]);
 };
 const inspect=async(root:string)=>{
  const result=await inspectImageWorkspaceFolder(root);
  if(result.kind==='damaged')throw Error('这个项目的数据不完整。已停止打开并保留原文件，请先核对或恢复项目。');
  return result;
 };
 const chooseOpen=async():Promise<FlowOpenChoice>=>{
  const root=await pickFolder('打开项目或图片文件夹');if(!root)return{canceled:true};
  const result=await inspect(root);
  if(result.kind==='native'){pendingOpen=root;return{kind:'project'};}
  if(result.kind==='legacy')return{kind:'copy-upgrade',draft:await launcher.upgradeDraft(root)};
  if(result.kind==='images')return{kind:'import',draft:launcher.draftFromFolder(root,result.entry)};
  throw Error('这个文件夹里没有可导入的图片，也不是可用的 Storyboard Flow 项目。');
 };
 const resolveTarget=async(target:FlowProjectTarget):Promise<ImageWorkspaceProjectPlan|ImageWorkspaceUpgradeDraft|null>=>{
  if(!target||typeof target!=='object')throw Error('项目选择无效。');
  if(target.kind==='pending'){const root=pendingOpen;pendingOpen=undefined;return root?launcher.openRoot(root):null;}
  if(target.kind==='create'&&typeof target.draftId==='string')return launcher.createAndPrepare(target.draftId);
  if(target.kind==='upgrade'&&typeof target.draftId==='string')return launcher.createAndPrepareUpgrade(target.draftId);
  if(target.kind==='recent'&&typeof target.id==='string'){
   const record=await launcher.recentProject(target.id);if(!record)throw Error('这条最近项目记录已不存在。');
   try{return await launcher.openRecent(target.id);}catch(error){
    if(!(error instanceof LegacyImageWorkspaceProjectError))throw error;
    if(!options.creation.inspectUpgrade)throw Error('当前版本尚未准备好旧项目副本升级。');
    const identity=await options.creation.inspectUpgrade(error.root);
    if(identity.projectId!==record.projectId)throw Error('这个位置的项目与最近记录不一致，请重新选择项目。');
    return launcher.upgradeDraft(error.root);
   }
  }
  throw Error('项目选择无效。');
 };
 route('launcher-state',async()=>{
  const current=workspace.current();return{...await launcher.state(),engine:'native' as const,retainedProjects:workspace.retainedCount(),initialIssue,open:!!current,currentId:current?await launcher.idFor(current.root):null,...(initialUpgrade?{upgradeDraft:initialUpgrade}:{})};
 });
 route('launch',async(_event,target:FlowProjectTarget,owner?:ImageWorkspaceOwner):Promise<FlowLaunchResult>=>{
  if(activeLaunch||workspace.busy())throw Error('项目正在打开，请稍候。');
  const existing=workspace.current()?.runtime.open().snapshot.owner;
  if(existing? !owner||owner.sessionId!==existing.sessionId||owner.incarnation!==existing.incarnation||owner.workspaceEpoch!==existing.workspaceEpoch : owner!==undefined)throw Error('项目归属已变化，拒绝旧窗口请求。');
  const work=(async():Promise<FlowLaunchResult>=>{
   let next:Awaited<ReturnType<typeof resolveTarget>>;
   try{next=await resolveTarget(target);}catch(error){if(isProjectCreationCanceled(error))return{canceled:true};throw error;}
   if(!next)return{canceled:true};
   if(next.kind==='copy-upgrade')return{canceled:false,kind:'copy-upgrade',draft:next};
   const previous=workspace.current(),previousName=previous?.runtime.open().snapshot.session.project.name;
   const bootstrap=await workspace.launch(next,owner);
   if(previous&&previousName)await launcher.updateName(previous.root,previousName).catch(options.report);
   initialUpgrade=undefined;return{canceled:false,kind:'native',bootstrap};
  })();activeLaunch=work;
  try{return await work;}finally{if(activeLaunch===work)activeLaunch=undefined;if(wantClose){wantClose=false;setImmediate(()=>{if(!win.isDestroyed())win.close();});}}
 });
 route('native-window-ready',()=>{rendererReady=true;if(wantClose){wantClose=false;setImmediate(()=>{if(!win.isDestroyed())win.close();});}});
 route('recover-native-projects',async()=>{
  if(activeLaunch||initializing)throw Error('项目正在打开，请稍候。');
  const ok=await workspace.recoverRetained();return{ok,remaining:workspace.retainedCount()};
 });
 route('choose-open',chooseOpen);
 route('remove-recent',(_event,id:string)=>launcher.forget(id));
 route('relocate-recent',async(_event,id:string)=>{
  const record=await launcher.recentProject(id);if(!record)return{ok:false,message:'这条最近项目记录已不存在。'};
  const root=await pickFolder('重新定位最近项目');if(!root)return{canceled:true};
  const result=await inspect(root);
  const identity=result.kind==='native'?result.plan.identity:result.kind==='legacy'&&options.creation.inspectUpgrade?await options.creation.inspectUpgrade(root).then(v=>({id:v.projectId,name:v.projectName})):null;
  if(!identity||identity.id!==record.projectId)return{ok:false,message:'所选文件夹与最近记录中的项目不一致。'};
  await launcher.relocate(id,root,identity.id,identity.name);return{ok:true};
 });
 route('update-recent-name',async(_event,token:string,name:string)=>{
  const current=workspace.current();if(!current||current.runtime.open().snapshot.owner.sessionId!==token)throw Error('项目归属已变化。');
  // Main's project name is authoritative, not a renderer-supplied replacement.
  const actual=current.runtime.open().snapshot.session.project.name;if(name!==actual)throw Error('项目名称尚未确认。');await launcher.updateName(current.root,actual);
 });
 route('create-draft',(_event,mode:FlowCreateMode)=>{if(mode!=='blank'&&mode!=='images')throw Error('创建方式无效。');return launcher.begin(mode);});
 route('create-choose-source',async(_event,id:string,kind:'files'|'folder')=>{
  launcher.view(id);
  if(kind==='folder'){const root=await pickFolder('选择图片来源文件夹');return root?launcher.setSource(id,{kind:'folder',folder:root}):{canceled:true};}
  if(kind!=='files')throw Error('图片来源无效。');
  const selected=await dialog.showOpenDialog(win,{title:'选择故事板图片',properties:['openFile','multiSelections'],filters:[{name:'图片',extensions:['png','jpg','jpeg','tif','tiff','psd']}]});
  return selected.canceled?{canceled:true}:launcher.setSource(id,{kind:'files',files:await Promise.all(selected.filePaths.map(file=>fs.realpath(file)))});
 });
 route('create-choose-destination',async(_event,id:string)=>{launcher.view(id);const root=await pickFolder('选择项目保存位置',true);return root?launcher.setDestination(id,root):{canceled:true};});
 route('create-update',(_event,id:string,patch:FlowCreatePatch)=>launcher.update(id,patch));
 route('create-abort',(_event,id:string)=>{launcher.abort(id);settleIssues(id);});
 route('create-discard',async(_event,id:string)=>{settleIssues(id);await launcher.discard(id);});
 route('create-issues-response',(_event,id:string,decision:'continue'|'cancel')=>{
  if(decision!=='continue'&&decision!=='cancel')throw Error('处理方式无效。');const pending=issues.get(id);if(!pending)return false;issues.delete(id);pending.resolve(decision);return true;
 });
 route('upgrade-choose-destination',async(_event,id:string)=>{launcher.upgradeView(id);const root=await pickFolder('选择新版副本的保存位置',true);return root?launcher.setUpgradeDestination(id,root):null;});
 route('upgrade-update',(_event,id:string,patch:ImageWorkspaceUpgradePatch)=>launcher.updateUpgrade(id,patch));
 route('upgrade-discard',async(_event,id:string)=>{await launcher.discardUpgrade(id);if(initialUpgrade?.id===id)initialUpgrade=undefined;});
 const requestClose=()=>{
  if(activeLaunch||initializing||!rendererReady){wantClose=true;launcher.abortAll();settleIssues();return true;}
  return workspace.requestClose();
 };
 const platform={workspace,launcher,requestClose,disposeBridge(){settleIssues();workspace.disposeBridge();for(const channel of channels)ipc.removeHandler(channel);}};
 options.onRegistered?.(platform);
 // A CLI old project gets the same explicit copy sheet as the folder picker.
 try{if(options.requestedRoot!=='--choose'){
  const root=await fs.realpath(options.requestedRoot),result=await inspect(root);
  if(result.kind==='native')await workspace.launch(await launcher.openRoot(root));
  else if(result.kind==='legacy')initialUpgrade=await launcher.upgradeDraft(root);
  else throw Error('启动路径不是可用的 Storyboard Flow 项目，请从打开窗口选择图片文件夹。');
 }}catch(error){initialIssue=error instanceof Error?error.message:String(error);options.report(error);}
 finally{initializing=false;}
 return {...platform,consumeInitialClose(){const value=wantClose;wantClose=false;return value;}};
}
