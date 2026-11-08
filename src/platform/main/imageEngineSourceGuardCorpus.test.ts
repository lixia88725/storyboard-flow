/** Explicit opt-in read-only user-corpus audit. No paths are discovered. */
import {it,expect} from 'vitest';
import path from 'node:path';import os from 'node:os';
import fs from 'node:fs/promises';import {constants} from 'node:fs';
import {createHash} from 'node:crypto';import sharp from 'sharp';
import {startImageEngine} from './imageEngineConnection';
import {createNativeSessionAdapter} from '../../project-files/main/image-engine/nativeSessionAdapter';
import type {RetainedSourceObject} from '../../project-files/main/image-engine/sourceStore';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
it.skipIf(!process.env.FLOW_AUTHORIZED_TIFF_LIST)('audits only an explicitly granted TIFF list against independent embedded merged pixels without changing originals',async()=>{
 const binary=process.env.FLOW_IMAGE_HOST,list=process.env.FLOW_AUTHORIZED_TIFF_LIST;if(!binary||!list)throw Error('Fixed native binary and explicit authorized list required');
 const files:unknown=JSON.parse(await fs.readFile(list,'utf8'));if(!Array.isArray(files)||files.length!==30||files.some(p=>typeof p!=='string'||!path.isAbsolute(p)||!/^\.tiff?$/i.test(path.extname(p))))throw Error('Expected exact authorized 30 TIFF paths');
 const root=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'flow-native-source-corpus-'));await fs.mkdir(path.join(root,'sources'));const store=path.join(root,'native');
 const connection=startImageEngine({binary,store,sessionId:'source-corpus',incarnation:'audit',budgetBytes:512<<20}),d=createNativeSessionAdapter({connection,storeRoot:store,storeId:'native'}),reports:Record<string,unknown>[]=[];
 try{await connection.ready;
  for(const [index,file] of (files as string[]).entries()){
   let before:string|undefined;const report:Record<string,unknown>={file,index};reports.push(report);
   try{
    if(await fs.realpath(file)!==file)throw Error('Authorized input is not canonical');const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);let bytes:Buffer;
    try{const a=await h.stat({bigint:true});if(!a.isFile()||a.size>128n*1024n*1024n)throw Error('Unexpected source identity/byte limit');bytes=await h.readFile();const b=await h.stat({bigint:true});if(a.dev!==b.dev||a.ino!==b.ino||a.size!==b.size||a.mtimeNs!==b.mtimeNs||a.ctimeNs!==b.ctimeNs)throw Error('Source changed during read');}finally{await h.close();}
    before=sha(bytes);Object.assign(report,{before,byteLength:bytes.length});const metadata=await sharp(bytes,{failOn:'error',limitInputPixels:32_000_000}).metadata();report.source={width:metadata.width,height:metadata.height,space:metadata.space,depth:metadata.depth,orientation:metadata.orientation??1,hasProfile:!!metadata.icc};
    const expected=await sharp(bytes,{failOn:'error',limitInputPixels:32_000_000}).rotate().toColourspace('srgb').ensureAlpha().raw().toBuffer({resolveWithObject:true});report.embeddedSha256=sha(expected.data);
    const privateFile=path.join(root,'sources',`${index}.tiff`);await fs.writeFile(privateFile,bytes,{flag:'wx'});const st=await fs.stat(privateFile,{bigint:true});const source:RetainedSourceObject={path:privateFile,digest:before,byteLength:bytes.length,identity:{dev:String(st.dev),ino:String(st.ino),size:String(st.size),mtimeNs:String(st.mtimeNs),ctimeNs:String(st.ctimeNs)}};
    try{const guarded=process.env.FLOW_SOURCE_GUARD_MODE!=='baseline',identity=d.driver.displayIdentity();let actual:Uint8Array,width:number,height:number;
     if(guarded){const outcome=await d.driver.prepareRetainedGuarded(`source-${index}`,source,'tiff',{maxAdditionalBytes:32<<20},{interpretationId:'photocraft-v1'});expect(d.driver.displayIdentity()).toEqual(identity);const prepared=outcome.prepared;expect((await d.driver.creationStatus(prepared.candidateId)).state).toBe('prepared');await d.driver.settleCreation(prepared);await d.driver.activate(prepared.native);actual=(await d.capture()).payload;width=prepared.native.width;height=prepared.native.height;const summary=await d.driver.summary();Object.assign(report,{state:outcome.kind==='reference'?'reference':'rendered',proof:outcome.proof,native:prepared.native,policy:summary.sourceDisplayPolicy,layers:summary.layers.map(l=>({kind:l.kind,locked:l.locks.all,opacity:l.opacity,blendMode:l.blendMode})),nativeSha256:sha(actual)});if(outcome.kind==='reference'){expect(summary.sourceDisplayPolicy).toEqual(outcome.policy);expect(outcome.policy.original.digest).toBe(before);}}

     else{const prepared=await d.driver.prepareRetained(`source-${index}`,source,'tiff',{maxAdditionalBytes:32<<20},{interpretationId:'photocraft-v1'});await d.driver.settleCreation(prepared);await d.driver.activate(prepared.native);actual=(await d.capture()).payload;width=prepared.native.width;height=prepared.native.height;const summary=await d.driver.summary();Object.assign(report,{state:'rendered',native:prepared.native,layers:summary.layers.map(l=>({kind:l.kind,locked:l.locks.all,opacity:l.opacity,blendMode:l.blendMode})),nativeSha256:sha(actual)});}
     if(expected.info.width!==width||expected.info.height!==height||expected.data.length!==actual.length)report.geometryMismatch=true;
     else{let max=0,changed=0;for(let i=0;i<actual.length;i++){if(i%4!==3&&actual[i-i%4+3]===0&&expected.data[i-i%4+3]===0)continue;const difference=Math.abs(actual[i]-expected.data[i]);if(difference)changed++;max=Math.max(max,difference);}Object.assign(report,{maxChannelDifference:max,changedChannels:changed,displayMatches:max<=2});if(max>2){await fs.writeFile(path.join(root,`${index}-native.rgba`),actual);await fs.writeFile(path.join(root,`${index}-embedded.rgba`),expected.data);}}
    }catch(error){const e=error as any;Object.assign(report,{state:'native-refused',error:{code:e.code,message:e.message,effect:e.effect}});}
   }catch(error){Object.assign(report,{state:'audit-failed',error:String(error)});}
   finally{try{const after=sha(await fs.readFile(file));Object.assign(report,{after,sourceUnchanged:before===after});}catch(error){report.afterError=String(error);}await fs.writeFile(path.join(root,'results.json'),JSON.stringify({binary,root,reports},null,2));}
  }
  await d.driver.freeze();await d.driver.close();
 }finally{connection.terminateOwnedProcess();await connection.exited;console.log('SOURCE_CORPUS_EVIDENCE',root,JSON.stringify({count:reports.length,states:reports.reduce((out:any,r)=>{const state=String(r.state);out[state]=(out[state]??0)+1;return out;},{}),displayMismatch:reports.filter(r=>r.displayMatches===false).length,sourceUnchanged:reports.every(r=>r.sourceUnchanged===true)}));}
 expect(reports).toHaveLength(30);expect(reports.every(r=>r.sourceUnchanged===true)).toBe(true);expect(reports.every(r=>r.state!=='audit-failed')).toBe(true);if(process.env.FLOW_SOURCE_GUARD_MODE!=='baseline'){expect(reports.every(r=>r.displayMatches===true)).toBe(true);}
},180000);
