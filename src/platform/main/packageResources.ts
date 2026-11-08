import { cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import {verifyPreparedNative,nativeName,NATIVE_COMPONENTS,verifyPackagedNative} from "./photocraftPackage.js";

export type PackageResourcesResult = {
  photocraft: { source: string; target: string };
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

  // Validate before replacing any existing prepared resources.
  const native=await verifyPreparedNative(repoRoot);
  const photocraftTarget=path.join(outputRoot,'photocraft');
  await rm(target,{recursive:true,force:true});
  await cp(source,target,{recursive:true});
  await rm(photocraftTarget,{recursive:true,force:true});
  await mkdir(photocraftTarget,{recursive:true});
  for(const leaf of [...NATIVE_COMPONENTS.map(k=>nativeName(process.platform,k)),'build.json','licenses'])
    await cp(path.join(native.source,leaf),path.join(photocraftTarget,leaf),{recursive:true});
  await verifyPackagedNative(photocraftTarget,process.platform,process.arch);
  return {
    photocraft:{source:native.binary,target:photocraftTarget},
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
