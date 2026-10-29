# Temporary test workspaces

Tests must not create synthetic workspaces inside the source checkout. Opening the
app does not need `gate-fixture-*`, `gate-clean-*`, or `gate-v2-partial-*` folders;
these names describe test scenarios.

Use the test-only helper from an active Vitest test:

```ts
import { temporaryWorkspace } from '../../test/temporaryWorkspace';

const root = await temporaryWorkspace('gate-fixture-');
```

Each call creates a private `storyboard-tests-*` container under the canonical
system temporary directory. The fixture root is inside this container, so sibling
copies and aliases such as `${root}-copy` and `${root}-alias` are also owned by the
test. Do not create additional fixtures outside the returned container. A
temporary-directory override inside the checkout is refused before allocation.

After a successful test the helper removes its own container. It checks container
identity before cleanup and does not follow symlinks into other workspaces. It
never discovers cleanup targets by scanning existing folders or matching prefixes.

Failed tests retain the container and print its location for investigation. An
interrupted or killed test process may also leave temporary data there. These
artifacts stay outside the checkout; do not delete failure evidence merely to
obtain a clean test result. Production recovery directories are unrelated and
must not be passed to this helper.

The writer-gate, workspace-recovery-store, Mac recovery authorization and metadata
tests use this helper. Their protection assertions are unchanged. The helper's
regressions cover automatic cleanup, sibling copies/aliases, external-target
preservation, failure retention, prefix validation and invalid temp overrides.
