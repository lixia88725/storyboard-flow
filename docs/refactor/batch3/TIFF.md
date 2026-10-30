# TIFF Formats — Sol implementation task

Read PLAN.md. First bounded deliverable: a new-format TIFF decode/encode module under
electron/core/formats/** using already installed codecs/helpers, with a real synthetic
TIFF -> editable image/metadata -> edit -> TIFF -> decode roundtrip. No production Save
or original-file replacement yet: coordinator owns output transaction/backup/lifecycle.

Audit existing supported TIFF/Photoshop helper behavior and metadata first. Preserve the
supported subset explicitly: layer order, names, pixels, visibility, opacity, blend modes,
canvas dimensions and applicable Storyboard Flow text/identity metadata. Do not silently
flatten/drop unsupported layered input and call it editable roundtrip. Plain flat TIFF
may become one image layer with an explicit supported result. Unsupported inputs return
actionable diagnostics. No Photoshop full-fidelity or PSD support claim.

Define a small module-local conversion interface using ProjectV1/ImageDocumentV1 as
appropriate; decoded PNGs are candidate bytes until asset-depot admission, never assumed
trusted IDs. Encode reads caller-supplied immutable assets and snapshots metadata before
awaits. Reuse existing sharp/Python infrastructure through a narrow adapter with bounded
input/output limits and explicit failures. No new packages or global config. If current
ProjectV1 cannot preserve essential metadata, document the precise schema gap rather
than discard fields or modify shared contracts owned by Board/coordinator.

Required evidence: actual supported layered and plain TIFF decode/encode/redecode,
Unicode text/layer names, hidden/empty/transparent layers, opacity/blend behavior, bad
or missing pixels, malformed/unsupported input, caller mutation during awaits,
dimensions/resource limits, deterministic failure with original source bytes unchanged.
Use certified synthetic fixtures only. Test actual codec outputs, not just JSON mocks.
Include a synthetic checkpoint/assets integration example so coordinator can wire
import/admit/checkpoint and explicit output later. No claims about first-backup/replacement,
Save during edits, external changes or multi-project lifecycle without implementation.

Focused: electron/core/formats. Full/build via PLAN runner; use --lane assets only for
full/build, NOT focused. Deliver TIFF-DELIVERY.md / TIFF-QUESTIONS.md including precise
supported TIFF subset and recommended next Save/backup contract. Stop after this slice.
