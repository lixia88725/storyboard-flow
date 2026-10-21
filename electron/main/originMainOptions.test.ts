import { expect, test } from 'vitest';
import ts from 'typescript';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createOriginWorkspaceAccounting } from './originWorkspaceAccounting';
import { createOriginEnrollment } from './originEnrollment';
import { createPreparedWorkspaceSave } from './preparedWorkspaceSave';
import { createControlledMemoryBudget } from './controlledMemory';
import { MAIN_MEMORY_BUDGET_BYTES, MAIN_MEMORY_JSON, MAIN_MEMORY_PRESSURE } from './memoryPolicy';
import { createRecoveryClaimRecords } from './recoveryClaimRecords';

test('actual Main options connect the same native accountant and private origin bridge with lazy isolated userData', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-main-options-'));
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'origin-main-data-'));
  await fs.mkdir(path.join(root, '.storyboard-workbench'), { mode: 0o700 });
  const source = await fs.readFile(new URL('./main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', source, ts.ScriptTarget.Latest, true);
  const option = (name: string, factory: string) => {
    const declarations = ast.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]).filter(d => d.name.getText(ast) === name);
    expect(declarations).toHaveLength(1);
    const call = declarations[0].initializer;
    if (!call || !ts.isCallExpression(call) || call.expression.getText(ast) !== factory || call.arguments.length !== 1) throw new Error('Actual Main factory/options boundary missing');
    return call.arguments[0].getText(ast);
  };
  let getters = 0;
  const recoveryBudget = { bytes: 1048576, records: 1000, assets: 16, jsonDepth: 80 };
  const scope: Record<string, any> = { path, recoveryBudget, createRecoveryClaimRecords,
    mainMemoryBudget: createControlledMemoryBudget(MAIN_MEMORY_BUDGET_BYTES, { policy: MAIN_MEMORY_PRESSURE }, MAIN_MEMORY_JSON),
    app: { getPath: (name: string) => { expect(name).toBe('userData'); getters++; return userData; }, getAppPath: () => process.cwd() },
    process: { env: { SWB_PYTHON_PATH: 'python3' } },
    BrowserWindow: { fromWebContents: (sender: object) => sender } };
  const evaluate = (expression: string) => new Function(...Object.keys(scope), `return (${expression});`)(...Object.values(scope));
  const accountingOptions = evaluate(option('originAccounting', 'createOriginWorkspaceAccounting'));
  expect(accountingOptions.claimRecords).toBeTypeOf('function');expect(accountingOptions.claimWriter).toBeTypeOf('function');
  scope.originAccounting = createOriginWorkspaceAccounting(accountingOptions);
  scope.originEnrollment = createOriginEnrollment(evaluate(option('originEnrollment', 'createOriginEnrollment')));
  const actual = evaluate(option('preparedSave', 'createPreparedWorkspaceSave'));
  expect(actual.originEnrollment).toBe(scope.originEnrollment);
  expect(actual.accounting).toBe(scope.originAccounting);
  expect(getters).toBe(0);
  const prepared = createPreparedWorkspaceSave(actual), frame = {}, event: any = { sender: { mainFrame: frame }, senderFrame: frame };
  const observed = await prepared.observeWorkspace(event, root);
  expect(observed.folderPath).toBe(root);
  await expect(prepared.readReadonly(root)).rejects.toThrow('No recovery namespace');
  expect(getters).toBeGreaterThan(0);
  expect(await fs.readdir(userData)).toEqual([]);
  expect(await fs.readdir(path.join(root, '.storyboard-workbench'))).toEqual([]);
  // This executes actual Main options/controller and native observation, not
  // Electron app startup or GUI lifecycle. No enrollment is caused by reading.
}, 120000);
