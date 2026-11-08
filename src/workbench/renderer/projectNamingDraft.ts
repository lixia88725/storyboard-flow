import type { ProjectNamingV1, ProjectV1 } from '../../platform/contracts/refactorV1';
import { namingIssue } from '../../platform/contracts/flowNaming';

export type NamingDraft = { name: string; naming: ProjectNamingV1 };

export const defaultProjectNaming = (): ProjectNamingV1 => ({ sceneCode: 'scene', artistName: 'artist', version: 'v001' });

/** A project without an explicit naming block still presents the four fields; committing
 * one of them writes the block. The fields are not inherited from any other project. */
export const namingDraftOf = (project: Pick<ProjectV1, 'id' | 'name' | 'naming'>): NamingDraft => ({
  name: project.name,
  naming: project.naming ? { ...project.naming } : defaultProjectNaming()
});

export const sameNamingDraft = (left: NamingDraft, right: NamingDraft): boolean =>
  left.name === right.name && left.naming.sceneCode === right.naming.sceneCode &&
  left.naming.artistName === right.naming.artistName && left.naming.version === right.naming.version;

/** Publication-boundary validation: typing may hold an invalid value while the project
 * continues to autosave, but explicit output waits for a valid name. */
export const namingDraftIssue = (draft: NamingDraft): string | null => namingIssue(draft.name, draft.naming);

/** A late reply may be adopted only when the local draft is clean and no commit is
 * queued or running. Dirty text always wins over an older project snapshot. */
export const shouldAdoptIncomingNaming = (dirty: boolean, queued: number): boolean => !dirty && queued === 0;
