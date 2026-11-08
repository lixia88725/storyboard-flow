/** One project authority: the append-only recovery journal. Legacy files are never migrated. */
export { openJournalProjectStore as openImageProjectStore } from './journalProjectStore.js';
export { ImageProjectStoreError } from './projectStoreRecords.js';
export type { ProjectConfirmation, ProjectCommitReceipt, ProjectStoreV2, ImageProjectStoreOptions } from './projectStoreRecords.js';
