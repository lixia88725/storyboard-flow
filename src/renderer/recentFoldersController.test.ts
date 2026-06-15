import { describe, expect, it, vi } from "vitest";
import {
  recentFoldersStatusForChange,
  registerRecentFoldersListeners,
  type RecentFoldersApi
} from "./recentFoldersController";

describe("recentFoldersController", () => {
  it("loads current recent folders and wires open/change listeners until cleanup", async () => {
    let openListener: ((folderPath: string) => void) | undefined;
    let changedListener: ((folders: string[], reason?: string) => void) | undefined;
    const removeOpenListener = vi.fn();
    const removeChangedListener = vi.fn();
    const api: RecentFoldersApi = {
      getRecentFolders: vi.fn(async () => ["/first", "/second"]),
      onOpenRecentFolder: vi.fn((listener) => {
        openListener = listener;
        return removeOpenListener;
      }),
      onRecentFoldersChanged: vi.fn((listener) => {
        changedListener = listener;
        return removeChangedListener;
      })
    };
    const openFolder = vi.fn();
    const setFolderInputValue = vi.fn();
    const setRecentFolders = vi.fn();
    const setStatus = vi.fn();

    const cleanup = registerRecentFoldersListeners(api, {
      openFolder,
      setFolderInputValue,
      setRecentFolders,
      setStatus
    });
    await Promise.resolve();

    expect(setRecentFolders).toHaveBeenCalledWith(["/first", "/second"]);

    openListener?.("/third");

    expect(setFolderInputValue).toHaveBeenCalledWith("/third");
    expect(openFolder).toHaveBeenCalledWith("/third");

    changedListener?.(["/reset"], "recent-folders-corrupt");

    expect(setRecentFolders).toHaveBeenCalledWith(["/reset"]);
    expect(setStatus).toHaveBeenCalledWith("Recent folders were reset because recent-folders.json was corrupted");

    cleanup();

    expect(removeOpenListener).toHaveBeenCalledTimes(1);
    expect(removeChangedListener).toHaveBeenCalledTimes(1);
  });

  it("maps only corrupt recent-folder changes to a user-facing status", () => {
    expect(recentFoldersStatusForChange("recent-folders-corrupt")).toBe(
      "Recent folders were reset because recent-folders.json was corrupted"
    );
    expect(recentFoldersStatusForChange("manual")).toBeUndefined();
    expect(recentFoldersStatusForChange()).toBeUndefined();
  });
});
