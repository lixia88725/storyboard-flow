import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { createWorkspaceRecoveryStore } from './workspaceRecoveryStore';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4zyD3HwAFPAIdh7bqkQAAAABJRU5ErkJggg==', 'base64');
const budget = { bytes: 100000, records: 100, assets: 10, jsonDepth: 20 };
const caller = { sender: {}, frame: {}, window: {}, document: {} };
// Schema/ordering seam only. Synthetic authorization does not prove native policy.
const authorize = async () => {};
const offer = (revision: string) => ({ revision, projectRaw: { text: revision }, viewState: {}, scriptState: {}, effectFacts: [], continuationState: {},
  assets: [{ assetId: 'pixels', bytes: png, role: 'desired', width: 1, height: 1, encoding: 'png' }], requiredAssetIds: ['pixels'] });

test('inspection binds its seal digest to the exact seal whose content association was validated', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-seal-read-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const first = await createWorkspaceRecoveryStore({ authorize, budget }).retain(caller, root, offer('first'));
  const sealPath = path.join(root, '.storyboard-workbench/workspace-recovery-v1/operations', first.operationId, 'generations', first.generationId, 'sealed.json');
  const verifiedBytes = await fs.readFile(sealPath);
  const expectedDigest = createHash('sha256').update(verifiedBytes).digest('hex');
  let reads = 0;
  // Controlled in-process fixture fault at the existing authorization port.
  // No competing external process or production namespace is used.
  const faulted = createWorkspaceRecoveryStore({ budget, authorize: async request => {
    if (request.path === sealPath && request.phase === 'readback' && ++reads === 2) {
      const invalid = { ...JSON.parse(verifiedBytes.toString('utf8')), contentDigest: '0'.repeat(64) };
      await fs.writeFile(sealPath, JSON.stringify(invalid));
    }
  } });
  const state = await faulted.inspectReadonly(root);
  if (state.state === 'protectedReadable') expect(state.ack?.sealDigest).toBe(expectedDigest);
  else expect(state.state).toBe('protectedUninspectable');
});

for (const corruption of ['false', 'zero', 'empty-string', 'extra-field'] as const) {
  test(`cold inspection rejects ${corruption} parent instead of normalizing disk data into a valid chain`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'recovery-parent-schema-'));
    await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
    const store = createWorkspaceRecoveryStore({ authorize, budget });
    let ack = await store.retain(caller, root, offer('first'));
    if (corruption === 'extra-field') ack = await store.retain(caller, root, offer('second'));
    const dir = path.join(root, '.storyboard-workbench/workspace-recovery-v1/operations', ack.operationId, 'generations', ack.generationId);
    const contentPath = path.join(dir, 'content.json'), sealPath = path.join(dir, 'sealed.json');
    const content = JSON.parse(await fs.readFile(contentPath, 'utf8'));
    content.parent = corruption === 'false' ? false : corruption === 'zero' ? 0 : corruption === 'empty-string' ? '' : { ...content.parent, unrecognized: 'must refuse' };
    const bytes = Buffer.from(JSON.stringify(content));
    const seal = JSON.parse(await fs.readFile(sealPath, 'utf8'));
    seal.contentDigest = createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(contentPath, bytes);
    await fs.writeFile(sealPath, JSON.stringify(seal));
    const cold = await createWorkspaceRecoveryStore({ authorize, budget }).inspectReadonly(root);
    expect(cold.state).toBe('protectedUninspectable');
    expect(await fs.readFile(contentPath)).toEqual(bytes);
  });
}
