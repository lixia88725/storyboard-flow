import { AsyncLocalStorage } from 'node:async_hooks';
import type { OwnedStagePublicationReceipt } from './ownedStagePublication.js';
import type { ReservationPhysicalControl } from './originWorkspaceAccounting.js';

/** Private Main effect context. Never an IPC field or renderer nonce. */
export type ProducerPngReceipt = { filePath: string; identity: { dev: string; ino: string }; bytes: Buffer; kind: 'created' | 'written'; originalAbsence?: { project: unknown; shotId: string; layerId: string }; commitFailure?: { effect: 'committed'; retainedTemporary: string | null; warnings: string[]; ownedStageReceipt?: OwnedStagePublicationReceipt } };
type Effects = {
  physicalWrite?: <T>(request: {root:string;filePath:string;bytes:Buffer;mode:'upsert'|'create-only';kind?:'node-exclusive-create'}, execute:(plan?:Record<string,any>,control?:ReservationPhysicalControl)=>Promise<T>)=>Promise<T>;
  beforeWrite: (file: string) => Promise<void>;
  written: (receipt: ProducerPngReceipt) => Promise<void>;
  beforeDelete: (file: string) => Promise<void>;
  deleted: (file: string) => Promise<void>;
};
const effects = new AsyncLocalStorage<Effects>();
export const withProducerPngEffects = <T>(ports: Effects, run: () => Promise<T>) => effects.run(ports, run);
export const beforeProducerPngWrite = async (file: string) => { await effects.getStore()?.beforeWrite(file); };
export const performProducerPngPhysicalWrite = <T>(request: {root:string;filePath:string;bytes:Buffer;mode:'upsert'|'create-only';kind?:'node-exclusive-create'}, execute:(plan?:Record<string,any>,control?:ReservationPhysicalControl)=>Promise<T>):Promise<T> => {
  const port=effects.getStore()?.physicalWrite;return port?port(request,execute):execute();
};
export const recordProducerPng = async (receipt: ProducerPngReceipt) => { await effects.getStore()?.written(receipt); };
export const beforeProducerPngDelete = async (file: string) => { await effects.getStore()?.beforeDelete(file); };
export const recordProducerPngDelete = async (file: string) => { await effects.getStore()?.deleted(file); };
