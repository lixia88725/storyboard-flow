import { test, expect } from 'vitest';
import { createAppRootActor, appCallerAdapterScope } from './appCallerAdapterScope';
import { createProject } from '../shared/projectOps';
import { createBitmapLayerWriteQueue } from './bitmapLayerWriteQueue';
import type { WorkspaceSlot } from './workspaceSlots';

test('App open error uses status, not Save failure; inactive B cannot overwrite published C', async () => {
  const errors: unknown[] = [], statuses: string[] = [], ref = { current: createProject('healthy A') };
  const queue = createBitmapLayerWriteQueue();
  const adapter = await createAppRootActor({
    projectRef: ref, setProject: () => {}, queue, freshToken: () => 'token',
    paths: () => ({ folderPath: '/B', metadataPath: '/B/p.json' }),
    api: () => ({ readOutputIdentity: async () => '0'.repeat(64),
      autosaveWorkspace: async () => { throw Error('late B error'); }, saveWorkspace: async () => { throw Error('unused'); } }),
    onSave: () => {}, onError: e => errors.push(e)
  }, { observeWorkspace: async folderPath => ({ binding: folderPath, folderPath, metadataPath: folderPath + '/p.json' }),
    setStatus: status => statuses.push(status) });
  const { workspaceSlotsRef } = appCallerAdapterScope({ renderAdapter: adapter }), slots = workspaceSlotsRef.current;
  const original = slots.active, cause = new Error('Pending recovery and preview initialization require separate admission');
  let b!: WorkspaceSlot;
  await expect(slots.requestOpen('/B', async (slot: WorkspaceSlot) => {
    b = slot; await slot.adapter.load(async () => { throw cause; }, () => {}); return undefined;
  })).rejects.toBe(cause);
  expect(errors).toEqual([]);
  expect(statuses).toEqual(['Could not open folder: ' + cause.message]);
  expect(slots.active).toBe(original); expect(ref.current.name).toBe('healthy A'); expect(original.readonly).toBe(false);
  await slots.requestOpen('/C', async (slot: WorkspaceSlot) => {
    let scan: import('../shared/types').FolderScanPayload | undefined;
    const accepted = await slot.adapter.load(async () => ({ folderPath: '/C', metadataPath: '/C/p.json', folderName: 'C', images: [], project: createProject('C') }), s => { scan = s; });
    return accepted ? scan : undefined;
  });
  const c = slots.active, before = c.adapter.owner.captureRecoveryContent();
  expect(await b.adapter.autosave(b.projectRef.current)).toBe(false);
  expect(errors).toEqual([]); expect(statuses).toHaveLength(1); expect(slots.active).toBe(c);
  expect(c.adapter.owner.captureRecoveryContent()).toEqual(before); await queue.drain();
});
