# Dual-panel workbench prototype

User decisions confirmed 2026-10-31. This is the new frontend target, not a requirement
to reproduce the old zoom-to-animation frontend. Default production routing is unchanged.

## Interaction contract

- One application window. Dock panels between two columns, reorder them, resize vertically,
  adjust the column split, hide/show panels, and restore the default layout.
- Storyboard pictures accept drawing directly. Their headers own selection and drag sorting.
  Normal drag moves; no Alt-copy. The canvas panel edits the same Session image.
- Multi-selection displays the earliest selected active shot in project order. Beginning
  a stroke selects only its shot and makes that shot current in the canvas panel.
- Left/right arrows or canvas navigation buttons single-select adjacent active shots,
  cancelling multi-selection. Stop at the ends. Pending never participates. Text fields
  retain their arrow keys. An unsettled gesture blocks navigation.
- Grid tile size and canvas display zoom are independent. Neither enters another mode.
  Manual flipping is the first-version review workflow; no timing/audio or separate playhead.
- Text belongs to the project. Target interchange is explicit Markdown export only.
  Markdown import, continuous external Markdown writes and an AI API are not implemented here.
- Pending membership changes and Undo edit project state. Explicit Save materializes TIFFs
  through the existing Save transaction. Ordinary autosave still checkpoints the project.

## Module responsibilities

`Workbench` owns transient panel layout, visible-card tracking, selection presentation,
manual navigation and live display mirroring. `FlowEditor` adapts existing Session commands
and pixel tools to it; it remains the sole editor Session owner. `SketchPad` and `LayerPanel`
are reused. The prototype does not create a second editing/history/file-saving system.

Visible cards mount raster previews; a hovered card and the canvas panel can mount editing
surfaces. Live mirroring copies the active display canvas without serializing every pointer
move to PNG. Durable pixel admission remains the ordinary stroke/Session path. Both directions
are exercised before pointer release in the real Electron smoke.

Only demanded image assets load in this route. Visible active/Pending cards, the selected
canvas and enabled onion neighbors request their layers. A 96-entry Blob URL cache can
release unneeded entries. This is an initial count bound, not a decoded-byte memory budget:
visible images may themselves be large. All lightweight card nodes still exist; this is
not full row virtualization or a dedicated low-resolution thumbnail pipeline.

## Delivery stages and remaining work

This first prototype establishes drawing, selection, manual flipping, docking and persistence.
Layout/zoom choices are currently transient; OS-native separate windows are out of scope.

Next stages: user interaction review; new-workbench access to Japanese layout and remaining
presentation/tool controls; explicit Markdown export; refined layout persistence/keyboard
and pen behavior; representative large-raster profiling and a decoded-memory/thumbnail
strategy; independent acceptance; production routing. Existing classic entry remains available.

Later module work: Photoshop interoperability, advanced filling, external brush formats,
shared-shot backgrounds/cameras. Do not build those into this prototype.
