import {test,expect,onTestFinished} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {createWorkspaceSlots} from '../../src/renderer/workspaceSlots';
import {createProject} from '../../src/shared/projectOps';
import {createBitmapLayerWriteQueue} from '../../src/renderer/bitmapLayerWriteQueue';
const options={budget:{bytes:1048576,records:2000,assets:64,jsonDepth:80},python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')};
async function fixture(){const base=await fs.mkdtemp(path.join(os.tmpdir(),'ordinary-production-'));onTestFinished(()=>fs.rm(base,{recursive:true,force:true}));const frame={},sender={mainFrame:frame},event={sender,senderFrame:frame} as any;return {base,event,service:createPreparedWorkspaceSave(options)};}
test('actual Main ordinary reader and native memory certificate preserve clean noSave A across B and alias without resetting A epoch',async()=>{
 const {base,event,service}=await fixture(),queue=createBitmapLayerWriteQueue();const readers:string[]=[];
 const slots=createWorkspaceSlots({initialProject:createProject('Initial'),observe:p=>service.observeWorkspace(event,p),drain:()=>queue.drain(),captureView:()=>({history:{undo:[],redo:[]},canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:[],dirtyShotIds:[]}),certifyHandoff:(slot,c)=>service.certifyHandoff(event,{...c as object,...slot.view as object}),publishProject:()=>{},publishActive:()=>{},adapterPorts:()=>({queue,freshToken:()=> 'token',onSave:()=>{},onError:()=>{},api:()=>({readOutputIdentity:async()=> '0'.repeat(64),saveWorkspace:async()=>{throw Error('Save must not be required');},autosaveWorkspace:async()=>{}})})});
 const A=path.join(base,'A'),B=path.join(base,'B');await fs.mkdir(A);await fs.mkdir(B);
 const load=(root:string)=>slots.requestOpen(root,async(slot,binding)=>{let scan:any;const loaded=await slot.adapter.load(()=>service.ordinary(event,'workspace:openFolderByPath',binding.folderPath,[binding.folderPath],async()=>{readers.push(binding.folderPath);return {folderPath:binding.folderPath,metadataPath:binding.metadataPath,folderName:'Clean',images:[],project:createProject('Clean')};}),s=>{scan=s;});return loaded?scan:undefined;});
 await load(A);const a=slots.active,epoch=a.adapter.owner.capture().epoch;
 await expect(load(path.join(base,'missing'))).rejects.toThrow();expect(a.readonly).toBe(false);expect(a.adapter.owner.publishEdit(p=>p,[])).toBe(true);
 const before=a.adapter.owner.captureRecoveryContent();
 await load(B);expect(a.readonly).toBe(false);expect(a.adapter.owner.capture().epoch).toBe(epoch);expect(a.adapter.owner.captureRecoveryContent()).toEqual(before);
 const alias=path.join(base,'alias');await fs.symlink(A,alias);await load(alias);expect(slots.active).toBe(a);expect(a.readonly).toBe(false);expect(readers).toEqual([A,B]);expect(a.adapter.owner.publishEdit(p=>({...p,name:'A still editable'}),[])).toBe(true);expect(await fs.readdir(A)).toEqual([]);await queue.drain();
},30000);
test('actual failed B staging without a lease cannot be omitted in both A-only captures; A namespace and B bytes remain exact',async()=>{
 const {base,event,service}=await fixture(),A=path.join(base,'A'),B=path.join(base,'B');for(const root of [A,B])await fs.mkdir(path.join(root,'.storyboard-workbench'),{recursive:true});
 const project=createProject('A'),metadata=path.join(A,'.storyboard-workbench/storyboard.project.json');await fs.writeFile(metadata,JSON.stringify(project));
 const content={projectRaw:project,sequence:1,assetRevision:0,desiredAssets:[],retainedAssetIntents:[],effectFacts:{receipt:[],deletions:[],remainingScript:null}};
 await service.run(event,{folderPath:A,metadataPath:metadata,normalSave:true,project,recoveryContent:content},async()=>({ok:false,error:{message:'actual result boundary failed'}}));
 const capture={folderPath:A,content,canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:[],dirtyShotIds:[]};
 await service.observeWorkspace(event,B);await expect(service.ordinary(event,'workspace:openFolderByPath',B,[B],async()=>{await fs.writeFile(path.join(B,'stage.json'),'{"B":"retained"}');throw Error('B stage failed');})).rejects.toThrow('B stage failed');
 const before=await fs.readFile(path.join(A,'.storyboard-workbench/workspace-recovery-v1/namespace.json'));
 for(let i=0;i<2;i++)await expect(service.certifyRetainedSet(event,{slots:[capture]})).rejects.toThrow('omitted');
 expect(await fs.readFile(path.join(A,'.storyboard-workbench/workspace-recovery-v1/namespace.json'))).toEqual(before);expect(await fs.readFile(path.join(B,'stage.json'),'utf8')).toBe('{"B":"retained"}');expect(await fs.readFile(metadata,'utf8')).toBe(JSON.stringify(project));
},30000);
