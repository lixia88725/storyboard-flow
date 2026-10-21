export type ReadonlyRecovery = {
 state: 'protectedReadable' | 'protectedIncomplete'; revision: string; projectRaw: unknown; effectFacts: unknown;
 viewState?: unknown;
 continuationState?: unknown;
 original?: unknown;
 assets: { role: string; dataUrl: string; sourceDataUrl?: string }[];
};

/** A continuation receipt never acknowledges the original failed Save. */
export type PartialSaveBootstrap = { session: string; revision: string; recovery: ReadonlyRecovery; originalSaveAcknowledged: false };
export type PartialSaveEdit = { session: string; revision: string; projectRaw: unknown; viewState: unknown; desiredAssets: { shotId: string; layerId: string; dataUrl: string }[] };
