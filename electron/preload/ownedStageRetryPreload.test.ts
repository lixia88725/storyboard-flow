import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import { buildLayerAssetUrl } from './layerAssetUrl';

// Real TS/CJS preload bodies, substituted Electron invoke/bridge ports only;
// actual contextBridge serialization still needs the isolated Electron run.
test.each(['ts', 'cjs'])('%s preload forwards only the explicit selector and preserves unknown outcome data', async extension => {
  const source = await fs.readFile(new URL(`./preload.${extension}`, import.meta.url), 'utf8');
  const code = extension === 'ts' ? ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText : source;
  const selector = { binding: 'observed', failedVersion: 'failed' }, outcome = { status: 'unknown', cleanupOutcome: 'unknown', auditOutcome: 'unknown', callerValidity: 'unknown', repair: { stageAbsent: true } };
  const calls: unknown[][] = []; let api: any;
  const electron = { contextBridge: { exposeInMainWorld: (name: string, value: unknown) => { expect(name).toBe('storyboard'); api = value; } }, ipcRenderer: { invoke: async (...args: unknown[]) => { calls.push(args); return outcome; } } };
  vm.runInNewContext(code, { exports: {}, require: (name: string) => { if (name === 'electron') return electron; if (name === './layerAssetUrl.js') return { buildLayerAssetUrl }; throw new Error('Unexpected preload dependency: ' + name); }, URLSearchParams });
  expect(typeof api.retryOwnedStage).toBe('function');
  expect(await api.retryOwnedStage(selector)).toBe(outcome);
  expect(calls).toEqual([['recovery:retryOwnedStage', selector]]);
});
