# Outside-Card Marquee Affordance Audit

Date: 2026-05-31

## Goal

Decide whether storyboard marquee selection needs a clearer outside-card affordance after edge auto-scroll.

This audit is behavior-preserving. It does not change marquee start regions, scrolling, styling, or smoke coverage.

## Current Behavior

- Storyboard marquee starts only from the `.board-grid` background.
- Card interiors intentionally do not start marquee selection.
- This is enforced by `handleSelectionPointerDown()` checking `event.target === event.currentTarget`.
- The board uses visible gaps between cards, currently `18px 16px`.
- While dragging, `.selection-marquee` renders a fixed overlay with a green border and translucent fill.
- Marquee edge-scroll is implemented through `marqueeEdgeScrollDelta()` and document-coordinate hit testing.
- `npm run smoke:bitmap` covers dense-board card-origin non-start and outside-card edge-scroll selection.

## Existing Product Decision

The user explicitly chose the simpler rule:

- Do not allow marquee selection to start from inside shot cards.
- From the user's perspective, only shot-card outside space should start box selection.
- Avoid partial card-internal "safe zones" because they increase mental load.

This remains the most important constraint for this area.

## Current Signal

Before edge-scroll, dense-board dogfood found two things:

- background-origin marquee selection worked
- dragging to the viewport bottom did not auto-scroll

The second issue has since been fixed and covered by smoke. There is not yet a repeated dogfood signal that users cannot find the outside-card start region after edge-scroll.

## Options Considered

### Option 1: Add visible instructional text

Pros:

- Directly tells users where marquee starts.

Cons:

- Adds persistent explanatory UI to the workbench.
- Violates the goal of keeping the canvas quiet and action-first.
- Helps only as reading material, not as a direct interaction improvement.

### Option 2: Add a persistent board-background pattern or highlight

Pros:

- Could make outside-card space feel more selectable.

Cons:

- The app already has a subtle global grid background.
- A stronger pattern would compete with storyboard cards and selection state.
- Dense boards have limited negative space, so the signal may become visual noise.

### Option 3: Add hover styling over board background

Pros:

- Lower noise than persistent text.
- Could hint that the background owns board-level gestures.

Cons:

- Hover feedback for the entire board background can feel ambiguous.
- It does not help touch/pen users.
- It may imply the whole board, including cards, can start marquee, which is not true.

### Option 4: Keep current behavior and watch for real misses

Pros:

- Preserves the simple start-region rule.
- Keeps dense boards visually calm.
- Avoids adding UI after the concrete edge-scroll problem has already been fixed.

Cons:

- First-time users may still discover marquee by trying board background drags.

## Recommendation

Do not add a new outside-card marquee affordance now.

The important product rule is already clear in behavior: card interiors do not start marquee; board background does. The concrete dense-board failure was missing edge-scroll, and that is now implemented with smoke coverage. Adding text, a stronger board pattern, or hover treatment now would increase visual surface without evidence of a remaining user failure.

If real users still have trouble starting marquee selection, prefer the smallest low-noise change:

- slightly increase useful board gap/edge space at dense zoom levels, or
- add a subtle cursor/hover only when the pointer is over actual `.board-grid` background, not over shot cards

Do not add card-internal start zones unless the product decision changes.

## Follow-up Criteria

Revisit this only if dogfood or user sessions show at least one of:

- users repeatedly try to marquee from card interiors
- users cannot find enough outside-card space on dense boards
- edge-scroll works technically but users still select too few cards in real boards
- users ask for clearer board-level selection behavior after trying dense layouts

Until then, keep the outside-card marquee affordance unchanged.
