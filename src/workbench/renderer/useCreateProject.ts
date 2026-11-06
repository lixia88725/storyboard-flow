import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlowCreateDraftView, FlowCreateMode, FlowProjectTarget } from '../../platform/contracts/flowEditor';
import type { CreateFields, CreateSheetState } from './CreateProjectSheet';
import { errorText } from './FlowAlert';

export type TransitionResult = 'opened' | 'unchanged' | { error: string };

/** One creation draft at a time. Main owns the source and destination paths; this hook
 * only carries the field values and the create/issue/progress flow. A host reporter
 * receives failures that happen before a sheet exists, so they stay visible. */
export function useCreateProject(start: (target: FlowProjectTarget) => Promise<TransitionResult>, report?: (message: string) => void) {
  const [state, setState] = useState<CreateSheetState | null>(null);
  const stateRef = useRef<CreateSheetState | null>(null);
  const draftRef = useRef<string | null>(null);
  const startRef = useRef(start);
  const reportRef = useRef(report);
  stateRef.current = state;
  startRef.current = start;
  reportRef.current = report;

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
    const message = errorText(error);
    reportRef.current?.(message);
    setState(current => current ? { ...current, phase: 'editing', progress: null, issues: null, error: message } : current);
  }, []);
  const updateDraft = (draft: FlowCreateDraftView) =>
    setState(current => current ? { ...current, draft } : current);

  const begin = useCallback(async (mode: FlowCreateMode = 'images') => {
    try {
      const previous = draftRef.current;
      if (previous) await window.flowEditor!.createDiscard(previous).catch(() => {});
      const draft = await window.flowEditor!.createDraft(mode);
      draftRef.current = draft.id;
      setState({ draft, phase: 'editing', progress: null, issues: null, error: '' });
    } catch (error) { fail(error); }
  }, [fail]);

  /** The entry already classified a folder and Main already holds its path:
   * adopting that draft skips every source picker. */
  const adopt = useCallback(async (draft: FlowCreateDraftView) => {
    const previous = draftRef.current;
    if (previous && previous !== draft.id) await window.flowEditor!.createDiscard(previous).catch(() => {});
    draftRef.current = draft.id;
    setState({ draft, phase: 'editing', progress: null, issues: null, error: '' });
  }, []);

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
        setState(previous => previous ? { ...previous, phase: 'editing', progress: null, issues: null, error: result.error } : previous);
      }
    } catch (error) { fail(error); }
  }, [fail]);

  const abort = useCallback(async () => {
    const id = draftRef.current;
    if (!id) return;
    try { await window.flowEditor!.createAbort(id); } catch (error) { fail(error); }
  }, [fail]);

  const respond = useCallback(async (decision: 'continue' | 'cancel') => {
    const current = stateRef.current;
    if (!current?.issues) return;
    try {
      const accepted = await window.flowEditor!.respondCreateIssues(current.issues.requestId, decision);
      if (!accepted) return;
      setState(previous => previous ? { ...previous, issues: null, phase: decision === 'continue' ? 'creating' : 'editing', error: decision === 'cancel' ? '已取消创建' : '' } : previous);
    } catch (error) { fail(error); }
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

  return { state, begin, adopt, chooseSource, chooseDestination, confirm, abort, respond, cancel, setError };
}

export type CreateProjectState = ReturnType<typeof useCreateProject>;
