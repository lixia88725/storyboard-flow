# Context Handoff

跨 session 接手页。稳定规则见 `AGENTS.md`，长期架构见 `decisions.md`，待办见 `todo.md`。

## Current State

- Workspace: `/Users/xiali/Documents/Codex/2026-05-28/users-xiali-documents-codex-2026-05/appshot-bitmap-layers`
- Branch: `main`
- Handoff date: 2026-07-31
- Baseline before this handoff commit: `00e7021 Refine storyboard editing workflows and bitmap layer handling`
- Remote state before this handoff commit: `origin/main...HEAD = 0 0`; this handoff commit will therefore leave local `main` one commit ahead until manually pushed.
- Product name: `Storyboard Flow`. `Storyboard Workbench` remains legacy/internal compatibility only.

## Must Preserve

- One local image folder is one scene.
- Main data lives in `.storyboard-workbench/storyboard.project.json`.
- Editable layer pixels live in `.storyboard-workbench/layers/{shotId}/{layerId}.png`.
- Autosave writes metadata only; Save owns final TIFF pixels and filename synchronization.
- AI output remains candidate-first and additive. Apply adds an `AI Draft` bitmap layer and keeps the Pending candidate.
- Pending material is user-visible in project-root `Pending/`; `Archive/` remains Import backup storage.
- Parked shots remain in project JSON but stay out of Save output, filename sync, Timeline, and `storyboard-script.md` until restored.
- Do not migrate `.storyboard-workbench`, `SWB`, `swb-*`, or `storyboard-workbench.local` without a separate format-migration plan.

## Completed In This Session

- AI generation no longer loses earlier results when the AI panel closes, selection changes, or the project reopens:
  - valid historical candidates are recovered from disk;
  - repeated single, Retry, and batch generations append instead of replacing earlier candidates;
  - corrupt metadata or missing PNG files are skipped without crashing or silently deleting files.
- AI and manually parked material now share the visible project-root `Pending/` workspace:
  - AI PNGs remain paired with internal metadata under `.storyboard-workbench/ai-candidates/`;
  - manually parked storyboards keep their full shot metadata in `project.parkedShots`;
  - old hidden candidates and legacy parked paths migrate into visible Pending.
- Pending sidebar now separates AI Generated candidates from parked storyboards and reports the combined count. AI cards show origin and generation time and remain newest-first.
- AI candidates can be dragged into either standard or Japanese storyboard views, including before, after, and empty-board positions. A successful drop creates and selects a new shot and removes the candidate; a failed conversion preserves both project state and candidate.
- Pending file moves are recoverable transactions:
  - `.storyboard-workbench/pending-file-transaction.json` records the intended move;
  - project JSON is persisted before the transaction is committed;
  - opening the project reconciles an interrupted move against project JSON.
- AI promotion treats the root TIFF as provisional until shot and bitmap-layer initialization finish; failures remove the provisional TIFF and leave the candidate available.
- Async candidate refresh ignores stale responses, so switching projects cannot show or save candidates from the previous folder.
- External-change tracking follows manually parked TIFFs in `Pending/`, while known app-owned file moves do not create false Import warnings.
- Added focused unit and Electron smoke coverage for candidate recovery, discard, drag insertion, conversion rollback, Pending transactions, project reopening, and both storyboard views.

## Verification On 2026-07-31

```bash
npm run test
# passed: 181 test files, 889 tests

npm run typecheck
# passed

npm run check:preload
# passed: preload APIs are in sync

npm run build
# passed; only the known non-blocking Vite chunk-size warning remains

npm run smoke:bitmap
# passed, including visible Pending parking/restoration, AI candidate drops in
# standard and Japanese views, reopen persistence, and zero orphan layer assets
```

There is no `lint` script in `package.json`, so lint was skipped.

The bitmap smoke intentionally exercises a Save-conflict path and therefore logs `Temporary rename file already exists`. Electron may also log `Object has been destroyed` while the successful smoke process is shutting down. Both appeared in this passing run; all smoke assertions completed and the process exited with code 0.

## Deferred Boundary And Known Limits

- The user explicitly deferred the review concern “Pending 不改写 TIFF”. Manual parking currently materializes current bitmap layers into a TIFF before moving it into `Pending/`. Do not change this behavior without a separate product decision, even though the broad Save-only wording elsewhere should eventually be reconciled with this explicit Pending exception.
- Finder/Bridge pixel edits to parked TIFFs are supported. External rename or move of Pending files is still unsupported.
- Successful AI drag is a move: the candidate disappears from Pending after the new shot is committed. Apply is different and intentionally keeps the candidate.
- Real provider and dnd-kit interaction still need hands-on dogfood; unit tests and Electron smoke cover the automated paths.

## Next Work

1. Manually generate several candidates with OpenAI, Seedream, and ComfyUI; switch shots, sidebars, focus, and reopen the project, then confirm every successful result remains in Pending.
2. Open `Pending/` in Finder or Bridge, edit parked TIFF pixels externally, and restore them into both standard and Japanese storyboard views.
3. Drag AI candidates before/after shots and into an empty board in both views; confirm successful drops remove only that candidate and failed drops leave the project untouched.
4. Test force-quit recovery around a manual park/restore transaction on a disposable project.
5. If this commit is pushed, verify the GitHub Actions tester release and packaged macOS/Windows artifacts.

Start the next session by reading `AGENTS.md`, `decisions.md`, this file, `todo.md`, and `README.md`, then inspect `git status` and `git log -1` before changing code.
