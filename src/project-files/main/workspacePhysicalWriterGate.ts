import fs from 'node:fs/promises';
import path from 'node:path';

// Retired recovery namespaces remain a read-only boundary for the new writer.
export const assertPhysicalWorkspaceWriterTargets = async (targets: readonly string[]): Promise<void> => {
  if (!targets.length) throw new Error('Physical writer target missing');
  for (const requested of targets) {
    if (typeof requested !== 'string' || !path.isAbsolute(requested) || requested.includes('\0')) throw new Error('Invalid physical writer target');
    let existing = path.normalize(requested);
    // A fresh destination is bound through its real nearest existing parent.
    for (;;) {
      try { await fs.lstat(existing); break; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; const parent=path.dirname(existing); if(parent===existing)throw error; existing=parent; }
    }
    let physical = await fs.realpath(existing);
    if (!(await fs.stat(physical)).isDirectory()) physical=path.dirname(physical);
    for (;;) {
      // lstat, not exists/stat: broken aliases, unknown files and empty partial
      // namespaces are all protection, never absence. No namespace bytes written.
      for (const namespace of ['workspace-recovery-v1', 'workspace-recovery-v2']) {
        const marker=path.join(physical,'.storyboard-flow',namespace);
        try { await fs.lstat(marker); throw new Error('Physical workspace is protected by a recovery inventory left by an earlier session that did not close cleanly; nothing on disk was changed. Preserve this project and its recovery data; open a separate project to continue.'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      const parent=path.dirname(physical);if(parent===physical)break;physical=parent;
    }
  }
};
