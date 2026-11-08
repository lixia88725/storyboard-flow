import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {describe,it,expect,vi} from 'vitest';
import {temporaryWorkspace} from '../../../../test/temporaryWorkspace';
import {createImageWorkspaceCreation} from './workspaceCreation';
import {createWorkspaceRecoveryBudget} from './workspaceBudget';
import {acquireImageProjectLease} from '../../../platform/main/imageProjectLease';
import {openImageProjectStore} from './projectStore';
import {openSourceBackedImport,type SourceImportStore} from './sourceStore';
import {createProjectStore} from '../persistence';
import {readPhotocraft} from '../formats/photocraft';
import type {WorkspaceCreationOptions} from './workspaceCreationContract';
import type {ProjectV1} from '../../../platform/contracts/refactorV1';
const naming={sceneCode:'scene',artistName:'artist',version:'v001'};
const signal=()=>({signal:new AbortController().signal});
const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const leaseBinary=()=>{const binary=process.env.FLOW_PROJECT_LEASE_BINARY;if(!binary)throw Error('FLOW_PROJECT_LEASE_BINARY must name a fixed real lease guard');return binary;};
async function fixture(extra:Partial<WorkspaceCreationOptions>={}){
 const root=await temporaryWorkspace('workspace-creation-'),out=path.join(root,'out');await fs.mkdir(out);
 const budgets:Awaited<ReturnType<typeof createWorkspaceRecoveryBudget>>[]=[];
 const factory=createImageWorkspaceCreation({leaseBinary:leaseBinary(),budgetFactory:async input=>{const budget=await createWorkspaceRecoveryBudget(input);budgets.push(budget);return budget;},...extra});
 return{root,out,factory,budgets,input:{destinationParent:out,folderName:'Created',name:'Synthetic',naming}};
}
async function load(root:string){
 const lease=await acquireImageProjectLease({root,binary:leaseBinary()}),imports=path.join(root,'.storyboard-flow/image-engine/imports');let source:SourceImportStore|undefined;
 try{
  const ids=await fs.readdir(imports).catch(e=>{if(e.code==='ENOENT')return[];throw e;});if(ids.length)source=await openSourceBackedImport({root,importId:ids[0]});
  const store=await openImageProjectStore({root,writerAuthority:lease,verifyNative:async()=>{throw Error('No native refs allowed');},verifySource:async ref=>{if(!source||!source.snapshot().items.some(x=>x.id===ref.itemId))throw Error('Unknown source');await source.object(ref.itemId);}});
  const head=await store.load();await store.close();return{project:head!.commit.after,source:source?.snapshot()};
 }finally{if(source)await source.close();await lease.release();}
}
async function png(color:string){return sharp({create:{width:3,height:2,channels:4,background:color}}).png().toBuffer();}
async function legacyFixture(root:string,opacity=128/255,protectedLayer=false){
 const source=path.join(root,'legacy');await fs.mkdir(source);const base=await png('#2850aaff'),paint=await png('#dd442280'),assets=new Map([[hash(base),base],[hash(paint),paint]]);
 const image={id:'ia',revision:4,width:3,height:2,layers:[{id:'base',name:'Base',kind:'image' as const,visible:true,locked:protectedLayer,opacity:1,blendMode:'normal' as const,width:3,height:2,assetId:hash(base),...(protectedLayer?{sourceReference:{originalId:'original',digest:hash('original'),format:'psd' as const,previewPixels:hash('pixels')}}:{})},{id:'paint',name:'Paint',kind:'paint' as const,visible:true,locked:false,opacity,blendMode:'multiply' as const,width:3,height:2,assetId:hash(paint)}]};
 const project:ProjectV1={schema:'storyboard-flow.project',version:1,id:'legacy-id',revision:9,name:'Legacy',naming,shots:[{id:'a',imageId:'ia',name:'Active',scriptText:'action'}],parkedShots:[{id:'b',imageId:'ib',name:'Pending',scriptText:'parked'}],dialogues:[{id:'da',shotId:'a',text:'first'},{id:'db',shotId:'b',text:'pending line'}],images:{ia:image,ib:{...image,id:'ib',layers:image.layers.map((l,i)=>({...l,id:l.id+'b',visible:i===0}))}}};
 const saved=await createProjectStore().saveCheckpoint(source,project,async id=>assets.get(id)!);if(!saved.ok)throw Error(saved.error.message);await fs.mkdir(path.join(source,'.storyboard-flow/history'),{recursive:true});await fs.writeFile(path.join(source,'.storyboard-flow/history/keep.bin'),'history evidence');return{source,project,assets};
}
async function digestTree(root:string){const values:Record<string,string>={};const walk=async(dir:string,rel:string)=>{for(const name of(await fs.readdir(dir)).sort()){const at=path.join(dir,name),r=rel?rel+'/'+name:name,st=await fs.lstat(at);if(st.isDirectory())await walk(at,r);else values[r]=hash(await fs.readFile(at));}};await walk(root,'');return values;}

describe('native workspace creation with real filesystem and lease',()=>{
 it('publishes a zero-board journal and reopens it under the real new-root lease',async()=>{
  const f=await fixture(),created=await f.factory.createBlankProject(f.input,signal()),head=await load(created.root);
  expect(head.project).toMatchObject({version:2,revision:0,name:'Synthetic',shots:[],parkedShots:[],images:{}});expect(await fs.readdir(created.root)).toEqual(['.storyboard-flow']);expect(f.budgets[0].reservedBytes).toBe(0);
 });
 it('retains original image bytes and lazy source references in natural order without decoding or writing TIFFs',async()=>{
  const f=await fixture(),sources=path.join(f.root,'sources');await fs.mkdir(sources);for(const name of ['10.png','2.png','1.png'])await fs.writeFile(path.join(sources,name),await png('#224466ff'));const before=await digestTree(sources);
  const created=await f.factory.createImageProject({...f.input,source:{kind:'folder',folder:sources}},signal()),head=await load(created.root);expect(head.project.shots.map(s=>s.name)).toEqual(['1','2','10']);expect(Object.values(head.project.images).every(i=>i.content.kind==='source')).toBe(true);expect(head.source?.items.every(i=>i.state==='retained'&&i.hydration==='unhydrated')).toBe(true);expect(await fs.readdir(created.root)).toEqual(['.storyboard-flow']);expect(await digestTree(sources)).toEqual(before);expect(f.budgets[0].reservedBytes).toBe(0);
 });
 it('cancels before creation without writes and cancels between source copies while preserving the settled first original',async()=>{
  const f=await fixture(),controller=new AbortController();controller.abort();await expect(f.factory.createBlankProject(f.input,{signal:controller.signal})).rejects.toMatchObject({name:'AbortError'});expect(await fs.readdir(f.out)).toEqual([]);
  const sources=path.join(f.root,'sources');await fs.mkdir(sources);for(const name of['1.png','2.png'])await fs.writeFile(path.join(sources,name),await png('#112233ff'));const stop=new AbortController();let retained='';try{await f.factory.createImageProject({...f.input,source:{kind:'folder',folder:sources}},{signal:stop.signal,onProgress:p=>{if(p.phase==='read'&&p.done===1)stop.abort();}});}catch(e){retained=(e as {retainedRoot:string}).retainedRoot;expect((e as Error).name).toBe('AbortError');}
  expect(retained).toContain('.flow-native-create-');expect((await fs.readdir(path.join(retained,'.storyboard-flow/image-engine/originals'))).some(n=>n.endsWith('.bin'))).toBe(true);expect(await fs.readdir(f.out)).not.toContain('Created');
 });
 it('refuses destination aliases, case collisions and publication races without overwriting foreign data',async()=>{
  const f=await fixture(),alias=path.join(f.root,'alias');await fs.symlink(f.out,alias);await expect(f.factory.createBlankProject({...f.input,destinationParent:alias},signal())).rejects.toThrow('canonical');await fs.mkdir(path.join(f.out,'created'));await fs.writeFile(path.join(f.out,'created/keep'),'foreign');await expect(f.factory.createBlankProject(f.input,signal())).rejects.toThrow('already exists');expect(await fs.readFile(path.join(f.out,'created/keep'),'utf8')).toBe('foreign');
  const g=await fixture({fault:async(_point,{target})=>{await fs.mkdir(target);await fs.writeFile(path.join(target,'foreign'),'keep');}});await expect(g.factory.createBlankProject(g.input,signal())).rejects.toThrow('Destination appeared');expect(await fs.readFile(path.join(g.out,'Created/foreign'),'utf8')).toBe('keep');
 });
 it('retains publication evidence on prepare rejection and refuses changed sources or insufficient shared budget',async()=>{
  const f=await fixture({prepare:async()=>{throw Error('readonly probe rejected');}});await expect(f.factory.createBlankProject(f.input,signal())).rejects.toThrow('evidence retained at '+path.join(f.out,'Created'));expect((await load(path.join(f.out,'Created'))).project.shots).toEqual([]);
  const g=await fixture({maxRecoveryBytes:8192});await expect(g.factory.createBlankProject(g.input,signal())).rejects.toThrow('quota exceeded');expect(await fs.readdir(g.out)).not.toContain('Created');
  const h=await fixture(),sources=path.join(h.root,'sources');await fs.mkdir(sources);for(const name of['1.png','2.png'])await fs.writeFile(path.join(sources,name),await png('#112233ff'));await expect(h.factory.createImageProject({...h.input,source:{kind:'folder',folder:sources}},{signal:new AbortController().signal,onProgress:p=>{if(p.done===1&&p.phase==='read')void fs.writeFile(path.join(sources,'2.png'),'changed');}})).rejects.toThrow();
 });
 it('copies a legal ordinary V1 project with independent layer and composite verification while source bytes stay unchanged',async()=>{
  const f=await fixture(),legacy=await legacyFixture(f.root),before=await digestTree(legacy.source),inspection=await f.factory.inspectUpgrade(legacy.source);expect(inspection.issues).toEqual([]);
  const created=await f.factory.copyUpgrade({operationId:'upgrade',sourceRoot:legacy.source,projectId:inspection.projectId,sourceDigest:inspection.sourceDigest,destinationParent:f.out,folderName:'Upgraded',projectName:'Copy'},signal()),head=await load(created.root);
  expect(head.project.id).not.toBe(legacy.project.id);expect(head.project.name).toBe('Copy');expect(head.project.shots).toEqual(legacy.project.shots);expect(head.project.parkedShots).toEqual(legacy.project.parkedShots);expect(head.project.dialogues).toEqual(legacy.project.dialogues);expect(head.project.naming).toEqual(naming);expect(await digestTree(legacy.source)).toEqual(before);expect(await fs.readFile(path.join(created.root,'.storyboard-flow/legacy-copy-v1/.storyboard-flow/history/keep.bin'),'utf8')).toBe('history evidence');expect(f.budgets[0].reservedBytes).toBe(0);
 },120000);
 it('rejects protected complex sources and fractional opacity that needs the pending native upgrade profile',async()=>{
  const f=await fixture(),old=await legacyFixture(f.root,0.5),inspection=await f.factory.inspectUpgrade(old.source);expect(inspection.issues.some(i=>i.code==='opacity-precision-unsupported')).toBe(true);await expect(f.factory.copyUpgrade({operationId:'op',sourceRoot:old.source,projectId:old.project.id,sourceDigest:inspection.sourceDigest,destinationParent:f.out,folderName:'Copy',projectName:'Copy'},signal())).rejects.toThrow('不量化');expect(await fs.readdir(f.out)).toEqual([]);
  const g=await fixture(),complex=await legacyFixture(g.root,1,true),view=await g.factory.inspectUpgrade(complex.source);expect(view.issues.some(i=>i.code==='protected-source-unsupported')).toBe(true);await expect(g.factory.copyUpgrade({operationId:'op',sourceRoot:complex.source,projectId:complex.project.id,sourceDigest:view.sourceDigest,destinationParent:g.out,folderName:'Copy',projectName:'Copy'},signal())).rejects.toThrow('复杂原件');
 });
 it('binds a copy upgrade to the inspected source snapshot and refuses archive symlinks',async()=>{
  const f=await fixture(),old=await legacyFixture(f.root),view=await f.factory.inspectUpgrade(old.source);await fs.writeFile(path.join(old.source,'new.txt'),'new external bytes');await expect(f.factory.copyUpgrade({operationId:'op',sourceRoot:old.source,projectId:old.project.id,sourceDigest:view.sourceDigest,destinationParent:f.out,folderName:'Copy',projectName:'Copy'},signal())).rejects.toThrow('changed since inspection');expect(await fs.readdir(f.out)).toEqual([]);await fs.symlink(f.out,path.join(old.source,'alias'));await expect(f.factory.inspectUpgrade(old.source)).rejects.toThrow('symbolic link');
 });
 it('allows exactly one concurrent exclusive publication and retains the losing stage',async()=>{
  const f=await fixture(),results=await Promise.allSettled([f.factory.createBlankProject(f.input,signal()),f.factory.createBlankProject(f.input,signal())]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);expect((await load(path.join(f.out,'Created'))).project.shots).toEqual([]);expect((await fs.readdir(f.out)).some(n=>n.startsWith('.flow-native-create-'))).toBe(true);
 });
 it('rejects independent reader semantic disagreement and retains immutable archives without executable permissions',async()=>{
  const f=await fixture({verifyLegacyLayers:async({bytes})=>{const read=await readPhotocraft(bytes,'tiff');return{...read.value,reference:read.reference,warnings:read.warnings,layers:read.value.layers.map((l,i)=>({...l,opacity:i===1?0.5:l.opacity}))};}}),old=await legacyFixture(f.root);await fs.writeFile(path.join(old.source,'original.sh'),'echo original',{mode:0o755});const before=await digestTree(old.source),view=await f.factory.inspectUpgrade(old.source);let retained='';try{await f.factory.copyUpgrade({operationId:'op',sourceRoot:old.source,projectId:old.project.id,sourceDigest:view.sourceDigest,destinationParent:f.out,folderName:'Copy',projectName:'Copy'},signal());}catch(e){expect((e as Error).message).toContain('layer semantics differ');retained=(e as{retainedRoot:string}).retainedRoot;}expect(retained).not.toBe('');expect(await digestTree(old.source)).toEqual(before);expect((await fs.stat(path.join(retained,'.storyboard-flow/legacy-copy-v1/original.sh'))).mode&0o111).toBe(0);expect(await fs.readdir(f.out)).not.toContain('Copy');
 },120000);
});
