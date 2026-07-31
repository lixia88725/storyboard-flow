import { generatedShotTransparentLayerAssets } from "../shared/generatedShotAssets";
import {
  addGeneratedShot,
  sceneMatteModeForProject,
  type ShotPlacement
} from "../shared/projectOps";
import type { Project } from "../shared/types";
import type { AiDraftClient } from "./ai/aiClient";
import { addShotInsertedShotId } from "./addShotController";

type ProjectUpdate = Project | ((currentProject: Project) => Project);

export type AiCandidateShotControllerOptions = {
  aiClient: AiDraftClient;
  createTransparentLayerDataUrl: (width: number, height: number) => Promise<string>;
  folderPath: string | undefined;
  inheritSceneMatte: (
    baseProject: Project,
    mode: "expanded" | "embedded",
    shotIds: readonly string[]
  ) => Promise<boolean>;
  markShotsDirty: (shotIds: string[]) => void;
  projectRef: { current: Project };
  removeCandidateIds: (candidateIds: string[]) => void;
  selectSingleShot: (shotId: string | undefined) => void;
  setStatus: (status: string) => void;
  updateProject: (
    projectUpdate: ProjectUpdate,
    markFileNamesUnsynced?: boolean,
    recordUndo?: boolean
  ) => void;
  writeLayerPng: Window["storyboard"]["writeLayerPng"];
};

export const createAiCandidateShotController = ({
  aiClient,
  createTransparentLayerDataUrl,
  folderPath,
  inheritSceneMatte,
  markShotsDirty,
  projectRef,
  removeCandidateIds,
  selectSingleShot,
  setStatus,
  updateProject,
  writeLayerPng
}: AiCandidateShotControllerOptions) => ({
  promoteCandidateToStoryboard: async (
    candidateId: string,
    targetShotId: string | undefined,
    placement: ShotPlacement
  ): Promise<void> => {
    if (!folderPath) {
      setStatus("Could not add AI candidate: no project folder is open");
      return;
    }

    setStatus("Adding AI candidate to storyboard...");
    let promotedImagePath: string | undefined;
    try {
      const image = await aiClient.promoteCandidateToShot(folderPath, candidateId);
      promotedImagePath = image.imagePath;
      const nextProject = addGeneratedShot(
        projectRef.current,
        image,
        targetShotId,
        placement
      );
      const nextShotId = addShotInsertedShotId(nextProject, image.imagePath);
      const nextShot = nextShotId
        ? nextProject.shots.find((shot) => shot.id === nextShotId)
        : undefined;
      if (!nextShot || !nextShotId) {
        throw new Error("Could not create the AI Draft storyboard");
      }

      await Promise.all(
        generatedShotTransparentLayerAssets(nextShot).map(async (layer) => {
          const dataUrl = await createTransparentLayerDataUrl(layer.width, layer.height);
          await writeLayerPng({
            folderPath,
            bitmapPath: layer.bitmapPath,
            dataUrl
          });
        })
      );

      const matteMode = sceneMatteModeForProject(projectRef.current);
      if (matteMode) {
        const inherited = await inheritSceneMatte(nextProject, matteMode, [nextShotId]);
        if (!inherited) {
          throw new Error("Could not inherit scene presentation");
        }
      } else {
        updateProject(nextProject, true, false);
      }

      markShotsDirty([nextShotId]);
      selectSingleShot(nextShotId);

      try {
        await aiClient.discardCandidate(folderPath, candidateId);
        removeCandidateIds([candidateId]);
        setStatus(`Added AI Draft storyboard: ${image.fileName}`);
      } catch (error) {
        setStatus(
          `AI Draft storyboard added, but its Pending candidate could not be removed: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    } catch (error) {
      let rollbackError: unknown;
      if (promotedImagePath) {
        try {
          await aiClient.rollbackPromotedCandidateShot(folderPath, promotedImagePath);
        } catch (caughtRollbackError) {
          rollbackError = caughtRollbackError;
        }
      }
      setStatus(
        `Could not add AI candidate to storyboard: ${
          error instanceof Error ? error.message : String(error)
        }${
          rollbackError
            ? `; cleanup also failed: ${
                rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
              }`
            : ""
        }`
      );
    }
  }
});
