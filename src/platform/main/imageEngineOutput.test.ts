import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { startImageEngine } from './imageEngineConnection';
import { acquireImageProjectLease } from './imageProjectLease';
import { captureImageEngineOutput } from './imageEngineOutput';
import { openImageProjectStore } from '../../project-files/main/image-engine/projectStore';
import { createNativeSessionAdapter } from '../../project-files/main/image-engine/nativeSessionAdapter';
import { openNativeProjectSession } from '../../session/core/nativeSession';
import type { NativeImageRef, ProjectV2 } from '../contracts/imageProject';

it('captures PSD and layered TIFF from the real frozen Main revision without marking external Save', async () => {
  const binary = process.env.FLOW_IMAGE_HOST, leaseBinary = process.env.FLOW_PROJECT_LEASE_BINARY;
  if (!binary || !leaseBinary) throw Error('Prepare real export-capable host and lease; set FLOW_IMAGE_HOST and FLOW_PROJECT_LEASE_BINARY');
  const root = await temporaryWorkspace('main-engine-output-');
  const lease = await acquireImageProjectLease({ root, binary: leaseBinary });
  const nativeRoot = path.join(root, '.storyboard-flow', 'native-output');
  const connection = startImageEngine({ binary, store: nativeRoot, sessionId: 'output', incarnation: randomUUID(), budgetBytes: 32 << 20 });
  let store: Awaited<ReturnType<typeof openImageProjectStore>> | undefined;
  try {
    await connection.ready;
    const adapter = createNativeSessionAdapter({ connection, storeRoot: nativeRoot, storeId: 'native' });
    const created = (await connection.request('new', { kind: 'new', width: 32, height: 16 })).header.body as any;
    expect(created.kind).toBe('prepared');
    const native: NativeImageRef = { storeId: 'native', documentId: created.receipt.documentId, versionId: created.receipt.versionId,
      manifestSha256: created.receipt.manifestSha256, width: 32, height: 16 };
    await adapter.acceptOpened({ candidateId: 'new', baseVersion: null, native });
    store = await openImageProjectStore({ root, writerAuthority: lease, maxRecoveryBytes: 64 << 20,
      reservedRecoveryBytes: async () => 32 << 20, verifyNative: adapter.verifyNative,
      verifySource: async () => { throw Error('Fixture has no source bindings'); } });
    const project: ProjectV2 = { schema: 'storyboard-flow.project', version: 2, id: 'project', revision: 0, name: 'Output fixture',
      shots: [{ id: 'shot', imageId: 'image', name: 'Shot', scriptText: '' }], parkedShots: [], dialogues: [],
      images: { image: { id: 'image', content: { kind: 'native', native } } } };
    await store.commit(null, { schema: 'flow.project-commit', version: 1, commitId: 'initial', previousCommitHash: null, beforeRevision: null, after: project });
    const session = await openNativeProjectSession({ sessionId: 'main', incarnation: randomUUID(), store, native: adapter.driver, mintId: randomUUID, now: performance.now.bind(performance) });
    await expect(captureImageEngineOutput({ session, connection, imageId: 'image', operationId: 'too-early', format: 'psd' })).rejects.toThrow('frozen');
    expect((await session.request({ kind: 'paint', shotId: 'shot', stroke: { tool: 'brush', color: '#ff0000', size: 6, opacity: 0.5, softness: 0, points: [5, 8, 25, 8] } })).kind).toBe('settled');
    expect((await session.request({ kind: 'freeze' })).kind).toBe('settled');
    const frozen = session.snapshot();
    const head = await fs.readFile(path.join(root, '.storyboard-flow/image-project-v2/head.json'));
    for (const format of ['psd', 'tiff'] as const) {
      const output = await captureImageEngineOutput({ session, connection, imageId: 'image', operationId: `export-${format}`, format });
      expect(output).toMatchObject({ projectId: 'project', revision: 1, imageId: 'image', format, layerCount: 1 });
      expect(output.bytes.length).toBeGreaterThan(32);
      expect(session.snapshot()).toEqual(frozen);
      expect(await fs.readFile(path.join(root, '.storyboard-flow/image-project-v2/head.json'))).toEqual(head);
    }
    await expect(captureImageEngineOutput({ session, connection, imageId: 'image', operationId: 'budget', format: 'psd', maxBytes: 1 })).rejects.toThrow('refused');
    let snapshots = 0;
    const changedSession = { snapshot: () => ++snapshots === 1 ? frozen : { ...frozen, project: { ...frozen.project, revision: 2 } } };
    await expect(captureImageEngineOutput({ session: changedSession, connection, imageId: 'image', operationId: 'stale-project', format: 'psd' })).rejects.toThrow('Project changed');
    const corruptTransport = { ...connection, request: async (...args: Parameters<typeof connection.request>) => {
      const frame = await connection.request(...args);
      const payload = new Uint8Array(frame.payload); payload[payload.length - 1] ^= 1;
      return { ...frame, payload };
    } };
    await expect(captureImageEngineOutput({ session, connection: corruptTransport, imageId: 'image', operationId: 'corrupt-bytes', format: 'psd' })).rejects.toThrow('do not match');
    expect(session.snapshot()).toEqual(frozen);
    expect((await fs.readdir(root)).filter(name => !name.startsWith('.'))).toEqual([]);
    await session.close(); store = undefined;
    expect((await connection.exited).code).toBe(0);
  } finally {
    connection.terminateOwnedProcess(); await connection.exited;
    if (store) await store.close();
    await lease.release();
  }
}, 30000);
