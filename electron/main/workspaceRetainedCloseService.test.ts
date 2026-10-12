import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { createWorkspaceRetainedCloseService } from './workspaceRetainedCloseService.js';
const options={python:'/opt/homebrew/bin/python3.12',script:path.resolve('scripts/recovery-content-permissions.py'),budget:{bytes:1048576,records:100,assets:16,jsonDepth:40}};
it('retained-close stores exact desired pixels through real native authorization and cold read leaves all bytes unchanged',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retained-close-'));
 await fs.mkdir(path.join(root,'.storyboard-workbench/layers/s'),{recursive:true,mode:0o700});
 const original=await sharp({create:{width:2,height:2,channels:4,background:'#fff'}}).png().toBuffer();
 const desired=await sharp({create:{width:2,height:2,channels:4,background:'#ff0000'}}).png().toBuffer();
 const image=path.join(root,'image.png'),layer='.storyboard-workbench/layers/s/l.png';
 const project={shots:[{id:'s',imagePath:image,layers:[{id:'l',bitmapPath:layer}]}],futureRaw:['unknown'],pendingBake:{version:1,shots:{s:{state:'unknown'}}}};
 for(const [p,bytes] of [[image,original],[path.join(root,layer),original],[path.join(root,'.storyboard-workbench/storyboard.project.json'),Buffer.from(JSON.stringify(project))]] as const)await fs.writeFile(p,bytes,{mode:0o400});
 const frame={},sender={mainFrame:frame};
 const capture={folderPath:root,content:{projectRaw:project,sequence:4,assetRevision:2,desiredAssets:[{folderPath:root,bitmapPath:layer,shotId:'s',layerId:'l',version:2,dataUrl:'data:image/png;base64,'+desired.toString('base64')}],effectFacts:{unsettled:true,receipt:[],deletions:[],remainingScript:null,error:{message:'failed'}}},canvas:{captures:[],hasUnsettledGesture:false},selectedShotIds:['s'],dirtyShotIds:['s'],fileNameSyncState:'pending',workspaceSaveState:'error'};
 const service=createWorkspaceRetainedCloseService(options);
 expect(await service.certifyRetained({sender,senderFrame:frame} as any,capture)).toBe(true);
 const readonly=await createWorkspaceRetainedCloseService(options).readReadonly(root);
 expect(readonly.projectRaw).toEqual(project);expect(readonly.assets[1].dataUrl).toBe('data:image/png;base64,'+desired.toString('base64'));
 expect(await fs.readFile(image)).toEqual(original);expect(await fs.readFile(path.join(root,layer))).toEqual(original);
 const files=await fs.readdir(path.join(root,'.storyboard-workbench/workspace-recovery-v1'),{recursive:true});
 for(const p of files){const s=await fs.lstat(path.join(root,'.storyboard-workbench/workspace-recovery-v1',p));expect(s.mode&0o777).toBe(s.isDirectory()?0o700:0o400);}
});
it('unconfigured finite budget and unsupported parked/deleted coverage refuse close, never emit requested-only permission',async()=>{
 const frame={},sender={mainFrame:frame};
 await expect(createWorkspaceRetainedCloseService({...options,budget:undefined}).certifyRetained({sender,senderFrame:frame} as any,{})).rejects.toThrow('not configured');
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retained-unsupported-'));
 const capture={folderPath:root,content:{projectRaw:{shots:[],parkedShots:[{}]},effectFacts:{receipt:[],deletions:[],remainingScript:null}},canvas:{captures:[],hasUnsettledGesture:false}};
 await expect(createWorkspaceRetainedCloseService(options).certifyRetained({sender,senderFrame:frame} as any,capture)).rejects.toThrow('parked/deleted');
 expect(await fs.readdir(root)).toEqual([]);
});
