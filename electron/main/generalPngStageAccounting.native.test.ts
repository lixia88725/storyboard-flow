import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createOriginWorkspaceAccounting } from './originWorkspaceAccounting.js';

// Public joint inventory, actual Native held-FD census. Synthetic Root only;
// accounting a stage/alias never authenticates its producer or grants cleanup.
test.each([false,true])('joint census includes non-layers PNG staging and same-parent publication names (alias=%s)',async alias=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'general-png-stage-root-')),userData=await fs.mkdtemp(path.join(os.tmpdir(),'general-png-stage-data-'));
  const metadata=path.join(root,'.storyboard-workbench'),parent=path.join(root,'alternate','s');
  await fs.mkdir(metadata,{mode:0o700});await fs.mkdir(parent,{recursive:true,mode:0o700});
  const working=path.join(parent,'ordinary-working.png');await fs.writeFile(working,Buffer.alloc(1024*1024,7),{mode:0o600});
  const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
  const budget={bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80},before=await accounting(root,budget);
  expect(before.records).toBe(0);
  const stage=path.join(parent,'.layer-staging-retained'),target=path.join(parent,'new.png');await fs.writeFile(stage,'abc',{mode:0o600});if(alias)await fs.link(stage,target);
  const names=(await fs.readdir(parent)).sort(),after=await accounting(root,budget);
  expect(after.records-before.records).toBe(alias?4:3); // two existing containers, plus each recovery name
  expect(after.bytes-before.bytes).toBeGreaterThanOrEqual(alias?6:3);
  expect(after.bytes-before.bytes).toBeLessThan(1024*1024); // ordinary working pixels remain outside the recovery quota
  await expect(accounting(root,{...budget,bytes:after.bytes-1})).rejects.toThrow(/budget/);
  expect(await fs.readFile(stage,'utf8')).toBe('abc');expect((await fs.stat(stage)).nlink).toBe(alias?2:1);
  expect((await fs.readdir(parent)).sort()).toEqual(names);expect((await fs.stat(working)).size).toBe(1024*1024);
},120000);

test.each([false,true])('already inventoried metadata tmp subtrees are not charged again by stage discovery (alias=%s)',async alias=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metadata-stage-subtree-')),userData=await fs.mkdtemp(path.join(os.tmpdir(),'metadata-stage-subtree-data-'));
  const directory=path.join(root,'.storyboard-workbench/.storyboard.project.json.orphan.tmp');await fs.mkdir(directory,{recursive:true,mode:0o700});
  const stage=path.join(directory,'.layer-staging-retained'),target=path.join(directory,'new.png');await fs.writeFile(stage,'abc',{mode:0o600});if(alias)await fs.link(stage,target);
  const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
  const budget={bytes:1024*1024,records:1000,assets:16,jsonDepth:80},actual=await accounting(root,budget);
  expect(actual.records).toBe(alias?3:2); // tmp directory plus each real child name, only once
  await expect(accounting(root,{...budget,bytes:actual.bytes-1})).rejects.toThrow(/budget/);
  expect(await fs.readFile(stage,'utf8')).toBe('abc');expect((await fs.stat(stage)).nlink).toBe(alias?2:1);
  expect((await fs.readdir(directory)).sort()).toEqual(alias?['.layer-staging-retained','new.png']:['.layer-staging-retained']);
},120000);

test('a metadata journal publication alias is charged once per name, not twice by discovery',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metadata-stage-alias-')),userData=await fs.mkdtemp(path.join(os.tmpdir(),'metadata-stage-alias-data-')),metadata=path.join(root,'.storyboard-workbench');await fs.mkdir(metadata,{mode:0o700});
  const journal=path.join(metadata,'pending-file-transaction.json'),stage=path.join(metadata,'.layer-staging-retained');await fs.writeFile(journal,'abc',{mode:0o600});await fs.link(journal,stage);
  const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
  const actual=await accounting(root,{bytes:1024*1024,records:1000,assets:16,jsonDepth:80});
  expect(actual.records).toBe(2);expect(actual.bytes).toBeGreaterThanOrEqual(6);expect((await fs.stat(journal)).nlink).toBe(2);expect(await fs.readFile(stage,'utf8')).toBe('abc');
},120000);

test.each(['ordinary-link','stage-link','ordinary-fifo','stage-fifo'] as const)('general stage discovery does not follow unrelated objects and refuses recovery %s',async mode=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'stage-discovery-objects-')),userData=await fs.mkdtemp(path.join(os.tmpdir(),'stage-discovery-objects-data-')),outside=await fs.mkdtemp(path.join(os.tmpdir(),'stage-discovery-outside-'));
  await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});const external=path.join(outside,'.layer-staging-external');await fs.writeFile(external,Buffer.alloc(1024*1024,3),{mode:0o600});
  const recovery=mode.startsWith('stage-'),entry=path.join(root,recovery?'.layer-staging-special':'unrelated-object');
  if(mode.endsWith('link'))await fs.symlink(outside,entry);
  else execFileSync('python3',['-I','-B','-c','import os,sys;os.mkfifo(sys.argv[1],0o600)',entry]);
  const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python:'python3',script:path.resolve('scripts/recovery-origin-permissions.py')});
  const result=accounting(root,{bytes:4*1024*1024,records:1000,assets:16,jsonDepth:80});
  if(recovery)await expect(result).rejects.toThrow(/link\/special/);
  else {const actual=await result;expect(actual.records).toBe(0);expect(actual.bytes).toBeLessThan(1024*1024);}
  expect((await fs.stat(external)).size).toBe(1024*1024);expect(await fs.lstat(entry)).toBeDefined();
},120000);
