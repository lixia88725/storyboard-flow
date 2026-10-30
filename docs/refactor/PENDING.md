# Pending membership and explicit output — 2026-10-31

User approved coordinator recommendation: Pending changes project membership immediately;
background checkpoint persists that state; physical TIFF effects wait for explicit Save.
This supersedes the immediate-materialize/move policy only in the isolated new-format
editor. Default production routing and existing projects remain unchanged.

## Authoritative data and visible files

- ProjectV1.shots / parkedShots own membership, order, text and image references.
- Existing immutable layer PNGs remain in .storyboard-flow/checkpoints/assets/.
  Moving membership neither duplicates pixels nor moves these assets.
- A successful Save writes active TIFFs in the project root and parked TIFFs in Pending/.
  Parked TIFFs are not part of the active board ordering. Bound names remain stable;
  ordered filename synchronization is a separate gate. Newly created shots use ID names.
- .storyboard-flow/originals/<shotId>.tif retains the first imported source bytes.
- Everything stays inside the project folder. Moving Pending membership is not deletion.

Grid and Japanese views use the same Session command/history. Drag to Pending, drag back
onto an active card, restore to the active end, and Pending ordering change references
only. Group parking is one command. Undo/Redo restores membership/order; even after Save,
Undo does not immediately reverse a physical file move. The next Save reconciles it.
Background checkpoint and a new process restore Pending without needing a TIFF move.

## Save protocol

Save captures membership with the project before its first await. Candidate content keys
cover the exact image/text input, so an unchanged TIFF is checked and reused, not decoded
or re-encoded. Membership-only moves retain the same inode. Changed pixels/text go through
the existing bounded codec and native CAS writer; all candidates prepare before new effects.
No new asset garbage collection or recovery deletion is introduced.

A per-file move intent records from/to membership, source inode/device and exact digest
in tiff-output.json before publication. Destination publication is exclusive hard linking;
it never clobbers an unrelated entry. Verify both names/digests, release only the matching
source name, flush affected directories, then clear the intent. Interrupted publication
with both names or only the destination can resume on the next explicit Save. A different
inode, changed content, alias or unsupported filesystem refuses and retains evidence.
Recovery first completes the recorded intent, then reconciles the newly captured project.
No whole-batch atomicity or cross-process writer guarantee is claimed.

Source backups remain immutable; partial Save never produces a successful whole-project
receipt. Existing checkpoint assets preserve editability even after output failure. Native
external TIFF edits are detected and refused, not silently overwritten or automatically
imported in this new path. A confirmed import/refresh workflow remains a later gate.

## Verification boundaries

Synthetic tests cover no raster/depot work for membership changes, queued paint then park,
single Undo/Redo, checkpoint, Save/restore, unrelated collision, aliased Pending, interrupted
link/unlink recovery, and unchanged TIFF reuse. Real Electron covers pointer drop, Japanese
restore, Save/Undo/Save and a new-process reopen. See the dated acceptance report for actual
candidate identity and results. No Windows/removable filesystem/installer or large-project
performance claim. Hard links require filesystem support; there is no silent copy fallback.
Deleting an already exported shot remains refused until the separate Trash transaction exists.
