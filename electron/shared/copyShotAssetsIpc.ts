// Plain data crosses invoke/contextBridge; decode only in the renderer.
export type RetainedCopyEffect = {
  filePath: string;
  kind: "image" | "layer" | "preview" | "staging";
  effect: "committed" | "unknown";
};
export type CopyShotAssetsFailure = {
  ok: false;
  error: { code: "COPY_RECOVERY_INCOMPLETE"; message: string; retainedEffects: RetainedCopyEffect[] };
};
export class CopyShotAssetsIpcError extends Error {
  readonly code = "COPY_RECOVERY_INCOMPLETE";
  readonly recoveryIncomplete = true;
  readonly retainedEffects: RetainedCopyEffect[];
  constructor(failure: CopyShotAssetsFailure["error"]) {
    super(failure.message);
    this.name = "CopyShotAssetsIpcError";
    this.retainedEffects = failure.retainedEffects;
  }
}
export const decodeCopyShotAssetsResult = <T>(value: T | CopyShotAssetsFailure): T => {
  if (value && typeof value === "object" && "ok" in value) {
    if (value.ok === false) throw new CopyShotAssetsIpcError((value as CopyShotAssetsFailure).error);
    throw new Error("Invalid Copy result; no storyboard published");
  }
  return value as T;
};
