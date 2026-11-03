import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const methods = { open: 'open', read: 'read', put: 'put', refresh: 'refresh', folderStatus: 'folderStatus', saveTiff: 'saveTiff', checkpoint: 'checkpoint', switchProject: 'switch-project', finishClose: 'finish-close' };
/** Execute only the trusted preload with an isolated Electron stub; no real IPC. */
export function checkFlowPreload(source, contract) {
  let api; const calls = [], listeners = new Map();
  vm.runInNewContext(source, { require(name) {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld(key, value) { assert.equal(key, 'flowEditor'); assert.equal(api, undefined); api = value; } },
      ipcRenderer: { invoke(...args) { calls.push(args); return Promise.resolve(); }, on(channel, handler) { listeners.set(channel, handler); }, removeListener(channel, handler) { assert.equal(listeners.get(channel), handler); listeners.delete(channel); } } };
  } });
  const expected = [...Object.keys(methods), 'onClose'].sort();
  assert.deepEqual(Object.keys(api).sort(), expected);
  const typed = [...contract.matchAll(/^  (\w+)\(/gm)].map(match => match[1]).sort();
  assert.deepEqual(typed, expected);
  for (const [method, channel] of Object.entries(methods)) {
    const args = method === 'open' ? [] : method === 'read' || method === 'put' || method === 'folderStatus' || method === 'refresh' || method === 'saveTiff' || method === 'checkpoint' ? ['session', { test: true }] : ['session', { test: true }, 'option'];
    api[method](...args); assert.deepEqual(calls.pop(), ['flow-editor:' + channel, ...args]);
  }
  let received; const dispose = api.onClose(id => { received = id; });
  listeners.get('flow-editor:close')({ untrustedEvent: true }, 'close-id');
  assert.equal(received, 'close-id'); dispose(); assert.equal(listeners.size, 0);
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
