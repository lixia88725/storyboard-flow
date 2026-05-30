import { existsSync } from "node:fs";
import path from "node:path";

export const fallbackPhotoshopTiffPythonDepsDir = "/private/tmp/psdtags-spike-deps";

export const resolvePhotoshopTiffPythonDepsDir = ({
  env = process.env,
  appPath,
  resourcesPath = process.resourcesPath,
  pathExists = existsSync
}: {
  env?: NodeJS.ProcessEnv;
  appPath: string;
  resourcesPath?: string;
  pathExists?: (candidate: string) => boolean;
}): string => {
  if (env.SWB_PYTHON_DEPS_DIR) {
    return env.SWB_PYTHON_DEPS_DIR;
  }

  const candidates = [
    path.join(resourcesPath, "python-deps", "photoshop-tiff"),
    path.join(appPath, "vendor", "python", "photoshop-tiff")
  ];

  return candidates.find((candidate) => pythonDepsDirLooksInstalled(candidate, pathExists)) ?? fallbackPhotoshopTiffPythonDepsDir;
};

const pythonDepsDirLooksInstalled = (
  candidate: string,
  pathExists: (candidate: string) => boolean
): boolean => {
  return pathExists(candidate) && pathExists(path.join(candidate, "psdtags"));
};
