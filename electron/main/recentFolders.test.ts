import { describe, expect, it } from "vitest";
import {
  addRecentFolderPath,
  buildRecentFoldersMenuTemplate,
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
});
