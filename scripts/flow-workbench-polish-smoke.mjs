// Isolated workbench layout and Japanese dialogue acceptance; no personal projects.
import {createRequire} from 'node:module';
import {spawn, execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, realpath} from 'node:fs/promises';
import path from 'node:path'; import os from 'node:os'; import {fileURLToPath} from 'node:url'; import sharp from 'sharp';
import {openFlowAssetDepot} from '../dist-electron/project-files/main/persistence/depot.js';
import {createProjectStore} from '../dist-electron/project-files/main/persistence/index.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const get = result => { if (!result.ok) throw Error(result.error.message); return result.value; };

const entryPath = path.join(repo, 'dist-electron/platform/main/flowEditorEntry.js');
const builtEntry = await readFile(entryPath, 'utf8');
if (!builtEntry.includes('new BrowserWindow({')) throw Error('Unknown window entry; run npm run build first');

const run = await mkdtemp(path.join(await realpath(os.tmpdir()), 'flow-workbench-polish-'));
const root = path.join(run, 'project');
await mkdir(root);
const depot = get(await openFlowAssetDepot({root, sessionId: 'seed', maxPixels: 1000000, maxPngBytes: 1000000}));
const transparent = get(await depot.put({
  operationId: 'clear',
  png: await sharp({create: {width: 640, height: 360, channels: 4, background: '#00000000'}}).png().toBuffer(),
  width: 640, height: 360
})).assetId;
// Same synthetic fixture as the undo smoke check, without scene presentation: the dialogue
// track lives in the card footer, so the board has two editors (footer track and info panel).
const project = {schema: 'storyboard-flow.project', version: 1, id: 'workbench-polish', revision: 0,
  name: 'Workbench polish acceptance', shots: [], parkedShots: [], dialogues: [], images: {}};
for (const [index, id] of ['shot0', 'shot1', 'shot2', 'shot3', 'shot4', 'shot5'].entries()) {
  const png = await sharp({create: {width: 640, height: 360, channels: 4, background: {r: 190 + index * 10, g: 220, b: 245, alpha: 1}}}).png().toBuffer();
  const assetId = get(await depot.put({operationId: `base${index}`, png, width: 640, height: 360})).assetId;
  project.shots.push({id, imageId: `image${index}`, name: String(index + 1).padStart(4, '0'), scriptText: `动作 ${index}`});
  project.images[`image${index}`] = {id: `image${index}`, revision: 0, width: 640, height: 360,
    layers: [{id: 'base', name: '背景', kind: 'image', locked: true, assetId},
      {id: 'ink', name: '绘画', kind: 'paint', locked: false, assetId: transparent}]
      .map(layer => ({...layer, visible: true, opacity: 1, blendMode: 'normal', width: 640, height: 360}))};
}
project.dialogues.push({id: 'line0', shotId: 'shot0', text: '第一段'}, {id: 'line1', shotId: 'shot0', text: '第二段'});
get(await createProjectStore().saveCheckpoint(root, project, async id => get(await depot.read(id))));

const identity = {
  head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  status: execFileSync('git', ['status', '--short'], {encoding: 'utf8'}).trim(),
  run
};
const driver = path.join(repo, 'scripts/flow-workbench-polish-driver.cjs');
execFileSync(process.execPath, ['--check', driver]);

for (const phase of ['edit', 'reopen']) {
  const userData = path.join(run, 'userData');
  await mkdir(userData, {recursive: true});
  const env = {...process.env,
    FLOW_DIALOGUE_ROOT: root, FLOW_DIALOGUE_USERDATA: userData, FLOW_DIALOGUE_RUN: run,
    FLOW_DIALOGUE_PHASE: phase, FLOW_DIALOGUE_ENTRY: entryPath};
  delete env.ELECTRON_RUN_AS_NODE;
  const chunks = [];
  let spawnError, timedOut = false;
  const child = spawn(require('electron'), [driver], {cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe']});
  // The watchdog terminates only this child; the developer's own processes are never touched.
  const watchdog = setTimeout(() => {
    timedOut = true;
    child.kill('SIGKILL');
  }, Number(process.env.FLOW_DIALOGUE_TIMEOUT_MS || 180000));
  child.stdout.on('data', chunk => chunks.push(chunk));
  child.stderr.on('data', chunk => { chunks.push(chunk); process.stderr.write(chunk); });
  child.on('error', error => { spawnError = error; chunks.push(Buffer.from(String(error))); });
  const code = await new Promise(resolve => {
    child.on('error', () => resolve(-1));
    child.on('exit', value => resolve(value));
  });
  clearTimeout(watchdog);
  await writeFile(path.join(run, `${phase}.log`), Buffer.concat(chunks));
  console.log(phase, code, run);
  if (spawnError) throw Error(`Could not start Electron: ${spawnError.message} (${run})`);
  if (timedOut) throw Error(`Workbench polish verification timed out after ${process.env.FLOW_DIALOGUE_TIMEOUT_MS || 180000}ms: ${run}`);
  if (code !== 0) throw Error(`Workbench polish verification failed: ${run}`);
  // Exit code 0 alone is not success: the phase must write its own completion marker.
  const done = JSON.parse(await readFile(path.join(run, `${phase}-done.json`), 'utf8'));
  if (!done.ok || done.phase !== phase) throw Error(`Missing ${phase} completion marker: ${run}`);
  await readFile(path.join(run, `${phase}-closed.json`));
}

const cases = JSON.parse(await readFile(path.join(run, 'cases.json'), 'utf8'));
await writeFile(path.join(run, 'receipt.json'), JSON.stringify({...identity, passed: true, cases}, null, 2));
console.log('PASS', run);
