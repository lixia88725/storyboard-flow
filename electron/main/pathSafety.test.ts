import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertPathInsideFolder, pathExists } from "./pathSafety.js";

describe("pathSafety", () => {
  it("allows child paths and rejects the folder root or escaped paths", () => {
    const folderPath = path.join(os.tmpdir(), "storyboard-flow");

    expect(() => assertPathInsideFolder(folderPath, path.join(folderPath, "shot.tiff"))).not.toThrow();
    expect(() => assertPathInsideFolder(folderPath, folderPath)).toThrow(
      "Path must stay inside workspace folder"
    );
    expect(() => assertPathInsideFolder(folderPath, path.dirname(folderPath))).toThrow(
      "Path must stay inside workspace folder"
    );
  });

  it("reports missing paths without swallowing unexpected filesystem errors", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "storyboard-flow-path-"));
    const filePath = path.join(folderPath, "shot.tiff");

    try {
      await expect(pathExists(filePath)).resolves.toBe(false);
      await writeFile(filePath, "shot");
      await expect(pathExists(filePath)).resolves.toBe(true);
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });
});
