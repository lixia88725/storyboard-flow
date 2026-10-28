import { manualImageImportAdmission, type ManualImportShot } from './manualImageImportRules.js';

export const legacyWorkspaceMessage = 'This older test project is no longer supported for editing. Its files have been kept. Choose a new folder to start a project.';

// Development policy: do not reconstruct missing output state from TIFF pixels.
// Empty projects and pristine external images still use the normal Import flow.
// Current, corrupt and future envelopes retain their existing validation paths.
export const assertEditableWorkspaceFormat = (project: {
  shots: ManualImportShot[]; parkedShots?: ManualImportShot[]; pendingBake?: unknown;
} | undefined): void => {
  if (!project || project.pendingBake !== undefined) return;
  try { manualImageImportAdmission(project); }
  catch { throw new Error(legacyWorkspaceMessage); }
};
