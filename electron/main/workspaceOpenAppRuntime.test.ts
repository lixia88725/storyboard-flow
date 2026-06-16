import { describe, expect, it, vi } from "vitest";
import { createWorkspaceOpenAppHandlers } from "./workspaceOpenAppRuntime.js";

describe("createWorkspaceOpenAppHandlers", () => {
  it("returns the workspace open dependencies used by the IPC handler", async () => {
    const addRecentFolder = vi.fn();
    const createProgressReporter = vi.fn(() => ({ mode: "open" }));
    const pathExists = vi.fn(async () => true);
    const removeRecentFolder = vi.fn();
    const scanFolder = vi.fn(async () => ({ folderPath: "/scene" }));

    const handlers = createWorkspaceOpenAppHandlers({
      addRecentFolder,
      createProgressReporter,
      pathExists,
      removeRecentFolder,
      scanFolder
    });

    await expect(handlers.pathExists("/scene")).resolves.toBe(true);
    expect(handlers.createProgressReporter("sender", "open")).toEqual({ mode: "open" });
    await expect(handlers.scanFolder("/scene", { mode: "open" })).resolves.toEqual({
      folderPath: "/scene"
    });

    handlers.addRecentFolder("/scene");
    handlers.removeRecentFolder("/missing");

    expect(addRecentFolder).toHaveBeenCalledWith("/scene");
    expect(removeRecentFolder).toHaveBeenCalledWith("/missing");
  });
});
