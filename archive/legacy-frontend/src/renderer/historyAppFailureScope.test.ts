import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { expect, test } from 'vitest';
import { addGeneratedShot, createProject } from '../shared/projectOps';
import { createBitmapLayerWriteQueue } from './bitmapLayerWriteQueue';
import { createWorkspaceSlots } from './workspaceSlots';
import { createWorkspaceSession } from './workspaceSession';

// Execute actual two App options, actual slot lifecycle and actual owner/adapter.
// Root observation, retention and IPC are explicit synthetic boundary ports.
test('actual App History display scope survives its own rejected ACK but not real Close and generation rotation', async () => {
  const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useProjectHistoryController') calls.push(node); ts.forEachChild(node, visit); }; visit(ast);
  expect(calls).toHaveLength(1);
  const options = calls[0].arguments[0]; expect(ts.isObjectLiteralExpression(options)).toBe(true);
  const props = (options as ts.ObjectLiteralExpression).properties.filter(p => ts.isPropertyAssignment(p) && ['captureFailureScope', 'captureWorkspace'].includes(p.name.getText(ast)));
  expect(props).toHaveLength(2);
  const expression = `return ({${props.map(p => p.getText(ast)).join(',')}});`;
  const compiled = ts.transpileModule(expression, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const project = addGeneratedShot(createProject('A'), { imagePath: '/A/a.tiff', fileName: 'a.tiff', width: 2, height: 2 });
  const shot = project.shots[0], hash = '0'.repeat(64), queue = createBitmapLayerWriteQueue();
  project.pendingBake = { version: 1, shots: { [shot.id]: { state: 'synced', acceptedOutputIdentity: hash } } };
  const slots = createWorkspaceSlots({ initialProject: createProject('initial'), publishProject: () => {},
    observe: async folderPath => ({ folderPath, binding: folderPath, metadataPath: folderPath + '/project.json' }),
    captureView: () => ({}), certifyHandoff: async () => true, drain: () => queue.drain(), publishActive: () => {},
    adapterPorts: () => ({ queue, freshToken: () => 'edit', api: () => ({ readOutputIdentity: async () => hash,
      autosaveWorkspace: async () => ({ ordinaryPersistenceNonce: 'ordinary' }), acknowledgeSave: async () => false,
      saveWorkspace: async () => { throw new Error('No extra Save'); } }), onSave: () => {}, onError: () => {} }) });
  await slots.requestOpen('/A', async (slot, root) => {
    let scan: Parameters<Parameters<typeof slot.adapter.load>[1]>[0] | undefined;
    const loaded = await slot.adapter.load(async () => ({ ...root, folderName: 'A', images: [], project }), value => { scan = value; });
    return loaded ? scan : undefined;
  });
  const slot = slots.active;
  const workspaceSession = createWorkspaceSession({ owner: () => slot.adapter.owner, readRecovery: () => undefined,
    readDestination: () => slot.root ?? {}, readIdentity: () => slot.incarnation });
  const getters = new Function('workspaceSlotsRef', 'renderSlot', 'workspaceSession', compiled)({ current: slots }, slot, workspaceSession) as {
    captureFailureScope: () => () => boolean; captureWorkspace: () => () => boolean;
  };
  const display = getters.captureFailureScope(), admission = getters.captureWorkspace();
  expect(display()).toBe(true); expect(admission()).toBe(true);
  const complete = slot.adapter.owner.captureEffectCompletion();
  await expect(queue.runExclusive(() => complete(slot.projectRef.current, [shot.id], { published: () => {}, afterDurable: async () => {} }))).rejects.toThrow('Ordinary exact persistence ACK refused');
  expect(slot.adapter.owner.lastError).toBeInstanceOf(Error);
  expect(admission()).toBe(false); expect(display()).toBe(true);
  await slots.freezeForClose(); expect(display()).toBe(false);
  slots.cancelClose(); expect(display()).toBe(false);
  expect(getters.captureFailureScope()()).toBe(true);
});
