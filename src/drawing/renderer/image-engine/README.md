# Native display frame receiver

`frames.ts` is a pure renderer Module; it does not open a port, allocate a canvas,
create a writable image document, or persist a project. The external Interface is
`createImageFrameStore(identity, limits)`, `accept`, `reset`, `snapshot`,
`subscribe`, and `dispose`. `validateImageFrame` is also exported for transport
admission. Tests cross these same entry points using real typed pixel arrays.

## Wire descriptor

`ImageFrameHeader` and `FrameTile` are the shared display descriptor draft.
The native binary envelope/JSON parser is outside this Module. Pass one complete
header and its exact `Uint8Array` byte view after assembling bounded transport
chunks. ArrayBuffer and shared memory inputs are deliberately refused; the Main
Adapter must supply an exact byte view. No zero-copy guarantee is made.

Identity is sessionId + incarnation + documentId + workerEpoch + epoch. An epoch
is a host-established display barrier (Undo, Refresh, target change, cancellation
or version installation). A restarted worker changes workerEpoch. Call reset
explicitly before admitting changed identity; never reuse an old identity tuple
for a new generation. A store belongs to one project editor session: dispose it
when that session retires. Reset to an identical tuple preserves sequence/input
floors and the fact that a persistent version was already installed.

Sequences start at 1. A keyframe has baseFrameSeq=null, covers the entire canvas,
and can recover across skipped frame sequence numbers. A delta must immediately
extend the currently installed frame sequence, refer to that frame as its base,
and retain the same dimensions. A missing/wrong base or skipped delta places the
store in needsKeyframe: snapshots conceal its retained pixels until a fresh
complete keyframe is installed. Late frames do not change state.

imageVersionRef is an opaque accepted durable document version, not a pending
candidate. It may be null for an initial uninstalled preview only with previewId.
Once a version has been installed in an identity, it cannot become null.
inputThrough is a monotonic accepted input prefix within that identity; it is not
a persistence receipt. Rendering a preview does not acknowledge a project Save.

Tiles are non-overlapping absolute rectangles, top-left origin, tight rows of
straight-alpha sRGB RGBA8. Their byte ranges partition the exact payload without
holes, overlap or trailing bytes. A transparent tile overwrites previous pixels;
there is no source-over blending. Keyframes are validated for full coverage.
All numeric fields are safe integers. Geometry, byte lengths, ranges, tile count
and canvas allocation are budgeted before installation. Default budgets are
16,777,216 pixels, 64 MiB payload, 4096 tiles and a 32768-pixel dimension ceiling.
Hosts may tighten them. Validation uses only data properties, not accessors.

## Surface ownership and recovery

All validated tiles are applied to private staging pixels before publishing.
Both surfaces subscribe to the one store, then consume complete snapshots.
Snapshot pixels are always the entire width×height×4 backing, never the transport
patch payload. InstalledFrameHeader deliberately omits tiles/baseFrameSeq to
avoid interpreting full-backing offsets as incoming packed tile offsets.
Each snapshot has its own metadata/bytes, so a consumer cannot corrupt another
surface or the owner. Unsubscribe removes only that listener. It does not clear
pixels; a remounted surface calls snapshot to get the entire current backing.
Mutating entry points refuse observer reentrancy; observer exceptions cannot
roll back a successful frame. Dispose releases backing and listeners.

The transport must bound queued frames and acknowledge an installed sequence.
When coalescing, recompose the union of dirty regions since that acknowledged
base; never send only the latest lost-delta suffix. Input flow control, chunk
assembly, display acknowledgements and native operation retries remain owned by
the integration Modules. This receiver neither retries nor replays input.

The pure tests do not certify Electron MessagePort copying, a real Canvas,
GUI timing, pressure hardware, worker crashes, storage, or Windows rendering.
Integration must test those paths independently and add frames.test.ts to the
approved explicit suite list when integrating this isolated file cluster.
