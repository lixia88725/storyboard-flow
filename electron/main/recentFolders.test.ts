import { describe, expect, it } from "vitest";
import { addRecentFolderPath, normalizeRecentFolders, removeRecentFolderPath } from "./recentFolders.js";

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
});
