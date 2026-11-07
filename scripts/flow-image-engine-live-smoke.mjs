// Live native + chief Node connection + real Electron display. Synthetic temp data only.
// Run after npm run build. FLOW_IMAGE_CONNECTION_DIR may point at the chief's source;
// only Connection.ts/Framing.ts are copied to the owned temp bundle and hashed.
// Default host is the fixed serial candidate. No pipeline/performance claim is made.
// Screen acceptance uses an independent same-RGBA CSS alpha swatch plus an opaque
// positive control. Straight-sRGB arithmetic premix mismatch is recorded separately:
// a wide-gamut output compositor need not match that initially assumed numeric oracle.
// FLOW_LIVE_FORCE_SRGB=1 is an optional isolated-process diagnostic, never a user setting.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, realpath, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = await mkdtemp(path.join(await realpath(os.tmpdir()), 'flow-image-engine-live-'));
await mkdir(path.join(run, 'profile')); await mkdir(path.join(run, 'connection-source')); await mkdir(path.join(run, 'frames'));
const connectionRoot = process.env.FLOW_IMAGE_CONNECTION_DIR ?? path.join(repo, 'src/platform/main');
const sourceHashes = {};
// Only these two explicitly authorized chief files are copied; never add them to this lane's source tree.
for (const name of ['imageEngineConnection.ts', 'imageEngineFraming.ts']) {
  const bytes = await readFile(path.join(connectionRoot, name));
  sourceHashes[name] = createHash('sha256').update(bytes).digest('hex');
  await writeFile(path.join(run, 'connection-source', name), bytes);
}
await build({ entryPoints: [path.join(run, 'connection-source/imageEngineConnection.ts')], outfile: path.join(run, 'connection.cjs'), bundle: true, format: 'cjs', platform: 'node' });
const browser = await build({ entryPoints: [path.join(repo, 'scripts/flow-image-engine-live-browser.ts')], bundle: true, write: false, format: 'iife', globalName: 'LiveHarness', platform: 'browser' });
await writeFile(path.join(run, 'browser.js'), browser.outputFiles[0].contents);
await writeFile(path.join(run, 'connection-source.json'), JSON.stringify({ connectionRoot, sourceHashes }, null, 2));
await writeFile(path.join(run, 'preload.cjs'), `const {ipcRenderer}=require('electron');\nipcRenderer.on('live-port',(event,data)=>window.postMessage({kind:'flow-live-port',nonce:data.nonce},'*',event.ports));\n`);
await writeFile(path.join(run, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'"><style>body{margin:0;background:white}canvas{position:absolute;image-rendering:pixelated}#a{left:20px;top:20px;width:128px;height:64px}#b{left:180px;top:20px;width:256px;height:128px}.swatch{position:absolute;top:180px;width:32px;height:24px}#css-alpha{left:20px}#css-opaque{left:80px}</style><canvas id="a"></canvas><canvas id="b"></canvas><div class="swatch" id="css-alpha"></div><div class="swatch" id="css-opaque"></div><script src="browser.js"></script>`);
const binary = process.env.FLOW_IMAGE_HOST ?? '/private/tmp/flow-image-engine-toolchain/bin/flow-photocraft-host-364c758';
const env = { ...process.env, FLOW_LIVE_REPO: repo, FLOW_LIVE_RUN: run, FLOW_LIVE_HOST: binary }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(createRequire(import.meta.url)('electron'), [path.join(repo, 'scripts/flow-image-engine-live-driver.cjs')], { cwd: repo, env, stdio: 'inherit' });
const timer = setTimeout(() => child.kill('SIGTERM'), 90000);
const ended = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); }); clearTimeout(timer);
console.log('Electron exit:', JSON.stringify(ended));
let result; try { result = JSON.parse(await readFile(path.join(run, 'result.json'), 'utf8')); }
catch (cause) { throw Error('Live smoke exited before reporting: ' + JSON.stringify(ended) + ' at ' + run, { cause }); }
if (ended.code !== 0 || result.error || !result.completed || !result.screenReferenceMatches) throw Error('Live image engine smoke failed: ' + run);
console.log('PASS live native → Node connection → MessagePort → dual Canvas:', run);
