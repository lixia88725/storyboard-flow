import { AsyncLocalStorage } from 'node:async_hooks';
import { constants as bufferConstants } from 'node:buffer';
import { readSystemAvailableMemory } from './systemAvailableMemory.js';
import { scanJSONResources, inspectJSONValueResources, validateJSONResourceLimits, type JSONResourceLimits } from './jsonMemoryResources.js';
import { inspectCloneResources } from './cloneMemoryResources.js';

export type MemoryPressurePolicy = Readonly<{ rssBytes: number; externalBytes: number; heapBytes: number; minimumFreeBytes: number; operationHeadroomBytes: number }>;
type PressureSample = { rssBytes: number; externalBytes: number; heapUsedBytes: number; freeBytes: number };
type PressureOptions = { policy: MemoryPressurePolicy; sample?: () => PressureSample };
const sampleProcessMemory = (): PressureSample => {
  const usage = process.memoryUsage();
  return { rssBytes: usage.rss, externalBytes: usage.external, heapUsedBytes: usage.heapUsed, freeBytes: readSystemAvailableMemory() };
};

/** Controlled backing allocations, NOT a total process/native RSS guarantee.
 * Keep a charge until the backing allocation is actually garbage-collected;
 * returning from an operation is not evidence that offers/history let it go. */
export class MemoryAdmissionError extends Error {
  readonly code = 'RAM_ADMISSION';
  constructor() { super('RAM_ADMISSION: controlled memory budget cannot fund this allocation; existing data retained'); this.name = 'MemoryAdmissionError'; }
}
export const createControlledMemoryBudget = (maximumBytes: number, pressure?: PressureOptions, jsonLimits?: JSONResourceLimits) => {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0) throw new Error('Finite independent memory budget required');
  let usedBytes = 0, pendingBytes = 0;
  const jsonPolicy = jsonLimits === undefined ? undefined : validateJSONResourceLimits(jsonLimits);
  const policy = pressure ? Object.freeze({ ...pressure.policy }) : undefined;
  if (policy && (Object.keys(policy).sort().join(',') !== 'externalBytes,heapBytes,minimumFreeBytes,operationHeadroomBytes,rssBytes'
    || !Object.values(policy).every(n => Number.isSafeInteger(n) && n >= 0)
    || !policy.rssBytes || !policy.externalBytes || !policy.heapBytes)) throw new Error('Finite independent memory pressure policy required');
  // Empirical pressure admission, not a guarantee about opaque allocator peaks.
  // RSS/external/heap overlap: compare separately, never sum their observations.
  const checkPressure = (additionalBytes = 0) => {
    if (!policy) return;
    const sample = (pressure!.sample ?? sampleProcessMemory)();
    if (Object.keys(sample).sort().join(',') !== 'externalBytes,freeBytes,heapUsedBytes,rssBytes'
      || !Object.values(sample).every(n => Number.isSafeInteger(n) && n >= 0)) throw new MemoryAdmissionError();
    const future = pendingBytes + additionalBytes, headroom = policy.operationHeadroomBytes;
    if (sample.rssBytes > policy.rssBytes - headroom - future
      || sample.externalBytes > policy.externalBytes - headroom - future
      || sample.heapUsedBytes > policy.heapBytes - headroom
      || sample.freeBytes < policy.minimumFreeBytes + headroom + future) throw new MemoryAdmissionError();
  };
  const collected = new FinalizationRegistry<number>(bytes => { usedBytes -= bytes; });
  const tracked = new WeakSet<ArrayBufferLike>();
  const reserve = (bytes: number, group = false) => {
    if (!Number.isSafeInteger(bytes) || bytes < (group ? 0 : 1) || (!group && bytes > bufferConstants.MAX_LENGTH)) throw new Error('Finite controlled allocation required');
    if (bytes > maximumBytes - usedBytes) throw new MemoryAdmissionError();
    checkPressure(bytes);
    usedBytes += bytes;
    pendingBytes += bytes;
    let pending = true;
    const adoptMany = (buffers: readonly Buffer[]) => {
      if (!pending || buffers.some(buffer => !Buffer.isBuffer(buffer))) throw new Error('Original pending memory reservation required');
      pending = false; pendingBytes -= bytes; usedBytes -= bytes;
      let actual = 0;
      for (const buffer of buffers) {
        if (tracked.has(buffer.buffer)) continue;
        const size = buffer.buffer.byteLength;
        actual += size; usedBytes += size;
        tracked.add(buffer.buffer); collected.register(buffer.buffer, size);
      }
      if (actual > bytes) throw new MemoryAdmissionError();
      return buffers;
    };
    return Object.freeze({
      cancel: () => { if (pending) { pending = false; usedBytes -= bytes; pendingBytes -= bytes; } },
      adoptMany,
      adopt: (buffer: Buffer): Buffer => { adoptMany([buffer]); return buffer; }
    });
  };
  const allocate = (bytes: number): Buffer => {
    const reservation = reserve(bytes);
    try { return reservation.adopt(Buffer.alloc(bytes)); }
    catch (error) { reservation.cancel(); throw error; }
  };
  return Object.freeze({ allocate, reserve: (bytes: number) => reserve(bytes), reserveBackings: (bytes: number) => reserve(bytes, true), checkPressure: (additionalBytes = 0) => checkPressure(additionalBytes), inspectClone: (value: unknown) => inspectCloneResources(value, jsonPolicy), inspectJSON: (bytes: Buffer) => jsonPolicy ? scanJSONResources(bytes, jsonPolicy) : undefined, inspectJSONValue: (value: unknown) => jsonPolicy ? inspectJSONValueResources(value, jsonPolicy) : undefined, inspectJSONProjection: (value: unknown, space?: 2) => jsonPolicy ? inspectJSONValueResources(value, jsonPolicy, { nativeData: true, space }) : undefined, usage: () => ({ usedBytes, maximumBytes, pendingBytes }) });
};
export type ControlledMemoryBudget = ReturnType<typeof createControlledMemoryBudget>;
const current = new AsyncLocalStorage<ControlledMemoryBudget>();
export const withControlledMemory = <T>(budget: ControlledMemoryBudget | undefined, operation: () => T): T => {
  if (!budget) return operation();
  const existing = current.getStore();
  if (existing && existing !== budget) throw new Error('Conflicting Main memory ownership');
  return existing ? operation() : current.run(budget, operation);
};
/** The budget governing the current call, if any. Callers that are not inside a
 * governed operation must decide their own admission policy; they never inherit
 * an unrelated budget. */
export const getControlledMemoryContext = (): ControlledMemoryBudget | undefined => current.getStore();
export const allocateSnapshotMemory = (bytes: number): Buffer => current.getStore()?.allocate(bytes) ?? Buffer.alloc(bytes);
export const checkControlledMemoryPressure = (additionalBytes = 0): void => current.getStore()?.checkPressure(additionalBytes);
export const encodeControlledUTF8 = (value: string): Buffer => {
  const budget = current.getStore();
  if (!budget) return Buffer.from(value, 'utf8');
  const size = Buffer.byteLength(value, 'utf8');
  if (!size) return Buffer.alloc(0);
  const output = budget.allocate(size);
  if (output.write(value, 'utf8') !== size) throw new Error('UTF8 encoding size mismatch');
  return output;
};
export const stringifyControlledJSON = (value: unknown, replacer?: null, space?: 2): string => {
  if (replacer != null || space !== undefined && space !== 2) throw new Error('Controlled data JSON supports only original null replacer and two-space formatting');
  const budget = current.getStore();
  budget?.checkPressure();
  if (value !== undefined) budget?.inspectJSONProjection(value, space);
  budget?.checkPressure();
  return JSON.stringify(value, replacer, space);
};
export const cloneControlled = <T>(value: T): T => {
  const budget = current.getStore();
  if (!budget) return structuredClone(value);
  budget.checkPressure();
  const input = budget.inspectClone(value);
  const reservation = budget.reserveBackings(input.backingBytes);
  try {
    budget.checkPressure();
    const result = structuredClone(value);
    const output = inspectCloneResources(result);
    reservation.adoptMany(output.buffers.map(buffer => Buffer.from(buffer)));
    return result;
  } catch (error) { reservation.cancel(); throw error; }
};
export const parseControlledJSON = (bytes: Buffer): any => {
  const budget = current.getStore();
  budget?.checkPressure();
  budget?.inspectJSON(bytes);
  budget?.checkPressure();
  return JSON.parse(bytes.toString('utf8'));
};
export const serializeControlledJSON = (value: unknown, validate: () => void): Buffer => {
  const budget = current.getStore();
  budget?.checkPressure();
  const resources = budget?.inspectJSONValue(value);
  validate();
  budget?.checkPressure();
  if (!resources) return Buffer.from(JSON.stringify(value));
  // Fund the real encoded backing before native stringify starts. Its temporary
  // string/object workspace still relies on pressure admission, not this charge.
  const output = budget!.allocate(resources.sourceBytes);
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, 'utf8') !== output.length) throw new Error('JSON data changed after resource census');
  output.write(text, 'utf8');
  return output;
};
export const copyControlledBuffer = (bytes: Uint8Array): Buffer => {
  const budget = current.getStore();
  if (!budget) return Buffer.from(bytes);
  if (bytes.byteLength === 0) return Buffer.alloc(0);
  const copy = budget.allocate(bytes.byteLength);
  copy.set(bytes);
  return copy;
};
export const decodeControlledBase64 = (value: string): Buffer => {
  const budget = current.getStore();
  if (!budget) return Buffer.from(value, 'base64');
  const size = Buffer.byteLength(value, 'base64');
  if (size === 0) return Buffer.alloc(0);
  const output = budget.allocate(size);
  const written = output.write(value, 'base64');
  return written === size ? output : output.subarray(0, written);
};
/** Quote a real decoder's bounded output before starting it. Native workspace
 * and codec caches are separate obligations, not silently certified by this. */
export const withControlledBufferOutput = async (maximumBytes: number, operation: () => Promise<Buffer>): Promise<Buffer> => {
  const budget = current.getStore();
  if (!budget) return operation();
  const reservation = budget.reserve(maximumBytes);
  try { return reservation.adopt(await operation()); }
  catch (error) { reservation.cancel(); throw error; }
};
