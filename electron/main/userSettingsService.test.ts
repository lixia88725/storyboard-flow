import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  readRecentFolders,
  readRecentFoldersWithRecovery,
  readToolRadialMenu,
  writeRecentFolders,
  writeToolRadialMenu
} from "./userSettingsService";

describe("userSettingsService", () => {
  it("reads and writes recent folders under userData", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "swb-user-settings-"));

    await expect(readRecentFolders(userDataPath)).resolves.toEqual([]);
    await writeRecentFolders(userDataPath, ["/tmp/a", "/tmp/b"]);

    await expect(readRecentFolders(userDataPath)).resolves.toEqual(["/tmp/a", "/tmp/b"]);
  });

  it("resets corrupt recent folders and reports the recovery", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "swb-user-settings-"));
    const settingsPath = path.join(userDataPath, "recent-folders.json");
    await writeFile(settingsPath, "{not json", "utf8");

    await expect(readRecentFoldersWithRecovery(userDataPath)).resolves.toEqual({
      folders: [],
      recoveredFromCorruptFile: true
    });
    await expect(readFile(settingsPath, "utf8")).resolves.toBe("[]\n");
  });

  it("reads and writes tool radial menu settings under userData", async () => {
    const userDataPath = await mkdtemp(path.join(os.tmpdir(), "swb-user-settings-"));
    const config = { brush: [{ label: "Size", value: 12 }] };

    await expect(readToolRadialMenu(userDataPath)).resolves.toBeUndefined();
    await expect(writeToolRadialMenu(userDataPath, config)).resolves.toEqual(config);

    await expect(readToolRadialMenu(userDataPath)).resolves.toEqual(config);
    await expect(readFile(path.join(userDataPath, "tool-radial-menu.json"), "utf8")).resolves.toContain(
      "\"brush\""
    );
  });
});
