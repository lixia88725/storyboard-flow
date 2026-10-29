# Storyboard Flow developer rules

## Active refactor authority — 2026-10-29

The user approved a new-format refactor without compatibility for existing test projects,
local baseline/implementation commits and coordinator integration, and Hermes-owned worktrees.
Start this work at `docs/refactor/README.md` and its contract/testing pointers. The original main
checkout is coordinator-owned. Historical handoff/todo files remain evidence for the existing
runtime, not a task list for the refactor. Wave 1 adds isolated cores only; production wiring,
legacy safety removal, dependency installation, SQLite/PSD work and publication are outside it.
Preserve existing files and the latest launch scripts. This paragraph supersedes old-format
compatibility requirements only for the explicitly isolated new-format cores; remaining file,
test-fixture and execution safeguards below still apply to existing code and data.

## Project and naming

Storyboard Flow is a local-first Electron desktop app for arranging storyboard images, moving dialogue between shots, drawing edits, and managing lightweight storyboard layers.

The user approved complete naming unification on 2026-10-29. Use `Storyboard Flow` for the product, `Flow`/`flow` for code identifiers, and `FLOW_*` for environment variables. Current data uses `.storyboard-flow`, managed child projects use `.storyboard-flow-project`, and the standalone new core uses `.storyboard-flow/checkpoints`. TIFF uses `app: "Storyboard Flow"`, `format: "flow-tiff"` and the `flow:metadata` XMP tag. See `docs/architecture/NAMING.md` for exact scopes. Existing old-format folders are retained without migration; historical reports preserve their original names and evidence. This explicit approval supersedes the previous internal-name compatibility rule; it does not authorize changing personal files or deleting recovery data.

## Context and authorization

Read this file, `context-handoff.md`, and `todo.md` first. Read relevant sections of `docs/architecture/SYSTEM.md` and `decisions.md` for the task. Documentation describes behavior, not new permission. Other machines need not have workstation-specific rules or tools. Check applicable local rules and task authorization explicitly.

Check Git/worktree status before editing and preserve existing work. Use an isolated worktree for concurrent changes. Do not reset or stash someone else's work. Read definitions and callers before changing contracts. Existing safety boundaries and approved scope take precedence over old notes; seek a decision on material conflicts rather than silently changing requirements.

## Stack and routing

- Electron main/preload; React + TypeScript + Vite renderer; dnd-kit drag behavior; Canvas/react-konva drawing; sharp TIFF/PNG processing; Python TIFF/native permission helpers; Vitest tests.
- Current drawing data is bitmap-layer based: `shots[].layers`, with PNGs under `.storyboard-flow/layers/{shotId}/{layerId}.png`. Legacy `sketchLayers` and `imageLayerEdits` are migration inputs, not primary editing data.
- Project ordering, dialogue, rename plans, layer metadata/locks and FLOW import status: start at `src/shared/projectOps.ts` and its tests.
- Renderer behavior belongs in focused controllers/helpers. Keep canvas work in `SketchPad.tsx` and its controllers; layer selection/merge/visibility/drag/opacity in `LayerPanel.tsx` and shared rules. Avoid adding orchestration inline to `App.tsx`.
- High-risk Save/Import/TIFF orchestration remains in `electron/main/main.ts`; isolated IPC/read-side/runtime work goes in focused main services and runtimes with tests.
- Preload changes update `electron/preload/preload.ts`, `electron/preload/preload.cjs` and `src/renderer/global.d.ts` together.
- Cross-boundary changes require real connected checks. Inspect `scripts/electron-bitmap-smoke.mjs` before executing; it is not automatically safe for personal userData, Trash or clipboard.
- Option/Alt drag copy is retired; normal drag moves/sorts. Do not reintroduce copy-on-drag without an explicit product decision.
- Built-in AI generation/provider/candidate UI is retired. Do not recreate it as part of unrelated work. Ordinary Pending remains supported.

## File and data safety

Preserve user files unless an explicit user action requires changing them. Keep V1 Project/Shot/Dialogue/BitmapLayer and naming metadata understandable and local-first. Use two-stage renaming for working image filenames.

Save is the operation for synchronizing real filenames and writing working TIFF pixels. Do not auto-rename real images during autosave. Existing explicitly approved Create/Import/Pending materialization paths remain exceptions described in the architecture; this does not grant new write paths.

Storyboard deletion remains pending app state until Save; deleted root images go to system Trash, not Archive. Parked shots stay in JSON but do not participate in Save output, filename sync, Timeline or `storyboard-script.md`.

Do not treat `.storyboard-flow` assets as root image shots. Keep failures, recovery objects, History, custody pins and old assets intact. Unknown native restrictions must refuse safely rather than widening permissions. Recovery copies are non-executable; do not OS-open them. The default per-workspace recovery budget is 8GiB across actual/reserved partitions; reject new spending rather than automatically deleting recovery data. Do not turn a retained failure or cleanup into successful Save ACK. In-flight effects must settle; timeout is not cancellation.

No SQLite, PDF export, cloud sync/collaboration, PSD-first workflow, Photoshop full-fidelity round-trip or format migration without separate approval. Do not install dependencies, access real media/credentials, change global configuration, terminate unrelated processes, commit, push, merge, publish or deploy merely because a script is available. These actions need appropriate task authority. Never place API keys in project files.

## Tests and completion

Use focused regression tests for behavior changes; keep necessary assertions. Run the complete allowed suite and `npm run build` before claiming an implementation complete. The build includes both renderer and Electron typechecks; retain the full log rather than mechanically repeating identical typecheck evidence. Vite-only or build:electron is insufficient.

Commands (installation and execution still require task authorization):

```sh
npm ci
npm run dev
npm run test
npm run typecheck
npm run build
npm run check:preload
npm run prepare:package-resources
npm run smoke:bitmap
```

`src/renderer/normalSaveMetadataHistory.test.ts` is not certified input: do not read, copy, hash, execute or publish it. Only certified fixtures may be used. `vitest.config.ts` explicitly excludes that path, and it is not distributed in the source candidate. Use the approved enumerated suite for restricted verification; do not broaden input discovery to unapproved fixtures.

Run `check:preload` for preload changes. Packaging resource changes require `prepare:package-resources` with pre-existing compatible dependencies; do not silently install them. Build before smoke:bitmap because it uses dist/dist-electron. Preserve smoke scenarios when adding focused coverage. For UI changes verify the actual workflow and protected nearby paths when feasible; mark untested GUI behavior TODO: verify. Test doubles or green unit tests do not prove real GUI, platform, cross-machine or installer behavior.

Report implemented, self-tested, independently accepted and published states separately. Use independent review according to risk; self-tests are not independent acceptance. Missing required behavior evidence prevents an overall PASS. Keep exact candidate identity, commands, raw results, skips, failure boundaries and owned-resource cleanup in the task handoff. Do not delete assertions or shrink approved requirements to get green.
