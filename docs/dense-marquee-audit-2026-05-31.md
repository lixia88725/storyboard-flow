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

Impact:

- In dense boards, most visible space is card surface, not background.
- Users naturally drag over cards to select a region, so the current gesture is hard to discover.

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

1. Allow marquee to start from safe card regions that are not interactive controls.
   - Do not start marquee from inputs, textareas, layer panel, menus, buttons, canvas drawing areas, dialogue grips, or dnd-kit drag handles.
   - A conservative first version can require a modifier key or start from card padding/header if normal card drag conflicts are unclear.
2. Add viewport-edge auto-scroll while marquee is active.
   - Scroll when the pointer is near top or bottom of the viewport.
   - Keep selection bounds in document coordinates or update the current viewport math so offscreen crossing remains predictable.
3. Add smoke coverage for dense marquee behavior.
   - Keep a generated dense fixture.
   - Assert card-origin marquee starts only from allowed regions.
   - Assert edge drag scrolls and selects across rows.

## Non-Goals

- Do not redesign bitmap Select lasso/rectangle.
- Do not change shot dnd reorder behavior without a separate plan.
- Do not extract `SketchPad` as part of marquee work.
