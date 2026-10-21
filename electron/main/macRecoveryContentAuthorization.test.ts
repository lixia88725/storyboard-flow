import { test,expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createWorkspaceRecoveryStore } from './workspaceRecoveryStore';
import { createMacRecoveryContentAuthorization } from './macRecoveryContentAuthorization';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4zyD3HwAFPAIdh7bqkQAAAABJRU5ErkJggg==','base64');
const budget={bytes:100000,records:100,assets:10,jsonDepth:20};
const caller={sender:{},frame:{},window:{},document:{}};
const offer={revision:'native-owner:2',projectRaw:{text:'P2',futureUnknown:{preserve:true}},viewState:{selected:'A'},scriptState:{state:'unobserved'},effectFacts:[{effect:'unknown'}],continuationState:{pending:true},assets:[{assetId:'pixels',bytes:png,role:'desired',width:1,height:1,encoding:'png'}],requiredAssetIds:['pixels']};
const native=createMacRecoveryContentAuthorization({sourceByteLimit:100000,python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')});
test('real Mac adapter receives provenance and retains 0400 derived content without source widening',async()=>{
 const root=await fs.mkdtemp(path.resolve('native-permission-'));await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
 const source=path.join(root,'source.png');await fs.writeFile(source,png,{mode:0o400,flag:'wx'});
 const store=createWorkspaceRecoveryStore({authorize:native,budget,sources:[source]});
 const ack=await store.retain(caller,root,offer);
 const content=path.join(root,'.storyboard-workbench/workspace-recovery-v1/operations',ack.operationId,'generations',ack.generationId,'content.json');
 expect((await fs.stat(source)).mode&0o777).toBe(0o400);expect((await fs.stat(content)).mode&0o777).toBe(0o400);
 expect(await fs.readFile(source)).toEqual(png);expect((await store.inspectReadonly(root)).content?.projectRaw).toEqual(offer.projectRaw);
 expect(await store.readAsset(root,ack.generationId,'pixels')).toEqual(png);
});
test('explicit source-mode intersection never chooses the more permissive metadata template',async()=>{
 const root=await fs.mkdtemp(path.resolve('native-intersection-'));await fs.mkdir(path.join(root,'.storyboard-workbench'),{mode:0o700});
 const a=path.join(root,'a.json'),b=path.join(root,'b.json');await fs.writeFile(a,'{}',{mode:0o600,flag:'wx'});await fs.writeFile(b,'{}',{mode:0o400,flag:'wx'});
 const store=createWorkspaceRecoveryStore({authorize:native,budget,sources:[a,b]});
 const ack=await store.retain(caller,root,{...offer,assets:[],requiredAssetIds:[]});
 const content=path.join(root,'.storyboard-workbench/workspace-recovery-v1/operations',ack.operationId,'generations',ack.generationId,'content.json');
 expect((await fs.stat(content)).mode&0o777).toBe(0o400);expect((await fs.stat(a)).mode&0o777).toBe(0o600);expect((await fs.stat(b)).mode&0o777).toBe(0o400);
});
