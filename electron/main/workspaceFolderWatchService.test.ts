import { describe, expect, it, vi } from "vitest";
import {
  createWorkspaceFolderWatchService,
  shouldNotifyWorkspaceFolderChange
} from "./workspaceFolderWatchService.js";

const createFakeWatcher = () => ({
  close: vi.fn(),
  on: vi.fn()
});

describe("workspaceFolderWatchService", () => {
  it("notifies only top-level TIFF files and storyboard script changes", () => {
    expect(shouldNotifyWorkspaceFolderChange("shot.tiff")).toBe(true);
    expect(shouldNotifyWorkspaceFolderChange("shot.TIF")).toBe(true);
    expect(shouldNotifyWorkspaceFolderChange("storyboard-script.md")).toBe(true);
    expect(shouldNotifyWorkspaceFolderChange("shot.png")).toBe(false);
    expect(shouldNotifyWorkspaceFolderChange("nested/shot.tiff")).toBe(false);
    expect(shouldNotifyWorkspaceFolderChange(".storyboard-metadata-shot.tiff")).toBe(false);
    expect(shouldNotifyWorkspaceFolderChange(undefined)).toBe(false);
  });

  it("starts, stops, and closes workspace folder watchers", () => {
    const watcherA = createFakeWatcher();
    const watcherB = createFakeWatcher();
    const watch = vi
      .fn()
      .mockReturnValueOnce(watcherA)
      .mockReturnValueOnce(watcherB);
    const service = createWorkspaceFolderWatchService({ watch });

    const firstId = service.start("/scene-a", {
      send: vi.fn()
    });
    const secondId = service.start("/scene-b", {
      send: vi.fn()
    });

    expect(firstId).toBe(1);
    expect(secondId).toBe(2);
    expect(watch).toHaveBeenCalledTimes(2);

    service.stop(firstId);
    expect(watcherA.close).toHaveBeenCalledOnce();

    service.closeAll();
    expect(watcherB.close).toHaveBeenCalledOnce();
  });

  it("sends changed file payloads through the supplied sender", () => {
    const watcher = createFakeWatcher();
    let listener: (_eventType: string, fileName: string) => void = () => undefined;
    const watch = vi.fn((_folderPath, _options, nextListener) => {
      listener = nextListener;
      return watcher;
    });
    const sender = { send: vi.fn() };
    const service = createWorkspaceFolderWatchService({ watch });

    service.start("/scene", sender);
    listener("change", "shot.tiff");
    listener("change", "ignore.png");

    expect(sender.send).toHaveBeenCalledOnce();
    expect(sender.send).toHaveBeenCalledWith("workspace:folderChanged", {
      folderPath: "/scene",
      fileName: "shot.tiff"
    });
  });
});
