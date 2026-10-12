import {test,expect,onTestFinished} from 'vitest';
import fs from 'node:fs/promises';import path from 'node:path';import sharp from 'sharp';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {assertPhysicalWorkspaceWriterTargets} from './workspacePhysicalWriterGate';
import {serializeStoryboardScriptMarkdown} from './storyboardScript';
import {createWorkspaceSlots} from '../../src/renderer/workspaceSlots';
import {createBitmapLayerWriteQueue} from '../../src/renderer/bitmapLayerWriteQueue';
import {createProject} from '../../src/shared/projectOps';
import {captureProjectHistoryData} from '../../src/renderer/projectHistoryController';
const options={budget:{bytes:134217728,records:2000,assets:64,jsonDepth:80},python:'/opt/homebrew/opt/python@3.12/libexec/bin/python3',script:path.resolve('scripts/recovery-content-permissions.py')};
async function fixture(label:string){
 const folder=await fs.mkdtemp(path.join(process.env.TMPDIR!,'handoff-'+label+'-'));onTestFinished(()=>fs.rm(folder,{recursive:true,force:true}));
 const metadata=path.join(folder,'.storyboard-workbench/storyboard.project.json'),png=path.join(folder,'.storyboard-workbench/layers/s/paint.png'),tiff=path.join(folder,'a.tiff'),script=path.join(folder,'storyboard-script.md');
 await fs.mkdir(path.dirname(png),{recursive:true,mode:0o700});
 const pngBytes=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer(),desired=await sharp({create:{width:2,height:2,channels:4,background:'blue'}}).png().toBuffer(),history=await sharp({create:{width:2,height:2,channels:4,background:'yellow'}}).png().toBuffer();
 await fs.writeFile(png,pngBytes,{mode:0o600});await fs.writeFile(tiff,await sharp(pngBytes).tiff().toBuffer(),{mode:0o600});
 const project:any={...createProject(label),shots:[{id:'s',imagePath:tiff,fileName:'a.tiff',order:0,swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'paint',kind:'paint',width:2,height:2,bitmapPath:path.relative(folder,png)}]}],pendingBake:{version:1,shots:{s:{state:'synced',acceptedOutputIdentity:'0'.repeat(64)}}}};
 await fs.writeFile(metadata,JSON.stringify(project),{mode:0o600});await fs.writeFile(script,serializeStoryboardScriptMarkdown(project),{mode:0o600});
 const historyData={undo:[{project:{...project,name:'History '+label},selectedShotIds:['s'],fileNameSyncState:'unsynced',layerAssets:[{bitmapPath:path.relative(folder,png),dataUrl:'data:image/png;base64,'+history.toString('base64')}]}],redo:[]};
 historyData.undo[0].project.parkedShots=undefined;
 const content={projectRaw:project,desiredAssets:[{folderPath:folder,bitmapPath:path.relative(folder,png),shotId:'s',layerId:'paint',dataUrl:'data:image/png;base64,'+desired.toString('base64')}],sequence:7,assetRevision:3,effectFacts:{unsettled:true,receipt:[],deletions:[],remainingScript:null},retainedAssetIntents:[]};
 const view={canvas:{hasUnsettledGesture:false,captures:[]},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'unsynced',workspaceSaveState:'error',history:captureProjectHistoryData(historyData.undo as any,historyData.redo)};
 return {folder,metadata,png,script,project,content,view,history};
}
test('native original MD EACCES + actual g2 certifyHandoff enables separate Owner B without retiring A; History fresh readback and auth negatives',async()=>{
 const A=await fixture('A'),B=await fixture('B'),frame={},sender={mainFrame:frame},window={},event={sender,senderFrame:frame} as any;
 const service=createPreparedWorkspaceSave({...options,ownerFromSender:s=>s===sender?window:undefined}),queue=createBitmapLayerWriteQueue();
 const readers:string[]=[],persists:string[]=[],published:string[]=[];
 const slots=createWorkspaceSlots({initialProject:createProject('untitled'),observe:p=>service.observeWorkspace(event,p),drain:()=>queue.drain(),captureView:()=>A.view,
   certifyHandoff:(slot,capture)=>service.certifyHandoff(event,{...capture as object,...slot.view as object}),publishProject:p=>published.push(p.name),publishActive:()=>{},
   adapterPorts:()=>({queue,freshToken:()=> 'token',onSave:()=>{},onError:()=>{},api:()=>({readOutputIdentity:async()=> '0'.repeat(64),
     saveWorkspace:payload=>service.runIpc(event,payload,async()=>{await fs.writeFile(A.script,'blocked original script');return {project:payload.project,normalSaveOutputs:[]};}),
     autosaveWorkspace:async payload=>{persists.push(payload.folderPath);await fs.writeFile(payload.metadataPath,JSON.stringify(payload.project));await fs.writeFile(path.join(payload.folderPath,'storyboard-script.md'),serializeStoryboardScriptMarkdown(payload.project));}})})});
 const load=(folder:string)=>slots.requestOpen(folder,async(slot,root)=>{let scan:any;readers.push(root.folderPath);const project=root.folderPath===A.folder?A.project:B.project;
   const loaded=await slot.adapter.load(async()=>({folderPath:root.folderPath,metadataPath:root.metadataPath,folderName:project.name,images:[],project}),s=>{scan=s;});return loaded?scan:undefined;});
 await load(A.folder);const a=slots.active;await fs.chmod(A.script,0o400);expect(await a.adapter.save()).toBe(false);
 const before=a.adapter.owner.captureRecoveryContent(),epoch=a.adapter.owner.capture().epoch;expect(before.effectFacts.unsettled).toBe(true);expect(before.effectFacts.error?.message).toMatch(/EACCES/);
 expect(await load(B.folder)).toBe(true);expect(readers).toEqual([A.folder,B.folder]);expect(a.adapter.owner.capture().epoch).toBe(epoch);expect(a.adapter.owner.captureRecoveryContent()).toEqual(before);
 const b=slots.active;expect(b.adapter.owner.publishEdit(p=>({...p,name:'B native edit'}),[])).toBe(true);expect(await b.adapter.autosave(b.projectRef.current)).toBe(true);expect(persists).toEqual([B.folder]);
 const fresh=await createPreparedWorkspaceSave(options).readReadonly(A.folder);expect((fresh.viewState as any).history).toEqual(A.view.history);expect(fresh.assets.some(a=>a.sourceDataUrl==='data:image/png;base64,'+A.history.toString('base64'))).toBe(true);
 expect((await fs.stat(A.script)).mode&0o777).toBe(0o400);await expect(assertPhysicalWorkspaceWriterTargets([A.png])).rejects.toThrow('protected');
 const capture={folderPath:A.folder,binding:a.root!.binding,content:before,...A.view};
 await expect(service.certifyHandoff({...event,senderFrame:{}} as any,capture)).rejects.toThrow('top-frame');
 await expect(service.certifyHandoff(event,{...capture,binding:b.root!.binding})).rejects.toThrow('observation mismatch');
 await expect(service.certifyHandoff(event,{...capture,history:{...A.view.history,undo:[{...A.view.history.undo[0],layerAssets:[{bitmapPath:'foreign.png',dataUrl:A.view.history.undo[0].layerAssets[0].dataUrl}]}]}})).rejects.toThrow('not authenticated');
 await fs.symlink(A.folder,path.join(B.folder,'alias-A'));expect(await service.observeWorkspace(event,path.join(B.folder,'alias-A'))).toEqual(a.root);
 service.invalidateDocument(sender);await expect(service.observeWorkspace(event,A.folder)).rejects.toThrow('incarnation changed');await expect(service.certifyHandoff(event,capture)).rejects.toThrow('mismatch');
 await queue.drain();
},120000);
