// Run with node --test; AST orchestration + production queue/recovery/classifier.
// Native filesystem is real; TIFF encoder, Import preparation and Trash ports are controlled.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{test,before}=require('node:test');
const root=process.env.STORYBOARD_FLOW_TEST_ROOT||path.resolve(__dirname,'../..');
const deps=process.env.STORYBOARD_FLOW_DEPENDENCIES||root;
const ts=require(deps+'/node_modules/typescript'),esbuild=require(deps+'/node_modules/esbuild');
let ports,code;
before(async()=>{
 const source=await fs.readFile(root+'/electron/main/main.ts','utf8');
 const tree=ts.createSourceFile('main.ts',source,ts.ScriptTarget.Latest,true);
 const decl=tree.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)==='saveWorkspace'));
 code=ts.transpileModule(decl.getText(tree),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText+'\nreturn saveWorkspace;';
 const b=await esbuild.build({stdin:{contents:`export * from './electron/main/mapWithConcurrency.ts';export * from './electron/main/fileRenames.ts';export * from './electron/main/layerFileOperationQueue.ts';export * from './electron/main/saveRecovery.ts';export * from './electron/main/workspaceEffectFailure.ts';`,resolveDir:root},bundle:true,platform:'node',format:'cjs',write:false,logLevel:'silent'});
 const m={exports:{}};new Function('require','module','exports',b.outputFiles[0].text)(require,m,m.exports);ports=m.exports;
});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(overrides={}){
 const dir=await fs.mkdtemp(path.join(process.env.TMPDIR||root,'save-safety-'));
 const project={shots:[],pendingDeletedShots:[]},payload={project,folderPath:dir,metadataPath:dir+'/metadata.json'};
 const defaults={withLayerFileOperation:(...a)=>ports.withLayerFileOperation(...a),assertNormalSaveAdmission:async()=>{},stagePendingDeletedShotFiles:async p=>({project:p}),assertRenamePlanSafe:async()=>{},applyFileRenamePlan:ports.applyFileRenamePlan,ensureDirectory:d=>fs.mkdir(d,{recursive:true}),rename:fs.rename,importProjectToSwbFormat:async p=>({project:p,tiffWriteShotIds:[],rollback:async()=>{},commit:async()=>{}}),saveProgressShotIds:()=>new Set(),countSaveProgressShots:()=>0,writeSwbMetadataToTiffs:async()=>undefined,syncSavedSwbBaseFingerprints:async p=>p,clearSavedImageLayerEdits:p=>p,normalSaveOutputAcks:async()=>[],writeProjectFiles:async(_,folder,p)=>{await fs.writeFile(folder+'/metadata.json',JSON.stringify(p));await fs.writeFile(folder+'/storyboard-script.md','published');},recoverFailedSave:ports.recoverFailedSave,trashPendingDeletedShotFiles:async p=>({project:p}),cleanupDeletedShotLayerDirectories:async()=>{},createHash:crypto.createHash,readFile:fs.readFile,...overrides};
 const compose=extra=>{const p={...defaults,...extra};return new Function(...Object.keys(p),code)(...Object.values(p));};
 return {dir,payload,defaults,compose,close:()=>fs.rm(dir,{recursive:true,force:true})};
}
test('queued later edit waits for preparation AND full rollback; final edit is not displaced',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred(),recovering=deferred(),finishRecovery=deferred();
 const target=f.dir+'/layer.png',temp=f.dir+'/incoming.png',backup=f.dir+'/backup.png';
 await fs.writeFile(target,'old');await fs.writeFile(temp,'imported');let queued,save;
 try{
 const run=f.compose({importProjectToSwbFormat:p=>ports.withLayerFileOperation(async()=>{const a=await ports.applyFileReplacements([{tempPath:temp,targetPath:target,backupPath:backup}],{mkdir:f.defaults.ensureDirectory,rename:fs.rename,unlink:fs.unlink});return {project:p,tiffWriteShotIds:[],rollback:()=>ports.withLayerFileOperation(async()=>{recovering.resolve();await finishRecovery.promise;await a.rollback();})};}),writeSwbMetadataToTiffs:async()=>{entered.resolve();await release.promise;throw Error('preparation failed');}});
 save=run(f.payload).catch(e=>e);await entered.promise;let completed=false;
 queued=ports.withLayerFileOperation(async()=>{await fs.writeFile(target,'later edit');completed=true;});await tick();await tick();
 const before=completed;release.resolve();await recovering.promise;await tick();const during=completed;
 finishRecovery.resolve();const error=await save;await queued;
 assert.equal(before,false,'successor must not finish during preparation');assert.equal(during,false,'successor must not finish during recovery');assert.equal(error.message,'preparation failed');assert.equal(await fs.readFile(target,'utf8'),'later edit');assert.equal(await fs.readFile(temp,'utf8'),'imported');
 }finally{release.resolve();finishRecovery.resolve();await save;await queued;await f.close();}
});
for(const mode of ['Trash throw','Trash returned error','second JSON failure','second MD failure','deleted cleanup failure','output read failure','output hash failure'])test(mode+' preserves publication and classifies plain incomplete',async()=>{
 const f=await fixture();let rollbacks=0,writes=0;const failure=Error(mode),ackPath=f.dir+'/output.tif';await fs.writeFile(ackPath,'installed TIFF');
 const imported={...f.payload.project,updatedAt:'installed'},afterTrash={...imported,updatedAt:'trashed'};
 const overrides={importProjectToSwbFormat:async()=>({project:imported,tiffWriteShotIds:[],rollback:async()=>{rollbacks++;}}),writeSwbMetadataToTiffs:async()=>({commit:async()=>{},rollback:async()=>{rollbacks++;}}),normalSaveOutputAcks:async()=>[{targetPath:ackPath,outputHash:crypto.createHash('sha256').update('installed TIFF').digest('hex')}],writeProjectFiles:async(meta,folder,p)=>{writes++;if(writes===2&&mode==='second JSON failure')throw failure;await fs.writeFile(meta,JSON.stringify(p));if(writes===2&&mode==='second MD failure')throw failure;await fs.writeFile(folder+'/storyboard-script.md','published');},trashPendingDeletedShotFiles:async()=>{if(mode==='Trash throw')throw failure;return {project:afterTrash,error:mode==='Trash returned error'?failure:undefined};},cleanupDeletedShotLayerDirectories:async()=>{if(mode==='deleted cleanup failure')throw failure;},readFile:async p=>{if(mode==='output read failure')throw failure;if(mode==='output hash failure')return Buffer.from('changed');return fs.readFile(p);}};
 try{let error;try{await f.compose(overrides)({...f.payload,normalSave:{}});}catch(e){error=e;}assert(error,'must reject');assert(error instanceof ports.SaveRecoveryIncompleteError);const plain=structuredClone(ports.workspaceEffectFailure(error,'save'));assert.equal(plain.error.code,'SAVE_RECOVERY_INCOMPLETE');assert.equal(plain.error.publicationOrCleanup,'started');assert.equal(plain.error.metadata,'unknown');assert.equal(rollbacks,0);assert.equal(await fs.readFile(ackPath,'utf8'),'installed TIFF');const disk=JSON.parse(await fs.readFile(f.payload.metadataPath,'utf8'));assert.equal(disk.updatedAt,mode==='Trash throw'||mode==='second JSON failure'?'installed':'trashed');assert.equal(await fs.readFile(f.dir+'/storyboard-script.md','utf8'),'published');if(mode!=='output hash failure')assert(error.errors.includes(failure),'retain original error identity');}finally{await f.close();}
});
test('successful cleanup holds queue and preserves normal output/deletion ACK payload',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();let save,queued;
 try{const acks=[];save=f.compose({normalSaveOutputAcks:async()=>acks,cleanupDeletedShotLayerDirectories:async()=>{entered.resolve();await release.promise;}})({...f.payload,normalSave:{}});await entered.promise;let done=false;queued=ports.withLayerFileOperation(async()=>{done=true;});await tick();const before=done;release.resolve();const result=await save;await queued;assert.equal(before,false);assert.equal(result.project,f.payload.project);assert.equal(result.normalSaveOutputs,acks);assert.deepEqual(result.normalSaveDeletions,[]);}finally{release.resolve();await save;await queued;await f.close();}
});
test('started preparation sibling drains before recovery or queue successor',async()=>{
 const f=await fixture(),entered=deferred(),release=deferred();let save,queued,recovered=false;
 const failure=Error('first worker failed');
 try{
 save=f.compose({importProjectToSwbFormat:async p=>({project:p,tiffWriteShotIds:[],rollback:async()=>{recovered=true;}}),writeSwbMetadataToTiffs:()=>ports.mapWithConcurrency([0,1,2],2,async id=>{if(id===0)throw failure;if(id===2)throw Error('must stop claiming');entered.resolve();await release.promise;await fs.writeFile(f.dir+'/sibling','settled');})})(f.payload).catch(e=>e);
 await entered.promise;let completed=false;queued=ports.withLayerFileOperation(async()=>{completed=true;});await tick();await tick();const beforeRecovery=recovered,beforeSuccessor=completed;
 release.resolve();const error=await save;await queued;assert.equal(beforeRecovery,false);assert.equal(beforeSuccessor,false);assert.equal(error,failure);assert.equal(recovered,true);assert.equal(await fs.readFile(f.dir+'/sibling','utf8'),'settled');
 }finally{release.resolve();await save;await queued;await f.close();}
});
test('first reverse dependency recovery failure stops dependent restoration',async()=>{
 const f=await fixture();const original=Error('prepare'),rollback=Error('restore TIFF');let dependent=0;
 try{let error;try{await f.compose({writeSwbMetadataToTiffs:async()=>({rollback:async()=>{throw rollback;}}),syncSavedSwbBaseFingerprints:async()=>{throw original;},importProjectToSwbFormat:async p=>({project:p,tiffWriteShotIds:[],rollback:async()=>{dependent++;}})})(f.payload);}catch(e){error=e;}assert(error instanceof ports.SaveRecoveryIncompleteError);assert.deepEqual(error.errors,[original,rollback]);assert.equal(dependent,0);assert.equal(error.publicationOrCleanupStarted,false);}finally{await f.close();}
});
