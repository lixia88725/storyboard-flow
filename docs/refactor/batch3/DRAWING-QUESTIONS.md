# Drawing integration questions

The three previously requested module evidence gaps and the later sparse RGBA validation defect were addressed in the recorded self-tests; independent review of the repair remains open. The following are coordinator or future product work, not remaining requirements for this bounded module self-test.

- Session currently supports paint and separate layer commands, but merge requires replace pixels, reset opacity/blend and remove source layers as one atomic history entry. Coordinator: define and validate an owned compound command, captured baseline/generation, and depot receipt binding; do not apply the proposed edits as multiple independently visible history entries.
- This preparation refuses noncontiguous selections, hidden or locked layers, and backdrop-dependent blend merges. Confirm whether a later product slice needs legacy Merge visible behavior preserving/hiding locked sources or noncontiguous selection; these require a separately specified plan and compositing semantics.
- Pixel and layer limits are per-call, not global memory/concurrency bounds. Coordinator must bound concurrent producers and choose budgets.
