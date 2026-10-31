# TIFF folder bootstrap — 2026-10-31

The dedicated new-format editor accepts an existing project folder, or bootstraps a
TIFF-only folder when .storyboard-flow does not exist. Existing/corrupt/legacy project
data is never replaced or reinterpreted as a new import. Production App/launcher stays
unchanged. This is bootstrap, not adding media to an already open Session.

The native chooser is available after a complete build:

```sh
node_modules/.bin/electron dist-electron/main/flowEditorEntry.js --choose /absolute/path/to/dedicated-userData
```

Supply an existing, dedicated userData directory. An absolute project directory can
replace --choose. Choosing Cancel creates no project. The editor displays opening status
while preparing and prevents Close until preparation settles. In-progress import cancel
and per-file progress are future full-shell work; the chooser itself is cancellable.

Only root *.tif/*.tiff and Pending/*.tif/*.tiff are read, in natural filename order.
Other files remain untouched. Source/project/shot/image/dialogue identities are not trusted
as local authority: a fresh project owns fresh shot/image/dialogue IDs; supported script,
dialogue and image/layer properties are preserved. Layer IDs remain scoped to each image.
Case-insensitive duplicate TIFF names across root/Pending refuse instead of guessing a
rename. Unsupported codec inputs refuse rather than flatten or drop metadata.

Each TIFF is decoded/admitted sequentially into a private .flow-import-* directory in the
selected folder. Checkpoint and source bindings are fully prepared and loaded there.
Sources are rechecked for catalog/content changes before a native exclusive whole-directory
publication of .storyboard-flow. Even an empty competing destination is not overwritten.
Native publication requires the OS no-replace primitive; there is no copy/overwrite fallback.
Original TIFFs are never modified by import. First-original backups are made at explicit Save.

Normal success/failure removes only the still-identified derived staging directory; a root
or staging identity change refuses cleanup. An abrupt process crash may retain staging;
there is no automatic stale-stage deletion or crash-resume claim. Publication/flush/verification
failure is reported honestly, even if a complete project namespace has already appeared.
A later explicit open loads that namespace strictly instead of re-importing over it.

Current bounds: 1–10000 TIFF files, 128 MiB per source, 512 MiB aggregate prepared PNG bytes,
plus the codec's existing per-image dimension/pixel/layer limits. These are safety limits,
not a 1000-image performance acceptance. No dependencies are installed. The Python publication
helper and codec worker run from source in this isolated entry; installer resource packaging,
Windows/Linux execution, external TIFF refresh and live A/B switching remain separate gates.
