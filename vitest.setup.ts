import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * Canonicalise the temp root before any fixture is created.
 *
 * macOS reports the temporary directory through a platform alias:
 * `/var/folders/...` is really `/private/var/folders/...`. The backend refuses
 * aliased paths on purpose (a link could be retargeted after a check), so every
 * fixture built from an unresolved `os.tmpdir()` fails on macOS while passing on
 * CI, where the temp dir is already canonical.
 *
 * Resolving the root once here keeps that production guard intact and keeps the
 * suite honest about what it exercises: a canonical temp directory, which is what
 * production workspaces are. Fixing it at 260 call sites instead would hide the
 * guard rather than satisfy it.
 */
const current = tmpdir();
try {
  const resolved = realpathSync(current);
  if (resolved !== current) process.env.TMPDIR = resolved;
} catch {
  // An unusable TMPDIR is the platform's problem, not a reason to fail every test file:
  // leave it alone and let the first fixture create report the real error.
}

/**
 * The layered-TIFF helpers run through Python and look for their dependencies in
 * SWB_PYTHON_DEPS_DIR (see scripts/photoshop-layered-tiff-*.py). The packaged app
 * resolves that itself; a test run has no app bundle, so point the helpers at the
 * already-installed vendor tree when it exists. Nothing is installed here.
 */
const depsDir = path.resolve("vendor/python/photoshop-tiff");
if (existsSync(depsDir)) process.env.SWB_PYTHON_DEPS_DIR ??= depsDir;
