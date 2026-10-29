# Coordinator decisions / deferred integration

- **Historical verification blocker resolved:** the initial stale-looking slot described in the previous handoff no longer blocks this lane. The coordinator's later original-candidate full run ended (exit 1); corrected implementation `6ae4547` has new focused/full/build receipts with exit 0 in `DELIVERY.md`. No other lane's live lock was removed or process terminated.
- **Future integration, not part of S1:** legacy dialogue drag can move a dialogue across shots in one UI gesture; `setDialogues` replaces only one shot's entries. Decide whether the wave-2 adapter may transact two commands atomically or needs a coordinator-owned batch edit contract. Without this, migrating that gesture directly could create partial history.
