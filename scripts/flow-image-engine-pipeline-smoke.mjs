// Real pipeline display acceptance, NOT a Main Project Session/CAS or physical-pen benchmark.
// Run after npm run build. Copies only two explicitly named connection sources into temp.
// FLOW_PIPELINE_SAMPLE_INTERVAL_MS=10 uses global absolute deadlines; default 0 is burst.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, realpath, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = await mkdtemp(path.join(await realpath(os.tmpdir()), 'flow-image-engine-pipeline-'));
await mkdir(path.join(run, 'profile')); await mkdir(path.join(run, 'connection-source'));
const size=Number(process.env.FLOW_PIPELINE_SIZE??2048),interval=Number(process.env.FLOW_PIPELINE_SAMPLE_INTERVAL_MS??0);
if(![2048,4096].includes(size)||!Number.isInteger(interval)||interval<0||interval>1000)throw Error('Invalid pipeline canvas size/sample interval');
const connectionRoot = process.env.FLOW_IMAGE_CONNECTION_DIR ?? path.join(repo, 'src/platform/main'), sourceHashes = {};
for (const name of ['imageEngineConnection.ts','imageEngineFraming.ts']) {
  const bytes = await readFile(path.join(connectionRoot,name)); sourceHashes[name] = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(run,'connection-source',name),bytes);
}
await build({entryPoints:[path.join(run,'connection-source/imageEngineConnection.ts')],outfile:path.join(run,'connection.cjs'),bundle:true,format:'cjs',platform:'node'});
const browser=await build({entryPoints:[path.join(repo,'scripts/flow-image-engine-pipeline-browser.ts')],bundle:true,write:false,format:'iife',globalName:'PipelineHarness',platform:'browser'});
await writeFile(path.join(run,'browser.js'),browser.outputFiles[0].contents);
await writeFile(path.join(run,'connection-source.json'),JSON.stringify({connectionRoot,sourceHashes},null,2));
await writeFile(path.join(run,'preload.cjs'),`const{ipcRenderer}=require('electron');ipcRenderer.on('pipeline-port',(e,d)=>window.postMessage({kind:'flow-pipeline-port',nonce:d.nonce},'*',e.ports));`);
await writeFile(path.join(run,'index.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'"><style>body{margin:0;background:white}.surface{position:absolute;overflow:hidden;width:512px;height:512px}#sa{left:20px;top:20px}#sb{left:560px;top:20px}canvas{position:absolute;left:0;top:0;image-rendering:pixelated}#a{width:${size}px;height:${size}px}#b{width:${size*2}px;height:${size*2}px}#reference{position:absolute;left:560px;top:320px;width:48px;height:48px}</style><div class="surface" id="sa"><canvas id="a"></canvas></div><div class="surface" id="sb"><canvas id="b"></canvas></div><div id="reference"></div><script src="browser.js"></script>`);
const binary=process.env.FLOW_IMAGE_HOST??'/private/tmp/flow-image-engine-toolchain/bin/flow-photocraft-host-8adc75f';
const env={...process.env,FLOW_PIPELINE_REPO:repo,FLOW_PIPELINE_RUN:run,FLOW_PIPELINE_HOST:binary};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(createRequire(import.meta.url)('electron'),[path.join(repo,'scripts/flow-image-engine-pipeline-driver.cjs')],{cwd:repo,env,stdio:'inherit'});
const timer=setTimeout(()=>child.kill('SIGTERM'),180000);
const ended=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
console.log('Electron exit:',JSON.stringify(ended));let result;
try{result=JSON.parse(await readFile(path.join(run,'result.json'),'utf8'));}catch(cause){throw Error('Pipeline smoke did not report at '+run,{cause});}
if(ended.code!==0||result.error||!result.completed)throw Error('Pipeline display failed: '+run);
console.log('PASS live 40-stroke pipeline display:',run);
