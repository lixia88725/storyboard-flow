import { describe, expect, it, vi } from "vitest";
import { createWorkspaceScriptAppHandlers } from "./workspaceScriptAppRuntime.js";

type ProjectPayload = {
  folderPath: string;
  project: { shots: string[] };
};

type CreatePayload = {
  markdownPath: string;
};

describe("createWorkspaceScriptAppHandlers", () => {
  it("returns the storyboard script dependencies used by the IPC handler", async () => {
    const addRecentFolder = vi.fn();
    const createFromStoryboardScript = vi.fn(async () => ({ folderPath: "/scene" }));
    const ensureStoryboardScriptMarkdown = vi.fn(async () => false);
    const inspectStoryboardScript = vi.fn(() => ({ itemCount: 2 }));

    const handlers = createWorkspaceScriptAppHandlers<ProjectPayload, CreatePayload, { folderPath: string }>({
      addRecentFolder,
      createFromStoryboardScript,
      ensureStoryboardScriptMarkdown,
      inspectStoryboardScript
    });

    expect(handlers.inspectStoryboardScript("/scene/storyboard-script.md")).toEqual({ itemCount: 2 });
    await expect(handlers.createFromStoryboardScript({ markdownPath: "/tmp/script.md" })).resolves.toEqual({
      folderPath: "/scene"
    });
    await expect(handlers.ensureStoryboardScriptMarkdown("/scene", { shots: ["shot-1"] })).resolves.toBe(false);

    handlers.addRecentFolder("/scene");

    expect(addRecentFolder).toHaveBeenCalledWith("/scene");
  });
});
