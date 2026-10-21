import { isProxy } from 'node:util/types';

export type JSONResourceLimits = Readonly<{
  maximumSourceBytes: number;
  maximumTokens: number;
  maximumStringSourceBytes: number;
  maximumNesting: number;
}>;
export class JSONResourceAdmissionError extends Error {
  readonly code = 'RAM_ADMISSION';
  constructor() { super('RAM_ADMISSION: JSON logical resource limit exceeded; existing data retained'); this.name = 'JSONResourceAdmissionError'; }
}
export const validateJSONResourceLimits = (limits: JSONResourceLimits): JSONResourceLimits => {
  if (Object.keys(limits).sort().join(',') !== 'maximumNesting,maximumSourceBytes,maximumStringSourceBytes,maximumTokens'
    || !Object.values(limits).every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Finite independent JSON resource limits required');
  return Object.freeze({ ...limits });
};
/** Resource census BEFORE string conversion/object construction. This is not a
 * JSON grammar/canonical/duplicate-key validator, nor a V8 heap byte estimate.
 * Tokens include keys, scalar values and container openings. String bytes are
 * the original encoded bytes between quotes (including escapes), not UTF16.
 * The normal parser and all existing schema/canonical checks must still run. */
export const scanJSONResources = (bytes: Uint8Array, input: JSONResourceLimits) => {
  const limits = validateJSONResourceLimits(input);
  if (bytes.byteLength > limits.maximumSourceBytes) throw new JSONResourceAdmissionError();
  const stack: number[] = [];
  let tokens = 0, strings = 0, stringSourceBytes = 0, maxStringSourceBytes = 0, maximumObservedNesting = 0;
  const token = () => { if (++tokens > limits.maximumTokens) throw new JSONResourceAdmissionError(); };
  const space = (b: number) => b === 32 || b === 9 || b === 10 || b === 13;
  const delimiter = (b: number) => space(b) || b === 123 || b === 125 || b === 91 || b === 93 || b === 44 || b === 58;
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    if (space(b) || b === 44 || b === 58) { i++; continue; }
    if (b === 123 || b === 91) {
      token();
      if (stack.length >= limits.maximumNesting) throw new JSONResourceAdmissionError();
      stack.push(b); maximumObservedNesting = Math.max(maximumObservedNesting, stack.length); i++; continue;
    }
    if (b === 125 || b === 93) {
      if (stack.pop() !== (b === 125 ? 123 : 91)) throw new SyntaxError('JSON census mismatched delimiter');
      i++; continue;
    }
    if (b === 34) {
      token(); strings++; const start = ++i; let closed = false;
      for (; i < bytes.length; i++) {
        if (stringSourceBytes + i - start > limits.maximumStringSourceBytes) throw new JSONResourceAdmissionError();
        if (bytes[i] === 34) {
          const size = i - start; stringSourceBytes += size; maxStringSourceBytes = Math.max(maxStringSourceBytes, size);
          i++; closed = true; break;
        }
        if (bytes[i] < 32) throw new SyntaxError('JSON census unescaped control');
        if (bytes[i] === 92) { i++; if (i >= bytes.length) throw new SyntaxError('JSON census unfinished escape'); }
      }
      if (!closed) throw new SyntaxError('JSON census unfinished string');
      continue;
    }
    token(); do { i++; } while (i < bytes.length && !delimiter(bytes[i]) && bytes[i] !== 34);
  }
  if (stack.length) throw new SyntaxError('JSON census unfinished container');
  return { sourceBytes: bytes.byteLength, tokens, strings, stringSourceBytes, maxStringSourceBytes, maximumObservedNesting };
};

/** Inspect data before stringify. Default remains finite compact JSON; the
 * hash/transport opt-in preserves undefined omission/nonfinite nulls and can
 * count original two-space formatting. These are encoded bytes, NOT V8 heap
 * bytes. No getters, proxies or custom serializers are evaluated. */
export const inspectJSONValueResources = (input: unknown, configured: JSONResourceLimits, projection: { nativeData?: boolean; space?: 2 } = {}) => {
  const limits = validateJSONResourceLimits(configured), ancestors = new Set<object>();
  let sourceBytes = 0, tokens = 0, strings = 0, stringSourceBytes = 0, maxStringSourceBytes = 0, maximumObservedNesting = 0;
  const add = (bytes: number) => { if (bytes > limits.maximumSourceBytes - sourceBytes) throw new JSONResourceAdmissionError(); sourceBytes += bytes; };
  const token = () => { if (++tokens > limits.maximumTokens) throw new JSONResourceAdmissionError(); };
  const string = (text: string) => {
    let size = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 34 || c === 92) size += 2;
      else if (c < 32) size += c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6;
      else if (c < 128) size++;
      else if (c < 2048) size += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff) { size += 4; i++; }
      else size += c >= 0xd800 && c <= 0xdfff ? 6 : 3;
      if (size > limits.maximumStringSourceBytes - stringSourceBytes || size + 2 > limits.maximumSourceBytes - sourceBytes) throw new JSONResourceAdmissionError();
    }
    add(size + 2); strings++; stringSourceBytes += size; maxStringSourceBytes = Math.max(maxStringSourceBytes, size);
  };
  const descriptor = (value: object, key: string): PropertyDescriptor | undefined => {
    for (let object: object | null = value; object; object = Object.getPrototypeOf(object)) {
      if (isProxy(object)) throw new Error('Non-data JSON proxy');
      const entry = Object.getOwnPropertyDescriptor(object, key);
      if (entry) { if (entry.get || entry.set) throw new Error('Accessor data not retainable'); return entry; }
    }
  };
  const visit = (value: unknown, nesting: number): void => {
    token();
    // Hash/transport callers historically use native JSON omission/null rules.
    // This opt-in does not relax the recovery Store's finite-data validator.
    if (projection.nativeData && (value === undefined || typeof value === 'number' && !Number.isFinite(value))) { add(4); return; }
    if (value === null) { add(4); return; }
    if (typeof value === 'boolean') { add(value ? 4 : 5); return; }
    if (typeof value === 'string') { string(value); return; }
    if (typeof value === 'number' && Number.isFinite(value)) { add(String(value).length); return; }
    if (typeof value !== 'object' || !value || isProxy(value) || ancestors.has(value)) throw new Error('Not finite JSON data');
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (array ? prototype !== Array.prototype && prototype !== null : prototype !== Object.prototype) throw new Error('Non-data JSON object');
    if (typeof descriptor(value, 'toJSON')?.value === 'function') throw new Error('Non-data JSON serializer');
    if (++nesting > limits.maximumNesting) throw new JSONResourceAdmissionError();
    maximumObservedNesting = Math.max(maximumObservedNesting, nesting); ancestors.add(value);
    try {
      add(2);
      if (array) {
        // Holes also serialize to tokens; reject huge sparse arrays before a
        // proportional loop or the native serializer expands them to nulls.
        if (value.length > limits.maximumTokens - tokens) throw new JSONResourceAdmissionError();
        add(Math.max(0, value.length - 1));
        if (projection.space && value.length) add(value.length + 1 + projection.space * (value.length * nesting + nesting - 1));
        for (let i = 0; i < value.length; i++) {
          const entry = descriptor(value, String(i));
          visit(entry ? entry.value : null, nesting);
        }
      } else {
        let members = 0;
        for (const key in value) {
          if (!Object.hasOwn(value, key)) continue;
          const entry = descriptor(value, key)!;
          if (projection.nativeData && entry.value === undefined) continue;
          if (members++) add(1);
          token(); string(key); add(1); visit(entry.value, nesting);
        }
        if (projection.space && members) add(members + 1 + projection.space * (members * nesting + nesting - 1) + members);
      }
    } finally { ancestors.delete(value); }
  };
  visit(input, 0);
  return { sourceBytes, tokens, strings, stringSourceBytes, maxStringSourceBytes, maximumObservedNesting };
};
