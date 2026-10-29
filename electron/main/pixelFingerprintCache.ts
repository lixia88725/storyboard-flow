import { mkdir, readFile, rename, stat as statFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Cheap change detector in front of the expensive pixel fingerprint.
 *
 * `pixelFingerprint` decodes the whole image through sharp (25-60 ms for a
 * 1920x1080 TIFF). Opening a 300-shot folder therefore spends 1.5-2 s of CPU
 * before the workspace appears, and Save cannot afford the same cost at all.
 *
 * A file's identity on disk is decided by its size plus its mtime/ctime/inode.
 * Remembering the fingerprint together with that fact means an unchanged file
 * can be answered without decoding it. This is a cache: when a fact does not
 * match we simply pay for a real fingerprint and refresh the entry, so a stale
 * or missing cache can only cost time, never correctness.
 *
 * Bump `pixelFingerprintCacheVersion` whenever the fingerprint algorithm or the
 * hashed fields change; stale entries are then discarded instead of being
 * mistaken for current fingerprints.
 */
export const pixelFingerprintCacheVersion = 1;

export type ImageStatFact = {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
};

export type PixelFingerprintCacheEntry = ImageStatFact & { fingerprint: string };

export type PixelFingerprintCacheFile = {
  version: number;
  entries: Record<string, PixelFingerprintCacheEntry>;
};

export type PixelFingerprintCache = {
  /** Resolves once the backing store has been read (or failed to read). */
  ready: () => Promise<void>;
  get: (imagePath: string) => PixelFingerprintCacheEntry | undefined;
  set: (imagePath: string, fact: ImageStatFact, fingerprint: string) => void;
  flush: () => Promise<void>;
};

export const imageStatFact = (stats: {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  ino: number | bigint;
}): ImageStatFact => ({
  size: stats.size,
  mtimeMs: stats.mtimeMs,
  ctimeMs: stats.ctimeMs,
  ino: Number(stats.ino)
});

/** Stats the file before any decode is attempted. A missing file surfaces as ENOENT here, which
 * is what `knownImageChangesService` already expects; `sharp` itself rejects with no `code` at
 * all, so this is the first place the caller can see a clean "missing" signal. */
export const readImageStatFact = async (imagePath: string): Promise<ImageStatFact> =>
  imageStatFact(await statFile(imagePath));

export const statFactMatches = (entry: ImageStatFact, fact: ImageStatFact): boolean =>
  entry.size === fact.size &&
  entry.mtimeMs === fact.mtimeMs &&
  entry.ctimeMs === fact.ctimeMs &&
  entry.ino === fact.ino;

const isValidEntry = (value: unknown): value is PixelFingerprintCacheEntry => {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<PixelFingerprintCacheEntry>;
  return (
    typeof entry.fingerprint === "string" &&
    entry.fingerprint.length > 0 &&
    typeof entry.size === "number" &&
    typeof entry.mtimeMs === "number" &&
    typeof entry.ctimeMs === "number" &&
    typeof entry.ino === "number"
  );
};

export const createPixelFingerprintCache = ({
  load,
  save,
  version = pixelFingerprintCacheVersion,
  maxEntries = 20000
}: {
  load?: () => Promise<PixelFingerprintCacheFile | undefined>;
  save?: (file: PixelFingerprintCacheFile) => Promise<void>;
  version?: number;
  maxEntries?: number;
}): PixelFingerprintCache => {
  let entries: Map<string, PixelFingerprintCacheEntry> | undefined;
  let loading: Promise<void> | undefined;
  let dirty = false;

  const ready = (): Promise<void> => {
    if (!loading) {
      loading = (async () => {
        const file = load ? await load().catch(() => undefined) : undefined;
        const usable = file && file.version === version ? file.entries : undefined;
        entries = new Map(
          Object.entries(usable ?? {}).filter((pair): pair is [string, PixelFingerprintCacheEntry] =>
            isValidEntry(pair[1])
          )
        );
      })();
    }
    return loading;
  };

  const get = (imagePath: string) => entries?.get(imagePath);

  const set = (imagePath: string, fact: ImageStatFact, fingerprint: string) => {
    if (!entries) return;
    entries.delete(imagePath);
    entries.set(imagePath, { ...fact, fingerprint });
    // Map preserves insertion order, so the first key is the stalest.
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next();
      if (oldest.done) break;
      entries.delete(oldest.value);
    }
    dirty = true;
  };

  const flush = async (): Promise<void> => {
    if (!save || !entries || !dirty) return;
    dirty = false;
    await save({ version, entries: Object.fromEntries(entries) }).catch(() => {
      // A cache that cannot be written is only a missed optimisation.
      dirty = true;
    });
  };

  return { ready, get, set, flush };
};

/**
 * Durable cache next to the app's other user data. Writes are debounced because
 * a single folder scan can refresh hundreds of entries at once.
 *
 * Two app instances each hold their own map and rewrite the whole file, so the last
 * writer wins: entries can be lost, never made wrong. Entries for folders the user
 * deleted are not pruned; `maxEntries` keeps the file at a few MB.
 */
export const createFilePixelFingerprintCache = ({
  filePath,
  debounceMs = 800,
  schedule = (run: () => void, delayMs: number) => {
    const timer = setTimeout(run, delayMs);
    timer.unref?.();
    return timer;
  },
  cancel = (timer: ReturnType<typeof setTimeout>) => clearTimeout(timer),
  version = pixelFingerprintCacheVersion
}: {
  filePath: string;
  debounceMs?: number;
  schedule?: (run: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
  version?: number;
}): PixelFingerprintCache => {
  let pending: ReturnType<typeof setTimeout> | undefined;

  const cache = createPixelFingerprintCache({
    version,
    load: async () => {
      const text = await readFile(filePath, "utf8").catch(() => undefined);
      if (text === undefined) return undefined;
      return JSON.parse(text) as PixelFingerprintCacheFile;
    },
    save: async (file) => {
      await mkdir(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      try {
        await writeFile(temporaryPath, `${JSON.stringify(file)}\n`, "utf8");
        await rename(temporaryPath, filePath);
      } catch (error) {
        // A half-written temp file must not outlive the attempt.
        await unlink(temporaryPath).catch(() => undefined);
        throw error;
      }
    }
  });

  const flush = async (): Promise<void> => {
    if (pending !== undefined) {
      cancel(pending);
      pending = undefined;
    }
    await cache.flush();
  };

  return {
    ready: cache.ready,
    get: cache.get,
    set: (imagePath, fact, fingerprint) => {
      cache.set(imagePath, fact, fingerprint);
      if (pending === undefined) {
        pending = schedule(() => {
          pending = undefined;
          void cache.flush();
        }, debounceMs);
      }
    },
    flush
  };
};

/**
 * `pixelFingerprint` with the stat check in front of it. The returned function
 * keeps the original contract: same fingerprint for the same pixels, and the
 * same ENOENT rejection for a missing file.
 */
export const createStatCachedPixelFingerprint = ({
  pixelFingerprint,
  cache,
  readStat = readImageStatFact
}: {
  pixelFingerprint: (imagePath: string) => Promise<string>;
  cache: PixelFingerprintCache;
  readStat?: (imagePath: string) => Promise<ImageStatFact>;
}): ((imagePath: string) => Promise<string>) => {
  return async (imagePath: string): Promise<string> => {
    await cache.ready();
    const fact = await readStat(imagePath);
    const cached = cache.get(imagePath);
    if (cached && statFactMatches(cached, fact)) {
      return cached.fingerprint;
    }
    const fingerprint = await pixelFingerprint(imagePath);
    // Take the fact AFTER the decode: a write landing between the two would otherwise record
    // fresh pixels under the old stat and hide the change until the next edit. Paying one more
    // stat per decode (never per hit) keeps the entry honest; if it moved, this entry just
    // misses next time.
    cache.set(imagePath, await readStat(imagePath), fingerprint);
    return fingerprint;
  };
};
