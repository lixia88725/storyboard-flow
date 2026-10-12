import os from "node:os";
import { onTestFinished, expect, it, vi, afterEach } from "vitest";
import { useBitmapLayerActions } from "./bitmapLayerActions";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createProject } from "../shared/projectOps";
import type { Project } from "../shared/types";
import { readLayerAssetSnapshots } from "./bitmapLayerHistory";
import { readLayerPng } from "../../electron/main/layerAssetService";
import { rm, mkdtemp, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";

// Actual Add producer/queue/History read port; React setters represented explicitly, not mounted.
const folderPath = process.env.TMPDIR ?? os.tmpdir();
async function scenario() {
  const root = await mkdtemp(path.join(folderPath, "add-ack-red-"));
  onTestFinished(async () => { await rm(root, { recursive: true, force: true }); });
  await mkdir(path.join(root, ".storyboard-workbench/layers/add-ack"), { recursive: true });
  await sharp({ create: { width: 2, height: 2, channels: 4, background: "white" } }).tiff({ compression: "none" }).toFile(path.join(root, "owned.tiff"));
  const transparent = await sharp({ create: { width: 2, height: 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const p = createProject("add-ack-red");
  p.shots = [{ id: "add-ack", imagePath: root + "/owned.tiff", fileName: "owned.tiff", order: 0,
    swb: { version: 1, status: "owned", canvasWidth: 2, canvasHeight: 2 }, layers: [] }];
  p.pendingBake = { version: 1, shots: { "add-ack": { state: "synced", acceptedOutputIdentity: createHash("sha256").update(await readFile(p.shots[0].imagePath)).digest("hex") } } };
  const ref = { current: p }; const publications: Project[] = [], histories: unknown[] = [];
  const createLayerPng = vi.fn(async () => { throw new Error("ACK lost after attempted write"); });
  const failed = vi.fn(); const completion = Object.assign(vi.fn(async () => {}), { failed });
  const api = { readLayerPng, createLayerPng } as unknown as NonNullable<Window["storyboard"]>;
  vi.stubGlobal("window", { storyboard: api });
  const actions = useBitmapLayerActions({ folderPath: root, projectRef: ref,
    bitmapLayerWriteQueueRef: { current: createBitmapLayerWriteQueue() },
    captureEnsureScope: () => () => true, captureEffectCompletion: () => completion,
    getWorkspaceIdentity: () => ref, isImageImportLocked: () => false,
    createTransparentLayerDataUrl: async () => `data:image/png;base64,${transparent.toString("base64")}`,
    createHistoryEntry: async paths => ({ project: ref.current, layerAssets: await readLayerAssetSnapshots(api, root, paths ?? []) }),
    getHistoryLayerAssets: entry => entry.layerAssets, recordUndoEntry: entry => { histories.push(entry); },
    markShotsDirty: () => {}, updateProject: update => { const next = typeof update === "function" ? update(ref.current) : update; publications.push(next); ref.current = next; }, setStatus: () => {} });
  return { p, ref, publications, histories, createLayerPng, failed, actions };
}
afterEach(() => vi.unstubAllGlobals());
it("actual Add must await a real create ACK before Project/History publication", async () => {
  const f = await scenario(); await f.actions.handleAddBitmapLayer("add-ack").catch(() => {});
  expect(f.createLayerPng).toHaveBeenCalledTimes(1);
  expect(f.publications).toEqual([]); expect(f.histories).toEqual([]); expect(f.ref.current).toBe(f.p);
});
it("actual attempted create/ACK failure is retained via existing failed-effect protection", async () => {
  const f = await scenario(); await f.actions.handleAddBitmapLayer("add-ack").catch(() => {});
  expect(f.failed).toHaveBeenCalledTimes(1); expect(f.publications).toEqual([]); expect(f.histories).toEqual([]);
});
