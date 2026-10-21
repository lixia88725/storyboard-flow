import {test,expect} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createWorkspaceRecoveryStore} from './workspaceRecoveryStore';
import {createOriginWorkspaceAccounting} from './originWorkspaceAccounting';
import {createNativeAuthorizationSession} from './nativeAuthorizationSession';

// Actual native content policy + actual joint allocator + filesystem publication.
// Synthetic source/xattr only; no Main bootstrap/GUI or complete census claim.
test('joint-allocated native capture preserves real source attributes and publishes a readable generation',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-creation-peak-root-'));
 const userData=await fs.mkdtemp(path.join(os.tmpdir(),'native-creation-peak-data-'));
 const metadata=path.join(root,'.storyboard-workbench');await fs.mkdir(metadata,{mode:0o700});
 const source=path.join(metadata,'source.json');await fs.writeFile(source,'{}',{mode:0o600});
 const python='python3',script=path.resolve('scripts/recovery-content-permissions.py');
 await promisify(execFile)('/usr/bin/xattr',['-w','org.storyboard.creation-peak','x'.repeat(16384),source]);
 const budget={bytes:16*1024*1024,records:1000,assets:8,jsonDepth:80};
 const native=createNativeAuthorizationSession(python,script,()=>65536);
 const policy=(await native.request({phase:'capturePolicy',sources:[source],sourceByteLimit:budget.bytes})).sourcePolicy;
 const accounting=createOriginWorkspaceAccounting({userData:()=>userData,python,script:path.resolve('scripts/recovery-origin-permissions.py')});
 const store=createWorkspaceRecoveryStore({budget,sourcePolicy:policy,accounting,authorize:async request=>{await native.request({...request,sourcePolicy:policy,sourceByteLimit:budget.bytes});}});
 const ack=await store.retain({sender:{},frame:{},window:{},document:{}},root,{revision:'actual-native-creation',projectRaw:{text:'x'.repeat(40000)},viewState:{},scriptState:{},effectFacts:{},continuationState:{},assets:[],requiredAssetIds:[]});
 const cold=await store.inspectReadonly(root);expect(cold.state).toBe('protectedReadable');expect(cold.ack).toEqual(ack);
 const namespace=path.join(metadata,'workspace-recovery-v1/namespace.json');
 const originalAttribute=await promisify(execFile)('/usr/bin/xattr',['-p','-x','org.storyboard.creation-peak',source]);
 const retainedAttribute=await promisify(execFile)('/usr/bin/xattr',['-p','-x','org.storyboard.creation-peak',namespace]);
 expect(retainedAttribute.stdout.replace(/\s/g,'')).toBe(Buffer.from('x'.repeat(16384)).toString('hex'));
 expect(retainedAttribute.stdout).toBe(originalAttribute.stdout);
 expect(await fs.readFile(source,'utf8')).toBe('{}');
 expect((await fs.stat(source)).mode&0o777).toBe(0o600);
 expect(cold.content?.projectRaw).toEqual({text:'x'.repeat(40000)});
},120000);
