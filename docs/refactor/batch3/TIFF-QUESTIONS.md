# TIFF lane questions / integration boundaries

No cross-lane source changes required for this bounded module. The following are
coordinator decisions for integration, not permissions requested for this delivery.

1. **New raster interchange version**: `flow:metadata` retains `app: "Storyboard Flow"`
   and `format: "flow-tiff"`, with module-local `rasterVersion: 1`. The old production
   metadata has canvas/presentation/naming/ownership fields that ProjectV1 cannot
   represent. This module refuses it rather than silently dropping fields. Do not
   route existing production files through it as a format migration. Decide an
   explicit legacy conversion/preservation contract separately.
2. **Project schema gaps**: ProjectV1 has project/shot names, IDs, script text,
   dialogues, image/layer identities and layer kind/lock/compositing fields. It has
   no presentation matte/dialogue-overlay policy, delivery filename/scene naming
   policy, root source fingerprint/ownership, ICC/EXIF/XMP extension bag, groups,
   masks, effects, adjustment/text/vector layers, clipping, off-canvas pixels or
   Photoshop blending ranges. Unsupported input is refused. If these must become
   editable, a coordinator-owned schema/product decision is required first.
3. **Worker location/packaging**: the new worker is
   `electron/core/formats/codec.py`, with explicit script/deps/Python paths supplied
   by the caller. Existing packaging only copies the old helpers. Copying this
   worker and selecting the packaged dependency path are coordinator-owned;
   this slice makes no installer or alternate-platform claim.
4. **Identity policy on import**: decode preserves supported portable IDs/text but
   never grants authority or asset IDs. Import into an existing project must decide
   collisions/remapping and use the Session's commands; a TIFF is never a second
   writable project owner. `admitTiffCandidate` only admits candidate PNGs and
   returns an ImageDocumentV1, and does not publish a checkpoint.
5. **Next explicit Save/backup contract**: coordinator captures one immutable
   Session snapshot/revision and bound immutable asset reader, prepares all TIFF
   candidate bytes with this codec, then owns first-backup verification, source
   identity/external-change checks, filename plan, native permissions, recoverable
   output transaction/publication and final readback. A codec success only means
   bytes were encoded; it cannot acknowledge Save, replacement or Close. Recheck
   that the intended snapshot is still the acknowledged Save version; edits during
   output need an explicit old-snapshot success/newer-dirty policy. Retain failures
   and partial output evidence; no automatic source replacement or backup cleanup.

The existing legacy importer drops hidden/empty layers and substitutes unsupported
blend modes; the legacy exporter bakes opacity into PNG alpha and uses a simple
normal overlay composite. Their behavior remains untouched. This new strict worker
uses the same installed codecs with explicit raster validation and separate layer
opacity. Actual Photoshop application interoperability remains TODO: verify.
