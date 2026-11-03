import type { CoreErrorCodeV1, ResultV1 } from '../../../platform/contracts/refactorV1.js';

/** A failure that already carries the contract code callers receive. */
export class ProjectStoreError extends Error {
  readonly code: CoreErrorCodeV1;

  constructor(code: CoreErrorCodeV1, message: string) {
    super(message);
    this.name = 'ProjectStoreError';
    this.code = code;
  }
}

export const storeFailure = <T>(code: CoreErrorCodeV1, message: string): ResultV1<T> => ({
  ok: false,
  error: { code, message }
});

/** Map anything thrown inside the store onto a contract failure. Unknown errors
 * are I/O failures: a bug must not be reported as caller input error. */
export const storeFailureOf = <T>(error: unknown, fallback: CoreErrorCodeV1 = 'io-failure'): ResultV1<T> => {
  if (error instanceof ProjectStoreError) return { ok: false, error: { code: error.code, message: error.message } };
  const message = error instanceof Error ? error.message : String(error);
  return { ok: false, error: { code: fallback, message } };
};

export const errnoCode = (error: unknown): string | undefined => {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
};

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
