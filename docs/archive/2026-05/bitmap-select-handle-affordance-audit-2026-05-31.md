# Bitmap Select Handle Affordance Audit

Date: 2026-05-31

## Goal

Decide whether bitmap Select corner scaling needs an immediate visual or cursor affordance change.

This audit is behavior-preserving. It does not change bitmap Select rendering, pointer handling, layer pixels, or Save output.

## Current Behavior

- Bitmap Select supports lasso/rectangle selection, moving the selected pixels, and corner scaling.
- The active selection draws an SVG outline, bounds rectangle, and four 8px square corner handles.
- The visible selection overlay has `pointer-events: none`; actual pointer input is handled by the image stage.
- Hit testing uses `bitmapSelectionHitTarget()` and checks corner handles before inside-bounds move.
- `bitmapSelectionHandleRadiusForStage()` expands the canvas-space handle radius when a large canvas is displayed smaller.
- Existing unit coverage confirms a 2581x1080 canvas displayed at 430x180 gets a roughly 72px canvas-space hit radius from a 12px screen target.

## Dogfood Signal

TEST2 high-resolution bitmap Select dogfood passed on a 1920x1080 paint layer:

- lasso move changed the layer PNG
- rectangle corner scale changed the layer PNG
- Save wrote the dirty shot TIFF
- project/root counts stayed stable
- no blank or misplaced stage rendering was found

This means the current enlarged hit target works in the covered real-folder path.

## Options Considered

### Option 1: Add CSS cursor to `.bitmap-selection-handle`

Pros:

- Small change.
- Makes the visible handle style look more interactive in CSS.

Cons:

- Misleading in the current implementation because `.bitmap-selection-overlay` has `pointer-events: none`.
- The cursor would not reliably reflect the actual stage-level hit target.
- Risks documenting a false affordance rather than improving interaction.

### Option 2: Add stage-level cursor calculation now

Pros:

- Could make scaling more discoverable without adding persistent UI.
- Can use the same `bitmapSelectionHitTarget()` and expanded radius as the real transform path.

Cons:

- Requires touching `SketchPad` pointer movement behavior.
- Needs careful handling across brush, eraser, Select draft, transform draft, locked layers, and active-layer state.
- Adds more interaction surface without a repeated user failure yet.

### Option 3: Keep current behavior and document the real next step

Pros:

- Preserves the tested bitmap Select baseline.
- Avoids a no-op CSS cursor change.
- Keeps the future implementation path clear if users still miss scaling.

Cons:

- Users may still need to learn that corner handles scale.

## Recommendation

Do not change bitmap Select handle affordance now.

The real hit target has already been enlarged and the TEST2 high-resolution path passed. A CSS-only cursor change would be the wrong layer because the visible SVG overlay is not the pointer target.

If real users still miss corner scaling, implement a true stage-level cursor affordance:

- On image-stage pointer move while bitmap Select is active and a selection exists, convert the client point to sketch coordinates.
- Use `bitmapSelectionHitTarget()` with the same `bitmapSelectionHandleRadiusForStage()` radius used by transforms.
- Show corner-specific resize cursors for scale hits, `move` for inside-bounds hits, and the normal stage cursor otherwise.
- Cover the helper mapping with a small unit test, and add smoke coverage only if the renderer behavior proves brittle.

## Follow-up Criteria

Revisit this only if dogfood or user sessions show at least one of:

- users repeatedly fail to find corner scaling
- users try dragging the visible handles but cannot predict where the hit target starts
- users confuse move and scale because the stage cursor gives no feedback
- scaling works technically but feels hidden during real storyboard cleanup

Until then, keep bitmap Select behavior unchanged.
