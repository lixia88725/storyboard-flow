import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { prepareImportStaging } from './importPreparation';
import * as evidence from './importPreparation';

// Real exclusive mkdir failure; no synthetic Error, ACK, cleanup or native-policy substitute.
test('only the original Import preparation emits its exact failed candidate and OS EEXIST evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'import-evidence-'));
  const candidate = path.join(root, 'collision');
  await fs.mkdir(candidate, { mode: 0o700 });
  await fs.writeFile(path.join(candidate, 'preserved.json'), '{"preserved":true}', { mode: 0o600 });
  const original = await fs.readFile(path.join(candidate, 'preserved.json'));
  expect((evidence as any).withImportFailureEvidence).toBeTypeOf('function');
  const facts: any[] = [];
  let called = false;
  await expect((evidence as any).withImportFailureEvidence((fact: any) => { facts.push(fact); }, () => prepareImportStaging(candidate, async () => { called = true; }))).rejects.toMatchObject({ code: 'EEXIST' });
  expect(called).toBe(false);
  expect(facts).toHaveLength(1);
  expect(facts[0]).toMatchObject({ schema: 'swb.import-preparation-failure.v1', candidatePath: candidate, code: 'EEXIST', syscall: 'mkdir', preparationStarted: false, acknowledged: false });
  expect(facts[0].path).toBe(candidate);
  expect(await fs.readFile(path.join(candidate, 'preserved.json'))).toEqual(original);
  // No active original-Main observer: an old failure cannot be re-enrolled.
  await expect(prepareImportStaging(candidate, async () => undefined)).rejects.toMatchObject({ code: 'EEXIST' });
  expect(facts).toHaveLength(1);
});
