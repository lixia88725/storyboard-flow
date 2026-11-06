import type { FlowAssetDepot, FlowResult } from './flowWave2.js';
import type { ProjectV1, ResultV1, CheckpointReceiptV1, ProjectNamingV1 } from './refactorV1.js';
import type { CreateImageProjectIssue } from './flowProjectCreation.js';
/** Dedicated new-format editor capability. Root selection belongs to Main. */
export type FlowEditorBootstrap = { project: ProjectV1; sessionId: string; folderName: string };
export type FolderStatus = 'current' | 'pending' | 'external' | 'both' | 'missing' | 'unfinished' | TrashRecovery;
export type TrashRecovery = { kind: 'trash-recovery'; name: string; directory: string; state: 'restore' | 'retry' | 'inspect' };
export type FolderStatusRequest = { project: ProjectV1; inspectDisk: boolean };

/** Main owns the roots. The renderer names a target kind and, at most, an opaque
 * recent/draft identifier; it never supplies a path for a write. */
export type FlowProjectTarget =
  | { kind: 'pending' }
  | { kind: 'recent'; id: string }
  | { kind: 'create'; draftId: string };
/** The simplified entry asks Main to inspect one folder. A Flow project is held
 * as a one-shot pending target; image folders (including a retired
 * `.storyboard-workbench`) become a creation draft the renderer confirms. */
export type FlowOpenChoice =
  | { canceled: true }
  | { kind: 'project' }
  | { kind: 'import'; draft: FlowCreateDraftView };
export type FlowLaunchResult = { canceled: true } | { canceled: false; bootstrap: FlowEditorBootstrap };
export type FlowRecentProject = { id: string; name: string; available: boolean; /** Display-only shortest unique suffix; never used as a write path. */ target: string };
export type FlowLauncherState = { recent: FlowRecentProject[]; open: boolean; currentId: string | null };
export type FlowRelocateResult = { canceled: true } | { ok: true } | { ok: false; message: string };

export type FlowCreateSourceView =
  | { kind: 'none' }
  | { kind: 'files'; label: string; count: number }
  | { kind: 'folder'; label: string };
/** `blank` starts from an empty project; `images` reads a folder or a file list.
 * Both derive the new folder from the project name, so the sheet only asks for
 * a name and a location. */
export type FlowCreateMode = 'images' | 'blank';
export type FlowCreateDraftView = {
  id: string;
  mode: FlowCreateMode;
  /** The source folder is a retired `.storyboard-workbench` folder: its images are
   * imported, its old ordering and dialogue are not. */
  legacy: boolean;
  /** Direct supported images in the source folder; 0 for a blank project. */
  imageCount: number;
  source: FlowCreateSourceView;
  destination: { label: string } | null;
  /** Derived from the project name; shown so the user sees the folder it creates. */
  folderName: string;
  name: string;
  naming: ProjectNamingV1;
};
export type FlowCreatePatch = { folderName?: string; name?: string; naming?: ProjectNamingV1 };
export type FlowCreateProgress = { draftId: string; done: number; total: number; phase?: 'read' | 'write' };
export type FlowCreateIssues = { requestId: string; draftId: string; issues: CreateImageProjectIssue[] };

export type FlowPendingMode = 'files' | 'folder';
/** The bridge request is created by the Session and only carries the mode and an
 * opaque operation id. Main owns the source paths and the owner/window binding. */
export type FlowPendingBridgeRequest = { mode: FlowPendingMode; operationId: string; recover: boolean };
export type FlowPendingProgress = { operationId: string; done: number; total: number; phase?: 'read' | 'write' };
export type FlowPendingIssues = { requestId: string; operationId: string; issues: CreateImageProjectIssue[] };

export type FlowEditorBridge = {
  read(sessionId: string, id: string): ReturnType<FlowAssetDepot['read']>;
  put(sessionId: string, input: Parameters<FlowAssetDepot['put']>[0]): ReturnType<FlowAssetDepot['put']>;
  switchProject(sessionId: string, project: ProjectV1, target: FlowProjectTarget): Promise<FlowEditorBootstrap | null>;
  open(): Promise<FlowEditorBootstrap>;
  refresh(sessionId:string,project:ProjectV1):Promise<FlowResult<ProjectV1>>;
  folderStatus(sessionId: string, request: FolderStatusRequest): Promise<FolderStatus>;
  /** Read-only bound filenames; the naming sheet uses them once so its sample equals Save. */
  outputNames(sessionId: string, project: ProjectV1): Promise<{ shotId: string; name: string }[]>;
  saveTiff(sessionId: string, project: ProjectV1): Promise<{ ok: true; value: { projectId: string; revision: number; projectHash: string } } | { ok: false; error: { message: string } }>;
  checkpoint(sessionId: string, project: ProjectV1): Promise<ResultV1<CheckpointReceiptV1>>;
  onClose(listener: (requestId: string) => void): () => void;
  finishClose(sessionId: string, requestId: string, project: ProjectV1 | null): Promise<{ ok: boolean; message?: string }>;
  launcherState(): Promise<FlowLauncherState>;
  /** Display label only; the recorded root and project identity never change here. */
  updateRecentName(sessionId: string, name: string): Promise<void>;
  removeRecent(id: string): Promise<void>;
  /** Rebind a missing recent target only after its project identity matches. */
  relocateRecent(id: string): Promise<FlowRelocateResult>;
  launch(target: FlowProjectTarget): Promise<FlowLaunchResult>;
  /** Shows one folder picker and classifies it: an existing Flow project is held
   * as a one-shot pending target, image folders become a creation draft, and a
   * damaged Flow project is refused instead of being imported as images. */
  chooseOpen(): Promise<FlowOpenChoice>;
  createDraft(mode: FlowCreateMode): Promise<FlowCreateDraftView>;
  createChooseSource(draftId: string, kind: 'files' | 'folder'): Promise<FlowCreateDraftView | { canceled: true }>;
  createChooseDestination(draftId: string): Promise<FlowCreateDraftView | { canceled: true }>;
  createUpdate(draftId: string, patch: FlowCreatePatch): Promise<FlowCreateDraftView>;
  createAbort(draftId: string): Promise<void>;
  createDiscard(draftId: string): Promise<void>;
  respondCreateIssues(requestId: string, decision: 'continue' | 'cancel'): Promise<boolean>;
  onCreateProgress(listener: (progress: FlowCreateProgress) => void): () => void;
  onCreateIssues(listener: (issues: FlowCreateIssues) => void): () => void;
  /** True only when the Main runtime can append into Pending. */
  pendingCapability(): Promise<boolean>;
  pendingAdd(sessionId: string, project: ProjectV1, request: FlowPendingBridgeRequest): Promise<FlowResult<ProjectV1>>;
  cancelPendingAdd(sessionId: string, operationId: string): Promise<void>;
  respondPendingIssues(requestId: string, decision: 'continue' | 'cancel'): Promise<boolean>;
  onPendingProgress(listener: (progress: FlowPendingProgress) => void): () => void;
  onPendingIssues(listener: (issues: FlowPendingIssues) => void): () => void;
};
