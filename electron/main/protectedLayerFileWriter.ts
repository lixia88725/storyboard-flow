import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pythonCommandCandidates } from "./pythonRuntime.js";
import { withLayerFileOperation, recordLayerFileCommit } from "./layerFileOperationQueue.js";
import { beforeProducerPngWrite, recordProducerPng } from './producerPngEffects.js';

export type ProtectedLayerWriteResult = {
  effect: "committed";
  filePath: string;
  identity: { dev: string; ino: string };
  retainedTemporary?: string | null;
  warnings?: string[];
};

/** Preserve native effect facts for local compensation and plain IPC results.
 * A failed promise is not evidence that its target or staging stayed absent. */
export class ProtectedLayerWriteError extends Error {
  constructor(
    readonly effect: "committed" | "refused" | "unknown",
    readonly filePath: string,
    message: string,
    readonly retainedTemporary: string | null | undefined = undefined,
    readonly identity?: ProtectedLayerWriteResult["identity"]
  ) {
    super(`[PNG_${effect.toUpperCase()}] ${message}; target: ${filePath}` +
      (retainedTemporary ? `; retained staging: ${retainedTemporary}` : ""));
    this.name = "ProtectedLayerWriteError";
  }
}

export const hasUnresolvedProtectedWrite = (error: unknown): error is ProtectedLayerWriteError =>
  error instanceof ProtectedLayerWriteError && (error.effect !== "refused" || Boolean(error.retainedTemporary));

/** No fallback to in-place overwrite. Helper startup failures may try another
 * existing interpreter; once started, failure/timeout is an unknown effect. */
export const writeProtectedLayerFile = (
  root: string,
  filePath: string,
  bytes: Buffer,
  mode: "upsert" | "create-only" = "upsert",
  onCommitted?: (receipt: ProtectedLayerWriteResult) => void
): Promise<ProtectedLayerWriteResult> => withLayerFileOperation(async () => {
  await beforeProducerPngWrite(filePath);
  const script = fileURLToPath(new URL("../../scripts/layer-file-permissions.py", import.meta.url));
  const request = JSON.stringify({ root, filePath, bytes: bytes.toString("base64"), mode });
  for (const candidate of pythonCommandCandidates({})) {
    const result = await new Promise<{ startupMissing?: boolean; value?: unknown; error?: string }>(resolve => {
      const child = execFile(candidate.executable, [...(candidate.args ?? []), "-I", "-B", script, "--write-stdin"],
        { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" }, timeout: 30000, maxBuffer: 65536 },
        (error, stdout, stderr) => {
          if (error) {
            resolve({ startupMissing: error.code === "ENOENT", error: String(error.message) + "; " + stderr });
          } else {
            try { resolve({ value: JSON.parse(stdout) }); }
            catch { resolve({ error: "invalid permission helper response" }); }
          }
        });
      // No shell/command-line PNG payload, no interpreter install or global env change.
      child.stdin?.on("error", () => undefined);
      child.stdin?.end(request);
    });
    if (result.startupMissing) continue;
    if (result.error) throw new ProtectedLayerWriteError("unknown", filePath, result.error);
    const value = result.value as Partial<ProtectedLayerWriteResult> & { message?: string };
    if (!value || value.effect !== "committed" || value.filePath !== filePath ||
        !value.identity || typeof value.identity.dev !== "string" || typeof value.identity.ino !== "string" ||
        !/^\d+$/.test(value.identity.dev) || !/^\d+$/.test(value.identity.ino) ||
        value.retainedTemporary !== undefined && value.retainedTemporary !== null && typeof value.retainedTemporary !== "string" ||
        value.warnings !== undefined && (!Array.isArray(value.warnings) || value.warnings.some(x => typeof x !== "string"))) {
      const effect = (value as { effect?: string } | undefined)?.effect;
      throw new ProtectedLayerWriteError(effect === "refused" ? "refused" : "unknown", filePath,
        value?.message ?? "invalid write result",
        typeof value?.retainedTemporary === "string" ? value.retainedTemporary : effect === "refused" ? null : undefined);
    }
    recordLayerFileCommit();
    onCommitted?.(value as ProtectedLayerWriteResult);
    if (value.retainedTemporary || value.warnings?.length) {
      throw new ProtectedLayerWriteError("committed", filePath,
        `PNG bytes were committed but temporary cleanup is incomplete: ${value.retainedTemporary ?? value.warnings?.join("; ")}`,
        value.retainedTemporary, value.identity);
    }
    await recordProducerPng({ filePath, identity: value.identity, bytes, kind: 'written' });
    return value as ProtectedLayerWriteResult;
  }
  throw new ProtectedLayerWriteError("refused", filePath,
    "No existing Python interpreter available for permission-safe layer writes", null);
});
