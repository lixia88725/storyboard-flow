import { describe, expect, it } from "vitest";
import {
  addRecentFolderPath,
  buildRecentFoldersMenuTemplate,
  createRecentFoldersChangeNotifier,
  createRecentFoldersController,
  normalizeRecentFolders,
  removeRecentFolderPath
} from "./recentFolders.js";

describe("recent folder helpers", () => {
  it("normalizes persisted recent folders", () => {
    expect(
      normalizeRecentFolders(
        [" /tmp/scene-a ", "", "/tmp/scene-b", "/tmp/scene-a", "/tmp/scene-c"],
        2
      )
    ).toEqual(["/tmp/scene-a", "/tmp/scene-b"]);
  });

  it("moves an opened folder to the front without duplicates", () => {
    expect(addRecentFolderPath(["/tmp/scene-a", "/tmp/scene-b"], "/tmp/scene-b", 10)).toEqual([
      "/tmp/scene-b",
      "/tmp/scene-a"
    ]);
  });

  it("removes a missing folder after an attempted open", () => {
    expect(removeRecentFolderPath(["/tmp/scene-a", "/tmp/missing", "/tmp/scene-b"], "/tmp/missing")).toEqual([
      "/tmp/scene-a",
      "/tmp/scene-b"
    ]);
  });

  it("builds a recent folders application menu template", () => {
    const opened: string[] = [];
    const template = buildRecentFoldersMenuTemplate(["/tmp/scene-a"], {
      isDarwin: true,
      onOpenFolder: (folderPath) => opened.push(folderPath)
    });

    expect(template[0]).toEqual({ role: "appMenu" });
    expect(template[1].label).toBe("File");
    const openRecent = template[1].submenu?.[0];
    expect(openRecent?.label).toBe("Open Recent");
    const recentItem = openRecent?.submenu?.[0];
    expect(recentItem?.label).toBe("/tmp/scene-a");
    recentItem?.click?.();
    expect(opened).toEqual(["/tmp/scene-a"]);
  });

  it("builds an empty recent folders menu item", () => {
    const template = buildRecentFoldersMenuTemplate([], {
      isDarwin: false,
      onOpenFolder: () => undefined
    });

    expect(template[0].label).toBe("File");
    expect(template[0].submenu?.[0].submenu).toEqual([{ label: "No Recent Folders", enabled: false }]);
  });

  it("sends recent folder changes when a window is available", () => {
    const sent: unknown[][] = [];
    const notifier = createRecentFoldersChangeNotifier(() => ({
      send: (...args: unknown[]) => sent.push(args)
    }));

    notifier.notify(["/tmp/scene-a"]);

    expect(sent).toEqual([["recent:foldersChanged", ["/tmp/scene-a"], undefined]]);
  });

  it("stores corrupt recovery changes until a window is available", () => {
    const sent: unknown[][] = [];
    let hasWindow = false;
    const notifier = createRecentFoldersChangeNotifier(() =>
      hasWindow
        ? {
            send: (...args: unknown[]) => sent.push(args)
          }
        : undefined
    );

    notifier.notify(["/tmp/recovered"], "recent-folders-corrupt");
    notifier.flush();
    expect(sent).toEqual([]);

    hasWindow = true;
    notifier.flush();
    expect(sent).toEqual([["recent:foldersChanged", ["/tmp/recovered"], "recent-folders-corrupt"]]);
    notifier.flush();
    expect(sent).toHaveLength(1);
  });

  it("reports recovered corrupt recent folders while reading", async () => {
    const calls: string[] = [];
    const notifications: unknown[][] = [];
    const controller = createRecentFoldersController({
      maxRecentFolders: 10,
      userDataPath: () => "/user-data",
      readWithRecovery: async (userDataPath, maxRecentFolders) => {
        calls.push(`read:${userDataPath}:${maxRecentFolders}`);
        return { folders: ["/tmp/recovered"], recoveredFromCorruptFile: true };
      },
      writeFolders: async () => [],
      updateMenu: async () => calls.push("update-menu"),
      notifyChanged: (...args) => notifications.push(args),
      corruptReason: "recent-folders-corrupt"
    });

    await expect(controller.read()).resolves.toEqual(["/tmp/recovered"]);
    expect(calls).toEqual(["read:/user-data:10", "update-menu"]);
    expect(notifications).toEqual([[["/tmp/recovered"], "recent-folders-corrupt"]]);
  });

  it("adds recent folders through the injected writer", async () => {
    const writes: unknown[][] = [];
    const notifications: unknown[][] = [];
    const controller = createRecentFoldersController({
      maxRecentFolders: 2,
      userDataPath: () => "/user-data",
      readWithRecovery: async () => ({ folders: ["/tmp/scene-a"], recoveredFromCorruptFile: false }),
      writeFolders: async (...args) => {
        writes.push(args);
        return ["/tmp/scene-b", "/tmp/scene-a"];
      },
      updateMenu: async () => undefined,
      notifyChanged: (...args) => notifications.push(args),
      corruptReason: "recent-folders-corrupt"
    });

    await controller.add("/tmp/scene-b");

    expect(writes).toEqual([["/user-data", ["/tmp/scene-b", "/tmp/scene-a"], 2]]);
    expect(notifications).toEqual([[["/tmp/scene-b", "/tmp/scene-a"]]]);
  });

  it("does not write when removing a missing recent folder", async () => {
    let writeCount = 0;
    const controller = createRecentFoldersController({
      maxRecentFolders: 10,
      userDataPath: () => "/user-data",
      readWithRecovery: async () => ({ folders: ["/tmp/scene-a"], recoveredFromCorruptFile: false }),
      writeFolders: async () => {
        writeCount += 1;
        return [];
      },
      updateMenu: async () => undefined,
      notifyChanged: () => undefined,
      corruptReason: "recent-folders-corrupt"
    });

    await controller.remove("/tmp/missing");

    expect(writeCount).toBe(0);
  });
});
