# Dedicated editor project switching

The isolated new-format editor has an **Open project** button. Main chooses and
canonicalizes the folder, opens its checkpoint or bootstraps supported TIFFs using
the existing import path. This does not change the default production entry.

Before choosing another project, the renderer waits for an explicit TIFF Save to
settle and freezes its Session, including pending edits and checkpoint work. It does
not implicitly export TIFFs. Main prepares the selected project before certifying
and sealing the old runtime. Cancellation, selecting the same canonical root, or
failed preparation keeps the old Session and history; successful switching starts a
new Session. Undo history is not restored after leaving and reopening a project.
A failed checkpoint freeze stays closed to edits until a successful freeze retry.

`flowWorkspace` owns the single writable runtime. Each IPC read, asset admission,
checkpoint, TIFF Save and Close certification carries the originating session token.
Project IDs alone do not authorize operations: copied projects can share their ID,
and reopening A after B must not revive A's previous capabilities. Already-admitted
reads remain bound to their original runtime. New operations are refused while Main
prepares a transition. An admitted write prevents old-runtime certification until it
settles. The renderer waits for switching before certifying a window Close.

Editor remounting resets view and TIFF receipt state for the new session. Retired
image loads cannot create new Blob URLs or overwrite the new editor's status; existing
URLs are revoked on unmount. Assets on disk are not garbage collected.

Verification: `electron/main/flowWorkspace.test.ts`, dedicated preload parity and
runtime tests, plus `node scripts/flow-switch-smoke.mjs` after a complete build.
The GUI harness uses generated TIFFs, private userData and scripted native chooser
results. Clipboard and Trash are forbidden; evidence remains in its own temporary
container. Actual native-picker clicking and Windows acceptance are separate gates.
