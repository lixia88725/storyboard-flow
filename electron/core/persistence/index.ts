import type { ProjectStoreV1 } from '../../shared/refactorV1.js';
import { loadCheckpoint, saveCheckpoint } from './checkpoint.js';

/**
 * Wave-1 persistence entry point (see docs/refactor/CONTRACTS.md).
 *
 * Candidate format only: nothing in the production Save, Close, recovery or TIFF
 * path calls this store yet, and no legacy project is migrated by it.
 */
export const createProjectStore = (): ProjectStoreV1 => ({ saveCheckpoint, loadCheckpoint });
