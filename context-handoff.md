# Storyboard Flow — source integration handoff

This is the complete approved source integration candidate, not an installer or a formal Release. Do not infer Windows, clean-machine, real Photoshop, Trash, clipboard, crash or cross-process guarantees from local checks.

Start with AGENTS.md, README.md and todo.md. Architecture is in docs/architecture/SYSTEM.md; stable rationale is in decisions.md. Workstation logs, private task discussions and one-off diagnostic launchers are intentionally not distributed. Required synthetic fixtures and executable test tooling remain in source.

## Integration contents

The source combines the existing main CI/release preparation with the Mac data-safety/recovery implementation, retired built-in AI modules, renderer/module cleanup and evidence-comparison tooling. Existing production guards, failure records, History/custody and recovery budget policy remain intact.

The first-create Save path includes compatible Python selection at the environment boundary, bounded complete native directory re-observation with fixed identity/restrictions, and retained-close comparison against the actual persisted Project after a required persistence succeeded but final ACK failed. Retention does not turn failed Save into success.

Native tests select Python through PATH rather than a workstation Homebrew absolute path. Use Python 3.12 with matching installed TIFF dependencies. CI passes its installed vendor path explicitly. Both packaging recipes include the production native helpers; package validation rejects missing helpers. This source change is not proof that either complete package has run on its target machine.

## Verification boundary

The preceding integration self-test exercised a real offline App: new synthetic empty directory → Add → edit dialogue → Save → normal retained Close → fresh-process reopen with the same dialogue → normal retained Close. Failure retention also has real Main/native regression coverage; service-level fault injection is not equivalent to a natural failed-GUI scenario. Exact source/build identities and raw receipts are held in the private task handoff. Final delivery/independent review status must be read from the task record, not inferred from this page.

The special non-certified normalSaveMetadataHistory test is intentionally absent and excluded in Vitest configuration. Other required fixture sources remain present. See todo.md for unverified product/platform areas.

## Local development

Use Node.js 22 and Python 3.12. Once installation is authorized, use the lockfile with npm ci and install the requirements into vendor/python/photoshop-tiff. Export SWB_PYTHON_DEPS_DIR to that directory for tests, and use an isolated TMPDIR for synthetic work. Python native wheels must match interpreter and architecture. Do not use production folders as fixtures.

Build with npm run build (both typechecks included), then npm run check:preload. Required tests use the allowed Vitest configuration; tests and smoke scripts still need an authorized safe execution environment. Do not run legacy smoke commands blindly against real userData, Trash or clipboard.
