import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, it } from "vitest";
import { createProject } from "../shared/projectOps";
import { initializeCompletedShot, pendingBakeForProject } from "../shared/pendingBake";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createNormalSaveProjectOwner } from "./normalSaveProjectOwner";
import { useBitmapLayerPaintingController } from "./bitmapLayerPaintingController";
import { createLayerAppHandlers } from "../../electron/main/layerAppRuntime";

async function exercise(scenario = "match") {
  const folderPath = await mkdtemp(path.join(os.tmpdir(), "single-png-forward-"));
  const bitmapPath = ".storyboard-workbench/layers/s/drawing.png";
  const metadataPath = path.join(folderPath, ".storyboard-workbench/storyboard.project.json");
  const imagePath = path.join(folderPath, "s.tiff");
  const handlers = createLayerAppHandlers();
  const before = await sharp({ create: { width: 8, height: 6, channels: 4, background: "red" } }).png().toBuffer();
  const target = await sharp({ create: { width: 8, height: 6, channels: 4, background: "blue" } }).png().toBuffer();
  const expected = `data:image/png;base64,${target.toString("base64")}`; // Expected BEFORE first effect, not read from failed output.
  await handlers.writePng({ folderPath, bitmapPath, dataUrl: `data:image/png;base64,${before.toString("base64")}` });
  await sharp(before).tiff().toFile(imagePath);
  const hash = async (p: string) => createHash("sha256").update(await readFile(p)).digest("hex");
  const base = createProject("single-png-forward");
  base.shots = [{ id: "s", imagePath, fileName: "s.tiff", order: 0,
    swb: { version: 1, status: "owned", canvasWidth: 8, canvasHeight: 6 },
    layers: [{ id: "drawing", kind: "paint", name: "Drawing", bitmapPath,
      width: 8, height: 6, opacity: 1, blendMode: "normal", visible: true, locked: false, order: 0 }] }];
  const ref = { current: initializeCompletedShot(base, "s", await hash(imagePath), "baseline") };
  const queue = createBitmapLayerWriteQueue();
  let writes = 0;
  let persists = 0;
  let reachedOutput = false;
  const md = path.join(folderPath, "storyboard-script.md");
  const persist = async (p: typeof ref.current) => {
    persists++;
    await mkdir(path.dirname(metadataPath), { recursive: true });
    await writeFile(metadataPath, JSON.stringify(p));
    await writeFile(md, "required metadata");
  };
  const owner = createNormalSaveProjectOwner({ projectRef: ref, setProject: p => { ref.current = p; },
    freshToken: () => "recovery-token", queue, readIdentity: s => hash(s.imagePath), persist,
    captureEffectPersistence: () => ({ folderPath, metadataPath, persist }),
    // Explicit test boundary: no fabricated Save receipt or substitute TIFF encoder. This RED
    // requires pending persistence BEFORE reaching output; final production Save is a separate gate.
    output: async () => { reachedOutput = true; throw Error("Output boundary reached; no mock ACK"); } });
  await persist(ref.current);
  persists = 0;
  const api = {
    readLayerPng: async (p: { folderPath: string; bitmapPath: string }) => {
      const result = await handlers.readPng(p);
      if (scenario === "mid-read-change" && pendingBakeForProject(ref.current).shots.s.state === "unknown") {
        ref.current = { ...ref.current, shots: ref.current.shots.map(s => ({ ...s,
          layers: s.layers!.map(l => ({ ...l, opacity: 0.5 })) })) };
      }
      return result;
    },
    writeLayerPng: async (p: { folderPath: string; bitmapPath: string; dataUrl: string }) => {
      writes++;
      await handlers.writePng(p); // Actual production handler + physical file effect first.
      throw Error("Synthetic transport ACK rejected AFTER physical PNG completion");
    }
  } as unknown as Window["storyboard"];
  const painting = useBitmapLayerPaintingController({ api, folderPath, projectRef: ref,
    bitmapLayerWriteQueueRef: { current: queue }, captureWorkspace: () => owner.captureEffectAdmission(),
    captureEffectCompletion: () => {
      const completion = owner.captureEffectCompletion();
      if (scenario === "expected-missing") delete completion.prepareSinglePng;
      return completion;
    },
    createHistoryEntryFromLayerAssets: assets => assets, recordUndoEntry: () => {}, markShotsDirty: () => {},
    updateProject: () => { throw Error("Failed write must not take normal publication path"); } });
  const shot = ref.current.shots[0];
  await expect(painting.handleBitmapSelectionTransform(shot, "drawing", expected)).rejects.toThrow("AFTER physical");
  expect(await readFile(path.join(folderPath, bitmapPath))).toEqual(target);
  expect(owner.hasUnsavedWork()).toBe(true);
  expect(pendingBakeForProject(ref.current).shots.s.state).toBe("unknown");
  if (scenario === "wrong-bytes") await writeFile(path.join(folderPath, bitmapPath), before);
  if (scenario === "corrupt") await writeFile(path.join(folderPath, bitmapPath), "short PNG");
  if (scenario === "external-root") await writeFile(imagePath, "external root replacement");
  if (scenario === "derived-change") ref.current = { ...ref.current, shots: ref.current.shots.map(s => ({ ...s,
    layers: s.layers!.map(l => ({ ...l, opacity: 0.5 })) })) };
  if (scenario === "in-place-derived") shot.layers![0].opacity = 0.5;
  if (scenario === "new-pending") ref.current = { ...ref.current, pendingBake: { version: 1,
    shots: { ...ref.current.pendingBake!.shots, s: { ...ref.current.pendingBake!.shots.s, state: "pending", editToken: "new P3" } } } };
  if (scenario === "safe-metadata") ref.current = { ...ref.current, name: "new P2 title", shots: ref.current.shots.map(s => ({ ...s,
    scriptText: "keep P2 dialogue", layers: s.layers!.map(l => ({ ...l, name: "new P2 label" })) })) };
  if (scenario === "other-unknown") ref.current = { ...ref.current, pendingBake: { version: 1,
    shots: { ...ref.current.pendingBake!.shots, other: { state: "unknown" } } } };
  if (scenario === "epoch-change") await expect(owner.load(() => Promise.resolve({ ...ref.current, title: "B same relative path" }))).rejects.toThrow("AFTER physical");
  if (scenario === "autosave-only") {
    await owner.autosave();
    expect(persists).toBe(0);
    expect(owner.hasUnsavedWork()).toBe(true);
    return;
  }
  const negative = ["wrong-bytes", "corrupt", "external-root", "derived-change", "expected-missing", "epoch-change", "other-unknown", "in-place-derived", "mid-read-change", "new-pending"].includes(scenario);
  const filesBefore = await Promise.all([metadataPath, md, imagePath, path.join(folderPath, bitmapPath)].map(p => readFile(p)));
  if (scenario === "md-failure") {
    await import("node:fs/promises").then(fs => fs.unlink(md));
    await mkdir(md);
    expect(await owner.save()).toBe(false);
    expect(writes).toBe(1);
    expect(reachedOutput).toBe(false);
    expect(owner.hasUnsavedWork()).toBe(true);
    expect(pendingBakeForProject(ref.current).shots.s.state).toBe("pending");
    await rmdir(md);
  }
  await owner.save(); // Existing user Save retry entry, never an extra recovery UI.
  expect(writes).toBe(1); // Recovery must NEVER rewrite the PNG.
  if (negative) {
    expect(persists).toBe(0);
    expect(reachedOutput).toBe(false);
    expect(owner.hasUnsavedWork()).toBe(true);
    expect(pendingBakeForProject(ref.current).shots.s.state).toBe(scenario === "new-pending" ? "pending" : "unknown");
    expect(await Promise.all([metadataPath, md, imagePath, path.join(folderPath, bitmapPath)].map(p => readFile(p)))).toEqual(filesBefore);
    return;
  }
  expect(persists).toBeGreaterThan(0);
  const persisted = JSON.parse(await readFile(metadataPath, "utf8"));
  expect(persisted.pendingBake.shots.s.state).toBe("pending");
  expect(persisted.pendingBake.shots.s.editToken).toBe("recovery-token");
  expect(reachedOutput).toBe(true);
  if (scenario === "safe-metadata") {
    expect(persisted.name).toBe("new P2 title");
    expect(persisted.shots[0].scriptText).toBe("keep P2 dialogue");
    expect(persisted.shots[0].layers[0].name).toBe("new P2 label");
  }
}

it("single PNG failed transport ACK retains protection until user Save verifies pre-effect target and persists pending", () => exercise());
it.each(["wrong-bytes", "corrupt", "external-root", "derived-change", "expected-missing", "epoch-change", "other-unknown", "autosave-only", "safe-metadata", "md-failure", "in-place-derived", "mid-read-change", "new-pending"])("single PNG bounded recovery: %s", scenario => exercise(scenario));
