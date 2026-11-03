import { test, expect } from 'vitest';
import { createAssetIntentAdmission } from './assetIntentAdmission';
const hold = () => { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; };
test('late Add required ACK completes before late paint first effect can change its captured asset binding', async () => {
  const admission = createAssetIntentAdmission(), ack = hold(), entered = hold(), events: string[] = [];
  const lease = await admission.beginOperation();
  const add = admission.submit({ workspace: '/A', assetId: 'add', desiredBytes: new Uint8Array([1]) }, async () => {
    events.push('add-effect'); entered.resolve(); await ack.promise; events.push('add-required-ACK');
  });
  const paint = admission.submit({ workspace: '/A', assetId: 'paint', desiredBytes: new Uint8Array([2]) }, async () => { events.push('paint-effect'); events.push('paint-required-ACK'); });
  admission.completeOperation(lease); await entered.promise;
  try { expect(events).toEqual(['add-effect']); } finally { ack.resolve(); await Promise.all([add, paint]); }
  expect(events).toEqual(['add-effect', 'add-required-ACK', 'paint-effect', 'paint-required-ACK']);
  expect(admission.retainedIntents()).toEqual([]);
});
