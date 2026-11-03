// Focused, synthetic-only GUI check. Build first. No clipboard or Trash use.
// Only native chooser/prompt responses are supplied by the test entry; all
// renderer/preload/Main, staging Import, Save and retention code is production.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const singleProject = process.argv.includes('--single-project');
const switchLaunchContext = process.argv.includes('--switch-launch-context');
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Same platform alias as the other smoke scripts: the backend refuses /var-style spellings.
const root = await mkdtemp(path.join(await realpath(os.tmpdir()), 'flow-inline-import-'));
const source = path.join(root, 'old-board'), otherSource = path.join(root, 'other-board');
const managedName = '.storyboard-flow-project';
const userData = path.join(root, 'userData');
const metadata = folder => path.join(folder, '.storyboard-flow/storyboard.project.json');
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (fn, label, timeout = 30000) => {
  const start = Date.now(); let last;
  while (Date.now() - start < timeout) {
    try { const value = await fn(); if (value) return value; } catch (error) { last = error; }
    await delay(100);
  }
  throw new Error(`Timed out: ${label}${last ? `; ${last.message}` : ''}`);
};
for (const dir of [source, otherSource, userData, path.dirname(metadata(source)), path.dirname(metadata(otherSource))]) await mkdir(dir, { recursive: true });
for (const [index, color] of ['#dfb57b', '#76a7ae'].entries()) {
  const svg = `<svg width="640" height="360"><rect width="640" height="360" fill="${color}"/><path d="M0 300L200 130L370 270L520 100L640 280" stroke="#253239" fill="none" stroke-width="8"/><circle cx="420" cy="80" r="30" fill="#eee5ce"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(path.join(source, `shot-${index + 1}.png`));
}
await writeFile(metadata(source), JSON.stringify({ id: 'legacy', name: 'Old board', shots: [{ id: 'legacy-shot', imagePath: path.join(source, 'shot-1.png'), fileName: 'shot-1.png', order: 0, sketchLayers: [{ id: 'old-ink' }] }], dialogues: [] }));
await writeFile(metadata(otherSource), await readFile(metadata(source)));
for (const name of ['shot-1.png', 'shot-2.png']) await writeFile(path.join(otherSource, name), await readFile(path.join(source, name)));
const originals = [metadata(otherSource), path.join(otherSource, 'shot-1.png'), path.join(otherSource, 'shot-2.png'), metadata(source), path.join(source, 'shot-1.png'), path.join(source, 'shot-2.png')];
const before = await Promise.all(originals.map(hash));
await writeFile(path.join(userData, 'recent-folders.json'), JSON.stringify([source]));
const entry = path.join(root, 'entry.cjs');
await writeFile(entry, `const {app, dialog, clipboard, shell} = require('electron');
for (const key of Object.keys(clipboard)) if (typeof clipboard[key] === 'function') clipboard[key] = () => { throw new Error('Test forbids clipboard access'); };
shell.trashItem = async () => { throw new Error('Test forbids Trash access'); };
const fs = require('node:fs');
process.env.FLOW_USER_DATA_DIR = ${JSON.stringify(userData)};
process.env.FLOW_PYTHON_DEPS_DIR = ${JSON.stringify(process.env.FLOW_PYTHON_DEPS_DIR ?? path.join(repo, 'vendor/python/photoshop-tiff'))};
process.env.VITE_DEV_SERVER_URL = '';
fs.writeFileSync(${JSON.stringify(path.join(root, 'test-process.json'))}, JSON.stringify({pid:process.pid, entry:__filename}));
const probe = ${JSON.stringify(path.join(root, 'creation-context-'))} + process.pid;
fs.writeFileSync(probe, 'synthetic process-context probe');
const nativeMarker = require('node:child_process').spawnSync('/usr/bin/xattr', ['-px','com.apple.provenance',probe], {encoding:'utf8'});
fs.appendFileSync(${JSON.stringify(path.join(root, 'creation-contexts.jsonl'))}, JSON.stringify({pid:process.pid, marker:nativeMarker.status===0 ? nativeMarker.stdout.trim() : null})+'\\n');
app.setAppPath(${JSON.stringify(repo)});
app.on('browser-window-created', (_event, window) => { window.webContents.setBackgroundThrottling(false); window.on('show', () => window.hide()); window.hide(); });
dialog.showOpenDialog = async () => { throw Error('Import must not ask for a destination'); };
dialog.showMessageBox = async (_owner, options) => { fs.appendFileSync(${JSON.stringify(path.join(root, 'prompts.jsonl'))}, JSON.stringify(options.message)+'\\n'); console.log('TEST_PROMPT', options.message); return { response: 0 }; };
dialog.showMessageBoxSync = () => 0;
app.on('window-all-closed', () => app.quit());
import(${JSON.stringify(path.join(repo, 'dist-electron/main/main.js'))});
`);

let child, ws, evaluate, send;
let prompts = 0;
let launchCount = 0;
const launch = async () => {
  const port = 9500 + Math.floor(Math.random() * 400);
  const viaLaunchServices = switchLaunchContext && launchCount++ === 0;
  const args = [`--remote-debugging-port=${port}`, entry];
  child = spawn(viaLaunchServices ? '/usr/bin/open' : process.platform === 'darwin' ? path.join(repo, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron') : path.join(repo, 'node_modules/.bin/electron'), viaLaunchServices
    ? ['-n','-W','-g','-a',path.join(repo,'node_modules/electron/dist/Electron.app'),'--args',...args] : args, {
    cwd: repo, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
      FLOW_USER_DATA_DIR: userData, FLOW_PYTHON_DEPS_DIR: process.env.FLOW_PYTHON_DEPS_DIR ?? path.join(repo, 'vendor/python/photoshop-tiff'), VITE_DEV_SERVER_URL: '' }
  });
  child.stdout.on('data', bytes => { if (/TEST_PROMPT (This workspace has an unfinished operation|Close without saving)/.test(String(bytes))) prompts++; process.stdout.write(bytes); });
  child.stderr.on('data', bytes => process.stderr.write(bytes));
  const page = await wait(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(p => p.webSocketDebuggerUrl && p.title === 'Storyboard Flow'), 'test Electron');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let id = 0; const pending = new Map();
  ws.addEventListener('message', ({ data }) => {
    const result = JSON.parse(data), waiter = pending.get(result.id);
    if (result.method === 'Page.javascriptDialogOpening') void send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    if (!waiter) return; pending.delete(result.id);
    if (result.error) waiter.reject(new Error(JSON.stringify(result.error))); else waiter.resolve(result.result);
  });
  send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timed out: ${method}`)); }, 30000);
    pending.set(requestId, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } });
    ws.send(JSON.stringify({ id:requestId, method, params }));
  });
  evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await wait(() => evaluate(`!!document.querySelector('.app-shell')`), 'render');
  await evaluate(`window.storyboard.onCloseCancelled(({reason}) => { window.__inlineImportCloseRefusal = reason; console.log('TEST_CLOSE_CANCELLED', reason); })`);
};
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const open = async folder => {
  await wait(() => evaluate(`!document.querySelector('[aria-label="Folder path"]').disabled && !document.querySelector('.workspace-task-progress')`), 'folder opening available', 60000);
  await evaluate(`(() => { const input = document.querySelector('[aria-label="Folder path"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(folder)});
    input.dispatchEvent(new Event('input', {bubbles:true})); })()`);
  await evaluate(`document.querySelector('.path-form').requestSubmit()`);
};
const preview = () => wait(() => evaluate(`(() => {
  const view = document.querySelector('.folder-image-browser'), images = [...(view?.querySelectorAll('img') ?? [])];
  return view?.tagName === 'SECTION' && !document.querySelector('dialog[open]') && images.length === 2 && images.every(img => img.complete && img.naturalWidth > 0) &&
    !document.querySelector('.import-button').disabled && document.querySelector('.save-main-button').disabled &&
    document.querySelector('.editable-workspace').inert;
})()`), 'inline preview, enabled Import and disabled editor');
const screenshot = async name => { const result = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(path.join(root, name), Buffer.from(result.data, 'base64')); };
const project = folder => readFile(metadata(folder), 'utf8').then(JSON.parse);
const save = async folder => {
  await click('.save-main-button');
  await wait(() => evaluate(`!document.querySelector('.save-main-button').disabled && !document.querySelector('.save-error-modal') && !document.querySelector('.workspace-task-progress')`), 'Save settles', 120000);
  await wait(async () => { const p = await project(folder); return p.shots.every(s => !s.fileName.startsWith('000')) && Object.values(p.pendingBake?.shots ?? {}).every(entry => entry.state === 'synced'); }, 'Save filenames and completed output', 120000);
};
const close = async () => {
  await evaluate(`window.close()`);
  await wait(() => child.exitCode !== null, 'normal retained close', 180000);
  assert.equal(child.exitCode, 0); ws.close();
  prompts = (await readFile(path.join(root,'prompts.jsonl'),'utf8').catch(error => { if(error.code==='ENOENT') return ''; throw error; }))
    .split('\n').filter(Boolean).map(JSON.parse).filter(message => /This workspace has an unfinished operation|Close without saving/.test(message)).length;
};
try {
  console.log('EVIDENCE_ROOT', root);
  await launch(); await preview(); await screenshot('inline-preview.png');
  await evaluate(`document.querySelector('.import-button').focus()`);
  console.log('KEYBOARD_TARGET', await evaluate(`document.activeElement?.className`));
  await send('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13, text:'\r', unmodifiedText:'\r' });
  await send('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
  const converted = await wait(async () => {
    const folder = path.join(source, managedName);
    const p = await project(folder);
    return p.shots.length === 2 && p.shots.every(s => s.flow?.status === 'owned') &&
      await evaluate(`!document.querySelector('.folder-image-browser') && !document.querySelector('.editable-workspace').inert && document.querySelectorAll('[data-shot-id]').length === 2`) ? folder : undefined;
  }, 'converted project published', 60000);
  console.log('CONVERTED', converted);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Folder path"]').value`), source);
  assert.equal((await project(converted)).name, path.basename(source));
  assert.equal((await evaluate('window.storyboard.getRecentFolders()'))[0], source);
  await click('.shot-card'); await click('[aria-label="Brush"]');
  await screenshot('editable-before-drawing.png');
  // Real pointer stroke on the first image, then observe the changed asset.
  const p = await project(converted), layer = path.join(converted, p.shots[0].layers[0].bitmapPath), previousLayer = await hash(layer);
  const rect = await wait(() => evaluate(`(() => { const el = document.querySelector('.konvajs-content'); if (!el) return; const r=el.getBoundingClientRect(); return r.width > 0 ? {x:r.x,y:r.y,width:r.width,height:r.height} : undefined; })()`), 'editable canvas');
  const x = Math.round(rect.x + rect.width * .3), y = Math.round(rect.y + rect.height * .4);
  await send('Input.dispatchMouseEvent', { type:'mousePressed', x, y, button:'left', buttons:1, clickCount:1 });
  for (let i=1;i<=8;i++) await send('Input.dispatchMouseEvent', { type:'mouseMoved', x:x+i*5, y:y+i*3, button:'left', buttons:1 });
  await send('Input.dispatchMouseEvent', { type:'mouseReleased', x:x+40, y:y+24, button:'left', buttons:0, clickCount:1 });
  await wait(async () => await hash(layer) !== previousLayer, 'drawing writes the converted layer');
  const painted = await hash(layer);
  await wait(async () => (await project(converted)).pendingBake?.shots[p.shots[0].id]?.state === 'pending', 'paint autosave establishes pending output');
  // No explicit Save: editable PNG/JSON survives normal Close; original images
  // remain exact. A fresh process must reopen editable with pending output.
  assert.deepEqual(await Promise.all(originals.map(hash)), before);
  await close(); assert.equal(prompts, 0); await launch();
  await wait(() => evaluate(`!document.querySelector('.folder-image-browser') && document.querySelectorAll('[data-shot-id]').length === 2 && !document.querySelector('.save-main-button').disabled`), 'unsaved drawing reopens editable', 60000);
  assert.equal(await hash(layer), painted);
  assert.equal((await project(converted)).pendingBake.shots[p.shots[0].id].state, 'pending');
  assert.deepEqual(await Promise.all(originals.map(hash)), before);
  // Source preview must not route keyboard mutations into this dirty project.
  await open(source);
  await wait(() => evaluate(`!document.querySelector('.folder-image-browser') && !document.querySelector('[aria-label="Folder path"]').disabled && document.querySelector('[aria-label="Folder path"]').value === ${JSON.stringify(source)}`), 'original folder resumes the edited child');
  assert.equal(await hash(layer), painted);
  assert.equal((await readdir(source)).filter(name => name === managedName).length, 1);
  await open(otherSource); await preview();
  const beforeKeys = await project(converted);
  await evaluate(`document.activeElement?.blur(); for (const [key,metaKey] of [['Delete',false],['z',true],['v',true],['s',true]]) { document.body.dispatchEvent(new KeyboardEvent('keydown',{key,metaKey,bubbles:true,cancelable:true})); document.body.dispatchEvent(new KeyboardEvent('keyup',{key,metaKey,bubbles:true,cancelable:true})); }`);
  await delay(500);
  assert.deepEqual(await project(converted), beforeKeys); assert.equal(await hash(layer), painted);
  await click('.folder-import-notice button');
  await wait(() => evaluate(`!document.querySelector('.folder-image-browser') && !document.querySelector('.editable-workspace').inert`), 'return dirty workspace');
  assert.equal(await hash(layer), painted);
  if (!singleProject) {
  // Switching through Import must preserve the edited previous project.
  await open(otherSource); await preview(); await click('.import-button');
  await wait(() => evaluate(`!document.querySelector('.folder-image-browser')`), 'second Import from edited project', 60000);
  await open(converted);
  await wait(() => evaluate(`document.querySelector('[aria-label="Folder path"]').value === ${JSON.stringify(source)} && !document.querySelector('.folder-image-browser') && !document.querySelector('.save-main-button').disabled`), 'return previous project');
  assert.equal(await hash(layer), painted);
  }
  await save(converted); await screenshot('editable-after-import.png');
  const afterSave = await Promise.all(originals.map(hash));
  assert.deepEqual(afterSave.slice(0, 4), before.slice(0, 4));
  assert.notEqual(afterSave[4], before[4]);
  for (const name of ['shot-1.png', 'shot-2.png']) assert.equal(await hash(path.join(converted, '.original-images', name)), before[originals.indexOf(path.join(source, name))]);
  // Repeated Save preserves the first backup. The other hidden imported project
  // still has pending output and must now close durably without a prompt.
  await save(converted);
  for (const name of ['shot-1.png', 'shot-2.png']) assert.equal(await hash(path.join(converted, '.original-images', name)), before[originals.indexOf(path.join(source, name))]);
  console.log('PASS explicit Save updates originals and preserves original backups');
  await close(); assert.equal(prompts, 0); await launch();
  await wait(() => evaluate(`!document.querySelector('.folder-image-browser') && document.querySelectorAll('[data-shot-id]').length === 2 && !document.querySelector('.save-main-button').disabled`), 'fresh-process editable reopen', 60000);
  assert.equal(await hash(layer), painted);
  assert.equal(await evaluate(`document.querySelector('[aria-label="Folder path"]').value`), source);
  assert.deepEqual(await Promise.all(originals.map(hash)), afterSave);
  assert.deepEqual((await readdir(source)).sort(), ['.storyboard-flow', '.storyboard-flow-project', 'shot-1.png', 'shot-2.png']);
  assert.deepEqual(await readdir(path.dirname(metadata(source))), ['storyboard.project.json']);
  await close();
  const contexts = (await readFile(path.join(root,'creation-contexts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  const distinctProvenanceContexts = contexts.some(context => context.marker !== contexts[0].marker);
  // LaunchServices may keep the caller's responsible-process attribution.
  // Record that fact rather than claiming the GUI exercised marker drift.
  // Different-marker native I/O is verified separately by the native regression.
  await writeFile(path.join(root, 'result.json'), JSON.stringify({ passed:true, mode:singleProject ? 'single-project' : 'multi-project', source, converted, originalsUpdatedOnlyOnSave:true, firstBackupsPreserved:true, normalClosePrompts:prompts, paintedLayer:painted,
    switchLaunchContext, creationContexts:contexts, distinctProvenanceContexts,
    checks:['inline preview','no destination picker','source address and recents','same source resumes child without duplicate import','toolbar Import','owned layers','draw then close without Save and reopen editable','hidden workspace keyboard isolation','return dirty project',...(singleProject ? [] : ['Import while prior project dirty','hidden unsaved Import closes durably without Save']),'Save','normal retained close','fresh-process reopen'],
    skips:singleProject ? ['second Import while another project is dirty and subsequent multi-project close'] : [],
    limits:['message responses supplied by test entry; destination picker forbidden','synthetic images only','no clipboard or Trash','not independent acceptance'] }, null, 2));
  console.log('PASS inline Import workflow', root);
} catch (error) {
  if (ws?.readyState === WebSocket.OPEN) {
    await evaluate(`document.querySelector('button[aria-label="Workspace status"]')?.click()`).catch(() => {});
    await screenshot('failure.png').catch(() => {});
    await writeFile(path.join(root, 'failure-ui.txt'), String(await evaluate('document.body.innerText').catch(() => 'unavailable')));
  }
  throw error;
} finally {
  ws?.close();
  if (switchLaunchContext && child && child.exitCode === null) {
    const owned = JSON.parse(await readFile(path.join(root,'test-process.json'),'utf8'));
    if (owned.entry === entry && Number.isInteger(owned.pid)) {
      try { process.kill(owned.pid,'SIGTERM'); console.log('CLEANUP stopped test-owned Electron', owned.pid); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
  }
  if (child && child.exitCode === null) { child.kill('SIGTERM'); console.log('CLEANUP stopped test-owned Electron', child.pid); }
}
