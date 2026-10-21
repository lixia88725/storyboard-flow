import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { execFileSync } from 'node:child_process';
import { writeProtectedLayerFile, ProtectedLayerWriteError, planProtectedPngWrite } from './protectedLayerFileWriter.js';
import { withProducerPngEffects, type ProducerPngReceipt } from './producerPngEffects.js';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession.js';

// Actual Native physical writer. Only the post-execute accounting failure port
// is synthetic; this is transport/receipt proof, not a real failed census/GUI.
test.each([false,true])('a committed PNG is still announced and preserved when the physical accounting port fails (undefined=%s)',async undefinedError=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-outcome-root-')),file=path.join(root,'existing.png');
  const original=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer(),updated=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer();
  await fs.writeFile(file,original,{mode:0o600});
  const failure=undefinedError?undefined:new Error('synthetic post-Native accounting failure');let announced=0,receipt:ProducerPngReceipt|undefined;
  const result=withProducerPngEffects({beforeWrite:async()=>{},beforeDelete:async()=>{},deleted:async()=>{},written:async value=>{receipt=value;},
    physicalWrite:async(_request,execute)=>{await execute();throw failure;}
  },()=>writeProtectedLayerFile(root,file,updated,'upsert',()=>{announced++;}));
  await expect(result).rejects.toBeInstanceOf(ProtectedLayerWriteError);
  await result.catch(error=>{expect(error.effect).toBe('committed');expect(error.warnings.join(' ')).toMatch(/accounting outcome unknown/);});
  expect(announced).toBe(1);expect(receipt?.commitFailure?.effect).toBe('committed');expect(receipt?.bytes).toEqual(updated);expect(await fs.readFile(file)).toEqual(updated);
},120000);

test('a genuine Native refusal is not replaced by a later physical accounting error',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-refused-outcome-')),file=path.join(root,'readonly.png');
  const bytes=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer();await fs.writeFile(file,bytes,{mode:0o400});
  let notified=0;const failure=new Error('synthetic census error after refused Native result');
  const result=withProducerPngEffects({beforeWrite:async()=>{},beforeDelete:async()=>{},deleted:async()=>{},written:async()=>{notified++;},physicalWrite:async(_request,execute)=>{await execute();throw failure;}},()=>writeProtectedLayerFile(root,file,bytes));
  await expect(result).rejects.toBeInstanceOf(ProtectedLayerWriteError);await result.catch(error=>{expect(error.effect).toBe('refused');expect(error.message).toMatch(/accounting outcome unknown/);});
  expect(notified).toBe(0);expect(await fs.readFile(file)).toEqual(bytes);expect((await fs.stat(file)).mode&0o777).toBe(0o400);
},120000);

// First-green protocol protection for the implemented readonly plan seam.
test.each(['contents','attributes','parent'] as const)('a native PNG plan is readonly and stale %s refuse before staging',async change=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-plan-binding-')),file=path.join(root,'existing.png');await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
  const bytes=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer(),updated=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer();await fs.writeFile(file,bytes,{mode:0o600});
  const names=(await fs.readdir(root)).sort(),identity=await fs.stat(file,{bigint:true});
  const plan=await planProtectedPngWrite(root,file,updated,'upsert',4*1024*1024,'python3');
  for(const parent of plan.parents)expect(parent.native.birthNs).toMatch(/^[0-9]+$/);expect(plan.metadata.birthNs).toMatch(/^[0-9]+$/);
  expect(plan.peakBytes).toBe(32768);expect(plan.peakRecords).toBe(1);expect((await fs.readdir(root)).sort()).toEqual(names);expect((await fs.stat(file,{bigint:true})).ino).toBe(identity.ino);expect(await fs.readFile(file)).toEqual(bytes);
  if(change==='contents')await fs.writeFile(file,updated); // Owned synthetic actor.
  if(change==='attributes')execFileSync('/usr/bin/xattr',['-w','org.storyboard.png-plan','changed',file]);
  if(change==='parent')await fs.chmod(root,0o750);
  const expected=await fs.readFile(file);let notices=0;
  const result=withProducerPngEffects({beforeWrite:async()=>{},beforeDelete:async()=>{},deleted:async()=>{},written:async()=>{notices++;},physicalWrite:(_request,execute)=>execute(plan)},()=>writeProtectedLayerFile(root,file,updated));
  await expect(result).rejects.toBeInstanceOf(ProtectedLayerWriteError);await result.catch(error=>{expect(error.effect).toBe('refused');expect(error.message).toMatch(/plan changed before first creation/);});
  expect(notices).toBe(0);expect(await fs.readFile(file)).toEqual(expected);expect((await fs.readdir(root)).sort()).toEqual(names);
  if(change==='attributes')expect(execFileSync('/usr/bin/xattr',['-p','org.storyboard.png-plan',file],{encoding:'utf8'}).trim()).toBe('changed');
  if(change==='parent')expect((await fs.stat(root)).mode&0o777).toBe(0o750);
},120000);

test('native PNG cost uses raw source attributes and separately funds missing directories and publication names',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-raw-cost-')),file=path.join(root,'source.png');await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
  const bytes=await sharp({create:{width:16,height:16,channels:4,background:'blue'}}).png({compressionLevel:0}).toBuffer();await fs.writeFile(file,bytes,{mode:0o600});
  const name='org.storyboard.png-raw-size',value='q'.repeat(32600);execFileSync('/usr/bin/xattr',['-w',name,value,file]);
  // The OS can attach additional metadata. Observe ALL actual raw material
  // independently via xattr CLI; never delete it or derive expected size from
  // the very Native plan being checked.
  const names=execFileSync('/usr/bin/xattr',[file],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
  const raw=names.reduce((sum,key)=>sum+Buffer.byteLength(key)+Buffer.from(execFileSync('/usr/bin/xattr',['-p','-x',key,file],{encoding:'utf8'}).replace(/\s/g,''),'hex').length,0);
  const before=(await fs.readdir(root)).sort(),plan=await planProtectedPngWrite(root,file,bytes,'upsert',4*1024*1024,'python3');
  expect(plan.stagePeak).toBe(Math.max(32768,bytes.length+raw));expect(plan.peakBytes).toBe(plan.stagePeak);expect(plan.peakRecords).toBe(1);
  const absent=path.join(root,'new','nested','fresh.png'),fresh=await planProtectedPngWrite(root,absent,bytes,'create-only',4*1024*1024,'python3');
  expect(fresh.missingDirectories).toEqual([path.join(root,'new'),path.join(root,'new','nested')]);expect(fresh.peakBytes).toBe(4*32768);expect(fresh.peakRecords).toBe(4);
  expect((await fs.readdir(root)).sort()).toEqual(before);expect(await fs.readFile(file)).toEqual(bytes);expect(execFileSync('/usr/bin/xattr',['-p',name,file],{encoding:'utf8'}).trim()).toBe(value);
},120000);

test.each([false,true])('a native PNG plan funds newly accounted existing containers when final publication cleanup fails (large attributes=%s)',async largeAttributes=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-stage-container-cost-')),file=path.join(root,'.storyboard-workbench/layers/s/new.png');
  await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
  if(largeAttributes)for(const directory of [path.dirname(file),path.dirname(path.dirname(file))])execFileSync('/usr/bin/xattr',['-w','org.storyboard.container-cost','q'.repeat(30000),directory]);
  const bytes=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer(),python='python3';
  const counter=createNativeAuthorizationSession(python,path.resolve('scripts/recovery-project-permissions.py'),()=>65536);
  const inventory=()=>counter.request({phase:'inventory',root,byteLimit:4*1024*1024,recordLimit:1000});
  const before=await inventory(),plan=await planProtectedPngWrite(root,file,bytes,'create-only',4*1024*1024,python);
  const shim=path.join(root,'publication-cleanup-fault');
  await fs.writeFile(shim,`#!/usr/bin/env ${python}\nimport sys,importlib.util,json,base64,os\ns=importlib.util.spec_from_file_location('writer',sys.argv[3]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\noriginal=m.os.unlink\ndef fault(p,*a,**k):\n if os.path.basename(p).startswith('.layer-staging-'):raise PermissionError('fixture final stage unlink denied')\n return original(p,*a,**k)\nm.os.unlink=fault\nr=json.load(sys.stdin)\nprint(json.dumps(m.protected_write(r['root'],r['filePath'],base64.b64decode(r['bytes']),r['mode'],r['operation'],r['writePlan'])))\n`,{mode:0o700});
  const previous=process.env.SWB_PYTHON_BIN;let failure:any;
  try{
    process.env.SWB_PYTHON_BIN=shim;
    failure=await withProducerPngEffects({beforeWrite:async()=>{},beforeDelete:async()=>{},deleted:async()=>{},written:async()=>{},physicalWrite:(_request,execute)=>execute(plan)},()=>writeProtectedLayerFile(root,file,bytes,'create-only')).catch(error=>error);
  }finally{if(previous===undefined)delete process.env.SWB_PYTHON_BIN;else process.env.SWB_PYTHON_BIN=previous;}
  expect(failure).toMatchObject({effect:'committed',filePath:file});expect((await fs.stat(file)).nlink).toBe(2);
  expect(await fs.readFile(failure.retainedTemporary)).toEqual(bytes);
  const after=await inventory();
  expect(after.records-before.records).toBe(4); // stage + target + existing layers + existing shot container
  expect(after.records-before.records).toBeLessThanOrEqual(plan.peakRecords);
  expect(after.bytes-before.bytes).toBeLessThanOrEqual(plan.peakBytes);
},120000);
