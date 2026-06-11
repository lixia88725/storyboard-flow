import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { describePythonCommand, pythonCommandCandidates, runPythonScript } from "./pythonRuntime.js";

describe("pythonRuntime", () => {
  it("uses explicit python path before platform defaults", () => {
    expect(
      pythonCommandCandidates({
        pythonPath: "/custom/python",
        platform: "win32",
        env: { SWB_PYTHON_BIN: "/env/python" }
      }).map(describePythonCommand)
    ).toEqual(["/custom/python"]);
  });

  it("uses SWB_PYTHON_BIN before platform defaults", () => {
    expect(
      pythonCommandCandidates({
        platform: "win32",
        env: { SWB_PYTHON_BIN: "/env/python" }
      }).map(describePythonCommand)
    ).toEqual(["/env/python"]);
  });

  it("tries Windows Python launcher fallbacks", () => {
    expect(
      pythonCommandCandidates({
        platform: "win32",
        env: {}
      }).map(describePythonCommand)
    ).toEqual(["python3", "python", "py -3.14", "py -3"]);
  });

  it("uses packaged Windows Python before system fallbacks", () => {
    const resourcesPath = "C:\\Program Files\\Storyboard Flow\\resources";
    const packagedPythonPath = path.join(resourcesPath, "python", "python.exe");

    expect(
      pythonCommandCandidates({
        platform: "win32",
        env: {},
        resourcesPath,
        pathExists: (candidate) => candidate === packagedPythonPath
      }).map(describePythonCommand)
    ).toEqual([packagedPythonPath, "python3", "python", "py -3.14", "py -3"]);
  });

  it("keeps the existing python3 default outside Windows", () => {
    expect(
      pythonCommandCandidates({
        platform: "darwin",
        env: {}
      }).map(describePythonCommand)
    ).toEqual(["python3"]);
  });

  it("falls back to the next command when the first command is unavailable", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-python-runtime-"));

    try {
      const scriptPath = path.join(folderPath, "writer.mjs");
      const outputPath = path.join(folderPath, "out.txt");
      await writeFile(
        scriptPath,
        [
          "import { writeFile } from 'node:fs/promises';",
          "const [, , outputPath, value] = process.argv;",
          "await writeFile(outputPath, value, 'utf8');"
        ].join("\n"),
        "utf8"
      );

      await runPythonScript({
        commands: [
          { executable: path.join(folderPath, "missing-python") },
          { executable: process.execPath }
        ],
        scriptPath,
        scriptArgs: [outputPath, "ok"],
        errorPrefix: "Test script failed"
      });

      await expect(readFile(outputPath, "utf8")).resolves.toBe("ok");
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });

  it("reports command attempts when no candidate works", async () => {
    const folderPath = await mkdtemp(path.join(os.tmpdir(), "swb-python-runtime-error-"));

    try {
      const binPath = path.join(folderPath, "bin");
      const scriptPath = path.join(folderPath, "script.py");
      await mkdir(binPath);
      await writeFile(scriptPath, "print('unused')\n", "utf8");

      await expect(
        runPythonScript({
          platform: "win32",
          env: { ...process.env, PATH: binPath },
          scriptPath,
          scriptArgs: [],
          errorPrefix: "Test script failed"
        })
      ).rejects.toThrow(/Test script failed: Tried python3:.*Tried python:.*Tried py -3\.14:.*Tried py -3:/su);
    } finally {
      await rm(folderPath, { recursive: true, force: true });
    }
  });
});
