# Board questions

## Trusted insertion admission — resolved for this batch

Coordinator decided that no new depot interface is needed. `read` obtains eligible bytes; Session calls its captured depot `put` to revalidate decoding and dimensions even for reused assets, then verifies the actual bound receipt before installing the shot. Implementation `04e48b5ad84ad68a756872b52a2ce8753ce72e70` follows that decision. No renderer-provided receipt is trusted. See BOARD-DELIVERY.md for final verification and limitations.

## Historical question

Session insertion is intentionally not exposed. `FlowAssetDepot.read(assetId)` confirms eligibility and readable bytes but returns no trusted dimensions or admission receipt. A renderer-supplied image and receipt cannot prove that each asset was decoded and admitted at the claimed dimensions by this Session's depot. The coordinator should define a depot-owned, session-bound validation operation/receipt for every layer (including assets loaded from a checkpoint), and bind it to actual readback and claimed dimensions before adding Session insertion. Do not trust a caller-fabricated `FlowAssetReceipt` or infer admission dimensions from `read`. Pure `insertShot` remains available and unchanged; this lane does not claim insertion or its missing-asset/reopen cases complete.
