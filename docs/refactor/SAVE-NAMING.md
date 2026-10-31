# Ordered TIFF naming

User confirmed on 2026-10-31 that the new editor retains the existing
project/scene/stb/artist/version/0010 naming rule and settings.

Project owns optional `naming: { sceneCode, artistName, version }`; the Board command
`setProjectNaming` applies project name and all three fields as one history edit.
Checkpoint preserves exact field text. New TIFF-folder imports initialize scene/artist/v001;
low-level unconfigured checkpoints retain their source names until Naming is applied.
The isolated editor exposes Naming with Apply/Cancel. Editing settings and Undo/Redo
only checkpoint metadata; explicit Save changes real output names.

Save derives active TIFF names in shot-array order, increments sequence by 10 and pads
to at least four digits. Numeric version `2` becomes `v002`; nonnumeric versions retain
their sanitized spelling. Existing filename-part sanitization replaces forbidden path
characters/whitespace with underscores. Empty fields use scene/artist/v001, and an empty
sanitized project name uses project. Names over 240 UTF-8 bytes refuse before output
writes rather than truncate into potential collisions. Pending keeps its existing TIFF
names and does not consume active-board positions; numbering skips a reserved Pending
name to preserve the output ledger's project-wide name uniqueness.

`flowOutputRename` is internal to TIFF Save, not a renderer filesystem capability.
Destination preflight rejects foreign names (case-insensitively) before codec/output
work. After TIFF writes/membership moves settle, Save records source names, exclusive
hidden staging names, destination names and inode/digest identity in its existing output
ledger. It stages every source before publishing any final name, so cycles and case-only
renames do not overwrite another shot. Publication uses the existing identity-checked
exclusive link/unlink move and directory flush protocol. Reordering alone reuses TIFF
bytes and inodes; it does not decode PNGs or re-encode TIFFs.

A failed operation returns no Save receipt. Its durable stage/publish intent remains;
the next explicit Save completes that exact rename batch before reading source bindings
or planning another edit. It never infers rollback from filenames, overwrites unrelated
files or deletes retained stages without their recorded identity. This new-format retry
protocol supersedes the old runtime's best-effort rollback description for this slice;
the old production runtime is unchanged. This is resumable per-file publication, not
all-files-at-once atomicity or proof against hostile cross-process writers/power loss.

Original backups keep stable shot-ID paths. Checkpoints/assets/Undo do not depend on
output filenames. Exported-shot Trash deletion is still a separate unfinished gate.
Windows/FAT/exFAT and installers remain unverified; hard-link/directory-flush limits of
the existing output move implementation still apply.
