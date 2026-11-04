import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';
import { namingDraftIssue, namingDraftOf, sameNamingDraft, type NamingDraft } from './projectNamingDraft';

export class NamingComposingError extends Error {
  constructor() { super('请先完成输入法组字，再保存或切换项目'); this.name = 'NamingComposingError'; }
}

/** Keeps the four naming fields editable at all times. Edits stay local until blur,
 * explicit Save, or a project transition collects them, so per-keystroke checkpoints
 * and undo entries do not appear. A commit that is still in flight is joined rather
 * than duplicated, and the focused field is never overwritten by an incoming snapshot. */
export function useProjectNaming(project: ProjectV1, commit: (draft: NamingDraft) => Promise<void>) {
  const [draft, setDraft] = useState<NamingDraft>(() => namingDraftOf(project));
  const [composing, setComposing] = useState(false);
  const [, setRevision] = useState(0);
  const draftRef = useRef(draft);
  const committedRef = useRef(namingDraftOf(project));
  const focusRef = useRef(0);
  const composingRef = useRef(false);
  const commitRef = useRef(commit);
  const chain = useRef<Promise<void>>(Promise.resolve());
  draftRef.current = draft;
  commitRef.current = commit;

  const naming = project.naming;
  useEffect(() => {
    const next = namingDraftOf(project);
    committedRef.current = next;
    if (focusRef.current === 0 && !composingRef.current) {
      setDraft(next);
      setRevision(value => value + 1);
    }
  // The individual fields keep this effect from running on unrelated project notifications.
  }, [project.id, project.name, naming?.sceneCode, naming?.artistName, naming?.version]);

  const setField = useCallback((key: 'name' | 'sceneCode' | 'artistName' | 'version', value: string) => {
    setDraft(current => key === 'name'
      ? { ...current, name: value }
      : { ...current, naming: { ...current.naming, [key]: value } });
  }, []);
  const beginComposing = useCallback(() => { composingRef.current = true; setComposing(true); }, []);
  const endComposing = useCallback(() => { composingRef.current = false; setComposing(false); }, []);
  const focus = useCallback(() => { focusRef.current++; }, []);
  const blur = useCallback(() => { focusRef.current = Math.max(0, focusRef.current - 1); }, []);

  const flush = useCallback(() => {
    if (composingRef.current) return Promise.reject(new NamingComposingError());
    const work = chain.current.then(async () => {
      const next: NamingDraft = { name: draftRef.current.name, naming: { ...draftRef.current.naming } };
      if (sameNamingDraft(next, committedRef.current)) return;
      await commitRef.current(next);
      committedRef.current = next;
      setRevision(value => value + 1);
    });
    chain.current = work.catch(() => {});
    return work;
  }, []);

  const issue = namingDraftIssue(draft);
  const dirty = !sameNamingDraft(draft, committedRef.current);
  return { draft, issue, dirty, composing, setField, beginComposing, endComposing, focus, blur, flush };
}

export type ProjectNamingState = ReturnType<typeof useProjectNaming>;
