# Photoshop Layered TIFF Spike

## Result

The spike proved that Storyboard Workbench can generate a TIFF that Photoshop
2026 opens as a layered document, but not by using sharp/libvips multi-page TIFF
alone.

## Productized Save/Export Status

The spike path is now connected to Storyboard Workbench Save and a dedicated
export command. `Save` writes multi bitmap layer shots in-place as
Photoshop-readable layered TIFFs, while single-layer shots remain ordinary TIFFs.
`Export TIFF` still writes one Photoshop-readable layered TIFF per shot into
`Photoshop TIFF Export/YYYYMMDDTHHMMSS/`.

The export smoke verifies the generated TIFFs with `psdtags` readback. A live
Photoshop 2026 check on `/private/tmp/swb-photoshop-export-validation/.../0010-shot.tiff`
reported:

- `layers=2`
- `names=Paint 1,背景`
- `width=320`
- `height=180`
- `mode=DocumentMode.RGB`

## Evidence

- Script: `scripts/photoshop-layered-tiff-spike.py`
- Output: `/private/tmp/swb-photoshop-layered-spike.tiff`
- Temporary Python dependency path used during the spike:
  `/private/tmp/psdtags-spike-deps`
- `psdtags` readback:
  - `psdtags_layers=2`
  - `psdtags_layer_names=['Image', 'Paint 1']`
- `tiffinfo` showed the Photoshop private TIFF payload:
  - `Adobe Photoshop Document Data Block`
- Photoshop 2026 JavaScript verification:
  - `layers=2`
  - `names=Paint 1,背景`
  - `width=320 px`
  - `height=180 px`
  - `mode=DocumentMode.RGB`

Photoshop localized the opaque bottom layer as `背景` (Background). The paint
layer remained named `Paint 1`.

## Control

A sharp/libvips standard multi-page TIFF control file was generated at:

`/private/tmp/swb-sharp-multipage-control.tiff`

sharp read it as:

- `pages=2`
- `pageHeight=64`

Photoshop 2026 opened the same file as:

- `layers=1`
- `names=背景`

So standard multi-page TIFF is not enough for Photoshop layer recognition.

## Technical Path

The working TIFF uses Python `psdtags` + `tifffile` to write Photoshop-specific
TIFF data:

- `ImageSourceData` TIFF tag `37724`
- optional XMP TIFF tag `700` for SWB metadata
- Photoshop layer records/channels inside that tag
- ordinary white-backed composite image as the main TIFF image

The internal working data remains `.storyboard-workbench/storyboard.project.json`
plus PNG layer assets; Photoshop layered TIFF is the Save/Export exchange file,
not the autosave transaction log.

## Limits Of This Spike

- RGB 8-bit only.
- Normal blend mode only.
- No layer groups, masks, text layers, smart objects, adjustment layers, or PSB.
- No integration with Storyboard Workbench project data yet.
