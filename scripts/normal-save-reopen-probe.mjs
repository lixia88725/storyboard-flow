// Test-only fresh Node owner reconstruction. No App/main launch or substitute writer.
import { build } from 'esbuild';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
const [folderPath, metadataPath] = process.argv.slice(2);
if (!folderPath || !metadataPath || !path.resolve(folderPath).startsWith(path.resolve(tmpdir()) + path.sep) || !path.resolve(metadataPath).startsWith(path.resolve(folderPath) + path.sep)) throw Error('Synthetic fixture only');
const directory = await mkdtemp(path.join(tmpdir(), 'normal-save-reopen-'));
try {
 const entry = `import {readFile} from 'node:fs/promises'; import {createHash} from 'node:crypto';
 import {createNormalSaveAppAdapter} from './src/renderer/normalSaveAppAdapter';
 import {createBitmapLayerWriteQueue} from './src/renderer/bitmapLayerWriteQueue';
 const folderPath=${JSON.stringify(folderPath)},metadataPath=${JSON.stringify(metadataPath)};
 const ref={current:JSON.parse(await readFile(metadataPath,'utf8'))}; const forbidden=()=>{throw Error('Read-only reopen: writer/token/network forbidden');};
 const api={readOutputIdentity:async p=>createHash('sha256').update(await readFile(p)).digest('hex'),saveWorkspace:forbidden,autosaveWorkspace:forbidden};
 const adapter=createNormalSaveAppAdapter({projectRef:ref,setProject:()=>{},queue:createBitmapLayerWriteQueue(),freshToken:forbidden,paths:()=>({folderPath,metadataPath}),api:()=>api,onSave:forbidden,onError:forbidden});
 if(!await adapter.load(async()=>({folderPath,metadataPath,folderName:'Synthetic',images:[],project:JSON.parse(await readFile(metadataPath,'utf8'))}),()=>{}))throw Error('Fresh disk load failed');
 console.log(JSON.stringify({pid:process.pid,project:ref.current,readOnly:true}));`;
 await build({stdin:{contents:entry,resolveDir:process.cwd(),sourcefile:'fresh-reopen.ts',loader:'ts'},bundle:true,platform:'node',format:'esm',outfile:path.join(directory,'reopen.mjs')});
 const child=spawnSync(process.execPath,[path.join(directory,'reopen.mjs')],{env:{PATH:process.env.PATH,HOME:directory,TMPDIR:process.env.TMPDIR},encoding:'utf8',timeout:20000});
 if(child.status!==0)throw Error(child.stderr||String(child.error));
 process.stdout.write(child.stdout);
} finally { await rm(directory,{recursive:true,force:true}); }
