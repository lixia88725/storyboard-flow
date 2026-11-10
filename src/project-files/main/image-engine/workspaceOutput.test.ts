import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
import {temporaryWorkspace} from '../../../../test/temporaryWorkspace';
import {openWorkspaceOutput,workspaceOutputDecisionHash} from './workspaceOutput';
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
  expect(await output.inspect(f.project)).toEqual([{shotId:'a',imageId:'ia',baselineNative:native('ia'),location:'active',name:r.files[0].name,expectedDigest:r.files[0].digest,observedDigest:hash('external'),observedIdentity:await physicalIdentity(target)}]);
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

describe('observed output decisions and batch isolation',()=>{
 const latest=async(root:string)=>{const dir=path.join(root,'.storyboard-flow/native-output-v1'),names=(await fs.readdir(dir)).filter(n=>n.endsWith('.json')).sort();return JSON.parse(await fs.readFile(path.join(dir,names.at(-1)!),'utf8'));};
 const withSources=async()=>{const g=await fixture();await g.output.close();const shared=await createWorkspaceRecoveryBudget({root:g.root});const output=await openWorkspaceOutput({...g.options,budget:shared});const {openWorkspaceSources}=await import('./workspaceSources');const sources=await openWorkspaceSources({root:g.root,writerAuthority:g.options.writerAuthority,budget:shared});return{...g,output,sources,shared};};
 it('keeps batch receipts and saved revision local even when an unrelated existing file changed',async()=>{
  const g=await fixture(),f=frozen(),saved=await g.output.save(f),target=at(g.root,saved.files[0]);await fs.writeFile(target,'external A');f.project.revision=9;f.commitHash=hash('dirty');f.project.shots[0].scriptText='unsaved B';f.project.parkedShots.push({id:'c',imageId:'ic',name:'C',scriptText:''});f.project.images.ic={id:'ic',content:{kind:'native',native:native('ic')}};f.resolvedImages={ic:{native:native('ic'),format:'tiff'}};
  const receipt=await g.output.appendPendingBatch(f,{shotIds:['c']});expect(receipt.files.map(e=>e.shotId)).toEqual(['c']);expect(await fs.readFile(target,'utf8')).toBe('external A');expect((await latest(g.root)).saved).toEqual({revision:1,commitHash:hash('head')});expect(g.capture).toHaveBeenCalledTimes(3);expect((await g.output.inspect(f.project))[0].baselineNative).toEqual(native('ia'));await g.output.close();
 });
 it('binds observation to full source identity and refuses identical-byte replacement before custody',async()=>{
  const g=await withSources(),f=frozen(),saved=await g.output.save(f),target=at(g.root,saved.files[0]);await fs.writeFile(target,'external');const row=(await g.output.inspect(f.project))[0],records=await latest(g.root),input=await g.output.observeSource(row);expect(input.expected).toMatchObject(row.observedIdentity!);expect(await latest(g.root)).toEqual(records);
  await fs.rename(target,target+'.evidence');await fs.writeFile(target,'external');await expect(g.output.observeSource(row)).rejects.toThrow('replaced');await expect(g.sources.registerBatch({importId:'stale',sources:[input]})).rejects.toThrow();expect(await fs.readFile(target+'.evidence','utf8')).toBe('external');await g.sources.close();await g.output.close();
 });
 it('requires actual retained external bytes before keepFlow and forces local recapture without claiming a native baseline',async()=>{
  const g=await withSources(),f=frozen(),saved=await g.output.save(f),target=at(g.root,saved.files[0]);await fs.writeFile(target,'external E1');const row=(await g.output.inspect(f.project))[0],input=await g.output.observeSource(row);await g.sources.registerBatch({importId:'external',sources:[input]});await g.sources.retain('external',input.id);const source={importId:'external',itemId:input.id,interpretationId:'photocraft-v1' as const},object=await g.sources.object(source,{verify:'full'}),receipt={projectId:'project',revision:2,commitHash:hash('choice'),operationId:'choice',changes:[{...row,retainedSource:{source,digest:object.digest,byteLength:object.byteLength}}]};
  await expect(g.output.acceptKeepFlow(receipt)).rejects.toThrow('custody');await g.output.acceptKeepFlow(receipt,g.sources);expect(await g.output.queryRefreshReceipt(workspaceOutputDecisionHash(receipt))).toBe('accepted');expect((await latest(g.root)).saved.revision).toBe(1);expect(await fs.readFile(target,'utf8')).toBe('external E1');
  await fs.writeFile(target,'external E2');const changed=(await g.output.inspect(f.project))[0];expect(changed.baselineNative).toBeNull();await expect(g.output.save(f)).rejects.toThrow('External output change');expect(await g.output.queryRefreshReceipt(workspaceOutputDecisionHash(receipt))).toBe('accepted');await fs.writeFile(target,'external E1');await g.output.save(f);expect(g.capture).toHaveBeenCalledTimes(3);expect(await fs.readFile(object.path,'utf8')).toBe('external E1');expect(g.shared.reservedBytes).toBe(0);expect(g.shared.actualBytes).toBe(await g.shared.measureActual());await g.sources.close();await g.output.close();
 });
 it('acknowledges a missing slot without Trash and refuses any foreign reappearance before exclusive rebuild',async()=>{
  const g=await fixture(),f=frozen(),saved=await g.output.save(f),target=at(g.root,saved.files[0]);await fs.rename(target,target+'.evidence');const row=(await g.output.inspect(f.project))[0],receipt={projectId:'project',revision:2,commitHash:hash('missing'),operationId:'missing',changes:[row]};await g.output.acceptKeepFlow(receipt);await fs.writeFile(target,'foreign');await expect(g.output.save(f)).rejects.toThrow('External output change');expect(await fs.readFile(target,'utf8')).toBe('foreign');await fs.rename(target,target+'.foreign');await g.output.save(f);expect(g.capture).toHaveBeenCalledTimes(3);expect(g.trash).not.toHaveBeenCalled();expect(await fs.readFile(target+'.foreign','utf8')).toBe('foreign');await g.output.close();
 });
 it('rechecks observation after custody and before durable keepFlow ACK',async()=>{
  let replace=false;const g=await fixture({fault:async p=>{if(replace&&p==='before-keep-flow-ack')await fs.writeFile(target,'E2');}}),f=frozen(),saved=await g.output.save(f),target=at(g.root,saved.files[0]);await fs.writeFile(target,'E1');const row=(await g.output.inspect(f.project))[0],receipt={projectId:'project',revision:2,commitHash:hash('choice'),operationId:'choice',changes:[{...row,retainedSource:{source:{importId:'external',itemId:'a',interpretationId:'photocraft-v1' as const},digest:hash('E1'),byteLength:2}}]};replace=true;await expect(g.output.acceptKeepFlow(receipt,{object:async()=>({digest:hash('E1'),byteLength:2,path:'unused',identity:{} as never})})).rejects.toThrow('changed');expect(await g.output.queryRefreshReceipt(workspaceOutputDecisionHash(receipt))).toBe('absent');expect((await g.output.inspect(f.project))[0].expectedDigest).toBe(saved.files[0].digest);await g.output.close();
 });
 it('queries durable Refresh history after newer disk changes and reopen without acknowledging new bytes',async()=>{
  const g=await fixture(),f=frozen(),saved=await g.output.save(f),target=at(g.root,saved.files[0]);await fs.writeFile(target,'E1');const row=(await g.output.inspect(f.project))[0],receipt={projectId:'project',revision:2,commitHash:hash('refresh'),changes:[{...row,observedDigest:row.observedDigest!,observedIdentity:row.observedIdentity!,native:native('E1'),format:'tiff' as const}]};await g.output.acceptRefresh(receipt);await fs.writeFile(target,'E2');expect(await g.output.queryRefreshReceipt(workspaceOutputDecisionHash(receipt))).toBe('accepted');await expect(g.output.acceptRefresh(receipt)).rejects.toThrow('changed');await g.output.close();const next=await openWorkspaceOutput(g.options);expect(await next.queryRefreshReceipt(workspaceOutputDecisionHash(receipt))).toBe('accepted');expect(await next.queryRefreshReceipt(hash('not accepted'))).toBe('absent');expect((await next.inspect(f.project))[0]).toMatchObject({expectedDigest:hash('E1'),observedDigest:hash('E2'),baselineNative:native('E1')});await next.close();
 });
});

describe('explicit retained readonly capture recovery',()=>{
 const operationId='99999999-1111-4111-8111-111111111111';
 it('retries the same append after drained unknown capture, reuses verified completed encoding and keeps old evidence',async()=>{
  const g=await fixture();await g.output.close();const shared=await createWorkspaceRecoveryBudget({root:g.root});let fail=true,encoded:string[]=[];const output=await openWorkspaceOutput({...g.options,budget:shared,captureImage:async input=>{encoded.push(input.shotId);if(input.shotId==='d'&&fail)throw Object.assign(Error('readonly reply lost'),{effect:'unknown'});return g.capture(input);}}),f=frozen();await output.save(f);const savedBefore=await fs.readFile(at(g.root,(await output.names(f.project))[0]));for(const id of ['c','d']){f.project.parkedShots.push({id,imageId:'i'+id,name:id,scriptText:''});f.project.images['i'+id]={id:'i'+id,content:{kind:'native',native:native('i'+id)}};}f.resolvedImages={ic:{native:native('ic'),format:'tiff'},id:{native:native('id'),format:'tiff'}};const batch={shotIds:['c','d']};await expect(output.appendPendingBatch(f,batch,{operationId})).rejects.toThrow('readonly reply lost');expect(await output.queryOperation(operationId)).toEqual({state:'retained'});expect(await fs.readdir(path.join(g.root,'Pending'))).toEqual([]);const original=path.join(g.root,'.storyboard-flow/native-output-v1/operations',operationId,'new-0.tif'),oldBytes=await fs.readFile(original);await expect(output.appendPendingBatch(f,batch,{operationId})).rejects.toMatchObject({code:'operation-retained'});await expect(output.retryRetainedCapture(f,batch,{operationId,readonlyCaptureSettled:false as true})).rejects.toThrow('settled');const changed=structuredClone(f);changed.commitHash=hash('different');await expect(output.retryRetainedCapture(changed,batch,{operationId,readonlyCaptureSettled:true})).rejects.toThrow('binding changed');fail=false;const receipt=await output.retryRetainedCapture(f,batch,{operationId,readonlyCaptureSettled:true});expect(receipt.operationId).toBe(operationId);expect(receipt.files.map(e=>e.shotId)).toEqual(['c','d']);expect(encoded.filter(x=>x==='c')).toHaveLength(1);expect(encoded.filter(x=>x==='d')).toHaveLength(2);expect(await fs.readFile(original)).toEqual(oldBytes);expect(await fs.readFile(at(g.root,(await output.names(f.project))[0]))).toEqual(savedBefore);expect(await output.queryOperation(operationId)).toEqual({state:'completed',receipt});expect(shared.reservedBytes).toBe(0);expect(shared.actualBytes).toBe(await shared.measureActual());expect(await output.retryRetainedCapture(f,batch,{operationId,readonlyCaptureSettled:true})).toEqual(receipt);await output.close();
 });
 it('recovers an all-missing first capture across reopen without inventing a new operation',async()=>{
  const g=await fixture({captureImage:async()=>{throw Object.assign(Error('readonly unknown'),{effect:'unknown'});}}),f=frozen();await expect(g.output.save(f,{operationId})).rejects.toThrow('readonly unknown');await g.output.close();const next=await openWorkspaceOutput({...g.options,captureImage:g.capture});const receipt=await next.retryRetainedCapture(f,undefined,{operationId,readonlyCaptureSettled:true});expect(receipt.operationId).toBe(operationId);expect(g.capture).toHaveBeenCalledTimes(2);expect(await next.queryOperation(operationId)).toEqual({state:'completed',receipt});await next.close();
 });
 it('reopens partial capture facts and later completed retry snapshots without recapturing the bound first image',async()=>{
  let stop=true;const encoded:string[]=[];const g=await fixture({captureImage:async input=>{encoded.push(input.shotId);if(input.shotId==='b'&&stop)throw Error('unknown reply');const bytes=Buffer.from(input.shotId);return{bytes,sha256:hash(bytes),layerCount:1};}}),f=frozen();await expect(g.output.save(f,{operationId})).rejects.toThrow('unknown reply');await g.output.close();const next=await openWorkspaceOutput(g.options);stop=false;const receipt=await next.retryRetainedCapture(f,undefined,{operationId,readonlyCaptureSettled:true});expect(encoded).toEqual(['a','b','b']);await next.close();const last=await openWorkspaceOutput(g.options);expect(await last.save(f,{operationId})).toEqual(receipt);expect(encoded).toEqual(['a','b','b']);await last.close();
 });
 it('refuses corrupt private completed capture instead of hiding it with a new export',async()=>{
  let count=0;const g=await fixture({captureImage:async input=>{if(++count===2)throw Error('reply lost');const bytes=Buffer.from(input.shotId);return{bytes,sha256:hash(bytes),layerCount:1};}}),f=frozen();await expect(g.output.save(f,{operationId})).rejects.toThrow('reply lost');const capture=path.join(g.root,'.storyboard-flow/native-output-v1/operations',operationId,'new-0.tif');await fs.writeFile(capture,'tampered');await expect(g.output.retryRetainedCapture(f,undefined,{operationId,readonlyCaptureSettled:true})).rejects.toThrow('changed or disappeared');expect(count).toBe(2);expect(await fs.readFile(capture,'utf8')).toBe('tampered');expect(await g.output.queryOperation(operationId)).toEqual({state:'retained'});expect((await fs.readdir(g.root)).filter(n=>n.endsWith('.tif'))).toEqual([]);await g.output.close();
 });
 it('recovers publication failure after retried preparation with the same receipt and no second capture',async()=>{
  let unknown=true,stop=false;const g=await fixture({captureImage:async input=>{if(unknown)throw Error('readonly unknown');const bytes=Buffer.from(input.shotId);return{bytes,sha256:hash(bytes),layerCount:1};},fault:async p=>{if(stop&&p==='after-publish')throw Error('publication interrupted');}}),f=frozen();await expect(g.output.save(f,{operationId})).rejects.toThrow('readonly unknown');unknown=false;stop=true;await expect(g.output.retryRetainedCapture(f,undefined,{operationId,readonlyCaptureSettled:true})).rejects.toMatchObject({effect:'unknown'});expect(await g.output.queryOperation(operationId)).toEqual({state:'pending'});stop=false;const receipt=await g.output.save(f,{operationId});expect(receipt.operationId).toBe(operationId);expect(await g.output.queryOperation(operationId)).toEqual({state:'completed',receipt});await g.output.close();
 });
});


describe('explicit current output observations',()=>{
 it('exposes a reverted baseline after an absent Refresh ACK without writing or changing the native baseline',async()=>{
  const g=await fixture(),f=frozen(),saved=await g.output.save(f),target=at(g.root,saved.files[0]),original=await fs.readFile(target);await fs.writeFile(target,'E1');const row=(await g.output.inspect(f.project))[0],receipt={projectId:'project',revision:2,commitHash:hash('Main accepted E1'),changes:[{...row,observedDigest:row.observedDigest!,observedIdentity:row.observedIdentity!,native:native('E1'),format:'tiff' as const}]};await fs.writeFile(target,original);await expect(g.output.acceptRefresh(receipt)).rejects.toThrow('changed');expect(await g.output.queryRefreshReceipt(workspaceOutputDecisionHash(receipt))).toBe('absent');expect(await g.output.inspect(f.project)).toEqual([]);
  const directory=path.join(g.root,'.storyboard-flow/native-output-v1'),records=await fs.readdir(directory);f.project.images.ia.content={kind:'native',native:native('E1')};const forced=await g.output.inspect(f.project,{includeShotIds:['a']});expect(forced).toEqual([{shotId:'a',imageId:'ia',name:saved.files[0].name,location:'active',expectedDigest:saved.files[0].digest,observedDigest:saved.files[0].digest,observedIdentity:await physicalIdentity(target),baselineNative:native('ia')}]);expect((await g.output.observeSource(forced[0])).expected).toMatchObject(forced[0].observedIdentity!);expect(await fs.readdir(directory)).toEqual(records);expect(g.capture).toHaveBeenCalledTimes(2);expect(await g.output.inspect(f.project,{includeShotIds:[]})).toEqual([]);await g.output.close();
 });
 it('refuses unknown, duplicate, non-live, mismatched-image and heterogeneous forced IDs',async()=>{
  const g=await fixture(),f=frozen();await g.output.save(f);for(const includeShotIds of [['unknown'],['a','a'],['a',1],new Array(1),'a'])await expect(g.output.inspect(f.project,{includeShotIds:includeShotIds as readonly string[]})).rejects.toMatchObject({code:'invalid-input'});const removed=structuredClone(f.project);removed.shots.shift();removed.dialogues=[];delete removed.images.ia;await expect(g.output.inspect(removed,{includeShotIds:['a']})).rejects.toMatchObject({code:'invalid-input'});const changed=structuredClone(f.project);changed.shots[0].imageId='ic';changed.images.ic={id:'ic',content:{kind:'native',native:native('ic')}};delete changed.images.ia;await expect(g.output.inspect(changed,{includeShotIds:['a']})).rejects.toMatchObject({code:'invalid-input'});await g.output.close();
 });
});

describe('source-backed output without native hydration',()=>{
 const source={importId:'originals',itemId:'ia',interpretationId:'photocraft-v1' as const};
 async function sourceFixture(fault?:WorkspaceOutputOptions['fault']){
  const g=await fixture();await g.output.close();const original=path.join(g.root,'original.bytes');await fs.writeFile(original,'II\x2a\0retained pixel/layer bytes');
  const object=async()=>{const bytes=await fs.readFile(original),st=await fs.lstat(original,{bigint:true});return{path:original,digest:hash(bytes),byteLength:bytes.length,identity:{dev:String(st.dev),ino:String(st.ino),size:String(st.size),mtimeNs:String(st.mtimeNs),ctimeNs:String(st.ctimeNs)}};};const pinned=await object();
  const custody={object:vi.fn(async()=>{const current=await object();if(current.digest!==pinned.digest||JSON.stringify(current.identity)!==JSON.stringify(pinned.identity))throw Error('Original source changed');return current;})};
  const captureSource=vi.fn(async(input:Parameters<NonNullable<WorkspaceOutputOptions['captureSource']>>[0])=>{const bytes=Buffer.concat([await fs.readFile(input.object.path),Buffer.from(JSON.stringify(input.metadata))]);return{bytes,sha256:hash(bytes),layerCount:null};});
  const options={...g.options,sourceCustody:custody,captureSource,fault},output=await openWorkspaceOutput(options),f=frozen();f.project.images.ia.content={kind:'source',source};f.resolvedImages.ia={native:null,source,format:'tiff'};
  return{...g,original,custody,captureSource,options,output,f};
 }
 it('saves unhydrated source with authoritative text, reuses across revisions and reopen; native edits regenerate only that image',async()=>{
  const g=await sourceFixture(),original=await fs.readFile(g.original),first=await g.output.save(g.f);expect(first.files[0]).toMatchObject({native:null,source});expect(g.capture).toHaveBeenCalledTimes(1);expect(g.captureSource).toHaveBeenCalledTimes(1);expect(await fs.readFile(at(g.root,first.files[0]),'utf8')).toContain('action');const bytes=await fs.readFile(at(g.root,first.files[0]));g.f.project.revision++;g.f.commitHash=hash('next');await g.output.save(g.f);expect(g.captureSource).toHaveBeenCalledTimes(1);await g.output.close();const reopened=await openWorkspaceOutput(g.options);await reopened.save(g.f);expect(g.captureSource).toHaveBeenCalledTimes(1);expect(await fs.readFile(at(g.root,first.files[0]))).toEqual(bytes);
  g.f.project.images.ia.content={kind:'native',native:native('edited')};g.f.resolvedImages.ia={native:native('edited'),format:'tiff'};g.f.project.revision++;g.f.commitHash=hash('edit');await reopened.save(g.f);expect(g.capture).toHaveBeenCalledTimes(2);expect(await fs.readFile(g.original)).toEqual(original);await reopened.close();
 });
 it('renames/moves a cold source into Pending without recapturing and overlays changed text before output',async()=>{
  const g=await sourceFixture(),r=await g.output.save(g.f);g.f.project.parkedShots.push(g.f.project.shots.shift()!);g.f.project.revision++;g.f.commitHash=hash('park');const moved=await g.output.save(g.f);expect(moved.files.find(v=>v.shotId==='a')?.location).toBe('parked');expect(g.captureSource).toHaveBeenCalledTimes(1);g.f.project.parkedShots[0].scriptText='changed text';await g.output.save(g.f);expect(g.captureSource).toHaveBeenCalledTimes(2);expect(await fs.readFile(at(g.root,moved.files.find(v=>v.shotId==='a')!),'utf8')).toContain('changed text');await expect(fs.stat(at(g.root,r.files[0]))).rejects.toThrow();await g.output.close();
 });
 it('rejects changed source custody, mismatched source binding, and source hints on edited images before publication',async()=>{
  const g=await sourceFixture(),mismatch=structuredClone(g.f);mismatch.resolvedImages.ia={native:null,source:{...source,itemId:'other'},format:'tiff'};await expect(g.output.save(mismatch)).rejects.toThrow('matching settled');const edited=structuredClone(g.f);edited.project.images.ia.content={kind:'native',native:native('edit')};await expect(g.output.save(edited)).rejects.toThrow('matching settled');await g.output.save(g.f);await fs.writeFile(g.original,'changed source');await expect(g.output.save(g.f)).rejects.toThrow('Original source changed');expect(g.captureSource).toHaveBeenCalledTimes(1);await g.output.close();
 });
 it('retains source captures and recovers interrupted target publication without repeating conversion',async()=>{
  let interrupt=true;const g=await sourceFixture(async point=>{if(point==='after-publish'&&interrupt)throw Error('injected publication loss');}),operationId='d4e3ff51-c59f-4b55-9a1a-fd8ec17b96aa';await expect(g.output.save(g.f,{operationId})).rejects.toMatchObject({effect:'unknown'});expect(g.output.hasObligations()).toBe(true);interrupt=false;await g.output.recover();const receipt=await g.output.save(g.f,{operationId});expect(g.captureSource).toHaveBeenCalledTimes(1);expect(receipt.files[0]).toMatchObject({native:null,source});await g.output.close();const next=await openWorkspaceOutput(g.options);expect(await next.save(g.f,{operationId})).toEqual(receipt);await next.close();
 });
 it('persists unknown source layer counts across retained-capture reopen and retry without inventing a layer count',async()=>{
  const g=await sourceFixture();await g.output.close();let fail=true;const output=await openWorkspaceOutput({...g.options,captureImage:async input=>{if(fail)throw Error('native capture interrupted');return g.capture(input);}}),operationId='62f870eb-e19b-4c54-a8a9-b08a17c2178a';await expect(output.save(g.f,{operationId})).rejects.toThrow('native capture interrupted');await output.close();const records=path.join(g.root,'.storyboard-flow/native-output-v1'),last=(await fs.readdir(records)).filter(n=>n.endsWith('.json')).sort().at(-1)!,journal=JSON.parse(await fs.readFile(path.join(records,last),'utf8'));expect(journal.operationFacts[operationId].captures[0]).toMatchObject({layerCount:null,entry:{native:null,source}});fail=false;const reopened=await openWorkspaceOutput(g.options);await reopened.retryRetainedCapture(g.f,undefined,{operationId,readonlyCaptureSettled:true});expect(g.captureSource).toHaveBeenCalledTimes(1);await reopened.close();
 });
 it('requires real positive layer counts on native captures and unknown on unparsed source copies',async()=>{
  const nativeOutput=await fixture({captureImage:async()=>{const bytes=Buffer.from('native');return{bytes,sha256:hash(bytes),layerCount:null as unknown as number};}});await expect(nativeOutput.output.save(frozen())).rejects.toThrow('Invalid native output capture');await nativeOutput.output.close();
  const g=await sourceFixture();await g.output.close();const output=await openWorkspaceOutput({...g.options,captureSource:async()=>{const bytes=Buffer.from('source');return{bytes,sha256:hash(bytes),layerCount:1 as unknown as null};}});await expect(output.save(g.f)).rejects.toThrow('Invalid native output capture');await output.close();
 });
 it('prepares a native Refresh baseline only for changed cold-source output and requires an explicit choice',async()=>{
  const g=await sourceFixture(),saved=await g.output.save(g.f);await fs.writeFile(at(g.root,saved.files[0]),'external');const {createWorkspaceRefresh}=await import('./workspaceRefresh'),ensureResolved=vi.fn(async()=>native('ia'));
  const refresh=createWorkspaceRefresh({owner:g.f.owner,store:{load:async()=>({commitHash:g.f.commitHash,commit:{after:g.f.project}}),hydration:async()=>null} as never,output:g.output,sources:()=>({} as never),project:()=>g.f.project,resolved:()=>null,ensureResolved,prepare:async()=>{throw Error('not expected');},replace:async()=>{throw Error('not expected');}});
  const preview=await refresh.preview();expect(ensureResolved.mock.calls).toEqual([['ia']]);expect(preview.items).toHaveLength(1);expect(preview.items[0]).toMatchObject({shotId:'a',conflict:true,canUseExternal:true});await expect(refresh.confirm('op','request',preview.planId,[])).rejects.toThrow('请选择');await g.output.close();
 });
 it('refuses target races while preserving source and foreign bytes',async()=>{
  let target='';const g=await sourceFixture(async point=>{if(point==='before-publish'&&target)await fs.writeFile(target,'foreign race');});const names=await g.output.names(g.f.project);target=at(g.root,names.find(v=>v.shotId==='a')!);const original=await fs.readFile(g.original);await expect(g.output.save(g.f)).rejects.toMatchObject({effect:'unknown'});expect(await fs.readFile(target,'utf8')).toBe('foreign race');expect(await fs.readFile(g.original)).toEqual(original);expect(g.output.hasObligations()).toBe(true);
 });
});
