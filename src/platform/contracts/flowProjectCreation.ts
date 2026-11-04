import type { ProjectNamingV1 } from './refactorV1.js';

/** The file-module creation contract. Main owns every absolute path; the renderer
 * only ever submits field values for a draft that Main already holds. */
export type CreateImageProjectSource =
  | { kind: 'files'; files: string[] }
  | { kind: 'folder'; folder: string };

export type CreateImageProjectInput = {
  source: CreateImageProjectSource;
  destinationParent: string;
  folderName: string;
  name: string;
  naming: ProjectNamingV1;
};

export type CreateImageProjectIssue = { file: string; reason: string; action: 'skip' | 'flatten' };
export type CreateImageProjectDecision = 'continue' | 'cancel';
export type CreateImageProjectOptions = {
  signal: AbortSignal;
  /** `phase` distinguishes reading sources from writing/publishing the project. */
  onProgress?: (progress: { done: number; total: number; phase?: 'read' | 'write' }) => void;
  decideIssues?: (issues: CreateImageProjectIssue[]) => Promise<CreateImageProjectDecision>;
};

/** Resolves to the created project root. Cancellation and failure reject; a
 * successful return means the complete project was published at that root. */
export type CreateImageProject = (
  input: CreateImageProjectInput,
  options: CreateImageProjectOptions
) => Promise<{ root: string }>;
