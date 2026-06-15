import { isLikelyTiffPath } from "./photoshopTiffImport.js";
import type { WorkspaceTaskProgressReporter } from "./workspaceTaskProgress.js";
import { knownImageHasExternalChange } from "./externalChanges.js";

type KnownImageShot = {
  id: string;
  imagePath: string;
  swb?: {
    status?: "owned" | "non-swb" | "compatible-external-edit" | "incompatible-external-edit";
    canvasWidth?: number;
    canvasHeight?: number;
    baseFingerprint?: string;
  };
};

type KnownImageProject = {
  shots: KnownImageShot[];
  parkedShots?: KnownImageShot[];
};

type SwbMetadata = Parameters<typeof knownImageHasExternalChange>[2];

type KnownImageChangesOptions = {
  pixelFingerprint: (imagePath: string) => Promise<string>;
  readSwbMetadata: (imagePath: string) => Promise<SwbMetadata>;
  onProgress?: WorkspaceTaskProgressReporter;
};

export const changedKnownImagePaths = async (
  project: KnownImageProject,
  imagePaths: string[],
  pendingDeletedPaths: Set<string>,
  { pixelFingerprint, readSwbMetadata, onProgress }: KnownImageChangesOptions
): Promise<string[]> => {
  const pathByShot = new Map(
    [...project.shots, ...(project.parkedShots ?? [])]
      .filter((shot) => isLikelyTiffPath(shot.imagePath) && !pendingDeletedPaths.has(shot.imagePath))
      .map((shot) => [shot.imagePath, shot])
  );
  const knownImagePaths = imagePaths.filter((imagePath) => pathByShot.has(imagePath));
  const changed: string[] = [];

  let checked = 0;
  await Promise.all(
    knownImagePaths.map(async (imagePath) => {
      const shot = pathByShot.get(imagePath);
      try {
        if (!shot?.swb || shot.swb.status === "non-swb") {
          return;
        }

        const fingerprint = await pixelFingerprint(imagePath);
        const metadata = await readSwbMetadata(imagePath);
        if (knownImageHasExternalChange(shot, fingerprint, metadata)) {
          changed.push(imagePath);
        }
      } finally {
        checked += 1;
        onProgress?.({
          kind: "open",
          label: "Checking external changes...",
          current: checked,
          total: knownImagePaths.length
        });
      }
    })
  );

  return changed;
};
