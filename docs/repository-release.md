# Single-repository CI / release handoff

## Status and authority

Infrastructure is implemented in the isolated `infra/public-repository` worktree at base
`34192f4e5155059a1ac7962e69d50201d8207083`. Runtime implementation candidate
`191e2de3979f727e58061d43bf9222cd0c9af35a` is committed and pushed; hosted run
[37947605799](https://github.com/lixia88725/storyboard-flow/actions/runs/37947605799)
passed full tests, build/typecheck, preload consistency, and both native platform
packages, ZIP validation and artifact upload. Publication was deliberately skipped.
Later handoff-only edits do not claim a different runtime candidate; the task PR
records the final source/merge identity and preparation status.
Requirements and subsequent CORS / preparation-gate changes are based on the initiating
agent's supplied user-confirmation excerpts, not an independent reading of the original chat.
This document supersedes the old cross-repository release instructions in README,
`decisions.md`, and `todo.md` **only for the new workflow**; their product/data decisions remain.
The actively edited main worktree was not read or modified. These tests do not verify
that other session's new product version or any GUI behavior.

**Preparation is deliberately publication-disabled:** an unset or non-`true` repository
variable `RELEASE_ENABLED` skips publication. Do not enable it for the old baseline.
The repository variable was explicitly set to `false` and read back. No software
Release or old-repository deletion is part of preparation. Root LICENSE is MIT for
owned code. Ordinary development identities/emails and absolute machine paths in
history were explicitly approved for disclosure; no history rewrite is planned.
Two limited secret screens found no checked common credential patterns. That is
not a comprehensive privacy audit or permission to expose private business material.

## Pipeline contract

- Fork and same-repository PRs: `pull_request`, read-only token, no secrets, pinned event SHA,
  no persisted checkout credentials; npm CI, TIFF Python dependencies, complete Vitest suite,
  build (including typecheck), and preload consistency. No PR packaging/publication.
- Pushes to `infra/public-repository`: the same gates, then native Windows x64 and macOS
  arm64 (`macos-14`, with runtime architecture assertion) ZIP packaging and ZIP-content
  validation, retained Actions artifacts. **Never a Release**, regardless of the gate.
- Main pushes: the same gates and both packages; once explicitly enabled, publish into
  `lixia88725/storyboard-flow` using only that repository's `GITHUB_TOKEN`.
- Manual dispatch: only `refs/heads/main`, strict stable `major.minor.patch` input, no leading
  zeros, suffixes, whitespace, or shell interpretation. Tags must be valid `vMAJOR.MINOR.PATCH`
  and identify a commit already in main history; other tag matches fail admission.
- Only the publish job has `contents: write`. It downloads artifacts from this run and
  checks out the exact resolved commit. No PAT, old release repository, or main writeback.
- Publication jobs are serialized with `cancel-in-progress: false`; GitHub does not promise
  FIFO. The publisher checks all stable releases and rejects stale new/draft versions, so
  an older completed build cannot displace a newer latest.
- Create/verify the tag at the exact commit (including peeling annotated tags). Never
  delete, move, or recreate an existing tag. Stage a non-latest draft, upload **both ZIPs
  plus update.json**, read back names, sizes, uploaded states and GitHub SHA-256 digests,
  then use a single release PATCH to expose the complete non-prerelease as latest.
- A failed upload leaves a draft. Retrying replaces draft assets only. Completed-release
  reruns do not mutate assets or tags or re-promote older releases; ZIP byte equality is
  not required on reruns because timestamps and reinstalled Python dependencies can vary.
  The deterministic update.json digest still must match. Missing/different remote digests
  fail closed; first hosted run must verify GitHub's digest response contract.
- After successful complete publication, and only if this is still latest, advance an
  orphan `updates` branch containing **only update.json**. Existing history is pinned to
  its read SHA, checked again before a non-forcing fast-forward, then read back. Older,
  conflicting equal-version, or concurrently moved manifests are rejected. A manifest
  failure leaves the previous update feed intact; retry the same run/version to repair.
  This is a two-stage release/feed transition, not a cross-resource atomic transaction.
- The client now reads the renderer-CORS-compatible
  `https://raw.githubusercontent.com/lixia88725/storyboard-flow/updates/update.json`.
  The release also includes the manifest asset, but the renderer does not fetch through
  GitHub's release redirect. No changes to update notice, download, or app-shell behavior.

## Versions and migration

The historical floor supplied by the parent is **v0.1.30**. Main/infra automatic versions
are deterministic `0.1.(30 + github.run_number)`; a reset run number of 1 therefore yields
0.1.31. Every public version must exceed the legacy floor and existing stable versions.
Reruns use the same automatic version and exact commit. Manual numeric versions/tags are
supported, but choosing a manual version above the automatic sequence makes subsequent
lower automatic versions fail safely: use an explicitly higher main-only dispatch or
review/update the automatic version policy rather than deleting tags or forcing latest.
Invalid/non-numeric existing stable release tags also fail closed and require inspection.

## Packages and licenses

Existing portable ZIP recipes, embedded Windows Python selection, macOS ad-hoc signing,
and TIFF resource preparation remain. Minimal additions copy project MIT LICENSE into
packaged `resources/app/LICENSE`, declare the project's package license, and explicitly
retain Electron/Chromium notices in the macOS Resources directory (the app-only copy
would otherwise omit distribution-root Chromium notices). Whole copied native/Python
packages retain their upstream README/licensing tables, LICENSE files and dist-info.
The validator inspects real ZIP contents without extracting/executing them, including
project LICENSE bytes, version, runtime/preload, Python runtime on Windows, TIFF deps,
Electron/Chromium notices and the macOS libvips LGPLv3 licensing table.

**MIT applies to Storyboard Flow code, not dependencies.** Preserving upstream notices
is not an exhaustive redistribution-compliance audit, source-offer/relinking assessment,
or a claim that LGPL libraries have become MIT. Paid signing/notarization is not added.

## Self-verification evidence

The final runtime candidate's cloud run linked above succeeded on all required
preparation gates. Windows x64 and Mac arm64 ZIPs were really built, checked and
uploaded, not simulated. These artifacts contain the older product baseline and
are verification artifacts, **not a new product release**. They expire after 14 days.
The earlier Windows ZIP-selection defect counted embedded Python ZIPs as release
outputs; two regression checks reproduced this, and the corrected selector keeps
duplicate/wrong-platform rejection. Six Python fixture checks and 14 focused
Vitest tests passed locally. The hosted full suite passed on this corrected source.

Independent Reviewer session `20261009_223922_9f1c8e` reviewed the complete runtime
diff plus incremental fixes. No unresolved fatal/major new implementation defect
or mandatory code repair was found. Reviewer approved continuing gated preparation
and recommended merge conditional on final cloud success and a real PR check.
This is independent static review, not real release/API/GUI acceptance.

First hosted run `37945612058` at `099cdb20e0b48f8a22427e4500abcf88f2cd47e7`
failed on Ubuntu: two unchanged baseline assertions assumed macOS shortcut labels
and macOS native image rounding (900 tests passed, 2 failed). The same two files
passed all 26 tests on local macOS. The workflow now restores the original full-suite
macOS runner; no product code or assertions were weakened. Linux is not a supported
delivery platform for this task. Windows native packaging remains independently required.

Final local evidence is under `node_modules/.cache/repository-verification/` in this
isolated worktree (ignored execution logs, not public repository material).
Environment: macOS arm64, Node 26.8.2, local system Python 3.9; hosted workflow pins
Node 22 and Python 3.12, so local verification is not hosted-run equivalence.

| Command/check | Exit | Observation |
| --- | ---: | --- |
| `npm ci` | 0 | Isolated node_modules, no symlink to active worktree. npm blocked package lifecycle scripts; reported 23 dependency vulnerabilities (1 low, 6 moderate, 12 high, 4 critical). No automatic dependency changes. |
| Focused Vitest (`repositoryRelease`, `repositoryWorkflow`, `appAppRuntime`) | 0 | 3 files, 14 tests; includes 4 Python ZIP fixture tests via the real validator. `focused.log`. |
| `npm test` | 1 | 181 files passed, 897 tests passed; 2 suites could not load Electron: `deletedShotFiles`, `recentFoldersAppRuntime`. `test.log`. **Full-suite gate is BLOCKED, not passed.** |
| `npm run typecheck` | 0 | Both TS targets. `typecheck.log`. |
| `npm run build` | 0 | Renderer and Electron builds; existing chunk-size warning. `build.log`. |
| `npm run check:preload` | 0 | APIs in sync. `preload.log`. |
| `npm run prepare:package-resources` | 0 | Real isolated TIFF dependencies copied. `resources.log`. |
| `npm run package:macos` | 1 | Build/resources passed; actual packaging blocked by missing `node_modules/electron/dist/Electron.app`. `macos-package.log`. |
| Ruby Psych parse of workflow | 0 | YAML syntax parsed. `yaml.log`; actionlint unavailable and not installed. |
| `git diff --check`, Node syntax check | 0 | No whitespace / release-helper syntax errors. `diff.log`. |

Runtime helper RED evidence was observed before implementation at module admission;
subsequent failing assertions preceded adding update-feed advancement, non-deterministic
ZIP-rerun handling and exact/annotated tag-ref resolution. Existing shell behavior tests
were preserved; the URL-default test is a protection test, not a claimed red-first cycle.
Static workflow assertions are contract checks, not an Actions execution emulator.
Transport tests use a fake GitHub fetch boundary; no remote publication was executed.
Generated ZIP fixtures prove the validator's success/failure rules, not real packaging.

`node node_modules/electron/install.js` exited 0 without a complete binary; an isolated
`@electron/get` retry timed out (exit 124). A direct official GitHub ZIP curl retry timed
out (exit 28, only part of the 103 MiB runtime downloaded). The incomplete owned ZIP
was removed. No fake executable/path file was supplied to make tests green. Python
install succeeded to the isolated vendor target; pip printed unrelated global dependency
resolver warnings. No global Python or npm/Hermes configuration was changed.

The preceding local table records earlier attempts, not the final cloud status.
Cloud execution closes the local Electron-download blocker for the matching candidate;
it does not repair or conceal the failed local attempts. Windows/Mac real user flows,
first Release API/digests/retries, updates-branch writes, public renderer fetch and
binary redistribution compliance remain first-new-version checks. Preparation is
not whole-product or Windows GUI acceptance. PR/fork event separation has static
evidence; an actual fork contribution has not been executed.

## Receiving-session checklist

1. Read the task PR/final handoff for the exact merged infrastructure commit. Main
   is advanced remotely without editing the active local main worktree. Fetch origin
   and inspect your current dirty state before integration; never force-push an old
   local main, blindly pull into mixed changes, stash/reset/clean, or copy whole old
   files over new code. Integrate only the approved infrastructure diff. In particular,
   preserve newer `package.json`, README and `appAppRuntime` behavior while retaining
   MIT metadata, update URL, package-notice additions and CI wiring. Worktree isolation
   does not isolate shared Git refs. Resolve any overlap deliberately.
2. Keep `RELEASE_ENABLED=false` while preparing the new product. New-code PRs must pass
   the `test` check (full tests/build/preload). Main pushes also build both ZIPs while
   publication is disabled. Do not require the intentionally skipped PR package/publish
   jobs as branch-protection checks. Reuse prior evidence only for unchanged inputs.
3. Finish the new-product full suite, GUI/manual checks and actual Windows/Mac acquisition
   and startup; inspect binary redistribution obligations for bundled dependencies.
   Current prepared packages prove packaging only, not the other session's new product.
4. Only after explicit authorization for the verified new product, set `RELEASE_ENABLED`
   to exactly `true`; a subsequent **new-code main push automatically publishes** after
   gates and both packages. Alternatively use validated main-only manual version dispatch.
   Enabling before old-baseline main pushes/reruns risks publishing old code.
5. Read back the exact tag/commit, complete non-draft release, three assets, latest marker,
   and updates branch; fetch the raw manifest from a packaged renderer and exercise the
   Download notice on both platforms. Verify URLs and versions before any old-repo deletion.
6. The user says the only old user is himself and explicitly accepts breaking old
   update/download links; no compatibility transition is required. Still preserve
   needed old data/assets and verify the first real new-version release/feed before
   deleting `storyboard-flow-releases`. Existing Git bundle backup is at
   `/Users/pikachu/Developer/.backups-storyboard-repository/storyboard-flow-releases.bundle`;
   Git bundles do not include Release ZIPs. Do not move old release-info tags into
   source main as if they identified source commits.
