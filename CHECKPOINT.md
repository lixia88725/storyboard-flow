# Current source checkpoint — Storyboard Flow

**WIP SOURCE CHECKPOINT / NOT ACCEPTED / NOT A RELEASE.**

Target branch: `checkpoint/data-safety-wip-20261012`.
Public parent: `2131f65423c8b67de7ccc0ba45daf5d9e217bf48`.
Source checkpoint uploaded and read back: `d572cdfaf0ffb7e2d00a81f78c6f3b2b425f1877`. All 522 source objects match the manifest on GitHub. A later documentation-only commit may update this branch without changing that tested source identity. No main merge, PR, tag or Release occurred.

The complete 522-source identity is [SOURCE-MANIFEST.json](research/data-safety/SOURCE-MANIFEST.json), SHA256 `05fda907f9d878a47abb9812a331725e220ee8ee50686eeda857b0998bef3646`. Existing source bytes are preserved exactly; [SOURCE-CHECKPOINT.md](research/data-safety/SOURCE-CHECKPOINT.md) records reused evidence, all eight failing test identities, independent-review limits and portability gaps.

Only source/tests/configuration and sanitized necessary documentation are added. No private fixture, raw GUI trace, raw report, credentials, dependency/vendor download, generated build or cache is added. Prohibited inherited fixture entries are removed from the final tree, not read or copied as candidate evidence. Previously public base history is retained, not rewritten; deletion does not make those old objects disappear from Git history.

The inherited workflow is unchanged: pushes to `main`, version tags, or manual dispatch can build/publish releases and update the release repository. A push only to this checkpoint branch matches none of its configured automatic triggers; no additional workflow is introduced. Recheck remote automation before upload if it changes.

Start with [context-handoff.md](context-handoff.md) and [todo.md](todo.md). Acquisition/install/clean-machine behavior is not verified, production quota is not approved, Windows and full safety acceptance remain incomplete.
