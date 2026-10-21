import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("generated product notes describe ordinary Pending, not the retired AI product", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "release-notes-fixture-"));
  try {
    const output = path.join(root, "README.md");
    const result = spawnSync(process.execPath, [fileURLToPath(new URL("../../scripts/generate-release-readme.mjs", import.meta.url)), output], {
      encoding: "utf8", env: {
        STORYBOARD_FLOW_VERSION: "synthetic-test",
        release_url: "https://example.invalid/releases",
        windows_url: "https://example.invalid/fixture.zip"
      }
    });
    expect(result.status, result.stderr).toBe(0);
    const notes = await readFile(output, "utf8");
    expect(notes).not.toContain("AI Draft");
    expect(notes).toContain("Pending");
    expect(notes).toContain("Storyboard Flow");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
