import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { chmod } from "node:fs/promises";
import { macTiffPython } from "./macTiffPython.js";
import { temporaryWorkspace } from "../../../test/temporaryWorkspace";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { preparePackageResources } from "./packageResources.js";

describe("preparePackageResources", () => {
  it("copies installed Photoshop TIFF Python deps into package resources", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "flow-package-resources-"));
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
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "flow-package-resources-missing-"));
    await mkdir(path.join(repoRoot, "vendor", "python", "photoshop-tiff"), { recursive: true });

    await expect(preparePackageResources({ repoRoot })).rejects.toThrow(
      "Photoshop TIFF Python deps are not installed"
    );
  });
});

describe.skipIf(process.platform !== 'darwin')('packaged macOS TIFF interpreter', () => {
  it('probes actual executables, skips an incompatible PATH interpreter and never ignores a bad explicit override', async () => {
    const root = await temporaryWorkspace('flow-python-test-'), deps = path.join(root,'wheel');
    await mkdir(path.join(deps,'numpy','_core'), { recursive: true });
    await writeFile(path.join(deps,'numpy','_core','_multiarray_umath.cpython-314-darwin.so'), '');
    const stub = async (dir: string,name: string,script: string) => {
      await mkdir(dir,{recursive:true}); const file=path.join(dir,name);
      await writeFile(file,'#!/bin/sh\n'+script+'\n'); await chmod(file,0o755); return file;
    };
    const old = await stub(path.join(root,'old'),'python3','exit 1');
    const match = await stub(path.join(root,'new'),'python3.14','test "$1" = "-I" && test "$2" = "-B" && test "$3" = "-S" && test "$4" = "-c" && test "$6" = "'+deps+'"');
    const search = [path.dirname(old),path.dirname(match)].join(':');
    expect(await macTiffPython(deps, undefined, search)).toBe(match);
    await expect(macTiffPython(deps, old, search)).rejects.toThrow('Python 3.14');
    expect(await macTiffPython(deps, match, path.dirname(old))).toBe(match);
  });
});
