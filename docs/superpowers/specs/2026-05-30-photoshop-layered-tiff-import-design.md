# Photoshop Layered TIFF Import Design

## Goal

Import Photoshop-edited layered TIFF files through the existing SWB import workflow. A Photoshop layered TIFF is treated as an external source file and converted into SWB-owned bitmap layer data. SWB should not use Photoshop TIFF as its internal working format.

## Product Behavior

When a folder is opened or refreshed, SWB already scans for image files that are not owned by SWB. The import action should keep that model:

- Ordinary external images continue through the current import path.
- Photoshop layered TIFF files are detected by the Photoshop `ImageSourceData` TIFF tag.
- Detected layered TIFF files are converted into SWB bitmap layers.
- The source TIFF is moved into `Archive/<timestamp>/`, matching the existing import safety behavior.
- The resulting shot is marked as SWB-owned and uses the normal SWB internal data model.

This is not a "direct open and edit Photoshop TIFF in place" feature. It is an ingestion path from Photoshop into SWB.

## Internal Data Model

The imported shot should use the existing internal format:

- `.storyboard-workbench/storyboard.project.json` is the authoritative project state.
- `.storyboard-workbench/layers/<shot-id>/*.png` stores per-layer bitmap assets.
- The working shot TIFF remains SWB-owned and managed by the existing Save/import metadata path.

The original Photoshop TIFF is archived, not rewritten in place.

## Layer Mapping

V1 should map the Photoshop raster layer data that SWB can represent today:

- Photoshop layer name -> SWB bitmap layer name.
- Photoshop layer order -> SWB bitmap layer order.
- Photoshop visibility -> SWB layer visibility.
- Photoshop opacity -> SWB layer opacity.
- Supported Photoshop blend modes -> SWB `normal`, `multiply`, or `screen`.
- Unknown blend modes -> `normal` plus an import warning.

Unsupported Photoshop features should not block the whole import unless there is no usable raster layer data. Text layers, smart objects, adjustment layers, groups, masks, clipping masks, and unknown layer effects can be flattened, skipped, or degraded with an import warning depending on what the parser exposes.

## Detection

Layered Photoshop TIFF detection should be explicit:

- Try to read Photoshop TIFF layer data from tag `37724`.
- If the tag is absent or unreadable, fall back to the existing ordinary image import.
- If the tag exists but layer extraction fails, report an import warning and avoid corrupting the existing project.

## File Safety

The import should preserve the existing transaction shape:

- Prepare converted layer assets in a temp folder first.
- Prepare the SWB-owned working TIFF in temp storage.
- Move the source Photoshop TIFF into Archive only after conversion preparation succeeds.
- Move generated SWB assets into place.
- If a later metadata write fails, roll back generated files and archived source moves where possible.

This keeps the current Save boundary intact.

## UI

Use the existing import control and warning surface. No new Photoshop-specific first-pass UI is required.

Optional wording can mention Photoshop only when relevant, for example:

- `Import needed`
- `Imported Photoshop layered TIFF with warnings`
- `Unsupported Photoshop layer features were simplified`

## Tests

Focused coverage should include:

- Detects Photoshop layered TIFF and routes it to layered import.
- Falls back to ordinary TIFF import when no Photoshop layer tag exists.
- Converts layer name, order, visibility, opacity, and blend mode.
- Warns on unsupported or unknown Photoshop features.
- Rolls back source archive and generated layer assets when later metadata writing fails.
- Electron smoke imports a Photoshop layered TIFF exported by SWB, then verifies SWB sees multiple bitmap layers.

## Non-Goals

V1 does not include:

- Editing Photoshop TIFF files in place.
- Full Photoshop feature round-trip.
- PSD import/export.
- File watching or automatic sync from Photoshop.
- Replacing an existing selected shot from a Photoshop TIFF.
- Making Photoshop layered TIFF the SWB Save format.
