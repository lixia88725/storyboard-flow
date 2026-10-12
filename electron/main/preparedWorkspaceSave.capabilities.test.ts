import {test,expect} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import sharp from 'sharp';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {createWorkspacePhysicalWriterGate} from './workspacePhysicalWriterGate';
import {serializeStoryboardScriptMarkdown} from './storyboardScript';

async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'save-cap-')),metadata=path.join(root,'.storyboard-workbench/storyboard.project.json'),png=path.join(root,'.storyboard-workbench/layers/s/l.png'),tiff=path.join(root,'a.tiff');await fs.mkdir(path.dirname(png),{recursive:true,mode:0o700});
 const bytes=await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer();await fs.writeFile(png,bytes,{mode:0o600});await fs.writeFile(tiff,await sharp(bytes).tiff().toBuffer(),{mode:0o600});
 const project={id:'p',name:'p',shots:[{id:'s',imagePath:tiff,fileName:'a.tiff',order:0,swb:{status:'owned',canvasWidth:2,canvasHeight:2},layers:[{id:'l',kind:'image',width:2,height:2,bitmapPath:path.relative(root,png)}]}],dialogues:[]};await fs.writeFile(metadata,JSON.stringify(project),{mode:0o600});
 const frame={},sender={mainFrame:frame},event={sender,senderFrame:frame} as any;
 const payload={folderPath:root,metadataPath:metadata,normalSave:true,project,recoveryContent:{projectRaw:project,desiredAssets:[],sequence:1,assetRevision:0,effectFacts:{receipt:[],deletions:[],remainingScript:null}}};
 const options={budget:{bytes:1048576,records:100,assets:16,jsonDepth:40},python:'/opt/homebrew/bin/python3.12',script:path.join(process.cwd(),'scripts/recovery-content-permissions.py')};return {root,metadata,project,event,payload,options};
}
test('unconfigured/quota/native-policy preparation failure invokes no original effect',async()=>{
 for(const mode of ['unconfigured','quota','source0400']){const f=await fixture();const opts={...f.options,budget:mode==='unconfigured'?undefined:mode==='quota'?{...f.options.budget,bytes:32}:f.options.budget};if(mode==='source0400')await fs.chmod(f.project.shots[0].imagePath,0o500);let effects=0;
  await expect(createPreparedWorkspaceSave(opts).run(f.event,f.payload,async()=>{effects++;return{};})).rejects.toThrow();expect(effects).toBe(0);
  const envelope=await createPreparedWorkspaceSave(opts).runIpc(f.event,f.payload,async()=>{effects++;return{};});expect(envelope.error.sourceEffects).toBe(0);expect(envelope.error.recoveryIncomplete).toBe(true);expect(effects).toBe(0);
 }
});
test('actual gate keeps ordinary writer and wrong nonce/frame/B/replay before effects zero; valid bound final persist and Owner ACK',async()=>{
 const f=await fixture(),service=createPreparedWorkspaceSave(f.options);let effects=0;const handlers=new Map<string,Function>();
 const gate=createWorkspacePhysicalWriterGate({handle:(c:string,h:Function)=>{handlers.set(c,h);}} as any,{save:service.run,persist:service.persist});
 gate.handle('workspace:save',async()=>({...f.payload,normalSaveOutputs:[]}));gate.handle('workspace:autosave',async(_e:any,p:any)=>{effects++;await fs.writeFile(f.metadata,`${JSON.stringify(p.project,null,2)}\n`);await fs.writeFile(path.join(f.root,'storyboard-script.md'),serializeStoryboardScriptMarkdown(p.project));return p;});
 const saved=await handlers.get('workspace:save')!(f.event,f.payload),persist={...f.payload,recoverySaveNonce:saved.recoverySaveNonce};
 for(const [e,p] of [[f.event,{...persist,recoverySaveNonce:'wrong'}],[{...f.event,senderFrame:{}},persist],[{sender:{mainFrame:f.event.senderFrame},senderFrame:f.event.senderFrame},persist],[f.event,{...persist,folderPath:f.root+'-B'}],[f.event,{...persist,recoverySaveNonce:undefined}],[f.event,{...persist,normalSave:false}]])await expect(handlers.get('workspace:autosave')!(e,p)).rejects.toThrow();
 expect(effects).toBe(0);
 await handlers.get('workspace:autosave')!(f.event,persist);expect(effects).toBe(1);
 await expect(handlers.get('workspace:autosave')!(f.event,persist)).rejects.toThrow();expect(effects).toBe(1);
 expect(await service.acknowledge(f.event,{folderPath:f.root,nonce:saved.recoverySaveNonce,project:f.project})).toBe(true);
 await expect(service.acknowledge(f.event,{folderPath:f.root,nonce:saved.recoverySaveNonce,project:f.project})).rejects.toThrow();
 const result=await service.run(f.event,f.payload,async()=>({...f.payload,normalSaveOutputs:[]}));expect(result.recoverySaveNonce).not.toBe(saved.recoverySaveNonce);
 service.invalidateDocument(f.event.sender);await expect(service.persist(f.event,{...persist,recoverySaveNonce:result.recoverySaveNonce},async()=>{effects++;})).rejects.toThrow();expect(effects).toBe(1);
},30000);
