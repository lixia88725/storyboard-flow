export type LayerAssetSnapshot = {
  bitmapPath: string;
  dataUrl?: string;
};

export type HistoryOperationInput = { folderPath:string;project:unknown;targetProject:unknown;assets:LayerAssetSnapshot[] };
export type LayerAssetApi = {
  beginHistoryAssets?: (payload:HistoryOperationInput)=>Promise<{operation:string|null}>;
  stepHistoryAssets?: (payload:{operation:string;index:number})=>Promise<boolean>;
  compensateHistoryAssets?: (payload:{operation:string})=>Promise<{assets:HistoryAssetFact[];compensated:boolean}>;
  readLayerPng?: (payload: { folderPath: string; bitmapPath: string }) => Promise<string | undefined>;
  writeLayerPng: (payload: {
    folderPath: string;
    bitmapPath: string;
    dataUrl: string;
  }) => Promise<{ folderPath: string; bitmapPath: string; dataUrl: string; filePath: string }>;
  deleteLayerPng: (payload: { folderPath: string; bitmapPath: string }) => Promise<{
    folderPath: string;
    bitmapPath: string;
  }>;
};

export const readLayerAssetSnapshots = async (
  api: Pick<LayerAssetApi, "readLayerPng">,
  folderPath: string,
  bitmapPaths: string[]
): Promise<LayerAssetSnapshot[]> =>
  readAllLayerAssetSnapshots(api, folderPath, bitmapPaths);

const readAllLayerAssetSnapshots = async (
  api: Pick<LayerAssetApi, "readLayerPng">, folderPath: string, bitmapPaths: string[]
): Promise<LayerAssetSnapshot[]> => {
  if (!api.readLayerPng) throw new Error("History PNG reader unavailable; absence is not proved");
  // All reads have already started. A rejected read must not release the queue
  // while another read is still using the original Root.
  const results = await Promise.allSettled(bitmapPaths.map(async bitmapPath => {
    const dataUrl = await api.readLayerPng!({ folderPath, bitmapPath });
    // Absence is a durable History fact. An own `undefined` key survives IPC but
    // not JSON, so omit it here and let every reader treat the missing key as absence.
    return dataUrl === undefined ? { bitmapPath } : { bitmapPath, dataUrl };
  }));
  const failure = results.find(result => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map(result => (result as PromiseFulfilledResult<LayerAssetSnapshot>).value);
};

export type HistoryAssetFact = {
  bitmapPath: string;
  before?: string;
  desired?: string;
  actual?: string;
  observed: boolean;
  started: boolean;
  acknowledged: boolean;
  compensationStarted: boolean;
  compensationAcknowledged: boolean;
  restoreError?: string;
  restoreUnresolved?: boolean;
  restoreEffect?: string;
  retainedTemporary?: string | null;
  compensationError?: string;
  compensationEffect?: string;
  compensationRetainedTemporary?: string | null;
};

export class HistoryAssetRestoreFailure extends Error {
  constructor(
    readonly originalError: unknown,
    readonly folderPath: string,
    readonly assets: HistoryAssetFact[]
  ) {
    const residual = assets.filter(a => a.started && (!a.observed || a.actual !== a.before || a.restoreUnresolved || a.compensationError));
    super(`${originalError instanceof Error ? originalError.message : String(originalError)}; ` +
      (residual.length ? `History compensation incomplete (${residual.map(a => a.bitmapPath).join(", ")})` : "History PNGs restored to original versions"));
    this.name = "HistoryAssetRestoreFailure";
  }
  get compensated() {
    return this.assets.every(a => !a.started || a.observed && a.actual === a.before && !a.restoreUnresolved && !a.compensationError);
  }
}

/** In-process compensation, not a cross-process/crash transaction or permission
 * certificate. Every writer/reader remains the original API's protected port.
 * Failed ACKs may have committed: observe them before deciding what to restore.
 * Keep both errors and final bytes/absence when compensation itself fails. */
export const restoreHistoryAssetTransaction = async (
  api: LayerAssetApi, folderPath: string, desired: LayerAssetSnapshot[],
  before: LayerAssetSnapshot[], isCurrent: () => boolean, project?:unknown,targetProject?:unknown,
  canCompleteOriginal?: () => boolean
): Promise<{ compensate: (error: unknown) => Promise<never> }> => {
  if (!api.readLayerPng || new Set(desired.map(a => a.bitmapPath)).size !== desired.length ||
      desired.length !== before.length || desired.some((a, i) => a.bitmapPath !== before[i].bitmapPath)) {
    throw new Error("History reciprocal asset inventory unavailable or ambiguous");
  }
  const protectedPort=api.beginHistoryAssets;
  if(protectedPort){
    if(!api.stepHistoryAssets||!api.compensateHistoryAssets)throw new Error('History private operation ports incomplete');
    const {operation}=await protectedPort({folderPath,project,targetProject,assets:desired});
    if(operation!==null){
    const compensate=async(error:unknown):Promise<never>=>{
      const result=await api.compensateHistoryAssets!({operation});
      const failure=new HistoryAssetRestoreFailure(error,folderPath,result.assets);
      if(!result.compensated&&failure.compensated)throw new Error('Main History compensation uncertified');
      throw failure;
    };
    try{for(let index=0;index<desired.length;index++){
      if(!isCurrent())throw new Error('History restore origin or Project changed');
      await api.stepHistoryAssets({operation,index});
      if(!isCurrent() && !(index === desired.length - 1 && canCompleteOriginal?.()))throw new Error('History restore origin or Project changed after PNG write');
    }}catch(error){return compensate(error);}
    return {compensate};
    }
  }
  const facts: HistoryAssetFact[] = desired.map((a, i) => ({ bitmapPath: a.bitmapPath,
    before: before[i].dataUrl, desired: a.dataUrl, actual: before[i].dataUrl,
    observed: true, started: false, acknowledged: false,
    compensationStarted: false, compensationAcknowledged: false }));
  const write = (bitmapPath: string, dataUrl: string | undefined) => dataUrl === undefined
    ? api.deleteLayerPng({ folderPath, bitmapPath })
    : api.writeLayerPng({ folderPath, bitmapPath, dataUrl });
  const text = (error: unknown) => error instanceof Error ? error.message : String(error);
  const errorFacts = (error: unknown) => {
    const details = error && typeof error === 'object' ? error as { effect?: unknown; retainedTemporary?: unknown } : {};
    const effect = typeof details.effect === 'string' ? details.effect : undefined;
    const retainedTemporary = typeof details.retainedTemporary === 'string' || details.retainedTemporary === null
      ? details.retainedTemporary : undefined;
    // IPC may erase custom fields. This message check only keeps protection;
    // it is never permission to execute a write or certify an ACK.
    const unresolved = effect === 'committed' || effect === 'unknown' || !!retainedTemporary ||
      /\[PNG_(COMMITTED|UNKNOWN)\]|retained staging/u.test(text(error));
    return { effect, retainedTemporary, unresolved };
  };
  const observe = async (fact: HistoryAssetFact) => {
    try { fact.actual = await api.readLayerPng!({ folderPath, bitmapPath: fact.bitmapPath }); fact.observed = true; }
    catch { fact.observed = false; delete fact.actual; }
  };
  const compensate = async (error: unknown): Promise<never> => {
    for (const fact of [...facts].reverse()) {
      if (!fact.started) continue;
      await observe(fact);
      if (fact.observed && fact.actual === fact.before) continue;
      // Unknown or independently replaced bytes cannot be safely overwritten.
      if (!fact.observed || fact.actual !== fact.desired) continue;
      fact.compensationStarted = true;
      try { await write(fact.bitmapPath, fact.before); fact.compensationAcknowledged = true; }
      catch (compensationError) {
        fact.compensationError = text(compensationError);
        const details = errorFacts(compensationError);
        if (details.effect !== undefined) fact.compensationEffect = details.effect;
        if (details.retainedTemporary !== undefined) fact.compensationRetainedTemporary = details.retainedTemporary;
      }
      await observe(fact);
    }
    throw new HistoryAssetRestoreFailure(error, folderPath, facts);
  };
  try {
    for (const fact of facts) {
      if (!isCurrent()) throw new Error("History restore origin or Project changed");
      fact.started = true;
      try { await write(fact.bitmapPath, fact.desired); fact.acknowledged = true; }
      catch (error) {
        fact.restoreError = text(error);
        const details = errorFacts(error);
        if (details.unresolved) fact.restoreUnresolved = true;
        if (details.effect !== undefined) fact.restoreEffect = details.effect;
        if (details.retainedTemporary !== undefined) fact.retainedTemporary = details.retainedTemporary;
        throw error;
      }
      // Admission loss must stop further effects. Only the last acknowledged
      // asset can finish its still-installed original transaction; it cannot
      // authorize another write or ordinary publication into a newer scope.
      if (!isCurrent() && !(fact === facts.at(-1) && canCompleteOriginal?.())) {
        throw new Error("History restore origin or Project changed after PNG write");
      }
    }
  } catch (error) {
    return compensate(error);
  }
  // The caller's awaited continuation is one further publication boundary.
  // Retain this original reciprocal until its synchronous publication starts.
  return { compensate };
};

export const restoreLayerAssetSnapshots = async (
  api: LayerAssetApi,
  folderPath: string,
  snapshots: LayerAssetSnapshot[]
) => {
  for (const snapshot of snapshots) {
    if (snapshot.dataUrl) {
      await api.writeLayerPng({
        folderPath,
        bitmapPath: snapshot.bitmapPath,
        dataUrl: snapshot.dataUrl
      });
    } else {
      await api.deleteLayerPng({
        folderPath,
        bitmapPath: snapshot.bitmapPath
      });
    }
  }
};
