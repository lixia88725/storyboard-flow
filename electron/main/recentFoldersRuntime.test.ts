import { describe, expect, it, vi } from "vitest";
import { createRecentFoldersRuntime } from "./recentFoldersRuntime";

const createRuntime = () => {
  const applicationMenus: unknown[] = [];
  const sender = {
    send: vi.fn()
  };
  const runtime = createRecentFoldersRuntime({
    buildApplicationMenu: (template) => ({ template }),
    corruptReason: "recent-folders-corrupt",
    getSender: () => sender,
    isDarwin: false,
    maxRecentFolders: 2,
    onOpenFolder: vi.fn(),
    readWithRecovery: vi.fn(async () => ({
      folders: ["/tmp/scene-a"],
      recoveredFromCorruptFile: false
    })),
    setApplicationMenu: (menu) => applicationMenus.push(menu),
    userDataPath: () => "/user-data",
    writeFolders: vi.fn(async (_userDataPath, folders) => folders.slice(0, 2))
  });

  return { applicationMenus, runtime, sender };
};

describe("recentFoldersRuntime", () => {
  it("updates the application menu from the recent folders controller", async () => {
    const { applicationMenus, runtime } = createRuntime();

    await runtime.updateMenu();

    expect(applicationMenus).toHaveLength(1);
    expect(applicationMenus[0]).toEqual({
      template: [
        {
          label: "File",
          submenu: [
            {
              label: "Open Recent",
              submenu: [{ label: "/tmp/scene-a", click: expect.any(Function) }]
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

  it("flushes pending recent folder recovery notifications through the injected sender", async () => {
    const sent: unknown[][] = [];
    let hasSender = false;
    const runtime = createRecentFoldersRuntime({
      buildApplicationMenu: (template) => ({ template }),
      corruptReason: "recent-folders-corrupt",
      getSender: () =>
        hasSender
          ? {
              send: (...args: unknown[]) => sent.push(args)
            }
          : undefined,
      isDarwin: false,
      maxRecentFolders: 2,
      onOpenFolder: vi.fn(),
      readWithRecovery: vi.fn(async () => ({
        folders: ["/tmp/recovered"],
        recoveredFromCorruptFile: true
      })),
      setApplicationMenu: vi.fn(),
      userDataPath: () => "/user-data",
      writeFolders: vi.fn(async () => [])
    });

    await runtime.read();
    runtime.flushChangedFolders();
    expect(sent).toEqual([]);

    hasSender = true;
    runtime.flushChangedFolders();
    expect(sent).toEqual([
      ["recent:foldersChanged", ["/tmp/recovered"], "recent-folders-corrupt"]
    ]);
  });

  it("writes and notifies through the composed recent folders controller", async () => {
    const { runtime, sender } = createRuntime();

    await runtime.add("/tmp/scene-b");

    expect(sender.send).toHaveBeenCalledWith("recent:foldersChanged", [
      "/tmp/scene-b",
      "/tmp/scene-a"
    ], undefined);
  });
});
