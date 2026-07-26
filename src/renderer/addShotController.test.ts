import { describe, expect, it, vi } from "vitest";
import type { Project } from "../shared/types";
import {
  addShotInsertedShotId,
  initialAddShotContext,
  useAddShotController
} from "./addShotController";

const projectWithShots = (shotIds: string[]): Project =>
  ({
    shots: shotIds.map((id) => ({ id, imagePath: `${id}.tiff` }))
  }) as Project;

describe("addShotController", () => {
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
      blankShotPreset: "9:16",
      createTransparentLayerDataUrl: vi.fn(async () => "data:image/png;base64,"),
      folderPath: "/scene",
      inheritSceneMatte: vi.fn(async () => true),
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
    const inheritSceneMatte = vi.fn(async () => true);

    const { handleAddShot } = useAddShotController({
      api,
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
      [expect.any(String)]
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
      blankShotPreset: "16:9",
      createTransparentLayerDataUrl: vi.fn(async () => "data:image/png;base64,"),
      folderPath: "/scene",
      inheritSceneMatte: vi.fn(async () => true),
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
