import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { copyLayerPng, mergeVisibleLayers, writeLayerPng } from './layerAssetService';
import { serializeStoryboardScriptMarkdown } from './storyboardScript';

const options = { budget: { bytes: 16 * 1024 * 1024, records: 2000, assets: 64, jsonDepth: 80 }, python: 'python3', script: path.resolve('scripts/recovery-content-permissions.py') };
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// A scoped external native-process adapter faults only final staging unlink.
// The candidate native writer's inspections, PNG bytes and link publication run.
async function finalUnlinkFault<T>(root: string, run: () => Promise<T>) {
  const shim = path.join(root, 'native-cleanup-adapter');
  await fs.writeFile(shim, `#!/usr/bin/env ${options.python}\nimport sys,importlib.util,json,base64,os\nspec=importlib.util.spec_from_file_location('writer',sys.argv[3]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)\noriginal=m.os.unlink\ndef fault(p,*a,**k):\n if os.path.basename(p).startswith('.layer-staging-'): raise PermissionError('ordinary fixture final owned-staging unlink denied')\n return original(p,*a,**k)\nm.os.unlink=fault\nr=json.load(sys.stdin)\nprint(json.dumps(m.protected_write(r['root'],r['filePath'],base64.b64decode(r['bytes']),r['mode'])))\n`, { mode: 0o700 });
  const old = process.env.SWB_PYTHON_BIN;
  process.env.SWB_PYTHON_BIN = shim;
  try { return await run(); }
  finally { if (old === undefined) delete process.env.SWB_PYTHON_BIN; else process.env.SWB_PYTHON_BIN = old; }
}

for (const producer of ['writePng', 'copyPng', 'mergeVisible'] as const) {
  test(`ordinary ${producer} unminted target committed-cleanup failure retains real B without ordinary custody or ACK`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ordinary-commit-' + producer + '-'));
    const paths = ['.storyboard-workbench/layers/s/a.png', '.storyboard-workbench/layers/s/b.png'];
    const targetPath = '.storyboard-workbench/layers/s/new.png', target = path.join(root, targetPath);
    const red = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'red' } }).png().toBuffer();
    const blue = await sharp({ create: { width: 2, height: 2, channels: 4, background: 'blue' } }).png().toBuffer();
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    for (const p of paths) await fs.writeFile(path.join(root, p), blue, { mode: 0o600 });
    const tiff = await sharp(red).tiff().toBuffer();
    await fs.writeFile(path.join(root, 's.tiff'), tiff, { mode: 0o600 });
    const project: any = { id: 'p', name: 'ordinary', shots: [{ id: 's', imagePath: path.join(root, 's.tiff'), fileName: 's.tiff', swb: { status: 'owned', canvasWidth: 2, canvasHeight: 2 }, layers: paths.map((bitmapPath, index) => ({ id: index ? 'b' : 'a', kind: 'paint', bitmapPath, width: 2, height: 2 })) }], dialogues: [] };
    const metadata = path.join(root, '.storyboard-workbench/storyboard.project.json'), md = path.join(root, 'storyboard-script.md');
    const writeMetadata = async () => { await fs.writeFile(metadata, JSON.stringify(project, null, 2) + '\n', { mode: 0o600 }); await fs.writeFile(md, serializeStoryboardScriptMarkdown(project), { mode: 0o600 }); return {}; };
    await writeMetadata();
    const frame = {}, event: any = { sender: { mainFrame: frame }, senderFrame: frame };
    const service = createPreparedWorkspaceSave(options);
    const payload = { folderPath: root, metadataPath: metadata, normalSave: true, project, recoveryContent: { projectRaw: project, sequence: 1, assetRevision: 0, desiredAssets: [], retainedAssetIntents: [], effectFacts: { receipt: [], deletions: [], remainingScript: null, unsettled: false } } };
    // Service admission/ACK fixture, not a production Save/TIFF encoder proof.
    const prepared = await service.run(event, payload, async () => ({ project, normalSaveOutputs: [] }));
    await service.persist(event, { ...payload, recoverySaveNonce: prepared.recoverySaveNonce }, writeMetadata);
    await service.acknowledge(event, { folderPath: root, nonce: prepared.recoverySaveNonce, project });
    const jsonBefore = await fs.readFile(metadata), mdBefore = await fs.readFile(md);
    const effect = () => producer === 'writePng'
      ? writeLayerPng({ folderPath: root, bitmapPath: targetPath, dataUrl: 'data:image/png;base64,' + blue.toString('base64') })
      : producer === 'copyPng'
        ? copyLayerPng({ folderPath: root, sourceBitmapPath: paths[0], targetBitmapPath: targetPath })
        : mergeVisibleLayers({ folderPath: root, targetBitmapPath: targetPath, width: 2, height: 2, layers: paths.map(bitmapPath => ({ bitmapPath, opacity: 1, blendMode: 'normal' as const })), deleteBitmapPaths: [] });
    const failure = await finalUnlinkFault(root, () => service.ordinary(event, 'layers:' + producer, { folderPath: root }, [target], effect)).catch(error => error);
    expect(failure).toMatchObject({ effect: 'committed', filePath: target });
    const actual = await fs.readFile(target);
    expect(await fs.readFile(failure.retainedTemporary)).toEqual(actual);
    expect((await fs.stat(target)).nlink).toBe(2);
    for (const p of paths) expect(await fs.readFile(path.join(root, p))).toEqual(blue);
    expect(await fs.readFile(metadata)).toEqual(jsonBefore); expect(await fs.readFile(md)).toEqual(mdBefore);
    const cold = await createPreparedWorkspaceSave(options).readReadonly(root);
    const facts: any = (cold.effectFacts as any).producerCommitFailure;
    await fs.writeFile(path.join(os.tmpdir(), 'ordinary-commit-' + producer + '-OBSERVED.json'), JSON.stringify({ root, target, failure: String(failure), retainedTemporary: failure.retainedTemporary, facts: facts ?? null, actualDigest: hash(actual), cold }, null, 2));
    expect(facts).toMatchObject({ effect: 'committed', file: targetPath, digest: hash(actual), retainedTemporary: failure.retainedTemporary, nativeCertification: 'refused' });
    expect(cold.assets.find(a => a.role === 'failed-custody/' + facts.version)?.sourceDataUrl).toBe('data:image/png;base64,' + actual.toString('base64'));
    expect((cold.continuationState as any).notExecutable).toBe(true);
    await expect(service.acknowledge(event, { folderPath: root, nonce: prepared.recoverySaveNonce, project })).rejects.toThrow();
    // Keep original owned stage/namespace/failed synthetic target as evidence.
  }, 120000);
}
