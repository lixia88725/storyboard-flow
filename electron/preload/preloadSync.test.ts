import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("preload sync", () => {
  it("keeps TypeScript and CommonJS preload APIs in sync", async () => {
    const scriptPath = path.resolve("scripts/check-preload-sync.mjs");
    const { stdout } = await execFileAsync("node", [scriptPath]);

    expect(stdout.trim()).toBe("preload APIs are in sync");
  });
});
