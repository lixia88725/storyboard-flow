import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(new URL("../../../.github/workflows/release.yml", import.meta.url), "utf8");
const job = (name: string) => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z]+:\n/)[0] ?? "";

describe("single-repository workflow contract", () => {
  it("keeps fork PR CI read-only and secret-free with all required gates", () => {
    expect(workflow).toContain("  pull_request:");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).not.toMatch(/pull_request_target|secrets\.|RELEASE_REPO_TOKEN|storyboard-flow-releases|git push/);
    for (const command of ["npm ci", "npm run build", "npm run check:preload"]) expect(job("test")).toContain(command);
    expect(job("metadata")).toContain("if: github.event_name != 'pull_request'");
  });
  it("runs only the enumerated approved suite and never the barred history test", () => {
    const test = job("test");
    expect(test).toContain("test/allowed-suite.json");
    expect(test).toContain("node_modules/vitest/vitest.mjs");
    expect(test).not.toMatch(/run:\s*npm test/);
    const approved = JSON.parse(readFileSync(new URL("../../../test/allowed-suite.json", import.meta.url), "utf8")) as string[];
    expect(Array.isArray(approved)).toBe(true);
    expect(approved.length).toBeGreaterThan(0);
    for (const file of approved) expect(file).toMatch(/^src\/[A-Za-z0-9_./-]+\.test\.ts$/);
    // The barred history test must stay out of both the suite and the workflow.
    expect(approved).not.toContain("src/renderer/normalSaveMetadataHistory.test.ts");
    expect(workflow).not.toContain("normalSaveMetadataHistory");
  });
  it("bounds the worker heap for the heaviest approved file", () => {
    const test = job("test");
    const heap = test.match(/NODE_OPTIONS:\s*--max-old-space-size=(\d+)/);
    expect(heap, "the test job must set a bounded NODE_OPTIONS heap").not.toBeNull();
    expect(Number(heap![1])).toBe(4096);
  });
  it("sets the runner temporary directory only after the test job starts", () => {
    const test = job("test");
    const jobConfiguration = test.split("    steps:")[0];
    expect(jobConfiguration).not.toContain("runner.temp");
    const prepareTemp = test.indexOf('printf \'TMPDIR=%s\\n\' "$RUNNER_TEMP" >> "$GITHUB_ENV"');
    expect(prepareTemp).toBeGreaterThan(-1);
    expect(prepareTemp).toBeLessThan(test.indexOf("Run explicitly approved test suite"));
  });
  it("builds both native architectures after tests, publishes only gated main/tags, and pins target identity", () => {
    expect(workflow).toContain("branches: [main, infra/public-repository]");
    expect(job("test")).toContain("runs-on: macos-15");
    expect(workflow).not.toContain("macos-14");
    expect(job("package")).toContain("needs: [test, metadata]");
    for (const entry of ["windows-latest", "macos-15", "arch: x64", "arch: arm64", "actions/upload-artifact@v4", "python scripts/validate-release-package.py"]) expect(job("package")).toContain(entry);
    const publish = job("publish");
    expect(publish).toContain("needs: [metadata, package]");
    expect(publish).toContain("vars.RELEASE_ENABLED == 'true'");
    expect(publish).toContain("github.ref == 'refs/heads/main'");
    expect(publish).not.toContain("infra/public-repository");
    expect(publish).toContain("contents: write");
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
    expect(publish).toContain("group: storyboard-flow-release-publication");
    expect(publish).toContain("cancel-in-progress: false");
    expect(publish).toContain("TARGET_SHA: ${{ needs.metadata.outputs.sha }}");
    expect(job("metadata")).toContain('git merge-base --is-ancestor "$sha" "$main_sha"');
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(4);
    expect(workflow.match(/ref: \$\{\{ needs.metadata.outputs.sha \}\}/g)).toHaveLength(2);
  });
  it("validates real ZIP-reader success and negative fixture boundaries", () => {
    const result = spawnSync("python3", ["scripts/test-release-package.py"], { encoding: "utf8" });
    expect(result.stderr).toContain("Ran 8 tests");
    expect(result.status, result.stderr).toBe(0);
  });
});
