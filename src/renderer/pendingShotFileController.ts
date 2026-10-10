import type { Project, Shot, WorkspacePayload } from "../shared/types";

export type PendingShotFilePatch = {
  shotId: string;
  imagePath: string;
  fileName: string;
  baseFingerprint?: string;
};

const patchShotFile = (shot: Shot, patches: Map<string, PendingShotFilePatch>): Shot => {
  const patch = patches.get(shot.id);
  if (!patch) {
    return shot;
  }
  return {
    ...shot,
    imagePath: patch.imagePath,
    fileName: patch.fileName,
    swb:
      shot.swb && patch.baseFingerprint
        ? { ...shot.swb, baseFingerprint: patch.baseFingerprint }
        : shot.swb
  };
};

export const applyPendingShotFilePatches = (
  project: Project,
  filePatches: PendingShotFilePatch[]
): Project => {
  if (filePatches.length === 0) {
    return project;
  }
  const patches = new Map(filePatches.map((patch) => [patch.shotId, patch]));
  return {
    ...project,
    shots: project.shots.map((shot) => patchShotFile(shot, patches)),
    parkedShots: project.parkedShots?.map((shot) => patchShotFile(shot, patches)),
    updatedAt: new Date().toISOString()
  };
};

export const projectWithShotFileReferences = (
  project: Project,
  sourceProject: Project,
  shotIds: string[]
): Project => {
  const selected = new Set(shotIds);
  const sourceById = new Map(
    [...sourceProject.shots, ...(sourceProject.parkedShots ?? [])].map((shot) => [shot.id, shot])
  );
  return applyPendingShotFilePatches(
    project,
    [...project.shots, ...(project.parkedShots ?? [])]
      .filter((shot) => selected.has(shot.id))
      .flatMap((shot) => {
        const source = sourceById.get(shot.id);
        return source
          ? [
              {
                shotId: shot.id,
                imagePath: source.imagePath,
                fileName: source.fileName,
                baseFingerprint: source.swb?.baseFingerprint
              }
            ]
          : [];
      })
  );
};

export const shotFileIsInVisiblePending = (folderPath: string, imagePath: string): boolean => {
  const normalizedFolder = folderPath.replaceAll("\\", "/").replace(/\/$/, "");
  const normalizedImagePath = imagePath.replaceAll("\\", "/");
  const prefix = `${normalizedFolder}/Pending/`;
  if (!normalizedImagePath.startsWith(prefix)) {
    return false;
  }
  const relativePath = normalizedImagePath.slice(prefix.length);
  return relativePath.length > 0 && !relativePath.split("/").includes("..");
};

export const createPendingShotFileController = ({
  api,
  folderPath,
  metadataPath
}: {
  api: Pick<Window["storyboard"], "moveShotsToPending" | "restoreShotsFromPending">;
  folderPath: string | undefined;
  metadataPath: string | undefined;
}) => {
  const payload = (project: Project): WorkspacePayload => {
    if (!folderPath || !metadataPath) {
      throw new Error("No project folder is open");
    }
    return { project, folderPath, metadataPath };
  };

  return {
    normalSaveEffects: async (kind: "park" | "restore", project: Project, shotIds: string[]) => {
      const workspace = { ...payload(project), normalSave: true };
      const files = await (kind === "park" ? api.moveShotsToPending(workspace, shotIds) : api.restoreShotsFromPending(workspace, shotIds));
      return files.map(file => {
        const ack = file.normalSaveOutput;
        const root = folderPath!.replaceAll("\\", "/").replace(/\/$/, ""), target = file.imagePath.replaceAll("\\", "/");
        if (!ack || ack.shotId !== file.shotId || ack.targetPath !== file.imagePath || ack.fileName !== file.fileName ||
          (kind === "park" ? !shotFileIsInVisiblePending(folderPath!, file.imagePath) : target !== `${root}/${file.fileName}`)) throw new Error("Pending did not return a matching namespace acknowledgement");
        return ack;
      });
    },
    moveShotsToPending: async (project: Project, shotIds: string[]): Promise<Project> =>
      applyPendingShotFilePatches(
        project,
        await api.moveShotsToPending(payload(project), shotIds)
      ),
    restoreShotsFromPending: async (project: Project, shotIds: string[]): Promise<Project> =>
      applyPendingShotFilePatches(
        project,
        await api.restoreShotsFromPending(payload(project), shotIds)
      )
  };
};
