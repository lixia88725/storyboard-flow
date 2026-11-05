const { app, BrowserWindow, clipboard, shell } = require('electron');
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const repo = process.env.FLOW_REPO, root = process.env.FLOW_ROOT, out = process.env.FLOW_OUT;
if (!root.startsWith(path.join(fs.realpathSync(require('node:os').tmpdir()), 'flow-eraser-continuation-')) || !path.isAbsolute(repo)) throw Error('isolated paths required');
for (const k of Object.keys(clipboard)) if (typeof clipboard[k] === 'function') clipboard[k] = () => { throw Error('clipboard prohibited'); };
shell.trashItem = () => { throw Error('trash prohibited'); };
// Fault injection (only when FLOW_DELAY_PUT is set): slow every asset write so a paint
// handover happens while the previous response is still outstanding.
if (process.env.FLOW_DELAY_PUT) {
  const { ipcMain } = require('electron');
  const original = ipcMain.handle.bind(ipcMain);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  ipcMain.handle = (channel, fn) => original(channel, async (...args) => {
    if (channel === 'flow-editor:put') await wait(Number(process.env.FLOW_DELAY_PUT));
    return fn(...args);
  });
}
const slot = app.isPackaged ? 1 : 2;
process.argv[slot] = root;
process.argv[slot + 1] = path.join(out, 'userData');

let win;
const report = { suite: 'eraser', cases: [], delivered: [], refused: [], error: null };
const delay = ms => new Promise(r => setTimeout(r, ms));
const js = async s => { try { return await win.webContents.executeJavaScript(s); } catch (e) { throw Error(s + ' :: ' + e); } };
async function wait(fn, label) { const end = Date.now() + 20000; while (Date.now() < end) { if (await fn()) return; await delay(30); } throw Error('timeout ' + label); }
const mouse = (type, x, y) => win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1 });
const project = () => JSON.parse(fs.readFileSync(path.join(root, '.storyboard-flow/checkpoints/project.json'), 'utf8'));
const domRevision = () => js('Number(document.querySelector("[data-workbench]").dataset.revision)');
const statusText = () => js('document.querySelector(".wb-status [role=status]")?.textContent || ""');
const rectOf = sel => js(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);

async function selectBoard(id) {
  await js(`document.querySelector('[data-board-id=${id}] .wb-card-handle').click()`);
  await delay(220);
  await js(`(document.querySelector('.layer-row[data-layer-id=ink] .layer-name')||document.querySelector('.layer-row[data-layer-id=ink]')).click()`);
  await delay(180);
  const active = await js('document.querySelector(".layer-row.is-active")?.dataset.layerId');
  if (active !== 'ink') throw Error('active layer is ' + active);
}
async function setTool(label) {
  await js(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').click()`);
  await delay(150);
  const pressed = await js(`document.querySelector('button[aria-label=${JSON.stringify(label)}]').getAttribute('aria-pressed')`);
  if (pressed !== 'true') throw Error('tool not switched: ' + label);
}
async function realClick(sel) {
  const r = await rectOf(sel);
  if (!r) throw Error('missing ' + sel);
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  mouse('mouseMove', x, y); mouse('mouseDown', x, y);
  await delay(30);
  mouse('mouseUp', x, y);
}
async function hoverCard(id) {
  const r = await rectOf(`[data-board-id=${id}] .wb-card-picture`);
  if (!r) throw Error('missing card ' + id);
  mouse('mouseMove', r.x + r.w / 2, r.y + r.h / 2);
  await delay(320);
}
async function gridStage(id) { return rectOf(`[data-board-id=${id}] .wb-surface .image-stage`) || rectOf(`[data-board-id=${id}] .image-stage`); }
async function viewerStage() { return rectOf('.wb-viewer .image-stage'); }

/** One press-release at a fractional position; returns the dispatched timestamp. */
async function dot(stage, fx, fy, { hold = 15, drag = 0 } = {}) {
  const x = stage.x + stage.w * fx, y = stage.y + stage.h * fy;
  const surface = await js(`(()=>{const e=document.elementFromPoint(${Math.round(x)},${Math.round(y)});const s=e&&e.closest('.wb-surface');return{s:s?s.dataset.surface:null,cls:e?String(e.className).slice(0,40):null}})()`);
  mouse('mouseMove', x, y);
  mouse('mouseDown', x, y);
  await delay(hold);
  if (drag) mouse('mouseMove', x + stage.w * drag, y);
  mouse('mouseUp', x + stage.w * drag, y);
  return { at: Date.now(), surface };
}

async function sample(imageId, points, mode) {
  const sharp = (await import(pathToFileURL(path.join(repo, 'node_modules/sharp/lib/index.js')).href)).default;
  const p = project();
  const layer = p.images[imageId].layers.find(l => l.id === 'ink');
  const { data, info } = await sharp(path.join(root, '.storyboard-flow/checkpoints/assets', layer.assetId + '.png')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { assetId: layer.assetId, imageRevision: p.images[imageId].revision, values: points.map(({ fx, fy }) => {
    let min = 255, max = 0;
    for (let y = Math.floor(info.height * fy) - 5; y <= Math.ceil(info.height * fy) + 5; y++)
      for (let x = Math.floor(info.width * fx) - 5; x <= Math.ceil(info.width * fx) + 5; x++) {
        if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
        const a = data[(y * info.width + x) * 4 + 3];
        min = Math.min(min, a); max = Math.max(max, a);
      }
    return mode === 'erase' ? { fx, fy, minAlpha: min, erased: min < 245 } : { fx, fy, maxAlpha: max, painted: max > 2 };
  }) };
}

const rows = { viewer: [0.30, 0.45, 0.60], grid: [0.30, 0.45, 0.60] };
function points(n, row) { return Array.from({ length: n }, (_, i) => ({ fx: 0.10 + i * 0.09, fy: row + 0.06 })); }

async function rapidCase(name, surface, imageId, mode, gap = 10) {
  const stage = surface === 'viewer' ? await viewerStage() : await gridStage('shot0');
  if (!stage) throw Error('missing stage ' + surface);
  const pts = points(8, surface === 'viewer' ? 0.18 : 0.55);
  const before = await domRevision();
  const sentAt = [];
  for (const p of pts) { sentAt.push(await dot(stage, p.fx, p.fy, { hold: 15 })); await delay(gap); }
  await delay(1900);
  const after = await domRevision();
  report.cases.push({ name, surface, tool: mode === 'erase' ? 'eraser' : 'brush', expected: 8, gapMs: gap, revisionBefore: before, revisionAfter: after, revisionDelta: after - before, dispatched: sentAt.length, strokes: sentAt, pixels: await sample(imageId, pts, mode) });
}

async function openCaseProject() {
  await wait(() => !!win, 'window');
  win.setSize(1280, 940);
  await wait(() => js('!!document.querySelector("[data-workbench]")'), 'workbench');
  await wait(() => js('document.querySelector(".wb-status")?.innerText.includes("已自动暂存")'), 'ready');
  await js(`(()=>{window.__pd=[];window.__refused=[];window.__rev=[];window.__lastRev=null;setInterval(()=>{const r=document.querySelector('[data-workbench]')?.dataset.revision;if(r!==window.__lastRev){window.__lastRev=r;window.__rev.push({t:performance.now(),rev:Number(r)})}},20);document.addEventListener('pointerdown',e=>window.__pd.push({x:e.clientX,y:e.clientY,t:performance.now(),cls:String(e.target.className).slice(0,40)}),true);window.addEventListener('pointerdown',e=>{const ev=e;setTimeout(()=>{if(ev.defaultPrevented)window.__refused.push({x:ev.clientX,y:ev.clientY,cancelled:ev.cancelBubble,t:performance.now()})},0)},true);window.__konva=[];window.__seen=new WeakSet();setInterval(()=>{document.querySelectorAll('.konvajs-content').forEach(el=>{if(window.__seen.has(el))return;window.__seen.add(el);el.addEventListener('pointerdown',e=>window.__konva.push({x:e.clientX,y:e.clientY,surface:el.closest('.wb-surface')?.dataset.surface,t:performance.now()}),true)})},150);return true})()`);
}

(async () => {
  await import(pathToFileURL(path.join(repo, 'dist-electron/platform/main/flowEditorEntry.js')).href);
  await app.whenReady();
  await wait(() => (win = BrowserWindow.getAllWindows()[0]), 'window');
  await openCaseProject();
  await selectBoard('shot0');

    await setTool('橡皮');
    await rapidCase('eraser-viewer-rapid', 'viewer', 'image0', 'erase');
    await setTool('橡皮');
    await rapidCase('eraser-viewer-settled', 'viewer', 'image0', 'erase', 400);
    await setTool('橡皮');
    await hoverCard('shot0');
    await rapidCase('eraser-grid-rapid', 'grid', 'image0', 'erase');
  for (const c of report.cases) { require('node:assert/strict').equal(c.revisionDelta, 8, c.name); require('node:assert/strict').ok(c.pixels.values.every(p => p.minAlpha === 0), c.name + ' all eight points erased'); }
  report.delivered = await js('window.__pd');
  report.refused = await js('window.__refused');
  report.revisionTimeline = await js('window.__rev');
  report.reachedKonva = await js('window.__konva');
  report.status = await statusText();
})().catch(e => { report.error = String(e.stack || e); })
  .finally(() => { fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); app.exit(report.error ? 1 : 0); });
