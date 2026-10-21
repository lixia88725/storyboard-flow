import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { afterEach, expect, it, vi } from "vitest";
import { mergeVisibleLayers } from "./layerAssetService";
import { createBitmapLayerWriteQueue } from "../../src/renderer/bitmapLayerWriteQueue";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, unlink: vi.fn(actual.unlink) };
});
const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const roots: string[] = [];
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
};
afterEach(async () => {
  vi.mocked(unlink).mockReset().mockImplementation(actualFs.unlink);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const fixture = async () => {
  const folderPath = await mkdtemp(path.join(process.env.TMPDIR!, "merge-settle-")); roots.push(folderPath);
  const bitmapPaths = ["early", "late"].map((name) => `.storyboard-workbench/layers/shot/${name}.png`);
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 100, g: 20, b: 30, alpha: 1 } } }).png().toBuffer();
  await mkdir(path.dirname(path.join(folderPath, bitmapPaths[0])), { recursive: true });
  for (const bitmapPath of bitmapPaths) await writeFile(path.join(folderPath, bitmapPath), bytes);
  return { folderPath, bitmapPaths, bytes, payload: {
    folderPath, targetBitmapPath: ".storyboard-workbench/layers/shot/merged.png", width: 2, height: 2,
    layers: bitmapPaths.map((bitmapPath) => ({ bitmapPath, opacity: 1, blendMode: "normal" as const })),
    deleteBitmapPaths: bitmapPaths
  } };
};

it.each([false, true])("Merge Visible drains started unlinks before rejection, cleanup, or exclusive successor (synchronous throw: %s)", async (synchronous) => {
  const f = await fixture(), gate = deferred(), earlyFailed = deferred(), lateStarted = deferred(), lateFinished = deferred();
  const primary = Object.assign(new Error("synthetic early unlink rejection"), { code: "EACCES" });
  const paths = f.bitmapPaths.map((p) => path.join(f.folderPath, p));
  // Start the delayed deletion first so the old fail-fast batch is an executable control even for a synchronous throw.
  const [earlyPath, latePath] = synchronous ? [paths[1], paths[0]] : paths;
  let lateSettled = false;
  vi.mocked(unlink).mockImplementation((file) => {
    if (file === earlyPath) {
      earlyFailed.resolve();
      if (synchronous) throw primary;
      return Promise.reject(primary);
    }
    if (file === latePath) return (async () => {
      lateStarted.resolve(); await gate.promise;
      try { await actualFs.unlink(file); lateSettled = true; } finally { lateFinished.resolve(); }
    })();
    return actualFs.unlink(file);
  });
  const queue = createBitmapLayerWriteQueue();
  let returned = false, cleaned = false, successor = false;
  const operation = queue.runExclusive(() => mergeVisibleLayers(f.payload));
  const observed = operation.then(() => { returned = true; return undefined; }, (error: unknown) => { returned = true; return error; }).finally(() => { cleaned = true; });
  const following = queue.runExclusive(async () => { successor = true; });
  try {
    await Promise.all([earlyFailed.promise, lateStarted.promise]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect.soft(returned).toBe(false); expect.soft(cleaned).toBe(false); expect.soft(successor).toBe(false);
    expect.soft(lateSettled).toBe(false);
    expect.soft(await readFile(latePath)).toEqual(f.bytes);
    expect.soft((await sharp(path.join(f.folderPath, f.payload.targetBitmapPath)).metadata()).width).toBe(2);
  } finally { gate.resolve(); await lateFinished.promise; }
  expect(await observed).toBe(primary); await following; await queue.drain();
  expect(lateSettled).toBe(true); expect(successor).toBe(true); expect(cleaned).toBe(true);
  expect(await readFile(earlyPath)).toEqual(f.bytes);
  await expect(readFile(latePath)).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([new Error("EACCES: permission denied, unlink 'shot/late.png'"), Symbol("non-Error unlink failure")])("Merge Visible retains every rejection identity and visible primary diagnostic after all unlinks settle (%s)", async (primary) => {
  const f = await fixture(), gate = deferred(), earlyFailed = deferred(), lateFinished = deferred();
  const secondary = new Error("first input rejects later");
  const [latePath, earlyPath] = f.bitmapPaths.map((p) => path.join(f.folderPath, p));
  vi.mocked(unlink).mockImplementation(async (file) => {
    if (file === earlyPath) { earlyFailed.resolve(); throw primary; }
    if (file === latePath) { await gate.promise; lateFinished.resolve(); throw secondary; }
    return actualFs.unlink(file);
  });
  let returned = false;
  const observed = mergeVisibleLayers(f.payload).then(() => { returned = true; return undefined; }, (error: unknown) => { returned = true; return error; });
  try {
    await earlyFailed.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect.soft(returned).toBe(false);
  } finally { gate.resolve(); await lateFinished.promise; }
  const error = await observed;
  expect(error).toBeInstanceOf(AggregateError);
  const message = primary instanceof Error ? primary.message : String(primary);
  expect((error as AggregateError).message).toBe(`${message}; 1 additional bitmap layer deletion failure(s) after merge`);
  const errors = (error as AggregateError).errors;
  expect(errors).toHaveLength(2); expect(errors[0]).toBe(primary); expect(errors[1]).toBe(secondary);
  for (const bitmapPath of f.bitmapPaths) expect(await readFile(path.join(f.folderPath, bitmapPath))).toEqual(f.bytes);
});
