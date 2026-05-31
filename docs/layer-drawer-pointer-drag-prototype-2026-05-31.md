# Layer Drawer Pointer-Drag Prototype

Date: 2026-05-31

Prototype: `docs/prototypes/layer-drawer-pointer-drag-2026-05-31.html`

## Goal

Evaluate whether a pointer-drag gesture should be added for layer drawer open/close before changing product code.

This is intentionally isolated from the app. It does not change `LayerPanel`, `ShotCard`, or drawer behavior.

## What The Prototype Simulates

- Three storyboard cards in a dense row.
- The current right-side drawer handle.
- A panel that opens to the right and overlaps the neighboring card.
- Two modes:
  - Click Toggle: current mental model.
  - Drag Handle: scrub the handle horizontally to open/close.

## Findings

### 1. Occlusion model is acceptable only when one drawer is active

The drawer still needs to overlap the card to the right so it visually belongs to the owning shot.

This matches the current product direction, but it means any drag model must preserve the rule that only one drawer is open at a time.

### 2. Drag target is too narrow for a dependable gesture

The current quiet handle is about 10px wide in the prototype. That works as a click target, but it is uncomfortable as a drag target.

Making the handle wider improves dragging but makes the control louder and increases the chance that users interpret it as a persistent side tab rather than a subtle layer affordance.

### 3. Drag does not reduce mental load

Click-toggle has a simpler rule: click once to open, click again to close.

Pointer-drag adds a second model: users must understand partial open state, snap thresholds, and whether a short accidental drag should count as click or drag.

## Recommendation

Do not implement pointer-drag open/close now.

Keep the current click-toggle drawer. If users later report that opening/closing the drawer feels slow or hidden, first consider a clearer hover/cursor affordance or slightly larger click target, not a drag gesture.

## If This Is Revisited

- Keep click-toggle as the primary behavior.
- Treat drag as optional enhancement only after real user demand.
- Use a wider, visually tested handle before implementation.
- Preserve one-open-drawer-at-a-time behavior.
- Verify overlap at dense board spacing and reduced zoom.
