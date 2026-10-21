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
