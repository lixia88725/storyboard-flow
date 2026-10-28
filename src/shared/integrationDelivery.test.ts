import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';

// Integration contracts only; this does not claim a built installer was exercised.
const read = (name: string) => readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
const nativeScripts = [
  'recovery-origin-permissions.py', 'recovery-claim-records.py',
  'recovery-content-permissions.py', 'recovery-origin-enrollment.py',
  'recovery-project-permissions.py', 'owned-stage-cleanup.py'
];
test('CI passes the installed TIFF dependency directory to the full allowed suite', () => {
  const testJob = read('.github/workflows/release.yml').split('\n  test:\n')[1].split('\n  metadata:\n')[0];
  expect(testJob).toContain('SWB_PYTHON_DEPS_DIR: ${{ github.workspace }}/vendor/python/photoshop-tiff');
  const prepareTemp = testJob.indexOf('printf \'TMPDIR=%s\\n\' "$RUNNER_TEMP" >> "$GITHUB_ENV"');
  expect(prepareTemp).toBeGreaterThan(-1);
  expect(prepareTemp).toBeLessThan(testJob.indexOf('run: npm run build'));
  expect(testJob.split('    steps:')[0]).not.toContain('runner.temp');
  expect(read('vitest.config.ts')).toContain('exclude: ["src/renderer/normalSaveMetadataHistory.test.ts"]');
});
test('CI builds real Main cold-reader dependencies before running the full suite', () => {
  const testJob = read('.github/workflows/release.yml').split('\n  test:\n')[1].split('\n  metadata:\n')[0];
  const build = testJob.indexOf('run: npm run build');
  expect(build).toBeGreaterThan(-1);
  expect(build).toBeLessThan(testJob.indexOf('run: npm test'));
  expect(testJob).toContain('run: npm run check:preload');
  expect(read('package.json')).toContain('"build": "npm run typecheck && vite build && npm run build:electron"');
  expect(read('package.json')).toContain('"typecheck": "tsc --noEmit && tsc -p tsconfig.electron.json --noEmit"');
});
test('both packaging recipes copy every added production native helper', () => {
  for (const recipe of ['scripts/package-macos-app.mjs', 'scripts/package-windows-portable.mjs']) {
    const text = read(recipe);
    for (const script of nativeScripts) expect(text, recipe).toContain('"' + script + '"');
    expect(text).toContain('path.join(repoRoot, "scripts", script)');
    expect(text).toContain('path.join(packagedAppRoot, "scripts", script)');
  }
});
