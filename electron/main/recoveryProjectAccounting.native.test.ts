import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createOriginWorkspaceAccounting} from './originWorkspaceAccounting';
import {fixtureAttributeBytes} from './nativeAttributeMeter.fixture';

// Metadata-only public accounting seam: native FD traversal, not permission or
// content/provenance certification. All actors touch only this owned fixture.
test.each(['file','namespace-directory','metadata-directory'] as const)('project joint census charges real %s attribute material without mutating it',async target=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'project-attribute-root-'));
 const userData=await fs.mkdtemp(path.join(os.tmpdir(),'project-attribute-data-'));
 const metadata=path.join(root,'.storyboard-workbench'),namespace=path.join(metadata,'workspace-recovery-v1');
 await fs.mkdir(namespace,{recursive:true,mode:0o700});
 const file=path.join(namespace,'partial');await fs.writeFile(file,'abc',{mode:0o600});
 const selected=target==='file'?file:target==='namespace-directory'?namespace:metadata;
 await promisify(execFile)('/usr/bin/xattr',['-w','org.storyboard.accounting-material','literal-raw-material',selected]);
 const expected=3+fixtureAttributeBytes(metadata)+fixtureAttributeBytes(namespace)+fixtureAttributeBytes(file);
 const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
 const actual=await accounting(root,{bytes:1024*1024,records:100,assets:8,jsonDepth:80});
 expect(actual.bytes).toBe(expected);
 expect(actual.records).toBe(2);
 expect(await fs.readFile(file,'utf8')).toBe('abc');
 expect((await fs.stat(selected)).mode&0o777).toBe(target==='file'?0o600:0o700);
 expect(fixtureAttributeBytes(selected)).toBeGreaterThan(0);
},120000);

// Adjacent first-green guards: billing aliases is not accepting their provenance.
test('project census charges each retained hardlink name and refuses an attribute-inclusive cap without cleanup',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'project-alias-accounting-root-'));
 const userData=await fs.mkdtemp(path.join(os.tmpdir(),'project-alias-accounting-data-'));
 const metadata=path.join(root,'.storyboard-workbench'),namespace=path.join(metadata,'workspace-recovery-v1');
 await fs.mkdir(namespace,{recursive:true,mode:0o700});
 const file=path.join(namespace,'partial'),alias=path.join(namespace,'partial-alias');
 await fs.writeFile(file,'abc',{mode:0o600});
 await promisify(execFile)('/usr/bin/xattr',['-w','org.storyboard.accounting-material','literal-raw-material',file]);
 await fs.link(file,alias);
 const expected=6+fixtureAttributeBytes(metadata)+fixtureAttributeBytes(namespace)+2*fixtureAttributeBytes(file);
 const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
 expect((await accounting(root,{bytes:expected,records:100,assets:8,jsonDepth:80})).bytes).toBe(expected);
 await expect(accounting(root,{bytes:expected-1,records:100,assets:8,jsonDepth:80})).rejects.toThrow('budget');
 expect(await fs.readFile(alias,'utf8')).toBe('abc');
 expect((await fs.stat(file)).nlink).toBe(2);
 expect((await fs.stat(file)).ino).toBe((await fs.stat(alias)).ino);
},120000);

test('fresh project attribute fingerprints do not reuse an earlier observation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'project-attribute-fingerprint-root-'));
 const userData=await fs.mkdtemp(path.join(os.tmpdir(),'project-attribute-fingerprint-data-'));
 const namespace=path.join(root,'.storyboard-workbench/workspace-recovery-v2/policies');
 await fs.mkdir(namespace,{recursive:true,mode:0o700});
 const file=path.join(namespace,'orphan');await fs.writeFile(file,'abc',{mode:0o600});
 const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
 await promisify(execFile)('/usr/bin/xattr',['-w','org.storyboard.accounting-material','one',file]);
 const before=await accounting(root,{bytes:1024*1024,records:100,assets:8,jsonDepth:80});
 await promisify(execFile)('/usr/bin/xattr',['-w','org.storyboard.accounting-material','two',file]);
 const after=await accounting(root,{bytes:1024*1024,records:100,assets:8,jsonDepth:80});
 expect(after.bytes).toBe(before.bytes);expect(after.fingerprint).not.toBe(before.fingerprint);
 expect(await fs.readFile(file,'utf8')).toBe('abc');expect((await fs.stat(file)).mode&0o777).toBe(0o600);
},120000);

test.each(['save-tmp','import-tmp','delete-tmp'])('joint census includes actual %s operation residue outside recovery namespaces without adopting or deleting it',async area=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'operation-residue-accounting-root-'));
 const userData=await fs.mkdtemp(path.join(os.tmpdir(),'operation-residue-accounting-data-'));
 const metadata=path.join(root,'.storyboard-workbench'),base=path.join(metadata,area),operation=path.join(base,'owned-synthetic-operation');
 const backups=path.join(operation,'.backups');await fs.mkdir(backups,{recursive:true,mode:0o700});
 const file=path.join(backups,'incomplete.tiff');await fs.writeFile(file,'abc',{mode:0o400});
 await promisify(execFile)('/usr/bin/xattr',['-w','org.storyboard.operation-residue','retained-material',operation]);
 const expected=3+[metadata,base,operation,backups,file].reduce((sum,p)=>sum+fixtureAttributeBytes(p),0);
 const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
 const budget={bytes:1024*1024,records:100,assets:8,jsonDepth:80};
 const measured=await accounting(root,budget);
 expect(measured.bytes).toBe(expected);expect(measured.records).toBe(4);
 await expect(accounting(root,{...budget,bytes:expected-1})).rejects.toThrow('budget');
 expect(await fs.readFile(file,'utf8')).toBe('abc');expect((await fs.stat(file)).mode&0o777).toBe(0o400);
 expect(await fs.readdir(backups)).toEqual(['incomplete.tiff']);
},120000);

test.each(['pending-file-transaction.json','.storyboard.project.json.synthetic-orphan.tmp','.pending-file-transaction.json.synthetic-orphan.tmp'])('joint census bills known metadata recovery file %s as inert material',async name=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'metadata-residue-accounting-root-'));
 const userData=await fs.mkdtemp(path.join(os.tmpdir(),'metadata-residue-accounting-data-'));
 const metadata=path.join(root,'.storyboard-workbench');await fs.mkdir(metadata,{mode:0o700});
 const file=path.join(metadata,name);await fs.writeFile(file,'abc',{mode:0o400});
 const expected=3+fixtureAttributeBytes(metadata)+fixtureAttributeBytes(file);
 const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
 const budget={bytes:1024*1024,records:100,assets:8,jsonDepth:80};
 expect((await accounting(root,budget)).bytes).toBe(expected);
 await expect(accounting(root,{...budget,bytes:expected-1})).rejects.toThrow('budget');
 // Invalid JSON and an unrecognized operation ID are billed, not accepted as
 // a journal, owned-stage receipt, source certificate or replayable command.
 expect(await fs.readFile(file,'utf8')).toBe('abc');expect((await fs.stat(file)).mode&0o777).toBe(0o400);
 expect(await fs.readdir(metadata)).toEqual([name]);
},120000);

test.each([false,true])('joint census bills PNG stage and its publication alias without adopting it (linked=%s)',async linked=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-stage-accounting-root-'));
 const userData=await fs.mkdtemp(path.join(os.tmpdir(),'png-stage-accounting-data-'));
 const metadata=path.join(root,'.storyboard-workbench'),layers=path.join(metadata,'layers'),shot=path.join(layers,'synthetic-shot');
 await fs.mkdir(shot,{recursive:true,mode:0o700});
 const stage=path.join(shot,'.layer-staging-unrecognized-id'),target=path.join(shot,'layer.png');
 await fs.writeFile(stage,'abc',{mode:0o400});if(linked)await fs.link(stage,target);
 await fs.writeFile(path.join(shot,'working.png'),'unrelated current working pixels',{mode:0o600});
 const selected=[stage,...(linked?[target]:[])];
 const expected=selected.length*3+[metadata,layers,shot,...selected].reduce((sum,p)=>sum+fixtureAttributeBytes(p),0);
 const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
 const budget={bytes:1024*1024,records:100,assets:8,jsonDepth:80};
 const measured=await accounting(root,budget);expect(measured.bytes).toBe(expected);expect(measured.records).toBe(linked?4:3);
 await expect(accounting(root,{...budget,bytes:expected-1})).rejects.toThrow('budget');
 for(const file of selected){expect(await fs.readFile(file,'utf8')).toBe('abc');expect((await fs.stat(file)).mode&0o777).toBe(0o400);}
 expect(await fs.readFile(path.join(shot,'working.png'),'utf8')).toBe('unrelated current working pixels');
 expect((await fs.stat(stage)).nlink).toBe(linked?2:1);
},120000);

test.each(['unlocated-alias','symlink','working-only'])('PNG staging discovery preserves and safely classifies %s',async kind=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'png-stage-guard-root-'));
 const userData=await fs.mkdtemp(path.join(os.tmpdir(),'png-stage-guard-data-'));
 const metadata=path.join(root,'.storyboard-workbench'),shot=path.join(metadata,'layers','synthetic-shot');
 await fs.mkdir(shot,{recursive:true,mode:0o700});
 const stage=path.join(shot,'.layer-staging-unrecognized-id'),external=path.join(userData,'synthetic-material');
 await fs.writeFile(external,'abc',{mode:0o600});
 if(kind==='unlocated-alias'){await fs.writeFile(stage,'abc',{mode:0o400});await fs.link(stage,path.join(userData,'synthetic-alias'));}
 else if(kind==='symlink')await fs.symlink(external,stage);
 else await fs.writeFile(path.join(shot,'working.png'),'unrelated working bytes',{mode:0o600});
 const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
 const budget={bytes:1024*1024,records:100,assets:8,jsonDepth:80};
 if(kind==='working-only'){
  const measured=await accounting(root,budget);expect(measured.bytes).toBe(fixtureAttributeBytes(metadata));expect(measured.records).toBe(0);
  expect(await fs.readFile(path.join(shot,'working.png'),'utf8')).toBe('unrelated working bytes');
 }else{
  await expect(accounting(root,budget)).rejects.toThrow(kind==='unlocated-alias'?'alias inventory unknown':'link/special');
  if(kind==='unlocated-alias'){expect((await fs.stat(stage)).nlink).toBe(2);expect(await fs.readFile(stage,'utf8')).toBe('abc');}
  else expect(await fs.readlink(stage)).toBe(external);
 }
 expect(await fs.readFile(external,'utf8')).toBe('abc');
},120000);
