import { describe, expect, it, vi } from "vitest";
import type { Project } from "../shared/types";
import type { AiDraftClient } from "./ai/aiClient";
import { createAiCandidateShotController } from "./aiCandidateShotController";

const emptyProject = (): Project => ({
  id: "project",
  name: "Scene",
  shots: [],
  dialogues: [],
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z"
});

const setup = ({
  promoteCandidateToShot = vi.fn(async () => ({
    imagePath: "/scene/ai_draft_1_0.tiff",
    previewPath: "/scene/.storyboard-workbench/previews/ai.png",
    fileName: "ai_draft_1_0.tiff",
    width: 1920,
    height: 1080,
    fingerprint: "pixels"
  })),
  writeLayerPng = vi.fn(async (payload) => ({ ...payload, filePath: "/layer.png" }))
}: {
  promoteCandidateToShot?: ReturnType<typeof vi.fn>;
  writeLayerPng?: ReturnType<typeof vi.fn>;
} = {}) => {
  const projectRef = { current: emptyProject() };
  const removeCandidateIds = vi.fn();
  const selectSingleShot = vi.fn();
  const setStatus = vi.fn();
  const markShotsDirty = vi.fn();
  const discardCandidate = vi.fn(async () => undefined);
  const rollbackPromotedCandidateShot = vi.fn(async () => undefined);
  const updateProject = vi.fn((projectUpdate: Project | ((project: Project) => Project)) => {
    projectRef.current =
      typeof projectUpdate === "function" ? projectUpdate(projectRef.current) : projectUpdate;
  });
  const aiClient = {
    promoteCandidateToShot,
    rollbackPromotedCandidateShot,
    discardCandidate
  } as unknown as AiDraftClient;

  const controller = createAiCandidateShotController({
    aiClient,
    createTransparentLayerDataUrl: vi.fn(async () => "data:image/png;base64,transparent"),
    folderPath: "/scene",
    inheritSceneMatte: vi.fn(async () => true),
    markShotsDirty,
    projectRef,
    removeCandidateIds,
    selectSingleShot,
    setStatus,
    updateProject,
    writeLayerPng
  });

  return {
    controller,
    discardCandidate,
    markShotsDirty,
    projectRef,
    promoteCandidateToShot,
    removeCandidateIds,
    rollbackPromotedCandidateShot,
    selectSingleShot,
    setStatus,
    updateProject,
    writeLayerPng
  };
};

describe("AI candidate shot controller", () => {
  it("creates a new storyboard, initializes its paint layer, then removes the candidate", async () => {
    const result = setup();

    await result.controller.promoteCandidateToStoryboard("candidate-a", undefined, "after");

    expect(result.projectRef.current.shots).toHaveLength(1);
    expect(result.projectRef.current.shots[0]).toMatchObject({
      imagePath: "/scene/ai_draft_1_0.tiff",
      fileName: "ai_draft_1_0.tiff",
      order: 0
    });
    expect(result.writeLayerPng).toHaveBeenCalledOnce();
    expect(result.updateProject).toHaveBeenCalledWith(expect.any(Object), true, false);
    expect(result.markShotsDirty).toHaveBeenCalledWith([
      result.projectRef.current.shots[0].id
    ]);
    expect(result.selectSingleShot).toHaveBeenCalledWith(
      result.projectRef.current.shots[0].id
    );
    expect(result.discardCandidate).toHaveBeenCalledWith("/scene", "candidate-a");
    expect(result.removeCandidateIds).toHaveBeenCalledWith(["candidate-a"]);
  });

  it("keeps the candidate and project unchanged when promotion fails", async () => {
    const result = setup({
      promoteCandidateToShot: vi.fn(async () => {
        throw new Error("disk full");
      })
    });

    await result.controller.promoteCandidateToStoryboard("candidate-a", undefined, "after");

    expect(result.projectRef.current.shots).toEqual([]);
    expect(result.updateProject).not.toHaveBeenCalled();
    expect(result.discardCandidate).not.toHaveBeenCalled();
    expect(result.removeCandidateIds).not.toHaveBeenCalled();
    expect(result.rollbackPromotedCandidateShot).not.toHaveBeenCalled();
    expect(result.setStatus).toHaveBeenLastCalledWith(
      "Could not add AI candidate to storyboard: disk full"
    );
  });

  it("removes the promoted TIFF when layer initialization fails", async () => {
    const result = setup({
      writeLayerPng: vi.fn(async () => {
        throw new Error("layer write failed");
      })
    });

    await result.controller.promoteCandidateToStoryboard("candidate-a", undefined, "after");

    expect(result.projectRef.current.shots).toEqual([]);
    expect(result.rollbackPromotedCandidateShot).toHaveBeenCalledWith(
      "/scene",
      "/scene/ai_draft_1_0.tiff"
    );
    expect(result.discardCandidate).not.toHaveBeenCalled();
    expect(result.removeCandidateIds).not.toHaveBeenCalled();
  });
});
