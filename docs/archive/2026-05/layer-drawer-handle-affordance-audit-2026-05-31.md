# Layer Drawer Handle Affordance Audit

Date: 2026-05-31

## Goal

Decide whether the layer drawer handle needs an immediate hover, cursor, icon, or click-target change.

This audit is behavior-preserving. It does not change `LayerPanel`, drawer layout, pointer handling, or smoke expectations.

## Current Behavior

- The layer drawer opens and closes through a real `<button>` with `aria-label="Toggle shot layers"` and `aria-expanded`.
- The button is intentionally empty; the visible mark is a quiet vertical pill drawn with `.layer-toggle::before`.
- The global button style already provides `cursor: pointer` and a hover background.
- The closed handle is narrow, with `min-width: 0.78em` and `min-height: 3.15em`.
- When the panel is open, the handle remains attached to the right edge of the open layer panel.
- `npm run smoke:bitmap` already checks the drawer opens, the toggle is empty, vertical, attached to the panel, and bottom-aligned with the image stage.

## Existing Audit Signal

The pointer-drag prototype in `docs/layer-drawer-pointer-drag-prototype-2026-05-31.md` found:

- the current quiet handle works as a click target
- the handle is too narrow for a dependable drag gesture
- making it much wider starts to read as a louder persistent side tab
- click-toggle has lower mental load than drag-to-open

That prototype argues against pointer-drag and against making the handle substantially louder without user evidence.

## Options Considered

### Option 1: Add a stronger hover style now

Pros:

- Low implementation cost.
- Could make the handle easier to notice on desktop.

Cons:

- The global button hover already applies.
- A stronger hover only helps after the user has already found the handle.
- It risks making the drawer visually noisy on every storyboard card.

### Option 2: Make the handle wider now

Pros:

- Easier to click.
- Better future base if drag is ever revisited.

Cons:

- The current smoke-covered click target has not failed dogfood.
- A wider tab would take more visual space beside dense storyboard cards.
- The prior prototype found that a wider handle changes the feel from subtle drawer affordance to persistent side tab.

### Option 3: Add a visible icon or text mark now

Pros:

- More discoverable for first-time users.

Cons:

- Competes with the shot image and layer panel contents.
- Risks turning a per-card affordance into repeated visual clutter across dense boards.
- The current empty vertical handle is intentional and already covered by smoke.

### Option 4: Keep current behavior and document the threshold for change

Pros:

- Preserves the current quieter UI.
- Avoids changing a smoke-covered layout without a concrete user miss.
- Keeps the next implementation small if real users still miss the handle.

Cons:

- First-time users may still need to discover the handle.

## Recommendation

Do not change the layer drawer handle now.

The current handle is already a real button with pointer cursor, hover, accessible label, and smoke-covered placement. There is no repeated dogfood signal that users are missing it. A wider or more graphic handle would add persistent visual weight to every storyboard card.

If real users still miss the layer drawer, make the smallest affordance change first:

- slightly increase the button hit width, while keeping the visual pill quiet
- keep click-toggle as the primary behavior
- keep the empty-button smoke expectation unless the product deliberately adopts an icon
- verify dense board spacing and open-panel overlap after any width change

## Follow-up Criteria

Revisit this only if dogfood or user sessions show at least one of:

- users cannot find where to open layers
- users repeatedly click the image edge but miss the handle
- dense board spacing makes the handle too hard to target
- the handle is discoverable only after explanation

Until then, keep the layer drawer handle unchanged.
