# Vite Chunk Warning Audit

Date: 2026-05-31

## Goal

Decide whether to add code splitting, manual chunks, or a larger Vite chunk warning limit now.

This audit is behavior-preserving. It does not change `vite.config.ts`, renderer imports, runtime behavior, or packaging output.

## Current Build Result

Fresh command:

```bash
npm run build
```

Result:

- passed
- renderer modules transformed: 187
- CSS bundle: `27.69 kB`, gzip `6.16 kB`
- JS bundle: `649.71 kB`, gzip `199.62 kB`
- Vite warning: one chunk is larger than the default `500 kB` minified threshold

The warning is real, but the bundle is still under 200 kB gzip and the build completes quickly.

## Current Shape

- `vite.config.ts` has no `manualChunks` and no custom `chunkSizeWarningLimit`.
- The renderer has a single app entry in `src/renderer/main.tsx`.
- `App.tsx` is still the dominant renderer file at about 3800 lines.
- Primary always-loaded dependencies are React/ReactDOM, Konva/react-konva, and dnd-kit.
- Konva is part of the main storyboard editing surface, not an optional late feature.
- dnd-kit is used for shot/dialogue/layer interactions in the main workbench.

## Options Considered

### Option 1: Add `manualChunks` for vendor libraries

Pros:

- Removes or reduces the visible Vite warning.
- Separates app code from third-party code in output files.

Cons:

- Does not automatically reduce total bytes or startup work.
- In an Electron local file context, extra chunks can add request/loader complexity without a proven speed win.
- Chunk boundaries may become another config detail contributors need to maintain.
- Current heavy dependencies are mostly used in the main first-screen workbench.

### Option 2: Add dynamic imports for optional UI areas

Pros:

- Can reduce initial JS if large non-critical areas are truly optional.
- Better long-term path than arbitrary vendor chunking.

Cons:

- Requires component boundaries that are not fully clean yet.
- `SketchPad`/Konva is first-screen behavior for visible shot cards, so lazy-loading it would affect perceived editor readiness.
- Shortcut editor, Animation mode, or LayerPanel could be future candidates, but each needs behavior tests and smoke updates.

### Option 3: Raise `chunkSizeWarningLimit`

Pros:

- Removes warning noise with a tiny config change.

Cons:

- Hides the signal without improving startup or maintainability.
- Makes future growth less visible.
- Does not match the project goal of cleaner, faster, safer code.

### Option 4: Keep warning visible and revisit with a measured startup target

Pros:

- Preserves a useful warning as a size budget signal.
- Avoids config churn that does not improve user behavior.
- Keeps future splitting tied to real boundaries and measured startup/interaction cost.

Cons:

- Build output remains noisy until a real split or budget decision is made.

## Recommendation

Do not add manual chunks or raise `chunkSizeWarningLimit` now.

The current warning is modest: one renderer chunk at `649.71 kB` minified and `199.62 kB` gzip. The obvious split candidates are not yet cleanly optional, and arbitrary vendor splitting would mostly rearrange bytes without proving a faster startup.

Keep the warning as a useful budget signal. Revisit when there is measured startup pain, a packaged-app load target, or a clear optional boundary.

## Better Future Split Candidates

If startup becomes a real issue, investigate these in order:

- shortcut editor UI, because it is menu-driven and not part of normal first paint
- Animation-mode-only UI, if it can split without delaying normal storyboard editing
- LayerPanel internals, only if opening a layer drawer can tolerate lazy loading
- deeper `App.tsx` extraction after dedicated planning, not as opportunistic chunk work

Any future split should be verified with:

- `npm run build`
- `npm run smoke:bitmap`
- a before/after startup measurement in Electron, not just bundle size

## Follow-up Criteria

Revisit this only if one of these happens:

- packaged app startup feels slow in real dogfood
- the renderer JS chunk grows substantially beyond the current size
- a contributor adds a large optional dependency
- build warning noise starts hiding more important warnings
- the team defines a concrete startup or bundle budget
