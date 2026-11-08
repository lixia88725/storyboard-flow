import {it,expect} from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {temporaryWorkspace} from '../../../test/temporaryWorkspace';
import {startImageEngine} from './imageEngineConnection';
import {createNativeSessionAdapter} from '../../project-files/main/image-engine/nativeSessionAdapter';
import type {WorkspaceOutputMetadataEnvelope} from '../../project-files/main/image-engine/workspaceOutputContract';
const hash=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
it('exports frozen immutable versions with the v2 Flow envelope, exact identity and independent layered/merged metadata reads',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST;if(!binary)throw Error('Real readonlyExportMetadataV1 host required');
 const root=await temporaryWorkspace('output-metadata-'),store=path.join(root,'native'),connection=startImageEngine({binary,store,sessionId:'metadata',incarnation:'one',budgetBytes:64<<20}),adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'}),d=adapter.driver;
 const envelope:WorkspaceOutputMetadataEnvelope={schema:'flow.native-output-metadata',version:2,projectId:'project',revision:7,shotId:'shot',imageId:'image',metadata:{projectName:'项目',shotName:'镜头',scriptText:'script <&>',dialogues:[{id:'line',shotId:'shot',text:'对白'}],presentation:{mode:'expanded',dialogue:true}}};
 try{
  await connection.ready;expect(connection.supports('readonlyExportMetadataV1')).toBe(true);
  const first=await d.prepareCreation('first',{kind:'new',width:32,height:24},{maxAdditionalBytes:2<<20});await d.settleCreation(first);await d.activate(first.native);let base=first.native;
  let context=await d.summary();let p=await d.prepareEdit('layer',base,{kind:'newLayer',name:'Overlay'},{expectedContextGeneration:context.contextGeneration});base=await d.accept(p,base);context=await d.summary();const top=context.activeLayerId!;
  p=await d.prepareEdit('red',base,{kind:'fill',layerId:top,x:0,y:0,color:[255,0,0,255],tolerance:0},{expectedContextGeneration:context.contextGeneration});base=await d.accept(p,base);context=await d.summary();
  p=await d.prepareEdit('opacity',base,{kind:'setLayer',layerId:top,patch:{opacity:.5}},{expectedContextGeneration:context.contextGeneration});base=await d.accept(p,base);const beforePixels=(await adapter.capture()).payload,identity=d.displayIdentity(),summary=await d.summary();
  const other=await d.prepareCreation('other',{kind:'new',width:16,height:8},{maxAdditionalBytes:2<<20});await d.settleCreation(other);
  await expect(d.exportVersion(base,'tiff',envelope)).rejects.toMatchObject({code:'busy',effect:'none'});await d.freeze();const frozenSummary=await d.summary();expect(frozenSummary.contextGeneration).toBe(summary.contextGeneration);expect(frozenSummary.layers).toEqual(summary.layers);
  const before=await fs.readFile(path.join(store,'versions',base.versionId+'.json')),requests:unknown[]=[];
  for(const [tag,ref,pixels] of [['active',base,beforePixels],['detached',other.native,new Uint8Array(16*8*4).fill(255)]] as const){
   const rgba=path.join(root,tag+'.rgba');await fs.writeFile(rgba,pixels);
   for(const format of ['tiff','psd'] as const){const result=await d.exportVersion(ref,format,envelope);expect(result).toMatchObject({versionId:ref.versionId,documentId:ref.documentId,layerCount:tag==='active'?2:1,metadataSha256:hash(new TextEncoder().encode(JSON.stringify(envelope)))});expect(result.sha256).toBe(hash(result.bytes));const file=path.join(root,`${tag}.${format}`);await fs.writeFile(file,result.bytes);requests.push({file,envelope,rgba,layerColors:tag==='active'?[[255,255,255,255],[255,0,0,255]]:[[255,255,255,255]]});}
  }
  const request=path.join(root,'oracle.json');await fs.writeFile(request,JSON.stringify(requests));const independent=await promisify(execFile)('/opt/homebrew/bin/python3.14',['native/photocraft/tests/output_metadata_oracle.py',request],{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:'/private/tmp/flow-image-engine-export-python'},maxBuffer:2<<20});const report=JSON.parse(independent.stdout);expect(report.map((r:any)=>r.layerCount)).toEqual([2,2,1,1]);expect(report[0].layerOpacityBytes).toContain(128);expect(report.every((r:any)=>r.mergedCompared&&r.layerPixelsCompared)).toBe(true);console.log('independent-output-metadata',independent.stdout.trim());
  expect(await fs.readFile(path.join(store,'versions',base.versionId+'.json'))).toEqual(before);expect(d.displayIdentity()).toEqual(identity);expect(await d.summary()).toEqual(frozenSummary);
  await expect(d.exportVersion(base,'tiff',envelope,1)).rejects.toMatchObject({code:'limit',effect:'none'});
  const invalid=structuredClone(envelope);invalid.metadata.dialogues[0].shotId='another';await expect(d.exportVersion(base,'tiff',invalid)).rejects.toMatchObject({code:'invalid-input',effect:'none'});
  const legacy={...connection,supports:(cap:Parameters<typeof connection.supports>[0])=>cap==='readonlyExportMetadataV1'?false:connection.supports(cap)};await expect(createNativeSessionAdapter({connection:legacy,storeRoot:store,storeId:'native'}).driver.exportVersion(base,'tiff',envelope)).rejects.toMatchObject({code:'unsupported',effect:'none'});
  const bad=Buffer.from(JSON.stringify(envelope)),wrong=(await connection.request('bad-metadata',{kind:'export',versionId:base.versionId,documentId:base.documentId,format:'tiff',maxBytes:64<<20,metadata:{sha256:'0'.repeat(64),byteLength:bad.length}},base.versionId,bad)).header.body as any;expect(wrong.error).toMatchObject({code:'output-metadata-refused',effect:'none'});
  await d.resume();expect((await adapter.capture()).payload).toEqual(beforePixels);expect((await d.summary()).imageVersionRef).toBe(base.versionId);await d.freeze();await d.close();
 }finally{connection.terminateOwnedProcess();await connection.exited;}
},30000);
