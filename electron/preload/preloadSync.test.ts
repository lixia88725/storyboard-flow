import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  apiSignatures,
  checkPreloadSync,
  globalStoryboardApiKeys,
  globalStoryboardNestedApiSignatures,
  globalStoryboardApiSignatures
} from "../../scripts/check-preload-sync.mjs";

const execFileAsync = promisify(execFile);

describe("preload sync", () => {
  it("compares optional TypeScript parameter names with JavaScript while still detecting omitted arguments", () => {
    const ts = `const api = {\n  readOutputIdentity: (imagePath: string, legacy?: unknown) => ipcRenderer.invoke("workspace:readOutputIdentity", imagePath, legacy)\n};`;
    const cjs = `const api = {\n  readOutputIdentity: (imagePath, legacy) => ipcRenderer.invoke("workspace:readOutputIdentity", imagePath, legacy)\n};`;
    const missing = `const api = {\n  readOutputIdentity: (imagePath) => ipcRenderer.invoke("workspace:readOutputIdentity", imagePath)\n};`;
    expect(apiSignatures(ts)).toEqual(apiSignatures(cjs));
    expect(apiSignatures(ts)).not.toEqual(apiSignatures(missing));
  });
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

  it("detects drift between preload API keys and renderer global types", () => {
    const tsSource = `const api = {
  openFolderByPath: (folderPath: string) =>
    ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  createBlankShot: (folderPath: string, options: unknown) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options),
  ai: {
    getSettings: () => ipcRenderer.invoke("ai:getSettings"),
    generateCandidate: (payload: unknown) => ipcRenderer.invoke("ai:generateCandidate", payload)
  }
};`;
    const cjsSource = `const api = {
  openFolderByPath: (folderPath) =>
    ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  createBlankShot: (folderPath, options) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options),
  ai: {
    getSettings: () => ipcRenderer.invoke("ai:getSettings"),
    generateCandidate: (payload) => ipcRenderer.invoke("ai:generateCandidate", payload)
  }
};`;
    const globalSource = `declare global {
  interface Window {
    storyboard: {
      openFolderByPath: (folderPath: string) => Promise<unknown>;
      ai: {
        getSettings: () => Promise<unknown>;
      };
    };
  }
}`;

    expect(globalStoryboardApiKeys(globalSource)).toEqual(["ai", "openFolderByPath"]);
    expect(() => checkPreloadSync({ tsSource, cjsSource, globalSource })).toThrow(
      /global\.d\.ts API keys drifted between preload\.ts and global\.d\.ts/
    );
  });

  it("detects drift between preload method parameters and renderer global types", () => {
    const tsSource = `const api = {
  openFolderByPath: (folderPath: string) =>
    ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  createBlankShot: (folderPath: string, options: unknown) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options),
  ai: {
    getSettings: () => ipcRenderer.invoke("ai:getSettings")
  }
};`;
    const cjsSource = `const api = {
  openFolderByPath: (folderPath) =>
    ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  createBlankShot: (folderPath, options) =>
    ipcRenderer.invoke("images:createBlankShot", folderPath, options),
  ai: {
    getSettings: () => ipcRenderer.invoke("ai:getSettings")
  }
};`;
    const globalSource = `declare global {
  interface Window {
    storyboard: {
      openFolderByPath: (folderPath: string) => Promise<unknown>;
      createBlankShot: (folderPath: string) => Promise<unknown>;
      ai: {
        getSettings: () => Promise<unknown>;
      };
    };
  }
}`;

    expect(globalStoryboardApiSignatures(globalSource)).toContainEqual(["createBlankShot", ["folderPath"]]);
    expect(() => checkPreloadSync({ tsSource, cjsSource, globalSource })).toThrow(
      /global\.d\.ts API signatures drifted between preload\.ts and global\.d\.ts/
    );
  });

  it("detects drift between nested AI method parameters and renderer global types", () => {
    const tsSource = `const api = {
  openFolderByPath: (folderPath: string) =>
    ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  ai: {
    getSettings: () => ipcRenderer.invoke("ai:getSettings"),
    generateCandidate: (payload: unknown, options: unknown) =>
      ipcRenderer.invoke("ai:generateCandidate", payload, options)
  }
};`;
    const cjsSource = `const api = {
  openFolderByPath: (folderPath) =>
    ipcRenderer.invoke("workspace:openFolderByPath", folderPath),
  ai: {
    getSettings: () => ipcRenderer.invoke("ai:getSettings"),
    generateCandidate: (payload, options) =>
      ipcRenderer.invoke("ai:generateCandidate", payload, options)
  }
};`;
    const globalSource = `declare global {
  interface Window {
    storyboard: {
      openFolderByPath: (folderPath: string) => Promise<unknown>;
      ai: {
        getSettings: () => Promise<unknown>;
        generateCandidate: (payload: unknown) => Promise<unknown>;
      };
    };
  }
}`;

    expect(globalStoryboardNestedApiSignatures(globalSource, "ai")).toContainEqual([
      "generateCandidate",
      ["payload"]
    ]);
    expect(() => checkPreloadSync({ tsSource, cjsSource, globalSource })).toThrow(
      /global\.d\.ts ai API signatures drifted between preload\.ts and global\.d\.ts/
    );
  });
});
