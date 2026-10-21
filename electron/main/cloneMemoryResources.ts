import { isArrayBuffer, isSharedArrayBuffer, isDataView, isProxy, isMap, isSet, isDate, isRegExp } from 'node:util/types';
import { JSONResourceAdmissionError, type JSONResourceLimits } from './jsonMemoryResources.js';

const typedBuffer = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'buffer')!.get!;
const dataBuffer = Object.getOwnPropertyDescriptor(DataView.prototype, 'buffer')!.get!;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')!.get!;
/** Clone resource inspection, NOT JSON serialization or a V8 heap estimate.
 * Native clone preserves cycles/aliases/undefined. String/token/nesting logical
 * limits apply when configured; JSON source-byte limit is not reused for binary
 * clone data. SharedArrayBuffer is not copied by native clone and is not billed
 * as new backing. Caller data are inspected through descriptors, not getters. */
export const inspectCloneResources = (input: unknown, limits?: JSONResourceLimits) => {
  const seen = new WeakSet<object>(), buffers: ArrayBuffer[] = [];
  let tokens = 0, stringBytes = 0, backingBytes = 0;
  const token = () => { if (++tokens > (limits?.maximumTokens ?? Number.MAX_SAFE_INTEGER)) throw new JSONResourceAdmissionError(); };
  const string = (value: string) => {
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes > (limits?.maximumStringSourceBytes ?? Number.MAX_SAFE_INTEGER) - stringBytes) throw new JSONResourceAdmissionError();
    stringBytes += bytes;
  };
  const visit = (value: unknown, nesting: number): void => {
    token();
    if (typeof value === 'string') { string(value); return; }
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return;
    if (typeof value !== 'object' || isProxy(value)) throw new Error('Unsupported controlled clone data');
    if (seen.has(value)) return;
    seen.add(value);
    if (isSharedArrayBuffer(value)) return;
    if (isArrayBuffer(value)) {
      const bytes = Reflect.apply(bufferLength, value, []) as number;
      if (!Number.isSafeInteger(backingBytes + bytes)) throw new Error('Finite clone backing inventory required');
      backingBytes += bytes; buffers.push(value); return;
    }
    if (ArrayBuffer.isView(value)) {
      visit(Reflect.apply(isDataView(value) ? dataBuffer : typedBuffer, value, []), nesting); return;
    }
    if (isDate(value) || isRegExp(value)) return;
    if (++nesting > (limits?.maximumNesting ?? Number.MAX_SAFE_INTEGER)) throw new JSONResourceAdmissionError();
    if (isMap(value)) { for (const [key, child] of Map.prototype.entries.call(value)) { visit(key, nesting); visit(child, nesting); } return; }
    if (isSet(value)) { for (const child of Set.prototype.values.call(value)) visit(child, nesting); return; }
    const prototype = Object.getPrototypeOf(value);
    if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) throw new Error('Unsupported controlled clone object');
    for (const key of Object.keys(value)) {
      const entry = Object.getOwnPropertyDescriptor(value, key)!;
      if (entry.get || entry.set) throw new Error('Accessor data not cloneable under memory ownership');
      token(); string(key); visit(entry.value, nesting);
    }
  };
  visit(input, 0);
  return { buffers, backingBytes, tokens, stringBytes };
};
