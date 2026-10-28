import { expect, it } from 'vitest';
import { formatWorkspaceOpenError } from './workspaceOpenErrors';
import { legacyWorkspaceMessage } from '../../electron/shared/workspaceFormat';

it('shows the actionable open message without Electron transport noise or Save failure', () => {
  expect(formatWorkspaceOpenError(new Error("Error invoking remote method 'recovery:observeWorkspace': Error: " + legacyWorkspaceMessage)))
    .toBe('Could not open folder: ' + legacyWorkspaceMessage);
  expect(formatWorkspaceOpenError('Permission denied')).toBe('Could not open folder: Permission denied');
});
