#!/usr/bin/env node
'use strict';
/*
 Measurement-only driver for workbench storyboard drag latency.

 Boundaries:
 - Writes nothing outside its own system-temporary run directory.
 - Never copies into, renames, or writes the source fixture; the source is opened read-only.
 - Always measures a fresh copy of the fixture with an independent Electron userData directory.
 - No build, no product-source edit, no network, no clipboard, no Trash, no user project.
 - Results are raw samples. Summary medians/p95 are descriptive only: they are not
   root-cause evidence. Attribution requires the counters, marks and controls below.

 Usage (orchestrator, plain Node):
   node scripts/flow-workbench-drag-perf.cjs --self-check
   node scripts/flow-workbench-drag-perf.cjs --fixture DIR --shots N --parked 1 --verify-only
   node scripts/flow-workbench-drag-perf.cjs --fixture DIR --shots N --parked 1 --prepare-only
   node scripts/flow-workbench-drag-perf.cjs \
     --fixture .hermes/bench-nov01-small/2k --shots 6 --parked 1 \
     [--cases idle,hover,drag-single,drag-cross] [--runs 3|7] [--moves 24]

 Cases are controls, not decoration:
   idle         no input: frame budget baseline with instrumentation installed
   hover        same pointer path without a button: hover/canvas cost without dnd-kit
   drag-single  drag that never crosses another card: per-move cost without enters/over changes
   drag-cross   drag across the grid: enters, over changes, reorder and checkpoint

 Attribution rule: a stall is only attributed to a cause when the per-frame counters in
 that window (enters, sketch-panel mounts/unmounts, reads, long tasks) agree AND the
 matching control does not show it. p95 is descriptive only.

 Driver mode is internal (spawned by the orchestrator with --driver).
*/
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');
const {performance} = require('node:perf_hooks');

const repo = path.resolve(__dirname, '..');
const entryPath = path.join(repo, 'dist-electron/platform/main/flowEditorEntry.js');
const CASES = ['idle', 'hover', 'drag-single', 'drag-cross'];
const DEFAULT_RUNS = {idle: 3, hover: 3, 'drag-single': 3, 'drag-cross': 7};
const now = () => performance.timeOrigin + performance.now();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function parse(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) throw Error('Unexpected argument: ' + arg);
    const head = arg.slice(2);
    if (head.includes('=')) {
      const at = head.indexOf('=');
      out[head.slice(0, at)] = head.slice(at + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
      out[head] = argv[++i];
    } else {
      out[head] = true;
    }
  }
  return out;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function walk(root, visit) {
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    const full = path.join(root, entry.name);
    visit(full, entry);
    if (entry.isDirectory()) walk(full, visit);
  }
}

// A fixture is synthetic only if it carries the generated sample identity and no
// root-level artwork. Anything else is refused before it is copied or opened.
function inspectFixture(root, expect) {
  const real = fs.realpathSync(root);
  const checkpointDir = path.join(real, '.storyboard-flow/checkpoints');
  const projectPath = path.join(checkpointDir, 'project.json');
  if (!fs.existsSync(projectPath)) throw Error('Not a Flow project (missing checkpoints/project.json): ' + root);
  const projectRaw = fs.readFileSync(projectPath);
  const project = JSON.parse(projectRaw.toString('utf8'));
  const images = Object.values(project.images || {});
  const shots = Array.isArray(project.shots) ? project.shots : [];
  const parked = Array.isArray(project.parkedShots) ? project.parkedShots : [];
  const assetsDir = path.join(checkpointDir, 'assets');
  const assetIds = [...new Set(images.flatMap(image => (image.layers || []).map(layer => layer.assetId)))];
  const missingAssets = assetIds.filter(id => !fs.existsSync(path.join(assetsDir, id + '.png')));
  const rootEntries = fs.readdirSync(real).filter(name => !name.startsWith('.'));
  const symlinks = [];
  const strayArtwork = [];
  if (fs.existsSync(assetsDir)) {
    walk(real, (full, entry) => {
      if (entry.isSymbolicLink()) symlinks.push(full);
      if (entry.isFile() && /\.(png|tif|tiff|jpg|jpeg|psd)$/i.test(entry.name) && !full.startsWith(assetsDir + path.sep)) strayArtwork.push(full);
    });
  }
  const dims = [...new Set(images.map(image => image.width + 'x' + image.height))];
  const layerCounts = [...new Set(images.map(image => (image.layers || []).length))];
  const idsGenerated = shots.concat(parked).every(shot => /^shot-\d+$/.test(shot.id));
  const imagesGenerated = Object.keys(project.images || {}).every(id => /^image-\d+$/.test(id));
  const checks = {
    generatedSampleId: project.id === 'studio-sample',
    generatedShotIds: idsGenerated,
    generatedImageIds: imagesGenerated,
    shotCount: shots.length === expect.active,
    parkedCount: parked.length === expect.parked,
    uniformDimensions: dims.length === 1 && dims[0] === '2048x1152',
    threeLayers: layerCounts.length === 1 && layerCounts[0] === 3,
    assetsPresent: missingAssets.length === 0,
    noRootArtwork: rootEntries.length === 0,
    noStrayArtwork: strayArtwork.length === 0,
    noSymlinks: symlinks.length === 0,
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) throw Error('Fixture refused (' + failed.join(', ') + '): ' + root);
  return {
    real, projectPath, projectSha256: crypto.createHash('sha256').update(projectRaw).digest('hex'),
    projectId: project.id, name: project.name, revision: project.revision,
    active: shots.length, parked: parked.length, dims: dims[0],
    layers: layerCounts[0], assetRefs: assetIds.length, checks,
  };
}

function copyTree(source, target) {
  fs.cpSync(source, target, {recursive: true, dereference: false, errorOnExist: true, force: false});
}

function stats(values) {
  if (!values.length) return {count: 0};
  const sorted = [...values].sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
  return {
    count: sorted.length,
    min: Math.round(sorted[0] * 100) / 100,
    median: Math.round(at(0.5) * 100) / 100,
    p95: Math.round(at(0.95) * 100) / 100,
    max: Math.round(sorted[sorted.length - 1] * 100) / 100,
  };
}

function artifactIdentity() {
  const read = file => fs.statSync(file).mtime.toISOString();
  return {
    head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(),
    status: execFileSync('git', ['status', '--short'], {cwd: repo, encoding: 'utf8'}).trim(),
    distAssets: fs.existsSync(path.join(repo, 'dist/assets')) ? read(path.join(repo, 'dist/assets')) : null,
    distEntry: fs.existsSync(entryPath) ? read(entryPath) : null,
  };
}

function planPageSource() {
  return String.raw`(() => {
    const cards = [...document.querySelectorAll('.wb-card')].filter(card => {
      const rect = card.getBoundingClientRect();
      const host = card.closest('.wb-panel-body')?.getBoundingClientRect();
      return host && rect.top >= host.top + 4 && rect.bottom <= host.bottom - 4 &&
        rect.left >= host.left + 4 && rect.right <= host.right - 4;
    });
    if (cards.length < 2) return {error: 'fewer than two fully visible cards'};
    const pick = (card, selector) => {
      const element = card.querySelector(selector) || card;
      const rect = element.getBoundingClientRect();
      return {x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}};
    };
    if (cards.length < 3) return {error: 'fewer than three fully visible cards'};
    // Source and a target two positions later: inserting before a neighbour that is
    // already adjacent would be a no-op reorder and prove nothing.
    const source = cards[0];
    const target = cards[2];
    const order = [...document.querySelectorAll('[data-board-id]')].map(element => element.dataset.boardId);
    const handle = pick(source, '.wb-card-handle');
    const targetHandle = pick(target, '.wb-card-handle');
    const picture = pick(source, '.wb-card-picture');
    const targetPicture = pick(target, '.wb-card-picture');
    const sourceRect = source.getBoundingClientRect(), targetRect = target.getBoundingClientRect();
    // dnd-kit compares the dragged rect's center with droppable centers. Compensate
    // for the grab offset so the collision center lands exactly on the target center.
    const grabOffset = {x: sourceRect.x + sourceRect.width / 2 - handle.x, y: sourceRect.y + sourceRect.height / 2 - handle.y};
    const targetCenter = {x: targetRect.x + targetRect.width / 2, y: targetRect.y + targetRect.height / 2};
    const drop = {x: targetCenter.x - grabOffset.x, y: targetCenter.y - grabOffset.y};
    return {
      order,
      axis: Math.abs(drop.x - picture.x) >= Math.abs(drop.y - picture.y) ? 'x' : 'y',
      source: {id: source.dataset.boardId, handle, picture, center: {x: sourceRect.x + sourceRect.width / 2, y: sourceRect.y + sourceRect.height / 2}, size: {width: sourceRect.width, height: sourceRect.height}},
      target: {id: target.dataset.boardId, handle: targetHandle, picture: targetPicture, center: targetCenter, size: {width: targetRect.width, height: targetRect.height}},
      grabOffset,
      drop,
      move: {from: {x: picture.x, y: picture.y}, to: drop},
      lineCards: cards.slice(0, 3).map(card => card.dataset.boardId),
      visibleCards: cards.length,
    };
  })()`;
}

function bootstrapPage() {
  return String.raw`(() => {
    if (window.__dp) return 'already';
    const epoch = () => performance.timeOrigin + performance.now();
    const state = {
      frames: [], longtasks: [], pointer: [], enters: [], panels: [], marks: [],
      threshold: null, drag: null, watchState: null, longtaskSupported: true,
      panelObserver: false, listeners: 0, origin: performance.timeOrigin,
    };
    const push = (kind, event) => {
      const target = event.target instanceof Element ? event.target : null;
      const record = {
        kind, t: epoch(), x: event.clientX, y: event.clientY, buttons: event.buttons,
        board: target?.closest('[data-board-id]')?.dataset.boardId ?? null,
        picture: !!target?.closest('.wb-card-picture'),
        handle: !!target?.closest('.wb-card-handle'),
        surface: target?.closest('[data-surface]')?.dataset.surface ?? null,
      };
      state.pointer.push(record);
      return record;
    };
    let lastFrame = null;
    let downPoint = null;
    const loop = () => {
      const t = epoch();
      state.frames.push([t, lastFrame == null ? 0 : t - lastFrame]);
      lastFrame = t;
      if (state.drag) {
        if (state.drag.activated == null) {
          const handle = document.querySelector('.wb-card-handle[aria-pressed="true"]');
          if (handle) state.drag.activated = t;
        }
        if (state.drag.activated != null && state.drag.firstTransform == null) {
          const card = document.querySelector('[data-board-id="' + state.drag.id + '"]');
          if (card && card.style.transform) state.drag.firstTransform = t;
        }
      }
      const watch = state.watchState;
      if (watch && watch.settledAt == null) {
        // Re-query only after a mutation: node moves change document order and a
        // cached array would hide the reorder entirely.
        if (state.orderDirty || !watch.nodes) {
          watch.nodes = [...document.querySelectorAll('.wb-card')];
          state.orderDirty = false;
        }
        let transformed = null;
        const order = [];
        for (const card of watch.nodes) {
          if (card.style.transform) transformed = card.dataset.boardId;
          order.push(card.dataset.boardId);
        }
        const pressed = document.querySelector('.wb-card-handle[aria-pressed="true"]') != null;
        if (!pressed && watch.pressedClearAt == null) watch.pressedClearAt = t;
        if (!transformed && watch.noTransformAt == null) watch.noTransformAt = t;
        const changed = order.length === watch.orderBefore.length && order.some((id, i) => id !== watch.orderBefore[i]);
        const same = order.length === watch.orderBefore.length && order.every((id, i) => id === watch.orderBefore[i]);
        if (watch.orderAt == null && (watch.expectChange ? changed : same)) watch.orderAt = t;
        watch.orderSeen = order.slice(0, 8);
        watch.orderChanged = changed;
        // The project update arrives asynchronously after the drop; keep watching up
        // to three seconds for it instead of calling a snap-back "settled".
        const orderSettled = !watch.expectChange || changed || t >= watch.orderDeadline;
        if (watch.pressedClearAt != null && watch.noTransformAt != null && orderSettled) {
          watch.stable = (watch.stable || 0) + 1;
          if (watch.stable >= 2) watch.settledAt = t;
        } else {
          watch.stable = 0;
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
    addEventListener('pointerdown', event => { downPoint = {x: event.clientX, y: event.clientY}; push('down', event); }, true);
    addEventListener('pointermove', event => {
      const record = push('move', event);
      if (downPoint && state.threshold == null && Math.hypot(event.clientX - downPoint.x, event.clientY - downPoint.y) >= 6) state.threshold = record.t;
    }, true);
    addEventListener('pointerup', event => push('up', event), true);
    addEventListener('pointercancel', event => push('cancel', event), true);
    addEventListener('pointerover', event => {
      const target = event.target instanceof Element ? event.target : null;
      const picture = target?.closest('.wb-card-picture');
      if (!picture) return;
      const from = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.wb-card-picture') : null;
      if (picture === from) return;
      state.enters.push([epoch(), picture.closest('[data-board-id]')?.dataset.boardId ?? null, event.buttons,
        document.querySelector('.wb-card-handle[aria-pressed="true"]') != null]);
    }, true);
    state.listeners = 5;
    state.orderDirty = true;
    const grid = document.querySelector('.wb-grid');
    if (grid) {
      const panelsIn = (node, board, out) => {
        if (!(node instanceof Element)) return;
        const panel = node.matches('.sketch-panel') ? node : node.querySelector('.sketch-panel');
        if (panel) out.push({panel, board: board ?? panel.closest('[data-board-id]')?.dataset.boardId ?? null});
      };
      new MutationObserver(mutations => {
        state.orderDirty = true;
        const added = [], removed = [];
        for (const mutation of mutations) {
          const board = mutation.target instanceof Element ? mutation.target.closest('[data-board-id]')?.dataset.boardId ?? null : null;
          for (const node of mutation.addedNodes) panelsIn(node, board, added);
          for (const node of mutation.removedNodes) panelsIn(node, board, removed);
        }
        // Moving an existing card during reorder is not a canvas mount or unmount.
        const stamp = epoch();
        for (const entry of added) if (!removed.some(other => other.panel === entry.panel)) state.panels.push([stamp, 'mount', entry.board]);
        for (const entry of removed) if (!added.some(other => other.panel === entry.panel)) state.panels.push([stamp, 'unmount', entry.board]);
      }).observe(grid, {childList: true, subtree: true});
      state.panelObserver = true;
    }
    try {
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) state.longtasks.push([performance.timeOrigin + entry.startTime, entry.duration]);
      }).observe({entryTypes: ['longtask']});
    } catch { state.longtaskSupported = false; }
    // dnd-kit's live region names the actual active/over pair; reading it avoids
    // touching product code to log onDragEnd.
    state.announcements = [];
    const live = document.querySelector('[id^="DndLiveRegion"]');
    state.liveRegion = Boolean(live);
    if (live) {
      const remember = () => {
        const text = live.textContent?.trim();
        if (text && text !== state.announcements.at(-1)?.[1]) state.announcements.push([epoch(), text]);
      };
      new MutationObserver(remember).observe(live, {childList: true, subtree: true, characterData: true});
      remember();
    }
    state.lastAnnouncement = () => state.announcements.at(-1)?.[1] ?? null;
    state.beginDrag = id => { state.drag = {id, activated: null, firstTransform: null}; state.threshold = null; downPoint = null; };
    state.watch = spec => { state.watchState = {orderBefore: [...spec.orderBefore], expectChange: !!spec.expectChange,
      nodes: null, orderDeadline: epoch() + 3000,
      pressedClearAt: null, noTransformAt: null, orderAt: null, settledAt: null, orderSeen: null, orderChanged: null}; };
    state.mark = name => state.marks.push([epoch(), name]);
    state.scalars = () => ({now: epoch(), origin: state.origin, threshold: state.threshold, drag: state.drag,
      panels: state.panels.length, enters: state.enters.length, longtasks: state.longtasks.length, orderDirty: state.orderDirty});
    state.get = () => ({now: epoch(), origin: state.origin, frames: state.frames, longtasks: state.longtasks, pointer: state.pointer,
      enters: state.enters, panels: state.panels, marks: state.marks, threshold: state.threshold, drag: state.drag,
      watchState: state.watchState && {orderBefore: state.watchState.orderBefore, expectChange: state.watchState.expectChange,
        pressedClearAt: state.watchState.pressedClearAt, noTransformAt: state.watchState.noTransformAt,
        orderAt: state.watchState.orderAt, settledAt: state.watchState.settledAt, orderSeen: state.watchState.orderSeen,
        orderChanged: state.watchState.orderChanged, stable: state.watchState.stable},
      longtaskSupported: state.longtaskSupported, panelObserver: state.panelObserver, listeners: state.listeners,
      announcements: state.announcements, liveRegion: state.liveRegion});
    window.__dp = state;
    return 'installed';
  })()`;
}

async function orchestrate(options) {
  if (options['self-check']) {
    const vm = require('node:vm');
    const results = {};
    for (const [name, source] of [['plan', planPageSource()], ['bootstrap', bootstrapPage()]]) {
      try { new vm.Script(source); results[name] = 'compiled'; }
      catch (error) { results[name] = 'failed: ' + error.message; }
    }
    console.log(JSON.stringify(results, null, 2));
    if (Object.values(results).some(value => value !== 'compiled')) process.exitCode = 1;
    return;
  }
  if (!options.fixture) throw Error('Usage: node scripts/flow-workbench-drag-perf.cjs --fixture DIR --shots N [--parked 1] [--cases ...] [--runs N] [--verify-only|--prepare-only|--self-check]');
  const expect = {active: Number(options.shots), parked: Number(options.parked ?? 1)};
  if (!Number.isInteger(expect.active) || expect.active < 1) throw Error('--shots must be a positive integer');
  const identity = inspectFixture(options.fixture, expect);
  const report = {checkedAt: new Date().toISOString(), fixture: identity, artifact: artifactIdentity()};
  if (options['verify-only']) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!fs.existsSync(entryPath)) throw Error('Missing built entry; this driver never builds: ' + entryPath);
  const cases = options.cases ? String(options.cases).split(',').filter(Boolean) : CASES;
  for (const name of cases) if (!CASES.includes(name)) throw Error('Unknown case: ' + name);
  const runs = options.runs ? Number(options.runs) : null;
  if (runs != null && (!Number.isInteger(runs) || runs < 1)) throw Error('--runs must be a positive integer');
  const runRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'flow-drag-perf-'));
  const pristine = path.join(runRoot, 'fixture-pristine');
  copyTree(identity.real, pristine);
  const afterCopy = sha256(path.join(pristine, '.storyboard-flow/checkpoints/project.json'));
  if (afterCopy !== identity.projectSha256) throw Error('Fixture changed while being copied; refusing to measure');
  if (options['prepare-only']) {
    console.log(JSON.stringify({runRoot, pristine, sourceSha256: identity.projectSha256, copySha256: afterCopy,
      sourceUnchanged: sha256(identity.projectPath) === identity.projectSha256}, null, 2));
    return;
  }
  const summary = {...report, runRoot, pristine, cases: {}, options: {moves: Number(options.moves ?? 24), window: options.window ?? '1600x1000'}};
  for (const name of cases) {
    const count = runs ?? DEFAULT_RUNS[name];
    summary.cases[name] = {runs: [], failures: []};
    for (let index = 0; index < count; index++) {
      const dir = path.join(runRoot, name, 'run-' + index);
      fs.mkdirSync(dir, {recursive: true});
      const project = path.join(dir, 'project');
      copyTree(pristine, project);
      const userData = path.join(dir, 'userData');
      fs.mkdirSync(userData);
      const result = path.join(dir, 'result.json');
      const log = path.join(dir, 'driver.log');
      const argv = [__filename, '--driver', '--project', project, '--userData', userData, '--result', result,
        '--case', name, '--moves', String(options.moves ?? 24), '--window', options.window ?? '1600x1000'];
      const env = {...process.env};
      delete env.ELECTRON_RUN_AS_NODE;
      const start = now();
      let code = 0;
      let output = '';
      try {
        output = execFileSync(require('electron'), argv, {cwd: repo, env, encoding: 'utf8', timeout: 180000});
      } catch (error) {
        code = error.status ?? 1;
        output = String(error.stdout || '') + String(error.stderr || '');
      }
      fs.writeFileSync(log, output);
      const exitMs = now() - start;
      if (code !== 0) {
        summary.cases[name].failures.push({run: index, code, exitMs, dir, log});
        continue;
      }
      const parsed = JSON.parse(fs.readFileSync(result, 'utf8'));
      if (parsed.contaminated) {
        summary.cases[name].contaminated = summary.cases[name].contaminated || [];
        summary.cases[name].contaminated.push({run: index, reason: parsed.contaminationReason, dir});
        continue;
      }
      summary.cases[name].runs.push(parsed);
    }
    summary.cases[name].descriptive = describe(summary.cases[name].runs);
    summary.cases[name].descriptive.excludedContaminated = (summary.cases[name].contaminated || []).length;
  }
  fs.writeFileSync(path.join(runRoot, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({runRoot, summary: path.join(runRoot, 'summary.json'), cases: Object.fromEntries(cases.map(name => [name, summary.cases[name].descriptive]))}, null, 2));
}

// Descriptive only. Root cause needs the counters, marks and controls in each run.
function describe(runs) {
  const out = {sampleCount: runs.length, descriptiveOnly: true};
  const frames = runs.flatMap(run => run.frames.map(frame => frame[1]).filter(value => value > 0));
  out.frameInterval = stats(frames);
  out.frameIntervalOver33 = frames.filter(value => value > 33.4).length;
  out.longTaskTotalMs = stats(runs.map(run => run.longtasks.reduce((sum, entry) => sum + entry[1], 0)));
  out.enterCount = stats(runs.map(run => run.enters.length));
  out.entersDuringDrag = stats(runs.map(run => run.phaseCounts?.entersDuringDrag ?? 0));
  out.panelMounts = stats(runs.map(run => run.panels.filter(entry => entry[1] === 'mount').length));
  out.panelUnmounts = stats(runs.map(run => run.panels.filter(entry => entry[1] === 'unmount').length));
  out.readsDuringDrag = stats(runs.map(run => run.readsDuringDrag.length));
  out.dispatchLatency = stats(runs.flatMap(run => (run.dispatchToDelivery || []).map(entry => entry.latency).filter(value => typeof value === 'number' && value >= -5)));
  out.dispatchUnpaired = runs.flatMap(run => (run.dispatchToDelivery || []).map(entry => entry.latency)).filter(value => typeof value === 'number' && value < -5).length;
  out.gateWait = stats(runs.flatMap(run => (run.gates || []).map(entry => entry.wait)));
  out.phases = Object.fromEntries(Object.keys(runs[0]?.timings ?? {}).map(key => [key, stats(runs.map(run => run.timings[key]).filter(value => typeof value === 'number'))]));
  out.checkpointMsAfterDrag = stats(runs.flatMap(run => (run.checkpointsAfterDrag || []).map(entry => entry.dur)));
  out.reorderApplied = runs.filter(run => run.watchState?.orderChanged === true).length;
  out.reorderObservedInProject = runs.filter(run => Array.isArray(run.orderAfter) && Array.isArray(run.domOrderAfter) &&
    run.orderAfter.join() === run.domOrderAfter.slice(0, run.orderAfter.length).join()).length;
  return out;
}

async function drive(options) {
  const {app, BrowserWindow, ipcMain, clipboard, shell} = require('electron');
  for (const key of Object.keys(clipboard)) if (typeof clipboard[key] === 'function') clipboard[key] = () => { throw Error('Clipboard forbidden'); };
  shell.trashItem = async () => { throw Error('Trash forbidden'); };
  const resultPath = options.result;
  const writes = () => JSON.parse(fs.readFileSync(path.join(options.project, '.storyboard-flow/checkpoints/project.json'), 'utf8'));
  const reads = [];
  const checkpoints = [];
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => originalHandle(channel, async (...args) => {
    if (channel === 'flow-editor:read') reads.push({t: now(), id: args[2]});
    if (channel === 'flow-editor:checkpoint') {
      const start = now();
      try { return await listener(...args); }
      finally { checkpoints.push({start, dur: now() - start}); }
    }
    return listener(...args);
  });
  const result = {case: options.case, startedAt: new Date().toISOString(), project: options.project,
    userData: options.userData, moves: Number(options.moves), window: options.window, reads: [], readsDuringDrag: [],
    checkpoints: [], timings: {}, marks: [], error: null};
  let win;
  const js = code => {
    if (!win || win.isDestroyed()) throw Error('window unavailable');
    return win.webContents.executeJavaScript(code, true);
  };
  try {
    process.argv = [process.execPath, entryPath, options.project, options.userData, '--workbench'];
    await import(require('node:url').pathToFileURL(entryPath).href);
    await app.whenReady();
    const until = async (fn, label, timeout = 90000) => {
      const deadline = now() + timeout;
      do { try { if (await fn()) return; } catch {} await delay(50); } while (now() < deadline);
      throw Error('Timeout: ' + label);
    };
    await until(() => (win = BrowserWindow.getAllWindows()[0]), 'window');
    const [width, height] = String(options.window || '1600x1000').split('x').map(Number);
    win.setSize(width, height);
    win.focus();
    await until(() => js('!!document.querySelector("[data-workbench]")'), 'workbench');
    await until(() => js('document.querySelector(".wb-status [role=status]")?.textContent.startsWith("Flow 内已保存")'), 'initial checkpoint');
    await until(() => js('document.querySelector(".wb-viewer .image-stage img")?.naturalWidth>0'), 'viewer raster');
    result.openedAt = now();
    await js(bootstrapPage());
    await delay(300);
    const plan = await js(planPageSource());
    if (plan.error) throw Error(plan.error);
    result.plan = {source: plan.source.id, target: plan.target.id, axis: plan.axis, lineCards: plan.lineCards,
      visibleCards: plan.visibleCards, order: plan.order.slice(0, 10), grabOffset: plan.grabOffset, drop: plan.drop,
      sourceCenter: plan.source.center, targetCenter: plan.target.center};
    const pingStart = now();
    const pageNow = await js('performance.timeOrigin + performance.now()');
    const pingEnd = now();
    // Page clock = main clock + offset. Both are epoch-based on this platform, so the
    // estimate is small; cross-process latency stays approximate (IPC round trip).
    const clockOffset = pageNow - (pingStart + pingEnd) / 2;
    const pageToMain = value => value - clockOffset;
    result.clock = {offsetMs: Math.round(clockOffset * 1000) / 1000, roundTripMs: Math.round((pingEnd - pingStart) * 1000) / 1000,
      method: 'renderer performance.timeOrigin + performance.now(), corrected by half the ping round trip',
      crossProcessLatency: 'approximate: main->renderer input dispatch only, never frame latency'};
    if (Math.abs(clockOffset) > 200) throw Error('Renderer/main clocks disagree by ' + clockOffset + ' ms');
    const gates = [];
    const dispatches = [];
    const send = (type, x, y) => {
      const t = now();
      win.webContents.sendInputEvent({type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount: 1});
      dispatches.push({type, t, x: Math.round(x), y: Math.round(y)});
    };
    const frame = async () => {
      const sent = now();
      const at = await js('new Promise(resolve => requestAnimationFrame(() => resolve(performance.timeOrigin + performance.now())))');
      const gate = {sent, at, wait: at - sent};
      gates.push(gate);
      return gate;
    };
    const mark = name => js('__dp.mark(' + JSON.stringify(name) + ')');
    if (options.case === 'idle') {
      await mark('idle-start');
      await delay(1500);
      await mark('idle-end');
      result.idleWindowMs = 1500;
    }
    if (options.case === 'hover' || options.case === 'drag-single' || options.case === 'drag-cross') {
      const source = plan.source;
      await mark('approach');
      send('mouseMove', source.handle.x, source.handle.y);
      await frame();
      if (options.case === 'hover') {
        await mark('sweep-start');
        for (let i = 1; i <= Number(options.moves); i++) {
          await frame();
          send('mouseMove', plan.move.from.x + (plan.move.to.x - plan.move.from.x) * i / Number(options.moves),
            plan.move.from.y + (plan.move.to.y - plan.move.from.y) * i / Number(options.moves));
        }
        await mark('sweep-end');
      } else {
        await js('__dp.beginDrag(' + JSON.stringify(source.id) + ')');
        await mark('down');
        send('mouseDown', source.handle.x, source.handle.y);
        const thresholdMoves = [2, 4, 7];
        for (const dx of thresholdMoves) { await frame(); send('mouseMove', source.handle.x + dx, source.handle.y); }
        const revisionBefore = writes().revision;
        result.revisionBefore = revisionBefore;
        if (options.case === 'drag-single') {
          for (let i = 1; i <= Number(options.moves); i++) {
            await frame();
            send('mouseMove', source.handle.x + Math.sin(i / 3) * 24, source.handle.y + Math.sin(i / 4) * 4);
          }
          for (let i = 0; i < 4; i++) await frame();
          await js('__dp.watch(' + JSON.stringify({orderBefore: plan.order, expectChange: false}) + ')');
          send('mouseUp', source.handle.x, source.handle.y);
        } else {
          await frame();
          send('mouseMove', plan.move.from.x, plan.move.from.y);
          for (let i = 1; i <= Number(options.moves); i++) {
            await frame();
            send('mouseMove', plan.move.from.x + (plan.move.to.x - plan.move.from.x) * i / Number(options.moves),
              plan.move.from.y + (plan.move.to.y - plan.move.from.y) * i / Number(options.moves));
          }
          // Let dnd-kit commit the final `over` before releasing; otherwise the drop
          // uses the previous card and the reorder is a no-op.
          for (let i = 0; i < 4; i++) await frame();
          await js('__dp.watch(' + JSON.stringify({orderBefore: plan.order, expectChange: true}) + ')');
          send('mouseUp', plan.move.to.x, plan.move.to.y);
        }
        const activation = await js('__dp.drag');
        if (!activation || activation.activated == null) throw Error('Drag never activated: ' + JSON.stringify(activation));
        await until(() => js('!!__dp.watchState && __dp.watchState.settledAt != null'), 'visual settle', 12000);
        const settled = await js('__dp.watchState');
        if (options.case === 'drag-cross' && !settled.orderChanged) {
          throw Error('Drop did not reorder; announcement=' + JSON.stringify(await js('__dp.lastAnnouncement()')));
        }
        result.domOrderBefore = plan.order;
        result.domOrderAfter = await js('[...document.querySelectorAll("[data-board-id]")].map(element => element.dataset.boardId)');
        if (options.case === 'drag-cross') {
          // The dragged card lands under the pointer; its canvas must be editable again
          // immediately, otherwise the first press after a drop only focuses.
          result.domProbe = await js('(()=>({panels:[...document.querySelectorAll(".sketch-panel")].map(p=>p.closest("[data-board-id]")?.dataset.boardId??"viewer"),cardChildren:document.querySelector(\'[data-board-id="' + source.id + '"] .wb-card-picture\')?.childElementCount,cardPicture:!!document.querySelector(\'[data-board-id="' + source.id + '"] .wb-card-picture\'),near:[...document.querySelectorAll("[data-board-id]")].slice(0,3).map(c=>[c.dataset.boardId,!!c.querySelector(".sketch-panel")])}))()');
          result.postDropCanvasMounted = await js('!!document.querySelector(\'[data-board-id="' + source.id + '"] .sketch-panel\')');
          result.dropHit = await js('(()=>{const card=document.elementFromPoint(' + Math.round(plan.move.to.x) + ',' + Math.round(plan.move.to.y) + ')?.closest("[data-board-id]");return {board:card?.dataset.boardId??null,mounted:!!(card&&card.querySelector(".sketch-panel"))}})()');
          if (!result.dropHit.mounted) throw Error('Card under the pointer has no editable canvas after drop: ' + JSON.stringify(result.dropHit));
          await until(() => js('document.querySelector("[data-workbench]").dataset.revision !== ' + JSON.stringify(String(revisionBefore))), 'revision change', 15000);
          await until(() => js('document.querySelector(".wb-status [role=status]")?.textContent.startsWith("Flow 内已保存")'), 'checkpoint after drop', 15000);
          result.checkpointObservedAt = now();
          result.orderAfter = writes().shots.slice(0, 10).map(shot => shot.id);
        }
      }
    }
    const snapshot = await js('__dp.get()');
    const windowStart = (snapshot.marks.find(entry => entry[1] === 'idle-start') ||
      snapshot.marks.find(entry => entry[1] === 'approach') || [null])[0];
    if (windowStart != null) {
      snapshot.frames = snapshot.frames.filter(entry => entry[0] >= windowStart);
      snapshot.longtasks = snapshot.longtasks.filter(entry => entry[0] >= windowStart);
    }
    result.measuredWindow = {start: windowStart, end: snapshot.now};
    const downAt = (snapshot.pointer.find(entry => entry.kind === 'down') || {}).t;
    const upAt = (snapshot.pointer.find(entry => entry.kind === 'up') || {}).t;
    result.frames = snapshot.frames;
    result.longtasks = snapshot.longtasks;
    result.pointer = snapshot.pointer;
    result.enters = snapshot.enters;
    result.panels = snapshot.panels;
    result.marks = result.marks.concat(snapshot.marks);
    result.drag = snapshot.drag;
    result.watchState = snapshot.watchState;
    result.threshold = snapshot.threshold;
    result.longtaskSupported = snapshot.longtaskSupported;
    result.panelObserver = snapshot.panelObserver;
    result.liveRegion = snapshot.liveRegion;
    result.announcements = snapshot.announcements;
    result.reads = reads;
    result.checkpoints = checkpoints;
    result.checkpointsAfterDrag = downAt == null ? [] : checkpoints.filter(entry => entry.start >= pageToMain(downAt));
    result.readsDuringDrag = downAt == null ? [] : reads.filter(entry => entry.t >= pageToMain(downAt) && (upAt == null || entry.t <= pageToMain(upAt) + 500));
    result.gates = gates;
    result.dispatches = dispatches;
    // A physical mouse can move through the window while the driver is running. Every
    // renderer pointer event must match a dispatch of the same kind within 2 px;
    // anything else is external input and the sample is not used.
    const typeOf = entry => entry.type === 'mouseDown' ? 'down' : entry.type === 'mouseUp' ? 'up' : 'move';
    let unexpected = 0;
    const searchFrom = {down: 0, move: 0, up: 0, cancel: 0};
    for (const event of snapshot.pointer) {
      const kind = event.kind;
      const pool = dispatches.filter(item => typeOf(item) === kind);
      let at = searchFrom[kind] ?? 0;
      while (at < pool.length && (Math.abs(pool[at].x - event.x) > 2 || Math.abs(pool[at].y - event.y) > 2)) at++;
      if (at >= pool.length) unexpected++;
      else searchFrom[kind] = at + 1;
    }
    result.unexpectedPointers = unexpected;
    result.contaminated = unexpected > 0 || (options.case === 'drag-single' && result.watchState?.orderChanged === true);
    result.contaminationReason = unexpected > 0 ? 'unmatched renderer pointer events: ' + unexpected
      : result.contaminated ? 'control drag reordered' : null;
    // Dispatch (main process) and delivery (renderer) are reported separately; the
    // gate wait is the main<->renderer round trip, never app frame latency.
    const cursors = {down: 0, move: 0, up: 0, cancel: 0};
    result.dispatchToDelivery = dispatches.map(entry => {
      const kind = entry.type === 'mouseDown' ? 'down' : entry.type === 'mouseUp' ? 'up' : 'move';
      const delivered = snapshot.pointer.filter(item => item.kind === kind)[cursors[kind]++];
      return {kind, dispatchT: entry.t, deliveryT: delivered?.t ?? null, latency: delivered ? pageToMain(delivered.t) - entry.t : null};
    });
    const anchor = downAt ?? result.marks.find(entry => entry[1] === 'approach')?.[0] ?? null;
    if (anchor != null && result.drag) {
      result.timings.downToThreshold = snapshot.threshold == null ? null : snapshot.threshold - anchor;
      result.timings.thresholdToActivation = snapshot.drag.activated == null || snapshot.threshold == null ? null : snapshot.drag.activated - snapshot.threshold;
      result.timings.downToActivation = snapshot.drag.activated == null ? null : snapshot.drag.activated - anchor;
      result.timings.activationToFirstTransform = snapshot.drag.firstTransform == null || snapshot.drag.activated == null ? null : snapshot.drag.firstTransform - snapshot.drag.activated;
    }
    if (upAt != null && result.watchState) {
      result.timings.upToNoTransform = result.watchState.noTransformAt == null ? null : result.watchState.noTransformAt - upAt;
      result.timings.upToOrderApplied = result.watchState.orderAt == null ? null : result.watchState.orderAt - upAt;
      result.timings.upToSettled = result.watchState.settledAt == null ? null : result.watchState.settledAt - upAt;
    }
    if (upAt != null && result.checkpointObservedAt != null) result.timings.upToCheckpointStatusObserved = result.checkpointObservedAt - pageToMain(upAt);
    if (result.watchState?.settledAt != null && result.checkpointObservedAt != null) result.timings.settledToCheckpointStatusObserved = result.checkpointObservedAt - pageToMain(result.watchState.settledAt);
    result.pollGranularityMs = 50;
    result.instrumentation = {
      frames: 'requestAnimationFrame loop in the renderer; intervals from performance.timeOrigin + performance.now()',
      pointer: 'window capture listeners (pointerdown/move/up/cancel); pointerenter is counted via pointerover with a different .wb-card-picture',
      sketchMounts: 'MutationObserver on .wb-grid subtree for .sketch-panel insert/remove',
      settle: 'per-frame scan of inline card transforms plus DOM order while settling',
      dispatch: 'webContents.sendInputEvent from the main process; one move per acknowledged frame',
    };
    result.phaseCounts = {
      entersDuringDrag: downAt == null ? null : snapshot.enters.filter(entry => entry[0] >= downAt && (upAt == null || entry[0] <= upAt)).length,
      entersWithButtons: snapshot.enters.filter(entry => entry[2] > 0).length,
      panelsMountedDuringDrag: downAt == null ? null : snapshot.panels.filter(entry => entry[1] === 'mount' && entry[0] >= downAt && (upAt == null || entry[0] <= upAt)).length,
      panelsUnmountedDuringDrag: downAt == null ? null : snapshot.panels.filter(entry => entry[1] === 'unmount' && entry[0] >= downAt && (upAt == null || entry[0] <= upAt)).length,
    };
    result.samples = {frameIntervals: snapshot.frames.map(entry => entry[1]), longTasks: snapshot.longtasks};
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
    win.destroy();
    setTimeout(() => app.exit(0), 100);
  } catch (error) {
    result.error = String(error && error.stack || error);
    // Diagnostics must survive a failed run: keep the trace instead of only the error.
    try { result.trace = await js('__dp.get()'); } catch {}
    try {
      if (win && !win.isDestroyed()) {
        result.pageText = await win.webContents.executeJavaScript('document.body.innerText');
        fs.writeFileSync(path.join(path.dirname(resultPath), 'failure.png'), (await win.webContents.capturePage()).toPNG());
      }
    } catch {}
    try { fs.writeFileSync(resultPath, JSON.stringify(result, null, 2)); } catch {}
    app.exit(1);
  }
}

const options = parse(process.argv.slice(2));
const run = process.versions.electron ? (options.driver ? drive(options) : Promise.reject(Error('Electron mode requires --driver'))) : orchestrate(options);
run.catch(error => {
  console.error((process.env.DEBUG ? String(error && error.stack || error) : String(error && error.message || error)));
  process.exitCode = 1;
});
