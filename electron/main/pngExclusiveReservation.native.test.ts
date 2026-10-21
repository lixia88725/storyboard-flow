import { expect, test, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createProject } from '../../src/shared/projectOps';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { createOriginWorkspaceAccounting, originWorkspaceKey } from './originWorkspaceAccounting';
import { createRecoveryClaimRecords } from './recoveryClaimRecords';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';
import { createWorkspacePhysicalWriterGate } from './workspacePhysicalWriterGate';
import { registerLayerIpcHandlers } from './ipc/layerHandlers';
import { createLayerAppHandlers } from './layerAppRuntime';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';
import { createLayerPng } from './layerAssetService';
import { withProducerPngEffects, type ProducerPngReceipt } from './producerPngEffects';

// Fault only the original Node FD boundary AFTER real wx. No mocked claim,
// census, source certification, producer, IPC gate or fabricated Native result.
const fault=vi.hoisted(()=>({file:'',mode:''}));
vi.mock('node:fs/promises',async importOriginal=>{
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  const open:typeof actual.open=async(...args)=>{
    const handle=await actual.open(...args);
    if(args[0]!==fault.file||args[1]!=='wx')return handle;
    const write=handle.writeFile.bind(handle),close=handle.close.bind(handle);
    return new Proxy(handle,{get(target,key){
      if(key==='writeFile')return async(data:Buffer)=>{if(fault.mode==='partial'){await write(data.subarray(0,3));throw new Error('fixture partial Node write');}return write(data);};
      if(key==='close')return async()=>{await close();if(fault.mode==='close')throw new Error('fixture close completion unknown');};
      const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;
    }});
  };
  return {...actual,open,default:{...actual.default,open}};
});

test.each([
  {mode:'partial',name:'real Main Add preserves its original claim after Node partial becomes unknown'},
  {mode:'close',name:'real Main Add preserves its original claim after Node close becomes unknown'},
  {mode:'complete',name:'real Main Add completes its resource proof after a complete exclusive creation'},
  {mode:'existing',name:'real Main Add refuses an existing target without poisoning the resource proof'}
])('$name',async({mode})=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-exclusive-unknown-root-')),userData=await fs.mkdtemp(path.join(os.tmpdir(),'png-exclusive-unknown-data-'));
  const python='python3',budget={bytes:16*1024*1024,records:2000,assets:64,jsonDepth:80};
  const bitmapPath='.storyboard-workbench/layers/s/new.png',file=path.join(root,bitmapPath),image=path.join(root,'.storyboard-workbench/layers/s/image.png'),tiff=path.join(root,'s.tiff'),metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),script=path.join(root,'storyboard-script.md');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const png=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();await fs.writeFile(image,png,{mode:0o600});await fs.writeFile(tiff,await sharp(png).tiff().toBuffer(),{mode:0o600});
  const project=createProject('exclusive unknown');project.shots=[{id:'s',fileName:'s.tiff',imagePath:tiff,order:0,swb:{version:1,status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'image',kind:'image',name:'Image',order:0,visible:true,locked:false,opacity:1,blendMode:'normal',width:2,height:2,bitmapPath:'.storyboard-workbench/layers/s/image.png'}]}];
  project.pendingBake={version:1,shots:{s:{state:'synced',acceptedOutputIdentity:createHash('sha256').update(await fs.readFile(tiff)).digest('hex')}}};
  const persist=async()=>{await fs.writeFile(metadata,JSON.stringify(project,null,2)+'\n',{mode:0o600});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project),{mode:0o600});return {};};await persist();
  const configure=()=>createOriginWorkspaceAccounting({userData:()=>userData,python,script:path.resolve('scripts/recovery-origin-permissions.py'),claimRecords:()=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py')}),claimWriter:(_root,restrictions)=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py'),restrictions:()=>restrictions})});
  const accounting=configure(),service=createPreparedWorkspaceSave({accounting,budget,python,script:path.resolve('scripts/recovery-content-permissions.py')});
  const frame={},event:any={sender:{mainFrame:frame},senderFrame:frame};
  const payload={folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  const saved=await service.run(event,payload,async()=>({project,normalSaveOutputs:[]}));await service.persist(event,{...payload,recoverySaveNonce:saved.recoverySaveNonce},persist);await service.acknowledge(event,{folderPath:root,nonce:saved.recoverySaveNonce,project});
  const sources=[metadata,script,tiff,image],original=await Promise.all(sources.map(f=>fs.readFile(f)));
  const native=createNativeAuthorizationSession(python,path.resolve('scripts/recovery-content-permissions.py'),()=>65536),policy=(await native.request({phase:'capturePolicy',sources,sourceByteLimit:budget.bytes})).sourcePolicy;
  const handlers=new Map<string,any>(),ipc=createWorkspacePhysicalWriterGate({handle:(channel:string,handler:any)=>handlers.set(channel,handler)} as any,{save:service.runIpc,persist:service.persist,ordinary:service.ordinary});registerLayerIpcHandlers(ipc,createLayerAppHandlers());
  if(mode==='existing')await fs.writeFile(file,png,{mode:0o600});
  const preexisting=mode==='existing'?await fs.stat(file,{bigint:true}):undefined;
  let result:any,error:unknown;fault.file=file;fault.mode=mode;
  try{result=await handlers.get('layers:createPng')(event,{folderPath:root,bitmapPath,dataUrl:'data:image/png;base64,'+png.toString('base64'),project,shotId:'s',layerId:'new',width:2,height:2});}catch(e){error=e;}finally{fault.file='';fault.mode='';}
  if(mode==='complete'){expect(error).toBeUndefined();expect(result).toMatchObject({ok:true,filePath:file});}
  else if(mode==='existing'){expect(error).toBeUndefined();expect(result).toMatchObject({ok:false,effect:'refused'});expect((await fs.stat(file,{bigint:true})).ino).toBe(preexisting!.ino);}
  else expect(error!==undefined||result?.ok===false).toBe(true);
  expect(await fs.readFile(file)).toEqual(mode==='partial'?png.subarray(0,3):png);const identity=await fs.stat(file,{bigint:true});
  expect(await Promise.all(sources.map(f=>fs.readFile(f)))).toEqual(original);
  const reader=createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py')});
  const rows=await reader.read({workspaceKey:await originWorkspaceKey(root),scopeId:'unknown-probe',claimId:'unknown-probe',plan:{effectPeak:1,claimPeak:65536,closePeak:65536},allowance:budget});
  if(mode==='complete'||mode==='existing'){expect(rows.length).toBeGreaterThan(0);expect(rows.every(row=>row.scopeComplete===true)).toBe(true);return;}
  expect(rows.some(row=>row.scopeComplete!==true)).toBe(true);
  const refuse=async(a:typeof accounting)=>{let effects=0;await expect(a.run(async()=>{const quote=await a.quote(root,budget,32768,1,policy);return a.reserve(root,budget,32768,1,async()=>{effects++;},undefined,quote);})).rejects.toThrow();expect(effects).toBe(0);};
  await refuse(accounting);await fs.truncate(file,0);expect((await fs.stat(file,{bigint:true})).ino).toBe(identity.ino);await refuse(accounting);await refuse(configure());
},120000);

// Actual wx/stat/write/close and original created receipt. Only post-execute
// accounting is a fault port; this does NOT prove an actual OS census failure.
test.each([false,true])('a complete exclusive PNG still delivers created/absence facts after a physical accounting error (undefined=%s)',async undefinedError=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'exclusive-outcome-root-')),bitmapPath='.storyboard-workbench/layers/s/new.png',file=path.join(root,bitmapPath),tiff=path.join(root,'s.tiff');await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const png=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();await fs.writeFile(tiff,await sharp(png).tiff().toBuffer(),{mode:0o600});
  const project=createProject('exclusive outcome');project.shots=[{id:'s',fileName:'s.tiff',imagePath:tiff,order:0,swb:{version:1,status:'owned',canvasWidth:2,canvasHeight:2},layers:[]}];project.pendingBake={version:1,shots:{s:{state:'synced',acceptedOutputIdentity:createHash('sha256').update(await fs.readFile(tiff)).digest('hex')}}};
  let receipt:ProducerPngReceipt|undefined;
  const result=await withProducerPngEffects({beforeWrite:async()=>{},beforeDelete:async()=>{},deleted:async()=>{},written:async value=>{receipt=value;},physicalWrite:async(_request,execute)=>{await execute();throw undefinedError?undefined:new Error('synthetic post-Node accounting error');}},()=>createLayerPng({folderPath:root,bitmapPath,dataUrl:'data:image/png;base64,'+png.toString('base64'),project,shotId:'s',layerId:'new',width:2,height:2}));
  expect(result).toMatchObject({ok:false,effect:'unknown',filePath:file});expect(await fs.readFile(file)).toEqual(png);expect(receipt).toMatchObject({filePath:file,kind:'created',originalAbsence:{project,shotId:'s',layerId:'new'}});expect(receipt?.bytes).toEqual(png);expect((await fs.stat(file)).nlink).toBe(1);
},120000);
