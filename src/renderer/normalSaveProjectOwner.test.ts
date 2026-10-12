import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { onTestFinished, describe, expect, it } from "vitest";
import { createProject } from "../shared/projectOps";
import { initializeCompletedShot } from "../shared/pendingBake";
import type { Project } from "../shared/types";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { useLayerMetadataActionController } from "./layerMetadataActionController";
import { writePhotoshopLayeredTiffsForInPlaceSave } from "../../electron/main/photoshopTiffExport";
import { applyFileReplacements, atomicWriteTextFile } from "../../electron/main/fileRenames";
import { readProjectMetadata } from "../../electron/main/projectMetadataService";
import { serializeStoryboardScriptMarkdown } from "../../electron/main/storyboardScript";
import { writeLayerPng } from "../../electron/main/layerAssetService";
import { saveProgressShotIds, countSaveProgressShots } from "../../electron/main/saveProgress";
import { registerWorkspacePersistenceIpcHandlers } from "../../electron/main/ipc/workspacePersistenceHandlers";

const module = await import("./normalSaveProjectOwner").catch(() => undefined);
const scratch = process.env.TMPDIR ?? os.tmpdir();
const hash = async (p: string) => createHash("sha256").update(await readFile(p)).digest("hex");
const ops = { mkdir: async (p: string) => { await mkdir(p, { recursive: true }); }, rename, unlink, writeFile };
async function fixture() {
  const folder = await mkdtemp(path.join(scratch, "normal-save-"));
  onTestFinished(async () => { await rm(folder, { recursive: true, force: true }); });
  const metadata = path.join(folder, ".storyboard-workbench/storyboard.project.json");
  const bitmapPath = ".storyboard-workbench/layers/s/image.png";
  await mkdir(path.dirname(path.join(folder, bitmapPath)), { recursive: true });
  await sharp({ create: { width: 8, height: 6, channels: 4, background: "red" } }).png().toFile(path.join(folder, bitmapPath));
  const imagePath = path.join(folder, "s.tiff");
  await sharp({ create: { width: 8, height: 6, channels: 4, background: "white" } }).tiff({ compression: "none" }).toFile(imagePath);
  const project = createProject("normal-save");
  project.shots = [{ id: "s", imagePath, fileName: "s.tiff", order: 0,
    swb: { version: 1, status: "owned", canvasWidth: 8, canvasHeight: 6 },
    layers: [{ id: "image", kind: "image", name: "Image", visible: true, locked: false, opacity: 1,
      order: 0, blendMode: "normal", bitmapPath, width: 8, height: 6 }] }];
  let token = 0;
  const ref = { current: initializeCompletedShot(project, "s", await hash(imagePath), `new-${++token}`) };
  let state = ref.current;
  let persists = 0, outputs = 0;
  let beforePersist: (() => Promise<void>) | undefined;
  let beforeOutputAck: (() => Promise<void>) | undefined;
  const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
  registerWorkspacePersistenceIpcHandlers<{ project: Project; folderPath: string; metadataPath: string }>(
    { handle: ((name: string, fn: (...args: unknown[]) => Promise<unknown>) => { handlers.set(name, fn); }) as never },
    { ensureProjectLayerAssets: async p => {
        for (const s of p.shots) for (const l of s.layers ?? []) await readFile(path.join(folder, l.bitmapPath));
      },
      writeProjectFiles: async (_metadata, _folder, p) => {
        persists++;
        await beforePersist?.();
        await atomicWriteTextFile(metadata, JSON.stringify(p), ops);
        await atomicWriteTextFile(path.join(folder, "storyboard-script.md"), serializeStoryboardScriptMarkdown(p), ops);
      } });
  const queue = createBitmapLayerWriteQueue();
  const ports = {
    queue, projectRef: ref, setProject: (p: Project) => { state = p; }, freshToken: () => `edit-${++token}`,
    readIdentity: (s: Project["shots"][number]) => hash(s.imagePath),
    persist: async (p: Project) => { await handlers.get("workspace:autosave")!(undefined, { project: p, folderPath: folder, metadataPath: metadata }); },
    output: async (p: Project, ids: string[]) => {
      outputs++;
      const selected = p.shots.filter(s => ids.includes(s.id));
      const result = await writePhotoshopLayeredTiffsForInPlaceSave({ ...p, shots: selected }, folder, {
        pythonPath: "/opt/homebrew/bin/python3.12", scriptPath: path.join(process.cwd(), "scripts/photoshop-layered-tiff-export.py"),
        saveStamp: `save-${outputs}`, env: { ...process.env, SWB_PYTHON_BIN: undefined,
          SWB_PYTHON_DEPS_DIR: process.env.SWB_PYTHON_DEPS_DIR ?? path.join(process.cwd(), "vendor/python/photoshop-tiff"), PYTHONDONTWRITEBYTECODE: "1" }
      });
      const replacements = await applyFileReplacements(result.replacements.map((r, i) => ({
        tempPath: r.fromPath, targetPath: r.toPath, backupPath: path.join(result.tempFolderPath, `backup-${i}.tiff`) })), ops);
      await replacements.commit();
      const ack = await Promise.all(selected.map(async s => ({ shotId: s.id,
        capturedToken: p.pendingBake!.shots[s.id].editToken!, sourcePath: s.imagePath, targetPath: s.imagePath,
        outputHash: await hash(s.imagePath) })));
      await beforeOutputAck?.();
      return ack;
    }
  };
  const owner = module!.createNormalSaveProjectOwner(ports);
  const edit = (opacity: number) => useLayerMetadataActionController({
    markShotsDirty: () => undefined, setDeleteTarget: () => undefined, shotSelectionAnchorIdRef: { current: undefined },
    updateProject: update => owner.publishEdit(update, ["s"])
  }).handleUpdateLayer("s", "image", { opacity });
  return { owner, edit, ref, queue, ports, folder, metadata, imagePath, get state() { return state; },
    get persists() { return persists; }, get outputs() { return outputs; },
    set beforePersist(value: (() => Promise<void>) | undefined) { beforePersist = value; },
    set beforeOutputAck(value: (() => Promise<void>) | undefined) { beforeOutputAck = value; },
    reopen: () => readProjectMetadata<Project>(metadata), cleanup: () => rm(folder, { recursive: true, force: true }) };
}

describe("normal Save real storage vertical (not production App enabled)", () => {
  it("metadata → actual autosave → fresh owner reload → TIFF output", async () => {
    expect(module, "normal Save owner is missing").toBeDefined();
    const f = await fixture();
    try {
      f.edit(0.5);
      expect(f.state).toBe(f.ref.current);
      expect(await f.owner.autosave()).toBe(true);
      const persisted = await f.reopen();
      expect(persisted!.pendingBake!.shots.s.state).toBe("pending");
      const fresh = module!.createNormalSaveProjectOwner({ ...f.ports, projectRef: { current: createProject("B") } });
      await fresh.load(persisted!);
      expect(await fresh.save()).toBe(true);
      const disk = await f.reopen();
      expect(disk!.shots[0].layers![0].opacity).toBe(0.5);
      expect(disk!.pendingBake!.shots.s.state).toBe("synced");
      expect(disk!.pendingBake!.shots.s.acceptedOutputIdentity).toBe(await hash(f.imagePath));
      const pixel = await sharp(f.imagePath).ensureAlpha().raw().toBuffer();
      // Existing exporter composites partial opacity over white, not transparent RGBA.
      expect([...pixel.subarray(0, 4)]).toEqual([255, 127, 127, 255]);
      expect(await readFile(path.join(f.folder, "storyboard-script.md"), "utf8")).toBe(serializeStoryboardScriptMarkdown(disk!));
    } finally { await f.cleanup(); }
  });
  it("advances H1 independently of t1 CAS while preserving newer t2", async () => {
    const f = await fixture();
    try {
      await f.owner.autosave();
      const h0 = f.ref.current.pendingBake!.shots.s.acceptedOutputIdentity;
      let t2 = "";
      f.beforeOutputAck = async () => { f.edit(0.25); t2 = f.ref.current.pendingBake!.shots.s.editToken!; };
      expect(await f.owner.save()).toBe(false);
      const disk = (await f.reopen())!;
      expect(disk.shots[0].layers![0].opacity).toBe(0.25);
      expect(disk.pendingBake!.shots.s).toEqual({ state: "pending", editToken: t2, acceptedOutputIdentity: await hash(f.imagePath) });
      expect(disk.pendingBake!.shots.s.acceptedOutputIdentity).not.toBe(h0);
      expect(f.state).toBe(f.ref.current);
      f.beforeOutputAck = undefined;
      expect(await f.owner.save()).toBe(true);
    } finally { await f.cleanup(); }
  });
  it("returns false on final persistence failure, retries receipt without rebaking, and rejects evidence-free reopen", async () => {
    const f = await fixture();
    try {
      await f.owner.autosave();
      const diskH0 = (await f.reopen())!;
      f.beforePersist = async () => { throw new Error("required MD/JSON failed"); };
      expect(await f.owner.save()).toBe(false);
      expect(f.outputs).toBe(1);
      expect(await f.owner.autosave()).toBe(false);
      const fresh = module!.createNormalSaveProjectOwner({ ...f.ports, projectRef: { current: createProject("reopen") } });
      await fresh.load(diskH0);
      expect(await fresh.save()).toBe(false);
      expect(f.outputs).toBe(1);
      f.beforePersist = undefined;
      expect(await f.owner.save()).toBe(true);
      expect(f.outputs).toBe(1);
      expect((await f.reopen())!.pendingBake!.shots.s.acceptedOutputIdentity).toBe(await hash(f.imagePath));
    } finally { await f.cleanup(); }
  });
  it("does not overwrite P3 published during output identity verification", async () => {
    const f = await fixture();
    try {
      const readIdentity = f.ports.readIdentity;
      let reads = 0;
      f.ports.readIdentity = async s => {
        const result = await readIdentity(s);
        if (++reads === 2) f.edit(0.125);
        return result;
      };
      expect(await f.owner.save()).toBe(false);
      expect(f.ref.current.shots[0].layers![0].opacity).toBe(0.125);
      expect((await f.reopen())!.shots[0].layers![0].opacity).toBe(0.125);
    } finally { await f.cleanup(); }
  });
  it("final P2 persist ACK cannot close after P3 appears, and does not chase indefinitely", async () => {
    const f = await fixture();
    try {
      f.beforePersist = async () => { f.edit(0.125); };
      expect(await f.owner.save()).toBe(false);
      expect(f.persists).toBe(1);
      expect(f.ref.current.shots[0].layers![0].opacity).toBe(0.125);
      expect(f.ref.current.pendingBake!.shots.s.state).toBe("pending");
      f.beforePersist = undefined;
      const t3 = f.ref.current.pendingBake!.shots.s.editToken;
      expect(await f.owner.autosave()).toBe(true);
      const disk = (await f.reopen())!;
      expect(disk.pendingBake!.shots.s.editToken).toBe(t3);
      expect(disk.pendingBake!.shots.s.acceptedOutputIdentity).toBe(await hash(f.imagePath));
      expect(f.outputs).toBe(1);
      expect(await f.owner.save()).toBe(true);
    } finally { await f.cleanup(); }
  });
  it("failed P2 persistence with P3 retains receipt until explicit safe retry", async () => {
    const f = await fixture();
    try {
      f.beforePersist = async () => { f.edit(0.125); throw new Error("persist rejected before JSON"); };
      expect(await f.owner.save()).toBe(false);
      f.beforePersist = undefined;
      expect(await f.owner.autosave()).toBe(false);
      expect(f.outputs).toBe(1);
      // P3 needs output; retry verifies H1 before exporting P3.
      expect(await f.owner.save()).toBe(true);
      expect(f.outputs).toBe(2);
      expect((await f.reopen())!.pendingBake!.shots.s.state).toBe("synced");
    } finally { await f.cleanup(); }
  });
});

describe("original business assertions on real normal-autosave storage seam", () => {
  it.each(["paint A→B→A", "paint fresh owner", "dimensions reload", "opacity reload"])("preserves unsaved %s and actually outputs TIFF", async kind => {
    const f = await fixture();
    try {
      if (kind.startsWith("paint")) {
        const png = await sharp({ create: { width: 8, height: 6, channels: 4, background: "blue" } }).png().toBuffer();
        await writeLayerPng({ folderPath: f.folder, bitmapPath: f.ref.current.shots[0].layers![0].bitmapPath,
          dataUrl: `data:image/png;base64,${png.toString("base64")}` });
        f.owner.publishEdit(p => p, ["s"]); // successful pixel-only publication, unchanged metadata
      } else if (kind.startsWith("dimensions")) {
        const png = await sharp({ create: { width: 8, height: 1230, channels: 4, background: "red" } }).png().toBuffer();
        await writeLayerPng({ folderPath: f.folder, bitmapPath: f.ref.current.shots[0].layers![0].bitmapPath,
          dataUrl: `data:image/png;base64,${png.toString("base64")}` });
        f.owner.publishEdit(p => ({ ...p, shots: p.shots.map(s => ({ ...s,
          swb: { ...s.swb!, canvasHeight: 1230 }, layers: s.layers!.map(l => ({ ...l, height: 1230 })) })) }), ["s"]);
      } else f.edit(0.5);
      expect(await f.owner.autosave()).toBe(true);
      const disk = (await f.reopen())!;
      let owner = f.owner;
      if (kind.includes("fresh")) owner = module!.createNormalSaveProjectOwner({ ...f.ports, projectRef: { current: createProject("fresh") } });
      else await owner.load(createProject("B"));
      await owner.load(disk);
      expect(await owner.save()).toBe(true);
      const metadata = await sharp(f.imagePath).metadata();
      expect(metadata.height).toBe(kind.startsWith("dimensions") ? 1230 : 6);
      const pixel = [...(await sharp(f.imagePath).ensureAlpha().raw().toBuffer()).subarray(0, 4)];
      expect(pixel).toEqual(kind.startsWith("paint") ? [0, 0, 255, 255] : kind.startsWith("opacity") ? [255, 127, 127, 255] : [255, 0, 0, 255]);
      expect((await f.reopen())!.pendingBake!.shots.s.state).toBe("synced");
    } finally { await f.cleanup(); }
  });
  it("preserves hidden-layer metadata in the actual TIFF after autosave/reload", async () => {
    const f = await fixture();
    try {
      useLayerMetadataActionController({ markShotsDirty: () => undefined, setDeleteTarget: () => undefined,
        shotSelectionAnchorIdRef: { current: undefined }, updateProject: update => f.owner.publishEdit(update, ["s"])
      }).handleUpdateLayer("s", "image", { name: "Hidden", visible: false, opacity: 0.5 });
      await f.owner.autosave();
      await f.owner.load((await f.reopen())!);
      expect(await f.owner.save()).toBe(true);
      const { stdout } = await promisify(execFile)("/opt/homebrew/bin/python3.12", ["-c",
        "import importlib.util,json,sys; sys.path.insert(0,sys.argv[3]); spec=importlib.util.spec_from_file_location('reader',sys.argv[2]); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); layers=m.read_image_source_data(__import__('pathlib').Path(sys.argv[1])).layers; print(json.dumps([{'name':m.layer_name(l),'visible':m.layer_visible(l),'opacity':int(l.opacity)} for l in layers]))",
        f.imagePath, path.join(process.cwd(), "scripts/photoshop-layered-tiff-import.py"),
        process.env.SWB_PYTHON_DEPS_DIR ?? path.join(process.cwd(), "vendor/python/photoshop-tiff")
      ], { env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
      // Existing exporter folds opacity into pixels and writes PSD opacity=255.
      expect(JSON.parse(stdout)).toEqual([{ name: "Hidden", visible: false, opacity: 255 }]);
      // This bare exporter composites all manifest layers, even hidden records;
      // preserve its current semantics here, not a claim of full main Save compositing.
      expect([...(await sharp(f.imagePath).ensureAlpha().raw().toBuffer()).subarray(0, 4)]).toEqual([255, 127, 127, 255]);
    } finally { await f.cleanup(); }
  });
  it("does not invent a bake obligation for an unedited external original", async () => {
    const f = await fixture();
    try {
      const p = { ...f.ref.current, pendingBake: undefined };
      p.shots = p.shots.map(s => ({ ...s, swb: { ...s.swb!, status: "non-swb" } }));
      await f.owner.load(p);
      expect(await f.owner.save()).toBe(false); // conservative, no speculative external Import
      expect(f.outputs).toBe(0);
    } finally { await f.cleanup(); }
  });
  it("keeps parked roots outside output and preserves undefined versus empty semantics", async () => {
    const f = await fixture();
    try {
      f.owner.publishEdit(p => ({ ...p, shots: [], parkedShots: p.shots }), []);
      await f.owner.autosave();
      expect(await f.owner.save()).toBe(false);
      expect(f.outputs).toBe(0);
      expect((await f.reopen())!.pendingBake!.shots.s.state).toBe("pending");
      const p = { shots: [{ id: "active" }], parkedShots: [{ id: "s" }] };
      expect(countSaveProgressShots(p, new Set(["s"]))).toBe(0);
      expect(countSaveProgressShots(p, saveProgressShotIds([], []))).toBe(0);
      expect(countSaveProgressShots(p, saveProgressShotIds(undefined, []))).toBe(1);
    } finally { await f.cleanup(); }
  });
});

describe("normal Save admission protection", () => {
  it.each([
    { version: 9, shots: {}, future: { keep: [1, 2] } },
    { version: 1, shots: "corrupt", extra: "keep" },
    { version: 1, shots: { s: { state: "synced", acceptedOutputIdentity: "bad", extra: 3 } } }
  ])("preserves raw unsupported/corrupt envelope through owner load/edit and blocks writes: %j", async raw => {
    const f = await fixture();
    try {
      await f.owner.autosave();
      const p = { ...f.ref.current, pendingBake: raw as unknown as Project["pendingBake"] };
      await atomicWriteTextFile(f.metadata, JSON.stringify(p), ops);
      const diskHash = await hash(f.metadata);
      await f.owner.load(async () => (await f.reopen())!);
      f.edit(0.4);
      expect(f.ref.current.pendingBake).toEqual(raw);
      expect(await f.owner.autosave()).toBe(false);
      expect(await f.owner.save()).toBe(false);
      expect(await hash(f.metadata)).toBe(diskHash);
      expect(f.outputs).toBe(0);
      await f.owner.load({ ...p, shots: [] });
      f.owner.publishEdit(q => ({ ...q, name: "empty-edit" }), []);
      expect(f.ref.current.pendingBake).toEqual(raw);
      expect(await f.owner.autosave()).toBe(false);
      expect(await f.owner.save()).toBe(false);
    } finally { await f.cleanup(); }
  });
  it("preserves supported envelope and shot extensions across load/edit/autosave/output ACK/persist", async () => {
    const f = await fixture();
    try {
      const raw = { ...f.ref.current.pendingBake!, envelopeExtension: { x: ["keep"] },
        shots: { s: { ...f.ref.current.pendingBake!.shots.s, shotExtension: { n: 7 } } } };
      await atomicWriteTextFile(f.metadata, JSON.stringify({ ...f.ref.current, pendingBake: raw }), ops);
      await f.owner.load(async () => (await f.reopen())!);
      f.edit(0.4);
      expect(await f.owner.autosave()).toBe(true);
      expect(await f.owner.save()).toBe(true);
      const disk = (await f.reopen())!.pendingBake as unknown as typeof raw;
      expect(disk.envelopeExtension).toEqual(raw.envelopeExtension);
      expect(disk.shots.s.shotExtension).toEqual(raw.shots.s.shotExtension);
      expect(disk.shots.s.state).toBe("synced");
      expect(disk.shots.s.editToken).toBeUndefined();
    } finally { await f.cleanup(); }
  });
  it.each(["source", "identity"])("retains supported extensions when %s becomes unknown", async kind => {
    const f = await fixture();
    try {
      const raw = { ...f.ref.current.pendingBake!, envelopeExtension: "keep",
        shots: { s: { ...f.ref.current.pendingBake!.shots.s, shotExtension: { n: 7 } } } };
      if (kind === "identity") {
        await writeFile(f.imagePath, Buffer.concat([await readFile(f.imagePath), Buffer.from("external-byte-change")]));
      }
      await f.owner.load({ ...f.ref.current, pendingBake: raw });
      if (kind === "source") {
        f.owner.publishEdit(p => ({ ...p, shots: p.shots.map(s => ({ ...s, imagePath: s.imagePath + ".changed" })) }), ["s"]);
      }
      const envelope = f.ref.current.pendingBake as unknown as typeof raw;
      expect(envelope.shots.s.state).toBe("unknown");
      expect(envelope.envelopeExtension).toBe("keep");
      expect(envelope.shots.s.shotExtension).toEqual({ n: 7 });
      expect(await f.owner.autosave()).toBe(false);
      expect(await f.owner.save()).toBe(false);
    } finally { await f.cleanup(); }
  });
  it("keeps unknown provenance through edits and gates autosave/output before any effect", async () => {
    const f = await fixture();
    try {
      const legacy = { ...f.ref.current, pendingBake: undefined };
      await f.owner.load(legacy);
      f.edit(0.4);
      expect(f.ref.current.pendingBake?.shots.s.state).toBe("unknown");
      expect(await f.owner.autosave()).toBe(false);
      expect(await f.owner.save()).toBe(false);
      expect(f.outputs).toBe(0); expect(f.persists).toBe(0);
    } finally { await f.cleanup(); }
  });
  it("loader reads project JSON only after admitted operation settles", async () => {
    const f = await fixture();
    try {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let settled = false;
      const operation = f.queue.runExclusive(async () => { await gate; settled = true; });
      let read = false;
      const load = f.owner.load(async () => {
        read = true;
        expect(settled).toBe(true);
        return createProject("read-after-settle");
      });
      expect(read).toBe(false);
      release(); await operation;
      expect(await load).toBe(true);
      expect(read).toBe(true);
      expect(f.ref.current.name).toBe("read-after-settle");
    } finally { await f.cleanup(); }
  });
  it("old final persist ACK crossing reload epoch cannot retire new epoch receipt", async () => {
    const f = await fixture();
    try {
      let reload!: Promise<boolean>;
      let nextSave!: Promise<boolean>;
      let first = true;
      f.beforePersist = async () => {
        if (first) {
          first = false;
          const next = { ...f.ref.current, name: "new-epoch" };
          reload = f.owner.load(next);
          nextSave = reload.then(() => {
            f.edit(0.25);
            return f.owner.save();
          });
        } else throw new Error("new epoch persist rejection before JSON");
      };
      expect(await f.owner.save()).toBe(false);
      expect(await reload).toBe(true);
      expect(await nextSave).toBe(false);
      f.beforePersist = undefined;
      expect(await f.owner.autosave()).toBe(false);
      expect(await f.owner.save()).toBe(true);
      expect(f.outputs).toBe(2);
    } finally { await f.cleanup(); }
  });
  it("stale queued P1 cannot overwrite normally persisted P2", async () => {
    const f = await fixture();
    try {
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const blocker = f.queue.runExclusive(() => gate);
      const old = f.owner.autosave();
      const oldSave = f.owner.save();
      f.edit(0.3);
      const latest = f.owner.autosave();
      release(); await blocker;
      expect(await old).toBe(false); expect(await oldSave).toBe(false);
      expect(await latest).toBe(true);
      expect(f.outputs).toBe(0); expect(f.persists).toBe(1);
      expect((await f.reopen())!.shots[0].layers![0].opacity).toBe(0.3);
    } finally { await f.cleanup(); }
  });
  it("late output ACK cannot publish across reload epoch", async () => {
    const f = await fixture();
    try {
      let reload!: Promise<boolean>;
      f.beforeOutputAck = async () => { reload = f.owner.load(createProject("B")); };
      expect(await f.owner.save()).toBe(false);
      await reload;
      expect(f.ref.current.name).toBe("B"); expect(f.state).toBe(f.ref.current);
      expect(f.persists).toBe(0);
    } finally { await f.cleanup(); }
  });
  it("late rejected effect cannot publish an error into the next lifecycle", async () => {
    const f = await fixture();
    try {
      let reload!: Promise<boolean>;
      f.beforeOutputAck = async () => { reload = f.owner.load(createProject("B")); throw new Error("old output error"); };
      expect(await f.owner.save()).toBe(false);
      await reload;
      expect(f.ref.current.name).toBe("B");
      expect(f.owner.lastError).toBeUndefined();
    } finally { await f.cleanup(); }
  });
  it("changed source cannot inherit a previous accepted identity", async () => {
    const f = await fixture();
    try {
      f.owner.publishEdit(p => ({ ...p, shots: p.shots.map(s => ({ ...s, imagePath: `${s.imagePath}.moved` })) }), ["s"]);
      expect(f.ref.current.pendingBake!.shots.s.state).toBe("unknown");
    } finally { await f.cleanup(); }
  });
  it("actual external TIFF byte change blocks output without editing either side", async () => {
    const f = await fixture();
    try {
      await f.owner.autosave();
      await writeFile(f.imagePath, Buffer.concat([await readFile(f.imagePath), Buffer.from("external-hidden-only-change")]));
      const beforeTiff = await hash(f.imagePath), beforeJson = await hash(f.metadata);
      expect(await f.owner.save()).toBe(false);
      expect(await hash(f.imagePath)).toBe(beforeTiff); expect(await hash(f.metadata)).toBe(beforeJson);
      expect(f.outputs).toBe(0);
    } finally { await f.cleanup(); }
  });
});
