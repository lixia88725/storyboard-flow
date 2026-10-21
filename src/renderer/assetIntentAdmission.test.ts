import { test, expect } from 'vitest';
import { createBitmapLayerWriteQueue } from './bitmapLayerWriteQueue';
import { createAssetIntentAdmission } from './assetIntentAdmission';
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { resolve, promise }; };

test('inflight Save finishes on the actual queue before delayed P2 asset effect and publication', async () => {
  const queue = createBitmapLayerWriteQueue();
  const admission = createAssetIntentAdmission();
  const events: string[] = []; const final = deferred(); const saving = deferred();
  const lease = await admission.beginOperation();
  const save = queue.runExclusive(async () => { events.push('save'); saving.resolve(); await final.promise; events.push('bound-persist-completed'); });
  await saving.promise;
  const pixels = new Uint8Array([255, 0, 30, 255]);
  const pending = admission.submit({ workspace: 'A', assetId: 'paint', desiredBytes: pixels }, async retained => queue.enqueue('A/layer.png', async () => { events.push('asset-write'); expect([...retained.desiredBytes]).toEqual([255, 0, 30, 255]); events.push('descriptor-publication'); }));
  pixels.fill(0);
  await Promise.resolve();
  expect(admission.retainedIntents()).toHaveLength(1);
  expect(events).toEqual(['save']);
  final.resolve(); await save;
  admission.completeOperation(lease);
  await pending;
  expect(events).toEqual(['save', 'bound-persist-completed', 'asset-write', 'descriptor-publication']);
  expect(admission.retainedIntents()).toHaveLength(0);
});

test('g1 freeze waits admitted asset and its required ACK, not intents that arrive after the freeze', async () => {
  const admission = createAssetIntentAdmission(), queue = createBitmapLayerWriteQueue();
  const entered = deferred(), ack = deferred(); const events: string[] = [];
  const producer = admission.submit({ workspace: 'A', assetId: 'old', desiredBytes: new Uint8Array([1]) }, async () => queue.enqueue('old', async () => { events.push('first-effect'); entered.resolve(); await ack.promise; events.push('required-ACK'); }));
  await entered.promise;
  let prepared = false; const preparing = admission.beginOperation().then(lease => { prepared = true; return lease; });
  const later = admission.submit({ workspace: 'A', assetId: 'new', desiredBytes: new Uint8Array([2]) }, async () => { events.push('new-effect'); });
  await Promise.resolve(); expect(prepared).toBe(false); expect(events).toEqual(['first-effect']);
  ack.resolve(); await producer;
  const lease = await preparing; expect(events).toEqual(['first-effect', 'required-ACK']);
  admission.completeOperation(lease); await later;
  expect(events).toEqual(['first-effect', 'required-ACK', 'new-effect']);
});

test('unknown operation retains exact desired bytes and forbids retry/ordinary clear/replay', async () => {
  const admission = createAssetIntentAdmission(); const lease = await admission.beginOperation(); let effects = 0;
  const desired = new Uint8Array([5, 6, 7]);
  const deferredIntent = admission.submit({ workspace: 'A', assetId: 'draft', desiredBytes: desired }, async () => { effects++; });
  const outcome = deferredIntent.catch(error => error.message);
  desired.fill(0);
  expect(() => admission.completeOperation({ identity: {} })).toThrow('Wrong/stale');
  admission.failOperation(lease, new Error('unknown effect'));
  expect(await outcome).toContain('retained'); expect(effects).toBe(0);
  const content = admission.retainedIntents(); expect([...content[0].desiredBytes]).toEqual([5, 6, 7]);
  content[0].desiredBytes.fill(0); expect([...admission.retainedIntents()[0].desiredBytes]).toEqual([5, 6, 7]);
  expect(() => admission.completeOperation(lease)).toThrow('cannot be cleared');
  await expect(admission.beginOperation()).rejects.toThrow('frozen/protected');
});

test('failed admitted producer settles and its unique desired bytes remain protected', async () => {
  const admission = createAssetIntentAdmission(); const entered = deferred(), fail = deferred();
  const producer = admission.submit({ workspace: 'A', assetId: 'failed', desiredBytes: new Uint8Array([90]) }, async () => { entered.resolve(); await fail.promise; throw new Error('producer write unknown'); });
  const outcome = producer.catch(error => error.message); await entered.promise;
  const prepare = admission.beginOperation().catch(error => error.message); fail.resolve();
  expect(await outcome).toBe('producer write unknown'); expect(await prepare).toContain('fully settle');
  expect(admission.retainedIntents().map(intent => [...intent.desiredBytes])).toEqual([[90]]);
});
