// Real native execution through the chief connection, then a real isolated Electron display.
const { app, BrowserWindow, MessageChannelMain, clipboard, shell, session } = require('electron');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const repo = process.env.FLOW_LIVE_REPO, run = process.env.FLOW_LIVE_RUN, binary = process.env.FLOW_LIVE_HOST;
const temp = fs.realpathSync(require('node:os').tmpdir());
if (!run || path.dirname(run) !== temp || !path.basename(run).startsWith('flow-image-engine-live-') || fs.realpathSync(run) !== run || !path.isAbsolute(repo) || !path.isAbsolute(binary)) throw Error('Owned canonical temp paths and explicit binary required');
for (const key of Object.keys(clipboard)) if (typeof clipboard[key] === 'function') clipboard[key] = () => { throw Error('Clipboard prohibited'); };
shell.trashItem = () => { throw Error('Trash prohibited'); }; shell.openExternal = () => { throw Error('External launch prohibited'); };
app.setPath('userData', path.join(run, 'profile')); app.setPath('sessionData', path.join(run, 'profile')); app.setAppLogsPath(path.join(run, 'profile', 'logs'));
app.commandLine.appendSwitch('disable-background-networking');
// Diagnostic switch affects this isolated process only. Default screenshots remain separately checked.
if (process.env.FLOW_LIVE_FORCE_SRGB === '1') app.commandLine.appendSwitch('force-color-profile', 'srgb');
const { startImageEngine } = require(path.join(run, 'connection.cjs'));
const report = { completed: false, screenReferenceMatches: true, srgbPremixMatches: true, error: null, binary, outputProfileMode: process.env.FLOW_LIVE_FORCE_SRGB === '1' ? 'forced-srgb' : 'default', source: JSON.parse(fs.readFileSync(path.join(run, 'connection-source.json'), 'utf8')),
  versions: process.versions, platform: process.platform, calls: [], frames: [], cases: [], screenshots: [],
  timingMeaning: { nativeRequestRoundTripMs: 'Main request start to decoded native response: includes JSON/binary pipe, queuing and native work; not isolated native CPU time',
    portRoundTripMs: 'Main frame send to renderer installation ACK: includes clone, FrameStore, both Canvas writes and return IPC',
    displayMs: 'Renderer local synchronous FrameStore accept and both Canvas writes, excluding compositor presentation',
    screenshotMs: 'capturePage completion after display ACK and pixel assertions; hidden compositor capture, not input-to-photon latency' } };
let win, port, client, currentVersion = null, identity = null, flat = null, nativeClosed = false;
const acks = new Map(); let portSeq = 0;
const evaluate = (name, ...args) => win.webContents.executeJavaScript(`LiveHarness.${name}(...${JSON.stringify(args)})`);
const identityOf = h => Object.fromEntries(['sessionId', 'incarnation', 'documentId', 'workerEpoch', 'epoch'].map(k => [k, h[k]]));
function post(message) {
  const id = 'display-' + ++portSeq, start = performance.now();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { acks.delete(id); reject(Error('Display ACK timeout ' + id)); }, 8000);
    acks.set(id, data => { clearTimeout(timer); resolve({ ...data, portRoundTripMs: performance.now() - start }); });
    port.postMessage({ ...message, id });
  });
}
function applyReference(h, pixels) {
  if (h.baseFrameSeq === null) flat = Buffer.alloc(h.width * h.height * 4);
  assert.ok(flat && flat.length === h.width * h.height * 4);
  for (const t of h.tiles) for (let y = 0; y < t.h; y++) {
    const source = t.offset + y * t.w * 4, target = ((t.y + y) * h.width + t.x) * 4;
    flat.set(pixels.subarray(source, source + t.w * 4), target);
  }
}
async function assertDisplayed(expected) {
  const rasters = await evaluate('rasters');
  for (const raster of rasters) {
    assert.equal(raster.status, 'ready'); assert.equal(raster.rgba.length, expected.length);
    assert.equal(Buffer.compare(Buffer.from(raster.rgba), expected), 0, 'actual Canvas pixels differ from native composite on ' + raster.id);
  }
  return rasters;
}
async function display(label, h, payload) {
  const next = identityOf(h);
  if (!identity) { assert.equal((await post({ kind: 'initialize', identity: next })).result.ok, true); }
  else if (JSON.stringify(next) !== JSON.stringify(identity)) assert.equal((await post({ kind: 'reset', identity: next })).result.ok, true);
  identity = next;
  // Exact-owned bytes; the chief decoder already creates an exact payload, but no Buffer assumption is made here.
  const ack = await post({ kind: 'frame', header: h, pixels: Uint8Array.from(payload) });
  assert.equal(ack.result.ok, true, JSON.stringify(ack)); assert.equal(ack.byteLength, payload.length);
  applyReference(h, payload); await assertDisplayed(flat);
  const file = path.join(run, 'frames', String(report.frames.length + 1).padStart(2, '0') + '-' + label);
  fs.writeFileSync(file + '.json', JSON.stringify(h, null, 2)); fs.writeFileSync(file + '.rgba', payload);
  report.frames.push({ label, frameSeq: h.frameSeq, baseFrameSeq: h.baseFrameSeq, epoch: h.epoch, inputThrough: h.inputThrough,
    imageVersionRef: h.imageVersionRef, previewId: h.previewId, payloadBytes: payload.length, portRoundTripMs: ack.portRoundTripMs, displayMs: ack.displayMs });
}
async function call(operationId, body, payload) {
  const start = performance.now(); const response = await client.request(operationId, body, currentVersion, payload);
  const nativeRequestRoundTripMs = performance.now() - start, reply = response.header.body;
  report.calls.push({ operationId, command: body.kind, reply: reply?.kind, nativeRequestRoundTripMs });
  assert.notEqual(reply?.kind, 'failure', JSON.stringify(reply)); assert.ok(reply?.kind, 'missing native reply kind');
  if (reply.kind === 'frame') await display(operationId, reply.frame, response.payload);
  return { reply, payload: response.payload };
}
async function accept(operationId, candidateId) {
  const { reply } = await call(operationId, { kind: 'accept', candidateId }); assert.equal(reply.kind, 'accepted');
  currentVersion = reply.receipt.versionId; return currentVersion;
}
async function screenshot(label, expectedAtSamples) {
  const rasters = await assertDisplayed(flat), start = performance.now();
  const png = (await win.webContents.capturePage(undefined, { stayHidden: true })).toPNG(), screenshotMs = performance.now() - start;
  fs.writeFileSync(path.join(run, label + '.png'), png);
  const sharp = (await import(pathToFileURL(path.join(repo, 'node_modules/sharp/lib/index.js')).href)).default;
  const metadata = await sharp(png).metadata(), profile = {};
  if (metadata.icc) {
    const icc = metadata.icc; profile.sha256 = crypto.createHash('sha256').update(icc).digest('hex');
    for (let i = 0; i < icc.readUInt32BE(128); i++) { const pos = 132 + i * 12, tag = icc.toString('ascii', pos, pos + 4), offset = icc.readUInt32BE(pos + 4);
      if (['rXYZ', 'gXYZ', 'bXYZ'].includes(tag)) profile[tag] = [8, 12, 16].map(n => icc.readInt32BE(offset + n) / 65536);
    }
  }
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const scale = info.width / await win.webContents.executeJavaScript('innerWidth'), samples = [], cssReferences = [];
  for (const [name, x] of [['css-alpha', 30], ['css-opaque', 90]]) { const px = Math.floor(x * scale), py = Math.floor(190 * scale);
    cssReferences.push({ name, actual: Array.from(data.subarray((py * info.width + px) * 4, (py * info.width + px) * 4 + 3)) });
  }
  const cssAlpha = cssReferences.find(s => s.name === 'css-alpha').actual;
  const cssOpaque = cssReferences.find(s => s.name === 'css-opaque').actual;
  // Positive control: an explicit opaque sRGB color must decode to its declared codes.
  cssOpaque.forEach((value, channel) => assert.ok(Math.abs(value - [255, 128, 128][channel]) <= 1, 'opaque CSS reference conversion'));

  for (const r of rasters) for (const sample of expectedAtSamples) {
    const x = Math.floor((r.rect.x + (sample.x + .5) * r.rect.width / r.width) * scale), y = Math.floor((r.rect.y + (sample.y + .5) * r.rect.height / r.height) * scale);
    const actual = Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3));
    const premixMatches = actual.every((v, channel) => Math.abs(v - sample.rgb[channel]) <= 1);
    if (!premixMatches) report.srgbPremixMatches = false;
    const expected = sample.reference === 'css-alpha' ? cssAlpha : sample.rgb;
    const matches = actual.every((v, channel) => Math.abs(v - expected[channel]) <= 1);
    if (!matches) report.screenReferenceMatches = false;
    samples.push({ surface: r.id, point: [sample.x, sample.y], actual, expected, reference: sample.reference ?? 'opaque-white',
      matches, srgbArithmeticPremix: sample.rgb, premixMatches });
  }
  report.screenshots.push({ label, screenshotMs, scale, samples, profile, cssReferences });
}
(async () => {
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win = new BrowserWindow({ show: false, width: 520, height: 260, webPreferences: { preload: path.join(run, 'preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); win.webContents.on('will-navigate', e => e.preventDefault());
  await win.loadFile(path.join(run, 'index.html')); await evaluate('ready', 'owned-live-port');
  const channel = new MessageChannelMain(); port = channel.port1;
  const ready = new Promise(resolve => port.on('message', ({ data }) => {
    if (data.kind === 'ready') resolve(data);
    const finish = acks.get(data.id); if (finish) { acks.delete(data.id); finish(data); }
  }));
  port.start(); win.webContents.postMessage('live-port', { nonce: 'owned-live-port' }, [channel.port2]);
  await Promise.race([ready, new Promise((_, reject) => setTimeout(() => reject(Error('Live port startup timeout')), 8000))]);
  client = startImageEngine({ binary, store: path.join(run, 'native-store'), sessionId: 'live-synthetic', incarnation: 'live-electron-one', budgetBytes: 32 * 1024 * 1024 });
  report.nativePid = client.pid; report.workerEpoch = await client.ready;
  const sharp = (await import(pathToFileURL(path.join(repo, 'node_modules/sharp/lib/index.js')).href)).default;
  const png = await sharp({ create: { width: 128, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  fs.writeFileSync(path.join(run, 'synthetic-source.png'), png);
  const digest = crypto.createHash('sha256').update(png).digest('hex');
  assert.equal((await call('open', { kind: 'open', source: { digest, byteLength: png.length, formatHint: 'png' } }, png)).reply.kind, 'prepared');
  const blankVersion = await accept('accept-open', 'open');
  await call('capture-blank', { kind: 'capture' }); const blank = Buffer.from(flat); assert.ok(blank.every(v => v === 0));

  const brush = { size: 12, opacity: .5, hardness: 1, spacing: .1, seed: 19, color: '#ff0000', erase: false };
  await call('pen-begin', { kind: 'strokeBegin', previewId: 'pen', brush, points: [{ x: 20, y: 30, pressure: 1 }] });
  await call('pen-append', { kind: 'strokeAppend', previewId: 'pen', fromSeq: 2, points: [{ x: 110, y: 30, pressure: 1 }, { x: 20, y: 30, pressure: 1 }] });
  await call('capture-pen-preview', { kind: 'capture' }); const paintedPreview = Buffer.from(flat);
  const alpha = (buffer, x, y) => buffer[(y * 128 + x) * 4 + 3];
  assert.deepEqual(Array.from(paintedPreview.subarray((30 * 128 + 65) * 4, (30 * 128 + 65) * 4 + 3)), [255, 0, 0], 'native center RGBA matches independent CSS source');
  const centreAlpha = alpha(paintedPreview, 65, 30); assert.ok(centreAlpha >= 127 && centreAlpha <= 128);
  let maximumAlpha = 0; for (let i = 3; i < paintedPreview.length; i += 4) maximumAlpha = Math.max(maximumAlpha, paintedPreview[i]); assert.ok(maximumAlpha <= 128, 'one half-opacity stroke never compounds above its cap');
  assert.equal((await call('pen-finish', { kind: 'strokeFinish', previewId: 'pen', throughSeq: 3 })).reply.fromLive, true);
  const paintedVersion = await accept('accept-pen', 'pen-finish'); await call('capture-pen-accepted', { kind: 'capture' });
  assert.equal(Buffer.compare(flat, paintedPreview), 0, 'accepted paint differs from real LiveStroke preview');
  const pink = [255, 255 - centreAlpha, 255 - centreAlpha];
  await win.webContents.executeJavaScript(`document.getElementById('css-alpha').style.backgroundColor='rgba(255,0,0,${centreAlpha / 255})';document.getElementById('css-opaque').style.backgroundColor='rgb(${pink.join(',')})';`);
  await screenshot('half-opacity-pen', [{ x: 65, y: 30, rgb: pink, reference: 'css-alpha' }, { x: 10, y: 10, rgb: [255, 255, 255] }]);
  report.cases.push({ name: 'native half-opacity out-and-back stroke; real preview adopted without rerender', centreAlpha, maximumAlpha, paintedVersion });

  await call('eraser-begin', { kind: 'strokeBegin', previewId: 'eraser', brush: { ...brush, size: 8, opacity: 1, erase: true }, points: [{ x: 65, y: 30, pressure: 1 }] });
  await call('eraser-append', { kind: 'strokeAppend', previewId: 'eraser', fromSeq: 2, points: [{ x: 66, y: 30, pressure: 1 }] });
  await call('capture-eraser-preview', { kind: 'capture' }); const erasedPreview = Buffer.from(flat);
  assert.equal(alpha(erasedPreview, 65, 30), 0); assert.equal(alpha(erasedPreview, 35, 30), centreAlpha);
  assert.equal((await call('eraser-finish', { kind: 'strokeFinish', previewId: 'eraser', throughSeq: 2 })).reply.fromLive, true);
  const erasedVersion = await accept('accept-eraser', 'eraser-finish'); await call('capture-eraser-accepted', { kind: 'capture' });
  assert.equal(Buffer.compare(flat, erasedPreview), 0, 'accepted eraser differs from live preview');
  await screenshot('eraser-hole', [{ x: 65, y: 30, rgb: [255, 255, 255] }, { x: 35, y: 30, rgb: pink, reference: 'css-alpha' }]);
  report.cases.push({ name: 'native eraser absolute alpha-zero patch; neighbouring half-opacity ink preserved', erasedVersion });

  assert.equal((await call('undo-eraser', { kind: 'install', versionId: paintedVersion })).reply.kind, 'installed'); currentVersion = paintedVersion;
  await call('capture-undo-eraser', { kind: 'capture' }); assert.equal(Buffer.compare(flat, paintedPreview), 0);
  await screenshot('undo-eraser', [{ x: 65, y: 30, rgb: pink, reference: 'css-alpha' }]);
  assert.equal((await call('redo-eraser', { kind: 'install', versionId: erasedVersion })).reply.kind, 'installed'); currentVersion = erasedVersion;
  await call('capture-redo-eraser', { kind: 'capture' }); assert.equal(Buffer.compare(flat, erasedPreview), 0);
  await screenshot('redo-eraser', [{ x: 65, y: 30, rgb: [255, 255, 255] }]);
  assert.equal((await call('undo-to-blank', { kind: 'install', versionId: blankVersion })).reply.kind, 'installed'); currentVersion = blankVersion;
  await call('capture-undo-blank', { kind: 'capture' }); assert.equal(Buffer.compare(flat, blank), 0);
  report.cases.push({ name: 'native immutable version install for undo/redo, explicit display epoch barriers', versions: [blankVersion, paintedVersion, erasedVersion] });
  assert.ok(report.frames.some(f => f.baseFrameSeq !== null && f.payloadBytes < 128 * 64 * 4), 'real native partial dirty frames traversed the whole chain');
  assert.equal((await call('freeze', { kind: 'freeze' })).reply.kind, 'frozen'); assert.equal((await call('close', { kind: 'close' })).reply.kind, 'closed');
  const exit = await client.exited; assert.equal(exit.code, 0); nativeClosed = true; report.nativeExit = exit;
  report.nativeDiagnostics = client.diagnostics();
  report.screenshotOracle = {
    assumptionRefuted: 'Straight sRGB alpha arithmetic over white was initially assumed numerically equal to capturePage output. Default P3 capture contradicts that assumption.',
    independentReference: 'Canvas screenshot samples are compared with a separate CSS rgba element of the same source RGBA over the same white background, within 1 code value; opaque CSS premix remains a separate positive control.',
    boundary: 'Passing native bytes and CSS-reference display does not assert equality to an opaque sRGB premix, calibrated physical monitor accuracy, or input-to-photon timing.',
    initialFailurePreserved: 'e4vk94 and YWd8Mq; P3/CSS diagnostic GHq4V8; isolated force-sRGB comparison K8wg8V did not change the capture profile or values.'
  };
  await evaluate('dispose'); report.completed = true;
})().catch(error => { report.error = String(error.stack || error); console.error(report.error); }).finally(async () => {
  if (client && !nativeClosed) { client.terminateOwnedProcess(); report.nativeExit = await client.exited; report.nativeDiagnostics = client.diagnostics(); }
  fs.writeFileSync(path.join(run, 'result.json'), JSON.stringify(report, null, 2));
  port?.close(); if (win && !win.isDestroyed()) win.destroy(); app.exit(report.error ? 1 : 0);
});
