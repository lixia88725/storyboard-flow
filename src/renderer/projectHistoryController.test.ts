import { describe, expect, it, vi } from "vitest";
// Hook lifecycle is synchronous here; queue and history/asset algorithms remain real.
vi.mock("react", () => ({
  useState: (initial: unknown) => [initial, vi.fn()],
  useRef: (initial: unknown) => ({ current: initial }),
  useEffect: (effect: () => void) => effect(),
  useCallback: (fn: unknown) => fn
}));
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import {
  useProjectHistoryController,
  historyAppliedStatus,
  historyDirtyShotIds,
  historyEntryAffectedBitmapPaths,
  historyUnavailableStatus,
  type ProjectHistoryEntry
} from "./projectHistoryController";
import { createProject } from "../shared/projectOps";
import type { BitmapLayer, Project, Shot } from "../shared/types";

const entry = (bitmapPaths: string[]): ProjectHistoryEntry => ({
  project: createProject(),
  selectedShotIds: ["shot-a"],
  fileNameSyncState: "unsynced",
  layerAssets: bitmapPaths.map((bitmapPath) => ({ bitmapPath }))
});

const layer = (shotId: string): BitmapLayer => ({
  id: "layer-image",
  kind: "image",
  name: "Image",
  visible: true,
  locked: false,
  opacity: 1,
  blendMode: "normal",
  order: 0,
  bitmapPath: `.storyboard-workbench/layers/${shotId}/layer-image.png`,
  width: 320,
  height: 180
});

const shot = (id: string, order: number): Shot => ({
  id,
  order,
  fileName: `${id}.tiff`,
  imagePath: `/scene/${id}.tiff`,
  layers: [layer(id)],
  activeLayerId: "layer-image"
});

const projectWithShots = (): Project => ({
  ...createProject("History fixture"),
  shots: [shot("shot-a", 0), shot("shot-b", 1)]
});

const setupHistory = () => {
  const projectRef = { current: projectWithShots() };
  const locked = { current: false };
  const isImageImportLocked = vi.fn(() => locked.current);
  const queue = createBitmapLayerWriteQueue();
  const pixels = new Map([[layer("shot-a").bitmapPath, "new pixels"]]);
  const api = {
    readLayerPng: vi.fn(async ({ bitmapPath }: { bitmapPath: string }) => pixels.get(bitmapPath)),
    writeLayerPng: vi.fn(async ({ bitmapPath, dataUrl }: { bitmapPath: string; dataUrl: string }) => { pixels.set(bitmapPath, dataUrl); return {} as never; }),
    deleteLayerPng: vi.fn(async ({ bitmapPath }: { bitmapPath: string }) => { pixels.delete(bitmapPath); return { folderPath: "/synthetic", bitmapPath }; })
  };
  const folderPathRef = { current: "/synthetic" };
  const selectedShotIdsRef = { current: ["shot-a"] };
  const fileNameSyncStateRef = { current: "unsynced" as const as "unsynced" | "synced" };
  const setProject = vi.fn();
  const markShotsDirty = vi.fn();
  const selectShotsByIds = vi.fn();
  const c = useProjectHistoryController({
    isImageImportLocked, api, bitmapLayerWriteQueueRef: { current: queue },
    fileNameSyncStateRef, folderPathRef,
    maxEntries: 60, projectRef, scriptImportCheckIdRef: { current: 0 },
    selectedShotIdsRef, selectShotsByIds, markShotsDirty, setProject,
    setAutosaveRevision: vi.fn(), setFileNameSyncState: vi.fn(), setScriptImportNeeded: vi.fn(),
    setStatus: vi.fn(), setWorkspaceSaveState: vi.fn()
  });
  c.recordUndoEntry({ ...entry([layer("shot-a").bitmapPath]), project: { ...projectRef.current, name: "previous" },
    layerAssets: [{ bitmapPath: layer("shot-a").bitmapPath, dataUrl: "old pixels" }] });
  return { c, api, locked, isImageImportLocked, queue, projectRef, folderPathRef,
    selectedShotIdsRef, fileNameSyncStateRef, pixels, setProject, markShotsDirty, selectShotsByIds };
};

describe("image Import history admission", () => {
  it("linearizes metadata-only history at the last lock check without an empty restore await gap", async () => {
    const s = setupHistory();
    s.c.resetHistoryStacks();
    s.c.recordProjectUndoEntry();
    let calls = 0;
    s.isImageImportLocked.mockImplementation(() => {
      if (++calls === 3) queueMicrotask(() => { s.locked.current = true; });
      return s.locked.current;
    });
    const locksAtCommit: boolean[] = [];
    s.setProject.mockImplementation(() => { locksAtCommit.push(s.locked.current); });
    await s.c.applyUndoEntry();
    expect(locksAtCommit).toEqual([false]);
    expect(s.locked.current).toBe(true);
    expect(s.api.writeLayerPng).not.toHaveBeenCalled();
  });
  it.each(["undo", "redo"] as const)("rejects locked %s without asset reads/writes, popping history or publishing", async (direction) => {
    const s = setupHistory();
    if (direction === "redo") { await s.c.applyUndoEntry(); vi.clearAllMocks(); }
    s.locked.current = true;
    const before = structuredClone(s.projectRef.current);
    await (direction === "undo" ? s.c.applyUndoEntry() : s.c.applyRedoEntry());
    expect(s.api.readLayerPng).not.toHaveBeenCalled();
    expect(s.api.writeLayerPng).not.toHaveBeenCalled();
    expect(s.setProject).not.toHaveBeenCalled();
    expect(s.projectRef.current).toEqual(before);
    s.locked.current = false;
    await (direction === "undo" ? s.c.applyUndoEntry() : s.c.applyRedoEntry());
    expect(s.setProject).toHaveBeenCalledOnce();
  });
  it.each(["undo", "redo"] as const)("rejects %s on real queue departure if image lock arrived", async (direction) => {
    const s = setupHistory();
    if (direction === "redo") { await s.c.applyUndoEntry(); vi.clearAllMocks(); }
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const blocker = s.queue.runExclusive(() => gate);
    const task = direction === "undo" ? s.c.applyUndoEntry() : s.c.applyRedoEntry();
    s.locked.current = true;
    release();
    await Promise.all([blocker, task]);
    expect(s.api.readLayerPng).not.toHaveBeenCalled();
    expect(s.api.writeLayerPng).not.toHaveBeenCalled();
    expect(s.setProject).not.toHaveBeenCalled();
    expect(s.markShotsDirty).not.toHaveBeenCalled();
    expect(s.selectShotsByIds).not.toHaveBeenCalled();
    s.locked.current = false;
    await (direction === "undo" ? s.c.applyUndoEntry() : s.c.applyRedoEntry());
    expect(s.setProject).toHaveBeenCalledOnce();
  });
  it.each(["undo", "redo"] as const)("finishes %s if image lock arrives after restore IPC begins", async (direction) => {
    const s = setupHistory();
    if (direction === "redo") { await s.c.applyUndoEntry(); vi.clearAllMocks(); }
    s.api.writeLayerPng.mockImplementation(async ({ bitmapPath, dataUrl }) => {
      s.locked.current = true; s.pixels.set(bitmapPath, dataUrl); return {} as never;
    });
    await (direction === "undo" ? s.c.applyUndoEntry() : s.c.applyRedoEntry());
    expect(s.setProject).toHaveBeenCalledOnce();
    expect(s.markShotsDirty).toHaveBeenCalledOnce();
    expect(s.projectRef.current.name).toBe(direction === "undo" ? "previous" : "History fixture");
    expect(s.pixels.get(layer("shot-a").bitmapPath)).toBe(direction === "undo" ? "old pixels" : "new pixels");
    s.locked.current = false;
    await (direction === "undo" ? s.c.applyRedoEntry() : s.c.applyUndoEntry());
    expect(s.setProject).toHaveBeenCalledTimes(2);
  });
  it("rejects Undo after read-only reciprocal snapshot before restoring pixels", async () => {
    const s = setupHistory();
    s.api.readLayerPng.mockImplementation(async () => { s.locked.current = true; return "new pixels"; });
    await s.c.applyUndoEntry();
    expect(s.api.writeLayerPng).not.toHaveBeenCalled();
    expect(s.setProject).not.toHaveBeenCalled();
    s.locked.current = false;
    s.api.readLayerPng.mockImplementation(async () => "new pixels");
    await s.c.applyUndoEntry();
    expect(s.projectRef.current.name).toBe("previous");
  });
});

describe("projectHistoryController snapshot capture", () => {
  it("captures project, selection and filename state before deferred PNG reads", async () => {
    const s = setupHistory();
    const originalProject = s.projectRef.current;
    let release!: (pixels: string) => void;
    s.api.readLayerPng.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const pending = s.c.createHistoryEntry([layer("shot-a").bitmapPath]);
    s.projectRef.current = { ...originalProject, name: "new metadata" };
    s.selectedShotIdsRef.current.push("shot-b");
    s.fileNameSyncStateRef.current = "synced";
    s.folderPathRef.current = "/other";
    release("original pixels");
    const captured = await pending;
    expect(captured.project).toBe(originalProject);
    expect(captured.selectedShotIds).toEqual(["shot-a"]);
    expect(captured.fileNameSyncState).toBe("unsynced");
    expect(captured.layerAssets).toEqual([{ bitmapPath: layer("shot-a").bitmapPath, dataUrl: "original pixels" }]);
    expect(s.api.readLayerPng).toHaveBeenCalledWith({ folderPath: "/synthetic", bitmapPath: layer("shot-a").bitmapPath });
    expect(s.setProject).not.toHaveBeenCalled();
  });
});

describe("projectHistoryController", () => {
  it("lists affected bitmap paths from layer asset snapshots", () => {
    expect(historyEntryAffectedBitmapPaths(entry(["layers/a.png", "layers/b.png"]))).toEqual([
      "layers/a.png",
      "layers/b.png"
    ]);
    expect(
      historyEntryAffectedBitmapPaths({
        project: createProject(),
        selectedShotIds: [],
        fileNameSyncState: "synced"
      })
    ).toEqual([]);
  });

  it("keeps undo and redo status copy in the history controller", () => {
    expect(historyUnavailableStatus("undo")).toBe("Nothing to undo");
    expect(historyUnavailableStatus("redo")).toBe("Nothing to redo");
    expect(historyAppliedStatus("undo")).toBe("Undid last change");
    expect(historyAppliedStatus("redo")).toBe("Redid last change");
  });

  it("marks only shots whose TIFF inputs changed across history", () => {
    const current = projectWithShots();
    const restored = {
      ...current,
      shots: [
        {
          ...current.shots[0],
          layers: current.shots[0].layers?.map((item) => ({ ...item, opacity: 0.5 }))
        },
        current.shots[1]
      ]
    };

    expect(historyDirtyShotIds(current, restored, [])).toEqual(["shot-a"]);
  });

  it("maps restored layer pixels to their owning shot even when metadata is unchanged", () => {
    const current = projectWithShots();

    expect(
      historyDirtyShotIds(current, current, [
        ".storyboard-workbench/layers/shot-b/layer-image.png"
      ])
    ).toEqual(["shot-b"]);
  });

  it("does not rewrite TIFFs for history changes that only affect project JSON", () => {
    const current = projectWithShots();
    const restored = {
      ...current,
      name: "Renamed project",
      shots: [
        { ...current.shots[0], scriptText: "Updated action notes" },
        current.shots[1]
      ]
    };

    expect(historyDirtyShotIds(current, restored, [])).toEqual([]);
  });
});
