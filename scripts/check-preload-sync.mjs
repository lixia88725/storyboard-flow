import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const methods = { upgradeChooseDestination:'upgrade-choose-destination',upgradeUpdate:'upgrade-update',upgradeDiscard:'upgrade-discard', finishNativeClose: 'finish-native-close', open: 'open', read: 'read', put: 'put', refresh: 'refresh', folderStatus: 'folderStatus', outputNames: 'outputNames', saveTiff: 'saveTiff', exportPsd: 'export-psd', checkpoint: 'checkpoint', switchProject: 'switch-project', finishClose: 'finish-close',
  launcherState: 'launcher-state', updateRecentName: 'update-recent-name', removeRecent: 'remove-recent', relocateRecent: 'relocate-recent', launch: 'launch', chooseOpen: 'choose-open', createDraft: 'create-draft', createChooseSource: 'create-choose-source', createChooseDestination: 'create-choose-destination',
  createUpdate: 'create-update', createAbort: 'create-abort', createDiscard: 'create-discard', respondCreateIssues: 'create-issues-response',
  pendingCapability: 'pending-capability', pendingAdd: 'pending-add', cancelPendingAdd: 'pending-cancel', respondPendingIssues: 'pending-issues-response' };
const listeners = { onClose: 'close', onCreateProgress: 'create-progress', onCreateIssues: 'create-issues', onPendingProgress: 'pending-progress', onPendingIssues: 'pending-issues' };
const payloads = { onClose: 'close-id', onCreateProgress: { draftId: 'draft', done: 1, total: 2 }, onCreateIssues: { requestId: 'request', draftId: 'draft', issues: [] },
  onPendingProgress: { operationId: 'operation', done: 1, total: 2 }, onPendingIssues: { requestId: 'request', operationId: 'operation', issues: [] } };
const argsFor = method => {
  if (method === 'open' || method === 'launcherState' || method === 'chooseOpen' || method === 'pendingCapability') return [];
  if (method === 'createDraft') return ['blank'];
  if (method === 'launch') return [{ test: true }];
  if (method === 'updateRecentName') return ['session', 'name'];
  if (method === 'removeRecent' || method === 'relocateRecent') return ['recent'];
  if (method === 'exportPsd') return ['session', { test: true }, 'shot'];
  if (method === 'switchProject') return ['session', { test: true }, { test: true }];
  if (method === 'finishNativeClose') return [{sessionId:'s',incarnation:'i',workspaceEpoch:1},'close','ticket'];
  if (method === 'finishClose') return ['session', { test: true }, 'option'];
  if (method === 'createChooseSource') return ['draft', 'files'];
  if (method === 'createUpdate' || method === 'upgradeUpdate') return ['draft', { test: true }];
  if (method === 'respondCreateIssues' || method === 'respondPendingIssues') return ['request', 'continue'];
  if (method === 'upgradeChooseDestination' || method === 'upgradeDiscard' || method === 'createAbort' || method === 'createDiscard' || method === 'createChooseDestination') return ['draft'];
  if (method === 'pendingAdd') return ['session', { test: true }, { test: true }];
  if (method === 'cancelPendingAdd') return ['session', 'operation'];
  return ['session', { test: true }];
};
/** Execute only the trusted preload with an isolated Electron stub; no real IPC. */
export function checkFlowPreload(source, contract) {
  let api; const calls = [], transfers = [], listenersSeen = new Map();
  vm.runInNewContext(source, { window: {postMessage(...args){transfers.push(args);}}, require(name) {
    assert.equal(name, 'electron');
    return { contextBridge: { exposeInMainWorld(key, value) { assert.equal(key, 'flowEditor'); assert.equal(api, undefined); api = value; } },
      ipcRenderer: { invoke(...args) { calls.push(args); return Promise.resolve(); }, on(channel, handler) { listenersSeen.set(channel, handler); }, removeListener(channel, handler) { assert.equal(listenersSeen.get(channel), handler); listenersSeen.delete(channel); } } };
  } });
  const expected = [...Object.keys(methods), ...Object.keys(listeners)].sort();
  assert.deepEqual(Object.keys(api).sort(), [...expected, 'imageWorkspace'].sort());
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
  const native=api.imageWorkspace;
  assert.deepEqual(Object.keys(native).sort(), ['bootstrap','request','input','waitOperation','thumbnail','subscribe','connectFrames'].sort());
  const owner={sessionId:'s',incarnation:'i',workspaceEpoch:1};
  for(const [method,channel,args] of [['bootstrap','bootstrap',[]],['request','request',[{owner,requestId:'r',command:{kind:'undo'}}]],['input','input',[owner,{kind:'end',operationId:'op',throughSeq:2},{captureId:'capture',inputId:'input',attemptId:'attempt'}]],['waitOperation','wait',[owner,'op']],['thumbnail','thumbnail',[owner,'thumb']]]){
    native[method](...args);assert.deepEqual(calls.pop(), ['flow-image-workspace:'+channel,...args]);
  }
  let nativeEvent;
  const off=native.subscribe(value=>nativeEvent=value);
  listenersSeen.get('flow-image-workspace:event')({untrustedEvent:true},{kind:'snapshot',value:1});
  assert.deepEqual(nativeEvent,{kind:'snapshot',value:1});off();
  const identity={owner,nonce:'nonce',streamGeneration:1};
  native.connectFrames(identity);assert.deepEqual(calls.pop(),['flow-image-workspace:connect',identity]);
  const port={synthetic:true};const handler=listenersSeen.get('flow-image-workspace:port');
  handler({ports:[port]},{...identity,nonce:'old'});assert.equal(transfers.length,0);
  handler({ports:[port]},identity);assert.equal(transfers.length,1);
  const [message,target,ports]=transfers[0];
  assert.equal(message.type,'flow-image-workspace:port');assert.equal(message.identity,identity);assert.equal(target,'*');assert.equal(ports[0],port);
  assert.equal(listenersSeen.size,0);
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
