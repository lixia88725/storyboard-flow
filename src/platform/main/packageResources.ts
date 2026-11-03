import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export type PackageResourcesResult = {
  photoshopTiffDeps: {
    source: string;
    target: string;
  };
};

export const preparePackageResources = async ({
  repoRoot,
  outputRoot = path.join(repoRoot, "dist-resources"),
  pathExists = existsSync
}: {
  repoRoot: string;
  outputRoot?: string;
  pathExists?: (candidate: string) => boolean;
}): Promise<PackageResourcesResult> => {
  const source = path.join(repoRoot, "vendor", "python", "photoshop-tiff");
  const target = path.join(outputRoot, "python-deps", "photoshop-tiff");

  if (!photoshopTiffDepsInstalled(source, pathExists)) {
    throw new Error(
      `Photoshop TIFF Python deps are not installed at ${source}. Run npm run setup:photoshop-tiff-deps before preparing package resources.`
    );
  }

  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });

  return {
    photoshopTiffDeps: {
      source,
      target
    }
  };
};

const photoshopTiffDepsInstalled = (
  source: string,
  pathExists: (candidate: string) => boolean
): boolean => pathExists(source) && pathExists(path.join(source, "psdtags"));
