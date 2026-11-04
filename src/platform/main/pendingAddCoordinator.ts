import type { FlowFailure, FlowResult } from '../contracts/flowWave2.js';
import type { ProjectV1 } from '../contracts/refactorV1.js';
import type { CreateImageProjectIssue } from '../contracts/flowProjectCreation.js';
import type { FlowPendingBridgeRequest, FlowPendingMode } from '../contracts/flowEditor.js';

/** Main-owned absolute source paths; the renderer never supplies one. */
export type PendingAddSource = { kind: 'files'; files: string[] } | { kind: 'folder'; folder: string };
export type PendingAddOwner = { sessionId: string; windowId: number; projectId: string; mode: FlowPendingMode };
export type PendingAppendOptions = {
  signal: AbortSignal;
  onProgress?: (progress: { done: number; total: number; phase?: 'read' | 'write' }) => void;
  decideIssues?: (issues: CreateImageProjectIssue[]) => Promise<'continue' | 'cancel'>;
};
export type PendingAppend = (
  owner: PendingAddOwner,
  project: ProjectV1,
  input: { source?: PendingAddSource; recover?: boolean; operationId: string },
  options: PendingAppendOptions
) => Promise<FlowResult<ProjectV1>>;

export type PendingAddCoordinatorDeps = {
  /** The only writable session currently owned by the window. */
  currentSessionId: () => string | null;
  pick: (mode: FlowPendingMode) => Promise<PendingAddSource | null>;
  append: PendingAppend;
  onProgress: (operationId: string, progress: { done: number; total: number; phase?: 'read' | 'write' }) => void;
  /** Resolves cancel when the native picker is abandoned or the operation is aborted. */
  askIssues: (operationId: string, issues: CreateImageProjectIssue[], signal: AbortSignal) => Promise<'continue' | 'cancel'>;
};

type Operation = {
  owner: PendingAddOwner;
  source?: PendingAddSource;
  controller: AbortController;
  inFlight: boolean;
  retained: boolean;
};

const OPERATION_ID = /^[A-Za-z0-9_-]{1,80}$/;
const fail = (code: FlowFailure['code'], message: string, effect: FlowFailure['effect'] = 'none'): FlowResult<never> =>
  ({ ok: false, error: { code, message, effect } });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const validSource = (source: unknown): source is PendingAddSource => {
  if (!isRecord(source)) return false;
  if (source.kind === 'folder') return typeof source.folder === 'string' && source.folder.length > 0;
  return source.kind === 'files' && Array.isArray(source.files) && source.files.length > 0 &&
    source.files.every(file => typeof file === 'string' && file.length > 0);
};

/** Binds one Pending add to the owner session, window and operation id. Recovery
 * never opens a picker and never duplicates the append; a retained operation stays
 * addressable only by the same owner until the runtime reports a known result. */
export function createPendingAddCoordinator(deps: PendingAddCoordinatorDeps) {
  const operations = new Map<string, Operation>();

  const ownerMatches = (operation: Operation, owner: PendingAddOwner) =>
    operation.owner.sessionId === owner.sessionId && operation.owner.windowId === owner.windowId &&
    operation.owner.projectId === owner.projectId && operation.owner.mode === owner.mode;

  const add = async (windowId: number, sessionId: string, project: ProjectV1, request: FlowPendingBridgeRequest): Promise<FlowResult<ProjectV1>> => {
    if (!Number.isSafeInteger(windowId) || windowId <= 0) return fail('invalid-input', 'Invalid window owner');
    if (typeof sessionId !== 'string' || !sessionId) return fail('invalid-input', 'Invalid editor session');
    if (deps.currentSessionId() !== sessionId) return fail('conflict', 'Stale editor session', 'none');
    if (!isRecord(request) || (request.mode !== 'files' && request.mode !== 'folder') ||
        typeof request.operationId !== 'string' || !OPERATION_ID.test(request.operationId) ||
        typeof request.recover !== 'boolean') return fail('invalid-input', 'Invalid Pending add request');
    if (!isRecord(project) || typeof project.id !== 'string' || !project.id)
      return fail('invalid-input', 'Invalid project');
    const owner: PendingAddOwner = { sessionId, windowId, projectId: project.id, mode: request.mode };
    const { operationId, recover } = request;
    let operation = operations.get(operationId);
    if (recover) {
      if (!operation) return fail('conflict', 'No matching Pending operation', 'none');
      if (!ownerMatches(operation, owner)) return fail('conflict', 'Pending operation belongs to another owner', 'none');
    } else {
      if (operation) return fail('conflict', 'Pending operation id was already used', 'none');
      operation = { owner, controller: new AbortController(), inFlight: false, retained: false };
      operations.set(operationId, operation);
      let source: PendingAddSource | null;
      try { source = await deps.pick(request.mode); }
      catch (error) {
        operations.delete(operationId);
        return fail('io-failure', error instanceof Error ? error.message : String(error), 'none');
      }
      if (!source || operation.controller.signal.aborted) {
        operations.delete(operationId);
        return fail('unavailable', '已取消添加', 'none');
      }
      if (!validSource(source)) {
        operations.delete(operationId);
        return fail('invalid-input', 'Image source is required', 'none');
      }
      operation.source = source;
    }
    if (operation.inFlight) return fail('busy', 'Pending add is already running', 'none');
    operation.controller = new AbortController();
    operation.inFlight = true;
    const signal = operation.controller.signal;
    try {
      const result = await deps.append(owner, project,
        recover ? { operationId, recover: true } : { operationId, source: operation.source! },
        {
          signal,
          onProgress: progress => deps.onProgress(operationId, progress),
          decideIssues: issues => deps.askIssues(operationId, issues, signal)
        });
      if (result.ok) {
        // Keep a successful first attempt addressable: its reply may be lost after
        // the durable append. A recover with the same owner and operation id resumes
        // that durable result; a normal reply never asks for it again.
        if (recover) operations.delete(operationId);
        return result;
      }
      // A failed first attempt is a known result; a failed recover stays retryable
      // under the same owner so the Session can reconcile the durable intent.
      if (result.error.effect === 'unknown' || recover) operation.retained = true;
      else operations.delete(operationId);
      return result;
    } catch (error) {
      operation.retained = true;
      return fail('io-failure', error instanceof Error ? error.message : String(error), 'unknown');
    } finally {
      operation.inFlight = false;
    }
  };

  const cancel = (windowId: number, sessionId: string, operationId: string) => {
    if (typeof operationId !== 'string') return;
    const operation = operations.get(operationId);
    if (!operation || operation.owner.windowId !== windowId || operation.owner.sessionId !== sessionId) return;
    operation.controller.abort();
  };

  const cancelAll = () => {
    for (const operation of operations.values()) operation.controller.abort();
    operations.clear();
  };

  return { add, cancel, cancelAll };
}

export type PendingAddCoordinator = ReturnType<typeof createPendingAddCoordinator>;
