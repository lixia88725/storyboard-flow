// Synthetic tool-shortcut regression. Build first; independent projects/userData and no clipboard/Trash.
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {mkdir, mkdtemp, readFile, realpath, writeFile} from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {openFlowAssetDepot} from '../dist-electron/project-files/main/persistence/depot.js';
import {createProjectStore} from '../dist-electron/project-files/main/persistence/index.js';

const run = await mkdtemp(path.join(await realpath(os.tmpdir()), 'flow-tool-shortcut-'));
const W = 640, H = 360;
const get = r => { if (!r.ok) throw Error(r.error.message); return r.value; };
const base = await sharp({create: {width: W, height: H, channels: 4, background: {r: 236, g: 234, b: 228, alpha: 1}}}).png().toBuffer();
const ink = await sharp({create: {width: W, height: H, channels: 4, background: '#00000000'}}).png().toBuffer();
const layer = (id, name, kind, assetId, locked) => ({id, name, kind, locked, assetId, visible: true, opacity: 1, blendMode: 'normal', width: W, height: H});

async function seed(folder, id, name) {
  const root = path.join(run, folder);
  await mkdir(root, {recursive: true});
  const depot = get(await openFlowAssetDepot({root, sessionId: 'seed', maxPixels: 40000000, maxPngBytes: 40000000}));
  const baseId = get(await depot.put({operationId: 'base', png: base, width: W, height: H})).assetId;
  const inkId = get(await depot.put({operationId: 'ink', png: ink, width: W, height: H})).assetId;
  const image = imageId => ({id: imageId, revision: 0, width: W, height: H, layers: [
    layer('base', '底', 'image', baseId, true), layer('ink', '绘画', 'paint', inkId, false)]});
  const project = {
    schema: 'storyboard-flow.project', version: 1, id, revision: 0, name,
    shots: [
      {id: 'shot0', imageId: 'image0', name: '0001', scriptText: ''},
      {id: 'shot1', imageId: 'image1', name: '0002', scriptText: ''},
    ],
    parkedShots: [], dialogues: [], images: {image0: image('image0'), image1: image('image1')},
  };
  get(await createProjectStore().saveCheckpoint(root, project, async assetId => get(await depot.read(assetId))));
  return root;
}

const root = await seed('project', 'tool-a', 'Tool A');
const rootB = await seed('project-b', 'tool-b', 'Project B');
await mkdir(path.join(run, 'userData'), {recursive: true});
await writeFile(path.join(run, 'userData', 'recent-projects.json'), JSON.stringify({version: 1, projects: [
  {id: 'recent-b', root: rootB, projectId: 'tool-b', name: 'Project B', lastOpenedAt: 2},
  {id: 'recent-a', root, projectId: 'tool-a', name: 'Tool A', lastOpenedAt: 1},
]}, null, 2) + '\n', {mode: 0o600});
console.log('seeded', W, H, root, rootB);

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = {...process.env, FLOW_REPO: repo, FLOW_ROOT: root, FLOW_ROOT_B: rootB, FLOW_OUT: run};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(createRequire(import.meta.url)('electron'), [path.join(repo, 'scripts/flow-tool-shortcut-driver.cjs')], {cwd: repo, env, stdio: 'inherit'});
const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); });
clearTimeout(timer);
const result = JSON.parse(await readFile(path.join(run, 'result.json'), 'utf8'));
if (code !== 0 || result.error || result.cases.length !== 11) throw Error('Tool shortcut smoke failed: ' + run);
console.log('PASS', run);
