import { expect, test } from 'vitest';
import { certifyRecoveryCaptureChain, type RecoveryCaptureNode, type RecoveryCaptureReference } from './recoveryCaptureChain';

const policyA = 'a'.repeat(64), policyB = 'b'.repeat(64);
const ref = (id: string, policyKey: string | null = null): RecoveryCaptureReference => ({
  format: policyKey === null ? 'v1' : 'v2', policyKey,
  operationId: `operation-${id}`, generationId: `generation-${id}`, sealDigest: 'c'.repeat(64)
});
const node = (reference: RecoveryCaptureReference, globalPrevious: RecoveryCaptureReference | null = null, localParent: RecoveryCaptureReference | null = null): RecoveryCaptureNode<string> => ({ reference, globalPrevious, localParent, value: reference.generationId });

// Approved D3 ordering rules. These synthetic references test topology only,
// not native policy provenance or permission to put restrictive data in A.
test('one global chain elects the exact final capture across partitions, independent of enumeration order', () => {
  const a = ref('first', policyA), b = ref('second', policyB), c = ref('third', policyA);
  const last = node(c, b, a);
  expect(certifyRecoveryCaptureChain([last, node(a), node(b, a)])).toBe(last);
});

test('legacy v1 local parent is the global predecessor and remains compatible', () => {
  const a = ref('old'), b = ref('next');
  const last = node(b, a, a);
  expect(certifyRecoveryCaptureChain([last, node(a)])).toBe(last);
});

test('v1 can precede a v2 partition without inventing a local predecessor', () => {
  const a = ref('old'), b = ref('new', policyB);
  const last = node(b, a);
  expect(certifyRecoveryCaptureChain([last, node(a)])).toBe(last);
});

test('local parent must be the nearest same-partition global ancestor, not an older partition tip', () => {
  const a = ref('one', policyA), b = ref('two', policyB), c = ref('three', policyA), d = ref('four', policyA);
  expect(() => certifyRecoveryCaptureChain([node(a), node(b, a), node(c, b, a), node(d, c, a)])).toThrow();
});

test('missing same-partition local parent cannot hide a previous contribution', () => {
  const a = ref('one', policyA), b = ref('two', policyB), c = ref('three', policyA);
  expect(() => certifyRecoveryCaptureChain([node(a), node(b, a), node(c, b)])).toThrow();
});

test('a local parent from another partition is refused', () => {
  const a = ref('one', policyA), b = ref('two', policyB);
  expect(() => certifyRecoveryCaptureChain([node(a), node(b, a, a)])).toThrow();
});

test('forks and multiple roots are not resolved by choosing a name or newer revision', () => {
  const a = ref('one'), b = ref('two'), c = ref('three');
  for (const nodes of [[node(a), node(b, a, a), node(c, a, a)], [node(a), node(b)]]) {
    expect(() => certifyRecoveryCaptureChain(nodes)).toThrow();
  }
});

test('missing or wrong-seal global predecessors are refused', () => {
  const a = ref('one'), b = ref('two');
  for (const previous of [ref('missing'), { ...a, sealDigest: 'd'.repeat(64) }]) {
    expect(() => certifyRecoveryCaptureChain([node(a), node(b, previous, previous)])).toThrow();
  }
});

test('detached cycles cannot disappear behind a valid root', () => {
  const a = ref('root'), b = ref('cycle-a'), c = ref('cycle-b');
  expect(() => certifyRecoveryCaptureChain([node(a), node(b, c, c), node(c, b, b)])).toThrow();
});

test('duplicate physical capture identity is refused even when seals differ', () => {
  const a = ref('one');
  expect(() => certifyRecoveryCaptureChain([node(a), node({ ...a, sealDigest: 'd'.repeat(64) })])).toThrow();
});

test('a correct global predecessor does not authenticate a local parent with a different seal', () => {
  const a = ref('one', policyA), b = ref('two', policyB), c = ref('three', policyA);
  expect(() => certifyRecoveryCaptureChain([node(a), node(b, a), node(c, b, { ...a, sealDigest: 'd'.repeat(64) })])).toThrow();
});

test('unknown format, path-like IDs and inconsistent partition references are refused', () => {
  const a = ref('one');
  for (const reference of [
    { ...a, format: 'v3' } as unknown as RecoveryCaptureReference,
    { ...a, generationId: '../escape' },
    { ...a, policyKey: policyA },
    { ...ref('two', policyA), policyKey: 'not-a-policy-digest' }
  ]) expect(() => certifyRecoveryCaptureChain([node(reference)])).toThrow();
});

test('an empty inventory does not produce a certified tip', () => {
  expect(() => certifyRecoveryCaptureChain([])).toThrow();
});
