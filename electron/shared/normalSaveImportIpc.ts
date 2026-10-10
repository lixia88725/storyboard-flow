// Explicit, structured-clone-safe business result for the normal-Save Import IPC boundary.
//
// A thrown Error does NOT faithfully cross `ipcRenderer.invoke`: Electron transports the
// primitive message, drops custom own-properties and does not preserve a custom `name`.
// The owner must therefore never infer a recovery-incomplete Import from a thrown error's
// `name`/`message`. Instead main RETURNS plain data through invoke AND contextBridge;
// the renderer consumer decodes it locally, after the last serialization boundary.
export const importRecoveryIncompleteCode = "IMPORT_RECOVERY_INCOMPLETE";

export type NormalSaveImportFailure = { code: string; message: string };

export type NormalSaveImportIpcResult<T> =
  | { ok: true; result: T }
  | { ok: false; error: NormalSaveImportFailure };

// The decoded business error. `code` is the discriminant the owner matches on; it is set by
// the renderer-local decode function after contextBridge, never an Error crossing the bridge.
export class NormalSaveImportIpcError extends Error {
  readonly code: string;
  readonly recoveryIncomplete: boolean;

  constructor(failure: NormalSaveImportFailure) {
    super(failure.message);
    this.name = "NormalSaveImportIpcError";
    this.code = failure.code;
    this.recoveryIncomplete = failure.code === importRecoveryIncompleteCode;
  }
}

export const normalSaveImportFailure = (error: { message?: string }): NormalSaveImportIpcResult<never> => ({
  ok: false,
  error: { code: importRecoveryIncompleteCode, message: error.message ?? "Import recovery incomplete" }
});

// Decodes the actual return envelope from the real main handler. A bare legacy payload (no
// `ok` discriminant) is returned unchanged, so ordinary/legacy returns stay compatible.
export const decodeNormalSaveImportResult = <T>(value: unknown): T => {
  if (!value || typeof value !== "object" || !("ok" in value)) {
    return value as T;
  }
  const envelope = value as NormalSaveImportIpcResult<T>;
  if (envelope.ok) return envelope.result;
  throw new NormalSaveImportIpcError(envelope.error);
};
