# Dense Marquee Selection Audit

Date: 2026-05-31

## Goal

Dogfood current marquee selection behavior on a dense board before changing interaction code.

This audit is read-only. It does not change product behavior.

## Fixture

- Temporary Electron folder: 48 generated PNG shots.
- Viewport: 1440 x 932.
- 100% zoom: 2 columns, 48 cards rendered.
- 50% zoom: 5 columns in the first row.

## Current Implementation

- Marquee starts only when pointer down happens on the board background:
  `event.target === event.currentTarget`.
- Pointer down on a shot/card does not start marquee selection.
- Selection bounds use viewport client coordinates and visible card rectangles.
- The marquee overlay is fixed-position and disappears on pointer up.
- There is no edge auto-scroll while dragging.

## Dogfood Findings

### Finding 1: Starting on a card does not marquee-select

At 100% zoom, dragging from inside shot 001 across the first 2 x 2 card area left selection at `1 selected`.

Starting the same drag from board background selected `4` shots.

At 50% zoom, the board became dense with 5 columns. Dragging from inside the first card across six visible cards left selection unchanged at `6 selected` from the prior operation and did not show a marquee. This means dense-card drag does not reliably start a new selection.

Product decision:

- Keep storyboard marquee selection outside shot cards only.
- This keeps the user model simple: card interiors are for card-specific actions, and outside-card space is for board-level marquee selection.
- Do not add partial "safe regions" inside shot cards unless this decision changes.

### Finding 2: Dragging to the viewport bottom does not auto-scroll

Dragging from the board background toward the bottom of the viewport selected `6` visible shots, but `scrollY` stayed `0`.

Impact:

- Users cannot marquee-select across rows beyond the current viewport in one drag.
- Large boards require repeated smaller selections or keyboard/meta-click selection.

## What Still Works

- Background-origin marquee selection does work.
- Selection hit testing correctly uses visible card rectangles.
- Scrolled layout still measures visible cards correctly.

## Recommended Next Steps

1. Keep marquee start outside shot cards.
   - Do not start marquee from card interiors, including seemingly empty card padding.
   - If dense boards still feel hard to use, improve outside-card affordance or spacing instead of adding partial card-internal start zones.
2. Add viewport-edge auto-scroll while marquee is active. Completed in follow-up implementation.
   - Scroll when the pointer is near top or bottom of the viewport.
   - Keep selection bounds in document coordinates or update the current viewport math so offscreen crossing remains predictable.
3. Add smoke coverage for dense marquee behavior. Completed for card-origin non-start and outside-card edge-scroll selection.
   - Keep a generated dense fixture.
   - Assert card-origin drags do not start marquee.
   - Assert edge drag scrolls and selects across rows.

## Non-Goals

- Do not redesign bitmap Select lasso/rectangle.
- Do not change shot dnd reorder behavior without a separate plan.
- Do not extract `SketchPad` as part of marquee work.
