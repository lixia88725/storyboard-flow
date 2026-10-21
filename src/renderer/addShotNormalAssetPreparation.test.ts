import { describe, expect, it, vi } from "vitest";
import { useAddShotController } from "./addShotController";
import { createProject } from "../shared/projectOps";
import type { Project } from "../shared/types";

describe("normal Add asset preparation", () => {
  const fixture = (prepare: (payload: { project: Project }) => Promise<void>) => {
    const projectRef = { current: createProject("Owned rejected Add fixture") };
    const workspace = { identity: {}, folderPath: "/owned", metadataPath: "/owned/.storyboard-workbench/storyboard.project.json" };
    const workspaceRef = { current: workspace };
    const ensureLayerAssets = vi.fn(prepare);
    const publishNewShot = vi.fn(async () => true);
    const setStatus = vi.fn();
    const api = {
      createBlankShot: async () => ({ imagePath: "/owned/blank.tiff", fileName: "blank.tiff", width: 32, height: 18 }),
      writeLayerPng: async () => undefined, ensureLayerAssets
    } as unknown as Window["storyboard"];
    const controller = useAddShotController({
      api, beginAddShotOperation: () => ({ api, registerBlankShot: vi.fn() }),
      isImageImportLocked: () => false, blankShotPreset: "16:9", captureWorkspace: () => workspaceRef.current,
      isCurrentWorkspace: origin => origin.identity === workspaceRef.current.identity,
      createTransparentLayerDataUrl: async () => "data:image/png;base64,fixture",
      folderPath: workspace.folderPath, metadataPath: workspace.metadataPath, projectRef,
      primarySelectedShotId: undefined, loadFolderScan: vi.fn(), inheritSceneMatte: vi.fn(),
      markShotsDirty: vi.fn(), selectSingleShot: vi.fn(), setRecentFolders: vi.fn(), setStatus, setWorkspaceTask: vi.fn(),
      updateProject: vi.fn(), publishNewShot
    });
    return { controller, projectRef, workspaceRef, ensureLayerAssets, publishNewShot, setStatus };
  };

  it("does not publish pending when new image preparation rejects", async () => {
    const f = fixture(async () => { throw new Error("owned preparation failed"); });
    await f.controller.handleAddShot();
    expect(f.ensureLayerAssets).toHaveBeenCalledOnce();
    expect(f.publishNewShot).not.toHaveBeenCalled();
    expect(f.projectRef.current.shots).toHaveLength(0);
    expect(f.setStatus).toHaveBeenCalledWith("Add shot layer failed: owned preparation failed");
  });

  it("does not publish an awaited preparation into a changed workspace", async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { started = resolve; });
    const f = fixture(async () => { started(); await gate; });
    const add = f.controller.handleAddShot();
    await entered;
    f.workspaceRef.current = { ...f.workspaceRef.current, identity: {}, folderPath: "/owned-B" };
    release(); await add;
    expect(f.publishNewShot).not.toHaveBeenCalled();
    expect(f.projectRef.current.shots).toHaveLength(0);
    expect(f.ensureLayerAssets.mock.calls[0][0].project.shots).toHaveLength(1);
  });

  it("materializes the registered new shot image asset before pending publication and leaves existing shots outside the ensure payload", async () => {
    const projectRef = { current: createProject("Owned normal Add fixture") };
    const workspace = { identity: {}, folderPath: "/owned", metadataPath: "/owned/.storyboard-workbench/storyboard.project.json" };
    let prepared = false;
    const ensureLayerAssets = vi.fn(async (payload: { project: Project }) => {
      expect(payload.project.shots).toHaveLength(1);
      expect(payload.project.shots[0].imagePath).toBe("/owned/new.tiff");
      prepared = true;
      return payload;
    });
    const api = { createBlankShot: async () => ({ imagePath: "/owned/new.tiff", fileName: "new.tiff", width: 32, height: 18 }), writeLayerPng: async () => undefined, ensureLayerAssets } as unknown as Window["storyboard"];
    const publishNewShot = vi.fn(async (update: (p: Project) => Project) => { expect(prepared).toBe(true); projectRef.current = update(projectRef.current); return true; });
    await useAddShotController({
      api, beginAddShotOperation: () => ({ api, registerBlankShot: vi.fn() }),
      isImageImportLocked: () => false, blankShotPreset: "16:9", captureWorkspace: () => workspace,
      isCurrentWorkspace: () => true, createTransparentLayerDataUrl: async () => "data:image/png;base64,fixture",
      folderPath: workspace.folderPath, metadataPath: workspace.metadataPath, projectRef,
      primarySelectedShotId: undefined, loadFolderScan: vi.fn(), inheritSceneMatte: vi.fn(),
      markShotsDirty: vi.fn(), selectSingleShot: vi.fn(), setRecentFolders: vi.fn(), setStatus: vi.fn(), setWorkspaceTask: vi.fn(),
      updateProject: vi.fn(), publishNewShot
    }).handleAddShot();
    expect(ensureLayerAssets).toHaveBeenCalledOnce();
    expect(publishNewShot).toHaveBeenCalledOnce();
    expect(projectRef.current.shots).toHaveLength(1);
  });
});
