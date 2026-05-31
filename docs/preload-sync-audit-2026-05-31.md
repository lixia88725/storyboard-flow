# Preload Sync Audit

Date: 2026-05-31

## Goal

Decide whether `electron/preload/preload.cjs` should continue to be manually maintained or generated from `electron/preload/preload.ts`.

## Current Shape

- `preload.ts` is the typed source used by TypeScript.
- `preload.cjs` is the CommonJS preload loaded by Electron at runtime.
- `npm run check:preload` compares:
  - exposed API keys
  - IPC channels used by `invoke`, `on`, and `removeListener`
- `electron/preload/preloadSync.test.ts` runs the same script in Vitest.

## Finding

The existing check is useful but slightly too weak. It catches missing API methods and channel drift, but it does not compare API method parameter lists.

Example risk: `createBlankShot(folderPath, options)` could drift to one argument in one preload file while still keeping the same API key and IPC channel.

## Recommendation

Keep manual `preload.cjs` maintenance for now, but strengthen `check:preload` to also compare exposed method parameter names/counts.

Do not introduce a generation pipeline yet. A generator would add build complexity for a small preload surface, and the current explicit CJS file is easy to inspect. With stronger sync checking, manual maintenance remains acceptable.

## Follow-up

If the preload surface grows substantially, revisit generation from a single source.
