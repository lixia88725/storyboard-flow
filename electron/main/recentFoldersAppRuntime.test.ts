import { describe, expect, it, vi } from "vitest";
import { createRecentFoldersAppRuntime } from "./recentFoldersAppRuntime";

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
        { role: "viewMenu" },
        { role: "windowMenu" }
      ]
    });
  });
});
