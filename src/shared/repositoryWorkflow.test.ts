import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const workflow = readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8");
const job = (name: string) => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n  [a-z]+:\n/)[0] ?? "";

describe("single-repository workflow contract", () => {
  it("keeps fork PR CI read-only and secret-free with all required gates", () => {
    expect(workflow).toContain("  pull_request:");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).not.toMatch(/pull_request_target|secrets\.|RELEASE_REPO_TOKEN|storyboard-flow-releases|git push/);
    for (const command of ["npm ci", "npm test", "npm run build", "npm run check:preload"]) expect(job("test")).toContain(command);
    expect(job("metadata")).toContain("if: github.event_name != 'pull_request'");
  });
  it("builds both native architectures after tests, publishes only gated main/tags, and pins target identity", () => {
    expect(workflow).toContain("branches: [main, infra/public-repository]");
    expect(job("package")).toContain("needs: [test, metadata]");
    for (const entry of ["windows-latest", "macos-14", "arch: x64", "arch: arm64", "actions/upload-artifact@v4", "python scripts/validate-release-package.py"]) expect(job("package")).toContain(entry);
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
    expect(result.stderr).toContain("Ran 4 tests");
    expect(result.status, result.stderr).toBe(0);
  });
});
