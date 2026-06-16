import { describe, expect, it, vi } from "vitest";
import { createWorkspaceWatchAppHandlers } from "./workspaceWatchAppRuntime.js";

describe("createWorkspaceWatchAppHandlers", () => {
  it("starts and stops folder watchers through the watch service", () => {
    const sender = { send: vi.fn() };
    const workspaceFolderWatchService = {
      start: vi.fn(() => 7),
      stop: vi.fn()
    };
    const handlers = createWorkspaceWatchAppHandlers({ workspaceFolderWatchService });

    expect(
      handlers.startFolderWatch({ sender } as Parameters<typeof handlers.startFolderWatch>[0], "/scene")
    ).toBe(7);
    handlers.stopFolderWatch(7);

    expect(workspaceFolderWatchService.start).toHaveBeenCalledWith("/scene", sender);
    expect(workspaceFolderWatchService.stop).toHaveBeenCalledWith(7);
  });
});
