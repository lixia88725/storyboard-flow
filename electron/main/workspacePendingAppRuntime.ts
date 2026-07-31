import { rename } from "node:fs/promises";
import { applyFileMoves } from "./fileRenames.js";
import { pixelFingerprint } from "./imageFingerprintService.js";
import type { WorkspacePendingIpcHandlers } from "./ipc/workspacePendingHandlers.js";
import { assertPathInsideFolder, ensureDirectory } from "./pathSafety.js";
import {
  moveShotsToVisiblePending,
  restoreShotsFromVisiblePending,
  type PendingShotFile,
  type PendingProject
} from "./pendingShotFilesService.js";

type WorkspacePendingPayload<Project extends PendingProject> = {
  folderPath: string;
  metadataPath: string;
  project: Project;
};

export type WorkspacePendingAppRuntimeOptions<Project extends PendingProject> = {
  materializeShots: (
    project: Project,
    folderPath: string,
    shotIds: Set<string>
  ) => Promise<{
    commit?: () => Promise<void>;
    rollback: () => Promise<void>;
  } | undefined>;
  beginTransaction: (
    folderPath: string,
    moves: Array<{ fromPath: string; toPath: string }>
  ) => Promise<{ commit: () => Promise<void>; rollback: () => Promise<void> }>;
  persistProject: (metadataPath: string, project: Project) => Promise<void>;
  uniquePath: (directory: string, fileName: string) => Promise<string>;
};

const pendingPayload = <Project extends PendingProject>(
  payload: unknown
): WorkspacePendingPayload<Project> => {
  if (!payload || typeof payload !== "object") {
    throw new Error("Pending storyboard payload is invalid");
  }
  const value = payload as Partial<WorkspacePendingPayload<Project>>;
  if (
    typeof value.folderPath !== "string" ||
    typeof value.metadataPath !== "string" ||
    !value.project
  ) {
    throw new Error("Pending storyboard payload is incomplete");
  }
  assertPathInsideFolder(value.folderPath, value.metadataPath);
  for (const shot of [...value.project.shots, ...(value.project.parkedShots ?? [])]) {
    assertPathInsideFolder(value.folderPath, shot.imagePath);
  }
  return value as WorkspacePendingPayload<Project>;
};

const projectWithPendingFiles = <Project extends PendingProject>(
  project: Project,
  files: PendingShotFile[]
): Project => {
  const byShotId = new Map(files.map((file) => [file.shotId, file]));
  const patchShot = <Shot extends PendingProject["shots"][number]>(shot: Shot): Shot => {
    const file = byShotId.get(shot.id);
    return file
      ? ({
          ...shot,
          imagePath: file.imagePath,
          fileName: file.fileName,
          swb:
            shot.swb && file.baseFingerprint
              ? { ...shot.swb, baseFingerprint: file.baseFingerprint }
              : shot.swb
        } as Shot)
      : shot;
  };
  return {
    ...project,
    shots: project.shots.map(patchShot),
    parkedShots: project.parkedShots?.map(patchShot)
  };
};

const pendingShotIds = (shotIds: string[]): string[] => {
  if (!Array.isArray(shotIds) || shotIds.some((shotId) => typeof shotId !== "string")) {
    throw new Error("Pending storyboard ids are invalid");
  }
  return shotIds;
};

export const createWorkspacePendingAppHandlers = <Project extends PendingProject>({
  beginTransaction,
  materializeShots,
  persistProject,
  uniquePath
}: WorkspacePendingAppRuntimeOptions<Project>): WorkspacePendingIpcHandlers => {
  const options = {
    fingerprint: pixelFingerprint,
    moveFiles: (moves: Array<{ fromPath: string; toPath: string }>) =>
      applyFileMoves(moves, { mkdir: ensureDirectory, rename }),
    uniquePath
  };

  return {
    moveShotsToPending: async (unknownPayload, unknownShotIds) => {
      const payload = pendingPayload<Project>(unknownPayload);
      const shotIds = pendingShotIds(unknownShotIds);
      return moveShotsToVisiblePending(payload.folderPath, payload.project, shotIds, {
        ...options,
        beginTransaction: (moves) => beginTransaction(payload.folderPath, moves),
        finalize: (files) =>
          persistProject(payload.metadataPath, projectWithPendingFiles(payload.project, files)),
        materializeShots: (project, selectedShotIds) =>
          materializeShots(project, payload.folderPath, selectedShotIds)
      });
    },
    restoreShotsFromPending: async (unknownPayload, unknownShotIds) => {
      const payload = pendingPayload<Project>(unknownPayload);
      return restoreShotsFromVisiblePending(
        payload.folderPath,
        payload.project,
        pendingShotIds(unknownShotIds),
        {
          ...options,
          beginTransaction: (moves) => beginTransaction(payload.folderPath, moves),
          finalize: (files) =>
            persistProject(payload.metadataPath, projectWithPendingFiles(payload.project, files))
        }
      );
    }
  };
};
