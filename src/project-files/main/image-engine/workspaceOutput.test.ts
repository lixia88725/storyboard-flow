import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {temporaryWorkspace} from '../../../../test/temporaryWorkspace';
import {openWorkspaceOutput} from './workspaceOutput';
import type {WorkspaceOutputFrozen,WorkspaceOutputOptions,WorkspaceOutputBudget} from './workspaceOutputContract';
import {validWorkspaceOutputMetadataEnvelope,WORKSPACE_OUTPUT_METADATA_LIMIT} from './workspaceOutputContract';
import {createWorkspaceRecoveryBudget} from './workspaceBudget';

const hash=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const native=(id:string)=>({storeId:'store',documentId:id,versionId:hash('version'),manifestSha256:hash(id),width:8,height:8});
const frozen=():WorkspaceOutputFrozen=>({owner:{sessionId:'session',incarnation:'incarnation',workspaceEpoch:1},commitHash:hash('head'),project:{schema:'storyboard-flow.project',version:2,id:'project',revision:1,name:'Synthetic',naming:{sceneCode:'scene',artistName:'artist',version:'v001'},shots:[{id:'a',imageId:'ia',name:'A',scriptText:'action'},{id:'b',imageId:'ib',name:'B',scriptText:''}],parkedShots:[],dialogues:[{id:'line',shotId:'a',text:'hello'}],images:{ia:{id:'ia',content:{kind:'native',native:native('ia')}},ib:{id:'ib',content:{kind:'native',native:native('ib')}}}},resolvedImages:{ia:{native:native('ia'),format:'tiff'},ib:{native:native('ib'),format:'tiff'}}});
const budget:WorkspaceOutputBudget={reserve:async()=>({settleActual(){},retainUnknown(){}})};
async function fixture(overrides:Partial<WorkspaceOutputOptions>={}){
 const root=await temporaryWorkspace('workspace-output-'),trash=vi.fn(async(file:string)=>{await fs.unlink(file);}),capture=vi.fn(async(input:Parameters<WorkspaceOutputOptions['captureImage']>[0])=>{const bytes=Buffer.from(JSON.stringify({native:input.native,metadata:input.metadata}));return{bytes,sha256:hash(bytes),layerCount:3};});
 const options:WorkspaceOutputOptions={root,projectId:'project',writerAuthority:{assertHeld:async()=>{}},budget,captureImage:capture,trashItem:trash,...overrides};
 return{root,trash,capture,options,output:await openWorkspaceOutput(options)};
}
const at=(root:string,file:{name:string;location:'active'|'parked'})=>path.join(root,...(file.location==='parked'?['Pending',file.name]:[file.name]));
const physicalIdentity=async(file:string)=>{const st=await fs.lstat(file);return{dev:String(st.dev),ino:String(st.ino)};};

describe('native workspace physical output',()=>{
 it('publishes frozen native bytes and metadata with immutable identity receipts; repeated Save reuses bytes',async()=>{
  const {output,capture,root}=await fixture(),f=frozen(),receipt=await output.save(f);
  expect(receipt).toMatchObject({projectId:'project',revision:1,commitHash:f.commitHash});expect(receipt.files.map(e=>e.name)).toEqual(['Synthetic_scene_stb_artist_v001_0010.tif','Synthetic_scene_stb_artist_v001_0020.tif']);
  expect(capture).toHaveBeenCalledTimes(2);expect(capture.mock.calls[0][0]).toMatchObject({owner:f.owner,shotId:'a',metadata:{projectName:'Synthetic',shotName:'A',scriptText:'action',dialogues:[{id:'line',shotId:'a',text:'hello'}],presentation:null}});
  for(const file of receipt.files)expect(hash(await fs.readFile(at(root,file)))).toBe(file.digest);
  expect(output.hasObligations()).toBe(false);await output.save(f);expect(capture).toHaveBeenCalledTimes(2);await output.close();
 });
 it('stages every old name before publishing swaps and Pending moves; unchanged images are not recaptured',async()=>{
  const {output,capture,root}=await fixture(),f=frozen(),first=await output.save(f),bytes=await fs.readFile(at(root,first.files[0]));
  f.project.shots.reverse();f.project.revision++;const swapped=await output.save(f);expect(swapped.files.find(x=>x.shotId==='a')!.name).toContain('0020');expect(await fs.readFile(at(root,swapped.files.find(x=>x.shotId==='a')!))).toEqual(bytes);expect(capture).toHaveBeenCalledTimes(2);
  f.project.parkedShots.push(f.project.shots.pop()!);const parked=await output.save(f),a=parked.files.find(x=>x.shotId==='a')!;expect(a.location).toBe('parked');expect(await fs.readFile(at(root,a))).toEqual(bytes);expect(capture).toHaveBeenCalledTimes(2);await output.close();
 });
 it('reports external bytes read-only and refuses external modifications or foreign same-name targets',async()=>{
  const {output,root}=await fixture(),f=frozen(),r=await output.save(f),target=at(root,r.files[0]);await fs.writeFile(target,'external');
  expect(await output.inspect(f.project)).toEqual([{shotId:'a',location:'active',name:r.files[0].name,expectedDigest:r.files[0].digest,observedDigest:hash('external'),observedIdentity:await physicalIdentity(target)}]);
  await expect(output.save(f)).rejects.toThrow('External output change');expect(await fs.readFile(target,'utf8')).toBe('external');await output.close();
  const other=await fixture(),name=(await other.output.names(f.project))[0].name;await fs.writeFile(path.join(other.root,name),'foreign');await expect(other.output.save(f)).rejects.toThrow('Foreign output');expect(other.capture).not.toHaveBeenCalled();await other.output.close();
 });
 it('refuses symlink roots, Pending directories and managed files without following them',async()=>{
  const f=await fixture(),alias=path.join(f.root,'alias');await fs.symlink(f.root,alias);await expect(openWorkspaceOutput({...f.options,root:alias})).rejects.toThrow('Aliased');
  await fs.symlink(f.root,path.join(f.root,'Pending'));await expect(f.output.save(frozen())).rejects.toThrow('Unsafe output directory');await f.output.close();
  const other=await fixture(),r=await other.output.save(frozen()),file=at(other.root,r.files[0]);await fs.unlink(file);await fs.symlink('/does-not-exist',file);await expect(other.output.inspect(frozen().project)).rejects.toThrow();await other.output.close();
 });
 it('only dispatches Trash on explicit Save and does not accept missing files as an OS acknowledgement',async()=>{
  const {output,root,trash}=await fixture(),f=frozen(),r=await output.save(f);f.project.shots.splice(0,1);f.project.dialogues=[];
  expect(trash).not.toHaveBeenCalled();expect(await fs.readFile(at(root,r.files[0]))).toBeDefined();await output.save(f);expect(trash).toHaveBeenCalledTimes(1);expect(output.hasObligations()).toBe(false);await output.close();
  const unknown=await fixture({trashItem:async(file)=>{await fs.unlink(file);throw Error('lost OS response');}}),u=frozen();await unknown.output.save(u);u.project.shots.splice(0,1);u.project.dialogues=[];await expect(unknown.output.save(u)).rejects.toMatchObject({effect:'unknown'});await expect(unknown.output.recover()).rejects.toThrow('without acknowledgement');await expect(unknown.output.close()).rejects.toThrow('obligations');
 });
 it('append materializes only the new Pending batch while old active images and invalid draft naming remain untouched',async()=>{
  const {output,root,capture}=await fixture(),f=frozen(),r=await output.save(f),old=await fs.readFile(at(root,r.files[0]));
  f.project.name='x'.repeat(300);f.project.shots[0].scriptText='not saved';f.project.parkedShots.push({id:'c',imageId:'ic',name:'C',scriptText:''});f.project.images.ic={id:'ic',content:{kind:'native',native:native('ic')}};f.resolvedImages={ic:{native:native('ic'),format:'tiff'}};
  const receipt=await output.appendPendingBatch(f,{shotIds:['c'],sourceNames:{c:'source.png'}});expect(receipt.files).toHaveLength(1);expect(receipt.files[0]).toMatchObject({shotId:'c',name:'source.tif',location:'parked'});expect(await fs.readFile(at(root,r.files[0]))).toEqual(old);expect(capture).toHaveBeenCalledTimes(3);await output.close();
 });
 it('recovers a partially published rename after reopen without repeating native capture',async()=>{
  let enabled=false,count=0;const {root,options,output,capture}=await fixture({fault:async(point)=>{if(enabled&&point==='after-publish'&&++count===1)throw Error('simulated crash');}}),f=frozen();await output.save(f);f.project.shots.reverse();enabled=true;await expect(output.save(f)).rejects.toMatchObject({effect:'unknown'});expect(output.hasObligations()).toBe(true);
  vi.resetModules();const reopened=await (await import('./workspaceOutput')).openWorkspaceOutput({...options,fault:undefined});await reopened.recover();expect(reopened.hasObligations()).toBe(false);const receipt=await reopened.save(f);expect(capture).toHaveBeenCalledTimes(2);for(const file of receipt.files)expect(hash(await fs.readFile(at(root,file)))).toBe(file.digest);await reopened.close();
 });
 it('keeps changed output backups and refuses metadata or digest failures before publishing any board',async()=>{
  const {output,root,capture}=await fixture(),f=frozen(),first=await output.save(f);f.project.shots[0].scriptText='changed';await output.save(f);const dirs=await fs.readdir(path.join(root,'.storyboard-flow/native-output-v1/operations'));const backups=(await Promise.all(dirs.map(async d=>(await fs.readdir(path.join(root,'.storyboard-flow/native-output-v1/operations',d))).filter(n=>n.startsWith('old-'))))).flat();expect(backups).toHaveLength(1);expect(capture).toHaveBeenCalledTimes(3);await output.close();
  const broken=await fixture({captureImage:async()=>({bytes:Buffer.from('bad'),sha256:hash('different'),layerCount:1})});await expect(broken.output.save(frozen())).rejects.toThrow('Invalid native output');expect((await fs.readdir(broken.root)).filter(n=>n.endsWith('.tif'))).toEqual([]);expect(broken.output.hasObligations()).toBe(false);await broken.output.close();expect(first.files).toHaveLength(2);
 });
 it('requires a matching settled native binding, not a source hint or alternate ref',async()=>{
  const {output,capture}=await fixture(),f=frozen();f.resolvedImages.ia.native=native('other');await expect(output.save(f)).rejects.toThrow('matching settled');expect(capture).not.toHaveBeenCalled();await output.close();
 });
 it('fails closed on budget refusal and on revoked writer authority',async()=>{
  const budget=vi.fn(async()=>{throw Error('shared 8 GiB exhausted');}),f=await fixture({budget:{reserve:budget}});await expect(f.output.save(frozen())).rejects.toThrow('8 GiB');expect(f.capture).not.toHaveBeenCalled();
  let held=true;const g=await fixture({writerAuthority:{assertHeld:async()=>{if(!held)throw Error('lease revoked');}}});held=false;await expect(g.output.save(frozen())).rejects.toThrow('lease revoked');held=true;await g.output.close();
 });
 it('charges only retained recovery bytes; holds capture/backup grants atomically until publication settles',async()=>{
  let actual=0,reserved=0,unknown=0;const records:{bytes:number;purpose:string}[]=[];
  const broker:WorkspaceOutputBudget={reserve:async(input)=>{records.push(input);reserved+=input.bytes;let final:number|undefined;return{
   settleActual(bytes){if(final!==undefined){expect(bytes).toBe(final);return;}expect(bytes).toBeLessThanOrEqual(input.bytes);final=bytes;reserved-=input.bytes;actual+=bytes;},
   retainUnknown(){unknown++;}
  };}};
  const {output,root}=await fixture({budget:broker}),f=frozen();await output.save(f);expect(reserved).toBe(0);expect(records.filter(x=>x.purpose==='native-output-capture')).toHaveLength(2);
  const measure=async()=>{let total=0;const walk=async(dir:string)=>{for(const name of await fs.readdir(dir)){const file=path.join(dir,name),st=await fs.lstat(file);if(st.isDirectory())await walk(file);else total+=st.size;}};await walk(path.join(root,'.storyboard-flow/native-output-v1'));return total;};
  expect(actual).toBe(await measure());f.project.shots[0].scriptText='new words';await output.save(f);expect(actual).toBe(await measure());expect(records.some(x=>x.purpose==='native-output-backup')).toBe(true);expect(reserved).toBe(0);expect(unknown).toBe(0);await output.close();
 });
 it('resolves unknown grants only after a successful physical recovery, retaining backups',async()=>{
  let stop=false,unknown=0,reserved=0;const broker:WorkspaceOutputBudget={reserve:async({bytes})=>{reserved+=bytes;let done=false;return{retainUnknown(){unknown++;},settleActual(){if(!done){done=true;reserved-=bytes;}}};}};
  const {output}=await fixture({budget:broker,fault:async(point)=>{if(stop&&point==='after-stage')throw Error('interrupted stage');}}),f=frozen();await output.save(f);f.project.shots[0].scriptText='new';stop=true;await expect(output.save(f)).rejects.toMatchObject({effect:'unknown'});expect(unknown).toBeGreaterThan(0);expect(reserved).toBeGreaterThan(0);stop=false;await output.recover();expect(reserved).toBe(0);expect(output.hasObligations()).toBe(false);await output.close();
 });
 it('rejects case-folded external collisions and hardlinks; reports missing and replaced-identical outputs',async()=>{
  const {output,root,capture}=await fixture(),f=frozen(),name=(await output.names(f.project))[0].name;await fs.writeFile(path.join(root,name.toUpperCase()),'foreign');await expect(output.save(f)).rejects.toThrow('Foreign output');expect(capture).not.toHaveBeenCalled();await output.close();
  const g=await fixture(),receipt=await g.output.save(f),file=at(g.root,receipt.files[0]),bytes=await fs.readFile(file);await fs.rename(file,file+'.retained');await fs.writeFile(file,bytes);expect(await g.output.inspect(f.project)).toHaveLength(1);await expect(g.output.save(f)).rejects.toThrow('identity changed');await fs.unlink(file);expect((await g.output.inspect(f.project))[0].observedDigest).toBe(null);await fs.link(file+'.retained',file);await expect(g.output.inspect(f.project)).rejects.toThrow('Unsupported output file');await g.output.close();
 });
 it('rejects malformed, missing and hardlinked journal evidence on reopen',async()=>{
  const {output,root,options}=await fixture();await output.save(frozen());await output.close();const container=path.join(root,'.storyboard-flow/native-output-v1'),names=(await fs.readdir(container)).filter(n=>n.endsWith('.json')).sort();
  await fs.rename(path.join(container,names[0]),path.join(root,'first-retained.json'));await expect(openWorkspaceOutput(options)).rejects.toThrow('missing output journal');await fs.rename(path.join(root,'first-retained.json'),path.join(container,names[0]));await fs.link(path.join(container,names[0]),path.join(root,'linked-record'));await expect(openWorkspaceOutput(options)).rejects.toThrow('Aliased output journal');
 });
 it('reopens and retires an interrupted preparing record without publishing partial captures',async()=>{
  const g=await fixture(),f=frozen();await g.output.save(f);await g.output.close();
  let count=0;const h=await openWorkspaceOutput({...g.options,captureImage:async input=>{if(++count===2)throw Error('metadata not supported');return g.capture(input);}});f.project.name='renamed';await expect(h.save(f)).rejects.toThrow('metadata not supported');expect(h.hasObligations()).toBe(false);expect((await h.names(f.project))[0].name).toContain('renamed');await h.close();const reopened=await openWorkspaceOutput(g.options);expect(await reopened.inspect(frozen().project)).toEqual([]);await reopened.close();
 });
 it('accepts only the Main decided Refresh baseline and forces the next Save to overlay authoritative metadata',async()=>{
  const {output,root,capture}=await fixture(),f=frozen(),first=await output.save(f),file=first.files[0];await fs.writeFile(at(root,file),'external layered file');
  const external=native('external'),change={shotId:'a',imageId:'ia',name:file.name,location:file.location,expectedDigest:file.digest,observedDigest:hash('external layered file'),observedIdentity:await physicalIdentity(at(root,file)),native:external,format:'tiff' as const},receipt={projectId:'project',revision:2,commitHash:hash('refresh-cas'),changes:[change]};
  await output.acceptRefresh(receipt);await output.acceptRefresh(receipt);expect(capture).toHaveBeenCalledTimes(2);expect(await output.inspect(f.project)).toEqual([]);
  f.project.images.ia.content={kind:'native',native:external};f.resolvedImages.ia.native=external;f.project.revision=2;f.commitHash=receipt.commitHash;await output.save(f);expect(capture).toHaveBeenCalledTimes(3);expect(capture.mock.calls[2][0]).toMatchObject({shotId:'a',native:external,metadata:{scriptText:'action'}});await output.close();
 });
 it('refuses a stale Refresh receipt atomically without accepting another changed board',async()=>{
  const {output,root}=await fixture(),f=frozen(),first=await output.save(f);for(const file of first.files)await fs.writeFile(at(root,file),'external-'+file.shotId);
  const changes=await Promise.all(first.files.map(async file=>({shotId:file.shotId,imageId:file.imageId,name:file.name,location:file.location,expectedDigest:file.digest,observedDigest:hash('external-'+file.shotId),observedIdentity:await physicalIdentity(at(root,file)),native:native('external-'+file.imageId),format:'tiff' as const})));changes[1].observedDigest=hash('stale');await expect(output.acceptRefresh({projectId:'project',revision:2,commitHash:hash('refresh'),changes})).rejects.toThrow('changed during Refresh');expect(await output.inspect(f.project)).toHaveLength(2);await output.close();
 });
 it('reserves old-file staging before the first user-visible side effect and retires safe preparation failure',async()=>{
  let refuse=false;const broker:WorkspaceOutputBudget={reserve:async({purpose})=>{if(refuse&&purpose==='native-output-backup')throw Error('no backup capacity');return{settleActual(){},retainUnknown(){}};}};
  const {output,root}=await fixture({budget:broker}),f=frozen(),first=await output.save(f),old=await fs.readFile(at(root,first.files[0]));refuse=true;f.project.shots[0].scriptText='new';await expect(output.save(f)).rejects.toThrow('no backup capacity');expect(await fs.readFile(at(root,first.files[0]))).toEqual(old);expect(output.hasObligations()).toBe(false);await output.close();
 });
 it('preserves native-recovery protection markers and refuses multiple local output writers',async()=>{
  const g=await fixture();await expect(openWorkspaceOutput(g.options)).rejects.toMatchObject({code:'busy'});await fs.mkdir(path.join(g.root,'.storyboard-flow/workspace-recovery-v2'));await expect(g.output.save(frozen())).rejects.toThrow('protected by a recovery inventory');
 });
 it('uses independent grant identities with the real shared broker across captures, journals, backups and Trash',async()=>{
  const g=await fixture();await g.output.close();const broker=await createWorkspaceRecoveryBudget({root:g.root,maxRecoveryBytes:8*1024**3}),output=await openWorkspaceOutput({...g.options,budget:broker}),f=frozen();await output.save(f);f.project.shots[0].scriptText='new';await output.save(f);f.project.shots.splice(0,1);f.project.dialogues=[];await output.save(f);expect(broker.reservedBytes).toBe(0);expect(broker.actualBytes).toBe(await broker.measureActual());await output.close();
 });
});

describe('native output metadata envelope',()=>{
 const envelope=()=>({schema:'flow.native-output-metadata',version:2,projectId:'project',revision:4,shotId:'a',imageId:'ia',metadata:{projectName:'作品',shotName:'A',scriptText:'动作',dialogues:[{id:'line',shotId:'a',text:'你好'}],presentation:{mode:'expanded',dialogue:true}}});
 it('accepts versioned authoritative storyboard text and presentation without a V1 image tree',()=>{expect(validWorkspaceOutputMetadataEnvelope(envelope())).toBe(true);});
 it('rejects V1 images, native refs, wrong schema versions and cross-shot dialogue ownership',()=>{
  expect(validWorkspaceOutputMetadataEnvelope({...envelope(),image:{layers:[]}})).toBe(false);expect(validWorkspaceOutputMetadataEnvelope({...envelope(),native:native('ia')})).toBe(false);expect(validWorkspaceOutputMetadataEnvelope({...envelope(),version:1})).toBe(false);const value=envelope();value.metadata.dialogues[0].shotId='b';expect(validWorkspaceOutputMetadataEnvelope(value)).toBe(false);
 });
 it('enforces a UTF-8 byte budget and rejects sparse or duplicate dialogue rows',()=>{
  const value=envelope();value.metadata.scriptText='字'.repeat(Math.ceil(WORKSPACE_OUTPUT_METADATA_LIMIT/3));expect(validWorkspaceOutputMetadataEnvelope(value)).toBe(false);const rows=envelope();rows.metadata.dialogues.push({...rows.metadata.dialogues[0]});expect(validWorkspaceOutputMetadataEnvelope(rows)).toBe(false);expect(validWorkspaceOutputMetadataEnvelope({...envelope(),metadata:{...envelope().metadata,dialogues:new Array(1)}})).toBe(false);
 });
 it('refuses an oversized metadata batch before capturing or publishing any board',async()=>{const {output,capture,root}=await fixture(),f=frozen();f.project.shots[0].scriptText='字'.repeat(Math.ceil(WORKSPACE_OUTPUT_METADATA_LIMIT/3));await expect(output.save(f)).rejects.toThrow('supported envelope');expect(capture).not.toHaveBeenCalled();expect((await fs.readdir(root)).filter(n=>n.endsWith('.tif'))).toEqual([]);await output.close();});
});

describe('output integration identity and close obligations',()=>{
 const identity=async(file:string)=>{const st=await fs.lstat(file);return{dev:String(st.dev),ino:String(st.ino)};};
 it('rejects a repeated old Refresh ACK after same bytes appear at a new inode',async()=>{
  const g=await fixture(),f=frozen(),saved=await g.output.save(f),file=saved.files[0],target=at(g.root,file);await fs.writeFile(target,'external');const observedIdentity=await identity(target),receipt={projectId:'project',revision:2,commitHash:hash('refresh'),changes:[{shotId:file.shotId,imageId:file.imageId,name:file.name,location:file.location,expectedDigest:file.digest,observedDigest:hash('external'),observedIdentity,native:native('external'),format:'tiff' as const}]};
  await g.output.acceptRefresh(receipt);await fs.rename(target,target+'.retained');await fs.writeFile(target,'external');expect(await identity(target)).not.toEqual(observedIdentity);await expect(g.output.acceptRefresh(receipt)).rejects.toThrow('identity');await g.output.close();
 });
 it('updates only the replacement identity explicitly accepted by a new Main Refresh decision',async()=>{
  const g=await fixture(),f=frozen(),saved=await g.output.save(f),file=saved.files[0],target=at(g.root,file);await fs.writeFile(target,'external');const first={projectId:'project',revision:2,commitHash:hash('refresh'),changes:[{shotId:file.shotId,imageId:file.imageId,name:file.name,location:file.location,expectedDigest:file.digest,observedDigest:hash('external'),observedIdentity:await identity(target),native:native('external'),format:'tiff' as const}]};await g.output.acceptRefresh(first);await fs.rename(target,target+'.retained');await fs.writeFile(target,'external');const observedIdentity=await identity(target),next={...first,revision:3,commitHash:hash('new-refresh'),changes:[{...first.changes[0],expectedDigest:hash('external'),observedIdentity}]};await g.output.acceptRefresh(next);await g.output.acceptRefresh(next);expect(await g.output.inspect(f.project)).toEqual([]);f.project.images.ia.content={kind:'native',native:native('external')};f.resolvedImages.ia.native=native('external');await expect(g.output.save(f)).resolves.toMatchObject({projectId:'project'});await g.output.close();
 });
 it('makes successful close idempotent without releasing a subsequently opened owner',async()=>{
  const g=await fixture();await g.output.close();const next=await openWorkspaceOutput(g.options);await expect(g.output.close()).resolves.toBeUndefined();await expect(openWorkspaceOutput(g.options)).rejects.toMatchObject({code:'busy'});await next.close();await expect(next.close()).resolves.toBeUndefined();
 });
 it('retains the original owner after failed close and permits retry when its authority is restored',async()=>{
  let held=true;const g=await fixture({writerAuthority:{assertHeld:async()=>{if(!held)throw Error('lease unavailable');}}});held=false;await expect(g.output.close()).rejects.toThrow('lease unavailable');held=true;await expect(openWorkspaceOutput(g.options)).rejects.toMatchObject({code:'busy'});await expect(g.output.close()).resolves.toBeUndefined();await expect(g.output.close()).resolves.toBeUndefined();
 });
});

describe('durable output operation correlation',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 it('returns the original completed receipt across reopen without recapture or new disk records',async()=>{
  const g=await fixture(),f=frozen();expect(await g.output.queryOperation(id)).toEqual({state:'absent'});const receipt=await g.output.save(f,{operationId:id});expect(receipt.operationId).toBe(id);expect(await g.output.queryOperation(id)).toEqual({state:'completed',receipt});await g.output.close();
  const records=await fs.readdir(path.join(g.root,'.storyboard-flow/native-output-v1')),next=await openWorkspaceOutput(g.options);expect(await next.save(f,{operationId:id})).toEqual(receipt);expect(g.capture).toHaveBeenCalledTimes(2);expect(await fs.readdir(path.join(g.root,'.storyboard-flow/native-output-v1'))).toEqual(records);await next.close();
 });
 it('binds the full frozen input and append scope before retrying any side effect',async()=>{
  const g=await fixture(),f=frozen();await g.output.save(f,{operationId:id});const changed=structuredClone(f);changed.project.shots[0].scriptText='other';await expect(g.output.save(changed,{operationId:id})).rejects.toThrow('binding changed');await expect(g.output.appendPendingBatch(f,{shotIds:['a']},{operationId:id})).rejects.toThrow('binding changed');expect(g.capture).toHaveBeenCalledTimes(2);await g.output.close();
 });
 it('queries pending without effects and settles the same interrupted publication on retry',async()=>{
  let stop=true;const g=await fixture({fault:async p=>{if(stop&&p==='after-publish')throw Error('lost reply');}}),f=frozen();await expect(g.output.save(f,{operationId:id})).rejects.toMatchObject({effect:'unknown'});expect(await g.output.queryOperation(id)).toEqual({state:'pending'});vi.resetModules();stop=false;const next=await(await import('./workspaceOutput')).openWorkspaceOutput(g.options);const receipt=await next.save(f,{operationId:id});expect(receipt.operationId).toBe(id);expect(await next.queryOperation(id)).toEqual({state:'completed',receipt});expect(g.capture).toHaveBeenCalledTimes(2);await next.close();
 });
 it('does not repeat Trash after the completion acknowledgement is lost',async()=>{
  const g=await fixture(),f=frozen();await g.output.save(f);f.project.shots.shift();f.project.dialogues=[];const receipt=await g.output.save(f,{operationId:id});expect(g.trash).toHaveBeenCalledTimes(1);await g.output.close();const next=await openWorkspaceOutput(g.options);expect(await next.save(f,{operationId:id})).toEqual(receipt);expect(g.trash).toHaveBeenCalledTimes(1);await next.close();
 });
 it('keeps failed preparation as a retained fact and never guesses a duplicate capture',async()=>{
  const g=await fixture({captureImage:async()=>{throw Error('unsupported metadata');}}),f=frozen();await expect(g.output.save(f,{operationId:id})).rejects.toThrow('unsupported metadata');expect(await g.output.queryOperation(id)).toEqual({state:'retained'});await g.output.close();const next=await openWorkspaceOutput(g.options);await expect(next.save(f,{operationId:id})).rejects.toMatchObject({code:'operation-retained'});expect(await next.queryOperation(id)).toEqual({state:'retained'});await next.close();
 });
 it('accounts durable receipt snapshots with the actual shared budget',async()=>{
  const g=await fixture();await g.output.close();const broker=await createWorkspaceRecoveryBudget({root:g.root,maxRecoveryBytes:8*1024**3}),out=await openWorkspaceOutput({...g.options,budget:broker});await out.save(frozen(),{operationId:id});expect(broker.reservedBytes).toBe(0);expect(broker.actualBytes).toBe(await broker.measureActual());await out.close();
 });
});
