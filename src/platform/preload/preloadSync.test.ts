import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-ignore Trusted repository checker is JavaScript.
import { checkFlowPreload } from '../../../scripts/check-preload-sync.mjs';
const source = readFileSync('src/platform/preload/flowEditor.cjs', 'utf8');
const contract = readFileSync('src/platform/contracts/flowEditor.ts', 'utf8');
describe('Flow preload contract', () => {
  it('forwards capabilities and disposes close listeners', () => expect(() => checkFlowPreload(source, contract)).not.toThrow());
  it('rejects a renamed IPC channel', () => expect(() => checkFlowPreload(source.replace('flow-editor:put', 'flow-editor:wrong'), contract)).toThrow());
  it('rejects an exposed old bridge', () => expect(() => checkFlowPreload(source.replace("'flowEditor'", "'storyboard'"), contract)).toThrow());
  it('rejects missing contract methods', () => expect(() => checkFlowPreload(source, contract.replace('  read(', '  removed('))).toThrow());
});
