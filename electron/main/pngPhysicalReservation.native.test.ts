import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave.js';
import { createOriginWorkspaceAccounting } from './originWorkspaceAccounting.js';
import { createRecoveryClaimRecords } from './recoveryClaimRecords.js';
import { serializeStoryboardScriptMarkdown } from './storyboardScript.js';
import { createWorkspacePhysicalWriterGate } from './workspacePhysicalWriterGate.js';
import { writeLayerPng } from './layerAssetService.js';

type Restrictions=ReturnType<NonNullable<Parameters<typeof createRecoveryClaimRecords>[0]['restrictions']>>;

// Actual registered Main gate -> ordinary service -> layer writer -> Python.
// Synthetic caller/window and initial no-output Save callback are fixture ports,
// not GUI, actual TIFF encoding, cold-process or general-path census evidence.
const fixture=async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-reservation-root-')),userData=await fs.mkdtemp(path.join(os.tmpdir(),'png-reservation-data-'));
  const python='python3',budget={bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80};
  const bitmapPath='.storyboard-workbench/layers/s/a.png',file=path.join(root,bitmapPath),metadataPath=path.join(root,'.storyboard-workbench/storyboard.project.json'),imagePath=path.join(root,'s.tiff');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const original=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer(),updated=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer();
  const project={id:'p',name:'physical PNG reservation',shots:[{id:'s',imagePath,fileName:'s.tiff',swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'a',kind:'paint',bitmapPath,width:2,height:2}]}],dialogues:[]};
  const persist=async()=>{await fs.writeFile(metadataPath,JSON.stringify(project,null,2)+'\n',{mode:0o600});await fs.writeFile(path.join(root,'storyboard-script.md'),serializeStoryboardScriptMarkdown(project as any),{mode:0o600});return {};};
  await fs.writeFile(file,original,{mode:0o600});await fs.writeFile(imagePath,await sharp(original).tiff().toBuffer(),{mode:0o600});await persist();
  const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python,script:path.resolve('scripts/recovery-origin-permissions.py'),
    claimRecords:()=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py')}),
    claimWriter:(_root,restrictions:Restrictions)=>createRecoveryClaimRecords({userData:()=>userData,python,script:path.resolve('scripts/recovery-claim-records.py'),restrictions:()=>restrictions})});
  const frame={},event:any={sender:{mainFrame:frame},senderFrame:frame},service=createPreparedWorkspaceSave({accounting,budget,python,script:path.resolve('scripts/recovery-content-permissions.py')});
  const payload={folderPath:root,metadataPath,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  const saved=await service.run(event,payload,async()=>({project,normalSaveOutputs:[]}));await service.persist(event,{...payload,recoverySaveNonce:saved.recoverySaveNonce},persist);await service.acknowledge(event,{folderPath:root,nonce:saved.recoverySaveNonce,project});
  return {root,userData,file,bitmapPath,original,updated,accounting,event,service,budget,metadataPath,imagePath};
};

test('real layers write reserves the existing PNG stage before the native physical effect',async()=>{
  const {root,file,bitmapPath,original,updated,accounting,event,service}=await fixture();
  const before=await fs.stat(file,{bigint:true});let physicalClaims=0;
  const reserve=accounting.reserve;
  accounting.reserve=(r,b,bytes,records,operation,...rest)=>reserve(r,b,bytes,records,async()=>{
    // This tiny PNG has no source attributes: the approved stage floor is
    // at least 32768; a leaked stage also brings its two existing containers
    // and their actual raw attributes into the census. Those directories may
    // have OS-created attributes even though this fixture adds none itself.
    if(bytes>=32768&&records===3){physicalClaims++;expect((await fs.stat(file,{bigint:true})).ino).toBe(before.ino);expect(await fs.readFile(file)).toEqual(original);}
    return operation();
  },...rest);
  const handlers=new Map<string,any>();
  const ipc=createWorkspacePhysicalWriterGate({handle:(channel:string,handler:any)=>{handlers.set(channel,handler);}} as any,{save:service.runIpc,persist:service.persist,ordinary:service.ordinary});
  ipc.handle('layers:writePng',(_event:any,p:any)=>writeLayerPng(p));
  await handlers.get('layers:writePng')(event,{folderPath:root,bitmapPath,dataUrl:'data:image/png;base64,'+updated.toString('base64')});
  expect(physicalClaims).toBe(1);expect(await fs.readFile(file)).toEqual(updated);expect((await fs.stat(file)).mode&0o777).toBe(0o600);
},120000);

test('real layers write refuses a PNG stage before source effects when the joint remaining capacity cannot fund it',async()=>{
  const f=await fixture(),before=await fs.stat(f.file,{bigint:true}),metadata=await fs.readFile(f.metadataPath),tiff=await fs.readFile(f.imagePath),names=(await fs.readdir(path.dirname(f.file))).sort();
  const quote=f.accounting.quote;let limited=false,pngQuoted=false;
  f.accounting.quote=async(root,budget,bytes,records,policy)=>{
    if(!limited){
      // Fix the reduced limit BEFORE the first admission of this ordinary
      // scope. Its before capture plus the two already-tested 32768 control
      // slots fit exactly; their unspent envelope stays held until scope end.
      // No source attributes or missing registry containers in this fixture.
      f.budget.bytes=(await f.accounting(root,budget)).bytes+bytes+2*32768;limited=true;
    }
    if(bytes>=32768&&records===3)pngQuoted=true;
    return quote(root,budget,bytes,records,policy);
  };
  const handlers=new Map<string,any>(),ipc=createWorkspacePhysicalWriterGate({handle:(channel:string,handler:any)=>{handlers.set(channel,handler);}} as any,{save:f.service.runIpc,persist:f.service.persist,ordinary:f.service.ordinary});
  ipc.handle('layers:writePng',(_event:any,p:any)=>writeLayerPng(p));
  await expect(handlers.get('layers:writePng')(f.event,{folderPath:f.root,bitmapPath:f.bitmapPath,dataUrl:'data:image/png;base64,'+f.updated.toString('base64')})).rejects.toThrow(/reservation peak budget/);
  expect(limited).toBe(true);expect(pngQuoted).toBe(true);expect(await fs.readFile(f.file)).toEqual(f.original);expect((await fs.stat(f.file,{bigint:true})).ino).toBe(before.ino);expect((await fs.stat(f.file)).mode&0o777).toBe(0o600);
  expect((await fs.readdir(path.dirname(f.file))).sort()).toEqual(names);expect(await fs.readFile(f.metadataPath)).toEqual(metadata);expect(await fs.readFile(f.imagePath)).toEqual(tiff);
},120000);
