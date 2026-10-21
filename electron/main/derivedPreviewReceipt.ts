import { AsyncLocalStorage } from 'node:async_hooks';
export type DerivedPreviewReceipt = { root: string; original: unknown; derived: unknown; images: { shotId: string; source: string; sourceDigest: string; preview: string; previewDigest: string; pixels: string }[] };
const context = new AsyncLocalStorage<(receipt: DerivedPreviewReceipt) => Promise<void>>();
export const withDerivedPreviewReceipt = <T>(record: (receipt: DerivedPreviewReceipt) => Promise<void>, run: () => Promise<T>) => context.run(record, run);
export const recordsDerivedPreview = () => !!context.getStore();
export const recordDerivedPreview = async (receipt: DerivedPreviewReceipt) => { await context.getStore()?.(receipt); };
