# Drawing lane — open contract questions

None of these blocked wave-1 work: each has an implemented default, stated below with its evidence
and impact, so the coordinator can accept or reverse it with a one-line change. Everything here is
confined to `src/core/drawing/**`.

## Q1. Locked-layer property edits: explicit `locked` failure or silent no-op?

Legacy `projectOps.updateBitmapLayer` silently ignored `name`/`opacity`/`blendMode` patches on a
locked layer and still returned a "successful" project. CONTRACTS.md only mandates refusal for pixel
replacement and removal, and asks us to inspect existing rules and document the preserved policy.

**Implemented:** the *policy* is preserved (a locked layer's name, opacity and blend mode cannot
change) but the *outcome* is an explicit `locked` failure, because a silent drop makes a refused edit
indistinguishable from an accepted one. Visibility and the lock toggle stay editable, as in legacy.
A mixed patch on a locked layer fails atomically — nothing is applied.

**Impact if reversed:** one branch in `applyImageEdit` (`setLayer` case) plus two tests.

## Q2. May a locked layer be reordered?

CONTRACTS.md mandates lock refusal only for pixel replacement and removal. Legacy blocks it in the UI
(`LayerPanel.tsx:200` refuses the drag gesture for a locked row and filters locked ids out of
`movableLayerIds`), so the user-facing rule is "locked layers cannot be dragged".

**Implemented:** `moveLayer` on a locked layer returns `locked`. A locked layer moved onto its own
current index is still a no-op, not a failure.

**Impact if reversed:** delete the lock check in the `moveLayer` case.

## Q3. Late-binding lock: may one edit unlock and rename?

A patch `{ locked: false, name: "X" }` on a locked layer is ambiguous: legacy evaluated fields against
the *pre-edit* lock, so the rename was dropped while the unlock applied.

**Implemented:** the lock guard reads the input layer, so the whole edit fails with `locked`; the
caller unlocks, then renames. This keeps edits atomic and avoids order-dependent patch semantics.

## Q4. Out-of-range opacity: clamp or reject?

Legacy clamped (`Math.min(1, Math.max(0, …))`); CONTRACTS.md says opacity is finite in `[0,1]` and that
invalid values return `invalid-input`.

**Implemented:** rejected, for `setLayer` and for inserted layers. NaN and ±Infinity are rejected too.
**Impact:** any future slider or script that sends `1.2` must clamp itself; the GUI sliders already do.

## Q5. How strict should unknown-field handling be?

CONTRACTS.md: unsupported fields must not be silently lost, and no speculative metadata bag.

**Implemented:** unknown keys are rejected with `invalid-input` on the document, on any layer, on a
`setLayer` patch, and on the edit object itself. This is the strict reading; if wave 2 adds fields
(mask, matte metadata, per-layer offsets), this validator must be extended in the same change that
adds them, otherwise those callers get `invalid-input`.

## Q6. Kind and overlay ordering

Two legacy rules have no V1 equivalent: `electron/main/bitmapLayerOrdering.ts` sorts `image` layers
below `paint` layers, and `projectOps.normalizeBitmapLayerOrder` pins `layer-matte-overlay` /
`layer-dialogue-overlay` to the top and renumbers `order`.

**Implemented:** neither. CONTRACTS.md makes array order authoritative, so `applyImageEdit` never
reorders by `kind` or by reserved id, and `insertLayer` places the layer exactly where the caller says.
**Question for integration:** confirm that matte/dialogue overlay pinning becomes an explicit call-site
ordering rule (or disappears as a concept), and that "image layer always at the bottom" is dropped.

## Q7. Where does `activeLayerId` live?

`Shot.activeLayerId` is a UI selection concept with no field in `ImageDocumentV1`, and no field was
proposed. `LayerPanel.tsx`, `ShotCard.tsx`, painting and the transform tools all read it.

**Implemented:** nothing — `applyImageEdit` does not model selection.
**Question:** should the active layer be project/shot-level UI state (storyboard lane) or a new
coordinated field in the shared types? Until this is answered, metadata wiring cannot fully replace
`updateBitmapLayer` call sites, because removing the active layer must also move the selection.

## Q8. Should `validateImageDocument` be shared?

The storyboard lane must reject a stale or fabricated `ImageEditResultV1` (`result.before` must match
the installed image, `result.after` must be valid for that ID and revision).

**Implemented:** the validator is private to `src/core/drawing` and only `applyImageEdit` is exported
(a test asserts the module exports exactly that one symbol). If the storyboard lane needs the same
validation, the smallest amendment is to promote `validateImageDocument` from
`src/core/drawing/validation.ts` into a coordinator-owned shared export — I did not invent that export
unilaterally.

## Q9. Result ownership: full clone vs. structural sharing

CONTRACTS.md allows `after` to share unchanged immutable data "where safe", but TASK.md also requires
that mutating a newly returned structure cannot corrupt the input.

**Implemented:** a changed edit returns a fully cloned document — new document object, new layer array
and a new object per layer. No layer object is shared with the input. A no-op or failure returns the
supplied document as both `before` and `after` (identity, not a copy), so callers can detect "nothing
happened" cheaply.

**Cost:** O(layer count) per edit — measured at 13 µs/edit for 5 layers and 44 µs/edit for 100 layers
(`workload.test.ts`). If structural sharing is later preferred, the mutation-isolation test must be
relaxed at the same time, deliberately.

## Q10. Very large revisions

`revision` is a nonnegative safe integer; a change that would advance past `Number.MAX_SAFE_INTEGER`
is refused with `invalid-input` instead of silently producing an unsafe integer. The refusal is
evaluated only when an increment is actually needed, so at the maximum revision no-ops (identical
values, empty patch, move-to-current, same asset) still return `changed:false` with the same
`before`/`after`. Purely defensive; no caller is near it. (Corrected after review item D2.)
