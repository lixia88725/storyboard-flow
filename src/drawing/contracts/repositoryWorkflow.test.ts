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
  it("prepares pinned native fixtures before CI and requires matching package targets", () => {
    for(const name of ['test','package']){
      const text=job(name);
      for(const part of ['RUSTUP_TOOLCHAIN:', "'1.99.1'",'RUSTUP_HOME=', 'CARGO_HOME=', 'rustup toolchain install 1.99.1 --profile minimal --no-self-update','npm run setup:photocraft','npm run build:photocraft'])expect(text).toContain(part);
      const native=text.indexOf('run: npm run build:photocraft');
      expect(native).toBeGreaterThan(text.indexOf('run: npm run setup:photocraft'));
      expect(native).toBeLessThan(text.indexOf(name==='test'?'Run explicitly approved test suite':'run: npm run package:'));
    }
    expect(job('test')).toContain('FLOW_PHOTOCRAFT_TARGET: aarch64-apple-darwin');
    for(const target of ['x86_64-pc-windows-msvc','aarch64-apple-darwin'])expect(job('package')).toContain('native_target: '+target);
    expect(job('package')).toContain('Microsoft.VisualStudio.Component.VC.Tools.x86.x64');
    const mac=readFileSync(new URL('../../../scripts/package-macos-app.mjs',import.meta.url),'utf8');
    expect(mac.indexOf('await sealSignedNative')).toBeLessThan(mac.indexOf('["--verify", "--deep", "--strict", appDir]'));
    const build=readFileSync(new URL('../../../scripts/build-photocraft.mjs',import.meta.url),'utf8');
    for(const part of ["'--locked'","'--all-targets'","'--target'",'target-feature=+crt-static'])expect(build).toContain(part);
  });
  it("validates real ZIP-reader success and negative fixture boundaries", () => {
    const result = spawnSync("python3", ["scripts/test-release-package.py"], { encoding: "utf8" });
    expect(result.stderr).toContain("Ran 15 tests");
    expect(result.status, result.stderr).toBe(0);
  });
});
