// Safety: only this runner's synthetic files/profile; hidden window, no product entry.
const { app, BrowserWindow, MessageChannelMain, clipboard, shell, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const repo = process.env.FLOW_FRAME_REPO, run = process.env.FLOW_FRAME_RUN;
const temp = fs.realpathSync(require('node:os').tmpdir());
if (!run || path.dirname(run) !== temp || !path.basename(run).startsWith('flow-image-frame-display-') || fs.realpathSync(run) !== run || !path.isAbsolute(repo)) throw Error('Owned canonical temp paths required');
for (const key of Object.keys(clipboard)) if (typeof clipboard[key] === 'function') clipboard[key] = () => { throw Error('Clipboard prohibited'); };
shell.trashItem = () => { throw Error('Trash prohibited'); };
shell.openExternal = () => { throw Error('External launch prohibited'); };
app.setPath('userData', path.join(run, 'profile')); app.setPath('sessionData', path.join(run, 'profile')); app.setAppLogsPath(path.join(run, 'profile', 'logs'));
app.commandLine.appendSwitch('disable-background-networking');
const report = { completed: false, error: null, cases: [], platform: process.platform, versions: process.versions };
let win, mainPort;
const W = 128, H = 64;
const identity = { sessionId: 'synthetic', incarnation: 'display-smoke', documentId: 'document', workerEpoch: 1, epoch: 1 };
const header = (seq, patch = {}) => ({ ...identity, frameSeq: seq, baseFrameSeq: null, imageVersionRef: 'durable-v1', inputThrough: seq - 1,
  width: W, height: H, encoding: 'srgb-rgba8-straight', tiles: [{ x: 0, y: 0, w: W, h: H, offset: 0, length: W * H * 4 }], ...patch });
const red = Buffer.alloc(W * H * 4); for (let i = 0; i < W * H; i++) red.set([255, 0, 0, 255], i * 4);
const js = code => win.webContents.executeJavaScript(code);
const evaluate = (name, ...args) => js(`FrameDisplayHarness.${name}(...${JSON.stringify(args)})`);
const acks = new Map();
function sendFrame(id, h, raw, { mutateAfter = false } = {}) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { acks.delete(id); reject(Error('Frame ACK timeout ' + id)); }, 8000);
    acks.set(id, result => { clearTimeout(timer); resolve(result); });
    // Explicit copy from the view. Never pass Buffer.buffer, which may include a pool/sentinels.
    const exact = Uint8Array.from(raw);
    mainPort.postMessage({ kind: 'frame', id, header: h, pixels: exact });
    if (mutateAfter) { exact.fill(77); report.cloneSender = { byteLength: exact.byteLength, first: exact[0] }; }
  });
}
async function assertBoth(expected) {
  const states = await evaluate('state'); assert.ok(states.every(s => s.status === 'ready' && s.visibility === 'visible'));
  for (const id of ['a', 'b']) assert.deepEqual(await evaluate('pixels', id), Array.from(expected));
  return states;
}
(async () => {
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win = new BrowserWindow({ show: false, width: 520, height: 260, webPreferences: { preload: path.join(run, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  await win.loadFile(path.join(run, 'index.html'));
  await evaluate('initialize', identity); await evaluate('receivePort', 'owned-port-nonce');
  const { port1, port2 } = new MessageChannelMain(); mainPort = port1;
  const ready = new Promise(resolve => port1.on('message', ({ data }) => {
    if (data.kind === 'ready') resolve(data);
    if (data.kind === 'installed') { const finish = acks.get(data.id); acks.delete(data.id); finish?.(data.result); }
  }));
  port1.start(); win.webContents.postMessage('frame-port', { nonce: 'owned-port-nonce' }, [port2]);
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(Error('Port handshake timeout')), 8000))]);
  const ab = new ArrayBuffer(3); let transferError = null;
  try { port1.postMessage({ pixels: ab }, [ab]); } catch (error) { transferError = String(error); }
  assert.ok(transferError, 'Main must reject ArrayBuffer in MessagePortMain transfer list'); assert.equal(ab.byteLength, 3);
  const dom = await evaluate('domTransferProbe'); assert.deepEqual(dom, { senderAfter: 0, received: [17, 29, 43] });
  report.cases.push({ name: 'real isolated-world port handoff, Main clone / DOM transfer', transferError, mainSenderBytes: ab.byteLength, dom });

  assert.equal((await sendFrame('key', header(1), red)).ok, true); await assertBoth(red);
  const pool = Buffer.alloc(16 + 512, 189), view = pool.subarray(7, 519); view.fill(0);
  for (let i = 256; i < 512; i += 4) view.set([0, 0, 255, 128], i);
  const patchHeader = header(2, { baseFrameSeq: 1, tiles: [{ x: 20, y: 10, w: 8, h: 8, offset: 0, length: 256 }, { x: 40, y: 10, w: 8, h: 8, offset: 256, length: 256 }] });
  assert.equal((await sendFrame('delta', patchHeader, view, { mutateAfter: true })).ok, true);
  const expected = Buffer.from(red);
  for (let y = 0; y < 8; y++) { expected.fill(0, ((y + 10) * W + 20) * 4, ((y + 10) * W + 28) * 4); view.copy(expected, ((y + 10) * W + 40) * 4, 256 + y * 32, 256 + (y + 1) * 32); }
  const states = await assertBoth(expected);
  const receive = await evaluate('results'); const deltaReceived = receive.incoming.find(e => e.id === 'delta');
  assert.equal(deltaReceived.byteLength, 512); assert.equal(deltaReceived.bufferLength, 512);
  assert.equal(report.cloneSender.byteLength, 512); assert.equal(report.cloneSender.first, 77);
  report.cases.push({ name: 'tight nonzero-offset Buffer, alpha-zero replacement, differently scaled surfaces', states, received: deltaReceived });

  const sharp = (await import(pathToFileURL(path.join(repo, 'node_modules/sharp/lib/index.js')).href)).default;
  const screenshot = (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG();
  fs.writeFileSync(path.join(run, 'scaled-surfaces.png'), screenshot);
  const { data, info } = await sharp(screenshot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const viewportWidth = await js('innerWidth'); const ratio = info.width / viewportWidth;
  const screen = [];
  for (const s of states) for (const [name, x, y, rgb] of [['red', 5, 5, [255, 0, 0]], ['clear', 22, 12, [255, 255, 255]], ['blue-half', 42, 12, [127, 127, 255]]]) {
    const px = Math.floor((s.rect.x + (x + .5) * s.rect.width / W) * ratio), py = Math.floor((s.rect.y + (y + .5) * s.rect.height / H) * ratio);
    const actual = Array.from(data.subarray((py * info.width + px) * 4, (py * info.width + px) * 4 + 3));
    actual.forEach((v, i) => assert.ok(Math.abs(v - rgb[i]) <= 1, 'screen composite ' + name + ' ' + actual)); screen.push({ surface: s.id, name, actual });
  }
  report.cases.push({ name: 'actual compositor screenshot samples', screen, screenshot: { width: info.width, height: info.height, ratio } });

  assert.equal((await sendFrame('late-key', header(1), red)).code, 'stale-frame'); await assertBoth(expected);
  assert.equal((await sendFrame('partial', { ...patchHeader, frameSeq: 3, baseFrameSeq: 2, inputThrough: 2 }, view.subarray(0, 256))).code, 'invalid-frame');
  await assertBoth(expected);
  await evaluate('dispose', 'a'); assert.equal((await evaluate('state'))[0].status, 'disposed');
  const third = header(3, { baseFrameSeq: 2, tiles: [{ x: 1, y: 1, w: 1, h: 1, offset: 0, length: 4 }] });
  assert.equal((await sendFrame('while-unmounted', third, Buffer.from([0, 255, 0, 255]))).ok, true); expected.set([0, 255, 0, 255], (W + 1) * 4);
  await evaluate('remount', 'a'); await assertBoth(expected);
  // Simulate an external intrinsic resize, then explicitly repair from the complete view.
  await js('document.getElementById("b").width=1'); await evaluate('refresh', 'b'); await assertBoth(expected);
  report.cases.push({ name: 'late keyframe refused; surface disposal/remount and bitmap resize repair' });

  const next = { ...identity, epoch: 2 }; assert.equal((await evaluate('reset', next)).ok, true);
  const preparing = await evaluate('state'); assert.ok(preparing.every(s => s.status === 'preparing' && s.visibility === 'hidden'));
  const hidden = (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG(); fs.writeFileSync(path.join(run, 'epoch-preparing.png'), hidden);
  const hiddenRaw = await sharp(hidden).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (const surface of preparing) {
    const px = Math.floor((surface.rect.x + 5) * ratio), py = Math.floor((surface.rect.y + 5) * ratio);
    assert.deepEqual(Array.from(hiddenRaw.data.subarray((py * hiddenRaw.info.width + px) * 4, (py * hiddenRaw.info.width + px) * 4 + 3)), [255, 255, 255]);
    assert.deepEqual(await evaluate('pixels', surface.id, { x: 0, y: 0, w: 1, h: 1 }), [0, 0, 0, 0]);
  }
  assert.equal((await sendFrame('late-epoch', header(8), red)).code, 'wrong-identity');
  assert.equal((await sendFrame('new-epoch', header(1, next), red)).ok, true); await assertBoth(red);
  assert.equal((await sendFrame('gap', header(3, { ...next, baseFrameSeq: 2, tiles: third.tiles }), Buffer.from([0, 0, 0, 0]))).code, 'needs-keyframe');
  assert.ok((await evaluate('state')).every(s => s.visibility === 'hidden'));
  assert.equal((await sendFrame('recover', header(4, next), red)).ok, true); await assertBoth(red);
  report.cases.push({ name: 'epoch preparing concealment, old epoch rejection, missing delta recovery', preparing });
  const resized = Buffer.alloc(96 * 48 * 4); for (let i = 0; i < 96 * 48; i++) resized.set([0, 255, 0, 255], i * 4);
  assert.equal((await sendFrame('resized-key', header(5, { ...next, width: 96, height: 48, tiles: [{ x: 0, y: 0, w: 96, h: 48, offset: 0, length: resized.length }] }), resized)).ok, true);
  const resizedStates = await assertBoth(resized); assert.ok(resizedStates.every(s => s.width === 96 && s.height === 48));
  assert.equal(resizedStates[0].rect.width, states[0].rect.width); assert.equal(resizedStates[1].rect.width, states[1].rect.width);
  report.cases.push({ name: 'keyframe changes intrinsic dimensions while DOM geometry remains owned by layout', resizedStates });

  // Optional replay: only native runner-owned synthetic evidence, never user images/projects.
  if (process.env.FLOW_NATIVE_FRAME_GOLDENS) {
    const folder = fs.realpathSync(process.env.FLOW_NATIVE_FRAME_GOLDENS), parent = path.dirname(folder);
    if (path.basename(folder) !== 'frames' || path.dirname(parent) !== temp || !path.basename(parent).startsWith('flow-native-process-')) throw Error('Synthetic native golden directory required');
    const files = fs.readdirSync(folder).filter(n => /^\d+-[1-4]\.json$/.test(n)).sort();
    const epochPrefix = files[0]?.split('-')[0]; const chain = files.filter(n => n.startsWith(epochPrefix + '-'));
    assert.equal(chain.length, 4, 'complete recorded first keyframe/delta/delta/capture chain required');
    const names = [];
    for (const name of chain) {
      const jsonFile = path.join(folder, name), rawFile = path.join(folder, name.replace('.json', '.rgba'));
      for (const file of [jsonFile, rawFile]) { const stat = fs.lstatSync(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 64 * 1024 * 1024); }
      const h = JSON.parse(fs.readFileSync(jsonFile, 'utf8')), raw = fs.readFileSync(rawFile);
      if (!names.length) assert.equal((await evaluate('reset', Object.fromEntries(['sessionId', 'incarnation', 'documentId', 'workerEpoch', 'epoch'].map(key => [key, h[key]])))).ok, true);
      assert.equal((await sendFrame('golden-' + name, h, raw)).ok, true);
      const full = Buffer.from(await evaluate('expected')); await assertBoth(full);
      // The recorded capture is an independent engine full composite, not our delta assembly.
      if (h.baseFrameSeq === null) assert.deepEqual(full, raw);
      names.push({ name, payloadBytes: raw.length, frameSeq: h.frameSeq, baseFrameSeq: h.baseFrameSeq });
    }
    report.cases.push({ name: 'recorded real native LiveStroke golden replay over real Electron port (no live native process)', folder, frames: names });
  }
  await evaluate('disposeOwner'); assert.ok((await evaluate('state')).every(s => s.status === 'preparing' && s.visibility === 'hidden'));
  for (const id of ['a', 'b']) await evaluate('dispose', id);
  assert.ok((await evaluate('state')).every(s => s.status === 'disposed' && s.width === 0 && s.height === 0));
  report.cases.push({ name: 'owner disposal conceals both surfaces; binding disposal clears only local bitmap' });
  report.received = (await evaluate('results')).incoming; report.completed = true;
})().catch(error => { report.error = String(error.stack || error); console.error(report.error); }).finally(async () => {
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(report, null, 2));
  mainPort?.close(); if (win && !win.isDestroyed()) win.destroy(); app.exit(report.error ? 1 : 0);
});
