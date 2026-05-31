# Package Resources Packager Audit

Date: 2026-05-31

## Goal

Decide whether Storyboard Workbench can wire Photoshop TIFF Python dependencies into a packaged app now.

This audit does not add a packager, installer, or distribution workflow. It verifies the existing package resource preparation path and records the missing integration point.

## Current State

- There is no `electron-builder`, `electron-forge`, or `electron-packager` dependency in `package.json`.
- There is no current `package`, `make`, `dist`, or installer script.
- `npm run prepare:package-resources` exists and runs `npm run build:electron` before copying resources.
- `preparePackageResources()` copies populated `vendor/python/photoshop-tiff` to `dist-resources/python-deps/photoshop-tiff`.
- Runtime dependency resolution already prefers `process.resourcesPath/python-deps/photoshop-tiff` before development `vendor/python/photoshop-tiff`.
- `dist-resources/` is intentionally git-ignored because it is generated output.

## Verified Today

```bash
npm run prepare:package-resources
# passed; copied vendor/python/photoshop-tiff to dist-resources/python-deps/photoshop-tiff

npm run test -- electron/main/packageResources.test.ts electron/main/photoshopTiffDeps.test.ts
# passed: 2 test files, 6 tests
```

## What Is Already Done

- Development dependency install target is defined: `vendor/python/photoshop-tiff`.
- Package resource staging target is defined: `dist-resources/python-deps/photoshop-tiff`.
- Runtime lookup order supports packaged resources:
  1. `SWB_PYTHON_DEPS_DIR`
  2. `process.resourcesPath/python-deps/photoshop-tiff`
  3. app path `vendor/python/photoshop-tiff`
  4. legacy spike fallback
- Unit tests cover resource preparation and runtime lookup priority.
- README and AGENTS already tell future packagers to include `dist-resources` at packaged app resources root.

## Missing Piece

Full packager integration is not present because the repo has not chosen a packaging tool.

The missing future config is tool-specific:

- electron-builder: include `dist-resources/**` through `extraResources`, preserving its contents at resources root.
- electron-forge: add the equivalent extra resource copy hook/config for the chosen maker.
- electron-packager: pass equivalent extra resource options.

The required final packaged layout is:

```text
<packaged app resources>/
  python-deps/
    photoshop-tiff/
      psdtags/
      tifffile/
      imagecodecs/
      numpy/
```

This must not become:

```text
<packaged app resources>/
  dist-resources/
    python-deps/
      photoshop-tiff/
```

because runtime lookup expects `process.resourcesPath/python-deps/photoshop-tiff`.

## Recommendation

Do not add a packager dependency or installer config now.

The repo is still using direct Electron/Vite scripts, and adding a packaging tool would be a new distribution decision rather than a small maintenance cleanup. The resource preparation and runtime lookup sides are already ready and verified.

When distribution work starts, choose the packaging tool first, then wire this exact generated directory into that tool's resources root.

## Follow-up Criteria

Implement full packager integration when at least one of these is true:

- the project chooses electron-builder, electron-forge, or another specific packager
- a packaged app build is needed for dogfood outside the development checkout
- Photoshop layered TIFF import/export must work without `vendor/python/photoshop-tiff`
- CI needs to produce distributable macOS app artifacts

Until then, keep `npm run prepare:package-resources` as the verified handoff point.
