export type ReadonlyRecovery = {
 state: 'protectedReadable' | 'protectedIncomplete'; revision: string; projectRaw: unknown; effectFacts: unknown;
 viewState?: unknown;
 continuationState?: unknown;
 original?: unknown;
 assets: { role: string; dataUrl: string }[];
};
