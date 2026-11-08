import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { createHash } from 'node:crypto';
import { temporaryWorkspace } from '../../../../test/temporaryWorkspace';
import { openImageProjectStore, type ImageProjectStoreOptions } from './projectStore';
import { openLegacyImageProjectStore } from './legacyProjectStore';
import type { HydrationRecord, ImageOperationIntent, NativeImageRef, ProjectCommitV2, ProjectV2 } from '../../../platform/contracts/imageProject';
const authority={assertHeld:async()=>{}};
const project=():ProjectV2=>({schema:'storyboard-flow.project',version:2,id:'project',revision:0,name:'Synthetic',shots:[{id:'a',imageId:'ia',name:'A',scriptText:''}],parkedShots:[],dialogues:[],images:{ia:{id:'ia',content:{kind:'source',source:{importId:'batch',itemId:'a',interpretationId:'reader1'}}}}});
const genesis=():ProjectCommitV2=>({schema:'flow.project-commit',version:1,commitId:'initial',previousCommitHash:null,beforeRevision:null,after:project()});
const ref:NativeImageRef={storeId:'native',documentId:'doc',versionId:'a'.repeat(64),manifestSha256:'b'.repeat(64),width:64,height:64};
const source={importId:'batch',itemId:'a',interpretationId:'reader1'};
const hydration:HydrationRecord={schema:'flow.image-hydration',version:1,source:{...source,digest:'c'.repeat(64),byteLength:10},hostBuildDigest:'d'.repeat(64),optionsHash:'e'.repeat(64),native:ref,operationId:'hydrate'};
const home=(root:string)=>path.join(root,'.storyboard-flow/image-project-journal-v1');
const digest=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function fixture(extra:Partial<ImageProjectStoreOptions>={}){const root=await temporaryWorkspace('journal-project-');const options={root,writerAuthority:authority,verifyNative:async()=>{},verifySource:async()=>{},...extra};return{root,options,store:await openImageProjectStore(options)};}
const intent=(id:string):ImageOperationIntent=>({schema:'flow.image-edit-intent',version:1,operationId:id,sessionId:'s',incarnation:'i',imageId:'ia',expected:project().images.ia.content,baseNative:ref,stroke:{tool:'brush',color:'#ff0000',size:4,opacity:.5,softness:0,points:[1,1,2,2]}});

it('uses one durable journal for project, complete original input, hydration and confirmation; reopens without per-edit side files',async()=>{
 const f=await fixture();const first=await f.store.commit(null,genesis());await f.store.publishHydration(hydration);await f.store.settleHydration(source,'hydrate',ref);await f.store.beginOperation(intent('paint'));
 const decision={kind:'image' as const,operationId:'paint',candidateId:'paint',imageId:'ia',expected:project().images.ia.content,baseNative:ref,prepared:ref};
 const next={...genesis(),commitId:'paint',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,images:{ia:{id:'ia',content:{kind:'native' as const,native:ref}}}},nativeDecision:decision};
 const second=await f.store.commit(first.commitHash,next);await f.store.confirmOperations([{commitHash:second.commitHash,operationId:'paint',native:ref}]);
 expect(await f.store.pendingOperations()).toEqual([]);expect(await f.store.unsettledDecisions()).toEqual([]);expect((await f.store.operationRecords())[0]).toMatchObject({intent:intent('paint'),resolution:{decision:'committed'}});await f.store.close();
 expect((await fs.readdir(home(f.root))).sort()).toEqual(['segment-0.log']);const reopened=await openImageProjectStore(f.options);expect((await reopened.load())?.commit).toEqual(next);expect(await reopened.pendingHydrations()).toEqual([]);expect(await reopened.operationRecords()).toHaveLength(1);await reopened.close();
});

it('publishes independent input/metadata only after their containing physical groups have synced',async()=>{
 const f=await fixture();const first=await f.store.commit(null,genesis());let release!:()=>void,entered=false,syncs=0;const gate=new Promise<void>(r=>release=r),open=fs.open.bind(fs);
 // The append handle is already open, so capture it by reopening through an audit.
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(args[0]===path.join(home(f.root),'segment-0.log')&&typeof args[1]==='number'){const sync=h.sync.bind(h);h.sync=async()=>{if(entered){syncs++;await gate;}return sync();};}return h;});
 await f.store.validateRecovery();entered=true;
 const a=f.store.beginOperation(intent('z-input')),b=f.store.commit(first.commitHash,{...genesis(),commitId:'metadata',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,name:'changed'}});let done=false;void Promise.all([a,b]).then(()=>done=true);await new Promise(r=>setTimeout(r,30));expect(syncs).toBe(1);expect(done).toBe(false);expect((await f.store.load())?.commitHash).toBe(first.commitHash);release();await Promise.all([a,b]);expect(syncs).toBeGreaterThanOrEqual(1);expect(syncs).toBeLessThanOrEqual(2);spy.mockRestore();await f.store.close();
});

it('rejects legacy data and makes the old writer reject a new journal project rather than initialize it',async()=>{
 const f=await fixture();await f.store.commit(null,genesis());await f.store.close();await expect(openLegacyImageProjectStore(f.options)).rejects.toMatchObject({code:'conflict'});
 const root=await temporaryWorkspace('legacy-journal-'),options={...f.options,root};const old=await openLegacyImageProjectStore(options);await old.commit(null,genesis());await old.close();await expect(openImageProjectStore(options)).rejects.toThrow('Legacy/unknown');
});

it('preserves a final unsealed tail and continues in a bound immutable segment without adopting the partial commit',async()=>{
 const f=await fixture();const first=await f.store.commit(null,genesis());await f.store.close();const file=path.join(home(f.root),'segment-0.log'),before=await fs.readFile(file);await fs.appendFile(file,Buffer.from('FLOWGRP1partial'));const damaged=await fs.readFile(file);
 const reopened=await openImageProjectStore(f.options);expect((await reopened.load())?.commitHash).toBe(first.commitHash);await reopened.commit(first.commitHash,{...genesis(),commitId:'after-tail',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,name:'after'}});await reopened.close();expect(await fs.readFile(file)).toEqual(damaged);expect(digest(before)).not.toBe(digest(damaged));const continuation=JSON.parse(await fs.readFile(path.join(home(f.root),'continuation-1.json'),'utf8'));expect(continuation).toMatchObject({previousSha256:digest(damaged),validBytes:before.length});const again=await openImageProjectStore(f.options);expect((await again.load())?.commit.after.name).toBe('after');await again.close();
});

it('refuses complete sealed-group corruption, including same-length mutation through indexed reads and recovery audit',async()=>{
 const f=await fixture();await f.store.commit(null,genesis());await f.store.beginOperation(intent('input'));const file=path.join(home(f.root),'segment-0.log'),raw=await fs.readFile(file),at=raw.indexOf(Buffer.from('#ff0000'));expect(at).toBeGreaterThan(0);raw[at+1]='a'.charCodeAt(0);await fs.writeFile(file,raw);await expect(f.store.operationRecords()).rejects.toThrow('changed');await expect(f.store.validateRecovery()).rejects.toThrow('corruption');await f.store.close().catch(()=>{});await expect(openImageProjectStore(f.options)).rejects.toThrow('corruption');expect(await fs.readFile(file)).toEqual(raw);
});

it('reconciles a successful append with lost sync acknowledgement by original commit ID without duplicate revision',async()=>{
 const f=await fixture();const first=await f.store.commit(null,genesis());const open=fs.open.bind(fs);let armed=false;
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(args[0]===path.join(home(f.root),'segment-0.log')&&typeof args[1]==='number'){const sync=h.sync.bind(h);h.sync=async()=>{await sync();if(armed){armed=false;throw Error('lost fsync ACK');}};}return h;});await f.store.validateRecovery();armed=true;
 const record={...genesis(),commitId:'unknown',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,name:'durable-unknown'}};await expect(f.store.commit(first.commitHash,record)).rejects.toMatchObject({effect:'unknown'});expect((await f.store.load())?.commitHash).toBe(first.commitHash);spy.mockRestore();await f.store.validateRecovery();const receipt=await f.store.commit(first.commitHash,record);expect(receipt.commit.after.revision).toBe(1);expect(await f.store.committed()).toHaveLength(2);await f.store.close();
});

it('does not overspend the one shared actual/reserved budget across concurrently admitted facts',async()=>{
 let outside=0;const f=await fixture({maxRecoveryBytes:12000,reservedRecoveryBytes:async()=>outside});await f.store.commit(null,genesis());outside=11000;
 const outcomes=await Promise.allSettled(Array.from({length:4},(_,n)=>f.store.beginOperation(intent('input'+n))));expect(outcomes.some(r=>r.status==='rejected')).toBe(true);outside=0;await f.store.validateRecovery();expect((await f.store.operationRecords()).length).toBeLessThan(4);await f.store.close();
});

it('coalesces same-ID concurrent input retries before sync while rejecting changed original input',async()=>{
 const f=await fixture();await f.store.commit(null,genesis());const same=intent('same');const a=f.store.beginOperation(same),b=f.store.beginOperation(same),changed=f.store.beginOperation({...same,stroke:{...same.stroke,opacity:.25}});await expect(changed).rejects.toThrow('changed original input');await Promise.all([a,b]);expect(await f.store.operationRecords()).toHaveLength(1);await f.store.close();
});

it('reopening verifies every historical image version, including versions no longer selected at head',async()=>{
 const f=await fixture();const first=await f.store.commit(null,genesis());const native={...project(),revision:1,images:{ia:{id:'ia',content:{kind:'native' as const,native:ref}}}};const second=await f.store.commit(first.commitHash,{...genesis(),commitId:'native-import',previousCommitHash:first.commitHash,beforeRevision:0,after:native});await f.store.commit(second.commitHash,{...genesis(),commitId:'remove-native',previousCommitHash:second.commitHash,beforeRevision:1,after:{...project(),revision:2}});await f.store.close();await expect(openImageProjectStore({...f.options,verifyNative:async()=>{throw Error('historical version damaged');}})).rejects.toThrow('historical version damaged');
});

it('never treats same-name directories or links as valid preexisting lease evidence',async()=>{
 const root=await temporaryWorkspace('journal-lease-evidence-'),legacy=path.join(root,'.storyboard-flow/image-project-v2');await fs.mkdir(legacy,{recursive:true});await fs.mkdir(path.join(legacy,'writer.lock'));const options={root,writerAuthority:authority,verifyNative:async()=>{},verifySource:async()=>{}};await expect(openImageProjectStore(options)).rejects.toThrow('Unsafe lease evidence');await fs.rmdir(path.join(legacy,'writer.lock'));await fs.symlink(path.join(root,'outside'),path.join(legacy,'owner.json'));await expect(openImageProjectStore(options)).rejects.toThrow('symlink');
});

it('the actual c401472 writer in an independent Node process refuses the new project format before editing',async()=>{
 const f=await fixture();await f.store.commit(null,genesis());await f.store.close();const runtime=path.join(f.root,'old-runtime');await fs.mkdir(runtime);await fs.writeFile(path.join(runtime,'package.json'),'{"type":"module"}');const src=fileURLToPath(new URL('../../../',import.meta.url));const names=['project-files/main/image-engine/projectStore','project-files/main/persistence/canonicalJson','project-files/main/persistence/fileOps','project-files/main/persistence/errors','project-files/main/workspacePhysicalWriterGate','session/core/imageProjectModel','session/core/imageProjectValues','platform/contracts/flowPresentation'];
 for(const name of names){const code=name.endsWith('/projectStore')?execFileSync('git',['show','c401472:src/'+name+'.ts'],{encoding:'utf8'}):await fs.readFile(path.join(src,name+'.ts'),'utf8'),out=path.join(runtime,name+'.js');await fs.mkdir(path.dirname(out),{recursive:true});await fs.writeFile(out,ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);}
 const script=path.join(runtime,'old.mjs');await fs.writeFile(script,`import {openImageProjectStore} from './project-files/main/image-engine/projectStore.js';try{await openImageProjectStore({root:process.argv[2],writerAuthority:{assertHeld:async()=>{}},verifyNative:async()=>{},verifySource:async()=>{}});process.exitCode=9;}catch(e){console.log(JSON.stringify({code:e.code,message:e.message}));}`);
 const child=spawn(process.execPath,[script,f.root],{stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);const code=await new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});expect(code).toBe(0);expect(JSON.parse(output)).toMatchObject({code:'conflict',message:'Invalid project head'});const again=await openImageProjectStore(f.options);expect((await again.load())?.commit.after.revision).toBe(0);await again.close();
});

it('flushes an admitted decision without waiting for the next slow reference verification',async()=>{
 let entered=false,release!:()=>void;const gate=new Promise<void>(r=>release=r);const f=await fixture({verifyNative:async()=>{entered=true;await gate;}});const first=await f.store.commit(null,genesis());const aRecord={...genesis(),commitId:'a',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,name:'first ready'}};// Hash uses the same canonical bytes as the Interface.
 const {canonicalJson}=await import('../persistence/canonicalJson');const expected=digest(Buffer.from(canonicalJson(aRecord)+'\n'));
 const a=f.store.commit(first.commitHash,aRecord),b=f.store.commit(expected,{...genesis(),commitId:'b',previousCommitHash:expected,beforeRevision:1,after:{...project(),revision:2,images:{ia:{id:'ia',content:{kind:'native',native:ref}}}}});
 try{for(let n=0;!entered&&n<1000;n++)await new Promise(r=>setTimeout(r,1));expect(entered).toBe(true);const result=await Promise.race([a,new Promise<never>((_,reject)=>setTimeout(()=>reject(Error('ready decision blocked by later verify')),500))]);expect(result.commitHash).toBe(expected);expect((await f.store.load())?.commitHash).toBe(expected);}finally{release();await Promise.all([a,b]);await f.store.close();}
});

it('keeps source references exact across hydration publication and replay',async()=>{
 const f=await fixture({verifySource:async(ref)=>{expect(Object.keys(ref).sort()).toEqual(['importId','interpretationId','itemId']);}});await f.store.commit(null,genesis());await f.store.publishHydration(hydration);await f.store.close();const reopened=await openImageProjectStore(f.options);expect(await reopened.hydration(source)).toEqual(hydration);await reopened.close();
});

for(const missing of ['segment','directory'])it(`refuses an existing project's missing journal ${missing}, preserving the writer gate and all remaining evidence`,async()=>{
 const f=await fixture();await f.store.commit(null,genesis());await f.store.close();const gate=path.join(f.root,'.storyboard-flow/image-project-v2/head.json'),original=await fs.readFile(gate),file=path.join(home(f.root),'segment-0.log');await fs.unlink(file);if(missing==='directory')await fs.rmdir(home(f.root));await expect(openImageProjectStore(f.options)).rejects.toThrow();expect(await fs.readFile(gate)).toEqual(original);expect(await fs.access(file).then(()=>true,()=>false)).toBe(false);if(missing==='directory')expect(await fs.access(home(f.root)).then(()=>true,()=>false)).toBe(false);
});

it('does not guess that an existing writer gate with an empty first segment is a fresh project',async()=>{
 const f=await fixture();await f.store.close();const file=path.join(home(f.root),'segment-0.log');await fs.writeFile(file,'');await expect(openImageProjectStore(f.options)).rejects.toThrow('initialization incomplete');expect((await fs.stat(file)).size).toBe(0);
});

it('rejects a running audit of a truncated-empty first segment without publishing an empty in-memory head or admitting writes',async()=>{
 const f=await fixture();const first=await f.store.commit(null,genesis()),file=path.join(home(f.root),'segment-0.log');await fs.writeFile(file,'');await expect(f.store.validateRecovery()).rejects.toThrow('initialization incomplete');expect((await f.store.load())?.commitHash).toBe(first.commitHash);await expect(f.store.commit(first.commitHash,{...genesis(),commitId:'must-not-append',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1}})).rejects.toMatchObject({code:'busy'});expect((await fs.stat(file)).size).toBe(0);await f.store.close();
});

it('charges exact grouped journal growth to the same Root broker as source/output and keeps unknown grants through strict recovery',async()=>{
 const root=await temporaryWorkspace('journal-root-budget-'),{createWorkspaceRecoveryBudget}=await import('./workspaceBudget'),budget=await createWorkspaceRecoveryBudget({root,maxRecoveryBytes:256<<10}),options={root,writerAuthority:authority,verifyNative:async()=>{},verifySource:async()=>{},recoveryBudget:budget},store=await openImageProjectStore(options);const first=await store.commit(null,genesis());expect(budget.actualBytes).toBe(await budget.measureActual());expect(budget.reservedBytes).toBe(0);
 const external=await budget.reserve({operationId:'source-or-output-in-flight',bytes:(256<<10)-budget.actualBytes-256,purpose:'source'});await expect(store.commit(first.commitHash,{...genesis(),commitId:'quota',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,name:'over quota'}})).rejects.toMatchObject({code:'resource-limit'});await external.settleActual(0);
 let armed=false;const open=fs.open.bind(fs),spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(args[0]===path.join(home(root),'segment-0.log')&&typeof args[1]==='number'){const sync=h.sync.bind(h);h.sync=async()=>{await sync();if(armed){armed=false;throw Error('Root budget lost fsync acknowledgement');}};}return h;});await store.validateRecovery();armed=true;const record={...genesis(),commitId:'lost-budget-ack',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1,name:'durable'}};await expect(store.commit(first.commitHash,record)).rejects.toMatchObject({effect:'unknown'});expect(budget.reservedBytes).toBeGreaterThan(0);spy.mockRestore();await store.validateRecovery();expect(budget.reservedBytes).toBe(0);expect(budget.actualBytes).toBe(await budget.measureActual());expect((await store.commit(first.commitHash,record)).commit.after.revision).toBe(1);expect(await store.committed()).toHaveLength(2);await store.close();
});
it('accounts retained partial tails and continuation evidence exactly without freeing their unknown grant early',async()=>{
 const root=await temporaryWorkspace('journal-partial-root-budget-'),{createWorkspaceRecoveryBudget}=await import('./workspaceBudget'),budget=await createWorkspaceRecoveryBudget({root,maxRecoveryBytes:256<<10}),options={root,writerAuthority:authority,verifyNative:async()=>{},verifySource:async()=>{},recoveryBudget:budget},store=await openImageProjectStore(options),first=await store.commit(null,genesis());let armed=false;const open=fs.open.bind(fs),spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(args[0]===path.join(home(root),'segment-0.log')&&typeof args[1]==='number'){const write=h.write.bind(h);h.write=(async(...values:any[])=>{if(armed){armed=false;await(write as any)(values[0],values[1],100,values[3]);throw Error('100 physical partial bytes');}return(write as any)(...values);})as typeof h.write;}return h;});await store.validateRecovery();armed=true;await expect(store.commit(first.commitHash,{...genesis(),commitId:'partial',previousCommitHash:first.commitHash,beforeRevision:0,after:{...project(),revision:1}})).rejects.toMatchObject({effect:'unknown'});spy.mockRestore();const original=await fs.readFile(path.join(home(root),'segment-0.log'));expect(budget.reservedBytes).toBeGreaterThan(0);await store.validateRecovery();expect(await fs.readFile(path.join(home(root),'segment-0.log'))).toEqual(original);expect((await store.load())?.commitHash).toBe(first.commitHash);expect(budget.reservedBytes).toBe(0);expect(budget.actualBytes).toBe(await budget.measureActual());await store.close();
});
