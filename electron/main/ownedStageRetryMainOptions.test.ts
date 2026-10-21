import { expect, test } from 'vitest';
import ts from 'typescript';
import fs from 'node:fs/promises';
import { createOwnedStageRetryService } from './ownedStageRetryService';

// Execute actual Main options with the real confirmation dispatcher. Electron
// dialog/window and destructive controller are external ports in this test.
test('actual Main confirmation belongs to the invoking window, defaults to cancel, and cancellation cannot dispatch', async () => {
  const text = await fs.readFile(new URL('./main.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('main.ts', text, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]).filter(d => d.name.getText(ast) === 'ownedStageRetryService');
  expect(declaration).toHaveLength(1);
  const call = declaration[0].initializer;
  if (!call || !ts.isCallExpression(call) || call.expression.getText(ast) !== 'createOwnedStageRetryService' || call.arguments.length !== 1) throw new Error('Actual Main confirmation options missing');
  const frame = {}, sender = { mainFrame: frame }, event = { sender, senderFrame: frame };
  const window = { webContents: sender, isDestroyed: () => false };
  let cleaned = 0, response = 1, shown = 0;
  const scope = {
    BrowserWindow: { fromWebContents: (input: object) => input === sender ? window : null },
    dialog: { showMessageBox: async (owner: object, options: any) => { expect(owner).toBe(window); expect(options.defaultId).toBe(1); expect(options.cancelId).toBe(1); expect(options.buttons).toHaveLength(2); shown++; return { response }; } },
    preparedSave: { verifyFailedOrigin: async () => ({ verified: true }), retryFailedOrigin: async (_e: unknown, _p: unknown, dispatch: () => void) => { dispatch(); cleaned++; return { status: 'repaired', cleanupOutcome: 'stage-removed', auditOutcome: 'verified', callerValidity: 'valid' }; } }
  };
  const js = ts.transpileModule(`const options = ${call.arguments[0].getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const options = new Function(...Object.keys(scope), js + '\nreturn options;')(...Object.values(scope));
  const service = createOwnedStageRetryService(options), selector = { binding: 'observed', failedVersion: 'failed' };
  expect(await service.request(event, selector)).toMatchObject({ status: 'cancelled' }); expect(cleaned).toBe(0);
  response = 0;
  expect(await service.request(event, selector)).toMatchObject({ status: 'repaired' }); expect(cleaned).toBe(1);
  expect(await service.request({ sender: { mainFrame: frame }, senderFrame: frame }, selector)).toMatchObject({ status: 'refused' });
  expect(shown).toBe(2); expect(cleaned).toBe(1);
  expect(text).toContain('ipcMain.handle("recovery:retryOwnedStage"');
});
