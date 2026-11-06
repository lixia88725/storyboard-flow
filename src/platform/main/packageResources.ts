import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

export type PackageResourcesResult = {
  photocraft?: { source: string; target: string };
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

  const binaryName = process.platform === 'win32' ? 'flow-photocraft.exe' : 'flow-photocraft';
  const nativeBinary = path.join(repoRoot,'native/photocraft/target/debug',binaryName);
  const photocraftTarget = path.join(outputRoot,'photocraft');
  await rm(photocraftTarget,{recursive:true,force:true});
  if(pathExists(nativeBinary)) {
    await mkdir(photocraftTarget,{recursive:true});
    await cp(nativeBinary,path.join(photocraftTarget,binaryName));
    await cp(path.join(repoRoot,'native/photocraft/licenses'),path.join(photocraftTarget,'licenses'),{recursive:true});
  }
  return {
    ...(pathExists(nativeBinary) ? {photocraft:{source:nativeBinary,target:photocraftTarget}} : {}),
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
