import { describe, expect, it } from 'vitest';
import { defaultProjectNaming, namingDraftIssue, namingDraftOf, sameNamingDraft, shouldAdoptIncomingNaming } from './projectNamingDraft';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';

const project = (name: string, naming?: ProjectV1['naming']): ProjectV1 => ({
  schema: 'storyboard-flow.project', version: 1, id: 'p', revision: 0, name,
  ...(naming ? { naming } : {}), shots: [], parkedShots: [], dialogues: [], images: {}
});

describe('project naming draft', () => {
  it('presents the four fields even when the checkpoint has no naming block', () => {
    expect(namingDraftOf(project('未命名项目'))).toEqual({ name: '未命名项目', naming: defaultProjectNaming() });
  });

  it('copies the checkpoint values instead of sharing them', () => {
    const source = { sceneCode: 'S01', artistName: 'A', version: 'v002' };
    const draft = namingDraftOf(project('片名', source));
    draft.naming.sceneCode = 'S02';
    expect(source.sceneCode).toBe('S01');
  });

  it('detects equality across all four values', () => {
    const base = namingDraftOf(project('片名', { sceneCode: 'S01', artistName: 'A', version: 'v001' }));
    expect(sameNamingDraft(base, { ...base, naming: { ...base.naming } })).toBe(true);
    expect(sameNamingDraft(base, { ...base, name: '别的' })).toBe(false);
    expect(sameNamingDraft(base, { ...base, naming: { ...base.naming, version: 'v002' } })).toBe(false);
  });

  it('keeps newer local text when a commit is dirty or still queued', () => {
    expect(shouldAdoptIncomingNaming(false, 0)).toBe(true);
    expect(shouldAdoptIncomingNaming(true, 0)).toBe(false);
    expect(shouldAdoptIncomingNaming(false, 1)).toBe(false);
    expect(shouldAdoptIncomingNaming(true, 1)).toBe(false);
  });

  it('reports invalid values at the publication boundary', () => {
    expect(namingDraftIssue({ name: '', naming: defaultProjectNaming() })).toBe('项目名称不能为空');
    expect(namingDraftIssue({ name: 'a/b', naming: defaultProjectNaming() })).toBe('项目名称含有不能用于文件名的字符');
    expect(namingDraftIssue({ name: '片名', naming: { sceneCode: 'S/1', artistName: 'A', version: 'v001' } })).toBe('场次含有不能用于文件名的字符');
    expect(namingDraftIssue({ name: '片名', naming: defaultProjectNaming() })).toBeNull();
  });
});
