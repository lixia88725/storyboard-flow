import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  fallbackPhotoshopTiffPythonDepsDir,
  resolvePhotoshopTiffPythonDepsDir
} from "./photoshopTiffDeps.js";

describe("resolvePhotoshopTiffPythonDepsDir", () => {
  it("uses SWB_PYTHON_DEPS_DIR when explicitly configured", () => {
    expect(
      resolvePhotoshopTiffPythonDepsDir({
        env: { SWB_PYTHON_DEPS_DIR: "/custom/deps" },
        appPath: "/app",
        resourcesPath: "/resources",
        pathExists: () => true
      })
    ).toBe("/custom/deps");
  });

  it("prefers packaged resources before repo vendor dependencies", () => {
    const resourcesDeps = path.join("/resources", "python-deps", "photoshop-tiff");
    const vendorDeps = path.join("/app", "vendor", "python", "photoshop-tiff");

    expect(
      resolvePhotoshopTiffPythonDepsDir({
        env: {},
        appPath: "/app",
        resourcesPath: "/resources",
        pathExists: (candidate) =>
          candidate === resourcesDeps ||
          candidate === path.join(resourcesDeps, "psdtags") ||
          candidate === vendorDeps ||
          candidate === path.join(vendorDeps, "psdtags")
      })
    ).toBe(resourcesDeps);
  });

  it("uses repo vendor dependencies before the temporary spike fallback", () => {
    const vendorDeps = path.join("/app", "vendor", "python", "photoshop-tiff");

    expect(
      resolvePhotoshopTiffPythonDepsDir({
        env: {},
        appPath: "/app",
        resourcesPath: "/resources",
        pathExists: (candidate) => candidate === vendorDeps || candidate === path.join(vendorDeps, "psdtags")
      })
    ).toBe(vendorDeps);
  });

  it("keeps the old spike directory as the last fallback", () => {
    expect(
      resolvePhotoshopTiffPythonDepsDir({
        env: {},
        appPath: "/app",
        resourcesPath: "/resources",
        pathExists: () => false
      })
    ).toBe(fallbackPhotoshopTiffPythonDepsDir);
  });
});
