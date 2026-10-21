import { describe, expect, it, vi } from "vitest";
import type { Project } from "../shared/types";
import { applyProjectMatte, bitmapLayersForShot, dialogueOverlayBitmapLayerId, matteOverlayBitmapLayerId, sceneDialogueOverlayEnabledForProject, upsertDialogueOverlayBitmapLayer } from "../shared/projectOps";
import { createBitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import {
  addShotInsertedShotId,
  type AddShotWorkspace,
  initialAddShotContext,
  prepareAddShotMatte,
  useAddShotController
} from "./addShotController";

const projectWithShots = (shotIds: string[]): Project =>
  ({
    shots: shotIds.map((id) => ({ id, imagePath: `${id}.tiff` }))
  }) as Project;

const workspace = { identity: {}, folderPath: "/scene", metadataPath: "/scene/.storyboard-workbench/storyboard.project.json" };
const ownership = { isImageImportLocked: () => false, captureWorkspace: () => workspace, isCurrentWorkspace: (request: AddShotWorkspace) => request === workspace };
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

const raceFixture = () => {
  const projectRef = { current: projectWithShots(["shot-1"]) };
  let currentWorkspace = workspace;
  const blank = deferred<{ imagePath: string; fileName: string; width: number; height: number }>();
  const options = {
    ...ownership,
    captureWorkspace: () => currentWorkspace,
    isCurrentWorkspace: (request: AddShotWorkspace) => request.identity === currentWorkspace.identity && request.folderPath === currentWorkspace.folderPath && request.metadataPath === currentWorkspace.metadataPath,
    api: { createBlankShot: vi.fn(() => blank.promise), writeLayerPng: vi.fn(async () => undefined) } as unknown as Window["storyboard"],
    blankShotPreset: "16:9" as const,
    createTransparentLayerDataUrl: vi.fn(async () => "data:image/png;base64,"),
    folderPath: workspace.folderPath, metadataPath: workspace.metadataPath,
    primarySelectedShotId: "shot-1", projectRef,
    inheritSceneMatte: vi.fn(async (project: Project) => project),
    loadFolderScan: vi.fn(), markShotsDirty: vi.fn(), selectSingleShot: vi.fn(),
    setRecentFolders: vi.fn(), setStatus: vi.fn(), setWorkspaceTask: vi.fn(),
    updateProject: vi.fn((update: Project | ((p: Project) => Project)) => { projectRef.current = typeof update === "function" ? update(projectRef.current) : update; })
  };
  return { options, blank, projectRef, changeMetadata: () => { currentWorkspace = { ...currentWorkspace, metadataPath: "/scene/replaced.project.json" }; }, switchWorkspace: (mode = "switch") => {
    const originalProject = projectRef.current;
    currentWorkspace = { identity: {}, folderPath: "/other", metadataPath: "/other/project.json" };
    projectRef.current = projectWithShots(["other-shot"]);
    if (mode !== "switch") {
      currentWorkspace = { ...workspace, identity: {} };
      projectRef.current = mode === "roundtrip" ? originalProject : projectWithShots(["reloaded-shot"]);
    }
  } };
};
const blankImage = { imagePath: "/scene/new.tiff", fileName: "new.tiff", width: 1920, height: 1080 };

const configureRealMatte = (f: ReturnType<typeof raceFixture>) => {
  f.projectRef.current.shots[0].presentation = { matte: { mode: "expanded", top: 75, bottom: 75, sourceHeight: 1080 } };
  const asset = deferred<void>();
  const entered = deferred<void>();
  const readLayerPng = vi.fn(async () => "data:image/png;base64,source");
  const writeLayerPng = vi.fn(async (_payload: Parameters<Window["storyboard"]["writeLayerPng"]>[0]) => { entered.resolve(); await asset.promise; return {} as never; });
  const deleteLayerPng = vi.fn();
  const ensureLayerAssets = vi.fn(async (_payload: Parameters<Window["storyboard"]["ensureLayerAssets"]>[0]) => ({} as never));
  const api = { readLayerPng, writeLayerPng, deleteLayerPng, ensureLayerAssets } as unknown as Window["storyboard"];
  const prepare = (p: Project, mode: "expanded" | "embedded", ids: readonly string[], request: Parameters<typeof prepareAddShotMatte>[3]) => prepareAddShotMatte(p, mode, ids, request, {
    api, queue: createBitmapLayerWriteQueue(),
    canvas: { expandBitmapLayer: vi.fn(async () => "data:image/png;base64,expanded"), createMatteOverlay: vi.fn(() => "data:image/png;base64,matte"), createDialogueOverlay: vi.fn(() => "data:image/png;base64,dialogue") }
  });
  return { asset, entered, readLayerPng, writeLayerPng, deleteLayerPng, ensureLayerAssets, prepare };
};

describe("addShotController", () => {
  it("rejects Add entry with the image Import lock before any blank asset creation", async () => {
    const f = raceFixture();
    await useAddShotController({ ...f.options, isImageImportLocked: () => true }).handleAddShot();
    expect(f.options.api!.createBlankShot).not.toHaveBeenCalled();
    expect(f.options.updateProject).not.toHaveBeenCalled();
    expect(f.options.markShotsDirty).not.toHaveBeenCalled();
    expect(f.options.selectSingleShot).not.toHaveBeenCalled();
  });
  it("finishes Add metadata and layer preparation when image lock arrives after blank TIFF creation begins", async () => {
    const f = raceFixture();
    let locked = false;
    const task = useAddShotController({ ...f.options, isImageImportLocked: () => locked }).handleAddShot();
    expect(f.options.api!.createBlankShot).toHaveBeenCalledOnce();
    locked = true;
    f.blank.resolve(blankImage);
    await task;
    expect(f.options.api!.writeLayerPng).toHaveBeenCalled();
    expect(f.options.updateProject).toHaveBeenCalledOnce();
    expect(f.options.markShotsDirty).toHaveBeenCalledOnce();
    expect(f.options.selectSingleShot).toHaveBeenCalledOnce();
  });
  it("rechecks Add before blank TIFF creation after async folder preparation", async () => {
    const f = raceFixture();
    const origin = { ...workspace, folderPath: undefined, metadataPath: undefined };
    const loaded = { ...workspace, identity: {} };
    let active: AddShotWorkspace = origin;
    let locked = false;
    const createBlankShot = vi.fn(async () => blankImage);
    const scan = { folderPath: workspace.folderPath, metadataPath: workspace.metadataPath, images: [], project: f.projectRef.current };
    const task = useAddShotController({
      ...f.options, isImageImportLocked: () => locked,
      folderPath: undefined, metadataPath: undefined,
      captureWorkspace: () => active, isCurrentWorkspace: (request) => request.identity === active.identity,
      api: { ...f.options.api, selectFolder: async () => workspace.folderPath,
        openFolderByPath: async () => scan, createBlankShot, getRecentFolders: async () => [] } as unknown as Window["storyboard"],
      loadFolderScan: async () => { active = loaded; locked = true; return f.projectRef.current; }
    }).handleAddShot();
    await task;
    expect(createBlankShot).not.toHaveBeenCalled();
    expect(f.options.updateProject).not.toHaveBeenCalled();
  });
  it.each([
    ["expanded", true], ["embedded", true],
    ["expanded", false], ["embedded", false]
  ] as const)("inherits %s presentation with Dialogue enabled=%s through real preparation", async (mode, enabled) => {
    const f = raceFixture();
    const matte = configureRealMatte(f);
    const sourceProject = projectWithShots(["shot-1", "shot-2"]);
    sourceProject.dialogues = [];
    sourceProject.shots = sourceProject.shots.map((shot, order) => ({ ...shot, order, swb: { version: 1, status: "owned", canvasWidth: 1920, canvasHeight: 1080 } }));
    f.projectRef.current = applyProjectMatte(sourceProject, mode);
    if (enabled) {
      for (const shot of f.projectRef.current.shots) {
        f.projectRef.current = upsertDialogueOverlayBitmapLayer(f.projectRef.current, shot.id);
      }
    }
    expect(sceneDialogueOverlayEnabledForProject(f.projectRef.current)).toBe(enabled);
    const originals = f.projectRef.current.shots;
    const createDialogueOverlay = vi.fn(() => "data:image/png;base64,dialogue");
    const createMatteOverlay = vi.fn(() => "data:image/png;base64,matte");
    const expandBitmapLayer = vi.fn(async () => "data:image/png;base64,expanded");
    const inheritSceneMatte = (p: Project, inheritedMode: "expanded" | "embedded", ids: readonly string[], request: Parameters<typeof prepareAddShotMatte>[3]) => prepareAddShotMatte(p, inheritedMode, ids, request, {
      api: { readLayerPng: matte.readLayerPng, writeLayerPng: matte.writeLayerPng, ensureLayerAssets: matte.ensureLayerAssets, deleteLayerPng: matte.deleteLayerPng } as unknown as Window["storyboard"],
      queue: createBitmapLayerWriteQueue(),
      canvas: { createDialogueOverlay, createMatteOverlay, expandBitmapLayer }
    });
    const task = useAddShotController({ ...f.options, primarySelectedShotId: "shot-2", inheritSceneMatte }).handleAddShot();
    f.blank.resolve(blankImage);
    await matte.entered.promise;
    // Real preparation must remain local while same-scope edits continue.
    expect(f.options.updateProject).not.toHaveBeenCalled();
    f.projectRef.current = { ...f.projectRef.current, name: "Edited during preparation", dialogues: [{ id: "d", text: "Keep dialogue edit", shotId: "shot-1", order: 0 }] } as Project;
    matte.asset.resolve();
    await task;
    const added = f.projectRef.current.shots.find((shot) => shot.imagePath === blankImage.imagePath)!;
    expect(added.presentation?.matte?.mode).toBe(mode);
    const layers = bitmapLayersForShot(added);
    expect(layers.some((layer) => layer.id === matteOverlayBitmapLayerId)).toBe(true);
    expect(layers.some((layer) => layer.id === dialogueOverlayBitmapLayerId)).toBe(enabled);
    expect(createDialogueOverlay).toHaveBeenCalledTimes(enabled ? 1 : 0);
    if (enabled) {
      const overlay = layers.find((layer) => layer.id === dialogueOverlayBitmapLayerId)!;
      expect(matte.writeLayerPng).toHaveBeenCalledWith({ folderPath: "/scene", bitmapPath: overlay.bitmapPath, dataUrl: "data:image/png;base64,dialogue" });
    } else {
      expect(matte.writeLayerPng.mock.calls.some(([payload]) => payload.dataUrl === "data:image/png;base64,dialogue")).toBe(false);
    }
    expect(added.swb?.canvasHeight).toBe(mode === "expanded" ? 1230 : 1080);
    expect(createMatteOverlay).toHaveBeenCalledTimes(1);
    expect(expandBitmapLayer.mock.calls.length > 0).toBe(mode === "expanded");
    expect(matte.writeLayerPng.mock.calls.every(([payload]) => payload.folderPath === "/scene" && payload.bitmapPath.includes(added.id))).toBe(true);
    expect(f.projectRef.current.shots.filter((shot) => shot.id !== added.id)).toEqual(originals);
    expect(f.projectRef.current.name).toBe("Edited during preparation");
    expect(f.projectRef.current.dialogues[0].text).toBe("Keep dialogue edit");
    expect(f.options.updateProject).toHaveBeenCalledTimes(1);
    expect(f.options.updateProject).toHaveBeenCalledWith(expect.any(Function), true, false);
    expect(f.options.markShotsDirty).toHaveBeenCalledWith([added.id]);
    expect(f.options.selectSingleShot).toHaveBeenCalledWith(added.id);
    expect(matte.deleteLayerPng).not.toHaveBeenCalled();
  });
  it.each(["switch", "roundtrip", "reload"])("rejects PNG completion after %s even when folder strings return to A", async (mode) => {
    const f = raceFixture();
    const png = deferred<void>();
    const entered = deferred<void>();
    vi.mocked(f.options.api!.writeLayerPng).mockImplementation(async () => { entered.resolve(); await png.promise; return {} as never; });
    const task = useAddShotController(f.options).handleAddShot();
    f.blank.resolve(blankImage);
    await entered.promise;
    f.switchWorkspace(mode);
    const otherProject = f.projectRef.current;
    png.resolve();
    await task;
    expect(f.projectRef.current).toBe(otherProject);
    expect(f.options.updateProject).not.toHaveBeenCalled();
    expect(f.options.markShotsDirty).not.toHaveBeenCalled();
    expect(f.options.selectSingleShot).not.toHaveBeenCalled();
    expect(f.options.setStatus).not.toHaveBeenCalled();
    expect(f.options.setWorkspaceTask).not.toHaveBeenCalled();
  });

  it("rejects delayed transparent canvas generation without starting stale PNG writes", async () => {
    const f = raceFixture();
    const canvas = deferred<string>();
    const entered = deferred<void>();
    f.options.createTransparentLayerDataUrl.mockImplementation(() => { entered.resolve(); return canvas.promise; });
    const task = useAddShotController(f.options).handleAddShot();
    f.blank.resolve(blankImage);
    await entered.promise;
    f.switchWorkspace();
    canvas.resolve("data:image/png;base64,");
    await task;
    expect(f.options.api!.writeLayerPng).not.toHaveBeenCalled();
    expect(f.options.updateProject).not.toHaveBeenCalled();
  });

  it.each([false, true])("PNG failure does not publish or change selection (stale=%s)", async (stale) => {
    const f = raceFixture();
    const png = deferred<never>();
    const entered = deferred<void>();
    vi.mocked(f.options.api!.writeLayerPng).mockImplementation(() => { entered.resolve(); return png.promise; });
    const task = useAddShotController(f.options).handleAddShot();
    f.blank.resolve(blankImage);
    await entered.promise;
    if (stale) f.switchWorkspace();
    png.reject(new Error("synthetic PNG failure"));
    await task;
    expect(f.options.updateProject).not.toHaveBeenCalled();
    expect(f.options.markShotsDirty).not.toHaveBeenCalled();
    expect(f.options.selectSingleShot).not.toHaveBeenCalled();
    if (stale) expect(f.options.setStatus).not.toHaveBeenCalled();
    else expect(f.options.setStatus).toHaveBeenCalledWith("Add shot layer failed: synthetic PNG failure");
  });

  it.each(["late-success", "late-rejection", "failure", "success"])("isolates real matte preparation: %s", async (scenario) => {
    const f = raceFixture();
    const matte = configureRealMatte(f);
    const task = useAddShotController({ ...f.options, inheritSceneMatte: matte.prepare }).handleAddShot();
    f.blank.resolve(blankImage);
    await matte.entered.promise;
    const stale = scenario.startsWith("late-");
    if (stale) f.switchWorkspace();
    else f.projectRef.current = { ...f.projectRef.current, name: "During matte", dialogues: [{ id: "d", text: "During matte dialogue", shotId: "shot-1", order: 0 }] } as Project;
    const before = f.projectRef.current;
    if (scenario === "failure" || scenario === "late-rejection") matte.asset.reject(new Error("synthetic matte failure"));
    else matte.asset.resolve();
    await task;
    expect(matte.deleteLayerPng).not.toHaveBeenCalled();
    expect(matte.ensureLayerAssets.mock.calls[0][0].project.shots).toHaveLength(1);
    expect(matte.writeLayerPng.mock.calls.every((call) => call[0].folderPath === "/scene")).toBe(true);
    if (scenario === "success") {
      expect(f.projectRef.current.name).toBe("During matte");
      expect(f.projectRef.current.dialogues[0].text).toBe("During matte dialogue");
      expect(f.projectRef.current.shots.find((s) => s.imagePath === blankImage.imagePath)?.presentation?.matte?.mode).toBe("expanded");
      expect(f.options.updateProject).toHaveBeenCalledTimes(1);
    } else {
      expect(f.projectRef.current).toBe(before);
      expect(f.options.updateProject).not.toHaveBeenCalled();
      expect(f.options.markShotsDirty).not.toHaveBeenCalled();
      expect(f.options.selectSingleShot).not.toHaveBeenCalled();
      if (stale) expect(f.options.setStatus).not.toHaveBeenCalled();
    }
    expect(f.options.setWorkspaceTask).not.toHaveBeenCalled();
  });
  it("adds the first shot after its own folder load establishes a new identity", async () => {
    const f = raceFixture();
    let current: AddShotWorkspace = { identity: {}, folderPath: undefined, metadataPath: undefined };
    const scan = { folderPath: workspace.folderPath, metadataPath: workspace.metadataPath, folderName: "scene", images: [] } as never;
    const options = {
      ...f.options, folderPath: undefined, metadataPath: undefined,
      captureWorkspace: () => current,
      isCurrentWorkspace: (request: AddShotWorkspace) => request.identity === current.identity && request.folderPath === current.folderPath && request.metadataPath === current.metadataPath,
      api: { ...f.options.api, selectFolder: vi.fn(async () => "/scene"), openFolderByPath: vi.fn(async () => scan), getRecentFolders: vi.fn(async () => []) } as unknown as Window["storyboard"],
      loadFolderScan: vi.fn(async () => { current = { ...workspace, identity: {} }; f.projectRef.current = projectWithShots([]); return f.projectRef.current; })
    };
    f.blank.resolve(blankImage);
    await useAddShotController(options).handleAddShot();
    expect(f.projectRef.current.shots).toHaveLength(1);
    expect(options.api.createBlankShot).toHaveBeenCalledWith("/scene", { preset: "16:9" });
    expect(options.updateProject).toHaveBeenCalledTimes(1);
    expect(options.setWorkspaceTask.mock.calls.at(-1)).toEqual([undefined]);
  });

  it("rejects a same-folder reload during the first-folder load instead of adopting its newer identity", async () => {
    const f = raceFixture();
    let current: AddShotWorkspace = { identity: {}, folderPath: undefined, metadataPath: undefined };
    const loading = deferred<Project>();
    const entered = deferred<void>();
    const scan = { folderPath: workspace.folderPath, metadataPath: workspace.metadataPath, folderName: "scene", images: [] } as never;
    const options = {
      ...f.options, folderPath: undefined, metadataPath: undefined,
      captureWorkspace: () => current,
      isCurrentWorkspace: (request: AddShotWorkspace) => request.identity === current.identity && request.folderPath === current.folderPath && request.metadataPath === current.metadataPath,
      api: { ...f.options.api, selectFolder: vi.fn(async () => "/scene"), openFolderByPath: vi.fn(async () => scan), getRecentFolders: vi.fn(async () => []) } as unknown as Window["storyboard"],
      loadFolderScan: vi.fn(() => { current = { ...workspace, identity: {} }; entered.resolve(); return loading.promise; })
    };
    const task = useAddShotController(options).handleAddShot();
    await entered.promise;
    current = { ...workspace, identity: {} };
    f.projectRef.current = projectWithShots(["reloaded-shot"]);
    f.blank.resolve(blankImage);
    loading.resolve(projectWithShots([]));
    await task;
    expect(options.api.createBlankShot).not.toHaveBeenCalled();
    expect(options.updateProject).not.toHaveBeenCalled();
  });

  it("does not publish a blank TIFF that arrives after switching workspace", async () => {
    const f = raceFixture();
    const task = useAddShotController(f.options).handleAddShot();
    f.switchWorkspace();
    const otherProject = f.projectRef.current;
    f.blank.resolve(blankImage);
    await task;
    expect(f.projectRef.current).toBe(otherProject);
    expect(f.options.api?.writeLayerPng).not.toHaveBeenCalled();
    expect(f.options.updateProject).not.toHaveBeenCalled();
    expect(f.options.markShotsDirty).not.toHaveBeenCalled();
    expect(f.options.selectSingleShot).not.toHaveBeenCalled();
    expect(f.options.setStatus).not.toHaveBeenCalled();
    expect(f.options.setWorkspaceTask).not.toHaveBeenCalled();
  });
  it("rejects a metadata destination change even if folder and lifecycle identity match", async () => {
    const f = raceFixture();
    const task = useAddShotController(f.options).handleAddShot();
    f.changeMetadata();
    f.blank.resolve(blankImage);
    await task;
    expect(f.options.api.writeLayerPng).not.toHaveBeenCalled();
    expect(f.options.updateProject).not.toHaveBeenCalled();
    expect(f.options.setStatus).not.toHaveBeenCalled();
  });

  it("commits only the prepared new matte shot onto same-scope edits made during inheritance", async () => {
    const f = raceFixture();
    f.projectRef.current.shots[0].presentation = { matte: { mode: "expanded", top: 75, bottom: 75, sourceHeight: 1080 } };
    const matte = deferred<Project>();
    const entered = deferred<Project>();
    f.options.inheritSceneMatte = vi.fn((p: Project) => { entered.resolve(p); return matte.promise; });
    const task = useAddShotController(f.options).handleAddShot();
    f.blank.resolve(blankImage);
    const candidate = await entered.promise;
    f.projectRef.current = { ...f.projectRef.current, name: "Edited name", dialogues: [{ id: "d", text: "Edited dialogue", shotId: "shot-1", order: 0 }] } as Project;
    const prepared = { ...candidate, shots: candidate.shots.map((shot) => shot.imagePath === blankImage.imagePath ? { ...shot, presentation: { matte: { mode: "expanded" as const, top: 75, bottom: 75, sourceHeight: 1080 } } } : shot) };
    matte.resolve(prepared);
    await task;
    expect(f.projectRef.current.name).toBe("Edited name");
    expect(f.projectRef.current.dialogues[0].text).toBe("Edited dialogue");
    expect(f.projectRef.current.shots.find((s) => s.imagePath === blankImage.imagePath)?.presentation?.matte?.mode).toBe("expanded");
    expect(f.options.updateProject).toHaveBeenCalledTimes(1);
  });

  it.each(["partial", "aba", "success"] as const)("first-shot owned open (%s) adopts only a completed load bound to its own identity", async (mode) => {
    const f = raceFixture();
    const meta = "/scene/.storyboard-workbench/storyboard.project.json";
    let current: AddShotWorkspace = { identity: {}, folderPath: undefined, metadataPath: undefined };
    let created = 0;
    const options = {
      ...f.options,
      folderPath: undefined, metadataPath: undefined,
      captureWorkspace: () => current,
      isCurrentWorkspace: (request: AddShotWorkspace) => request.identity === current.identity && request.folderPath === current.folderPath && request.metadataPath === current.metadataPath,
      api: {
        ...f.options.api,
        selectFolder: vi.fn(async () => "/scene"),
        createBlankShot: vi.fn(async (folder: string) => { created++; return { imagePath: `${folder}/new.tiff`, fileName: "new.tiff", width: 1920, height: 1080 }; }),
        getRecentFolders: vi.fn(async () => [])
      } as unknown as Window["storyboard"],
      openOwnedFolder: vi.fn(async () => {
        if (mode === "partial") {
          // The identity published by this load is current; only the completion flag refuses it,
          // so this case isolates the load-completion guard (never a false "opened" workspace).
          const identity = {};
          current = { identity, folderPath: "/scene", metadataPath: meta };
          return { identity, folderPath: "/scene", metadataPath: meta, loaded: false };
        }
        if (mode === "aba") {
          // A newer same-path load replaced the identity after this open started.
          const stale = {};
          current = { identity: {}, folderPath: "/scene", metadataPath: meta };
          return { identity: stale, folderPath: "/scene", metadataPath: meta, project: f.projectRef.current, loaded: true };
        }
        const identity = {};
        current = { identity, folderPath: "/scene", metadataPath: meta };
        return { identity, folderPath: "/scene", metadataPath: meta, project: f.projectRef.current, loaded: true };
      })
    };
    f.blank.resolve(blankImage);
    await useAddShotController(options).handleAddShot();
    expect(options.openOwnedFolder).toHaveBeenCalledOnce();
    if (mode === "success") {
      expect(created).toBe(1);
      expect(f.options.updateProject).toHaveBeenCalled();
    } else {
      expect(created).toBe(0);
      expect(f.options.updateProject).not.toHaveBeenCalled();
      expect(options.setWorkspaceTask).toHaveBeenLastCalledWith(undefined);
    }
  });

  it("uses the current workspace and selected shot when a folder is already loaded", () => {
    const project = projectWithShots(["shot-1", "shot-2"]);

    expect(
      initialAddShotContext({
        folderPath: "/scene",
        metadataPath: "/scene/.storyboard-workbench/storyboard.project.json",
        primarySelectedShotId: "shot-2",
        project
      })
    ).toEqual({
      kind: "ready",
      baseProject: project,
      insertAfterShotId: "shot-2",
      targetFolderPath: "/scene"
    });
  });

  it("requires a folder before adding the first shot", () => {
    const project = projectWithShots([]);

    expect(
      initialAddShotContext({
        folderPath: "",
        metadataPath: "",
        primarySelectedShotId: undefined,
        project
      })
    ).toEqual({
      kind: "needs-folder",
      status: "Choose a folder for the first shot"
    });
  });

  it("finds the inserted shot by generated image path", () => {
    const project = {
      shots: [
        { id: "old-shot", imagePath: "/scene/old.tiff" },
        { id: "new-shot", imagePath: "/scene/new.tiff" }
      ]
    } as Project;

    expect(addShotInsertedShotId(project, "/scene/new.tiff")).toBe("new-shot");
    expect(addShotInsertedShotId(project, "/scene/missing.tiff")).toBeUndefined();
  });

  it("passes the selected 9:16 preset when adding a blank shot", async () => {
    const api = {
      createBlankShot: vi.fn(async () => ({
        imagePath: "/scene/new.tiff",
        fileName: "new.tiff",
        width: 1080,
        height: 1920
      })),
      writeLayerPng: vi.fn(async () => undefined)
    } as unknown as Window["storyboard"];
    const project = projectWithShots(["shot-1"]);
    const updateProject = vi.fn();

    const { handleAddShot } = useAddShotController({
      api,
      ...ownership,
      blankShotPreset: "9:16",
      createTransparentLayerDataUrl: vi.fn(async () => "data:image/png;base64,"),
      folderPath: "/scene",
      inheritSceneMatte: vi.fn(async (project: Project) => project),
      loadFolderScan: vi.fn(),
      markShotsDirty: vi.fn(),
      metadataPath: "/scene/.storyboard-workbench/storyboard.project.json",
      primarySelectedShotId: "shot-1",
      projectRef: { current: project },
      selectSingleShot: vi.fn(),
      setRecentFolders: vi.fn(),
      setStatus: vi.fn(),
      setWorkspaceTask: vi.fn(),
      updateProject
    });

    await handleAddShot();

    expect(api?.createBlankShot).toHaveBeenCalledWith("/scene", { preset: "9:16" });
    expect(updateProject).toHaveBeenCalled();
  });

  it("automatically inherits the active scene matte on a newly generated shot", async () => {
    const api = {
      createBlankShot: vi.fn(async () => ({
        imagePath: "/scene/new.tiff",
        fileName: "new.tiff",
        width: 1920,
        height: 1080
      })),
      writeLayerPng: vi.fn(async () => undefined)
    } as unknown as Window["storyboard"];
    const project = projectWithShots(["shot-1"]);
    project.shots[0] = {
      ...project.shots[0],
      presentation: {
        matte: {
          mode: "expanded",
          top: 75,
          bottom: 75,
          sourceHeight: 1080
        }
      }
    } as Project["shots"][number];
    const inheritSceneMatte = vi.fn(async (project: Project) => project);

    const { handleAddShot } = useAddShotController({
      api,
      ...ownership,
      blankShotPreset: "16:9",
      createTransparentLayerDataUrl: vi.fn(async () => "data:image/png;base64,"),
      folderPath: "/scene",
      inheritSceneMatte,
      loadFolderScan: vi.fn(),
      markShotsDirty: vi.fn(),
      metadataPath: "/scene/.storyboard-workbench/storyboard.project.json",
      primarySelectedShotId: "shot-1",
      projectRef: { current: project },
      selectSingleShot: vi.fn(),
      setRecentFolders: vi.fn(),
      setStatus: vi.fn(),
      setWorkspaceTask: vi.fn(),
      updateProject: vi.fn()
    });

    await handleAddShot();

    expect(inheritSceneMatte).toHaveBeenCalledWith(
      expect.objectContaining({
        shots: expect.arrayContaining([
          expect.objectContaining({ imagePath: "/scene/new.tiff" })
        ])
      }),
      "expanded",
      [expect.any(String)],
      expect.objectContaining({ origin: workspace, isCurrent: expect.any(Function) })
    );
  });

  it("rebases a generated shot onto project edits made while its layer assets are written", async () => {
    const project = projectWithShots(["shot-1"]);
    const projectRef = { current: project };
    const api = {
      createBlankShot: vi.fn(async () => ({
        imagePath: "/scene/new.tiff",
        fileName: "new.tiff",
        width: 1920,
        height: 1080
      })),
      writeLayerPng: vi.fn(async () => {
        projectRef.current = {
          ...projectRef.current,
          name: "Edited while Add Shot was writing"
        };
      })
    } as unknown as Window["storyboard"];
    const updateProject = vi.fn(
      (update: Project | ((currentProject: Project) => Project)) => {
        projectRef.current =
          typeof update === "function" ? update(projectRef.current) : update;
      }
    );

    const { handleAddShot } = useAddShotController({
      api,
      ...ownership,
      blankShotPreset: "16:9",
      createTransparentLayerDataUrl: vi.fn(async () => "data:image/png;base64,"),
      folderPath: "/scene",
      inheritSceneMatte: vi.fn(async (project: Project) => project),
      loadFolderScan: vi.fn(),
      markShotsDirty: vi.fn(),
      metadataPath: "/scene/.storyboard-workbench/storyboard.project.json",
      primarySelectedShotId: "shot-1",
      projectRef,
      selectSingleShot: vi.fn(),
      setRecentFolders: vi.fn(),
      setStatus: vi.fn(),
      setWorkspaceTask: vi.fn(),
      updateProject
    });

    await handleAddShot();

    expect(projectRef.current.name).toBe("Edited while Add Shot was writing");
    expect(
      projectRef.current.shots.some(
        (shot) => shot.imagePath === "/scene/new.tiff"
      )
    ).toBe(true);
  });
});
