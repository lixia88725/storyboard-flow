# Playback and onion-assisted inspection — 2026-10-31

Candidate: `16f42a72a7090f99b15439c599a7a35d3d33252b`, original main.
Implementation commits: `e18137b` plus `16f42a7` (stable dwell dependencies and opacity-driver group-selection wait).
User approved coordinator-only continuation for playback checks/onion skin. No new
worktree, default routing, dependencies, timing/audio schema, source TIFF writes or push.

## Behavior and ownership

`FlowInspection` owns only ephemeral navigation, playback, speed and onion settings.
The editor supplies active shots, media URLs, its existing editable canvas and a settled
navigation check. Inspection unmounts the grid/sheet/Pending surfaces and mounts one current
canvas. A modal keeps the background editor inaccessible. Returning restores the prior
board mode and selects the inspected shot. Pending is excluded from the sequence.

Paused inspection uses the existing SketchPad and Session paint/selection/fill path.
Onion skin shows the immediate previous/next active images without wrapping, using existing
preview-only tinted stacks. Mixed-size references are contained, not stretched. Matte and
dialogue presentation remain separate from those references. Navigation, Play, onion toggles
and leaving inspection refuse unsettled strokes, layer gestures, pending requests or output.

Playback replaces the editable canvas with visible bitmap layers and derived presentation.
It waits for visible layer decoding before each frame's dwell; no flattened image, checkpoint,
TIFF or history entry is created. Speed defaults to 2 images/s and is session-only. It stops
on the last shot; Play from the end restarts at the first. Pause/seek/unmount cancel timers;
late decoding cannot advance a retired frame. Frame dwell depends on the current/next
identity, readiness and speed, so unrelated parent renders cannot restart its timer. Decode errors pause with a message. Window
blur/visibility changes pause playback. Global Undo is blocked while playing. Paused edits
still use normal Session history and Save. The slider and previous/next provide navigation.

## Verification

Final complete build: `.hermes/evidence/20261031T131936.934705Z-build/`, exit 0, 9.923s.
Final complete suite: `.hermes/evidence/20261031T132030.335660Z-full/`, exit 0;
392 files / 3003 tests passed, 1293.731s. Both receipts record the same clean candidate
before/after. The following report commit changes documentation only.

Earlier full attempt `.hermes/evidence/20261031T125425.490241Z-full/` on `e18137b`
passed 388 files / 2999 tests and failed four memory-admission cases. The sandbox denied
`/usr/sbin/sysctl -n hw.memsize kern.memorystatus_level kern.memorystatus_vm_pressure_level`,
so the real pressure sensor returned unknown and admission correctly refused. The same
read-only query outside the sandbox returned a valid normal-pressure sample. Focused
recheck of all four files passed all seven tests (`/tmp/flow-inspection-memory-recheck.log`).
No pressure policy, production fallback or assertions were relaxed. The final full run
uses the allowed native-query environment; earlier failures remain retained.

Real Electron focused regression: `scripts/flow-inspection-smoke.mjs`, run in both grid
and Japanese modes. Synthetic TIFF-only bootstrap, matte/dialogue, active-only sequence,
neighbor edges, playback completion, no project change during inspection, active-stroke
navigation refusal, real pointer painting with onion references, Save/Undo/Redo, relocated
reopen and certified normal Close. Explicit failure tests replace Image.decode inside the
synthetic renderer only: rejection, pending decode and late completion after pause.

Development runs retained under `/tmp/flow-inspection-gui*.log`. The first launch was
sandbox-blocked, then fixture fixes corrected an overly broad status selector and returning
a function through Electron IPC. These failed runs are retained and are not PASS evidence.
An existing opacity GUI regression failed once at the post-reopen group selection/preview
assertion (single layer changed instead of the expected group preview). The exact same
script and assertions passed on retry without source changes. Evidence is retained at
`/tmp/flow-inspection-final-opacity.log` (failed) and `/tmp/flow-inspection-retry-opacity.log`
(passed). A diagnostic run added an explicit post-reopen group-selected wait and retained all
assertions; it passed (`/tmp/flow-inspection-opacity-diagnostic.log`, receipt under
`/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-opacity-smoke-4LLy9J/`).
The initial selection already waited for this precondition; the reopened selection did not.
The final tracked driver now also waits after reopen. The precise cause of the first failed
selection remains unproven; final receipts do not erase that intermittent evidence.

## Limits

Renderer-only self-review/self-tests are not full independent application acceptance.
Existing production zoom-driven animation/timeline routing is unchanged; the isolated editor
uses an explicit Inspect entry and position slider. Full shell parity remains a later gate.
Playback is for inspection, not frame-accurate film timing/audio. No thumbnail timeline or
new duration schema. No new persistent settings. Asset URL caching remains editor-wide;
this does not certify thousand-image decode/memory/throughput. Windows, installers, native
picker interaction and real Photoshop roundtrip remain unverified. Existing full-suite,
GUI and platform evidence retain their original scopes; no broad acceptance claim.

## Final GUI receipts

All 221 cases passed on the frozen clean final candidate.

| Check | Cases | Receipt |
| --- | --- | --- |
| inspection | 30 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-inspection-smoke-FK5gdv/receipt.json` |
| inspection-japanese | 30 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-inspection-smoke-rwDPOA/receipt.json` |
| selection | 23 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-selection-smoke-WwZRK6/receipt.json` |
| selection-japanese | 23 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-selection-smoke-ds8oUK/receipt.json` |
| opacity | 26 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-opacity-smoke-rZzEPs/receipt.json` |
| editor | 42 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-editor-smoke-JgMPrT/receipt.json` |
| switch | 9 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-switch-smoke-oyNo2f/receipt.json` |
| presentation | 19 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-presentation-smoke-i4QbkN/receipt.json` |
| presentation-japanese | 19 | `/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-presentation-smoke-vYTXMW/receipt.json` |

Picker choices are scripted; real Canvas pointer input, Session, codec and filesystem
remain connected. No personal Trash is used. Raw batch logs: `/tmp/flow-inspection-frozen-*.log`.

Supplemental driver `/tmp/flow-inspection-mixed-smoke.mjs` passed 30 repeated inspection
cases plus four additional checks: mixed portrait aspect ratio, Undo isolation during
playback, normal Close while playing, and continued frame advancement while parent renders
are triggered repeatedly. Final log: `/tmp/flow-inspection-frozen-mixed.log`; receipt:
`/private/var/folders/jb/wlvb7qzn5ll_jpsjtkhhz8r40000gn/T/flow-inspection-smoke-k4lzPG/receipt.json`. It uses the same clean final implementation; it is not counted twice in the 221 cases.
