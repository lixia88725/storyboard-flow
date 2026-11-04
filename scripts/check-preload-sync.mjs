import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const methods = { open: 'open', read: 'read', put: 'put', refresh: 'refresh', folderStatus: 'folderStatus', outputNames: 'outputNames', saveTiff: 'saveTiff', checkpoint: 'checkpoint', switchProject: 'switch-project', finishClose: 'finish-close',
  launcherState: 'launcher-state', updateRecentName: 'update-recent-name', launch: 'launch', createDraft: 'create-draft', createChooseSource: 'create-choose-source', createChooseDestination: 'create-choose-destination',
  createUpdate: 'create-update', createAbort: 'create-abort', createDiscard: 'create-discard', respondCreateIssues: 'create-issues-response' };
const listeners = { onClose: 'close', onCreateProgress: 'create-progress', onCreateIssues: 'create-issues' };
const payloads = { onClose: 'close-id', onCreateProgress: { draftId: 'draft', done: 1, total: 2 }, onCreateIssues: { requestId: 'request', draftId: 'draft', issues: [] } };
const argsFor = method => {
  if (method === 'open' || method === 'launcherState' || method === 'createDraft') return [];
  if (method === 'launch') return [{ test: true }];
  if (method === 'updateRecentName') return ['session', 'name'];
  if (method === 'switchProject') return ['session', { test: true }, { test: true }];
  if (method === 'finishClose') return ['session', { test: true }, 'option'];
  if (method === 'createChooseSource') return ['draft', 'files'];
  if (method === 'createUpdate') return ['draft', { test: true }];
  if (method === 'respondCreateIssues') return ['request', 'continue'];
  if (method === 'createAbort' || method === 'createDiscard' || method === 'createChooseDestination') return ['draft'];
  return ['session', { test: true }];
};
/** Execute only the trusted preload with an isolated Electron stub; no real IPC. */
export function checkFlowPreload(source, contract) {
  let api; const calls = [], listenersSeen = new Map();
  vm.runInNewContext(source, { require(name) {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld(key, value) { assert.equal(key, 'flowEditor'); assert.equal(api, undefined); api = value; } },
      ipcRenderer: { invoke(...args) { calls.push(args); return Promise.resolve(); }, on(channel, handler) { listenersSeen.set(channel, handler); }, removeListener(channel, handler) { assert.equal(listenersSeen.get(channel), handler); listenersSeen.delete(channel); } } };
  } });
  const expected = [...Object.keys(methods), ...Object.keys(listeners)].sort();
  assert.deepEqual(Object.keys(api).sort(), expected);
  const typed = [...contract.matchAll(/^  (\w+)\(/gm)].map(match => match[1]).sort();
  assert.deepEqual(typed, expected);
  for (const [method, channel] of Object.entries(methods)) {
    const args = argsFor(method);
    api[method](...args); assert.deepEqual(calls.pop(), ['flow-editor:' + channel, ...args]);
  }
  for (const [method, channel] of Object.entries(listeners)) {
    let received;
    const dispose = api[method](payload => { received = payload; });
    listenersSeen.get('flow-editor:' + channel)({ untrustedEvent: true }, payloads[method]);
    assert.deepEqual(received, payloads[method]);
    dispose();
  }
  assert.equal(listenersSeen.size, 0);
}
export async function checkPreloadSync(root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')) {
  const [source, contract, globals] = await Promise.all(['src/platform/preload/flowEditor.cjs', 'src/platform/contracts/flowEditor.ts', 'src/workbench/renderer/global.d.ts'].map(file => readFile(path.join(root, file), 'utf8')));
  checkFlowPreload(source, contract);
  assert.match(globals, /flowEditor[?]?:/);
  assert.match(globals, /FlowEditorBridge/);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await checkPreloadSync(); console.log('Flow preload contract verified');
}
