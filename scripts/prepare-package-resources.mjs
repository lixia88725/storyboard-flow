import path from "node:path";
import { fileURLToPath } from "node:url";
import { preparePackageResources } from "../dist-electron/main/packageResources.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  const result = await preparePackageResources({ repoRoot });
  console.log(
    `Prepared Photoshop TIFF Python deps: ${result.photoshopTiffDeps.source} -> ${result.photoshopTiffDeps.target}`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
