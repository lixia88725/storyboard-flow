// Real Electron keyboard regression for the rail shortcuts. Synthetic projects/userData only.
const {app, BrowserWindow, clipboard, shell, ipcMain} = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), {pathToFileURL} = require('node:url');
const repo = process.env.FLOW_REPO, rootA = process.env.FLOW_ROOT, rootB = process.env.FLOW_ROOT_B, out = process.env.FLOW_OUT;
const tmp = fs.realpathSync(require('node:os').tmpdir());
if (!rootA || !rootB || !rootA.startsWith(path.join(tmp, 'flow-tool-shortcut-')) || !rootB.startsWith(path.join(tmp, 'flow-tool-shortcut-')) || !path.isAbsolute(repo)) throw Error('isolated paths required');
for (const key of Object.keys(clipboard)) if (typeof clipboard[key] === 'function') clipboard[key] = () => { throw Error('Clipboard prohibited'); };
shell.trashItem = () => { throw Error('Trash prohibited'); };

// Slow writes so a tool change happens while the previous paint response is outstanding;
// slow refresh/switch so the output and freeze windows are observable.
const delay = ms => new Promise(r => setTimeout(r, ms));
const delayed = {'flow-editor:put': 700, 'flow-editor:refresh': 500, 'flow-editor:switch-project': 400};
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (name, fn) => handle(name, async (...args) => {
  if (delayed[name]) await delay(delayed[name]);
  return fn(...args);
});
const slot = app.isPackaged ? 1 : 2;
process.argv[slot] = rootA;
process.argv[slot + 1] = path.join(out, 'userData');

let win;
let current = rootA;
const report = {suite: 'tool-shortcuts', cases: [], error: null, stage: 'boot'};
const js = async code => { try { return await win.webContents.executeJavaScript(code); } catch (e) { throw Error(code + ' :: ' + e); } };
async function wait(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await fn()) return; await delay(40); }
  throw Error('timeout ' + label);
}
const mouse = (type, x, y) => win.webContents.sendInputEvent({type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1});
const keyDown = (code, extra = {}) => win.webContents.sendInputEvent({type: 'keyDown', keyCode: code, ...extra});
const keyUp = code => win.webContents.sendInputEvent({type: 'keyUp', keyCode: code});
const rectOf = selector => js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
const activeTool = () => js(`document.querySelector('.wb-tool-rail button[aria-pressed="true"]')?.getAttribute('aria-label')||null`);
const revision = () => js(`Number(document.querySelector('[data-workbench]').dataset.revision)`);
const project = () => JSON.parse(fs.readFileSync(path.join(current, '.storyboard-flow/checkpoints/project.json'), 'utf8'));
let sharpLib;
const sharpOf = async () => sharpLib ??= (await import(pathToFileURL(path.join(repo, 'node_modules/sharp/lib/index.js')).href)).default;

async function expectTool(label, why) {
  const value = await activeTool();
  assert.equal(value, label, why + ' (tool=' + value + ')');
}
async function tap(code, hold = 40) { keyDown(code); await delay(hold); keyUp(code); await delay(90); }
async function realClick(selector) {
  const r = await rectOf(selector);
  if (!r) throw Error('missing ' + selector);
  const x = r.x + r.w / 2, y = r.y + r.h / 2;
  mouse('mouseMove', x, y); mouse('mouseDown', x, y);
  await delay(30);
  mouse('mouseUp', x, y);
  await delay(40);
}
async function stageOf(surface) {
  const r = await rectOf(`[data-surface="${surface}"] .image-stage`);
  if (!r) throw Error('missing stage ' + surface);
  return r;
}
const point = (stage, fx, fy) => [stage.x + stage.w * fx, stage.y + stage.h * fy];
async function alphaAt(imageId, fx, fy) {
  const sharp = await sharpOf();
  const layers = project().images[imageId].layers;
  const layer = layers.find(l => l.id === 'ink');
  const {data, info} = await sharp(path.join(current, '.storyboard-flow/checkpoints/assets', layer.assetId + '.png')).ensureAlpha().raw().toBuffer({resolveWithObject: true});
  const cx = Math.floor(info.width * fx), cy = Math.floor(info.height * fy);
  let max = 0;
  for (let y = cy - 4; y <= cy + 4; y++) for (let x = cx - 4; x <= cx + 4; x++) {
    if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
    max = Math.max(max, data[(y * info.width + x) * 4 + 3]);
  }
  return max;
}
async function settle(delta, label) {
  const before = await revision();
  await wait(async () => await revision() === before + delta, label);
  await wait(() => project().revision === before + delta, label + ' checkpoint');
  return before;
}
async function selectBoard() {
  await js(`document.querySelector('[data-board-id=shot0] .wb-card-handle').click()`);
  await delay(260);
  await js(`(document.querySelector('.layer-row[data-layer-id=ink] .layer-name')||document.querySelector('.layer-row[data-layer-id=ink]')).click()`);
  await delay(200);
  assert.equal(await js('document.querySelector(".layer-row.is-active")?.dataset.layerId'), 'ink', 'ink layer active');
}
async function chooseHardBrush() {
  const stage = await stageOf('viewer:shot0');
  await js(`(()=>{const e=document.querySelector('[data-surface="viewer:shot0"] .image-stage');const r=e.getBoundingClientRect();e.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+30,clientY:r.y+30}));})()`);
  await wait(() => js('!!document.querySelector(".wb-brush-presets button[title=硬画笔]")'), 'brush panel');
  await js('document.querySelector(".wb-brush-presets button[title=硬画笔]").click()');
  keyDown('Escape'); keyUp('Escape');
  await wait(() => js('!document.querySelector(".wb-brush-presets")'), 'brush panel closed');
  await delay(120);
}
async function stroke(surface, points, gap = 22) {
  const stage = await stageOf(surface);
  const [x0, y0] = point(stage, ...points[0]);
  mouse('mouseDown', x0, y0); await delay(gap);
  let last = [x0, y0];
  for (const p of points.slice(1)) { last = point(stage, ...p); mouse('mouseMove', ...last); await delay(gap); }
  mouse('mouseUp', ...last); await delay(gap);
}

async function step(name, fn) {
  report.stage = name;
  const started = Date.now();
  const detail = await fn();
  report.cases.push({name, ms: Date.now() - started, ...detail});
}

(async () => {
  await import(pathToFileURL(path.join(repo, 'dist-electron/platform/main/flowEditorEntry.js')).href);
  await app.whenReady();
  await wait(() => !!(win = BrowserWindow.getAllWindows()[0]), 'window');
  win.setSize(1400, 1000);
  await wait(() => js('!!document.querySelector("[data-workbench]")'), 'workbench');
  await wait(() => js('document.querySelector(".wb-status")?.innerText.includes("已自动暂存")'), 'ready');
  await selectBoard();
  await chooseHardBrush();

  await step('rail keys are advertised and B/E/L/K select their tools', async () => {
    const annotations = await js(`Array.from(document.querySelectorAll('.wb-tool-rail button[aria-keyshortcuts]')).map(b=>({label:b.getAttribute('aria-label'),keys:b.getAttribute('aria-keyshortcuts'),title:b.getAttribute('title')}))`);
    assert.deepEqual(annotations.map(a => a.keys), ['b', 'e', 'l', 'k'], 'aria-keyshortcuts');
    assert.deepEqual(annotations.map(a => a.label), ['画笔', '橡皮', '选区', '模糊'], 'rail labels');
    assert.ok(annotations.every(a => a.title.includes('(' + a.keys.toUpperCase() + ')')), 'tooltips name the key');
    await tap('b'); await expectTool('画笔', 'B selects the brush');
    await tap('e', 60); await expectTool('橡皮', 'a short E keeps the eraser');
    await tap('l'); await expectTool('选区', 'L selects the lasso');
    await tap('k'); await expectTool('模糊', 'K selects blur');
    await tap('b'); await expectTool('画笔', 'B returns to the brush');
    return {annotations};
  });

  await step('a held E returns to the previous tool; repeats do not apply twice', async () => {
    await tap('b');
    keyDown('e'); await delay(320); keyUp('e'); await delay(120);
    await expectTool('画笔', 'a held E restores the brush');

    keyDown('e'); await delay(40);
    keyDown('e', {isAutoRepeat: true}); await delay(40);
    keyDown('e', {isAutoRepeat: true}); await delay(30);
    keyUp('e'); await delay(120);
    await expectTool('橡皮', 'auto-repeat inside a tap keeps the eraser');

    await tap('b');
    keyDown('e');
    for (let i = 0; i < 3; i++) { await delay(70); keyDown('e', {isAutoRepeat: true}); }
    await delay(20); keyUp('e'); await delay(120);
    await expectTool('画笔', 'auto-repeat inside a hold still restores');
    return {};
  });

  await step('key bursts without a render between them keep the last tool', async () => {
    keyDown('b'); keyUp('b'); keyDown('e'); keyUp('e'); keyDown('l'); keyUp('l'); keyDown('k'); keyUp('k'); keyDown('b'); keyUp('b');
    await delay(240);
    await expectTool('画笔', 'the last key in a burst wins');
    return {};
  });

  await step('typing, IME, keyup into a field, blur and a manual choice', async () => {
    const field = await js(`(()=>{const t=document.querySelector('[aria-label="动作说明 shot0"]');if(!t)return false;t.focus();return document.activeElement===t})()`);
    assert.ok(field, 'action textarea focusable');
    for (const code of ['b', 'e', 'l', 'k']) await tap(code, 40);
    await expectTool('画笔', 'tool keys are ignored while typing');
    await js(`document.activeElement?.blur?.()`);
    await delay(60);

    keyDown('e'); await delay(80);
    await expectTool('橡皮', 'E still works outside the field');
    const refocused = await js(`(()=>{const t=document.querySelector('[aria-label="动作说明 shot0"]');t.focus();return document.activeElement===t})()`);
    assert.ok(refocused, 'field refocused');
    await delay(180);
    keyUp('e'); await delay(140);
    await expectTool('画笔', 'release restores even after focus moved into a field');

    await js(`document.activeElement?.blur?.()`);
    await js(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'e',isComposing:true,bubbles:true,cancelable:true}))`);
    await expectTool('画笔', 'IME composition is ignored');

    keyDown('e'); await delay(90);
    await expectTool('橡皮', 'hold before blur');
    await js(`window.dispatchEvent(new Event('blur'))`);
    await delay(140);
    await expectTool('画笔', 'window blur restores the previous tool');
    keyUp('e'); await delay(60);

    await tap('l'); await expectTool('选区', 'L before the manual choice');
    keyDown('e'); await delay(90); await expectTool('橡皮', 'hold E borrows the eraser from the lasso');
    await realClick('button[aria-label="画笔"]');
    await delay(150);
    await expectTool('画笔', 'the rail click wins while E is held');
    await delay(220); keyUp('e'); await delay(120);
    await expectTool('画笔', 'a late keyup does not undo the manual choice');
    return {};
  });

  await step('draw, borrow the eraser under the pen, release E, continue with B', async () => {
    await tap('b');
    const stage = await stageOf('viewer:shot0');
    const rev0 = await revision();
    const [x0, y0] = point(stage, 0.12, 0.20), [x1, y1] = point(stage, 0.40, 0.20);
    const [x2, y2] = point(stage, 0.36, 0.20), [x3, y3] = point(stage, 0.28, 0.20);
    const [x4, y4] = point(stage, 0.60, 0.20), [x5, y5] = point(stage, 0.68, 0.20);
    mouse('mouseDown', x0, y0); await delay(30);
    mouse('mouseMove', x1, y1); await delay(45);
    keyDown('e'); await delay(260);
    await expectTool('橡皮', 'E borrows the eraser mid-stroke');
    mouse('mouseMove', x2, y2); await delay(45);
    mouse('mouseMove', x3, y3); await delay(45);
    keyUp('e'); await delay(110);
    await expectTool('画笔', 'release restores the brush mid-stroke');
    mouse('mouseMove', x4, y4); await delay(45);
    mouse('mouseMove', x5, y5); await delay(45);
    mouse('mouseUp', x5, y5);
    await settle(3, 'brush, eraser and continued brush');
    const ink = await alphaAt('image0', 0.14, 0.20);
    const erased = await alphaAt('image0', 0.32, 0.20);
    const continued = await alphaAt('image0', 0.64, 0.20);
    assert.ok(ink > 240, 'brush prefix kept (' + ink + ')');
    assert.equal(erased, 0, 'borrowed eraser removed pixels');
    assert.ok(continued > 240, 'brush continued after release (' + continued + ')');
    return {revisionBefore: rev0, ink, erased, continued};
  });

  await step('L borrows E, release ends the eraser once and pointerup is not a lasso', async () => {
    await tap('l'); await expectTool('选区', 'start from the lasso');
    const stage = await stageOf('viewer:shot0');
    const rev0 = await revision();
    const [x0, y0] = point(stage, 0.66, 0.20), [x1, y1] = point(stage, 0.60, 0.20), [x2, y2] = point(stage, 0.90, 0.20);
    keyDown('e'); await delay(260);
    await expectTool('橡皮', 'E borrows the eraser from the lasso');
    mouse('mouseDown', x0, y0); await delay(40);
    mouse('mouseMove', x1, y1); await delay(45);
    keyUp('e'); await delay(130);
    await expectTool('选区', 'release restores the lasso');
    mouse('mouseMove', x2, y2); await delay(60);
    mouse('mouseUp', x2, y2);
    await settle(1, 'one eraser stroke');
    await delay(900);
    assert.equal(await revision(), rev0 + 1, 'no stroke or selection commit after pointerup');
    assert.equal(await js('!!document.querySelector(".bitmap-selection-outline")'), false, 'pointerup did not finish a lasso');
    const erased = await alphaAt('image0', 0.62, 0.20);
    assert.equal(erased, 0, 'the borrowed eraser really erased');
    await tap('b'); await expectTool('画笔', 'B after the restored lasso');
    return {revisionBefore: rev0, erased};
  });

  await step('dual surface with a 700 ms acknowledgement keeps all three strokes', async () => {
    await tap('b');
    const rev0 = await revision();
    await stroke('viewer:shot0', [[0.10, 0.45], [0.24, 0.45], [0.40, 0.45]]);
    await delay(30);
    await tap('e', 60); await expectTool('橡皮', 'short E during an outstanding brush write');
    await stroke('grid:shot0', [[0.30, 0.45], [0.33, 0.45], [0.36, 0.45]]);
    await delay(30);
    await tap('b'); await expectTool('画笔', 'B during outstanding writes');
    await stroke('viewer:shot0', [[0.50, 0.45], [0.55, 0.45], [0.60, 0.45]]);
    await settle(3, 'three cross-surface strokes');
    const before = await alphaAt('image0', 0.15, 0.45);
    const erased = await alphaAt('image0', 0.33, 0.45);
    const after = await alphaAt('image0', 0.55, 0.45);
    assert.ok(before > 240, 'viewer brush kept (' + before + ')');
    assert.equal(erased, 0, 'grid eraser applied (' + erased + ')');
    assert.ok(after > 240, 'viewer brush after the eraser kept (' + after + ')');
    return {revisionBefore: rev0, before, erased, after};
  });

  await step('L and K wait for the paint queue while B and E stay available', async () => {
    await tap('b');
    const rev0 = await revision();
    const stage = await stageOf('viewer:shot0');
    const [x0, y0] = point(stage, 0.10, 0.60), [x1, y1] = point(stage, 0.18, 0.60), [x2, y2] = point(stage, 0.26, 0.60);
    mouse('mouseDown', x0, y0); await delay(25);
    mouse('mouseMove', x1, y1); await delay(25);
    mouse('mouseUp', x1, y1);
    keyDown('l'); keyUp('l'); await delay(60);
    await expectTool('画笔', 'L is refused while the paint is outstanding');
    keyDown('k'); keyUp('k'); await delay(60);
    await expectTool('画笔', 'K is refused while the paint is outstanding');
    keyDown('e'); await delay(50); keyUp('e'); await delay(80);
    await expectTool('橡皮', 'E is allowed while the paint is outstanding');
    await tap('b'); await expectTool('画笔', 'B is allowed while the paint is outstanding');
    await settle(1, 'the outstanding brush stroke');
    assert.ok(await alphaAt('image0', 0.14, 0.60) > 240, 'the paint still landed');
    return {revisionBefore: rev0};
  });

  await step('the output window refuses tool keys', async () => {
    await tap('b');
    await realClick('button[aria-label="从文件夹取回外部改动"]');
    keyDown('e'); await delay(70);
    await expectTool('画笔', 'E is refused while output work owns the editor');
    keyUp('e');
    keyDown('l'); keyUp('l'); await delay(50);
    await expectTool('画笔', 'L is refused while output work owns the editor');
    await wait(() => js('document.querySelector(".wb-refresh")?.getAttribute("aria-busy")!=="true"'), 'refresh finished');
    await delay(120);
    await tap('e'); await expectTool('橡皮', 'E works again after the output window');
    await tap('b'); await expectTool('画笔', 'B works again after the output window');
    return {};
  });

  await step('a lasso gesture refuses E and still creates the selection', async () => {
    await tap('l'); await expectTool('选区', 'lasso selected');
    const stage = await stageOf('viewer:shot0');
    const [x0, y0] = point(stage, 0.55, 0.78), [x1, y1] = point(stage, 0.66, 0.78), [x2, y2] = point(stage, 0.66, 0.88);
    mouse('mouseDown', x0, y0); await delay(35);
    mouse('mouseMove', x1, y1); await delay(35);
    keyDown('e'); await delay(90);
    await expectTool('选区', 'E is refused during a lasso gesture');
    keyUp('e'); await delay(40);
    mouse('mouseMove', x2, y2); await delay(35);
    mouse('mouseUp', x2, y2);
    await wait(() => js('!!document.querySelector(".bitmap-selection-outline")'), 'selection outline', 5000);
    await tap('b'); await expectTool('画笔', 'B leaves the lasso');
    return {};
  });

  await step('a project switch freezes tool keys and leaves no borrowed eraser', async () => {
    await delay(900);
    await tap('b'); await expectTool('画笔', 'settled before switching');
    const before = await activeTool();
    await js('document.querySelector(".wb-project-menu").open = true');
    await realClick('[data-recent-project="recent-b"]');
    keyDown('e'); keyDown('l');
    await delay(180);
    assert.equal(await activeTool(), before, 'tool keys stay refused while the project is frozen for switching');
    keyUp('e'); keyUp('l');
    await wait(() => js('document.querySelector("[data-project-title]")?.innerText.includes("Project B")'), 'project B title');
    await wait(() => js('document.querySelector(".wb-status")?.innerText.includes("已自动暂存")'), 'project B ready');
    current = rootB;
    await expectTool('画笔', 'the new editor starts on the brush');
    await selectBoard();
    const rev0 = await revision();
    await tap('b');
    await stroke('viewer:shot0', [[0.12, 0.15], [0.24, 0.15], [0.36, 0.15]]);
    await settle(1, 'first stroke in project B');
    assert.ok(await alphaAt('image0', 0.24, 0.15) > 240, 'the keyboard still paints after the switch');
    return {title: await js('document.querySelector("[data-project-title]")?.innerText'), revisionBefore: rev0};
  });

  report.stage = 'done';
})().catch(error => {
  report.error = String(error.stack || error);
  console.error(report.error);
}).finally(async () => {
  try { fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(report, null, 2)); } catch {}
  app.exit(report.error ? 1 : 0);
});
