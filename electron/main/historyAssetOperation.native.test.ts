import {test,expect} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import sharp from 'sharp';import {createHash} from 'node:crypto';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';import {serializeStoryboardScriptMarkdown} from './storyboardScript';
import {createRecoveryCloseBarrier} from './recoveryCloseBarrier';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {assertPhysicalWorkspaceWriterTargets} from './workspacePhysicalWriterGate';
import {createWorkspaceRecoveryPartitions} from './workspaceRecoveryPartitions';
import {createNativeAuthorizationSession} from './nativeAuthorizationSession';
import ts from 'typescript';
import {atomicWriteTextFile} from './fileRenames';
const actualMainMetadataWriter=async()=>{
 const source=await fs.readFile(path.resolve('electron/main/main.ts'),'utf8'),tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 const names=['writeProjectMetadata','writeProjectFiles','writeStoryboardScriptMarkdown','storyboardScriptPathForFolder'];
 const declarations=tree.statements.filter(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>ts.isIdentifier(d.name)&&names.includes(d.name.text)));
 expect(declarations).toHaveLength(names.length);
 const javascript=ts.transpileModule(declarations.map(n=>n.getText(tree)).join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 // Exact Main functions and real atomic/FS dependencies; no Electron bootstrap,
 // layer initialization, renderer, or permission writer is substituted here.
 return new Function('path','atomicWriteTextFile','mkdir','writeFile','rename','unlink','readFile','serializeStoryboardScriptMarkdown','storyboardScriptFileName',javascript+'\nreturn writeProjectFiles;')(path,atomicWriteTextFile,fs.mkdir,fs.writeFile,fs.rename,fs.unlink,fs.readFile,serializeStoryboardScriptMarkdown,'storyboard-script.md') as (metadata:string,root:string,project:any)=>Promise<void>;
};
const verifyFreshProcess=async(root:string,nonce:string,retained:unknown)=>{
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/history-preserved-cold-read.mjs',root,nonce],{cwd:process.cwd(),timeout:60000,maxBuffer:16*1024*1024});
 const result=JSON.parse(stdout);expect(result.pid).not.toBe(process.pid);expect(result.content).toEqual(JSON.parse(JSON.stringify(retained)));
 expect(result.denied).toEqual({writer:true,autosave:true,history:true,ack:true});expect(result.callbacks).toBe(0);
 await fs.writeFile(path.join(root,'HISTORY-INERT-COLD-OS.json'),stdout,{flag:'wx'});
};
const fixture=async(holdNative=false,failCloseReadback=false,readOnlySecond:boolean|'both'=false)=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'private-history-native-')),paths=['.storyboard-workbench/layers/s/a.png','.storyboard-workbench/layers/s/b.png'];
 const red=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer(),blue=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer(),tiff=await sharp(red).tiff().toBuffer(),url=(b:Buffer)=>'data:image/png;base64,'+b.toString('base64');
 await fs.mkdir(path.dirname(path.join(root,paths[0])),{recursive:true,mode:0o700});for(const p of paths)await fs.writeFile(path.join(root,p),red,{mode:0o600});await fs.writeFile(path.join(root,'s.tiff'),tiff,{mode:0o600});
 if(readOnlySecond)await fs.chmod(path.join(root,paths[1]),0o400);
 if(readOnlySecond==='both')await fs.chmod(path.join(root,paths[0]),0o400);
 const project:any={id:'p',name:'original',shots:[{id:'s',imagePath:path.join(root,'s.tiff'),fileName:'s.tiff',swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:paths.map((bitmapPath,i)=>({id:i?'b':'a',kind:'paint',bitmapPath,width:2,height:2}))}],dialogues:[],pendingBake:{version:1,shots:{s:{state:'synced',acceptedOutputIdentity:createHash('sha256').update(tiff).digest('hex')}}}};
 const metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),md=path.join(root,'storyboard-script.md');
 const write=async(p:any)=>{await fs.writeFile(metadata,JSON.stringify(p,null,2)+'\n',{mode:0o600});await fs.writeFile(md,serializeStoryboardScriptMarkdown(p),{mode:0o600});return {};};await write(project);
 const hold=path.join(root,'HOLD-NATIVE'),entered=path.join(root,'NATIVE-ENTERED'),release=path.join(root,'RELEASE-NATIVE'),wrapper=path.join(root,'native-wrapper.py');
 if(holdNative)await fs.writeFile(wrapper,`import importlib.util, pathlib, time
spec=importlib.util.spec_from_file_location('original',${JSON.stringify(path.resolve('scripts/recovery-content-permissions.py'))})
original=importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
def authorize(request):
    result=original.authorize(request)
    if request.get('phase')=='captureMemoryPolicy' and ${JSON.stringify(path.join(root,paths[0]))} in request.get('sources',[]) and pathlib.Path(${JSON.stringify(hold)}).exists():
        pathlib.Path(${JSON.stringify(entered)}).write_text('actual native inspection completed; response held')
        start=time.monotonic()
        while not pathlib.Path(${JSON.stringify(release)}).exists():
            if time.monotonic()-start>15: raise RuntimeError('owned native hold deadline')
            time.sleep(0.01)
    return result
`,{mode:0o600});
 if(failCloseReadback)await fs.writeFile(wrapper,`import sys,json,subprocess,os
r=json.load(sys.stdin)
file=r.get('path','')
if r.get('phase')=='readback' and r.get('root')==${JSON.stringify(root)} and file.endswith('/content.json') and os.path.isfile(file) and json.load(open(file)).get('revision','').startswith('history-close:'):
    print(json.dumps({'authorized':False,'reason':'injected History Close readback'}));sys.exit(1)
p=subprocess.run([${JSON.stringify('python3')},${JSON.stringify(path.resolve('scripts/recovery-content-permissions.py'))}],input=json.dumps(r),text=True,capture_output=True)
sys.stdout.write(p.stdout);sys.stderr.write(p.stderr);sys.exit(p.returncode)
`,{mode:0o600});
 const frame={},sender={mainFrame:frame},event:any={sender,senderFrame:frame},service=createPreparedWorkspaceSave({budget:{bytes:16*1024*1024,records:2000,assets:64,jsonDepth:80},python:'python3',script:holdNative||failCloseReadback?wrapper:path.resolve('scripts/recovery-content-permissions.py')});
 const p={folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
 const r=await service.run(event,p,async()=>({project,normalSaveOutputs:[]}));await service.persist(event,{...p,recoverySaveNonce:r.recoverySaveNonce},()=>write(project));await service.acknowledge(event,{folderPath:root,nonce:r.recoverySaveNonce,project});
 const begin=()=>service.beginHistoryAssets(event,{folderPath:root,project,targetProject:{...project,name:'historical'},assets:paths.map(bitmapPath=>({bitmapPath,dataUrl:url(blue)}))});
 const persist=(p:any=project)=>service.ordinary(event,'workspace:autosave',{folderPath:root,metadataPath:metadata,project:p},[metadata,md],()=>write(p));
 return {root,paths,red,blue,url,project,event,sender,service,begin,persist,hold,entered,release,oldNonce:r.recoverySaveNonce,write,metadata,md,cleanup:()=>fs.rm(root,{recursive:true,force:true})};
};
test('new Main-certified History failure permits only explicit new-generation continuation; unregistered or changed inventory stays read-only',async()=>{
 const s=await fixture();try{
  const observed=await s.service.observeWorkspace(s.event,s.root);
  expect(await s.service.inspectPartialSaveContinuation(s.event,{binding:observed.binding})).toEqual({eligible:false});
  const {operation}=await s.begin();
  await s.service.stepHistoryAssets(s.event,{operation,index:0});
  await s.service.stepHistoryAssets(s.event,{operation,index:1});
  const target={...s.project,name:'historical'};
  await expect(s.service.ordinary(s.event,'workspace:autosave',{folderPath:s.root,metadataPath:s.metadata,project:target},[s.metadata,s.md],async()=>{throw Error('original metadata failure');})).rejects.toThrow('original metadata failure');
  const entry={project:s.project,selectedShotIds:['s'],fileNameSyncState:'synced',layerAssets:s.paths.map(bitmapPath=>({bitmapPath,dataUrl:s.url(s.red)}))};
  const capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:target,sequence:8,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,error:'original metadata failure',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history:{undo:[entry],redo:[entry]}};
  expect(await s.service.certifyRetainedSet(s.event,{slots:[capture]})).toBe(true);
  const cold=createPreparedWorkspaceSave({budget:{bytes:16*1024*1024,records:2000,assets:64,jsonDepth:80},python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')});
  const observation=await cold.observeWorkspace(s.event,s.root),retained:any=await cold.readReadonly(s.root);
  for(const id of ['a','b'])expect(retained.assets.find((a:any)=>a.role===`continued/s/${id}`)?.sourceDataUrl).toBe(s.url(s.blue));
  const files=[s.metadata,s.md,...s.paths.map(p=>path.join(s.root,p))];
  const original=await Promise.all(files.map(async file=>({bytes:await fs.readFile(file),stat:await fs.stat(file)})));
  expect(await cold.inspectPartialSaveContinuation(s.event,{binding:observation.binding})).toMatchObject({eligible:true});
  const begin=await cold.beginPartialSaveContinuation(s.event,{binding:observation.binding});
  const edited={...retained.projectRaw,name:'new generation after History failure'};
  const desiredAssets=['a','b'].map(layerId=>({shotId:'s',layerId,dataUrl:s.url(s.blue)}));
  const result=await cold.persistPartialSaveContinuation(s.event,{session:begin.session,revision:begin.revision,projectRaw:edited,viewState:retained.viewState,desiredAssets});
  expect(result.originalSaveAcknowledged).toBe(false);expect(result.revision).not.toBe(begin.revision);
  const continued:any=await cold.readReadonly(s.root);
  for(const id of ['a','b'])expect(continued.assets.find((a:any)=>a.role===`continued/s/${id}`)?.sourceDataUrl).toBe(s.url(s.blue));
  expect(continued.projectRaw).toEqual(edited);expect(continued.effectFacts).toEqual(retained.effectFacts);expect(continued.viewState.history).toEqual(capture.history);
  expect(continued.continuationState).toMatchObject({stage:'continued-editing',failedBase:{acknowledged:false}});
  for(const [i,file] of files.entries()){expect(await fs.readFile(file)).toEqual(original[i].bytes);const stat=await fs.stat(file);expect([stat.dev,stat.ino,stat.mode,stat.nlink]).toEqual([original[i].stat.dev,original[i].stat.ino,original[i].stat.mode,original[i].stat.nlink]);}
  await expect(assertPhysicalWorkspaceWriterTargets([s.root])).rejects.toThrow();
  await expect(cold.acknowledge(s.event,{folderPath:s.root,nonce:s.oldNonce,project:edited})).rejects.toThrow();
  await fs.writeFile(s.metadata,JSON.stringify({...s.project,name:'independently changed'}));
  expect(await cold.inspectPartialSaveContinuation(s.event,{binding:observation.binding})).toEqual({eligible:false});
  await expect(cold.beginPartialSaveContinuation(s.event,{binding:observation.binding})).rejects.toThrow();
 }finally{await s.cleanup();}
},120000);

test('private compensation does not unlock ordinary failed fact and wrong/old/foreign ACK cannot retire it',async()=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});await fs.chmod(path.join(s.root,s.paths[1]),0o400);
  await expect(s.service.stepHistoryAssets(s.event,{operation,index:1})).rejects.toThrow('PNG_REFUSED');await fs.chmod(path.join(s.root,s.paths[1]),0o600);
  let invoked=false;await expect(s.service.ordinary(s.event,'layers:writePng',{folderPath:s.root},[path.join(s.root,s.paths[0])],async()=>{invoked=true;})).rejects.toThrow('History operation excludes ordinary producers');expect(invoked).toBe(false);
  const result=await s.service.compensateHistoryAssets(s.event,{operation});expect(result.compensated).toBe(true);for(const p of s.paths)expect(await fs.readFile(path.join(s.root,p))).toEqual(s.red);
  await expect(s.service.acknowledge(s.event,{folderPath:s.root,nonce:s.oldNonce,project:s.project})).rejects.toThrow();
  const bound=await s.persist();expect(bound.ordinaryPersistenceNonce).not.toBe(s.oldNonce);
  await expect(s.service.acknowledge(s.event,{folderPath:s.root,nonce:bound.ordinaryPersistenceNonce,project:{...s.project,name:'borrowed B'}})).rejects.toThrow();
  const foreignFrame={},foreign:any={sender:{mainFrame:foreignFrame},senderFrame:foreignFrame};await expect(s.service.acknowledge(foreign,{folderPath:s.root,nonce:bound.ordinaryPersistenceNonce,project:s.project})).rejects.toThrow();
  expect(await s.service.acknowledge(s.event,{folderPath:s.root,nonce:bound.ordinaryPersistenceNonce,project:s.project})).toBe(true);
  await expect(s.service.stepHistoryAssets(s.event,{operation,index:0})).rejects.toThrow('History operation unavailable');
 }finally{await s.cleanup();}
},120000);
test.each(['document reload','ABA original sender'])('%s cannot start old effects or borrow ACK; Main restores already-started original Root',async()=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});s.service.invalidateDocument(s.sender);
  // This serialized public read executes only after internal recovery has settled.
  const retained:any=await s.service.readReadonly(s.root);expect(retained.effectFacts.historyOperation.invalidated).toBe(true);
  expect(await fs.readFile(path.join(s.root,s.paths[0]))).toEqual(s.red);expect(await fs.readFile(path.join(s.root,s.paths[1]))).toEqual(s.red);
  await expect(s.service.stepHistoryAssets(s.event,{operation,index:1})).rejects.toThrow('History operation unavailable');
  await expect(s.service.compensateHistoryAssets(s.event,{operation})).rejects.toThrow('History operation unavailable');
  await expect(s.service.acknowledge(s.event,{folderPath:s.root,nonce:s.oldNonce,project:s.project})).rejects.toThrow();
  expect(retained.effectFacts.historyOperation.assets[0].before).toBe(s.url(s.red));
 }finally{await s.cleanup();}
},120000);
test('independently replaced first PNG is not overwritten; residual before/desired/actual and failed operation stay protected',async()=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});
  const green=await sharp({create:{width:2,height:2,channels:4,background:'green'}}).png().toBuffer();await fs.writeFile(path.join(s.root,s.paths[0]),green);
  const r=await s.service.compensateHistoryAssets(s.event,{operation});expect(r.compensated).toBe(false);expect(await fs.readFile(path.join(s.root,s.paths[0]))).toEqual(green);
  const retry=await s.service.compensateHistoryAssets(s.event,{operation});expect(retry.compensated).toBe(false);expect(await fs.readFile(path.join(s.root,s.paths[0]))).toEqual(green);
  await expect(s.persist()).rejects.toThrow('History effects not fully settled');
  const retained:any=await s.service.readReadonly(s.root);expect(retained.effectFacts.historyOperation.assets[0]).toMatchObject({before:s.url(s.red),desired:s.url(s.blue),actual:s.url(green),compensationAcknowledged:false});
 }finally{await s.cleanup();}
},120000);

test('completed exact private History ACK permits editable A→B→aliasA handoff, not a boolean recovery unlock',async()=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});
  await s.service.compensateHistoryAssets(s.event,{operation});const receipt=await s.persist();await s.service.acknowledge(s.event,{folderPath:s.root,nonce:receipt.ordinaryPersistenceNonce,project:s.project});
  const observed=await s.service.observeWorkspace(s.event,s.root);
  const capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:s.project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:false,receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:[],dirtyShotIds:[],fileNameSyncState:'synced',workspaceSaveState:'saved',history:{undo:[],redo:[]}};
  expect(await s.service.certifyHandoff(s.event,capture)).toEqual({mode:'completed-terminal',readonly:false});
 }finally{await s.cleanup();}
},120000);


test('document invalidation during actual before-version native response cannot start a new PNG effect',async()=>{
 const s=await fixture(true);try{
  const {operation}=await s.begin();const original=await fs.stat(path.join(s.root,s.paths[0]));await fs.writeFile(s.hold,'hold next actual native response');
  const step=s.service.stepHistoryAssets(s.event,{operation,index:0});const rejected=expect(step).rejects.toThrow();
  const deadline=Date.now()+15000;while(Date.now()<deadline){try{await fs.stat(s.entered);break;}catch{await new Promise(r=>setTimeout(r,10));}}
  expect(await fs.readFile(s.entered,'utf8')).toContain('actual native inspection completed');s.service.invalidateDocument(s.sender);await fs.writeFile(s.release,'release original started native read');await rejected;
  const retained:any=await s.service.readReadonly(s.root);const now=await fs.stat(path.join(s.root,s.paths[0]));expect(now.ino).toBe(original.ino);expect(await fs.readFile(path.join(s.root,s.paths[0]))).toEqual(s.red);expect(retained.effectFacts.historyOperation.assets.every((a:any)=>!a.started)).toBe(true);
 }finally{await s.cleanup();}
},120000);


test('private native before/after absence inventory supports deletion, compensation and reciprocal source restoration',async()=>{
 const s=await fixture();try{
  const target={...s.project,shots:[{...s.project.shots[0],layers:s.project.shots[0].layers.slice(0,1)}]};
  const {operation}=await s.service.beginHistoryAssets(s.event,{folderPath:s.root,project:s.project,targetProject:target,assets:[{bitmapPath:s.paths[0],dataUrl:s.url(s.blue)},{bitmapPath:s.paths[1]}]});
  await s.service.stepHistoryAssets(s.event,{operation,index:0});await s.service.stepHistoryAssets(s.event,{operation,index:1});await expect(fs.stat(path.join(s.root,s.paths[1]))).rejects.toMatchObject({code:'ENOENT'});
  const restored=await s.service.compensateHistoryAssets(s.event,{operation});expect(restored.compensated).toBe(true);for(const p of s.paths)expect(await fs.readFile(path.join(s.root,p))).toEqual(s.red);
  const receipt=await s.persist();expect(await s.service.acknowledge(s.event,{folderPath:s.root,nonce:receipt.ordinaryPersistenceNonce,project:s.project})).toBe(true);
 }finally{await s.cleanup();}
},120000);


test('wrong-size desired PNG refuses before admission and every source effect',async()=>{
 const s=await fixture();try{
  const tiny=await sharp({create:{width:1,height:1,channels:4,background:'blue'}}).png().toBuffer();
  await expect(s.service.beginHistoryAssets(s.event,{folderPath:s.root,project:s.project,targetProject:s.project,assets:[{bitmapPath:s.paths[0],dataUrl:s.url(tiny)}]})).rejects.toThrow('History desired PNG dimensions/encoding');
  for(const p of s.paths)expect(await fs.readFile(path.join(s.root,p))).toEqual(s.red);
 }finally{await s.cleanup();}
},120000);


test('restored private failed fact cannot use autosave to write a non-original metadata target',async()=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});await s.service.compensateHistoryAssets(s.event,{operation});let executed=false;
  await expect(s.service.ordinary(s.event,'workspace:autosave',{folderPath:s.root,metadataPath:path.join(s.root,s.paths[0]),project:s.project},[path.join(s.root,s.paths[0])],async()=>{executed=true;return {};})).rejects.toThrow('Ordinary persist binding mismatch');expect(executed).toBe(false);
  for(const p of s.paths)expect(await fs.readFile(path.join(s.root,p))).toEqual(s.red);
 }finally{await s.cleanup();}
},120000);

test('native compensation refusal keeps exact residual blue and no metadata ACK can wash failure',async()=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});await fs.chmod(path.join(s.root,s.paths[0]),0o400);
  const r=await s.service.compensateHistoryAssets(s.event,{operation});expect(r.compensated).toBe(false);expect(await fs.readFile(path.join(s.root,s.paths[0]))).toEqual(s.blue);
  await expect(s.persist()).rejects.toThrow();const retained:any=await s.service.readReadonly(s.root);expect(retained.effectFacts.historyOperation.assets[0].compensationError).toBeTruthy();
 }finally{await s.cleanup();}
},120000);

test.each(['before metadata','persisted without ACK'])('all-Root Close preserves exact completed History PNGs %s without granting any further effect or ACK',async phase=>{
 const s=await fixture();try{
  const target={...s.project,name:'historical'}, {operation}=await s.begin();
  await s.service.stepHistoryAssets(s.event,{operation,index:0});await s.service.stepHistoryAssets(s.event,{operation,index:1});
  const bound=phase==='persisted without ACK'?await s.persist(target):undefined;
  const observed=await s.service.observeWorkspace(s.event,s.root);
  const capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:target,sequence:2,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,error:'original persistence confirmation unavailable',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history:{undo:[{project:s.project,selectedShotIds:['s'],fileNameSyncState:'synced',layerAssets:s.paths.map(bitmapPath=>({bitmapPath,dataUrl:s.url(s.red)}))}],redo:[]}};
  expect(await s.service.certifyRetainedSet(s.event,{slots:[capture]})).toBe(true);
  const retained:any=await s.service.readReadonly(s.root);
  expect(retained.projectRaw).toEqual(target);expect(retained.viewState.history).toEqual(capture.history);
  expect(retained.continuationState).toMatchObject({stage:'history-preserved',notExecutable:true});
  expect(retained.effectFacts.historyOperation).toMatchObject({operation,state:'active',next:2,metadataStage:bound?'persisted':'pending',acknowledged:false});
  const cold=createPreparedWorkspaceSave({budget:{bytes:16*1024*1024,records:2000,assets:64,jsonDepth:80},python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')});
  expect(await cold.readReadonly(s.root)).toEqual(retained); // fresh controller, not a fresh OS process
  const coldObservation=await cold.observeWorkspace(s.event,s.root);
  expect(await cold.inspectPartialSaveContinuation(s.event,{binding:coldObservation.binding})).toEqual({eligible:false}); // no failed Main enrollment
  let coldEffects=0;
  await expect(cold.ordinary(s.event,'layers:writePng',{folderPath:s.root},[path.join(s.root,s.paths[0])],async()=>{coldEffects++;})).rejects.toThrow();
  await expect(cold.ordinary(s.event,'workspace:autosave',{folderPath:s.root,metadataPath:s.metadata,project:target},[s.metadata,s.md],async()=>{coldEffects++;})).rejects.toThrow();
  await expect(cold.beginHistoryAssets(s.event,{folderPath:s.root,project:target,targetProject:s.project,assets:s.paths.map(bitmapPath=>({bitmapPath,dataUrl:s.url(s.red)}))})).rejects.toThrow();
  await expect(cold.acknowledge(s.event,{folderPath:s.root,nonce:bound?.ordinaryPersistenceNonce??s.oldNonce,project:target})).rejects.toThrow();
  expect(coldEffects).toBe(0);for(const file of s.paths)expect(await fs.readFile(path.join(s.root,file))).toEqual(s.blue);
  await verifyFreshProcess(s.root,bound?.ordinaryPersistenceNonce??s.oldNonce,retained);
  expect(await s.service.certifyRetainedSet(s.event,{slots:[capture]})).toBe(true); // normal Close's second exact capture
  await expect(s.service.compensateHistoryAssets(s.event,{operation})).rejects.toThrow('History operation unavailable');
  await expect(s.service.acknowledge(s.event,{folderPath:s.root,nonce:bound?.ordinaryPersistenceNonce??s.oldNonce,project:target})).rejects.toThrow();
  let executed=false;await expect(s.service.ordinary(s.event,'layers:writePng',{folderPath:s.root},[path.join(s.root,s.paths[0])],async()=>{executed=true;})).rejects.toThrow();expect(executed).toBe(false);
  for(const file of s.paths)expect(await fs.readFile(path.join(s.root,file))).toEqual(s.blue);
  expect(await fs.readFile(s.metadata,'utf8')).toBe(JSON.stringify(bound?target:s.project,null,2)+'\n');
  s.service.invalidateDocument(s.sender);await s.service.readReadonly(s.root);
  for(const file of s.paths)expect(await fs.readFile(path.join(s.root,file))).toEqual(s.blue); // no replayed compensation on reload
 }finally{await s.cleanup();}
},120000);

test.each(['asset','metadata'])('History inert Close refuses independently changed %s without replacing its bytes or writing a Close generation',async kind=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});await s.service.stepHistoryAssets(s.event,{operation,index:1});
  const observed=await s.service.observeWorkspace(s.event,s.root),before=await s.service.readReadonly(s.root);
  const file=kind==='asset'?path.join(s.root,s.paths[0]):s.metadata,changed=kind==='asset'?await sharp({create:{width:2,height:2,channels:4,background:'green'}}).png().toBuffer():Buffer.from(JSON.stringify({...s.project,name:'independent metadata'},null,2)+'\n');
  await fs.writeFile(file,changed);
  const capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:s.project,sequence:2,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:[],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history:{undo:[],redo:[]}};
  await expect(s.service.certifyRetainedSet(s.event,{slots:[capture]})).rejects.toThrow('History Close current version changed');
  expect(await fs.readFile(file)).toEqual(changed);expect(await s.service.readReadonly(s.root)).toEqual(before);
 }finally{await s.cleanup();}
},120000);

test('History Close native readback refusal grants no permit and never restores effects after its seal',async()=>{
 const s=await fixture(false,true);try{
  const target={...s.project,name:'historical'}, {operation}=await s.begin();
  await s.service.stepHistoryAssets(s.event,{operation,index:0});await s.service.stepHistoryAssets(s.event,{operation,index:1});
  const bound=await s.persist(target),observed=await s.service.observeWorkspace(s.event,s.root);
  const capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:target,sequence:3,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history:{undo:[],redo:[]}};
  const metadata=await fs.readFile(s.metadata),md=await fs.readFile(s.md);let permit=false,effects=0;
  await expect((async()=>{permit=await s.service.certifyRetainedSet(s.event,{slots:[capture]});})()).rejects.toThrow('injected History Close readback');expect(permit).toBe(false);
  await expect(s.service.stepHistoryAssets(s.event,{operation,index:0})).rejects.toThrow('History operation unavailable');
  await expect(s.service.compensateHistoryAssets(s.event,{operation})).rejects.toThrow('History operation unavailable');
  await expect(s.service.ordinary(s.event,'workspace:autosave',{folderPath:s.root,metadataPath:s.metadata,project:target},[s.metadata,s.md],async()=>{effects++;})).rejects.toThrow();
  await expect(s.service.ordinary(s.event,'layers:writePng',{folderPath:s.root},[path.join(s.root,s.paths[0])],async()=>{effects++;})).rejects.toThrow();
  await expect(s.service.acknowledge(s.event,{folderPath:s.root,nonce:bound.ordinaryPersistenceNonce,project:target})).rejects.toThrow();
  expect(effects).toBe(0);s.service.invalidateDocument(s.sender);
  // Serialized readonly request drains any incorrectly queued invalidation
  // recovery; its deliberately faulted readback is not asserted successful.
  await s.service.readReadonly(s.root).catch(()=>undefined);
  for(const file of s.paths)expect(await fs.readFile(path.join(s.root,file))).toEqual(s.blue);
  expect(await fs.readFile(s.metadata)).toEqual(metadata);expect(await fs.readFile(s.md)).toEqual(md);
 }finally{await s.cleanup();}
},120000);

test.each(['readback succeeds','readback refuses'])('actual Close barrier and History native retention jointly keep the final RAM boundary: %s',async mode=>{
 const s=await fixture(false,mode==='readback refuses');try{
  const target={...s.project,name:'historical'}, {operation}=await s.begin();
  await s.service.stepHistoryAssets(s.event,{operation,index:0});await s.service.stepHistoryAssets(s.event,{operation,index:1});
  const bound=await s.persist(target),observed=await s.service.observeWorkspace(s.event,s.root);
  const capture={slots:[{folderPath:s.root,binding:observed.binding,content:{projectRaw:target,sequence:4,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history:{undo:[],redo:[]}}]};
  const requests:{requestId:string}[]=[],cancelled:string[]=[];let destroyed=0;
  const sender=Object.assign(s.sender,{id:1,send:(_channel:string,payload:unknown)=>requests.push(payload as {requestId:string})});
  const window={webContents:sender,destroy:()=>{destroyed++;}};
  // The confirmation dialog and renderer capture transport are explicit ports;
  // the real barrier, Main service and native retention are composed here.
  const barrier=createRecoveryCloseBarrier({requestId:()=> 'history-close-request',showMessageBox:async()=>({response:0}),cancelled:(_window,reason)=>{cancelled.push(reason);},certifyRetainedSet:(event,collection)=>s.service.certifyRetainedSet(event,collection)});
  barrier.observe(s.event,true,false);barrier.begin(window);
  const result={requestId:requests[0].requestId,captureAvailable:true,recoveryRequired:true,busy:false,hasUnsavedChanges:true,capture};
  await barrier.finishCapture(s.event,result);expect(destroyed).toBe(0);
  if(mode==='readback succeeds'){
   expect(requests).toHaveLength(2);expect(cancelled).toHaveLength(0);
   await barrier.finishCapture(s.event,result);expect(destroyed).toBe(1);
  }else{expect(requests).toHaveLength(1);expect(cancelled).toHaveLength(1);expect(cancelled[0]).toContain('could not be certified');}
  await expect(s.service.acknowledge(s.event,{folderPath:s.root,nonce:bound.ordinaryPersistenceNonce,project:target})).rejects.toThrow();
  for(const file of s.paths)expect(await fs.readFile(path.join(s.root,file))).toEqual(s.blue);
 }finally{await s.cleanup();}
},120000);

test('a known two-asset failed prefix preserves original/desired/actual with the newly narrower source policy, never restoring source permissions',async()=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});
  const refused=path.join(s.root,s.paths[1]);await fs.chmod(refused,0o400);
  await expect(s.service.stepHistoryAssets(s.event,{operation,index:1})).rejects.toThrow('PNG_REFUSED');
  const observed=await s.service.observeWorkspace(s.event,s.root);
  const capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:s.project,sequence:5,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,error:'actual native second PNG refused',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history:{undo:[],redo:[]}};
  expect(await s.service.certifyRetainedSet(s.event,{slots:[capture]})).toBe(true);
  const retained:any=await s.service.readReadonly(s.root);expect(retained.effectFacts.historyOperation).toMatchObject({operation,state:'failed',next:1,metadataStage:'failed',acknowledged:false});
  expect(retained.effectFacts.historyOperation.assets[1].restoreError).toContain('PNG_REFUSED');
  for(const buffer of [s.red,s.blue])expect(retained.assets.some((a:any)=>a.sourceDataUrl===s.url(buffer))).toBe(true);
  const policyRoot=path.join(s.root,'.storyboard-workbench/workspace-recovery-v2/policies');
  const policies=await Promise.all((await fs.readdir(policyRoot)).map(async key=>JSON.parse(await fs.readFile(path.join(policyRoot,key,'namespace.json'),'utf8'))));
  const stricter=policies.find(p=>p.sourcePolicy.expected.mode===0o400);expect(stricter).toBeDefined();
  const contributors=stricter.sourcePolicy.observed.filter(([file]:[string,unknown])=>file===refused);
  expect(contributors.some(([,info]:[string,{mode:number}])=>info.mode===0o600)).toBe(true);
  expect(contributors.some(([,info]:[string,{mode:number}])=>info.mode===0o400)).toBe(true);
  const cold=createPreparedWorkspaceSave({budget:{bytes:16*1024*1024,records:2000,assets:64,jsonDepth:80},python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')});
  expect(await cold.readReadonly(s.root)).toEqual(retained);
  let effects=0;await expect(cold.ordinary(s.event,'layers:writePng',{folderPath:s.root},[path.join(s.root,s.paths[0])],async()=>{effects++;})).rejects.toThrow();expect(effects).toBe(0);
  await verifyFreshProcess(s.root,s.oldNonce,retained);
  await expect(s.service.compensateHistoryAssets(s.event,{operation})).rejects.toThrow('History operation unavailable');
  expect(await fs.readFile(path.join(s.root,s.paths[0]))).toEqual(s.blue);expect(await fs.readFile(refused)).toEqual(s.red);expect((await fs.stat(refused)).mode&0o777).toBe(0o400);
 }finally{await s.cleanup();}
},120000);

test('original compensation completed but its metadata was not begun can Close read-only without losing the original refusal or blue desired bytes',async()=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});const refused=path.join(s.root,s.paths[1]);await fs.chmod(refused,0o400);
  await expect(s.service.stepHistoryAssets(s.event,{operation,index:1})).rejects.toThrow('PNG_REFUSED');
  expect((await s.service.compensateHistoryAssets(s.event,{operation})).compensated).toBe(true);
  const observed=await s.service.observeWorkspace(s.event,s.root),capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:s.project,sequence:6,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,error:'original refused; compensation metadata not begun',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history:{undo:[],redo:[]}};
  expect(await s.service.certifyRetainedSet(s.event,{slots:[capture]})).toBe(true);
  const retained:any=await s.service.readReadonly(s.root);expect(retained.effectFacts.historyOperation).toMatchObject({operation,state:'restored',metadataStage:'failed',acknowledged:false});
  expect(retained.effectFacts.historyOperation.assets[1].restoreError).toContain('PNG_REFUSED');expect(retained.assets.some((a:any)=>a.sourceDataUrl===s.url(s.blue))).toBe(true);
  await verifyFreshProcess(s.root,s.oldNonce,retained);
  for(const file of s.paths)expect(await fs.readFile(path.join(s.root,file))).toEqual(s.red);expect((await fs.stat(refused)).mode&0o777).toBe(0o400);
  await expect(s.service.compensateHistoryAssets(s.event,{operation})).rejects.toThrow('History operation unavailable');
 }finally{await s.cleanup();}
},120000);

test('immediate original History failure retention already respects a newly read-only source before any Close request',async()=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});const refused=path.join(s.root,s.paths[1]);await fs.chmod(refused,0o400);
  await expect(s.service.stepHistoryAssets(s.event,{operation,index:1})).rejects.toThrow('PNG_REFUSED');
  expect((await s.service.readReadonly(s.root)).revision).toBe('history-failed:'+operation);
  const root=path.join(s.root,'.storyboard-workbench/workspace-recovery-v2/policies');
  const keys=await fs.readdir(root).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  const policies=await Promise.all(keys.map(async key=>JSON.parse(await fs.readFile(path.join(root,key,'namespace.json'),'utf8'))));
  expect(policies.some(p=>p.sourcePolicy.expected.mode===0o400&&p.sourcePolicy.observed.some(([file,info]:[string,{mode:number}])=>file===refused&&info.mode===0o400))).toBe(true);
  expect((await fs.stat(refused)).mode&0o777).toBe(0o400);
 }finally{await s.cleanup();}
},120000);

test('stricter archived history does not block a genuine completed source, but cold source restriction changes still block writer admission',async()=>{
 const s=await fixture();try{
  const {operation}=await s.begin();await s.service.stepHistoryAssets(s.event,{operation,index:0});const second=path.join(s.root,s.paths[1]);await fs.chmod(second,0o400);
  await expect(s.service.stepHistoryAssets(s.event,{operation,index:1})).rejects.toThrow('PNG_REFUSED');
  // Deliberate synthetic actor restoring its own source, as the existing ACK
  // regression does. No archive permissions are restored or widened.
  await fs.chmod(second,0o600);expect((await s.service.compensateHistoryAssets(s.event,{operation})).compensated).toBe(true);
  const bound=await s.persist();expect(await s.service.acknowledge(s.event,{folderPath:s.root,nonce:bound.ordinaryPersistenceNonce,project:s.project})).toBe(true);
  const options={budget:{bytes:16*1024*1024,records:2000,assets:64,jsonDepth:80},python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')};
  const cold=createPreparedWorkspaceSave(options),retained:any=await cold.readReadonly(s.root);
  expect(retained.continuationState.terminal.sourcePolicy.expected.mode).toBe(0o600);
  await expect(assertPhysicalWorkspaceWriterTargets([path.join(s.root,s.paths[0])])).resolves.toBeUndefined();
  const observation=await cold.observeWorkspace(s.event,s.root);
  await cold.ordinary(s.event,'workspace:openFolderByPath',{folderPath:s.root},[s.root],async()=>({folderPath:s.root,metadataPath:s.metadata,folderName:'synthetic',images:[],project:s.project}));
  const readerCapture={folderPath:s.root,binding:observation.binding,content:{projectRaw:s.project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:false,receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:[],dirtyShotIds:[],fileNameSyncState:'synced',workspaceSaveState:'saved',history:retained.viewState.history??{undo:[],redo:[]}};
  expect(await cold.certifyRetainedSet(s.event,{slots:[readerCapture]})).toBe(true);
  let called=0;await cold.ordinary(s.event,'layers:writePng',{folderPath:s.root},[path.join(s.root,s.paths[0])],async()=>{called++;});expect(called).toBe(1);
  const persisted=await cold.ordinary(s.event,'workspace:autosave',{folderPath:s.root,metadataPath:s.metadata,project:s.project},[s.metadata,s.md],()=>s.write(s.project));
  expect(await cold.acknowledge(s.event,{folderPath:s.root,nonce:persisted.ordinaryPersistenceNonce,project:s.project})).toBe(true);
  await fs.chmod(second,0o400);createPreparedWorkspaceSave(options);
  await expect(assertPhysicalWorkspaceWriterTargets([path.join(s.root,s.paths[0])])).rejects.toThrow('protected');
  const policyRoot=path.join(s.root,'.storyboard-workbench/workspace-recovery-v2/policies');
  const namespaces=await Promise.all((await fs.readdir(policyRoot)).map(async key=>JSON.parse(await fs.readFile(path.join(policyRoot,key,'namespace.json'),'utf8'))));
  expect(namespaces.some(n=>n.sourcePolicy.expected.mode===0o400)).toBe(true);
 }finally{await s.cleanup();}
},120000);

test('cold terminal pin detects a single-source mode change even when the overall source intersection stays 0400',async()=>{
 const s=await fixture(false,false,true);try{
  const options={budget:{bytes:16*1024*1024,records:2000,assets:64,jsonDepth:80},python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')};
  const cold=createPreparedWorkspaceSave(options),retained:any=await cold.readReadonly(s.root);
  expect(retained.continuationState.terminal.sourcePolicy.expected.mode).toBe(0o400);
  const first=path.join(s.root,s.paths[0]);
  expect(retained.continuationState.terminal.sourcePolicy.observed.find(([file]:[string,unknown])=>file===first)[1].mode).toBe(0o600);
  await expect(assertPhysicalWorkspaceWriterTargets([first])).resolves.toBeUndefined();
  await fs.chmod(first,0o400);createPreparedWorkspaceSave(options);
  await expect(assertPhysicalWorkspaceWriterTargets([first])).rejects.toThrow('protected');
 }finally{await s.cleanup();}
},120000);

test.each(['tighten','widen'] as const)('same-controller retirement cannot launder a single-path %s into ordinary or prepared Save authority',async mode=>{
 const s=await fixture(false,false,mode==='widen'?'both':true);try{
  const before=await s.service.readReadonly(s.root),first=path.join(s.root,s.paths[0]);let effects=0;
  await fs.chmod(first,mode==='widen'?0o600:0o400);
  await expect(s.service.ordinary(s.event,'layers:writePng',{folderPath:s.root},[first],async()=>{effects++;})).rejects.toThrow();
  expect(effects).toBe(0);
  const payload={folderPath:s.root,metadataPath:s.metadata,normalSave:true,project:s.project,recoveryContent:{projectRaw:s.project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  const result=await s.service.runIpc(s.event,payload,async()=>{effects++;return {project:s.project,normalSaveOutputs:[]};});
  expect(result.ok).toBe(false);expect(result.error.sourceEffects).toBe(0);expect(effects).toBe(0);
  expect(await s.service.readReadonly(s.root)).toEqual(before);
 }finally{await s.cleanup();}
},120000);

test('an admitted ordinary fact cannot replace its source pin after an untouched source changes permissions',async()=>{
 const s=await fixture(false,false,'both');try{
  let entered=0;await s.service.ordinary(s.event,'layers:writePng',{folderPath:s.root},[path.join(s.root,s.paths[0])],async()=>{entered++;});expect(entered).toBe(1);
  await fs.chmod(path.join(s.root,s.paths[1]),0o600); // aggregate remains0400
  const bound=await s.persist();
  await expect(s.service.acknowledge(s.event,{folderPath:s.root,nonce:bound.ordinaryPersistenceNonce,project:s.project})).rejects.toThrow('Ordinary admitted source restrictions changed');
  expect((await s.service.readReadonly(s.root)).continuationState).toMatchObject({stage:'ordinary-unsettled',notExecutable:true});
 }finally{await s.cleanup();}
},120000);

test('prepared Save cannot bless a still-present source restriction change hidden by the aggregate mode',async()=>{
 const s=await fixture(false,false,'both');try{
  const payload={folderPath:s.root,metadataPath:s.metadata,normalSave:true,project:s.project,recoveryContent:{projectRaw:s.project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  const output=await s.service.run(s.event,payload,async()=>{await fs.chmod(path.join(s.root,s.paths[1]),0o600);return {project:s.project,normalSaveOutputs:[]};});
  await s.service.persist(s.event,{...payload,recoverySaveNonce:output.recoverySaveNonce},()=>s.write(s.project));
  const before=await s.service.readReadonly(s.root); // persist changes live stage, not the archived prepared offer
  await expect(s.service.acknowledge(s.event,{folderPath:s.root,nonce:output.recoverySaveNonce,project:s.project})).rejects.toThrow('Prepared admitted source restrictions changed');
  expect(await s.service.readReadonly(s.root)).toEqual(before);
 }finally{await s.cleanup();}
},120000);

test.each(['original refusal','partial compensation','independent replacement'] as const)('actual native refused compensation preserves versions without write authority: %s',async scenario=>{
 const s=await fixture(true);try{
  const {operation}=await s.begin(),first=path.join(s.root,s.paths[0]),second=path.join(s.root,s.paths[1]);
  await s.service.stepHistoryAssets(s.event,{operation,index:0});
  if(scenario==='partial compensation')await s.service.stepHistoryAssets(s.event,{operation,index:1});
  else{await fs.chmod(second,0o400);await expect(s.service.stepHistoryAssets(s.event,{operation,index:1})).rejects.toThrow('PNG_REFUSED');}
  await fs.writeFile(s.hold,'hold actual pre-compensation source inspection');
  const recovery=s.service.compensateHistoryAssets(s.event,{operation});
  const deadline=Date.now()+15000;while(Date.now()<deadline){try{await fs.stat(s.entered);break;}catch{await new Promise(r=>setTimeout(r,10));}}
  expect(await fs.readFile(s.entered,'utf8')).toContain('actual native inspection completed');
  await fs.chmod(first,0o400);await fs.writeFile(s.release,'release inspected version, fresh real writer must refuse');
  const result=await recovery;expect(result.compensated).toBe(false);
  expect(result.assets[0]).toMatchObject({actual:s.url(s.blue),compensationStarted:true,compensationAcknowledged:false,compensationFailure:{effect:'refused',retainedTemporary:null}});
  expect(result.assets[0].compensationError).toContain('PNG_REFUSED');
  const observed=await s.service.observeWorkspace(s.event,s.root);
  const capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:s.project,sequence:6,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,error:'actual native compensation refused',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history:{undo:[],redo:[]}};
  if(scenario==='independent replacement'){
   const green=await sharp({create:{width:2,height:2,channels:4,background:'green'}}).png().toBuffer(),replacement=first+'.independent';
   await fs.writeFile(replacement,green,{mode:0o400});await fs.rename(replacement,first);
   const before=await s.service.readReadonly(s.root);
   await expect(s.service.certifyRetainedSet(s.event,{slots:[capture]})).rejects.toThrow('History Close current version changed');
   expect(await s.service.readReadonly(s.root)).toEqual(before);expect(await fs.readFile(first)).toEqual(green);return;
  }
  expect(await s.service.certifyRetainedSet(s.event,{slots:[capture]})).toBe(true);
  const retained:any=await s.service.readReadonly(s.root);expect(retained.effectFacts.historyOperation.assets[0]).toMatchObject({before:s.url(s.red),actual:s.url(s.blue),compensationFailure:{effect:'refused',retainedTemporary:null}});
  if(scenario==='partial compensation')expect(retained.effectFacts.historyOperation.assets[1]).toMatchObject({compensationAcknowledged:true,actual:s.url(s.red)});
  else expect(retained.effectFacts.historyOperation.assets[1].restoreError).toContain('PNG_REFUSED');
  await expect(s.service.compensateHistoryAssets(s.event,{operation})).rejects.toThrow('History operation unavailable');
  await verifyFreshProcess(s.root,s.oldNonce,retained);
  expect(await fs.readFile(first)).toEqual(s.blue);expect(await fs.readFile(second)).toEqual(s.red);
  expect((await fs.stat(first)).mode&0o777).toBe(0o400);expect((await fs.stat(second)).mode&0o777).toBe(scenario==='partial compensation'?0o600:0o400);
 }finally{await fs.writeFile(s.release,'finally release native response').catch(()=>{});await s.cleanup();}
},120000);

test.each(['stable observation','independent identical-byte replacement'] as const)('actual Main metadata writes JSON then genuinely fails on readonly MD: %s',async scenario=>{
 const s=await fixture();try{
  const {operation}=await s.begin();for(const index of [0,1])await s.service.stepHistoryAssets(s.event,{operation,index});
  const target={...s.project,name:'historical'},beforeMD=await fs.readFile(s.md);await fs.chmod(s.md,0o400);
  const write=await actualMainMetadataWriter();
  await expect(s.service.ordinary(s.event,'workspace:autosave',{folderPath:s.root,metadataPath:s.metadata,project:target},[s.metadata,s.md],()=>write(s.metadata,s.root,target))).rejects.toMatchObject({code:'EACCES'});
  expect(await fs.readFile(s.metadata,'utf8')).toBe(JSON.stringify(target,null,2)+'\n');expect(await fs.readFile(s.md)).toEqual(beforeMD);
  const observed=await s.service.observeWorkspace(s.event,s.root);
  const capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:target,sequence:7,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,error:'actual original metadata EACCES',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history:{undo:[],redo:[]}};
  if(scenario==='independent identical-byte replacement'){
   const replacement=s.metadata+'.independent',current=await fs.stat(s.metadata);await fs.writeFile(replacement,JSON.stringify(target,null,2)+'\n',{mode:current.mode&0o777});await fs.rename(replacement,s.metadata);
   const before=await s.service.readReadonly(s.root);
   await expect(s.service.certifyRetainedSet(s.event,{slots:[capture]})).rejects.toThrow('History Close current version changed');
   expect(await s.service.readReadonly(s.root)).toEqual(before);return;
  }
  expect(await s.service.certifyRetainedSet(s.event,{slots:[capture]})).toBe(true);
  const retained:any=await s.service.readReadonly(s.root),facts=retained.effectFacts.historyOperation;
  expect(facts.metadataObservation).toMatchObject({kind:'original-callback-failure-observation',acknowledged:false,attemptedProject:target});
  const json=facts.inventory.find((v:any)=>v.file==='.storyboard-workbench/storyboard.project.json'),md=facts.inventory.find((v:any)=>v.file==='storyboard-script.md');
  expect(Buffer.from(json.actual.bytes,'base64').toString()).toBe(JSON.stringify(target,null,2)+'\n');expect(Buffer.from(md.actual.bytes,'base64')).toEqual(beforeMD);
  await verifyFreshProcess(s.root,s.oldNonce,retained);
  expect(await fs.readFile(s.md)).toEqual(beforeMD);expect((await fs.stat(s.md)).mode&0o777).toBe(0o400);
 }finally{await s.cleanup();}
},120000);

test.each(['stable','narrower source','changed after observation'] as const)('a private observed write-after conflict is archived without execution: %s',async scenario=>{
 const s=await fixture();try{
  const {operation}=await s.begin(),first=path.join(s.root,s.paths[0]);await s.service.stepHistoryAssets(s.event,{operation,index:0});
  const green=await sharp({create:{width:2,height:2,channels:4,background:'green'}}).png().toBuffer();await fs.writeFile(first,green);
  if(scenario==='narrower source')await fs.chmod(first,0o400);
  const failure=await s.service.compensateHistoryAssets(s.event,{operation});expect(failure.compensated).toBe(false);
  expect(failure.assets[0]).toMatchObject({actual:s.url(green),restoreUnresolved:true,compensationStarted:false,compensationAcknowledged:false});
  const observed=await s.service.observeWorkspace(s.event,s.root);
  const capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:s.project,sequence:8,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,error:'independent current pixels prevent original compensation',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history:{undo:[],redo:[]}};
  if(scenario==='changed after observation'){
   const yellow=await sharp({create:{width:2,height:2,channels:4,background:'yellow'}}).png().toBuffer();await fs.writeFile(first,yellow);
   const before=await s.service.readReadonly(s.root);
   await expect(s.service.certifyRetainedSet(s.event,{slots:[capture]})).rejects.toThrow('History Close current version changed');
   expect(await s.service.readReadonly(s.root)).toEqual(before);expect(await fs.readFile(first)).toEqual(yellow);return;
  }
  expect(await s.service.certifyRetainedSet(s.event,{slots:[capture]})).toBe(true);
  const retained:any=await s.service.readReadonly(s.root),asset=retained.effectFacts.historyOperation.assets[0];
  expect(asset).toMatchObject({before:s.url(s.red),desired:s.url(s.blue),actual:s.url(green),restoreUnresolved:true,compensationStarted:false,compensationConflict:{kind:'write-after-conflict-before-compensation',origin:'unknown',notExecutable:true}});
  for(const bytes of [s.red,s.blue,green])expect(retained.assets.some((a:any)=>a.sourceDataUrl===s.url(bytes))).toBe(true);
  await verifyFreshProcess(s.root,s.oldNonce,retained);
  await expect(s.service.compensateHistoryAssets(s.event,{operation})).rejects.toThrow('History operation unavailable');
  expect(await fs.readFile(first)).toEqual(green);
  if(scenario==='narrower source'){
   expect((await fs.stat(first)).mode&0o777).toBe(0o400);
   const policies=path.join(s.root,'.storyboard-workbench/workspace-recovery-v2/policies');
   expect((await Promise.all((await fs.readdir(policies)).map(async key=>JSON.parse(await fs.readFile(path.join(policies,key,'namespace.json'),'utf8'))))).some(p=>p.sourcePolicy.expected.mode===0o400)).toBe(true);
  }
 }finally{await s.cleanup();}
},120000);

test.each(['prepared-entry','ordinary-ack','ordinary-success'] as const)('a genuine missing-pin legacy terminal must keep its restriction fallback through %s',async scenario=>{
 const s=await fixture(false,false,'both');try{
  const budget={bytes:16*1024*1024,records:2000,assets:64,jsonDepth:80},python='python3',script=path.resolve('scripts/recovery-content-permissions.py');
  const original:any=await s.service.readReadonly(s.root),native=createNativeAuthorizationSession(python,script,()=>budget.bytes);
  const store=createWorkspaceRecoveryPartitions({budget,sourcePolicy:original.original.sourcePolicy,authorize:request=>native.run(async()=>{await native.request({...request,sourceByteLimit:budget.bytes});})});
  const state=await store.inspectReadonly(s.root),tip=state.content!,bytes=await store.readAssets(s.root,state.ack!.generationId);
  const continuation:any=structuredClone(tip.continuationState);delete continuation.terminal.sourcePolicy;
  // Real Native producer appends a separately sealed legacy-shaped fixture;
  // no existing content, hash, namespace, or original capture is rewritten.
  await store.retain({sender:s.sender,frame:s.sender.mainFrame,window:s.sender,document:{}},s.root,{revision:'synthetic-legacy-missing-pin',projectRaw:tip.projectRaw,viewState:tip.viewState,scriptState:tip.scriptState,effectFacts:tip.effectFacts,continuationState:continuation,requiredAssetIds:tip.requiredAssetIds,assets:tip.assets.map(a=>({assetId:a.assetId,bytes:bytes.get(a.assetId)!,role:a.role,width:a.width,height:a.height,encoding:a.encoding}))});
  const cold=createPreparedWorkspaceSave({budget,python,script});
  expect((await cold.readReadonly(s.root)).continuationState).toMatchObject({stage:'completed'});
  await expect(assertPhysicalWorkspaceWriterTargets([path.join(s.root,s.paths[0])])).resolves.toBeUndefined();
  await expect(assertPhysicalWorkspaceWriterTargets([path.join(s.root,s.paths[0])])).resolves.toBeUndefined(); // same-controller legacy compatibility, not deny-all
  const before=await cold.readReadonly(s.root);
  if(scenario!=='prepared-entry'){
   const bound=await cold.ordinary(s.event,'workspace:autosave',{folderPath:s.root,metadataPath:s.metadata,project:s.project},[s.metadata,s.md],()=>s.write(s.project));
   if(scenario==='ordinary-success'){
    expect(await cold.acknowledge(s.event,{folderPath:s.root,nonce:bound.ordinaryPersistenceNonce,project:s.project})).toBe(true);
    expect((await cold.readReadonly(s.root)).continuationState).toHaveProperty('terminal.sourcePolicy.expected.mode',0o400);
    const captures=await store.inspectCapturesReadonly(s.root),legacy=captures.find(c=>c.content.revision==='synthetic-legacy-missing-pin');
    expect(legacy!.content.continuationState).not.toHaveProperty('terminal.sourcePolicy');
    return;
   }
   await fs.chmod(path.join(s.root,s.paths[1]),0o600); // aggregate still0400 after actual admitted metadata persistence
   await expect(cold.acknowledge(s.event,{folderPath:s.root,nonce:bound.ordinaryPersistenceNonce,project:s.project})).rejects.toThrow('Ordinary admitted source restrictions changed');
   expect((await cold.readReadonly(s.root)).continuationState).toMatchObject({stage:'ordinary-unsettled',notExecutable:true});
   return;
  }
  for(const file of s.paths)await fs.chmod(path.join(s.root,file),0o600);
  let effects=0;const payload={folderPath:s.root,metadataPath:s.metadata,normalSave:true,project:s.project,recoveryContent:{projectRaw:s.project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null,unsettled:false}}};
  const result=await cold.runIpc(s.event,payload,async()=>{effects++;return {project:s.project,normalSaveOutputs:[]};});
  expect(result.ok).toBe(false);expect(result.error.sourceEffects).toBe(0);expect(effects).toBe(0);
  await expect(assertPhysicalWorkspaceWriterTargets([path.join(s.root,s.paths[0])])).rejects.toThrow('protected');
  expect(await cold.readReadonly(s.root)).toEqual(before);
  expect((await cold.readReadonly(s.root)).continuationState).not.toHaveProperty('terminal.sourcePolicy');
 }finally{await s.cleanup();}
},120000);

// A History-restored Project can carry own-`undefined` optional fields that JSON
// cannot represent. The durable retained offer must normalize them instead of
// refusing the whole close, and must not turn absence into a present value.
test('History Close normalizes own-undefined renderer Project fields into durable JSON',async()=>{
 const s=await fixture();try{
  const target={...s.project,name:'historical',shots:s.project.shots.map((shot:any)=>({...shot,presentation:undefined,imageLayerEdits:undefined,swb:{...shot.swb,sourceKind:undefined}}))};
  // The real renderer begins the History operation with its in-memory target
  // Project, so Main's own retained copy must be normalized too, not just JSON.
  const {operation}=await s.service.beginHistoryAssets(s.event,{folderPath:s.root,project:s.project,targetProject:target,assets:s.paths.map(bitmapPath=>({bitmapPath,dataUrl:s.url(s.blue)}))});
  await s.service.stepHistoryAssets(s.event,{operation,index:0});await s.service.stepHistoryAssets(s.event,{operation,index:1});
  const observed=await s.service.observeWorkspace(s.event,s.root);
  const history={undo:[{project:target,selectedShotIds:['s'],fileNameSyncState:'synced',layerAssets:s.paths.map(bitmapPath=>({bitmapPath,dataUrl:s.url(s.red)}))}],redo:[]};
  const capture={folderPath:s.root,binding:observed.binding,content:{projectRaw:target,sequence:2,assetRevision:1,desiredAssets:[],retainedAssetIntents:[],effectFacts:{unsettled:true,error:'original persistence confirmation unavailable',receipt:[],deletions:[],remainingScript:null}},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'synced',workspaceSaveState:'error',history};
  const durable=(v:unknown)=>JSON.parse(JSON.stringify(v));
  expect(await s.service.certifyRetainedSet(s.event,{slots:[capture]})).toBe(true);
  const retained:any=await s.service.readReadonly(s.root);
  expect(retained.projectRaw).toEqual(durable(target));
  expect(retained.viewState.history).toEqual(durable(history));
  expect(JSON.stringify(retained)).not.toContain('"presentation":null');
  for(const file of s.paths)expect(await fs.readFile(path.join(s.root,file))).toEqual(s.blue);
 }finally{await s.cleanup();}
},120000);
