import type { ProjectStoreV1 } from '../../../platform/contracts/refactorV1.js';
import { loadCheckpoint, saveCheckpoint } from './checkpoint.js';

/**
 * Checkpoint persistence entry point (see docs/ARCHITECTURE.md).
 *
 * Stores internal project checkpoints; working TIFF publication belongs to the Save service.
 * Legacy projects are not migrated by this store.
 */
export const createProjectStore = (): ProjectStoreV1 => ({ saveCheckpoint, loadCheckpoint });
