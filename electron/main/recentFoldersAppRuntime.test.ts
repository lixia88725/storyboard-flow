import { describe, expect, it, vi } from "vitest";
import {
  createRecentFoldersAppHandlers,
  createRecentFoldersAppRuntime
} from "./recentFoldersAppRuntime";

describe("recentFoldersAppRuntime", () => {
  it("composes the app recent folders runtime with the standard defaults", async () => {
    const applicationMenus: unknown[] = [];
    const readWithRecovery = vi.fn(async () => ({
      folders: ["/scene/a"],
      recoveredFromCorruptFile: false
    }));
    const writeFolders = vi.fn(async (_userDataPath, folders) => folders);

    const runtime = createRecentFoldersAppRuntime({
      buildApplicationMenu: (template) => ({ template }),
      getSender: () => undefined,
      isDarwin: false,
      onOpenFolder: vi.fn(),
      readWithRecovery,
      setApplicationMenu: (menu) => applicationMenus.push(menu),
      userDataPath: () => "/user-data",
      writeFolders
    });

    await runtime.updateMenu();
    await runtime.add("/scene/b");

    expect(readWithRecovery).toHaveBeenCalledWith("/user-data", 10);
    expect(writeFolders).toHaveBeenCalledWith("/user-data", ["/scene/b", "/scene/a"], 10);
    expect(applicationMenus).toHaveLength(2);
    expect(applicationMenus[0]).toEqual({
      template: [
        {
          label: "File",
          submenu: [
            {
              label: "Open Recent",
              submenu: [{ label: "/scene/a", click: expect.any(Function) }]
            }
          ]
        },
        { role: "editMenu" },
        {
          label: "View",
          submenu: [
            { role: "reload" },
            { role: "forceReload" },
            { role: "toggleDevTools" },
            { role: "togglefullscreen" }
          ]
        },
        { role: "windowMenu" }
      ]
    });
  });

  it("creates IPC handlers that read folders and flush changed-folder notifications", async () => {
    const read = vi.fn(async () => ["/scene/a", "/scene/b"]);
    const flushChangedFolders = vi.fn();
    const handlers = createRecentFoldersAppHandlers({ read, flushChangedFolders });

    await expect(handlers.getFolders()).resolves.toEqual(["/scene/a", "/scene/b"]);
    expect(read).toHaveBeenCalledOnce();
    expect(flushChangedFolders).toHaveBeenCalledOnce();
  });
});
