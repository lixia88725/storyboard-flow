// Synthetic paint presentation / recovery regression. Build first; independent project/userData, clipboard and Trash forbidden.
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
import { openFlowAssetDepot } from '../dist-electron/project-files/main/persistence/depot.js';
import { createProjectStore } from '../dist-electron/project-files/main/persistence/index.js';

const recovery = process.argv.includes('--recovery');
const run = await mkdtemp(path.join(await realpath(os.tmpdir()), 'flow-paint-presentation-'));
const inkMode = 'transparent';
const root = path.join(run, 'project');
const W = 640, H = 360;
await mkdir(root, { recursive: true });
await mkdir(path.join(run, 'userData'), { recursive: true });
const get = r => { if (!r.ok) throw Error(r.error.message); return r.value; };
const depot = get(await openFlowAssetDepot({ root, sessionId: 'seed', maxPixels: 40000000, maxPngBytes: 40000000 }));
const base = await sharp({ create: { width: W, height: H, channels: 4, background: { r: 236, g: 234, b: 228, alpha: 1 } } }).png().toBuffer();
// Eraser visibility requires ink pixels to remove: an opaque plate, never an empty layer.
const ink = inkMode === 'opaque'
  ? await sharp({ create: { width: W, height: H, channels: 4, background: { r: 40, g: 120, b: 220, alpha: 1 } } }).png().toBuffer()
  : await sharp({ create: { width: W, height: H, channels: 4, background: '#00000000' } }).png().toBuffer();
const baseId = get(await depot.put({ operationId: 'base', png: base, width: W, height: H })).assetId;
const inkId = get(await depot.put({ operationId: 'ink', png: ink, width: W, height: H })).assetId;
const layer = (id, name, kind, assetId, locked) => ({ id, name, kind, locked, assetId, visible: true, opacity: 1, blendMode: 'normal', width: W, height: H });
const image = id => ({ id, revision: 0, width: W, height: H, layers: [layer('base', '底', 'image', baseId, true), layer('ink', '绘画', 'paint', inkId, false)] });
const project = {
  schema: 'storyboard-flow.project', version: 1, id: 'admission', revision: 0, name: 'Admission probe',
  shots: [
    { id: 'shot0', imageId: 'image0', name: '0001', scriptText: '' },
    { id: 'shot1', imageId: 'image1', name: '0002', scriptText: '' },
  ],
  parkedShots: [], dialogues: [], images: { image0: image('image0'), image1: image('image1') },
};
get(await createProjectStore().saveCheckpoint(root, project, async id => get(await depot.read(id))));
console.log('seeded', inkMode, W, H, root);

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bundle=await build({entryPoints:[path.join(repo,'scripts/paint-presentation-browser-check.ts')],bundle:true,write:false,format:'iife',globalName:'PaintRasterCheck',platform:'browser'});
await writeFile(path.join(run,'raster-check.js'),bundle.outputFiles[0].text);
const env={...process.env,FLOW_REPO:repo,FLOW_ROOT:root,FLOW_OUT:run};delete env.ELECTRON_RUN_AS_NODE;
const child=spawn(createRequire(import.meta.url)('electron'),[path.join(repo,recovery?'scripts/flow-paint-recovery-driver.cjs':'scripts/flow-paint-presentation-driver.cjs')],{cwd:repo,env,stdio:'inherit'});
const timer=setTimeout(()=>child.kill('SIGTERM'),120000);
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code)=>resolve(code));});clearTimeout(timer);
const result=JSON.parse(await readFile(path.join(run,'result.json'),'utf8'));
if(code!==0||result.error||result.cases.length!==(recovery?6:3)||(!recovery&&result.raster.length!==5))throw Error('Paint presentation failed: '+run);
console.log('PASS',run);
