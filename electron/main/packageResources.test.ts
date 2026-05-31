import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { preparePackageResources } from "./packageResources.js";

describe("preparePackageResources", () => {
  it("copies installed Photoshop TIFF Python deps into package resources", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "swb-package-resources-"));
    const sourceDeps = path.join(repoRoot, "vendor", "python", "photoshop-tiff");
    await mkdir(path.join(sourceDeps, "psdtags"), { recursive: true });
    await writeFile(path.join(sourceDeps, "psdtags", "__init__.py"), "# psdtags\n");

    const result = await preparePackageResources({ repoRoot });

    expect(result.photoshopTiffDeps).toEqual({
      source: sourceDeps,
      target: path.join(repoRoot, "dist-resources", "python-deps", "photoshop-tiff")
    });
    await expect(
      readFile(path.join(result.photoshopTiffDeps.target, "psdtags", "__init__.py"), "utf8")
    ).resolves.toBe("# psdtags\n");
  });

  it("fails clearly when Photoshop TIFF Python deps are not installed", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "swb-package-resources-missing-"));
    await mkdir(path.join(repoRoot, "vendor", "python", "photoshop-tiff"), { recursive: true });

    await expect(preparePackageResources({ repoRoot })).rejects.toThrow(
      "Photoshop TIFF Python deps are not installed"
    );
  });
});
