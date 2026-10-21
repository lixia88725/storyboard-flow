import type { MutableRefObject } from "react";
import {
  applyProjectMatte,
  bitmapLayersForShot,
  dialogueOverlayBitmapLayerId,
  dialoguesForShot,
  matteForShot,
  matteOverlayBitmapLayerId,
  removeProjectDialogueOverlay,
  removeProjectMatte,
  upsertDialogueOverlayBitmapLayer
} from "../shared/projectOps";
import type { Project, ShotMatte } from "../shared/types";
import {
  collapseBitmapLayerFromMatte,
  createDialogueOverlayDataUrl,
  createMatteOverlayDataUrl,
  expandBitmapLayerForMatte
} from "./bitmapLayerCanvas";
import type { BitmapLayerWriteQueue } from "./bitmapLayerWriteQueue";
import {
  restoreLayerAssetSnapshots
} from "./bitmapLayerHistory";
import type { ProjectHistoryEntry } from "./projectHistoryController";
import { runExclusiveWorkspaceAction } from "./workspacePersistenceController";

type ProjectUpdate = Project | ((currentProject: Project) => Project);

type ShotPresentationControllerOptions = {
  api: Window["storyboard"] | undefined;
  captureEnsureScope?: () => () => boolean;
  bitmapLayerWriteQueueRef: MutableRefObject<BitmapLayerWriteQueue>;
  createHistoryEntry: (bitmapPaths?: string[]) => Promise<ProjectHistoryEntry>;
  collapseBitmapLayer?: typeof collapseBitmapLayerFromMatte;
  createDialogueOverlay?: typeof createDialogueOverlayDataUrl;
  createMatteOverlay?: typeof createMatteOverlayDataUrl;
  expandBitmapLayer?: typeof expandBitmapLayerForMatte;
  folderPath: string | undefined;
  getRecoveryRequiredMessage?: () => string | undefined;
  markShotsDirty: (shotIds: string[]) => void;
  invalidatePresentationHistory?: (after: Project, shotIds: readonly string[], bitmapPaths: readonly string[]) => void;
  metadataPath: string | undefined;
  // Live workspace admission re-checked immediately before publication. A scene transaction that
  // already wrote overlay/expanded pixels must not report success after its publication is refused.
  isEffectAdmissible?: () => boolean;
  onRecoveryRequired?: (message: string) => void;
  projectRef: MutableRefObject<Project>;
  recordUndoEntry: (entry: ProjectHistoryEntry) => void;
  setStatus: (status: string) => void;
  shotPresentationActionRef: MutableRefObject<Promise<void | boolean> | undefined>;
  updateProject: (
    projectUpdate: ProjectUpdate,
    markFileNamesUnsynced?: boolean,
    recordUndo?: boolean
  ) => void;
};

const restoreActionAssets = async (
  api: Window["storyboard"],
  folderPath: string,
  entry: ProjectHistoryEntry
) => {
  if (entry.layerAssets?.length) {
    await restoreLayerAssetSnapshots(api, folderPath, entry.layerAssets);
  }
};

export const createShotPresentationController = ({
  api,
  captureEnsureScope,
  bitmapLayerWriteQueueRef,
  createHistoryEntry,
  collapseBitmapLayer = collapseBitmapLayerFromMatte,
  createDialogueOverlay = createDialogueOverlayDataUrl,
  createMatteOverlay = createMatteOverlayDataUrl,
  expandBitmapLayer = expandBitmapLayerForMatte,
  folderPath,
  getRecoveryRequiredMessage,
  markShotsDirty,
  isEffectAdmissible,
  invalidatePresentationHistory,
  metadataPath,
  onRecoveryRequired,
  projectRef,
  recordUndoEntry,
  setStatus,
  shotPresentationActionRef,
  updateProject
}: ShotPresentationControllerOptions) => {
  const runPresentationTransaction = (
    action: () => Promise<void | boolean>
  ): Promise<void | boolean> => {
    const isCurrent = captureEnsureScope?.() ?? (() => true);
    return runExclusiveWorkspaceAction(shotPresentationActionRef, () =>
      bitmapLayerWriteQueueRef.current.runExclusive(() => isCurrent() ? action() : Promise.resolve(false))
    );
  };

  const runHandledPresentationTransaction = async (
    label: string,
    action: () => Promise<void | boolean>,
    isCurrent: () => boolean = () => true
  ): Promise<void | boolean> => {
    try {
      return await runPresentationTransaction(action);
    } catch (error) {
      if (isCurrent()) setStatus(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };

  const ensureProjectUnchanged = (projectAtStart: Project): void => {
    if (projectRef.current !== projectAtStart) {
      throw new Error("The storyboard changed while this scene transaction was running");
    }
    if (isEffectAdmissible && !isEffectAdmissible()) {
      throw new Error("The storyboard workspace changed before this scene transaction could publish");
    }
  };

  const reportTransactionFailure = async (
    label: string,
    error: unknown,
    entry: ProjectHistoryEntry,
    isCurrent: () => boolean = () => true,
    isWorkspaceCurrent: () => boolean = isCurrent
  ): Promise<void> => {
    const originalMessage = error instanceof Error ? error.message : String(error);
    try {
      await restoreActionAssets(api!, folderPath!, entry);
      if (isCurrent()) setStatus(`${label}: ${originalMessage}`);
    } catch (rollbackError) {
      const rollbackMessage =
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      const recoveryMessage =
        `${label}: ${originalMessage}. Asset rollback also failed: ${rollbackMessage}. ` +
        "Close this workspace without saving and reopen it before continuing.";
      if (isWorkspaceCurrent()) {
        onRecoveryRequired?.(recoveryMessage);
        setStatus(recoveryMessage);
      }
    }
  };

  const requireWorkspace = (): boolean => {
    const recoveryRequiredMessage = getRecoveryRequiredMessage?.();
    if (recoveryRequiredMessage) {
      setStatus(recoveryRequiredMessage);
      return false;
    }
    if (!api || !folderPath || !metadataPath) {
      setStatus("Open a storyboard folder first");
      return false;
    }
    return true;
  };

  const handleSetShotMatteMode = async (mode: ShotMatte["mode"]): Promise<void> => {
    if (!requireWorkspace() || !api || !folderPath || !metadataPath) {
      return;
    }

    await runHandledPresentationTransaction("Configure scene matte failed", async () => {
      const currentProject = projectRef.current;
      const shots = currentProject.shots;
      if (shots.length === 0) {
        setStatus("This scene has no storyboards");
        return;
      }
      if (shots.some((shot) => shot.swb?.status !== "owned")) {
        setStatus("Import every storyboard before configuring a scene matte");
        return;
      }
      const incompatibleShot = shots.find((shot) => {
        const matte = matteForShot(shot);
        return matte && matte.mode !== mode;
      });
      if (incompatibleShot) {
        setStatus(
          `This scene already uses the ${
            matteForShot(incompatibleShot)?.mode === "expanded"
              ? "expanded canvas"
              : "existing matte"
          } mode`
        );
        return;
      }

      const shotsToExpand =
        mode === "expanded" ? shots.filter((shot) => !matteForShot(shot)) : [];
      if (shotsToExpand.length > 0) {
        await api.ensureLayerAssets({
          project: currentProject,
          folderPath,
          metadataPath
        });
      }

      const nextProject = applyProjectMatte(currentProject, mode);
      if (nextProject === currentProject) {
        setStatus("This scene already has a configured matte");
        return;
      }
      const expandedBitmapPaths = shotsToExpand.flatMap((shot) =>
        bitmapLayersForShot(shot)
          .filter((layer) => layer.id !== matteOverlayBitmapLayerId)
          .map((layer) => layer.bitmapPath)
      );
      const matteBitmapPaths = nextProject.shots.map(
        (shot) =>
          bitmapLayersForShot(shot).find((layer) => layer.id === matteOverlayBitmapLayerId)
            ?.bitmapPath
      );
      const affectedBitmapPaths = [
        ...new Set(
          [...expandedBitmapPaths, ...matteBitmapPaths].filter(
            (bitmapPath): bitmapPath is string => Boolean(bitmapPath)
          )
        )
      ];
      const undoEntry = await createHistoryEntry(affectedBitmapPaths);
      const sourceByPath = new Map(
        (undoEntry.layerAssets ?? []).map((snapshot) => [snapshot.bitmapPath, snapshot.dataUrl])
      );

      try {
        for (const shot of shotsToExpand) {
          for (const layer of bitmapLayersForShot(shot)) {
            if (layer.id === matteOverlayBitmapLayerId) {
              continue;
            }
            const sourceUrl = sourceByPath.get(layer.bitmapPath);
            if (!sourceUrl) {
              throw new Error(`Could not read layer "${layer.name}" in ${shot.fileName}`);
            }
            const dataUrl = await expandBitmapLayer(sourceUrl, layer, 75, 75);
            await api.writeLayerPng({
              folderPath,
              bitmapPath: layer.bitmapPath,
              dataUrl
            });
          }
        }

        for (const shot of nextProject.shots) {
          const matte = matteForShot(shot);
          const overlay = bitmapLayersForShot(shot).find(
            (layer) => layer.id === matteOverlayBitmapLayerId
          );
          if (!matte || !overlay) {
            throw new Error(`Could not create the matte overlay for ${shot.fileName}`);
          }
          const dataUrl = createMatteOverlay(
            overlay.width,
            overlay.height,
            matte.top,
            matte.bottom
          );
          if (!dataUrl) {
            throw new Error(`Could not render the matte overlay for ${shot.fileName}`);
          }
          await api.writeLayerPng({
            folderPath,
            bitmapPath: overlay.bitmapPath,
            dataUrl
          });
        }

        ensureProjectUnchanged(currentProject);
        recordUndoEntry(undoEntry);
        markShotsDirty(shots.map((shot) => shot.id));
        updateProject(nextProject, false, false);
        setStatus(
          mode === "expanded"
            ? `Added a locked matte overlay to ${shots.length} storyboards`
            : `Using a locked existing-matte overlay on ${shots.length} storyboards`
        );
      } catch (error) {
        await reportTransactionFailure("Configure scene matte failed", error, undoEntry);
      }
    });
  };

  const handleDisableSceneMatte = async (): Promise<void> => {
    if (!requireWorkspace() || !api || !folderPath) {
      return;
    }

    await runHandledPresentationTransaction("Turn off scene matte failed", async () => {
      const currentProject = projectRef.current;
      const matteShots = currentProject.shots.filter((shot) => Boolean(matteForShot(shot)));
      if (matteShots.length === 0) {
        setStatus("This scene matte is already off");
        return;
      }

      const expandedContentPaths = matteShots.flatMap((shot) => {
        const matte = matteForShot(shot);
        return matte?.mode === "expanded"
          ? bitmapLayersForShot(shot)
              .filter(
                (layer) =>
                  layer.id !== matteOverlayBitmapLayerId &&
                  layer.id !== dialogueOverlayBitmapLayerId
              )
              .map((layer) => layer.bitmapPath)
          : [];
      });
      const systemLayerPaths = matteShots.flatMap((shot) =>
        bitmapLayersForShot(shot)
          .filter(
            (layer) =>
              layer.id === matteOverlayBitmapLayerId ||
              layer.id === dialogueOverlayBitmapLayerId
          )
          .map((layer) => layer.bitmapPath)
      );
      const affectedBitmapPaths = [
        ...new Set([...expandedContentPaths, ...systemLayerPaths])
      ];
      const undoEntry = await createHistoryEntry(affectedBitmapPaths);
      const sourceByPath = new Map(
        (undoEntry.layerAssets ?? []).map((snapshot) => [snapshot.bitmapPath, snapshot.dataUrl])
      );
      const nextProject = removeProjectMatte(
        currentProject,
        matteShots.map((shot) => shot.id)
      );

      try {
        for (const shot of matteShots) {
          const matte = matteForShot(shot);
          if (matte?.mode !== "expanded") {
            continue;
          }
          const targetHeight =
            matte.sourceHeight ??
            Math.max(1, (shot.swb?.canvasHeight ?? 1) - matte.top - matte.bottom);
          for (const layer of bitmapLayersForShot(shot)) {
            if (
              layer.id === matteOverlayBitmapLayerId ||
              layer.id === dialogueOverlayBitmapLayerId
            ) {
              continue;
            }
            const sourceUrl = sourceByPath.get(layer.bitmapPath);
            if (!sourceUrl) {
              throw new Error(`Could not read layer "${layer.name}" in ${shot.fileName}`);
            }
            const dataUrl = await collapseBitmapLayer(
              sourceUrl,
              layer,
              matte.top,
              matte.bottom,
              targetHeight
            );
            await api.writeLayerPng({
              folderPath,
              bitmapPath: layer.bitmapPath,
              dataUrl
            });
          }
        }

        for (const bitmapPath of systemLayerPaths) {
          await api.deleteLayerPng({ folderPath, bitmapPath });
        }

        ensureProjectUnchanged(currentProject);
        recordUndoEntry(undoEntry);
        markShotsDirty(matteShots.map((shot) => shot.id));
        updateProject(nextProject, false, false);
        setStatus(`Turned off matte for ${matteShots.length} storyboards`);
      } catch (error) {
        await reportTransactionFailure("Turn off scene matte failed", error, undoEntry);
      }
    });
  };

  const handleInheritSceneMatte = async (
    baseProject: Project,
    mode: ShotMatte["mode"] | undefined,
    shotIds: readonly string[],
    options: {
      dialogueOverlayEnabled?: boolean;
      expectedProject?: Project;
      isCurrent?: () => boolean;
      isWorkspaceCurrent?: () => boolean;
      markFileNamesUnsynced?: boolean;
      recordUndo?: boolean;
    } = {}
  ): Promise<boolean> => {
    if (options.isCurrent && !options.isCurrent()) return false;
    if (!requireWorkspace() || !api || !folderPath || !metadataPath) {
      return false;
    }

    const result = await runHandledPresentationTransaction(
      "Inherit scene presentation failed",
      async (): Promise<boolean> => {
        if (options.isCurrent && !options.isCurrent()) return false;
        const workspaceProjectAtStart = projectRef.current;
        const ensureInheritanceCurrent = () => {
          if (options.isCurrent && !options.isCurrent()) throw new Error("Pending inheritance scope changed");
          ensureProjectUnchanged(workspaceProjectAtStart);
        };
        if (
          options.expectedProject &&
          workspaceProjectAtStart !== options.expectedProject
        ) {
          setStatus(
            "The storyboard changed before scene presentation could be inherited; try again"
          );
          return false;
        }
        const targetShotIds = new Set(shotIds);
        const targetShots = baseProject.shots.filter((shot) => targetShotIds.has(shot.id));
        if (targetShots.length === 0) {
          ensureInheritanceCurrent();
          updateProject(baseProject, false, false);
          return true;
        }
        if (!mode) {
          const matteShots = targetShots.filter((shot) => Boolean(matteForShot(shot)));
          if (matteShots.length === 0) {
            ensureInheritanceCurrent();
            updateProject(baseProject, false, false);
            return true;
          }

          const expandedContentPaths = matteShots.flatMap((shot) =>
            matteForShot(shot)?.mode === "expanded"
              ? bitmapLayersForShot(shot)
                  .filter(
                    (layer) =>
                      layer.id !== matteOverlayBitmapLayerId &&
                      layer.id !== dialogueOverlayBitmapLayerId
                  )
                  .map((layer) => layer.bitmapPath)
              : []
          );
          const systemLayerPaths = matteShots.flatMap((shot) =>
            bitmapLayersForShot(shot)
              .filter(
                (layer) =>
                  layer.id === matteOverlayBitmapLayerId ||
                  layer.id === dialogueOverlayBitmapLayerId
              )
              .map((layer) => layer.bitmapPath)
          );
          const rollbackEntry = await createHistoryEntry([
            ...new Set([...expandedContentPaths, ...systemLayerPaths])
          ]);
          if (options.isCurrent) ensureInheritanceCurrent();
          const sourceByPath = new Map(
            (rollbackEntry.layerAssets ?? []).map((snapshot) => [
              snapshot.bitmapPath,
              snapshot.dataUrl
            ])
          );
          const nextProject = removeProjectMatte(
            baseProject,
            matteShots.map((shot) => shot.id)
          );

          try {
            for (const shot of matteShots) {
              const matte = matteForShot(shot);
              if (matte?.mode !== "expanded") {
                continue;
              }
              const targetHeight =
                matte.sourceHeight ??
                Math.max(1, (shot.swb?.canvasHeight ?? 1) - matte.top - matte.bottom);
              for (const layer of bitmapLayersForShot(shot)) {
                if (
                  layer.id === matteOverlayBitmapLayerId ||
                  layer.id === dialogueOverlayBitmapLayerId
                ) {
                  continue;
                }
                const sourceUrl = sourceByPath.get(layer.bitmapPath);
                if (!sourceUrl) {
                  throw new Error(`Could not read layer "${layer.name}" in ${shot.fileName}`);
                }
                const dataUrl = await collapseBitmapLayer(
                  sourceUrl,
                  layer,
                  matte.top,
                  matte.bottom,
                  targetHeight
                );
                if (options.isCurrent) ensureInheritanceCurrent();
                await api.writeLayerPng({
                  folderPath,
                  bitmapPath: layer.bitmapPath,
                  dataUrl
                });
                if (options.isCurrent) ensureInheritanceCurrent();
              }
            }
            for (const bitmapPath of systemLayerPaths) {
              await api.deleteLayerPng({ folderPath, bitmapPath });
              if (options.isCurrent) ensureInheritanceCurrent();
            }

            ensureInheritanceCurrent();
            if (options.recordUndo) {
              recordUndoEntry(rollbackEntry);
            } else {
              invalidatePresentationHistory?.(nextProject, matteShots.map(shot => shot.id),
                [...new Set([...expandedContentPaths, ...systemLayerPaths])]);
            }
            markShotsDirty(matteShots.map((shot) => shot.id));
            updateProject(
              nextProject,
              options.markFileNamesUnsynced ?? false,
              false
            );
            return true;
          } catch (error) {
            await reportTransactionFailure(
              "Inherit disabled scene matte failed",
              error,
              rollbackEntry, options.isCurrent, options.isWorkspaceCurrent
            );
            return false;
          }
        }
        if (targetShots.some((shot) => shot.swb?.status !== "owned")) {
          setStatus("Import the new storyboard before inheriting the scene matte");
          return false;
        }

        const shotsToExpand =
          mode === "expanded"
            ? targetShots.filter((shot) => !matteForShot(shot))
            : [];
        if (shotsToExpand.length > 0) {
          await api.ensureLayerAssets({
            project: baseProject,
            folderPath,
            metadataPath
          });
          if (options.isCurrent) ensureInheritanceCurrent();
        }

        const matteProject = applyProjectMatte(baseProject, mode, shotIds);
        let nextProject = matteProject;
        if (options.dialogueOverlayEnabled === true) {
          for (const shotId of shotIds) {
            nextProject = upsertDialogueOverlayBitmapLayer(nextProject, shotId);
          }
        } else if (options.dialogueOverlayEnabled === false) {
          nextProject = removeProjectDialogueOverlay(nextProject, shotIds);
        }
        const changedShots = nextProject.shots.filter(
          (shot) =>
            targetShotIds.has(shot.id) &&
            Boolean(matteForShot(shot))
        );
        if (nextProject === baseProject) {
          ensureInheritanceCurrent();
          updateProject(baseProject, false, false);
          return true;
        }

        const expandedBitmapPaths = shotsToExpand.flatMap((shot) =>
          bitmapLayersForShot(shot)
            .filter(
              (layer) =>
                layer.id !== matteOverlayBitmapLayerId &&
                layer.id !== dialogueOverlayBitmapLayerId
            )
            .map((layer) => layer.bitmapPath)
        );
        const matteBitmapPaths = changedShots
          .map(
            (shot) =>
              bitmapLayersForShot(shot).find(
                (layer) => layer.id === matteOverlayBitmapLayerId
              )?.bitmapPath
          )
          .filter((bitmapPath): bitmapPath is string => Boolean(bitmapPath));
        const existingDialogueBitmapPaths = targetShots
          .map(
            (shot) =>
              bitmapLayersForShot(shot).find(
                (layer) => layer.id === dialogueOverlayBitmapLayerId
              )?.bitmapPath
          )
          .filter((bitmapPath): bitmapPath is string => Boolean(bitmapPath));
        const nextDialogueBitmapPaths =
          options.dialogueOverlayEnabled === true
            ? changedShots
                .map(
                  (shot) =>
                    bitmapLayersForShot(shot).find(
                      (layer) => layer.id === dialogueOverlayBitmapLayerId
                    )?.bitmapPath
                )
                .filter((bitmapPath): bitmapPath is string => Boolean(bitmapPath))
            : [];
        const rollbackEntry = await createHistoryEntry([
          ...new Set([
            ...expandedBitmapPaths,
            ...matteBitmapPaths,
            ...existingDialogueBitmapPaths,
            ...nextDialogueBitmapPaths
          ])
        ]);
        if (options.isCurrent) ensureInheritanceCurrent();
        const sourceByPath = new Map(
          (rollbackEntry.layerAssets ?? []).map((snapshot) => [
            snapshot.bitmapPath,
            snapshot.dataUrl
          ])
        );

        try {
          for (const shot of shotsToExpand) {
            for (const layer of bitmapLayersForShot(shot)) {
              if (
                layer.id === matteOverlayBitmapLayerId ||
                layer.id === dialogueOverlayBitmapLayerId
              ) {
                continue;
              }
              const sourceUrl = sourceByPath.get(layer.bitmapPath);
              if (!sourceUrl) {
                throw new Error(`Could not read layer "${layer.name}" in ${shot.fileName}`);
              }
              const dataUrl = await expandBitmapLayer(sourceUrl, layer, 75, 75);
              if (options.isCurrent) ensureInheritanceCurrent();
              await api.writeLayerPng({
                folderPath,
                bitmapPath: layer.bitmapPath,
                dataUrl
              });
              if (options.isCurrent) ensureInheritanceCurrent();
            }
          }

          for (const shot of changedShots) {
            const matte = matteForShot(shot);
            const overlay = bitmapLayersForShot(shot).find(
              (layer) => layer.id === matteOverlayBitmapLayerId
            );
            if (!matte || !overlay) {
              throw new Error(`Could not inherit the matte for ${shot.fileName}`);
            }
            const dataUrl = createMatteOverlay(
              overlay.width,
              overlay.height,
              matte.top,
              matte.bottom
            );
            if (!dataUrl) {
              throw new Error(`Could not render the matte overlay for ${shot.fileName}`);
            }
            await api.writeLayerPng({
              folderPath,
              bitmapPath: overlay.bitmapPath,
              dataUrl
            });
            if (options.isCurrent) ensureInheritanceCurrent();
          }

          if (options.dialogueOverlayEnabled === true) {
            for (const shot of changedShots) {
              const matte = matteForShot(shot);
              const overlay = bitmapLayersForShot(shot).find(
                (layer) => layer.id === dialogueOverlayBitmapLayerId
              );
              if (!matte || !overlay) {
                throw new Error(`Could not inherit the dialogue overlay for ${shot.fileName}`);
              }
              const dialogueText = dialoguesForShot(baseProject, shot.id)
                .map((dialogue) => dialogue.text.trim())
                .filter(Boolean)
                .join(" / ");
              const dataUrl = createDialogueOverlay(
                overlay.width,
                overlay.height,
                matte.bottom,
                dialogueText
              );
              if (!dataUrl) {
                throw new Error(`Could not render dialogue text for ${shot.fileName}`);
              }
              await api.writeLayerPng({
                folderPath,
                bitmapPath: overlay.bitmapPath,
                dataUrl
              });
              if (options.isCurrent) ensureInheritanceCurrent();
            }
          } else if (options.dialogueOverlayEnabled === false) {
            for (const bitmapPath of existingDialogueBitmapPaths) {
              await api.deleteLayerPng({ folderPath, bitmapPath });
              if (options.isCurrent) ensureInheritanceCurrent();
            }
          }

          ensureInheritanceCurrent();
          if (options.recordUndo) {
            recordUndoEntry(rollbackEntry);
          } else {
            invalidatePresentationHistory?.(nextProject, targetShots.map(shot => shot.id),
              [...new Set([...expandedBitmapPaths, ...matteBitmapPaths,
                ...existingDialogueBitmapPaths, ...nextDialogueBitmapPaths])]);
          }
          markShotsDirty(changedShots.map((shot) => shot.id));
          updateProject(
            nextProject,
            options.markFileNamesUnsynced ?? false,
            false
          );
          return true;
        } catch (error) {
          await reportTransactionFailure("Inherit scene matte failed", error, rollbackEntry, options.isCurrent, options.isWorkspaceCurrent);
          return false;
        }
      }, options.isCurrent
    );

    return result === true;
  };

  const handlePlaceDialogueOnMatte = async (): Promise<void> => {
    if (!requireWorkspace() || !api || !folderPath) {
      return;
    }

    await runHandledPresentationTransaction("Toggle scene dialogue failed", async () => {
      const currentProject = projectRef.current;
      const shots = currentProject.shots;
      if (shots.length === 0) {
        setStatus("This scene has no storyboards");
        return;
      }
      if (shots.some((shot) => shot.swb?.status !== "owned")) {
        setStatus("Import every storyboard before placing scene dialogue");
        return;
      }
      if (shots.some((shot) => !matteForShot(shot))) {
        setStatus("Configure a matte for every storyboard before placing dialogue");
        return;
      }

      const dialogueOverlayPaths = shots.map(
        (shot) =>
          bitmapLayersForShot(shot).find(
            (layer) => layer.id === dialogueOverlayBitmapLayerId
          )?.bitmapPath ??
          `.storyboard-workbench/layers/${shot.id}/${dialogueOverlayBitmapLayerId}.png`
      );
      const undoEntry = await createHistoryEntry(dialogueOverlayPaths);
      const isSceneDialogueVisible = shots.every((shot) =>
        bitmapLayersForShot(shot).some(
          (layer) => layer.id === dialogueOverlayBitmapLayerId
        )
      );

      try {
        let nextProject = currentProject;
        if (isSceneDialogueVisible) {
          for (const bitmapPath of dialogueOverlayPaths) {
            await api.deleteLayerPng({ folderPath, bitmapPath });
          }
          nextProject = removeProjectDialogueOverlay(currentProject);
        } else {
          for (const shot of shots) {
            nextProject = upsertDialogueOverlayBitmapLayer(nextProject, shot.id);
          }
          for (const shot of nextProject.shots) {
            const matte = matteForShot(shot);
            const overlay = bitmapLayersForShot(shot).find(
              (layer) => layer.id === dialogueOverlayBitmapLayerId
            );
            if (!matte || !overlay) {
              throw new Error(`Could not create the dialogue overlay for ${shot.fileName}`);
            }
            const dialogueText = dialoguesForShot(currentProject, shot.id)
              .map((dialogue) => dialogue.text.trim())
              .filter(Boolean)
              .join(" / ");
            const dataUrl = createDialogueOverlay(
              overlay.width,
              overlay.height,
              matte.bottom,
              dialogueText
            );
            if (!dataUrl) {
              throw new Error(`Could not render dialogue text for ${shot.fileName}`);
            }
            await api.writeLayerPng({
              folderPath,
              bitmapPath: overlay.bitmapPath,
              dataUrl
            });
          }
        }

        ensureProjectUnchanged(currentProject);
        recordUndoEntry(undoEntry);
        markShotsDirty(shots.map((shot) => shot.id));
        updateProject(nextProject, false, false);
        setStatus(
          isSceneDialogueVisible
            ? `Turned off dialogue overlays for ${shots.length} storyboards`
            : `Placed dialogue overlays on ${shots.length} storyboards`
        );
      } catch (error) {
        await reportTransactionFailure("Toggle scene dialogue failed", error, undoEntry);
      }
    });
  };

  return {
    handleDisableSceneMatte,
    handleInheritSceneMatte,
    handlePlaceDialogueOnMatte,
    handleSetShotMatteMode
  };
};
