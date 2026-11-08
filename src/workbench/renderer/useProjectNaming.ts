import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';
import { namingDraftIssue, namingDraftOf, sameNamingDraft, shouldAdoptIncomingNaming, type NamingDraft } from './projectNamingDraft';

export class NamingComposingError extends Error {
  constructor() { super('请先完成输入法组字，再保存或切换项目'); this.name = 'NamingComposingError'; }
}

const AUTO_COMMIT_MS = 600;

/** Keeps the four naming fields editable at all times. Each settled typing run is
 * committed once after a short pause even while the field keeps focus, so an empty or
 * invalid value reaches the checkpoint; explicit Save still refuses it. IME composition
 * is never guessed, and an older commit's reply cannot replace newer local text. */
export function useProjectNaming(project: Pick<ProjectV1, 'id' | 'name' | 'naming'>, commit: (draft: NamingDraft) => Promise<void>) {
  const [draft, setDraft] = useState<NamingDraft>(() => namingDraftOf(project));
  const [composing, setComposing] = useState(false);
  const [, setRevision] = useState(0);
  const draftRef = useRef(draft);
  const committedRef = useRef(namingDraftOf(project));
  const focusRef = useRef(0);
  const composingRef = useRef(false);
  const commitRef = useRef(commit);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(0);
  const timer = useRef<number | undefined>(undefined);
  draftRef.current = draft;
  commitRef.current = commit;

  const cancelTimer = useCallback(() => {
    if (timer.current !== undefined) { window.clearTimeout(timer.current); timer.current = undefined; }
  }, []);
  useEffect(() => () => cancelTimer(), [cancelTimer]);

  const naming = project.naming;
  useEffect(() => {
    const next = namingDraftOf(project);
    // A late reply from an older commit must not replace text typed after it; only
    // adopt when the local draft is clean and no commit is queued or executing.
    if (!shouldAdoptIncomingNaming(!sameNamingDraft(draftRef.current, committedRef.current), queued.current)) return;
    committedRef.current = next;
    if (!sameNamingDraft(next, draftRef.current)) setDraft(next);
    setRevision(value => value + 1);
  // The individual fields keep this effect from running on unrelated project notifications.
  }, [project.id, project.name, naming?.sceneCode, naming?.artistName, naming?.version]);

  const flush = useCallback(() => {
    cancelTimer();
    if (composingRef.current) return Promise.reject(new NamingComposingError());
    queued.current++;
    const work = chain.current.then(async () => {
      const next: NamingDraft = { name: draftRef.current.name, naming: { ...draftRef.current.naming } };
      if (sameNamingDraft(next, committedRef.current)) return;
      await commitRef.current(next);
      committedRef.current = next;
      setRevision(value => value + 1);
    }).finally(() => { queued.current--; });
    chain.current = work.catch(() => {});
    return work;
  }, [cancelTimer]);

  const autoCommit = useCallback(() => {
    timer.current = undefined;
    if (composingRef.current || sameNamingDraft(draftRef.current, committedRef.current)) return;
    void flush().catch(() => {});
  }, [flush]);
  const schedule = useCallback(() => {
    cancelTimer();
    if (composingRef.current) return;
    timer.current = window.setTimeout(autoCommit, AUTO_COMMIT_MS);
  }, [autoCommit, cancelTimer]);

  const setField = useCallback((key: 'name' | 'sceneCode' | 'artistName' | 'version', value: string) => {
    setDraft(current => key === 'name'
      ? { ...current, name: value }
      : { ...current, naming: { ...current.naming, [key]: value } });
    schedule();
  }, [schedule]);
  const beginComposing = useCallback(() => { composingRef.current = true; setComposing(true); cancelTimer(); }, [cancelTimer]);
  const endComposing = useCallback(() => { composingRef.current = false; setComposing(false); schedule(); }, [schedule]);
  const focus = useCallback(() => { focusRef.current++; }, []);
  const blur = useCallback(() => { focusRef.current = Math.max(0, focusRef.current - 1); }, []);

  const issue = namingDraftIssue(draft);
  const dirty = !sameNamingDraft(draft, committedRef.current);
  return { draft, issue, dirty, composing, setField, beginComposing, endComposing, focus, blur, flush };
}

export type ProjectNamingState = ReturnType<typeof useProjectNaming>;
