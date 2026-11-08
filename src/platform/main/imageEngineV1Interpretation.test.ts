import {it,expect} from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {temporaryWorkspace} from '../../../test/temporaryWorkspace';
import {createTiffCodec} from '../../project-files/main/formats/index';
import {startImageEngine} from './imageEngineConnection';
import {createNativeSessionAdapter} from '../../project-files/main/image-engine/nativeSessionAdapter';
import type {RetainedSourceObject} from '../../project-files/main/image-engine/sourceStore';
import type {ImageDocumentV1} from '../contracts/refactorV1';
const hash=(v:Uint8Array)=>createHash('sha256').update(v).digest('hex');
async function retained(file:string,bytes:Uint8Array):Promise<RetainedSourceObject>{await fs.writeFile(file,bytes,{flag:'wx'});const actual=await fs.realpath(file),s=await fs.stat(actual,{bigint:true});return{path:actual,digest:hash(bytes),byteLength:bytes.length,identity:{dev:String(s.dev),ino:String(s.ino),size:String(s.size),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs)}};}
it('restores strict Flow V1 floating opacity and full-lock interpretation by native PSD IDs without baking the source pixels',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST;if(!binary)throw Error('Real Flow V1 interpretation native binary required');
 const root=await temporaryWorkspace('native-v1-profile-'),store=path.join(root,'native');
 const codec=createTiffCodec({scriptPath:path.resolve('src/project-files/main/formats/codec.py'),depsDir:'/private/tmp/flow-image-engine-export-python',pythonPath:'/opt/homebrew/bin/python3.14'});
 const white=await sharp({create:{width:32,height:24,channels:4,background:'#ffffff'}}).png().toBuffer(),red=await sharp({create:{width:32,height:24,channels:4,background:'#ff0000'}}).png().toBuffer();
 const assets=new Map([[hash(white),white],[hash(red),red]]);
 const image:ImageDocumentV1={id:'v1-image',revision:7,width:32,height:24,layers:[
  {id:'v1-bottom',name:'白底',kind:'image',visible:true,locked:false,opacity:1,blendMode:'normal',width:32,height:24,assetId:hash(white)},
  {id:'v1-top',name:'半透明锁定',kind:'paint',visible:true,locked:true,opacity:.5,blendMode:'normal',width:32,height:24,assetId:hash(red)}
 ]};
 const encoded=await codec.encode({image,text:null},async id=>assets.get(id)!);expect(encoded.ok,JSON.stringify(encoded)).toBe(true);if(!encoded.ok)throw Error(encoded.error.message);
 const source=await retained(path.join(root,'strict-v1.tiff'),encoded.value),connection=startImageEngine({binary,store,sessionId:'v1-profile',incarnation:'one',budgetBytes:64<<20});
 const adapter=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'}),d=adapter.driver,reservation={maxAdditionalBytes:2<<20};
 try{
  await connection.ready;expect(connection.supports('flowV1UpgradeInterpretationV1')).toBe(true);
  const ordinary=await d.prepareRetained('ordinary',source,'tiff',reservation,{interpretationId:'photocraft-v1'}),normalView=await d.inspectVersion(ordinary.native);
  expect(normalView.summary.layers.find(l=>l.name==='半透明锁定')!.opacity).toBeCloseTo(128/255,6);await d.discardCreation('ordinary');
  const restored=await d.prepareRetained('restored',source,'tiff',reservation,{interpretationId:'flow-v1-upgrade'}),view=await d.inspectVersion(restored.native),top=view.summary.layers.find(l=>l.name==='半透明锁定')!;
  expect(top.opacity).toBe(.5);expect(top.locks).toEqual({all:true,pixels:false,position:false,transparency:false,artboard:false});expect(view.summary.layers.find(l=>l.name==='白底')!.opacity).toBe(1);
  const nativeSnapshot=JSON.parse(await fs.readFile(path.join(store,'versions',restored.native.versionId+'.json'),'utf8'));expect(nativeSnapshot.source).toEqual({digest:source.digest,byteLength:source.byteLength,formatHint:'tiff',interpretationId:'flow-v1-upgrade'});
  // The two snapshots reference identical immutable raster tile objects; only
  // the interpreted properties and document identities differ.
  const ordinarySnapshot=JSON.parse(await fs.readFile(path.join(store,'versions',ordinary.native.versionId+'.json'),'utf8'));
  const objects=(v:Record<string,any>):string[]=>v.document.layers.flatMap((l:any)=>l.content.surface.tiles.map((t:any)=>t.hash)).sort();
  expect(objects(nativeSnapshot.nativeManifest).length).toBe(2);expect(objects(nativeSnapshot.nativeManifest)).toEqual(objects(ordinarySnapshot.nativeManifest));
  // Alter only the portable scalar, keeping native records and pixels fixed.
  // The new grant has its own verified digest; that does not permit it to lie
  // about quantized native fields or claim protected-source rasterVersion 3.
  const corrupt=(change:(e:any)=>void)=>{const original=Buffer.from(encoded.value),start=original.indexOf('<flow:metadata>')+15,end=original.indexOf('</flow:metadata>');expect(start).toBeGreaterThan(14);const env=JSON.parse(Buffer.from(original.subarray(start,end).toString(),'base64').toString('utf8'));change(env);const replacement=Buffer.from(JSON.stringify(env)).toString('base64');expect(replacement.length).toBe(end-start);return Buffer.concat([original.subarray(0,start),Buffer.from(replacement),original.subarray(end)]);};
  const badOpacity=await retained(path.join(root,'bad-opacity.tiff'),corrupt(e=>{e.image.layers[1].opacity=.6;}));
  await expect(d.prepareRetained('bad-opacity',badOpacity,'tiff',reservation,{interpretationId:'flow-v1-upgrade'})).rejects.toMatchObject({code:'unsupported-source-interpretation',effect:'none'});
  const protectedSource=await retained(path.join(root,'protected-profile.tiff'),corrupt(e=>{e.rasterVersion=3;}));
  await expect(d.prepareRetained('protected-profile',protectedSource,'tiff',reservation,{interpretationId:'flow-v1-upgrade'})).rejects.toMatchObject({code:'unsupported-source-interpretation',effect:'none'});
  expect(hash(await fs.readFile(source.path))).toBe(source.digest);
  const legacy={...connection,supports:(cap:Parameters<typeof connection.supports>[0])=>cap==='flowV1UpgradeInterpretationV1'?false:connection.supports(cap)},old=createNativeSessionAdapter({connection:legacy,storeRoot:store,storeId:'native'});
  await expect(old.driver.prepareRetained('must-not-fallback',source,'tiff',reservation,{interpretationId:'flow-v1-upgrade'})).rejects.toMatchObject({code:'unsupported',effect:'none'});
  await d.settleCreation(restored);await d.freeze();await d.close();
  const reopened=startImageEngine({binary,store,sessionId:'v1-reopen',incarnation:'two',budgetBytes:64<<20}),again=createNativeSessionAdapter({connection:reopened,storeRoot:store,storeId:'native'});
  try{await reopened.ready;expect(await again.driver.creationStatus('restored')).toMatchObject({state:'accepted',native:restored.native});const after=await again.driver.inspectVersion(restored.native);expect(after.summary.layers.find(l=>l.name==='半透明锁定')).toMatchObject({opacity:.5,locks:{all:true,transparency:false}});await again.driver.freeze();await again.driver.close();}finally{reopened.terminateOwnedProcess();await reopened.exited;}
 }finally{connection.terminateOwnedProcess();await connection.exited;}
},30000);
