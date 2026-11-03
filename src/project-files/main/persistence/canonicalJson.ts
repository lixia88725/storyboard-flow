import { createHash } from 'node:crypto';

/** Whether a value is a JSON-style plain object (not an array, not a class). */
export const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const encode = (value: unknown): string => {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'string':
      // JSON.stringify escapes lone surrogates as \uXXXX, so the result is always
      // valid UTF-8 and a text value is never repaired or replaced on the way out.
      return JSON.stringify(value);
    case 'number':
      if (!Number.isFinite(value)) throw new Error('Canonical JSON cannot encode a non-finite number');
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'object':
      break;
    default:
      throw new Error(`Canonical JSON cannot encode a ${typeof value}`);
  }
  if (Array.isArray(value)) return `[${value.map(encode).join(',')}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${encode(record[key])}`).join(',')}}`;
};

/** Compact, key-sorted JSON. Object keys sort by UTF-16 code unit, arrays keep
 * their order, and no insignificant whitespace is emitted, so the same logical
 * document always produces the same bytes. */
export const canonicalJson = (value: unknown): string => encode(value);

/** The exact byte encoding used for manifests and version records. */
export const canonicalUtf8 = (value: unknown): Buffer => Buffer.from(`${canonicalJson(value)}\n`, 'utf8');

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
