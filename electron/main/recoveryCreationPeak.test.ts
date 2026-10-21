import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createWorkspaceRecoveryStore} from './workspaceRecoveryStore';
import {scanRecoveryWorkspace} from './recoveryWorkspaceAccounting';
import {recoveryPolicyKey} from './recoveryPolicyPartition';

// Public retain→allocator seam. Filesystem inventory is real; authorization is
// an explicit no-op port and allocator refusal stops before ALL sidecar effects.
// This is a creation-peak check, not native attribute/permission certification.
test('initial production capture reserves the approved file and directory creation floor before any sidecar effect',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-creation-peak-'));
 await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
 const budget={bytes:1024*1024,records:100,assets:8,jsonDepth:80};
 let claim:{bytes:number;records:number}|undefined;
 const accounting=Object.assign(async(r:string,b:typeof budget)=>scanRecoveryWorkspace(r,b),{
  reserve:async(_root:string,_budget:typeof budget,bytes:number,records:number,_effect:()=>Promise<unknown>)=>{
   claim={bytes,records};throw new Error('Synthetic allocator stopped before sidecar effect');
  }
 });
 const store=createWorkspaceRecoveryStore({budget,accounting,authorize:async()=>{}});
 await expect(store.retain({sender:{},frame:{},window:{},document:{}},root,{revision:'creation-floor',projectRaw:{},viewState:{},scriptState:{},effectFacts:{},continuationState:{},assets:[],requiredAssetIds:[]})).rejects.toThrow('Synthetic allocator stopped');
 // Namespace/op/content/seal files; namespace/operations/op/generations/gen/assets
 // directories; one transient source alias. Literal requirement-derived floor.
 expect(claim?.bytes).toBeGreaterThanOrEqual(360448);
 expect(claim?.records).toBeGreaterThanOrEqual(11);
 expect(await fs.readdir(path.join(root,'.storyboard-workbench'))).toEqual([]);
});

test('production capture includes known raw source attributes on a large body and its publication overlap',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-creation-attributes-'));
 await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
 const budget={bytes:1024*1024,records:100,assets:8,jsonDepth:80};
 let peak=0;
 const accounting=Object.assign(async(r:string,b:typeof budget)=>scanRecoveryWorkspace(r,b),{
  reserve:async(_root:string,_budget:typeof budget,bytes:number,_records:number,_effect:()=>Promise<unknown>)=>{
   peak=bytes;throw new Error('Synthetic allocator stopped before sidecar effect');
  }
 });
 // Immutable source-policy data is a declared fee-calculation port here, not a
 // native certificate; no namespace, native authorization or publication runs.
 const sourcePolicy={schema:'swb.finite-source-policy',version:1,expected:{uid:42,gid:42,mode:0o600,flags:0,xattrs:{[Buffer.from('user.peak').toString('base64')]:Buffer.alloc(16384).toString('base64')}},observed:[]};
 const store=createWorkspaceRecoveryStore({budget,accounting,sourcePolicy,authorize:async()=>{}});
 await expect(store.retain({sender:{},frame:{},window:{},document:{}},root,{revision:'creation-attributes',projectRaw:{text:'x'.repeat(40000)},viewState:{},scriptState:{},effectFacts:{},continuationState:{},assets:[],requiredAssetIds:[]})).rejects.toThrow('Synthetic allocator stopped');
 // Six directories; three small-file floors; large content and its alias each
 // carry at least 40000 body bytes + 16384 attribute-value bytes (name omitted
 // from this lower bound deliberately, so it cannot restate the implementation).
 expect(peak).toBeGreaterThanOrEqual(407680);
 expect(await fs.readdir(path.join(root,'.storyboard-workbench'))).toEqual([]);
});

// First-green adjacent guards; the RED cases above establish the new behavior.
test('insufficient creation headroom refuses before the allocator or namespace effect',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-creation-refused-'));
 await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
 const budget={bytes:360447,records:100,assets:8,jsonDepth:80};
 let called=false;
 const accounting=Object.assign(async(r:string,b:typeof budget)=>scanRecoveryWorkspace(r,b),{
  reserve:async()=>{called=true;throw new Error('Allocator must not be reached');}
 });
 const store=createWorkspaceRecoveryStore({budget,accounting,authorize:async()=>{}});
 await expect(store.retain({sender:{},frame:{},window:{},document:{}},root,{revision:'refused-floor',projectRaw:{},viewState:{},scriptState:{},effectFacts:{},continuationState:{},assets:[],requiredAssetIds:[]})).rejects.toThrow('Accumulated recovery workspace budget exceeded');
 expect(called).toBe(false);
 expect(await fs.readdir(path.join(root,'.storyboard-workbench'))).toEqual([]);
});

test.each([false,true])('partition creation reserves only actually missing common containers: existing=%s',async existing=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-partition-creation-'));
 await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
 const containers=path.join(root,'.storyboard-workbench/workspace-recovery-v2/policies');
 if(existing)await fs.mkdir(containers,{recursive:true,mode:0o700});
 const budget={bytes:1024*1024,records:100,assets:8,jsonDepth:80};
 let peak=0;
 const accounting=Object.assign(async(r:string,b:typeof budget)=>scanRecoveryWorkspace(r,b),{
  reserve:async(_root:string,_budget:typeof budget,bytes:number)=>{peak=bytes;throw new Error('Synthetic allocator stopped before sidecar effect');}
 });
 const sourcePolicy={schema:'swb.finite-source-policy',version:1,expected:{uid:42,gid:42,mode:0o600,flags:0,xattrs:{}},observed:[]};
 const store=createWorkspaceRecoveryStore({budget,accounting,sourcePolicy,partition:recoveryPolicyKey(sourcePolicy),authorize:async()=>{}});
 await expect(store.retain({sender:{},frame:{},window:{},document:{}},root,{revision:'partition-floor',projectRaw:{},viewState:{},scriptState:{},effectFacts:{},continuationState:{},assets:[],requiredAssetIds:[]})).rejects.toThrow('Synthetic allocator stopped');
 expect(peak).toBe(existing?360448:425984);
 expect(await fs.readdir(path.join(root,'.storyboard-workbench'))).toEqual(existing?['workspace-recovery-v2']:[]);
 if(existing)expect(await fs.readdir(containers)).toEqual([]);
});

test('a container disappearing after admission cannot create unreserved directories',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'recovery-creation-plan-change-'));
 const containers=path.join(root,'.storyboard-workbench/workspace-recovery-v2/policies');
 await fs.mkdir(containers,{recursive:true,mode:0o700});
 const budget={bytes:1024*1024,records:100,assets:8,jsonDepth:80};
 const accounting=Object.assign(async(r:string,b:typeof budget)=>scanRecoveryWorkspace(r,b),{
  reserve:async(_root:string,_budget:typeof budget,_bytes:number,_records:number,effect:()=>Promise<unknown>)=>{
   // Declared synthetic actor removes only its own empty fixture containers.
   await fs.rmdir(containers);await fs.rmdir(path.dirname(containers));
   return effect();
  }
 });
 const sourcePolicy={schema:'swb.finite-source-policy',version:1,expected:{uid:42,gid:42,mode:0o600,flags:0,xattrs:{}},observed:[]};
 const store=createWorkspaceRecoveryStore({budget,accounting,sourcePolicy,partition:recoveryPolicyKey(sourcePolicy),authorize:async()=>{}});
 await expect(store.retain({sender:{},frame:{},window:{},document:{}},root,{revision:'changed-plan',projectRaw:{},viewState:{},scriptState:{},effectFacts:{},continuationState:{},assets:[],requiredAssetIds:[]})).rejects.toThrow('Recovery creation directory plan changed');
 expect(await fs.readdir(path.join(root,'.storyboard-workbench'))).toEqual([]);
});
