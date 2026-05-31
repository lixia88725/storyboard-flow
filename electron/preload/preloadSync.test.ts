import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { apiSignatures } from "../../scripts/check-preload-sync.mjs";

const execFileAsync = promisify(execFile);

describe("preload sync", () => {
  it("keeps TypeScript and CommonJS preload APIs in sync", async () => {
    const scriptPath = path.resolve("scripts/check-preload-sync.mjs");
    const { stdout } = await execFileAsync("node", [scriptPath]);

    expect(stdout.trim()).toBe("preload APIs are in sync");
  });

  it("detects drift in exposed API method parameters", () => {
    const tsSource = `const api = {
  createBlankShot: (folderPath: string, options: unknown) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options)
};`;
    const cjsSource = `const api = {
  createBlankShot: (folderPath) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath)
};`;

    expect(apiSignatures(tsSource)).not.toEqual(apiSignatures(cjsSource));
  });
});
