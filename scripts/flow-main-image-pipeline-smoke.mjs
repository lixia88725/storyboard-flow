// Run npm run build first. Default is the small real-project GUI lifecycle check.
// FLOW_MAIN_PIPELINE_MODE=paced requires a separately coordinated idle window.
import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';import fs from 'node:fs/promises';import {createHash} from 'node:crypto';
import os from 'node:os';import path from 'node:path';import {build} from 'esbuild';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),mode=process.env.FLOW_MAIN_PIPELINE_MODE??'small';
if(!['small','paced'].includes(mode))throw Error('Invalid mode');
const run=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'flow-main-image-pipeline-'));await fs.mkdir(path.join(run,'profile'));await fs.mkdir(path.join(run,'project'));
const main=await build({entryPoints:[path.join(repo,'scripts/flow-main-image-pipeline-runtime.ts')],outfile:path.join(run,'main.cjs'),platform:'node',format:'cjs',bundle:true,metafile:true});
const sourceHashes={};for(const input of Object.keys(main.metafile.inputs)){const absolute=path.resolve(repo,input);if(absolute.endsWith('/src/renderer/normalSaveMetadataHistory.test.ts'))throw Error('Forbidden input');sourceHashes[path.relative(repo,absolute)]=createHash('sha256').update(await fs.readFile(absolute)).digest('hex');}
await fs.writeFile(path.join(run,'source-hashes.json'),JSON.stringify(sourceHashes,null,2));
const browser=await build({entryPoints:[path.join(repo,'scripts/flow-main-image-pipeline-browser.ts')],bundle:true,write:false,platform:'browser',format:'iife',globalName:'PipelineHarness'});await fs.writeFile(path.join(run,'browser.js'),browser.outputFiles[0].contents);
await fs.writeFile(path.join(run,'preload.cjs'),`const{ipcRenderer}=require('electron');ipcRenderer.on('main-pipeline-port',(e,d)=>window.postMessage({kind:'flow-pipeline-port',nonce:d.nonce},'*',e.ports));`);
const size=mode==='paced'?2048:512;
await fs.writeFile(path.join(run,'index.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'"><style>body{margin:0;background:white}.surface{position:absolute;overflow:hidden;width:512px;height:512px}#sa{left:20px;top:20px}#sb{left:560px;top:20px}canvas{position:absolute;left:0;top:0;image-rendering:pixelated}#a{width:${size}px;height:${size}px}#b{width:${size*2}px;height:${size*2}px}#reference{position:absolute;left:560px;top:320px;width:48px;height:48px}</style><div id="sa" class="surface"><canvas id="a"></canvas></div><div id="sb" class="surface"><canvas id="b"></canvas></div><div id="reference"></div><script src="browser.js"></script>`);
const env={...process.env,FLOW_MAIN_PIPELINE_RUN:run,FLOW_MAIN_PIPELINE_REPO:repo,FLOW_MAIN_PIPELINE_MODE:mode};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(createRequire(import.meta.url)('electron'),[path.join(repo,'scripts/flow-main-image-pipeline-driver.cjs')],{cwd:repo,env,stdio:'inherit'});
const timer=setTimeout(()=>child.kill('SIGTERM'),180000);const exit=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});clearTimeout(timer);
console.log('Electron exit:',JSON.stringify(exit));const report=JSON.parse(await fs.readFile(path.join(run,'result.json'),'utf8'));
if(exit.code!==0||report.error||!report.completed)throw Error('Main pipeline GUI failed: '+run);
console.log('FUNCTIONAL PASS real Main project '+mode+': '+run);
if(mode==='paced')console.log('Paced metrics are a separate result: inspect deadline misses, backlog and backpressure; functional PASS does not certify timing performance.');
