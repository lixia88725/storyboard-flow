import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlowCreateDraftView, FlowProjectTarget } from '../../platform/contracts/flowEditor';
import type { CreateFields, CreateSheetState } from './CreateProjectSheet';

export type TransitionResult = 'opened' | 'unchanged' | { error: string };

/** One creation draft at a time. Main owns the source and destination paths; this hook
 * only carries the field values and the create/issue/progress flow. */
export function useCreateProject(start: (target: FlowProjectTarget) => Promise<TransitionResult>) {
  const [state, setState] = useState<CreateSheetState | null>(null);
  const stateRef = useRef<CreateSheetState | null>(null);
  const draftRef = useRef<string | null>(null);
  const aborting = useRef(false);
  const startRef = useRef(start);
  stateRef.current = state;
  startRef.current = start;

  useEffect(() => {
    const api = window.flowEditor!;
    const offProgress = api.onCreateProgress(progress => {
      if (progress.draftId !== draftRef.current) return;
      setState(current => current ? { ...current, progress: { done: progress.done, total: progress.total, ...(progress.phase ? { phase: progress.phase } : {}) } } : current);
    });
    const offIssues = api.onCreateIssues(issues => {
      if (issues.draftId !== draftRef.current) return;
      setState(current => current ? { ...current, phase: 'issues', issues, error: '' } : current);
    });
    return () => { offProgress(); offIssues(); };
  }, []);

  useEffect(() => () => {
    const id = draftRef.current;
    if (id) void window.flowEditor!.createDiscard(id).catch(() => {});
  }, []);

  const fail = useCallback((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setState(current => current ? { ...current, phase: 'editing', progress: null, issues: null, error: message } : current);
  }, []);
  const updateDraft = (draft: FlowCreateDraftView) =>
    setState(current => current ? { ...current, draft } : current);

  const begin = useCallback(async () => {
    try {
      const previous = draftRef.current;
      if (previous) await window.flowEditor!.createDiscard(previous).catch(() => {});
      const draft = await window.flowEditor!.createDraft();
      draftRef.current = draft.id;
      setState({ draft, phase: 'editing', progress: null, issues: null, error: '' });
    } catch (error) { fail(error); }
  }, [fail]);

  const chooseSource = useCallback(async (kind: 'files' | 'folder') => {
    const id = draftRef.current;
    if (!id) return;
    try {
      const result = await window.flowEditor!.createChooseSource(id, kind);
      if (!('canceled' in result)) updateDraft(result);
    } catch (error) { fail(error); }
  }, [fail]);

  const chooseDestination = useCallback(async () => {
    const id = draftRef.current;
    if (!id) return;
    try {
      const result = await window.flowEditor!.createChooseDestination(id);
      if (!('canceled' in result)) updateDraft(result);
    } catch (error) { fail(error); }
  }, [fail]);

  const confirm = useCallback(async (fields: CreateFields) => {
    const current = stateRef.current;
    const id = draftRef.current;
    if (!current || !id || current.phase !== 'editing') return;
    aborting.current = false;
    try {
      const draft = await window.flowEditor!.createUpdate(id, fields);
      setState(previous => previous ? { ...previous, draft, phase: 'creating', progress: null, issues: null, error: '' } : previous);
      const result = await startRef.current({ kind: 'create', draftId: id });
      if (result === 'opened') {
        draftRef.current = null;
        setState(null);
      } else if (result === 'unchanged') {
        setState(previous => previous ? { ...previous, phase: 'editing', progress: null, issues: null, error: '已取消创建' } : previous);
      } else {
        setState(previous => previous ? { ...previous, phase: 'editing', progress: null, issues: null, error: aborting.current ? '已取消创建' : result.error } : previous);
      }
    } catch (error) {
      if (aborting.current) {
        setState(previous => previous ? { ...previous, phase: 'editing', progress: null, issues: null, error: '已取消创建' } : previous);
      } else fail(error);
    } finally { aborting.current = false; }
  }, [fail]);

  const abort = useCallback(async () => {
    const id = draftRef.current;
    if (!id) return;
    aborting.current = true;
    try { await window.flowEditor!.createAbort(id); } catch (error) { fail(error); }
  }, [fail]);

  const respond = useCallback(async (decision: 'continue' | 'cancel') => {
    const current = stateRef.current;
    if (!current?.issues) return;
    if (decision === 'cancel') aborting.current = true;
    try {
      const accepted = await window.flowEditor!.respondCreateIssues(current.issues.requestId, decision);
      if (!accepted) { aborting.current = false; return; }
      setState(previous => previous ? { ...previous, issues: null, phase: decision === 'continue' ? 'creating' : 'editing', error: decision === 'cancel' ? '已取消创建' : '' } : previous);
    } catch (error) { aborting.current = false; fail(error); }
  }, [fail]);

  const cancel = useCallback(async () => {
    const id = draftRef.current;
    const current = stateRef.current;
    if (!current) return;
    if (current.issues) { await respond('cancel'); }
    if (id) await window.flowEditor!.createDiscard(id).catch(() => {});
    draftRef.current = null;
    setState(null);
  }, [respond]);

  const setError = useCallback((message: string) => {
    setState(current => current ? { ...current, error: message } : current);
  }, []);

  return { state, begin, chooseSource, chooseDestination, confirm, abort, respond, cancel, setError };
}

export type CreateProjectState = ReturnType<typeof useCreateProject>;
