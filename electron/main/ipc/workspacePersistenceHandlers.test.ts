import { describe, expect, it, vi } from "vitest";
import {
  registerWorkspacePersistenceIpcHandlers,
  type WorkspacePersistenceIpcHandlers
} from "./workspacePersistenceHandlers.js";

const payload = {
  folderPath: "/scene",
  metadataPath: "/scene/.storyboard-workbench/storyboard.project.json",
  project: { shots: ["shot-1"] }
};

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
};

const register = (
  ensureProjectLayerAssets = vi.fn<WorkspacePersistenceIpcHandlers<typeof payload>["ensureProjectLayerAssets"]>(async () => undefined),
  writeProjectFiles = vi.fn<WorkspacePersistenceIpcHandlers<typeof payload>["writeProjectFiles"]>(async () => undefined)
) => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    })
  };
  registerWorkspacePersistenceIpcHandlers<typeof payload>(ipcMain, {
    ensureProjectLayerAssets,
    writeProjectFiles
  });
  return { handlers, ensureProjectLayerAssets, writeProjectFiles };
};

const invoke = (handlers: ReturnType<typeof register>["handlers"], channel: string) => {
  const handler = handlers.get(channel);
  expect(handler).toBeDefined();
  return handler!({}, payload);
};

describe("workspace persistence IPC contract", () => {
  it("awaits asset preparation before writing the original project and returning the same payload", async () => {
    const gate = deferred();
    const ensure = vi.fn<WorkspacePersistenceIpcHandlers<typeof payload>["ensureProjectLayerAssets"]>(() => gate.promise);
    const { handlers, writeProjectFiles } = register(ensure);
    const result = invoke(handlers, "workspace:autosave");

    expect(ensure).toHaveBeenCalledExactlyOnceWith(payload.project, payload.folderPath, {
      includeExternalShots: false
    });
    expect(ensure.mock.calls[0][0]).toBe(payload.project);
    expect(writeProjectFiles).not.toHaveBeenCalled();
    gate.resolve();

    await expect(result).resolves.toBe(payload);
    expect(writeProjectFiles).toHaveBeenCalledExactlyOnceWith(
      payload.metadataPath, payload.folderPath, payload.project
    );
    expect(writeProjectFiles.mock.calls[0][2]).toBe(payload.project);
  });

  it("awaits the project write before returning the same autosave payload", async () => {
    const gate = deferred();
    const write = vi.fn(() => gate.promise);
    const { handlers } = register(undefined, write);
    let settled = false;
    const result = Promise.resolve(invoke(handlers, "workspace:autosave")).then((value) => {
      settled = true;
      return value;
    });
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    gate.resolve();
    await expect(result).resolves.toBe(payload);
  });

  it("propagates the original asset rejection without writing project files", async () => {
    const error = new Error("asset preparation failed");
    const { handlers, writeProjectFiles } = register(vi.fn(async () => { throw error; }));
    await expect(invoke(handlers, "workspace:autosave")).rejects.toBe(error);
    expect(writeProjectFiles).not.toHaveBeenCalled();
  });

  it("propagates the original project write rejection", async () => {
    const error = new Error("project write failed");
    const write = vi.fn(async () => { throw error; });
    const { handlers, ensureProjectLayerAssets } = register(undefined, write);
    await expect(invoke(handlers, "workspace:autosave")).rejects.toBe(error);
    expect(ensureProjectLayerAssets).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("ensures assets with default options without writing and returns the same payload only after completion", async () => {
    const gate = deferred();
    const ensure = vi.fn<WorkspacePersistenceIpcHandlers<typeof payload>["ensureProjectLayerAssets"]>(() => gate.promise);
    const { handlers, writeProjectFiles } = register(ensure);
    let settled = false;
    const result = Promise.resolve(invoke(handlers, "workspace:ensureLayerAssets")).then((value) => {
      settled = true;
      return value;
    });
    expect(ensure).toHaveBeenCalledExactlyOnceWith(payload.project, payload.folderPath);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(writeProjectFiles).not.toHaveBeenCalled();
    gate.resolve();
    await expect(result).resolves.toBe(payload);
    expect(writeProjectFiles).not.toHaveBeenCalled();
  });

  it("propagates the original ensure-only rejection without writing", async () => {
    const error = new Error("ensure-only failed");
    const { handlers, writeProjectFiles } = register(vi.fn(async () => { throw error; }));
    await expect(invoke(handlers, "workspace:ensureLayerAssets")).rejects.toBe(error);
    expect(writeProjectFiles).not.toHaveBeenCalled();
  });
});
