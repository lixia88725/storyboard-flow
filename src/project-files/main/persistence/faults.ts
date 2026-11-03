/** Internal fault seam for deterministic failure tests.
 *
 * This is NOT part of the public ProjectStoreV1 interface and must not be used by
 * production code: it exists because "the head temporary file was written but the
 * rename did not happen" cannot be produced reliably with real permissions.
 * Every other failure in the checkpoint protocol is exercised with real
 * filesystem behaviour (read-only directories, unreadable entries, ...). */
export type FaultPoint =
  /** After the head temporary file is written and flushed, before the rename. */
  | 'beforeHeadReplace'
  /** After the version record is published, before the head is written. */
  | 'beforeHeadWrite';

let injector: ((point: FaultPoint) => void) | undefined;

export const setFaultInjector = (next: ((point: FaultPoint) => void) | undefined): void => {
  injector = next;
};

export const triggerFault = (point: FaultPoint): void => {
  injector?.(point);
};
