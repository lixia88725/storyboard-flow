import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

// Integration contracts only; this does not claim a built installer was exercised.
const read = (name: string) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const nativeScripts = [
  'recovery-origin-permissions.py', 'recovery-claim-records.py',
  'recovery-content-permissions.py', 'recovery-origin-enrollment.py',
  'recovery-project-permissions.py', 'owned-stage-cleanup.py', 'legacy-single-layer-proof.py'
];
test('CI passes the installed TIFF dependency directory to the full allowed suite', () => {
  const testJob = read('.github/workflows/release.yml').split('\n  test:\n')[1].split('\n  metadata:\n')[0];
  expect(testJob).toContain('SWB_PYTHON_DEPS_DIR: ${{ github.workspace }}/vendor/python/photoshop-tiff');
  expect(testJob).toContain('TMPDIR: ${{ runner.temp }}');
  expect(read('vitest.config.ts')).toContain('exclude: ["src/renderer/normalSaveMetadataHistory.test.ts"]');
});
test('both packaging recipes copy every added production native helper', () => {
  for (const recipe of ['scripts/package-macos-app.mjs', 'scripts/package-windows-portable.mjs']) {
    const text = read(recipe);
    for (const script of nativeScripts) expect(text, recipe).toContain('"' + script + '"');
    expect(text).toContain('path.join(repoRoot, "scripts", script)');
    expect(text).toContain('path.join(packagedAppRoot, "scripts", script)');
  }
});
