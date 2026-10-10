import { expect, it } from "vitest";
import * as fs from "node:fs/promises";
import ts from "typescript";
import { decodeNormalSaveImportResult } from "../../electron/shared/normalSaveImportIpc";
import { withStatus } from "./statusAction";
import { createNormalSaveAppAdapter } from "./normalSaveAppAdapter";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { createProject } from "../shared/projectOps";
import type { FolderScanPayload, Project } from "../shared/types";

it("script new-project creation executes under the real owner queue and publishes durable pending with a new epoch", async () => {
  const ref = { current: createProject("old") }, events: string[] = [];
  const queue = createBitmapLayerWriteQueue();
  const scan: FolderScanPayload = { folderPath: "/new", folderName: "new", metadataPath: "/new/p.json", images: [],
    preserveProjectWithoutImageMerge: true, project: { ...createProject("new"), pendingBake: { version: 1, shots: {} } } };
  const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: p => events.push(`project:${p.name}`), queue,
    freshToken: () => "t", paths: () => ({ folderPath: "/old", metadataPath: "/old/p.json" }),
    api: () => ({ createFromStoryboardScript: async () => { events.push("create"); return scan; },
      readOutputIdentity: async () => "a".repeat(64), autosaveWorkspace: async () => { throw new Error("must not overwrite freshly created input"); },
      saveWorkspace: async p => p }), onSave: () => {}, onError: () => events.push("error") });
  const epoch = adapter.owner.capture().epoch;
  const result = await adapter.createFromScript({ sourceMarkdownPath: "/source.md", targetFolderPath: "/new", blankShotPreset: "16:9",
    isCurrent: () => true, published: () => events.push("published") });
  expect(result).toBe(true); expect(ref.current).toEqual(scan.project);
  expect(adapter.owner.capture().epoch).not.toBe(epoch);
  expect(events).toEqual(["create", "project:new", "published"]);
});

it("actual App Create callback routes through normal adapter and publishes inside owner domain instead of reloading outside", async () => {
  const source = await fs.readFile(new URL("./App.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression = "";
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "handleCreateProjectFromStoryboardScript") expression = node.initializer!.getText(tree); ts.forEachChild(node, visit); }; visit(tree);
  const events: string[] = [], draft = { sourceMarkdownPath: "/s.md", targetFolderPath: "/new", entryCount: 1 };
  const ref = { current: createProject("old") };
  const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: () => events.push("project"), queue: createBitmapLayerWriteQueue(),
    freshToken: () => "t", paths: () => ({}), onSave: () => {}, onError: () => events.push("error"),
    api: () => ({ createFromStoryboardScript: async () => { events.push("main"); return { folderPath: "/new", folderName: "new", metadataPath: "/new/p.json", images: [], project: { ...createProject("new"), pendingBake: { version: 1, shots: {} } } }; },
      autosaveWorkspace: async () => undefined, saveWorkspace: async p => p, readOutputIdentity: async () => "a".repeat(64) }) });
  const bindings = { window: { storyboard: { createFromStoryboardScript: async () => { throw new Error("legacy create bypass"); }, getRecentFolders: async () => [] } },
    storyboardScriptImportDraft: draft, storyboardScriptImportDraftRef: { current: draft }, normalSaveAppEnabled: true,
    normalSaveAppAdapterRef: { current: adapter }, blankShotPreset: "16:9", setWorkspaceTask: () => {}, setStatus: () => {},
    setStoryboardScriptImportDraft: () => {}, setRecentFolders: () => {}, withStatus, decodeNormalSaveImportResult,
    publishNormalSaveFolderScan: () => events.push("publishScan"), loadFolderScan: async () => { throw new Error("outside-queue load forbidden"); } };
  await new Function(...Object.keys(bindings), ts.transpile(`return (${expression});`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings))();
  expect(events).toEqual(["main", "project", "publishScan"]);
});

const gate = () => { let release!: () => void; const promise = new Promise<void>(r => release = r); return { promise, release }; };
const fixture = () => {
  const ref = { current: { ...createProject("old"), pendingBake: { version: 1 as const, shots: {} } } as Project };
  const queue = createBitmapLayerWriteQueue(), events: string[] = [];
  const paths = { folderPath: "/old", metadataPath: "/old/p.json" };
  const scan: FolderScanPayload = { folderPath: "/new", folderName: "new", metadataPath: "/new/p.json", images: [], project: { ...createProject("new"), pendingBake: { version: 1, shots: {} } } };
  let effect: () => Promise<unknown> = async () => scan;
  let recovery: string | undefined;
  const adapter = createNormalSaveAppAdapter({ projectRef: ref, setProject: () => events.push("project"), queue, paths: () => paths,
    freshToken: () => "t", onSave: () => {}, onError: () => events.push("error"),
    assertAdmission: () => { if (recovery) throw new Error(recovery); }, assertImportAdmission: () => { if (recovery) throw new Error(recovery); },
    onImportRecoveryRequired: message => { recovery = message; events.push("recovery"); },
    api: () => ({ createFromStoryboardScript: async () => { events.push("main"); return await effect() as FolderScanPayload; },
      saveWorkspace: async p => p, readOutputIdentity: async () => "a".repeat(64), autosaveWorkspace: async () => { events.push("persist"); } }) });
  return { ref, adapter, queue, events, scan, effect: (f: () => Promise<unknown>) => { effect = f; },
    run: (isCurrent = () => true) => adapter.createFromScript({ sourceMarkdownPath: "/s.md", targetFolderPath: "/new", blankShotPreset: "16:9", isCurrent, published: () => events.push("published") }) };
};

it("unknown/future current owner refuses Create before the first main effect", async () => {
  for (const pendingBake of [{ version: 9, shots: {} }, { version: 1, shots: { ghost: { state: "unknown" } } }]) {
    const f = fixture(); f.ref.current = { ...f.ref.current, pendingBake: pendingBake as Project["pendingBake"] };
    expect(await f.run()).toBe(false); expect(f.events).toEqual(["error"]);
  }
});

it("queued Create refuses P2 before its first effect", async () => {
  const f = fixture(), held = gate(); const hold = f.queue.runExclusive(() => held.promise);
  const task = f.run(); f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []); held.release(); await hold;
  expect(await task).toBe(false); expect(f.events.includes("main")).toBe(false); expect(f.ref.current.name).toBe("P2");
});

it("cancelled and ABA Create settle admitted work without publishing old status or Project", async () => {
  for (const mode of ["cancel", "ABA", "P2"] as const) {
    const f = fixture(), entered = gate(), held = gate(); let current = true;
    f.effect(async () => { entered.release(); await held.promise; return f.scan; });
    const task = f.run(() => current); await entered.promise;
    let load: Promise<boolean> | undefined;
    if (mode === "cancel") current = false;
    else if (mode === "ABA") load = f.adapter.owner.load({ ...createProject("ABA old path/new epoch"), pendingBake: { version: 1, shots: {} } });
    else f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []);
    held.release(); expect(await task).toBe(false); await load;
    expect(f.events.includes("published")).toBe(false);
    if (mode !== "P2") expect(f.events.includes("error")).toBe(false);
  }
});

it("recovery-incomplete plain result reaches origin recovery gate after P2 and blocks later Save/autosave", async () => {
  const f = fixture(), entered = gate(), held = gate();
  f.effect(async () => { entered.release(); await held.promise; return structuredClone({ ok: false, error: { code: "IMPORT_RECOVERY_INCOMPLETE", message: "write + rollback failed" } }); });
  const task = f.run(); await entered.promise;
  f.adapter.owner.publishEdit(p => ({ ...p, name: "P2" }), []); held.release();
  expect(await task).toBe(false); expect(f.events.includes("recovery")).toBe(true); expect(f.ref.current.name).toBe("P2");
  expect(await f.adapter.save()).toBe(false); expect(await f.adapter.autosave(f.ref.current)).toBe(false);
  expect(f.events.includes("persist")).toBe(false);
});
