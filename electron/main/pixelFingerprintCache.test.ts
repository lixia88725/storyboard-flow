import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createFilePixelFingerprintCache,
  createPixelFingerprintCache,
  createStatCachedPixelFingerprint,
  pixelFingerprintCacheVersion,
  type ImageStatFact,
  type PixelFingerprintCacheFile
} from "./pixelFingerprintCache.js";

const fact = (overrides: Partial<ImageStatFact> = {}): ImageStatFact => ({
  size: 1000,
  mtimeMs: 1000.5,
  ctimeMs: 900.25,
  ino: 42,
  ...overrides
});

describe("createStatCachedPixelFingerprint", () => {
  it("answers an unchanged file from the stat fact without decoding pixels", async () => {
    const pixelFingerprint = vi.fn(async () => "pixels-v1");
    const readStat = vi.fn(async () => fact());
    const cache = createPixelFingerprintCache({});
    const fingerprint = createStatCachedPixelFingerprint({ pixelFingerprint, cache, readStat });

    await expect(fingerprint("/project/a.tiff")).resolves.toBe("pixels-v1");
    await expect(fingerprint("/project/a.tiff")).resolves.toBe("pixels-v1");

    expect(pixelFingerprint).toHaveBeenCalledTimes(1);
    // One stat to decide the first lookup, one more after that decode to record the fact it
    // really hashed, then one per later lookup that the cache answers.
    expect(readStat).toHaveBeenCalledTimes(3);
  });

  it("recomputes when the file changed on disk", async () => {
    let current = fact();
    const pixelFingerprint = vi.fn(async () => (current.size === 1000 ? "pixels-v1" : "pixels-v2"));
    const cache = createPixelFingerprintCache({});
    const fingerprint = createStatCachedPixelFingerprint({
      pixelFingerprint,
      cache,
      readStat: async () => current
    });

    await expect(fingerprint("/project/a.tiff")).resolves.toBe("pixels-v1");
    current = fact({ size: 1200, mtimeMs: 2000.5 });
    await expect(fingerprint("/project/a.tiff")).resolves.toBe("pixels-v2");
    expect(pixelFingerprint).toHaveBeenCalledTimes(2);

    // The refreshed entry now answers without another decode.
    await expect(fingerprint("/project/a.tiff")).resolves.toBe("pixels-v2");
    expect(pixelFingerprint).toHaveBeenCalledTimes(2);

    // Ordering: the fact stored beside a fresh fingerprint is taken AFTER the decode, so a write
    // landing mid-decode can never be recorded under the stat that predates it.
    const order: string[] = [];
    const ordered = createStatCachedPixelFingerprint({
      pixelFingerprint: async () => { order.push("decode"); return "pixels-v3"; },
      cache: createPixelFingerprintCache({}),
      readStat: async () => { order.push("stat"); return fact({ size: 4000 }); }
    });
    await ordered("/project/b.tiff");
    expect(order).toEqual(["stat", "decode", "stat"]);
  });

  it("treats an inode change as a change even when size and mtime match", async () => {
    let current = fact();
    const pixelFingerprint = vi.fn(async () => "replacement-inode");
    const cache = createPixelFingerprintCache({});
    const fingerprint = createStatCachedPixelFingerprint({
      pixelFingerprint,
      cache,
      readStat: async () => current
    });

    await fingerprint("/project/a.tiff");
    current = fact({ ino: 43 });
    await expect(fingerprint("/project/a.tiff")).resolves.toBe("replacement-inode");
    expect(pixelFingerprint).toHaveBeenCalledTimes(2);
  });

  it("keeps rejecting a missing file with ENOENT, as the uncached reader does", async () => {
    const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
    const pixelFingerprint = vi.fn(async () => "never");
    const cache = createPixelFingerprintCache({});
    const fingerprint = createStatCachedPixelFingerprint({
      pixelFingerprint,
      cache,
      readStat: async () => {
        throw missing;
      }
    });

    await expect(fingerprint("/project/missing.tiff")).rejects.toMatchObject({ code: "ENOENT" });
    expect(pixelFingerprint).not.toHaveBeenCalled();
  });
});

describe("createPixelFingerprintCache", () => {
  it("discards a file written by another cache version", async () => {
    const load = vi.fn(async (): Promise<PixelFingerprintCacheFile> => ({
      version: pixelFingerprintCacheVersion + 1,
      entries: { "/project/a.tiff": { ...fact(), fingerprint: "stale" } }
    }));
    const cache = createPixelFingerprintCache({ load });
    await cache.ready();

    expect(cache.get("/project/a.tiff")).toBeUndefined();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("starts empty when the cache file is unreadable", async () => {
    const cache = createPixelFingerprintCache({
      load: async () => {
        throw new Error("corrupt");
      }
    });

    await expect(cache.ready()).resolves.toBeUndefined();
    expect(cache.get("/project/a.tiff")).toBeUndefined();
  });

  it("keeps the newest entries when the entry budget is exceeded", async () => {
    const cache = createPixelFingerprintCache({ maxEntries: 2 });
    await cache.ready();

    cache.set("/project/a.tiff", fact(), "a");
    cache.set("/project/b.tiff", fact(), "b");
    cache.set("/project/c.tiff", fact(), "c");

    expect(cache.get("/project/a.tiff")).toBeUndefined();
    expect(cache.get("/project/b.tiff")?.fingerprint).toBe("b");
    expect(cache.get("/project/c.tiff")?.fingerprint).toBe("c");
  });

  it("flushes the entries under the current version and only when dirty", async () => {
    const save = vi.fn(async () => undefined);
    const cache = createPixelFingerprintCache({ save });
    await cache.ready();

    await cache.flush();
    expect(save).not.toHaveBeenCalled();

    cache.set("/project/a.tiff", fact(), "pixels-v1");
    await cache.flush();
    expect(save).toHaveBeenCalledWith({
      version: pixelFingerprintCacheVersion,
      entries: { "/project/a.tiff": { ...fact(), fingerprint: "pixels-v1" } }
    });

    await cache.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("createFilePixelFingerprintCache", () => {
  it("survives a restart: a second cache answers from the written file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "swb-fingerprint-cache-"));
    const filePath = path.join(directory, "nested", "fingerprints.json");
    try {
      const first = createFilePixelFingerprintCache({ filePath, debounceMs: 0 });
      await first.ready();
      first.set("/project/a.tiff", fact(), "pixels-v1");
      await first.flush();

      const written = JSON.parse(await readFile(filePath, "utf8")) as PixelFingerprintCacheFile;
      expect(written.version).toBe(pixelFingerprintCacheVersion);

      const pixelFingerprint = vi.fn(async () => "should-not-run");
      const second = createFilePixelFingerprintCache({ filePath, debounceMs: 0 });
      const fingerprint = createStatCachedPixelFingerprint({
        pixelFingerprint,
        cache: second,
        readStat: async () => fact()
      });

      await expect(fingerprint("/project/a.tiff")).resolves.toBe("pixels-v1");
      expect(pixelFingerprint).not.toHaveBeenCalled();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("ignores a truncated cache file instead of failing the scan", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "swb-fingerprint-cache-"));
    const filePath = path.join(directory, "fingerprints.json");
    try {
      await writeFile(filePath, "{ not json");
      const cache = createFilePixelFingerprintCache({ filePath, debounceMs: 0 });
      await expect(cache.ready()).resolves.toBeUndefined();
      expect(cache.get("/project/a.tiff")).toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
