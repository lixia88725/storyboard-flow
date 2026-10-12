import { describe, expect, it, vi } from "vitest";
import type { BitmapLayer, Project, Shot } from "../shared/types";
import { bitmapLayerPath } from "../shared/projectOps";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import { useClipboardActionController } from "./clipboardActionController";
import type { ClipboardSelection } from "./clipboardSelection";
import type { DeleteTarget } from "./deleteTarget";
import { registerWorkspaceAssetIpcHandlers } from "../../electron/main/ipc/workspaceAssetHandlers";
import { CopyCleanupIncompleteError } from "../../electron/main/copyShotAssetsService";

const layer = (
  shotId: string,
  id: string,
  order: number,
  overrides: Partial<BitmapLayer> = {}
): BitmapLayer => ({
  id,
  kind: "paint",
  name: id,
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order,
  bitmapPath: bitmapLayerPath(shotId, id),
  width: 100,
  height: 100,
  ...overrides
});

const shot = (id: string, order: number, layers: BitmapLayer[]): Shot =>
  ({
    id,
    imagePath: `/scene/${id}.tif`,
    previewPath: `/scene/${id}.png`,
    fileName: `${id}.tif`,
    order,
    activeLayerId: layers[0]?.id,
    layers
  }) as Shot;

const projectWithShots = (shots: Shot[]): Project =>
  ({
    id: "project",
    name: "Project",
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    shots,
    dialogues: []
  }) as Project;

const setupController = ({
  clipboardSelection,
  deleteTarget = { type: "shot" },
  folderPath = "/scene",
  metadataPath = "/scene/.storyboard-workbench/project.json",
  project,
  selectedShotIds = []
}: {
  clipboardSelection?: ClipboardSelection;
  deleteTarget?: DeleteTarget;
  folderPath?: string | undefined;
  metadataPath?: string | undefined;
  project: Project;
  selectedShotIds?: string[];
}) => {
  const importLockedRef = { current: false };
  const projectRef = { current: project };
  const clipboardSelectionRef = { current: clipboardSelection };
  const deleteTargetRef = { current: deleteTarget };
  const selectedShotIdsRef = { current: selectedShotIds };
  const statuses: string[] = [];
  const clipboardSelections: Array<ClipboardSelection | undefined> = [];
  const deleteTargets: DeleteTarget[] = [];
  const dirtyShotIds: string[][] = [];
  const selectedShotIdsByCall: Array<string | undefined> = [];
  const selectedBitmapLayerTargets: Array<{ shotId: string; layerIds: string[] } | undefined> = [];
  const queuedPasteAnimations: Array<{
    kind: "shot" | "layer";
    sourceId: string;
    pastedId: string;
  }> = [];
  const undoEntries: string[] = [];
  const projectUpdateOptions: Array<{
    markFileNamesUnsynced: boolean | undefined;
    recordUndo: boolean | undefined;
  }> = [];

  const api = {
    ensureLayerAssets: vi.fn(async (payload) => payload),
    copyShotAssets: vi.fn(async (payload) => ({
      ...payload,
      imagePath: "/scene/pasted-shot.tif",
      fileName: "pasted-shot.tif",
      previewPath: "/scene/pasted-shot.png"
    })),
    copyLayerPng: vi.fn(async (payload) => ({
      ...payload,
      targetFilePath: `/scene/${payload.targetBitmapPath}`
    }))
  };

  const workspaceRef = { current: { identity: {}, folderPath, metadataPath } };
  const queue = createBitmapLayerWriteQueue();
  const createHistoryEntry = vi.fn(async () => "undo-entry");
  const refreshHistoryEntry = vi.fn((entry: string) => `${entry}:${projectRef.current.name}`);
  const controller = useClipboardActionController<string>({
    isImageImportLocked: () => importLockedRef.current,
    api,
    captureWorkspace: () => workspaceRef.current,
    isCurrentWorkspace: (request) => request.identity === workspaceRef.current.identity &&
      request.folderPath === workspaceRef.current.folderPath && request.metadataPath === workspaceRef.current.metadataPath,
    bitmapLayerWriteQueueRef: { current: queue },
    clipboardSelectionRef,
    createHistoryEntry,
    refreshHistoryEntry,
    createId: () => "pasted",
    deleteTargetRef,
    folderPath,
    markShotsDirty: (shotIds) => dirtyShotIds.push(shotIds),
    metadataPath,
    projectRef,
    queuePasteAnimation: (kind, sourceId, pastedId) => {
      queuedPasteAnimations.push({ kind, sourceId, pastedId });
    },
    recordUndoEntry: (entry) => undoEntries.push(entry),
    selectSingleShot: (shotId) => selectedShotIdsByCall.push(shotId),
    selectedShotIdsRef,
    setClipboardSelection: (nextClipboardSelection) => {
      clipboardSelections.push(nextClipboardSelection);
    },
    setDeleteTarget: (target) => deleteTargets.push(target),
    setSelectedBitmapLayerIds: (target) => selectedBitmapLayerTargets.push(target),
    setStatus: (status) => statuses.push(status),
    updateProject: (projectUpdate, markFileNamesUnsynced, recordUndo) => {
      projectUpdateOptions.push({ markFileNamesUnsynced, recordUndo });
      projectRef.current =
        typeof projectUpdate === "function" ? projectUpdate(projectRef.current) : projectUpdate;
    }
  });

  return {
    importLockedRef,
    api,
    queue,
    createHistoryEntry,
    refreshHistoryEntry,
    workspaceRef,
    deleteTargetRef,
    selectedShotIdsRef,
    clipboardSelectionRef,
    clipboardSelections,
    controller,
    deleteTargets,
    dirtyShotIds,
    projectRef,
    projectUpdateOptions,
    queuedPasteAnimations,
    selectedBitmapLayerTargets,
    selectedShotIdsByCall,
    statuses,
    undoEntries
  };
};

it("Copy incomplete effects cross the main result boundary and Paste refuses project/history/selection publication", async () => {
  let invoke!: (event: unknown, payload: unknown) => Promise<unknown>;
  const retained = [{ filePath: "/scene/retained.png", kind: "layer" as const, effect: "committed" as const }];
  registerWorkspaceAssetIpcHandlers({ handle: (_name, listener) => { invoke = (event, payload) => listener(event as never, payload); } }, {
    copyShotAssets: async () => { throw new CopyCleanupIncompleteError(new Error("preview failed"), [new Error("cleanup EPERM")], retained); }
  });
  const result = structuredClone(await invoke(undefined, {}));
  expect(result).toMatchObject({ ok: false, error: { code: "COPY_RECOVERY_INCOMPLETE", retainedEffects: retained } });
  const s = setupController({
    project: projectWithShots([shot("a", 0, [layer("a", "paint", 0)])]),
    clipboardSelection: { type: "shot", shotId: "a" }, selectedShotIds: ["a"]
  });
  const before = structuredClone(s.projectRef.current);
  s.api.copyShotAssets.mockResolvedValueOnce(result as never);
  await s.controller.handlePasteSelection();
  expect(s.projectRef.current).toEqual(before);
  expect(s.undoEntries).toEqual([]);
  expect(s.queuedPasteAnimations).toEqual([]);
  expect(s.selectedShotIdsByCall).toEqual([]);
  expect(s.dirtyShotIds).toEqual([]);
  expect(s.statuses.at(-1)).toContain("cleanup EPERM");
  expect(s.statuses.at(-1)).toContain("/scene/retained.png");
});

describe("image Import Paste admission", () => {
  const setup = (kind: "shot" | "layer") => setupController({
    project: projectWithShots([shot("a", 0, [layer("a", "paint", 0)]), shot("b", 1, [layer("b", "paint", 0)])]),
    clipboardSelection: kind === "shot" ? { type: "shot", shotId: "a" } : { type: "layer", shotId: "a", layerId: "paint" },
    deleteTarget: kind === "shot" ? { type: "shot" } : { type: "layer", shotId: "b", layerId: "paint" },
    selectedShotIds: ["b"]
  });
  it.each(["shot", "layer"] as const)("rejects locked %s Paste without I/O/history/project/selection", async (kind) => {
    const s = setup(kind);
    s.importLockedRef.current = true;
    const before = structuredClone(s.projectRef.current);
    await s.controller.handlePasteSelection();
    expect(s.api.ensureLayerAssets).not.toHaveBeenCalled();
    expect(s.api.copyShotAssets).not.toHaveBeenCalled();
    expect(s.api.copyLayerPng).not.toHaveBeenCalled();
    expect(s.createHistoryEntry).not.toHaveBeenCalled();
    expect(s.projectRef.current).toEqual(before);
    expect(s.projectUpdateOptions).toEqual([]);
    expect(s.undoEntries).toEqual([]);
    expect(s.selectedShotIdsByCall).toEqual([]);
  });
  it.each(["shot", "layer"] as const)("rejects %s Paste if lock arrives in real queue wait", async (kind) => {
    const s = setup(kind);
    const gate = deferred<void>();
    const blocker = s.queue.runExclusive(() => gate.promise);
    const task = s.controller.handlePasteSelection();
    s.importLockedRef.current = true;
    gate.resolve();
    await Promise.all([blocker, task]);
    expect(s.api.ensureLayerAssets).not.toHaveBeenCalled();
    expect(s.api.copyShotAssets).not.toHaveBeenCalled();
    expect(s.api.copyLayerPng).not.toHaveBeenCalled();
    expect(s.createHistoryEntry).not.toHaveBeenCalled();
    expect(s.projectUpdateOptions).toEqual([]);
    expect(s.undoEntries).toEqual([]);
    expect(s.queuedPasteAnimations).toEqual([]);
  });
  it.each(["shot", "layer"] as const)("finishes %s Paste if image lock arrives after the first writing IPC begins", async (kind) => {
    const s = setup(kind);
    if (kind === "shot") s.api.ensureLayerAssets.mockImplementation(async (payload) => { s.importLockedRef.current = true; return payload; });
    else s.api.copyLayerPng.mockImplementation(async (payload) => { s.importLockedRef.current = true; return { ...payload, targetFilePath: `/scene/${payload.targetBitmapPath}` }; });
    await s.controller.handlePasteSelection();
    expect(s.projectUpdateOptions).toHaveLength(1);
    expect(s.queuedPasteAnimations).toHaveLength(1);
    expect(s.dirtyShotIds).toHaveLength(1);
    expect(s.selectedShotIdsByCall).toHaveLength(1);
    if (kind === "layer") expect(s.undoEntries).toHaveLength(1);
    else expect(s.projectRef.current.shots).toHaveLength(3);
  });
  it("rejects layer Paste after read-only history prep before copy starts", async () => {
    const s = setup("layer");
    s.createHistoryEntry.mockImplementation(async () => { s.importLockedRef.current = true; return "undo-entry"; });
    await s.controller.handlePasteSelection();
    expect(s.api.copyLayerPng).not.toHaveBeenCalled();
    expect(s.undoEntries).toEqual([]);
    expect(s.projectUpdateOptions).toEqual([]);
  });
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const pasteFixture = (kind: "shot" | "layer") => setupController({
  clipboardSelection: kind === "shot" ? { type: "shot", shotId: "source" } :
    { type: "layer", shotId: "source", layerId: "paint-source" },
  deleteTarget: { type: "layer", shotId: "target", layerId: "paint-target" },
  selectedShotIds: ["target"],
  project: projectWithShots([
    shot("source", 0, [layer("source", "paint-source", 0)]),
    shot("target", 1, [layer("target", "paint-target", 0)]),
    shot("other", 2, [layer("other", "paint-other", 0)])
  ])
});

const expectNoPublication = (fixture: ReturnType<typeof pasteFixture>) => {
  expect(fixture.projectUpdateOptions).toEqual([]);
  expect(fixture.undoEntries).toEqual([]);
  expect(fixture.dirtyShotIds).toEqual([]);
  expect(fixture.queuedPasteAnimations).toEqual([]);
  expect(fixture.selectedShotIdsByCall).toEqual([]);
  expect(fixture.selectedBitmapLayerTargets).toEqual([]);
  expect(fixture.deleteTargets).toEqual([]);
};

describe("paste workspace ownership", () => {
  for (const kind of ["shot", "layer"] as const) {
    const stages = kind === "shot" ? ["queue", "ensure", "copy"] : ["queue", "history", "copy"];
    for (const stage of stages) {
      for (const change of ["A→B", "A→B→A", "reload", "Save", "metadata"] as const) {
        it(`${kind} cancels ${stage} completion after ${change}`, async () => {
          const f = pasteFixture(kind);
          const gate = deferred<any>();
          let started: Promise<unknown> | undefined;
          if (stage === "queue") started = f.queue.runExclusive(() => gate.promise);
          if (stage === "ensure") f.api.ensureLayerAssets.mockImplementationOnce(() => gate.promise);
          if (stage === "history") f.createHistoryEntry.mockImplementationOnce(() => gate.promise);
          if (stage === "copy") {
            if (kind === "shot") f.api.copyShotAssets.mockImplementationOnce(() => gate.promise);
            else f.api.copyLayerPng.mockImplementationOnce(() => gate.promise);
          }
          const pending = f.controller.handlePasteSelection();
          await vi.waitFor(() => {
            if (stage === "ensure") expect(f.api.ensureLayerAssets).toHaveBeenCalled();
            if (stage === "history") expect(f.createHistoryEntry).toHaveBeenCalled();
            if (stage === "copy") expect(kind === "shot" ? f.api.copyShotAssets : f.api.copyLayerPng).toHaveBeenCalled();
          });
          f.workspaceRef.current = change === "metadata" ? { ...f.workspaceRef.current, metadataPath: "/scene/new.json" } :
            { ...f.workspaceRef.current, identity: {}, folderPath: change === "A→B" ? "/other" : "/scene" };
          const current = { ...f.projectRef.current, name: "new workspace edits" };
          f.projectRef.current = current;
          gate.resolve(stage === "history" ? "undo-entry" : { imagePath: "/scene/pasted.tif", fileName: "pasted.tif" });
          await started;
          await pending;
          expect(f.projectRef.current).toBe(current);
          expectNoPublication(f);
          expect(f.statuses).toEqual([]);
          if (stage === "queue") expect(f.api.ensureLayerAssets.mock.calls.length + f.api.copyLayerPng.mock.calls.length).toBe(0);
          if (stage === "ensure") expect(f.api.copyShotAssets).not.toHaveBeenCalled();
          if (stage === "history") expect(f.api.copyLayerPng).not.toHaveBeenCalled();
        });
      }
    }
    it(`${kind} suppresses late rejection status in the new scope`, async () => {
      const f = pasteFixture(kind);
      const gate = deferred<any>();
      const copy = kind === "shot" ? f.api.copyShotAssets : f.api.copyLayerPng;
      copy.mockImplementationOnce(() => gate.promise);
      const pending = f.controller.handlePasteSelection();
      await vi.waitFor(() => expect(copy).toHaveBeenCalled());
      f.workspaceRef.current = { ...f.workspaceRef.current, identity: {} };
      gate.reject(new Error("origin copy failed"));
      await pending;
      expectNoPublication(f);
      expect(f.statuses).toEqual([]);
    });
  }
});

describe("paste additive publication", () => {
  for (const kind of ["shot", "layer"] as const) {
    const stages = kind === "shot" ? ["queue", "ensure", "copy"] : ["queue", "history", "copy"];
    for (const stage of stages) {
      for (const change of ["text", "delete-target", "delete-source", "source-path", "lock-target", "selection"] as const) {
        if (kind === "shot" && change === "lock-target") continue;
        it(`${kind} preserves ${change} during ${stage}`, async () => {
          const f = pasteFixture(kind);
          const gate = deferred<any>();
          let queued: Promise<unknown> | undefined;
          if (stage === "queue") queued = f.queue.runExclusive(() => gate.promise);
          if (stage === "ensure") f.api.ensureLayerAssets.mockImplementationOnce(() => gate.promise);
          if (stage === "history") f.createHistoryEntry.mockImplementationOnce(() => gate.promise);
          const copy = kind === "shot" ? f.api.copyShotAssets : f.api.copyLayerPng;
          if (stage === "copy") copy.mockImplementationOnce(() => gate.promise);
          const pending = f.controller.handlePasteSelection();
          await vi.waitFor(() => {
            if (stage === "ensure") expect(f.api.ensureLayerAssets).toHaveBeenCalled();
            if (stage === "history") expect(f.createHistoryEntry).toHaveBeenCalled();
            if (stage === "copy") expect(copy).toHaveBeenCalled();
          });
          f.projectRef.current = { ...f.projectRef.current, name: "edited name",
            shots: f.projectRef.current.shots.filter(s => s.id !== (change === "delete-target" ? "target" : change === "delete-source" ? "source" : "none")).map(s => ({ ...s,
              scriptText: "new text",
              imagePath: change === "source-path" && s.id === "source" ? "/scene/replaced.tif" : s.imagePath,
              layers: s.layers?.map(l => ({ ...l,
                bitmapPath: change === "source-path" && s.id === "source" ? "replacement.png" : l.bitmapPath,
                locked: change === "lock-target" && s.id === "target" ? true : l.locked }))
            })), dialogues: [{ id: "new-dialogue", shotId: "other", text: "new dialogue", order: 0 }]
          };
          if (change === "selection") {
            f.selectedShotIdsRef.current = ["other"];
            f.deleteTargetRef.current = { type: "layer", shotId: "other", layerId: "paint-other" };
          }
          const latest = f.projectRef.current;
          gate.resolve(stage === "history" ? "undo-entry" : { imagePath: "/scene/pasted.tif", fileName: "pasted.tif" });
          await queued;
          await pending;
          if (change === "text" || change === "selection") {
            expect(f.projectRef.current.name).toBe("edited name");
            expect(f.projectRef.current.dialogues).toContainEqual(latest.dialogues[0]);
            expect(f.projectRef.current.shots.find(s => s.id === "other")?.scriptText).toBe("new text");
            if (kind === "shot") expect(f.projectRef.current.shots.map(s => s.id)).toEqual(["source", "target", "pasted", "other"]);
            else {
              expect(f.projectRef.current.shots.find(s => s.id === "target")?.layers?.map(l => l.id)).toEqual(["layer-pasted", "paint-target"]);
              expect(f.undoEntries).toEqual(["undo-entry:edited name"]);
            }
          } else {
            expect(f.projectRef.current).toBe(latest);
            expectNoPublication(f);
            if (stage === "history" || stage === "ensure") expect(copy).not.toHaveBeenCalled();
          }
        });
      }
    }
  }
});

describe("paste rejection safety", () => {
  for (const stage of ["history", "copy"] as const) {
    for (const stale of [false, true]) {
      it(`layer ${stage} rejection publishes no history (stale=${stale})`, async () => {
        const f = pasteFixture("layer");
        const gate = deferred<any>();
        const action = stage === "history" ? f.createHistoryEntry : f.api.copyLayerPng;
        action.mockImplementationOnce(() => gate.promise);
        const pending = f.controller.handlePasteSelection();
        await vi.waitFor(() => expect(action).toHaveBeenCalled());
        if (stale) f.workspaceRef.current = { ...f.workspaceRef.current, identity: {} };
        gate.reject(new Error("failed at origin"));
        await pending;
        expectNoPublication(f);
        expect(f.statuses).toEqual(stale ? [] : ["Paste layer failed: failed at origin"]);
      });
    }
  }
  for (const stage of ["queue", "history", "copy"] as const) {
    it(`layer does not use fallback target when the captured layer disappears during ${stage}`, async () => {
      const f = pasteFixture("layer");
      const gate = deferred<any>();
      let queued: Promise<unknown> | undefined;
      if (stage === "queue") queued = f.queue.runExclusive(() => gate.promise);
      if (stage === "history") f.createHistoryEntry.mockImplementationOnce(() => gate.promise);
      if (stage === "copy") f.api.copyLayerPng.mockImplementationOnce(() => gate.promise);
      const pending = f.controller.handlePasteSelection();
      await vi.waitFor(() => {
        if (stage === "history") expect(f.createHistoryEntry).toHaveBeenCalled();
        if (stage === "copy") expect(f.api.copyLayerPng).toHaveBeenCalled();
      });
      f.projectRef.current = { ...f.projectRef.current, shots: f.projectRef.current.shots.map(s => s.id === "target" ?
        { ...s, activeLayerId: "remaining", layers: [layer("target", "remaining", 0)] } : s) };
      const latest = f.projectRef.current;
      gate.resolve(stage === "history" ? "undo-entry" : {});
      await queued;
      await pending;
      expect(f.projectRef.current).toBe(latest);
      expectNoPublication(f);
      if (stage !== "copy") expect(f.api.copyLayerPng).not.toHaveBeenCalled();
    });
  }
  for (const stage of ["ensure", "copy"] as const) {
    it(`shot suppresses stale ${stage} rejection`, async () => {
      const f = pasteFixture("shot");
      const gate = deferred<any>();
      const action = stage === "ensure" ? f.api.ensureLayerAssets : f.api.copyShotAssets;
      action.mockImplementationOnce(() => gate.promise);
      const pending = f.controller.handlePasteSelection();
      await vi.waitFor(() => expect(action).toHaveBeenCalled());
      f.workspaceRef.current = { ...f.workspaceRef.current, identity: {} };
      gate.reject(new Error("failed at origin"));
      await pending;
      expectNoPublication(f);
      expect(f.statuses).toEqual([]);
    });
  }
});

describe("useClipboardActionController", () => {
  it("copies the active storyboard selection into clipboard state", () => {
    const { clipboardSelectionRef, clipboardSelections, controller, statuses } = setupController({
      project: projectWithShots([
        shot("shot-a", 0, [layer("shot-a", "image", 0, { kind: "image", name: "Image" })]),
        shot("shot-b", 1, [layer("shot-b", "image", 0, { kind: "image", name: "Image" })])
      ]),
      selectedShotIds: ["shot-b"]
    });

    controller.handleCopySelection();

    expect(clipboardSelectionRef.current).toEqual({ type: "shot", shotId: "shot-b" });
    expect(clipboardSelections).toEqual([{ type: "shot", shotId: "shot-b" }]);
    expect(statuses).toEqual(["Storyboard copied"]);
  });

  it("reports an empty paste without mutating project state", async () => {
    const { controller, projectRef, statuses } = setupController({
      project: projectWithShots([
        shot("shot-a", 0, [layer("shot-a", "image", 0, { kind: "image", name: "Image" })])
      ])
    });

    await controller.handlePasteSelection();

    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["shot-a"]);
    expect(statuses).toEqual(["Nothing to paste"]);
  });

  it("pastes a copied storyboard after the selected target storyboard", async () => {
    const sourceLayers = [
      layer("source", "image", 0, { kind: "image", name: "Image" }),
      layer("source", "paint-a", 1, { name: "Paint A" })
    ];
    const {
      api,
      controller,
      deleteTargets,
      dirtyShotIds,
      projectRef,
      projectUpdateOptions,
      queuedPasteAnimations,
      selectedBitmapLayerTargets,
      selectedShotIdsByCall,
      statuses
    } = setupController({
      clipboardSelection: { type: "shot", shotId: "source" },
      project: projectWithShots([
        shot("source", 0, sourceLayers),
        shot("target", 1, [layer("target", "image", 0, { kind: "image", name: "Image" })])
      ]),
      selectedShotIds: ["target"]
    });

    await controller.handlePasteSelection();

    expect(api.ensureLayerAssets).toHaveBeenCalledWith({
      project: expect.objectContaining({ id: "project" }),
      folderPath: "/scene",
      metadataPath: "/scene/.storyboard-workbench/project.json"
    });
    expect(api.copyShotAssets).toHaveBeenCalledWith({
      folderPath: "/scene",
      sourceImagePath: "/scene/source.tif",
      fileName: "source.tif",
      layerCopies: [
        {
          sourceBitmapPath: bitmapLayerPath("source", "image"),
          targetBitmapPath: bitmapLayerPath("pasted", "image")
        },
        {
          sourceBitmapPath: bitmapLayerPath("source", "paint-a"),
          targetBitmapPath: bitmapLayerPath("pasted", "paint-a")
        }
      ]
    });
    expect(projectRef.current.shots.map((item) => item.id)).toEqual(["source", "target", "pasted"]);
    expect(dirtyShotIds).toEqual([["pasted"]]);
    expect(selectedShotIdsByCall).toEqual(["pasted"]);
    expect(selectedBitmapLayerTargets).toEqual([undefined]);
    expect(deleteTargets).toEqual([{ type: "shot" }]);
    expect(queuedPasteAnimations).toEqual([
      { kind: "shot", sourceId: "source", pastedId: "pasted" }
    ]);
    expect(projectUpdateOptions).toEqual([
      { markFileNamesUnsynced: undefined, recordUndo: undefined }
    ]);
    expect(statuses).toEqual(["Storyboard pasted"]);
  });

  it("pastes a copied layer before the current target layer without marking file names unsynced", async () => {
    const {
      api,
      controller,
      deleteTargets,
      dirtyShotIds,
      projectRef,
      projectUpdateOptions,
      queuedPasteAnimations,
      selectedBitmapLayerTargets,
      selectedShotIdsByCall,
      statuses,
      undoEntries
    } = setupController({
      clipboardSelection: { type: "layer", shotId: "source", layerId: "paint-source" },
      deleteTarget: { type: "layer", shotId: "target", layerId: "paint-target" },
      project: projectWithShots([
        shot("source", 0, [
          layer("source", "image", 0, { kind: "image", name: "Image" }),
          layer("source", "paint-source", 1, { name: "Paint Source" })
        ]),
        shot("target", 1, [
          layer("target", "image", 0, { kind: "image", name: "Image" }),
          layer("target", "paint-target", 1, { name: "Paint Target" })
        ])
      ])
    });

    await controller.handlePasteSelection();

    expect(api.copyLayerPng).toHaveBeenCalledWith({
      folderPath: "/scene",
      sourceBitmapPath: bitmapLayerPath("source", "paint-source"),
      targetBitmapPath: bitmapLayerPath("target", "layer-pasted")
    });
    expect(projectRef.current.shots[1].layers?.map((item) => item.id)).toEqual([
      "image",
      "layer-pasted",
      "paint-target"
    ]);
    expect(dirtyShotIds).toEqual([["target"]]);
    expect(undoEntries).toEqual(["undo-entry:Project"]);
    expect(selectedShotIdsByCall).toEqual(["target"]);
    expect(selectedBitmapLayerTargets).toEqual([
      { shotId: "target", layerIds: ["layer-pasted"] }
    ]);
    expect(deleteTargets).toEqual([
      { type: "layer", shotId: "target", layerId: "layer-pasted" }
    ]);
    expect(queuedPasteAnimations).toEqual([
      { kind: "layer", sourceId: "paint-source", pastedId: "layer-pasted" }
    ]);
    expect(projectUpdateOptions).toEqual([
      { markFileNamesUnsynced: false, recordUndo: false }
    ]);
    expect(statuses).toEqual(['Layer "Paint Source" pasted']);
  });
});
