/**
 * Startup policy: reopen the workspace the user had last.
 *
 * The first entry of the recent-folder list is the last opened workspace, so the
 * app returns to where the user was instead of stopping at an empty landing
 * page — both after a fresh launch and after a renderer reload (Cmd+R), where
 * the renderer state is gone but the list survives in Main.
 *
 * Browser storage is unusable on this origin, so nothing is remembered there.
 */
export const startupResumeTarget = (recentFolders: readonly string[]): string | undefined =>
  recentFolders[0];

// The legacy external-change probe may generate previews/script files. Old
// folders must reach the read-only browser before that probe is even admitted.
export const startupRecoveryMode = async (
  target: string,
  ports: {
    inspect: (folder: string) => Promise<{ browse: boolean; editableFolderPath?: string }>;
    probe: (folder: string) => Promise<unknown>;
    isCurrent: () => boolean;
  }
): Promise<'normal' | 'recovery' | 'superseded'> => {
  const inspection = await ports.inspect(target);
  if (!ports.isCurrent()) return 'superseded';
  if (inspection.browse) return 'normal';
  try { await ports.probe(inspection.editableFolderPath ?? target); }
  catch (error) {
    if (!ports.isCurrent()) return 'superseded';
    if (/protected by a recovery inventory/.test(String(error))) return 'recovery';
  }
  return ports.isCurrent() ? 'normal' : 'superseded';
};
