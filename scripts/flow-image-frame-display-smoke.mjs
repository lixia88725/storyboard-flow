// Isolated display/MessagePort smoke. Does not load the user's project or product entry.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = await mkdtemp(path.join(await realpath(os.tmpdir()), 'flow-image-frame-display-'));
await mkdir(path.join(run, 'profile'));
const bundle = await build({ entryPoints: [path.join(repo, 'scripts/flow-image-frame-display-browser.ts')],
  bundle: true, write: false, format: 'iife', globalName: 'FrameDisplayHarness', platform: 'browser' });
await writeFile(path.join(run, 'browser.js'), bundle.outputFiles[0].contents);
await writeFile(path.join(run, 'preload.cjs'), `const {ipcRenderer}=require('electron');
ipcRenderer.on('frame-port',(event,meta)=>{window.postMessage({kind:'flow-image-frame-port',nonce:meta.nonce},'*',event.ports);});\n`);
await writeFile(path.join(run, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'">
<style>body{margin:0;background:white}canvas{position:absolute;image-rendering:pixelated}#a{left:20px;top:20px;width:128px;height:64px}#b{left:180px;top:20px;width:256px;height:128px}</style>
<canvas id="a"></canvas><canvas id="b"></canvas><script src="browser.js"></script>`);
const env = { ...process.env, FLOW_FRAME_REPO: repo, FLOW_FRAME_RUN: run }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(createRequire(import.meta.url)('electron'), [path.join(repo, 'scripts/flow-image-frame-display-driver.cjs')], { cwd: repo, env, stdio: 'inherit' });
const timer = setTimeout(() => child.kill('SIGTERM'), 90000);
const ended = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); }); clearTimeout(timer);
console.log('Electron exit:', JSON.stringify(ended));
const code = ended.code;
let result;
try { result = JSON.parse(await readFile(path.join(run, 'result.json'), 'utf8')); }
catch (error) { throw Error('Electron exited before producing a report: ' + JSON.stringify(ended) + ' at ' + run, { cause: error }); }
if (code !== 0 || result.error || !result.completed) throw Error('Native display smoke failed: ' + run);
console.log('PASS native frame display:', run);
