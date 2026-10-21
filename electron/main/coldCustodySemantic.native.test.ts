import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {createLayerPng,writeLayerPng,deleteLayerPng} from './layerAssetService';
import {serializeStoryboardScriptMarkdown} from './storyboardScript';
import {createWorkspaceRecoveryStore} from './workspaceRecoveryStore';
import {createNativeAuthorizationSession} from './nativeAuthorizationSession';
import {withProducerPngEffects} from './producerPngEffects';
import {writeProtectedLayerFile} from './protectedLayerFileWriter';

// Approved seam: actual Main/native producer, sealed native store, then fresh
// Main/document cold open. Synthetic source data only; no renderer substitution
// claims. Corrupt semantic offers are sealed by the real store, not mocked reads.
const options={budget:{bytes:8388608,records:5000,assets:128,jsonDepth:80},python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')};
const event=()=>{const frame={};return {sender:{mainFrame:frame},senderFrame:frame} as any;};
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const content=(p:any)=>({projectRaw:p,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}});
async function fixture(deleted=false){
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'cold-custody-semantic-'));
 const png=path.join(folder,'.storyboard-workbench/layers/s/base.png'),tiff=path.join(folder,'a.tiff'),metadata=path.join(folder,'.storyboard-workbench/storyboard.project.json'),md=path.join(folder,'storyboard-script.md');
 await fs.mkdir(path.dirname(png),{recursive:true,mode:0o700});
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer(),base=await sharp(bytes).tiff().toBuffer();
 await fs.writeFile(png,bytes,{mode:0o600});await fs.writeFile(tiff,base,{mode:0o600});
 const project:any={id:'p',name:'custody',shots:[{id:'s',imagePath:tiff,fileName:'a.tiff',order:0,swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'base',kind:'paint',width:2,height:2,bitmapPath:path.relative(folder,png)}]}],dialogues:[],pendingBake:{version:1,shots:{s:{state:'synced',acceptedOutputIdentity:hash(base)}}}};
 const write=async(p:any)=>{await fs.writeFile(metadata,`${JSON.stringify(p,null,2)}\n`,{mode:0o600});await fs.writeFile(md,serializeStoryboardScriptMarkdown(p),{mode:0o600});return {};};await write(project);
 const e=event(),service=createPreparedWorkspaceSave(options),payload={folderPath:folder,metadataPath:metadata,normalSave:true,project,recoveryContent:content(project)};
 const output=await service.run(e,payload,async()=>({project,normalSaveOutputs:[]}));await service.persist(e,{...payload,recoverySaveNonce:output.recoverySaveNonce},()=>write(project));expect(await service.acknowledge(e,{folderPath:folder,nonce:output.recoverySaveNonce,project})).toBe(true);
 const bitmapPath='.storyboard-workbench/layers/s/added.png',target=path.join(folder,bitmapPath),dataUrl='data:image/png;base64,'+bytes.toString('base64');
 const added={...project,shots:[{...project.shots[0],layers:[...project.shots[0].layers,{id:'added',kind:'paint',width:2,height:2,bitmapPath}]}]};
 const ack=async(p:any)=>{const payload={folderPath:folder,metadataPath:metadata,project:p};const result=await service.ordinary(e,'workspace:autosave',payload,[metadata,md],()=>write(p));expect(await service.acknowledge(e,{folderPath:folder,nonce:result.ordinaryPersistenceNonce,project:p})).toBe(true);};
 expect((await service.ordinary(e,'layers:createPng',{},[target],()=>createLayerPng({folderPath:folder,bitmapPath,project,shotId:'s',layerId:'added',width:2,height:2,dataUrl}))).ok).toBe(true);await ack(added);
 let current=added;
 if(deleted){await service.ordinary(e,'layers:deletePng',{},[target],()=>deleteLayerPng({folderPath:folder,bitmapPath}));await ack(project);current=project;}
 const history={undo:[{project:added,selectedShotIds:['s'],fileNameSyncState:'synced',layerAssets:[{bitmapPath,dataUrl}]}],redo:[{project,selectedShotIds:['s'],fileNameSyncState:'synced',layerAssets:deleted?[{bitmapPath}]:[]}]};
 const capture={folderPath:folder,content:content(current),history,canvas:{captures:[],hasUnsettledGesture:false},selectedShotIds:['s'],dirtyShotIds:[],workspaceSaveState:'saved',fileNameSyncState:'synced'};
 expect(await service.certifyRetainedSet(e,{slots:[capture]})).toBe(true);
 const coldOpen=async()=>{const cold=createPreparedWorkspaceSave(options),reader=event(),binding=await cold.observeWorkspace(reader,folder);const result=await cold.ordinary(reader,'workspace:openFolderByPath',{},[folder],async()=>({project:current}));return {cold,reader,binding,result};};
 const reseal=async(mutate:(c:any)=>void)=>{
  const policy=JSON.parse(await fs.readFile(path.join(folder,'.storyboard-workbench/workspace-recovery-v1/namespace.json'),'utf8')).sourcePolicy;
  const native=createNativeAuthorizationSession(options.python,options.script,()=>options.budget.bytes);
  await native.run(async()=>{
   const store=createWorkspaceRecoveryStore({budget:options.budget,sourcePolicy:policy,authorize:async request=>{await native.request({...request,sourcePolicy:policy,sourceByteLimit:options.budget.bytes});}});
   const state=await store.inspectReadonly(folder);expect(state.state).toBe('protectedReadable');const c:any=structuredClone(state.content),assets=await store.readAssets(folder,state.ack!.generationId);
   mutate(c);const offer:any={revision:'semantic-negative',projectRaw:c.projectRaw,viewState:c.viewState,scriptState:c.scriptState,effectFacts:c.effectFacts,continuationState:c.continuationState,assets:c.assets.map((a:any)=>({...a,bytes:assets.get(a.assetId)})),requiredAssetIds:c.requiredAssetIds};
   await store.retain({sender:{},frame:{},window:{},document:{}},folder,offer);expect((await store.inspectReadonly(folder)).state).toBe('protectedReadable');
  });
 };
 return {folder,target,bitmapPath,bytes,dataUrl,project,added,current,history,capture,coldOpen,reseal,ack,service,e};
}

test('cold editable History rejects recreated deleted custody even outside current Project and History presence',async()=>{
 const f=await fixture(true);await fs.writeFile(f.target,f.bytes,{mode:0o600});
 await expect(f.coldOpen()).rejects.toThrow(/deleted|custody/i);
},120000);

test('cold genuine deleted custody adopts a fresh document, closes unchanged and restores exact Redo PNG with its own ACK',async()=>{
 const f=await fixture(true),opened=await f.coldOpen();expect(opened.result.recoveryHistory).toEqual(f.history);
 expect(await opened.cold.certifyRetainedSet(opened.reader,{slots:[{...f.capture,binding:opened.binding.binding}]})).toBe(true);
 await opened.cold.ordinary(opened.reader,'layers:writePng',{},[f.target],()=>writeLayerPng({folderPath:f.folder,bitmapPath:f.bitmapPath,dataUrl:f.dataUrl}));
 const metadata=path.join(f.folder,'.storyboard-workbench/storyboard.project.json'),md=path.join(f.folder,'storyboard-script.md');
 const persisted=await opened.cold.ordinary(opened.reader,'workspace:autosave',{folderPath:f.folder,metadataPath:metadata,project:f.added},[metadata,md],async()=>{await fs.writeFile(metadata,`${JSON.stringify(f.added,null,2)}\n`);await fs.writeFile(md,serializeStoryboardScriptMarkdown(f.added));return {};});
 await expect(opened.cold.acknowledge(opened.reader,{folderPath:f.folder,nonce:'old-ACK',project:f.added})).rejects.toThrow('ACK');
 expect(await opened.cold.acknowledge(opened.reader,{folderPath:f.folder,nonce:persisted.ordinaryPersistenceNonce,project:f.added})).toBe(true);
 expect(await fs.readFile(f.target)).toEqual(f.bytes);
},120000);

test.each([false,true])('settled renderer reload freshly authenticates custody instead of inheriting the old cache; changed=%s',async changed=>{
 const f=await fixture();
 f.service.invalidateDocument(f.e.sender);
 const binding=await f.service.observeWorkspace(f.e,f.folder);
 if(changed)await fs.writeFile(f.target,await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer());
 const opening=f.service.ordinary(f.e,'workspace:openFolderByPath',{},[f.folder],async()=>({project:f.current}));
 if(changed)await expect(opening).rejects.toThrow(/custody|physical version/i);
 else {const opened=await opening;expect(opened.recoveryHistory).toEqual(f.history);expect(binding.folderPath).toBe(f.folder);}
},120000);

async function cleanupFault<T>(run:()=>Promise<T>):Promise<T>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'native-cleanup-fault-')),shim=path.join(dir,'python-shim');
 // Runs the candidate native writer, faulting only its final owned-staging unlink.
 // Native metadata inspection and actual link/bytes publication are not mocked.
 await fs.writeFile(shim,`#!/usr/bin/env python3\nimport sys,importlib.util,json,base64,os\nspec=importlib.util.spec_from_file_location('writer',sys.argv[3]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\noriginal=m.os.unlink\ndef fault(p,*a,**k):\n if os.path.basename(p).startswith('.layer-staging-'): raise PermissionError('custody fixture final unlink denied')\n return original(p,*a,**k)\nm.os.unlink=fault\nr=json.load(sys.stdin)\nprint(json.dumps(m.protected_write(r['root'],r['filePath'],base64.b64decode(r['bytes']),r['mode'])))\n`,{mode:0o700});
 const old=process.env.SWB_PYTHON_BIN;process.env.SWB_PYTHON_BIN=shim;
 try{return await run();}finally{if(old===undefined)delete process.env.SWB_PYTHON_BIN;else process.env.SWB_PYTHON_BIN=old;}
}

test('actual native committed cleanup failure reaches private receipt before throwing and preserves retention error too',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-committed-receipt-')),target=path.join(root,'.storyboard-workbench/layers/s/new.png');await fs.mkdir(path.dirname(target),{recursive:true});
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer(),receipts:any[]=[],retentionError=new Error('fixture retention also failed');
 const failure=await cleanupFault(()=>withProducerPngEffects({beforeWrite:async()=>{},beforeDelete:async()=>{},deleted:async()=>{},written:async r=>{receipts.push(r);throw retentionError;}},()=>writeProtectedLayerFile(root,target,bytes))).catch(e=>e);
 expect(receipts).toHaveLength(1);expect(receipts[0].bytes).toEqual(bytes);expect(receipts[0].commitFailure).toMatchObject({effect:'committed',warnings:['committed temporary cleanup: custody fixture final unlink denied']});
 expect(failure).toMatchObject({effect:'committed',filePath:target,receiptError:retentionError});expect(failure.message).toContain('cleanup');
 expect(await fs.readFile(target)).toEqual(bytes);expect(await fs.readFile(failure.retainedTemporary)).toEqual(bytes);expect((await fs.stat(target)).nlink).toBe(2);
},120000);

test('Main retains accurate new B and native cleanup residue without authenticating hardlinks or false ACK; cold readonly preserves facts',async()=>{
 const f=await fixture(true),blue=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer(),url='data:image/png;base64,'+blue.toString('base64');
 const failure=await cleanupFault(()=>f.service.ordinary(f.e,'layers:writePng',{},[f.target],()=>writeLayerPng({folderPath:f.folder,bitmapPath:f.bitmapPath,dataUrl:url}))).catch(e=>e);
 expect(failure).toMatchObject({effect:'committed',filePath:f.target});
 const cold=await createPreparedWorkspaceSave(options).readReadonly(f.folder),facts:any=(cold.effectFacts as any).producerCommitFailure;
 expect(facts).toMatchObject({effect:'committed',file:f.bitmapPath,digest:hash(blue),retainedTemporary:failure.retainedTemporary,nativeCertification:'refused'});
 expect(facts.version).toMatch(/^[a-f0-9-]{36}$/);expect(facts.identity).toBe(`${(await fs.stat(f.target)).dev}:${(await fs.stat(f.target)).ino}`);
 expect(cold.assets.find(a=>a.role===`failed-custody/${facts.version}`)?.sourceDataUrl).toBe(url);
 expect(await fs.readFile(f.target)).toEqual(blue);expect(await fs.readFile(failure.retainedTemporary)).toEqual(blue);
 await expect(f.coldOpen()).rejects.toThrow(/custody|commit|inventory/i);
 await fs.writeFile(path.join(os.tmpdir(),'F4-OBSERVED.json'),JSON.stringify({folder:f.folder,target:f.target,retainedTemporary:failure.retainedTemporary,expectedDataUrl:url,facts},null,2));
},120000);

test('8 GiB storage quota cannot become an unbounded native policy response or request transport',async()=>{
 const folder=await fs.mkdtemp(path.join(os.tmpdir(),'native-transport-cap-')),script=path.join(folder,'adapter.py');
 await fs.writeFile(script,`def authorize(request):\n return {'authorized': True, 'policy': 'x' * (16 * 1024 * 1024 + 1)}\n`);
 const native=createNativeAuthorizationSession(options.python,script,()=>8589934592);
 await expect(native.run(()=>native.request({phase:'test'}))).rejects.toThrow('Native response budget');
 const accepted=path.join(folder,'accepted.json');
 await fs.writeFile(script,`import json\ndef authorize(request):\n with open(${JSON.stringify(accepted)},'w') as f: json.dump(request,f)\n return {'authorized': True}\n`);
 await expect(native.run(()=>native.request({policy:'x'.repeat(16*1024*1024+1)}))).rejects.toThrow('Native request budget');
 await expect(fs.stat(accepted)).rejects.toMatchObject({code:'ENOENT'});
},120000);

test('cold History cannot omit custody records while sealed custody assets and producer History remain',async()=>{
 const f=await fixture(true);await f.reseal(c=>{delete c.scriptState.producerCustody;});await expect(f.coldOpen()).rejects.toThrow(/custody/i);
},120000);

for(const [name,mutate] of [
 ['unknown receipt field',(r:any)=>{r.records[0].unknown=true;}],
 ['unknown version',(r:any)=>{r.records[0].version='unknown';r.current[r.records[0].file].version='unknown';}],
 ['missing current map',(r:any)=>{r.current={};}],
 ['native observed path mismatch',(r:any)=>{r.records[0].sourcePolicy.observed[0][0]='/wrong.png';}],
 ['native observed identity mismatch',(r:any)=>{r.records[0].sourcePolicy.observed[0][1].ino+=1;}],
 ['native observed restrictions mismatch',(r:any)=>{r.records[0].sourcePolicy.observed[0][1].mode=0o400;}],
 ['native observed length mismatch',(r:any)=>{r.records[0].sourcePolicy.observed[0][1].size+=1;}],
 ['historical origin project mismatch',(r:any)=>{r.records[0].originalAbsence.project.id='another-project';}],
 ['historical origin document mismatch',(r:any)=>{r.records[0].originalAbsence.document='00000000-0000-4000-8000-000000000000';}],
 ['missing deletion receipt',(r:any)=>{delete r.records[0].deletionReceipt;}],
] as const){test(`cold editable History refuses sealed ${name}`,async()=>{
 const f=await fixture(true);await f.reseal(c=>mutate(c.scriptState.producerCustody));await expect(f.coldOpen()).rejects.toThrow(/custody|receipt|policy|origin|version|delet/i);
},120000);}
