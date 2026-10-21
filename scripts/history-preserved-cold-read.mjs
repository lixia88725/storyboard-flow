// Fresh Node OS process, real compiled Main/native store. Synthetic Electron
// event is the public service boundary; this is NOT mounted App/preload/GUI.
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
const [root,nonce]=process.argv.slice(2);
const allowed=await fs.realpath(os.tmpdir());
assert.ok(root.startsWith(allowed+'/private-history-native-'));
assert.equal(await fs.realpath(root),root);assert.equal(process.env.TMPDIR,allowed);
const { createPreparedWorkspaceSave }=await import(pathToFileURL(path.resolve('dist-electron/main/preparedWorkspaceSave.js')).href);
const service=createPreparedWorkspaceSave({budget:{bytes:16*1024*1024,records:2000,assets:64,jsonDepth:80},python:'python3',script:path.resolve('scripts/recovery-content-permissions.py')});
const content=await service.readReadonly(root),project=content.projectRaw;
assert.equal(content.continuationState.notExecutable,true);
const frame={},event={sender:{mainFrame:frame},senderFrame:frame},denied={};let callbacks=0;
const metadata=path.join(root,'.storyboard-workbench/storyboard.project.json');
const assets=project.shots.flatMap(s=>(s.layers??[]).filter(l=>l.bitmapPath).map(l=>({bitmapPath:l.bitmapPath})));
assert.ok(assets.length>0);
const reject=async(name,run)=>{let failed=false;try{await run();}catch{failed=true;}assert.equal(failed,true,name+' must refuse');denied[name]=true;};
await reject('writer',()=>service.ordinary(event,'layers:writePng',{folderPath:root},[path.join(root,assets[0].bitmapPath)],async()=>{callbacks++;}));
await reject('autosave',()=>service.ordinary(event,'workspace:autosave',{folderPath:root,metadataPath:metadata,project},[metadata,path.join(root,'storyboard-script.md')],async()=>{callbacks++;}));
await reject('history',()=>service.beginHistoryAssets(event,{folderPath:root,project,targetProject:project,assets}));
await reject('ack',()=>service.acknowledge(event,{folderPath:root,nonce,project}));
assert.equal(callbacks,0);console.log(JSON.stringify({pid:process.pid,content,denied,callbacks}));
