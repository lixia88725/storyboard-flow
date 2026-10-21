import { execFile } from "node:child_process";
import { createHash, randomUUID } from 'node:crypto';
import { authenticateOwnedStagePublication, copyOriginalOwnedStageReceipt, type OwnedStagePublicationReceipt } from './ownedStagePublication.js';
import { fileURLToPath } from "node:url";
import { pythonCommandCandidates } from "./pythonRuntime.js";
import { withLayerFileOperation, recordLayerFileCommit } from "./layerFileOperationQueue.js";
import { beforeProducerPngWrite, performProducerPngPhysicalWrite, recordProducerPng } from './producerPngEffects.js';
import { createNativeAuthorizationSession, NATIVE_AUTHORIZATION_TRANSPORT_BYTES } from './nativeAuthorizationSession.js';

export const planProtectedPngWrite = async (root:string,filePath:string,bytes:Buffer,mode:'upsert'|'create-only',byteLimit:number,python:string):Promise<Record<string,any>> => {
  const digest=createHash('sha256').update(bytes).digest('hex');
  const result=await createNativeAuthorizationSession(python,fileURLToPath(new URL('../../scripts/layer-file-permissions.py',import.meta.url)),()=>NATIVE_AUTHORIZATION_TRANSPORT_BYTES)
    .request({phase:'planPng',root,filePath,length:bytes.length,digest,mode,byteLimit});
  const plan=result.plan;
  if(result.authorized!==true||plan?.schema!=='swb.native-png-plan.v1'||plan.root!==root||plan.filePath!==filePath||plan.digest!==digest||plan.length!==bytes.length||plan.mode!==mode||plan.byteLimit!==byteLimit||![plan.peakBytes,plan.peakRecords,plan.stagePeak].every(n=>Number.isSafeInteger(n)&&n>0))throw new Error('Native PNG creation plan not certified');
  return plan;
};

export type ProtectedLayerWriteResult = {
  effect: "committed";
  filePath: string;
  identity: { dev: string; ino: string };
  retainedTemporary?: string | null;
  warnings?: string[];
  ownedStageReceipt?: OwnedStagePublicationReceipt;
};

/** Preserve native effect facts for local compensation and plain IPC results.
 * A failed promise is not evidence that its target or staging stayed absent. */
export class ProtectedLayerWriteError extends Error {
  receiptError?: unknown;
  warnings?: string[];
  ownedStageReceipt?: OwnedStagePublicationReceipt;
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
  const operation = randomUUID();
  for (const candidate of pythonCommandCandidates({})) {
    type NativeResponse={startupMissing?:boolean;value?:unknown;error?:string};
    let physicalOutcome:NativeResponse|undefined,accountingFailure:unknown,accountingFailed=false,result:NativeResponse;
    try{result=await performProducerPngPhysicalWrite({root,filePath,bytes,mode},async writePlan=>{
    const request = JSON.stringify({ root, filePath, bytes: bytes.toString("base64"), mode, operation, ...(writePlan?{writePlan}:{}) });
    physicalOutcome=await new Promise<NativeResponse>(resolve => {
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
    return physicalOutcome;
    });}catch(error){
      // A later quota/census rejection must not erase a genuine committed
      // Native outcome. Authenticate it below, then deliver original producer
      // facts outside the active physical claim before surfacing this failure.
      if(!physicalOutcome||physicalOutcome.startupMissing)throw error;
      result=physicalOutcome!;accountingFailure=error;accountingFailed=true;
    }
    if (result.startupMissing) continue;
    const accountingNote=accountingFailed?`; PNG accounting outcome unknown: ${(()=>{try{return String(accountingFailure);}catch{return 'unprintable accounting failure';}})()}`:'';
    if (result.error) throw new ProtectedLayerWriteError("unknown", filePath, result.error+accountingNote);
    const value = result.value as Partial<ProtectedLayerWriteResult> & { message?: string };
    if (!value || value.effect !== "committed" || value.filePath !== filePath ||
        !value.identity || typeof value.identity.dev !== "string" || typeof value.identity.ino !== "string" ||
        !/^\d+$/.test(value.identity.dev) || !/^\d+$/.test(value.identity.ino) ||
        value.retainedTemporary !== undefined && value.retainedTemporary !== null && typeof value.retainedTemporary !== "string" ||
        value.warnings !== undefined && (!Array.isArray(value.warnings) || value.warnings.some(x => typeof x !== "string"))) {
      const effect = (value as { effect?: string } | undefined)?.effect;
      throw new ProtectedLayerWriteError(effect === "refused" ? "refused" : "unknown", filePath,
        (value?.message ?? "invalid write result")+accountingNote,
        typeof value?.retainedTemporary === "string" ? value.retainedTemporary : effect === "refused" ? null : undefined);
    }
    let ownedStageReceipt: OwnedStagePublicationReceipt | undefined, ownedStageReceiptError: string | undefined;
    if (value.ownedStageReceipt !== undefined) {
      try { ownedStageReceipt = authenticateOwnedStagePublication(value.ownedStageReceipt, { operation, root, target: filePath, stage: value.retainedTemporary, identity: value.identity, bytes }); }
      catch (error) { ownedStageReceiptError = String(error); }
      // A malformed proof never leaks through an otherwise committed callback.
      delete value.ownedStageReceipt;
      if (ownedStageReceipt) value.ownedStageReceipt = ownedStageReceipt;
    }
    if(accountingFailed)value.warnings=[...(value.warnings??[]),accountingNote.slice(2)];
    recordLayerFileCommit();
    onCommitted?.((ownedStageReceipt ? { ...value, ownedStageReceipt: copyOriginalOwnedStageReceipt(ownedStageReceipt) } : value) as ProtectedLayerWriteResult);
    const cleanupError = value.retainedTemporary || value.warnings?.length || ownedStageReceiptError
      ? new ProtectedLayerWriteError("committed", filePath,
        `PNG bytes were committed but temporary cleanup is incomplete: ${value.retainedTemporary ?? value.warnings?.join("; ")}`,
        value.retainedTemporary, value.identity) : undefined;
    if (cleanupError) {
      cleanupError.warnings = [...(value.warnings ?? []), ...(ownedStageReceiptError ? [ownedStageReceiptError] : [])];
      if (ownedStageReceipt) cleanupError.ownedStageReceipt = copyOriginalOwnedStageReceipt(ownedStageReceipt);
    }
    try {
      // A committed warning is still a genuine new version. Deliver its receipt
      // before surfacing failure; never discard bytes or staging to certify it.
      await recordProducerPng({ filePath, identity: value.identity, bytes, kind: 'written',
        ...(cleanupError ? { commitFailure: { effect: 'committed' as const, retainedTemporary: value.retainedTemporary ?? null, warnings: [...(cleanupError.warnings ?? [])], ...(ownedStageReceipt ? { ownedStageReceipt } : {}) } } : {}) });
    } catch (receiptError) {
      const error = cleanupError ?? new ProtectedLayerWriteError("committed", filePath,
        "PNG bytes were committed but producer receipt retention failed", value.retainedTemporary, value.identity);
      error.receiptError = receiptError;
      error.message += `; receipt retention: ${receiptError instanceof Error ? receiptError.message : String(receiptError)}`;
      throw error;
    }
    if (cleanupError) throw cleanupError;
    return value as ProtectedLayerWriteResult;
  }
  throw new ProtectedLayerWriteError("refused", filePath,
    "No existing Python interpreter available for permission-safe layer writes", null);
});
