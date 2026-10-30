// node src/renderer/drawing/canvas-harness.mjs
// Synthetic real Canvas checks only; creates a hidden, isolated Electron, never the production app.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'flow-pixel-canvas-'));
const userData = path.join(root, 'userData');
await mkdir(userData);
await mkdir(path.join(userData, 'logs'));
await mkdir(path.join(userData, 'crashDumps'));
const identity = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  status: execFileSync('git', ['status', '--short'], { cwd: repo, encoding: 'utf8' }).trim(),
  root, repo, startedAt: new Date().toISOString(), command: 'node src/renderer/drawing/canvas-harness.mjs' };
const bundle = await build({ stdin: { contents: `import {runPixelCanvasChecks} from ${JSON.stringify(path.join(here, 'canvas-checks.ts'))};
  globalThis.__flowPixelRun = runPixelCanvasChecks().then(value => ({ok:true,value}), error => ({ok:false,error:String(error.stack || error)}));`,
  resolveDir: repo, loader: 'ts' }, bundle: true, format: 'iife', platform: 'browser', write: false, logLevel: 'silent' });
const html = path.join(root, 'canvas.html');
await writeFile(html, `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; img-src blob: data:"><title>Flow synthetic pixels</title><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script>`);
const resultFile = path.join(root, 'browser-result.json');
const entry = path.join(root, 'entry.cjs');
await writeFile(entry, `
const {app, BrowserWindow, session, clipboard, shell} = require('electron');
const fs = require('node:fs');
app.setPath('userData', ${JSON.stringify(userData)});
app.setPath('sessionData', ${JSON.stringify(userData)});
app.setAppLogsPath(${JSON.stringify(path.join(userData, 'logs'))});
app.setPath('crashDumps', ${JSON.stringify(path.join(userData, 'crashDumps'))});
app.commandLine.appendSwitch('disable-background-networking');
for (const key of Object.keys(clipboard)) if (typeof clipboard[key] === 'function') clipboard[key] = () => { throw Error('Clipboard forbidden in pixel harness'); };
shell.trashItem = () => { throw Error('Trash forbidden in pixel harness'); };
let window;
app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*','ws://*/*','wss://*/*']}, (_details, callback) => callback({cancel:true}));
  window = new BrowserWindow({show:false, webPreferences:{sandbox:true, nodeIntegration:false, contextIsolation:true, backgroundThrottling:false}});
  window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
  await window.loadFile(${JSON.stringify(html)});
  const result = await window.webContents.executeJavaScript('globalThis.__flowPixelRun');
  fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify(result));
  if (!result || !result.ok) throw Error(result && result.error || 'Browser result missing');
  window.destroy(); app.exit(0);
}).catch(error => {
  fs.writeFileSync(${JSON.stringify(resultFile)}, JSON.stringify({ok:false,error:String(error.stack || error)}));
  if(window && !window.isDestroyed()) window.destroy(); app.exit(1);
});
`);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [entry], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
const chunks = [];
child.stdout.on('data', bytes => { chunks.push(bytes); process.stdout.write(bytes); });
child.stderr.on('data', bytes => { chunks.push(bytes); process.stderr.write(bytes); });
let exit;
try {
  exit = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', (code, signal) => resolve({ code, signal })); });
  await writeFile(path.join(root, 'electron.log'), Buffer.concat(chunks));
  const result = JSON.parse(await readFile(resultFile, 'utf8').catch(error => {
    throw new Error(`Electron exited ${JSON.stringify(exit)} without a browser result: ${error.message}`);
  }));
  assert.equal(exit.code, 0, JSON.stringify(result)); assert.equal(result.ok, true, JSON.stringify(result));
  const cases = [];
  for (const item of result.value.cases) {
    const files = {};
    for (const key of ['png', 'reference']) {
      const bytes = Buffer.from(item[key], 'base64');
      const output = path.join(root, `${item.name}-${key}.png`); await writeFile(output, bytes);
      files[key] = { path: output, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    }
    cases.push({ name: item.name, samples: item.samples, files });
  }
  const receipt = { ...identity, ...result.value, cases, exit, finishedAt: new Date().toISOString(),
    isolation: { hidden: true, network: 'blocked', clipboard: 'forbidden', trash: 'forbidden', userData } };
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(`PASS ${cases.length} real Canvas cases; raw PNG/reference/receipt/log: ${root}`);
} catch (error) {
  await writeFile(path.join(root, 'failure.json'), JSON.stringify({ ...identity, exit, error: String(error.stack || error) }, null, 2) + '\n');
  console.error(`FAIL; all synthetic evidence retained: ${root}`); throw error;
}
