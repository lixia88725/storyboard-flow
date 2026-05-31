# Interaction Mode Audit

Date: 2026-05-31

## Goal

Decide whether Storyboard Workbench needs a dedicated global Select / Hand / Draw mode.

This audit is behavior-preserving. It documents the current interaction ownership model and does not change product code.

## Current Interaction Ownership

| Interaction | Start region | Owner | Notes |
| --- | --- | --- | --- |
| Brush / Eraser drawing | `.image-stage` inside `SketchPad` | active bitmap layer | `beginStroke()` focuses the shot, stops propagation, and ignores locked/missing layers. |
| Bitmap Select lasso / rectangle | `.image-stage` when tool is `select` | active bitmap layer | Selection mode is lasso or rectangle; existing selection handles own move/scale before a new draft starts. |
| Storyboard marquee | `.board-grid` background only | storyboard selection | `handleSelectionPointerDown()` requires `event.target === event.currentTarget`; shot cards intentionally do not start marquee. |
| Shot selection | `.shot-card` click | storyboard selection | Meta/Shift toggles multi-select; normal click selects one shot. |
| Shot reorder | `.shot-head` activator | dnd-kit shot sortable | Header is the explicit drag handle, not the whole card. |
| Dialogue create | empty `.dialogue-zone` double-click | shot dialogue list | Existing dialogue cards are excluded. |
| Dialogue reorder | `.dialogue-grip` | dnd-kit dialogue sortable | Textarea editing remains separate. |
| Layer drawer open/close | layer toggle button | `LayerPanel` | Pointer-drag open/close was prototyped and rejected for now. |
| Layer row opacity/reorder | non-control region of `.layer-row` | `LayerPanel` row gesture | Horizontal drag changes opacity; vertical drag reorders. Controls and menus are excluded. |
| Layer visibility sweep | visibility button mousedown/drag | `LayerPanel` visibility buttons | Drag applies the target visibility across visited layer rows. |
| Wheel zoom | board area, except layer list preserves wheel | top-level wheel handler | Layer list wheel is intentionally stopped so scrolling layers does not zoom the board. |
| Keyboard shortcuts | window keydown | top-level shortcut handler | Editable targets and open blocking menus are guarded before destructive/global shortcuts run. |

## Conflict Review

### Drawing vs storyboard selection

The image stage stops propagation, so brush/eraser/bitmap-select gestures do not start storyboard marquee or card selection. This is the most important separation and it is already explicit.

### Storyboard marquee vs card interactions

The product decision is clear: marquee starts only outside shot cards. This avoids partial "safe regions" inside a card and keeps the user model simple.

### Shot reorder vs shot click

Shot reorder starts from the shot header activator. This keeps ordinary card clicks available for selection and avoids turning the whole card into a drag surface.

### Dialogue editing vs dialogue drag

Dialogue drag starts from the grip button. Textarea input is separate and protected by editable-target keyboard guards.

### Layer row gestures

Layer rows are the densest interaction area. The current design still has a workable ownership rule:

- buttons/selects/menus keep their native actions
- row body drag resolves intent by delta
- horizontal drag is opacity
- vertical drag is reorder

This is more complex than other areas, but it is local to the LayerPanel and already covered by smoke.

## Recommendation

Do not add a dedicated global Select / Hand / Draw mode now.

The current model is region-owned rather than mode-owned:

- stage gestures edit pixels
- card header reorders shots
- board background marquee-selects storyboards
- layer panel owns layer gestures
- dialogue grip owns dialogue drag

That model is easier to learn than adding a new global mode switch, because users can predict behavior from where they start the gesture.

## Follow-up Criteria

Revisit a dedicated mode only if real dogfood finds repeated conflicts that cannot be solved by clearer start regions.

Good future triggers:

- users accidentally draw when they intend to pan or select storyboards
- users repeatedly try to drag whole cards instead of headers
- bitmap Select and drawing feel hard to distinguish in real use
- board navigation needs a true hand/pan tool beyond wheel/scroll

Until then, prefer small fixes to local affordances over global modes.
